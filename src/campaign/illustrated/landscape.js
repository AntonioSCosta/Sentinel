// Only geographical data enters this cache. Reports, units and village status
// are painted by map-view on every frame.
import { createCampaignTerrain, distanceToLine } from '../../campaign-map-3d/terrain.js';
import { generateVegetation } from '../../campaign-map-3d/strategic.js';
import { makeRng } from '../rng.js';

export const BORDER = 240;
const cache = new WeakMap();
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const mix = (a, b, t) => a + (b - a) * t;
const density = 1.5;

export async function loadBrushes() {
  const sheet = new Image();
  sheet.src = new URL('../../../assets/map/illustrated/brushes.webp', import.meta.url);
  await sheet.decode();
  return sheet;
}

// Tileable pigment field, sampled at several scales. Local seed only.
function pigment(rng) {
  const grid = Float32Array.from({ length: 256 * 256 }, () => rng.next());
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let u = x - ix, v = y - iy;
    u *= u * (3 - 2 * u); v *= v * (3 - 2 * v);
    const a = (iy & 255) << 8, b = ((iy + 1) & 255) << 8;
    return mix(mix(grid[a + (ix & 255)], grid[a + ((ix + 1) & 255)], u),
      mix(grid[b + (ix & 255)], grid[b + ((ix + 1) & 255)], u), v);
  };
}

