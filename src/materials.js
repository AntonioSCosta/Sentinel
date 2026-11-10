// PBR materials. CC0 photo textures from Poly Haven when the files are present under
// assets/textures/<name>/{color,normal,rough}.jpg; otherwise a procedural fallback (flat colour + roughness).

const PH = slug => `https://polyhaven.com/a/${slug}`;
const files = name => ({ color: `assets/textures/${name}/color.jpg`, normal: `assets/textures/${name}/normal.jpg`, rough: `assets/textures/${name}/rough.jpg` });

/** CC0 sets (all verified as CC0 on their Poly Haven page). `slug` is the Poly Haven asset name. */
export const TEXTURE_SETS = {
  terrain_grass: { source: 'Poly Haven', slug: 'coast_sand_rocks_02', url: PH('coast_sand_rocks_02'), files: files('terrain_grass') },
  terrain_dry:   { source: 'Poly Haven', slug: 'forest_ground_04',    url: PH('forest_ground_04'),    files: files('terrain_dry') },
  terrain_rock:  { source: 'Poly Haven', slug: 'rock_boulder_dry',    url: PH('rock_boulder_dry'),    files: files('terrain_rock') },
  road:          { source: 'Poly Haven', slug: 'rocks_ground_02',     url: PH('rocks_ground_02'),     files: files('road') },
  camp_ground:   { source: 'Poly Haven', slug: 'mud_cracked_dry_03',  url: PH('mud_cracked_dry_03'),  files: files('camp_ground') },
  bark_pine:     { source: 'Poly Haven', slug: 'chinese_cedar_bark',  url: PH('chinese_cedar_bark'),  files: files('bark_pine') },
  bark_oak:      { source: 'Poly Haven', slug: 'bark_platanus',       url: PH('bark_platanus'),       files: files('bark_oak') },
  castro_stone:  { source: 'Poly Haven', slug: 'stone_wall_04',       url: PH('stone_wall_04'),       files: files('castro_stone') },
  wood:          { source: 'Poly Haven', slug: 'raw_plank_wall',      url: PH('raw_plank_wall'),      files: files('wood') },
  iron:          { source: 'Poly Haven', slug: 'rusty_metal_03',      url: PH('rusty_metal_03'),      files: files('iron') },
  leather:       { source: 'Poly Haven', slug: 'leather_white',       url: PH('leather_white'),       files: files('leather') },
};

/** Every material the game uses: fallback colour, roughness, metalness, texture repeat, tint over the photo. */
export const MATERIALS = {
  terrain_grass: { color: 0x5b6b33, rough: .95, repeat: 1 },
  terrain_dry:   { color: 0x8a7a4a, rough: .95, repeat: 1 },
  terrain_rock:  { color: 0x7b756d, rough: .9, repeat: 2 },
  road:          { color: 0x7d6547, rough: .95, repeat: 1 },
  camp_ground:   { color: 0x6c573d, rough: .95, repeat: 1 },
  bark_pine:     { color: 0x4a3426, rough: .95, repeat: 1 },
  bark_oak:      { color: 0x55432f, rough: .95, repeat: 1 },
  castro_stone:  { color: 0x8d8274, rough: .9, repeat: 1.5 },
  wood:          { color: 0x6b4b2e, rough: .85, repeat: 1 },
  iron:          { color: 0x8c9094, rough: .45, metal: .85, repeat: 1, tint: 0xb8b8b8 },
  leather:       { color: 0x5a3b22, rough: .7, repeat: 1, tint: 0x6b4426 },
  // procedural only (no CC0 set verified yet)
  thatch:        { color: 0x9c8146, rough: 1, repeat: 1 },
  canvas:        { color: 0xd2c3a0, rough: .9, repeat: 1 },
  canvas_red:    { color: 0x8e231c, rough: .9, repeat: 1 },
  wool_red:      { color: 0x9a2a20, rough: 1, repeat: 1 },
  wool_brown:    { color: 0x7d5b38, rough: 1, repeat: 1 },
  bronze:        { color: 0xb08a3c, rough: .35, metal: .9, repeat: 1 },
  skin:          { color: 0xc2906c, rough: .75, repeat: 1 },
  mail:          { color: 0x8a8e93, rough: .4, metal: .9, repeat: 1 },   // lorica hamata (procedural rings)
  wool_white:    { color: 0xcdbfa3, rough: 1, repeat: 1 },               // undyed tunic
  feather:       { color: 0x2b1f33, rough: .9, repeat: 1 },              // black/purple plumes (Polybius 6.23)
};

async function tryLoad(loader, url) {
  try { return await loader.loadAsync(url); } catch (_) { return null; }
}

/**
 * @param THREE injected Three.js namespace
 * @param loader object with loadAsync(url) (THREE.TextureLoader) or null for no loading
 * @param quality 'low' | 'medium' | 'high' — low loads colour maps only
 * @returns Promise<Record<name, MeshStandardMaterial>> — always one material per MATERIALS entry
 */
export async function loadMaterials({ THREE, loader, quality = 'medium', anisotropy = 4 }) {
  const out = {};
  await Promise.all(Object.entries(MATERIALS).map(async ([name, def]) => {
    const m = new THREE.MeshStandardMaterial({ color: def.color, roughness: def.rough, metalness: def.metal || 0 });
    const set = TEXTURE_SETS[name];
    if (set && loader) {
      const want = quality === 'low' ? ['color'] : ['color', 'normal', 'rough'];
      const [color, normal, rough] = await Promise.all(['color', 'normal', 'rough'].map(k => want.includes(k) ? tryLoad(loader, set.files[k]) : null));
      const prep = (t, srgb) => { if (!t) return null; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(def.repeat, def.repeat); t.anisotropy = anisotropy; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      if (color) { m.map = prep(color, true); m.color.setHex(def.tint || 0xffffff); }
      m.normalMap = prep(normal, false);
      if (rough) { m.roughnessMap = prep(rough, false); m.roughness = 1; }
    }
    m.name = name;
    out[name] = m;
  }));
  return out;
}

/**
 * Terrain: blends grass / dry ground / rock / road / camp by a per-vertex `splat` attribute (vec4 + camp in a float).
 * Uses world-space UVs so the 420 m terrain tiles cleanly. Falls back to flat colours when maps are missing.
 */
/** Tints over the photo layers so the five ground textures sit together (the dried mud is much paler than the rest). */
const TERRAIN_TINT = { camp_ground: 0x9a8670 };

export function terrainMaterial(THREE, mats) {
  const layers = ['terrain_grass', 'terrain_dry', 'terrain_rock', 'road', 'camp_ground'];
  const m = new THREE.MeshStandardMaterial({ roughness: .95, metalness: 0, vertexColors: false });
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blank.needsUpdate = true;
  const uniforms = {};
  layers.forEach((n, i) => {
    uniforms['uTex' + i] = { value: mats[n].map || blank };
    uniforms['uCol' + i] = { value: mats[n].map ? new THREE.Color(TERRAIN_TINT[n] || 0xffffff) : mats[n].color.clone() };
  });
  uniforms.uScale = { value: new THREE.Vector4(1 / 4, 1 / 5, 1 / 6, 1 / 3) }; // metres per tile (inverse)
  uniforms.uCampScale = { value: 1 / 4 };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nattribute float campW;\nvarying vec4 vSplat;\nvarying float vCamp;\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vCamp = campW; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const decl = layers.map((_, i) => `uniform sampler2D uTex${i}; uniform vec3 uCol${i};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\nuniform vec4 uScale; uniform float uCampScale;\nvarying vec4 vSplat;\nvarying float vCamp;\nvarying vec3 vWPos;`)
      .replace('#include <map_fragment>', `
        vec2 wp = vWPos.xz;
        // two scales of the grass layer hide tiling at a glance
        vec3 g = texture2D(uTex0, wp * uScale.x).rgb * uCol0 * mix(.85, 1.1, texture2D(uTex0, wp * uScale.x * .13).g);
        vec3 d = texture2D(uTex1, wp * uScale.y).rgb * uCol1;
        vec3 r = texture2D(uTex2, wp * uScale.z).rgb * uCol2;
        vec3 rd = texture2D(uTex3, wp * uScale.w).rgb * uCol3;
        vec3 c = texture2D(uTex4, wp * uCampScale).rgb * uCol4;
        vec4 w = max(vSplat, 0.0); float sum = w.x + w.y + w.z + w.w + 1e-4;
        vec3 col = (g * w.x + d * w.y + r * w.z + rd * w.w) / sum;
        col = mix(col, c, clamp(vCamp, 0.0, 1.0));
        diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'terrain-splat-v1';
  return m;
}

/**
 * Procedural mail (interlocking rings) colour + normal map, drawn on a canvas.
 * Returns null where no canvas is available (headless tests).
 */
export function makeMailMaps(THREE, document, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext && c.getContext('2d'); if (!g) return null;
  const n = 16, r = size / n / 2;
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff'; g.lineWidth = r * .55;
  for (let j = -1; j <= n * 2 + 1; j++) for (let i = -1; i <= n + 1; i++) {
    const x = (i + (j % 2 ? .5 : 0)) * 2 * r, y = j * r;
    g.beginPath(); g.arc(x, y, r * .82, 0, Math.PI * 2); g.stroke();
  }
  const h = g.getImageData(0, 0, size, size).data;
  const colour = document.createElement('canvas'); colour.width = colour.height = size;
  const cg = colour.getContext('2d'), cd = cg.createImageData(size, size);
  const normal = document.createElement('canvas'); normal.width = normal.height = size;
  const ng = normal.getContext('2d'), nd = ng.createImageData(size, size);
  const H = (x, y) => h[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4, v = H(x, y);
    const dx = (H(x + 1, y) - H(x - 1, y)) * 2, dy = (H(x, y + 1) - H(x, y - 1)) * 2;
    const l = Math.hypot(dx, dy, 1);
    nd.data[k] = (-dx / l * .5 + .5) * 255; nd.data[k + 1] = (dy / l * .5 + .5) * 255; nd.data[k + 2] = (1 / l * .5 + .5) * 255; nd.data[k + 3] = 255;
    const b = 40 + v * 170; cd.data[k] = b; cd.data[k + 1] = b * 1.02; cd.data[k + 2] = b * 1.06; cd.data[k + 3] = 255;
  }
  cg.putImageData(cd, 0, 0); ng.putImageData(nd, 0, 0);
  const map = new THREE.CanvasTexture(colour), nmap = new THREE.CanvasTexture(normal);
  for (const t of [map, nmap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal: nmap };
}

/** Pine needle tufts drawn on a canvas (no CC0 conifer card was available). */
function needleCanvas(document, size = 512, seed = 3) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext && c.getContext('2d'); if (!g) return null;
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  g.clearRect(0, 0, size, size);
  for (let t = 0; t < 9; t++) {                       // twigs, each with dense needle tufts
    let x = r() * size, y = size * (.85 + r() * .15); const ang = -Math.PI / 2 + (r() - .5) * .9, len = size * (.5 + r() * .4);
    g.strokeStyle = '#4a3624'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, y);
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len; g.lineTo(ex, ey); g.stroke();
    for (let k = 0; k < 70; k++) {
      const f = r(), px = x + (ex - x) * f, py = y + (ey - y) * f;
      for (let n = 0; n < 6; n++) {
        const a = ang + (r() - .5) * 2.6, l = size * (.04 + r() * .05), sh = 70 + r() * 50;
        g.strokeStyle = `rgb(${sh * .45 | 0},${sh | 0},${sh * .38 | 0})`; g.lineWidth = 1.4;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke();
      }
    }
  }
  return c;
}

/**
 * Cut-out foliage materials. oak/shrub use the CC0 Poly Haven leaf cards (assets/textures/foliage/*.png),
 * pine uses procedural needles. Each comes with a depth material so shadows follow the leaf shapes.
 */
export async function loadFoliage({ THREE, loader, document, anisotropy = 4 }) {
  const make = (color, tex) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .85, side: THREE.DoubleSide, alphaTest: .5, map: tex || null });
    if (!tex) m.alphaTest = 0; // no cut-out mask available: plain leaves
    return m;
  };
  const prep = t => { if (!t) return null; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = anisotropy; return t; };
  const [oakT, shrubT] = loader ? await Promise.all(['oak', 'shrub'].map(n => tryLoad(loader, `assets/textures/foliage/${n}_leaves.png`).then(prep))) : [null, null];
  const nc = document && needleCanvas(document);
  const pineT = nc ? prep(new THREE.CanvasTexture(nc)) : null;
  const out = { oak: make(oakT ? 0xffffff : 0x4f6a2c, oakT), shrub: make(shrubT ? 0xffffff : 0x6b7a3a, shrubT), pine: make(pineT ? 0xffffff : 0x2f4a26, pineT) };
  for (const k of ['oak', 'shrub', 'pine']) out[k + 'Depth'] = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: out[k].map, alphaTest: out[k].alphaTest });
  return out;
}