function paintLandscape(seed, world, brushes) {
  const { w, h } = world, pad = BORDER;
  const terrain = createCampaignTerrain(seed, world);
  const vegetation = generateVegetation(seed, world, terrain);
  const rng = makeRng((seed >>> 0) ^ 0x61cb83d5), noise = pigment(rng);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + 2 * pad) * density);
  canvas.height = Math.ceil((h + 2 * pad) * density);
  const ctx = canvas.getContext('2d', { alpha: false });
  const width = canvas.width, height = canvas.height;
  // Sample the terrain once on a fine grid, including a quiet collar of hills
  // outside the orderable map. Use neighbouring texels to light its slopes.
  const z = new Float32Array(width * height);
  for (let row = 0; row < height; row++) {
    const y = row / density - pad;
    for (let col = 0; col < width; col++) {
      const x = col / density - pad;
      const d = Math.max(0, -x, -y, x - w, y - h);
      const t = clamp(d / 75, 0, 1);
      const edge = terrain.heightAt(x, y);
      z[row * width + col] = mix(edge, 30 + 120 * noise(x / 110, y / 85), t * t * (3 - 2 * t))
        + 4.5 * noise(x / 15, y / 12) + 1.1 * noise(x / 4, y / 6);
    }
  }
  const raster = ctx.createImageData(width, height), data = raster.data;
  for (let row = 0; row < height; row++) {
    const y = row / density - pad;
    for (let col = 0; col < width; col++) {
      const x = col / density - pad, i = row * width + col;
      const dx = (z[row * width + Math.min(col + 2, width - 1)] - z[row * width + Math.max(col - 2, 0)]) * density / 4;
      const dy = (z[Math.min(row + 2, height - 1) * width + col] - z[Math.max(row - 2, 0) * width + col]) * density / 4;
      const shade = clamp((dx * .62 + dy * .78) / Math.sqrt(1 + dx * dx + dy * dy), -.9, .9);
      const mottling = noise(x / 47, y / 37), dry = clamp((z[i] - 20) / 102 + mottling * .58 - .21, 0, 1);
      const rock = clamp((z[i] - 91) / 46 + .28 * Math.hypot(dx, dy), 0, 1);
      const fleck = (noise(x / 3, y / 2) - .5) * 11 + (rng.next() - .5) * 8 + (mottling - .5) * 25;
      const light = shade * 52 + fleck, base = i * 4;
      data[base] = mix(mix(144, 195, dry), 170, rock) + light;
      data[base + 1] = mix(mix(154, 169, dry), 165, rock) + light * .92;
      data[base + 2] = mix(mix(103, 116, dry), 147, rock) + light * .78;
      data[base + 3] = 255;
    }
  }
  ctx.putImageData(raster, 0, 0);
  ctx.setTransform(density, 0, 0, density, pad * density, pad * density);
  ctx.lineCap = ctx.lineJoin = 'round';
  const stroke = (points, color, weight) => {
    ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.beginPath();
    points.forEach(({x,y}, i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke();
  };
  // Furrows collect around villages in small, irregular groups.
  for (const p of world.settlements.filter(p => p.kind === 'aldeia')) {
    const axis = rng.range(-.7, .7);
    for (let n = 0; n < 12; n++) {
      const x = p.x + rng.range(-29, 29), y = p.y + rng.range(-20, 22);
      if (Math.abs(y - terrain.riverY(x)) < 14) continue;
      ctx.save(); ctx.translate(x,y); ctx.rotate(axis);
      const a = rng.range(5,14), b = rng.range(3,7);
      ctx.fillStyle = rng.pick(['#aea16a','#b8a579','#8f995f','#aaab74']);
      ctx.beginPath(); ctx.moveTo(-a,-b); ctx.lineTo(a,-b+2); ctx.lineTo(a-2,b); ctx.lineTo(-a-2,b-1); ctx.fill();
      for (let j = -b+1; j < b-1; j += 2) stroke([{x:-a,y:j},{x:a-2,y:j+1}], 'rgba(91,74,46,.36)', .55);
      ctx.restore();
    }
  }
  const river = [];
  for (let x = -pad; x <= w + pad; x += 2) {
    river.push({
      x, y: terrain.riverY(x) + (noise(x / 17, 3) - .5) * 2,
      north: 2.1 + 2.7 * noise(x / 26, 8),
      south: 2.3 + 3.3 * noise(x / 20, 13),
    });
  }
  // Asymmetric banks widen independently at gravel bars. A broken highlight
  // follows the current on the water, clear of the silhouette of either bank.
  function riverBand(color, north, south) {
    ctx.fillStyle = color;
    ctx.beginPath();
    river.forEach((p, i) => {
      const y = p.y - p.north * north;
      if (i === 0) ctx.moveTo(p.x, y); else ctx.lineTo(p.x, y);
    });
    for (let i = river.length - 1; i >= 0; i--) {
      const p = river[i];
      ctx.lineTo(p.x, p.y + p.south * south);
    }
    ctx.closePath(); ctx.fill();
  }
  riverBand('#92936c', 1.6, 1.42);
  riverBand('#b9ad87', 1.33, 1.16);
  riverBand('#607d77', 1, 1);
  riverBand('#8ba6a0', .72, .94);
  for (let i = 1; i < river.length - 8; i += rng.int(4, 14)) {
    const dy = rng.range(-1.3, 1.3);
    stroke(river.slice(i, i + rng.int(2, 7)).map(p => ({x:p.x, y:p.y + dy})), '#b8c9b6', .55);
  }
  const road = [{x:-pad,y:world.road[0].y+9}, ...world.road,{x:w+pad,y:world.road.at(-1).y-14}];
  stroke(road,'#827b58',5.3); stroke(road,'#c5ac7b',4.4); stroke(road,'#d7c193',2.6);
  // Crossings follow the intersections in this world. No new traversal rules.
  for (let i=1; i<road.length; i++) {
    const a=road[i-1], b=road[i], steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));
    for (let j=0;j<steps;j++) {
      const x=mix(a.x,b.x,j/steps), y=mix(a.y,b.y,j/steps);
      if (Math.abs(y-terrain.riverY(x)) < 4.8) {
        ctx.save(); ctx.translate(x,y); ctx.rotate(Math.atan2(b.y-a.y,b.x-a.x));
        ctx.fillStyle=j%3 ? '#bfa981':'#796a50'; ctx.fillRect(-.6,-2.6,1.4,5.2); ctx.restore();
      } else if (rng.chance(.34)) { ctx.fillStyle='#a69776'; ctx.fillRect(x,y+rng.range(-1,1),1.2,.55); }
    }
  }
  const stamps = [];
  const add = (kind,x,y,size) => stamps.push({kind,x,y,size,flip:rng.chance(.5)});
  for (const t of vegetation) {
    const patch=noise(t.x/70,t.y/60);
    if (patch < .29) continue;
    const kind=patch>.55 ? 1 : t.height>72 ? 2 : 0;
    add(kind,t.x,t.y,rng.range(14,22)*t.scale);
    if (patch>.65) add(kind,t.x+3,t.y+3,12*t.scale);
  }
  for (let n=0;n<9500;n++) {
    const x=rng.range(-pad,w+pad), y=rng.range(-pad,h+pad);
    if (Math.abs(y-terrain.riverY(x))<12 || distanceToLine(x,y,road)<8 ||
        world.settlements.some(p=>Math.hypot(x-p.x,y-p.y)<18)) continue;
    const inside=x>=0&&x<=w&&y>=0&&y<=h;
    const relief=z[Math.floor((y+pad)*density)*width+Math.floor((x+pad)*density)];
    if (relief>105 && rng.chance(.34)) add(rng.chance(.36)?3:4,x,y,rng.range(9,24));
    else if (!inside && noise(x/53,y/60)>.40) add(rng.int(0,2),x,y,rng.range(12,22));
    else if (rng.chance(.20)) add(5,x,y,rng.range(5,11));
  }
  stamps.sort((a,b)=>a.y-b.y);
  const cell=brushes.width/3;
  for (const {kind,x,y,size,flip} of stamps) {
    if (kind < 3) {
      ctx.fillStyle = 'rgba(51,54,33,.19)'; ctx.beginPath();
      ctx.ellipse(x+size*.16,y+size*.035,size*.31,size*.085,.26,0,Math.PI*2); ctx.fill();
    }
    ctx.save(); ctx.translate(x,y); ctx.scale(flip?-1:1,1);
    ctx.drawImage(brushes,(kind%3)*cell,Math.floor(kind/3)*cell,cell,cell,-size/2,-size*.89,size,size);
    ctx.restore();
  }
  return canvas;
}

export function landscape(seed, world, brushes) {
  let item = cache.get(world);
  if (!item || item.seed !== seed) {
    item = { seed, canvas: paintLandscape(seed, world, brushes) };
    cache.set(world, item);
  }
  return item.canvas;
}

// At any zoom the tactical symbols occupy the same number of CSS pixels.
// Keep a single current symbol per settlement, including its public status.
export function createSymbolCache() {
  const entries = new WeakMap();
  const size = 104, half = size / 2;
  return (ctx, place, key, position, draw) => {
    const dpr = ctx.getTransform().a;
    let entry = entries.get(place);
    if (!entry || entry.key !== key || entry.dpr !== dpr) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.ceil(size * dpr);
      const brush = canvas.getContext('2d');
      brush.scale(canvas.width / size, canvas.height / size);
      draw(brush, half, half);
      entry = { key, dpr, canvas };
      entries.set(place, entry);
    }
    ctx.drawImage(entry.canvas, position.x - half, position.y - half, size, size);
  };
}
