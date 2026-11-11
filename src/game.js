import { solidAt, TAU, rand, rr, clamp, lerp, smooth, wrapA, setSeed, vnoise, WORLD, roadX, CAMP, CASTRO, heightAt, inCamp, addCol, resolve, losTerrain, clearColliders } from './terrain.js';
import { initAudio, SFX, spatial, setListener } from './audio.js';
import * as C from './combat.js';
import { zoneFromHeight, ZONE_MULT, LEG_SLOW } from './damage.js';
import { decide, REACH } from './ai.js';
import { steer, footwork, playerSpeed } from './locomotion.js';
import { loadMaterials, terrainMaterial, makeMailMaps, loadFoliage, makeGrassMaterial } from './materials.js';
import { createPhysics } from './physics.js';
import { createRender } from './render.js';
import { withTimeout } from './physics.js';
import { sweepHit, capsuleOf, glance, bladeSegment, toWorld, bladeDir } from './swing.js';
import { resolveQuality } from './quality.js';
import { makeRig, driveRig } from './rig.js';
import { followSlot, pickFoe, pickTarget, allyAct, holdSlot, aimGround, allyLook } from './ally.js';

/**
 * Builds the whole game. Rendering, DOM and window are injected so the game can run headless in tests.
 * @returns game API used by boot() and by tools/smoke.mjs
 */
export async function createGame({ THREE, renderer, canvas, document, window, rapier = null, loader = null, quality = 'medium', chars = null }) {
clearColliders();
const $ = id => document.getElementById(id);

/* =========================================================
   Renderer, scene, light
   ========================================================= */
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = 0xcfb894;
scene.fog = new THREE.FogExp2(FOG, .0058);
scene.background = new THREE.Color(FOG);
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, .05, 900);
camera.rotation.order = 'YXZ';
scene.add(camera);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (R) R.resize(window.innerWidth, window.innerHeight); });
let R = null, GRASS = null;

scene.add(new THREE.HemisphereLight(0xc9dcff, 0x5a4630, .62));
const sun = new THREE.DirectionalLight(0xffdcae, 1.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 300 });
sun.shadow.bias = -.0006;
scene.add(sun); scene.add(sun.target);
const SUN_DIR = new THREE.Vector3(-.55, .62, .56).normalize();

// sky dome
{
  const g = new THREE.SphereGeometry(700, 32, 16);
  const pos = g.attributes.position, cols = [];
  const top = new THREE.Color(0x4f7fb4), hor = new THREE.Color(0xe9cf9f), low = new THREE.Color(0xb59b78), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 700;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, .55)); else c.copy(hor).lerp(low, Math.min(1, -y * 4));
    // warm glow toward the sun
    const v = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const s = Math.max(0, v.dot(SUN_DIR)); c.lerp(new THREE.Color(0xffe2b0), Math.pow(s, 8) * .6);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  camera.add(sky); // follows camera
  sky.name = 'sky';
}

/* soft round particle texture */
function makeDotTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext && c.getContext('2d'); if (!g) return null;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const DOT = makeDotTex();

const phys = await createPhysics({ RAPIER: rapier, heightAt, half: WORLD });
const MATS = await loadMaterials({ THREE, loader, quality, anisotropy: renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4 });
const FOL = await loadFoliage({ THREE, loader, document, anisotropy: renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4 });
{ const mm = makeMailMaps(THREE, document); if (mm) { MATS.mail.map = mm.map; MATS.mail.normalMap = mm.normal; MATS.mail.color.setHex(0xffffff); } }
/** A private copy of a shared PBR material (textures stay shared). */
const MAT = (name, extra) => { const m = MATS[name].clone(); if (extra) Object.assign(m, extra); return m; };

/* =========================================================
   Terrain
   ========================================================= */
{
  const SIZE = WORLD * 2 + 20, SEG = 160;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const nor = g.attributes.normal, splat = [], campW = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    const v = vnoise(x * .05, z * .05);
    const rock = clamp(smooth(.86, .66, ny) + smooth(30, 48, y) * .7, 0, 1);
    const dr = Math.abs(x - roadX(z));
    const road = inCamp(x, z, 4) ? 0 : smooth(3.8, 2.2, dr) * .95;
    const castro = Math.hypot(x - CASTRO.x, z - CASTRO.z) < 13 ? .5 : 0;
    const dry = clamp(v * 1.2 - .25 + (y > 20 ? .3 : 0) + castro, 0, 1) * (1 - rock);
    const grass = Math.max(0, 1 - rock - dry - road);
    splat.push(grass, dry, rock, road);
    campW.push(inCamp(x, z, 3) ? .85 : 0);
  }
  g.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4));
  g.setAttribute('campW', new THREE.Float32BufferAttribute(campW, 1));
  const m = new THREE.Mesh(g, terrainMaterial(THREE, MATS));
  m.receiveShadow = true;
  scene.add(m);
}

/* =========================================================
   Vegetation, rocks, castro, Roman camp
   ========================================================= */
const dummy = new THREE.Object3D();
function instanced(geo, mat, list, shadow = true) {
  const im = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((t, i) => { dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0); dummy.scale.set(t.sx || t.s || 1, t.sy || t.s || 1, t.sz || t.s || 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
  im.instanceMatrix.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true;
  scene.add(im); return im;
}
setSeed(777);
{
  const pines = [], oaks = [], rocks = [], grass = [], shrubs = [];
  const blocked = (x, z, m) => Math.abs(x - roadX(z)) < 7 + m || inCamp(x, z, 12 + m) || Math.hypot(x - CASTRO.x, z - CASTRO.z) < 16 + m;
  for (let n = 0; n < 2400 && pines.length + oaks.length < 760; n++) {
    const x = rr(-WORLD + 8, WORLD - 8), z = rr(-WORLD + 8, WORLD - 8);
    if (blocked(x, z, 0)) continue;
    const forest = vnoise(x * .025 + 40, z * .025);
    if (rand() > forest * 1.25) continue;
    const y = heightAt(x, z), s = rr(.8, 1.35);
    if (y > 46) continue;
    if (y > 16 || rand() < .45) pines.push({ x, y, z, s, ry: rr(0, TAU) }); else oaks.push({ x, y, z, s, ry: rr(0, TAU) });
    addCol(x, z, .45 * s);
  }
  for (let n = 0; n < 170; n++) {
    const x = rr(-WORLD + 8, WORLD - 8), z = rr(-WORLD + 8, WORLD - 8);
    if (blocked(x, z, -3)) continue;
    const s = rr(.6, 2.4), y = heightAt(x, z);
    rocks.push({ x, y: y - s * .25, z, s, sy: s * rr(.5, .9), ry: rr(0, TAU), rx: rr(-.3, .3) });
    addCol(x, z, s * .85, s * .55);
  }
  for (let n = 0; n < 14000 && grass.length < 7000; n++) {
    const x = rr(-WORLD + 4, WORLD - 4), z = rr(-WORLD + 4, WORLD - 4);
    if (Math.abs(x - roadX(z)) < 3 || inCamp(x, z, 2)) continue;
    const y = heightAt(x, z); if (y > 30) continue;
    grass.push({ x, y, z, s: rr(.7, 1.4), ry: rr(0, TAU) });
  }
  for (let n = 0; n < 6000 && shrubs.length < 900; n++) {          // mato: low evergreen shrubs, thicker where the forest is
    const x = rr(-WORLD + 6, WORLD - 6), z = rr(-WORLD + 6, WORLD - 6);
    if (blocked(x, z, -4)) continue;
    if (rand() > .25 + vnoise(x * .025 + 40, z * .025)) continue;
    const y = heightAt(x, z); if (y > 40) continue;
    shrubs.push({ x, y: y - .05, z, s: rr(.6, 1.4), sy: rr(.5, 1.1), ry: rr(0, TAU) });
  }
  // maritime pine: tall bare trunk with an umbrella crown; holm/cork oak: short trunk, forked limbs, wide dense crown
  const pineTrunk = new THREE.CylinderGeometry(.16, .3, 8.2, 10); pineTrunk.translate(0, 4.1, 0);
  const oakTrunk = mergeGeos([
    (() => { const g = new THREE.CylinderGeometry(.24, .38, 3.4, 10); g.translate(0, 1.7, 0); return g; })(),
    (() => { const g = new THREE.CylinderGeometry(.1, .2, 2.4, 8); g.translate(0, 1.2, 0); g.rotateZ(.6); g.translate(.2, 3, 0); return g; })(),
    (() => { const g = new THREE.CylinderGeometry(.1, .2, 2.2, 8); g.translate(0, 1.1, 0); g.rotateZ(-.55); g.rotateY(2.1); g.translate(-.1, 3, .1); return g; })(),
  ]);
  instanced(pineTrunk, MAT('bark_pine'), pines);
  instanced(oakTrunk, MAT('bark_oak'), oaks);
  const leafy = (name, geo, mat, depth, list) => { const im = instanced(geo, mat, list); im.name = name; im.customDepthMaterial = depth; return im; };
  leafy('pine-canopy', canopyGeo({ cards: 72, rx: 2.5, ry: 1.3, cy: 8.3, w: 1.15, h: 1, seed: 5, flat: .5 }), FOL.pine, FOL.pineDepth, pines);
  leafy('oak-canopy', canopyGeo({ cards: 54, rx: 3.3, ry: 2.1, cy: 5.3, w: 1.8, h: 1.8, seed: 9 }), FOL.oak, FOL.oakDepth, oaks);
  leafy('shrubs', canopyGeo({ cards: 12, rx: .9, ry: .55, cy: .55, w: 1, h: 1, seed: 13 }), FOL.shrub, FOL.shrubDepth, shrubs);
  instanced(new THREE.DodecahedronGeometry(1, 0), MAT('terrain_rock', { flatShading: true }), rocks);
  const gg = new THREE.PlaneGeometry(.8, .55); gg.translate(0, .27, 0);
  const gg2 = gg.clone(); gg2.rotateY(Math.PI / 2);
  const grassGeo = mergeGeos([gg, gg2]);
  GRASS = instanced(grassGeo, makeGrassMaterial(THREE, document), grass, false); GRASS.name = 'grass';
}
/**
 * A crown made of crossed leaf cards scattered in an ellipsoid. Normals point outward from the crown centre,
 * which lights the cards as one soft rounded mass instead of flat planes.
 */
function canopyGeo({ cards, rx, ry, cy, w, h, seed, flat = 0 }) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const p = new THREE.PlaneGeometry(w * (.8 + r() * .4), h * (.8 + r() * .4));
    p.rotateX((r() - .5) * (1.6 - flat * 1.2)); p.rotateY(r() * Math.PI); p.rotateZ((r() - .5) * .6);
    const a = r() * TAU, rad = Math.sqrt(r()) * .85, yy = (r() * 2 - 1) * (1 - flat * .5);
    p.translate(Math.cos(a) * rx * rad, cy + yy * ry, Math.sin(a) * rx * rad);
    parts.push(p);
  }
  const g = mergeGeos(parts), pos = g.attributes.position, nor = g.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i) / rx, (pos.getY(i) - cy) / ry + .35, pos.getZ(i) / rx).normalize(); nor.setXYZ(i, v.x, v.y, v.z); }
  return g;
}
function mergeGeos(list) {
  const pos = [], nor = [], uv = [];
  for (const g of list) {
    const gi = g.index ? g.toNonIndexed() : g;
    pos.push(...gi.attributes.position.array); nor.push(...gi.attributes.normal.array); uv.push(...gi.attributes.uv.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
const M = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .85 }, extra || {}));
function mesh(geo, mat, x, y, z, parent) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; (parent || scene).add(m); return m; }

// Lusitanian castro (start area)
{
  const stone = MAT('castro_stone'), thatch = MAT('thatch', { flatShading: true });
  const huts = [[-6, -4], [5, -7], [8, 5], [-5, 7]];
  for (const [ox, oz] of huts) {
    const x = CASTRO.x + ox, z = CASTRO.z + oz, y = CASTRO.h;
    mesh(new THREE.CylinderGeometry(2.4, 2.5, 2.1, 14), stone, x, y + 1.05, z);
    mesh(new THREE.ConeGeometry(3.1, 2.6, 14), thatch, x, y + 3.4, z);
    addCol(x, z, 2.6);
  }
  // low ring wall
  const wall = [];
  for (let a = 0; a < TAU; a += .11) {
    if (Math.abs(wrapA(a - Math.PI * 1.25)) < .25) continue; // gate toward the road (west-north-west)
    const x = CASTRO.x + Math.cos(a) * 15, z = CASTRO.z + Math.sin(a) * 15;
    wall.push({ x, y: heightAt(x, z) + .5, z, sx: 1.8, sy: 1.1, sz: 1, ry: -a });
    addCol(x, z, .9);
  }
  instanced(new THREE.BoxGeometry(1, 1, 1), stone, wall);
}

// Roman camp
const supplyTents = [];
const fireLights = [];
{
  const wood = MAT('wood'), canvas = MAT('canvas', { flatShading: true }), red = MAT('canvas_red', { flatShading: true }), crate = MAT('wood');
  const logs = [], H0 = CAMP.h;
  const h = CAMP.half;
  for (let t = -h; t <= h; t += .7) {
    const pts = [[CAMP.x + t, CAMP.z - h], [CAMP.x - h, CAMP.z + t], [CAMP.x + h, CAMP.z + t]];
    if (Math.abs(t) > 4.5) pts.push([CAMP.x + t, CAMP.z + h]); // gate gap on south side
    for (const [x, z] of pts) { const sy = rr(.9, 1.15); logs.push({ x, y: H0 + 1.6 * sy, z, sy, rx: rr(-.05, .05) }); addCol(x, z, .38); }
  }
  instanced(new THREE.CylinderGeometry(.2, .22, 3.2, 6), wood, logs);
  // gate towers
  for (const sx of [-6.2, 6.2]) {
    const x = CAMP.x + sx, z = CAMP.z + h;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mesh(new THREE.BoxGeometry(.25, 6, .25), wood, x + ox, H0 + 3, z + oz);
    mesh(new THREE.BoxGeometry(2.6, .2, 2.6), wood, x, H0 + 4.6, z);
    mesh(new THREE.BoxGeometry(2.6, .9, .12), wood, x, H0 + 5.1, z + 1.25);
    addCol(x, z, 1.6);
  }
  const tentG = new THREE.ConeGeometry(2.1, 2.5, 4); tentG.rotateY(Math.PI / 4); tentG.scale(1.5, 1, 1); tentG.translate(0, 1.25, 0);
  const rows = [-16, -8, 8, 16];
  for (const ox of rows) for (const oz of [-14, -6]) { mesh(tentG, canvas, CAMP.x + ox, H0, CAMP.z + oz); addCol(CAMP.x + ox, CAMP.z + oz, 2.2); }
  // praetorium
  const pg = new THREE.ConeGeometry(5, 4.6, 4); pg.rotateY(Math.PI / 4); pg.translate(0, 2.3, 0);
  mesh(pg, red, CAMP.x, H0, CAMP.z - 18); addCol(CAMP.x, CAMP.z - 18, 4.2);
  // standard
  mesh(new THREE.CylinderGeometry(.06, .06, 6, 6), wood, CAMP.x + 5, H0 + 3, CAMP.z - 12);
  mesh(new THREE.BoxGeometry(1.2, 1.5, .04), red, CAMP.x + 5.6, H0 + 5, CAMP.z - 12);
  mesh(new THREE.BoxGeometry(1.6, .08, .08), M(0xb8913a), CAMP.x + 5.6, H0 + 5.8, CAMP.z - 12);
  // supply tents (objectives)
  const spots = [[-17, 8], [0, 4], [17, 10]];
  for (const [ox, oz] of spots) {
    const x = CAMP.x + ox, z = CAMP.z + oz;
    const mat = MAT('canvas', { flatShading: true });
    const t = mesh(new THREE.ConeGeometry(2.8, 3.2, 4), mat, x, H0 + 1.6, z); t.rotation.y = Math.PI / 4; t.scale.set(1.4, 1, 1);
    for (let k = 0; k < 4; k++) mesh(new THREE.BoxGeometry(.9, .9, .9), crate, x + 3.6 + (k % 2) * 1, H0 + .45 + (k > 1 ? .9 : 0), z - .5 + (k % 2) * .2);
    for (let k = 0; k < 3; k++) mesh(new THREE.CylinderGeometry(.22, .3, .9, 8), M(0xa25a32), x - 3.4, H0 + .45, z - .8 + k * .6);
    const flag = mesh(new THREE.BoxGeometry(.05, 1.2, .9), red, x, H0 + 3.6, z);
    addCol(x, z, 2.8); addCol(x + 4, z, 1);
    const L = new THREE.PointLight(0xff8a3a, 0, 22, 2); L.position.set(x, H0 + 3, z); scene.add(L); fireLights.push(L);
    supplyTents.push({ x, z, mesh: t, mat, flag, burnt: false, light: L, t: 0 });
  }
  // campfire
  const cf = new THREE.PointLight(0xff9a4a, 1.2, 18, 2); cf.position.set(CAMP.x - 4, H0 + 1.2, CAMP.z - 4); scene.add(cf); fireLights.push(cf);
  for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; const s = mesh(new THREE.DodecahedronGeometry(.25), M(0x5a5550), CAMP.x - 4 + Math.cos(a) * .7, H0 + .1, CAMP.z - 4 + Math.sin(a) * .7); }
  CAMP.fire = new THREE.Vector3(CAMP.x - 4, H0 + .3, CAMP.z - 4);
}

/* =========================================================
   Particles
   ========================================================= */
const particles = [];
function makePool(n, additive) {
  const pool = [];
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: DOT, color: 0xffffff, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true });
    const s = new THREE.Sprite(mat); s.visible = false; scene.add(s);
    pool.push({ s, live: false });
  }
  return pool;
}
const POOL_ADD = makePool(160, true), POOL_NORM = makePool(220, false);
function emit(additive, pos, vel, life, size, grow, color, grav, alpha) {
  const pool = additive ? POOL_ADD : POOL_NORM;
  const p = pool.find(q => !q.live); if (!p) return;
  p.live = true; p.s.visible = true; p.s.position.copy(pos); p.vel = vel; p.life = p.max = life; p.size = size; p.grow = grow; p.grav = grav; p.alpha = alpha == null ? 1 : alpha;
  p.s.material.color.setHex(color); p.s.scale.set(size, size, 1);
  particles.push(p);
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function burst(type, pos, n) {
  for (let i = 0; i < n; i++) {
    if (type === 'blood') emit(false, pos, V(rr(-1.5, 1.5), rr(.5, 3), rr(-1.5, 1.5)), rr(.4, .8), .22, .2, 0x6e0e08, 9, .9);
    else if (type === 'dust') emit(false, pos, V(rr(-1, 1), rr(.4, 1.6), rr(-1, 1)), rr(.5, 1.1), .35, 1.4, 0x9a8466, 1, .55);
    else if (type === 'spark') emit(true, pos, V(rr(-4, 4), rr(0, 4), rr(-4, 4)), rr(.15, .35), .12, 0, 0xffd27a, 10, 1);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { p.live = false; p.s.visible = false; particles.splice(i, 1); continue; }
    p.vel.y -= p.grav * dt;
    p.s.position.addScaledVector(p.vel, dt);
    const k = p.life / p.max;
    p.s.material.opacity = p.alpha * Math.min(1, k * 1.6);
    const sz = p.size + p.grow * (1 - k); p.s.scale.set(sz, sz, 1);
  }
}

/* =========================================================
   Soldier models (original low-poly)
   ========================================================= */
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function makeSoldier(kind) {
  const mats = [];
  const mm = (name, extra) => { const m = MAT(name, extra); mats.push(m); return m; };
  const tunic = mm(kind === 'velite' || kind === 'lusitano' ? 'wool_brown' : 'wool_red'), armor = mm('iron'), skin = mm('skin'),
        helm = mm(kind === 'centurion' ? 'bronze' : 'iron'), metal = mm('iron', { roughness: .3 }), leather = mm('leather'),
        shieldM = mm(kind === 'velite' ? 'leather' : 'canvas_red', { side: THREE.DoubleSide }), gold = mm('bronze'),
        crestM = mm('wool_red'), fur = mm('wool_brown'), wood = mm('wood');
  // Mid-Republican (Polybian) kit: most men a bronze pectorale, the wealthier a mail shirt; centurions in mail.
  const lus = kind === 'lusitano';
  const armour = kind === 'velite' || lus ? 'none' : kind === 'centurion' ? 'hamata' : (rand() < .45 ? 'hamata' : 'pectorale');
  const mail = armour === 'hamata' ? mm('mail') : null, feather = mm('feather', { side: THREE.DoubleSide });
  if (kind === 'legio' && rand() < .5) tunic.color.copy(MATS.wool_white.color);
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  root.userData.armour = armour;
  const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; (p || root).add(o); return o; };
  const grp = (x, y, z, p) => { const g = new THREE.Group(); g.position.set(x, y, z); (p || root).add(g); return g; };
  const CAP = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
  // Model faces +z, so its right side is −x. Index 1 = right limb (sword arm).
  const legs = [], knees = [];
  for (const sx of [.12, -.12]) {
    const hip = grp(sx, .92, 0);
    add(CAP(.075, .3), skin, 0, -.22, 0, hip);
    const knee = grp(0, -.45, 0, hip);
    add(CAP(.062, .26), skin, 0, -.17, .01, knee);
    add(new THREE.CylinderGeometry(.075, .085, .16, 12), leather, 0, -.37, .02, knee);
    add(new THREE.BoxGeometry(.12, .06, .24), leather, 0, -.44, .05, knee);
    if (kind !== 'velite' && !lus && (sx > 0 || kind === 'centurion')) { // ocrea: one greave, on the leading left leg
      const gr = add(new THREE.CylinderGeometry(.082, .07, .3, 12, 1, true, -Math.PI * .6, Math.PI * 1.2), gold, 0, -.19, .005, knee);
      gr.material = gold; gr.name = 'greave'; gr.material.side = THREE.DoubleSide;
    }
    legs.push(hip); knees.push(knee);
  }
  const skirt = new THREE.CylinderGeometry(.28, .33, .28, 20, 1, true); skirt.scale(1, 1, .75);
  add(skirt, tunic, 0, .95, 0).material.side = THREE.DoubleSide;
  if (armour === 'hamata') { const ms = new THREE.CylinderGeometry(.31, .345, .24, 20, 1, true); ms.scale(1, 1, .76); add(ms, mail, 0, .87, 0).material.side = THREE.DoubleSide; }
  // spine: everything above the hips twists and leans with the blow
  const spine = grp(0, .95, 0); spine.rotation.order = 'YXZ';
  const torso = new THREE.CylinderGeometry(.25, .28, .62, 20); torso.scale(1, 1, .72);
  add(torso, tunic, 0, .35, 0, spine);
  if (lus) { const lc = new THREE.CylinderGeometry(.262, .29, .5, 20, 1, true); lc.scale(1, 1, .74); add(lc, mm('wool_white', { color: new THREE.Color(0xa8977a) }), 0, .4, 0, spine).material.side = THREE.DoubleSide; } // linen corslet (Strabo 3.3.6)
  if (armour === 'hamata') {             // lorica hamata to the hips, with doubled shoulders (humeralia)
    const shirt = new THREE.CylinderGeometry(.272, .305, .72, 20, 1, true); shirt.scale(1, 1, .76);
    add(shirt, mail, 0, .3, 0, spine).material.side = THREE.DoubleSide;
    for (const sx of [-1, 1]) { const h = new THREE.CylinderGeometry(.1, .16, .12, 12, 1, true); const o = add(h, mail, sx * .2, .63, 0, spine); o.rotation.z = sx * .55; o.material.side = THREE.DoubleSide; }
  } else if (armour === 'pectorale') {    // square bronze chest and back plates on leather straps
    add(new THREE.BoxGeometry(.21, .21, .014), gold, 0, .44, .2, spine).name = 'pectorale';
    add(new THREE.BoxGeometry(.21, .21, .014), gold, 0, .44, -.2, spine).name = 'pectorale-back';
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(.035, .02, .42), leather, sx * .12, .64, 0, spine);
  }
  const belt = new THREE.TorusGeometry(.27, .025, 6, 24); belt.rotateX(Math.PI / 2); belt.scale(1, 1, .76);
  add(belt, leather, 0, .11, 0, spine);
  const head = grp(0, .71, 0, spine);
  add(new THREE.CylinderGeometry(.06, .07, .1, 10), skin, 0, .03, 0, head);
  const hg = new THREE.SphereGeometry(.12, 14, 10); hg.scale(.95, 1.1, 1); add(hg, skin, 0, .18, .01, head);
  add(new THREE.ConeGeometry(.025, .06, 6), skin, 0, .17, .125, head).rotation.x = Math.PI / 2;
  if (lus) { // sinew/leather cap with three crests
    add(new THREE.SphereGeometry(.142, 16, 10, 0, Math.PI * 2, 0, Math.PI * .5), leather, 0, .2, 0, head);
    for (const z of [-.06, 0, .06]) { const c = new THREE.BoxGeometry(.02, .07, .16); add(c, crestM, z, .34, 0, head); }
  } else if (kind === 'velite') {
    add(new THREE.SphereGeometry(.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * .62), fur, 0, .2, -.02, head);
    add(new THREE.ConeGeometry(.16, .3, 12, 1, true), fur, 0, .02, -.12, head).rotation.x = .5;
  } else {
    // Montefortino: bronze bowl, crest knob, small flared brim (wider at the neck), three-disc cheek pieces, plumes
    const bowl = new THREE.SphereGeometry(.142, 16, 10, 0, Math.PI * 2, 0, Math.PI * .55); bowl.scale(1, 1.18, 1.06);
    add(bowl, gold, 0, .19, 0, head).name = 'montefortino';
    const brim = new THREE.CylinderGeometry(.15, .175, .03, 18, 1, true); brim.translate(0, 0, -.012); add(brim, gold, 0, .2, 0, head).material.side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(.012, .022, .05, 8), gold, 0, .37, 0, head).name = 'knob';
    add(new THREE.SphereGeometry(.018, 8, 6), gold, 0, .4, 0, head);
    const plume = grp(0, .41, 0, head); plume.name = 'feathers';
    const n = kind === 'centurion' ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const f = new THREE.PlaneGeometry(.04, kind === 'centurion' ? .22 : .3); f.translate(0, kind === 'centurion' ? .11 : .15, 0);
      const o = add(f, feather, 0, 0, 0, plume);
      if (kind === 'centurion') { o.rotation.x = (i / (n - 1) - .5) * 1.6; o.rotation.y = Math.PI / 2; } else { o.rotation.z = (i - 1) * .2; o.rotation.y = (i - 1) * .4; }
    }
    for (const sx of [-1, 1]) {
      const cheek = grp(sx * .128, 0, 0, head); cheek.name = 'cheek';
      for (const [y, z] of [[.17, .075], [.17, .015], [.11, .045]]) add(new THREE.CylinderGeometry(.032, .032, .008, 10), gold, 0, y, z, cheek).rotation.z = Math.PI / 2;
    }
  }
  // arms: shoulder → upper arm, elbow → forearm, hand
  const arms = [], elbows = [];
  for (const sx of [.34, -.34]) {
    const sh = grp(sx, .61, 0, spine);
    add(CAP(.058, .2), kind === 'velite' ? skin : armor, 0, -.15, 0, sh);
    const el = grp(0, -.3, 0, sh);
    add(CAP(.05, .18), skin, 0, -.12, 0, el);
    add(new THREE.CylinderGeometry(.055, .055, .08, 10), leather, 0, -.18, 0, el);
    add(new THREE.SphereGeometry(.05, 10, 8), skin, 0, -.28, 0, el);
    arms.push(sh); elbows.push(el);
  }
  const hand = grp(0, -.3, 0, elbows[1]);
  if (lus) {
    // falcata: forward-curved single-edged blade, hooked hilt; held along the forearm line (−y)
    const fs = new THREE.Shape(); fs.moveTo(0, 0); fs.lineTo(.04, 0); fs.quadraticCurveTo(.1, .24, .072, .44); fs.quadraticCurveTo(.05, .53, -.008, .56);
    fs.quadraticCurveTo(.0, .42, -.018, .32); fs.quadraticCurveTo(-.022, .16, 0, 0);
    const fg = new THREE.ExtrudeGeometry(fs, { depth: .006, bevelEnabled: true, bevelThickness: .003, bevelSize: .004, bevelSegments: 2, curveSegments: 10 });
    fg.translate(-.02, 0, -.003);
    const fal = grp(0, 0, 0, hand); fal.name = 'falcata';
    add(fg, metal, 0, -.06, 0, fal).rotation.x = Math.PI;
    add(new THREE.CylinderGeometry(.016, .016, .1, 10), wood, 0, .02, 0, fal);
    add(new THREE.TorusGeometry(.04, .01, 6, 12, Math.PI * 1.2), gold, .02, .07, 0, fal).rotation.z = Math.PI * .4;
    root.userData.bladeLength = .56;
    // caetra: small round concave shield (~0.6 m) with a central boss
    const pg = grp(.34, .2, .3, spine); root.userData.parma = pg; pg.name = 'caetra';
    const dome = new THREE.SphereGeometry(.5, 24, 6, 0, Math.PI * 2, 0, .64); dome.rotateX(Math.PI / 2); dome.translate(0, 0, -.42);
    add(dome, leather, 0, 0, 0, pg).material.side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 0, .07, pg).rotation.x = Math.PI / 2;
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; add(new THREE.SphereGeometry(.014, 6, 4), gold, Math.cos(a) * .2, Math.sin(a) * .2, .03, pg); }
  } else if (kind === 'velite') {
    const jv = add(new THREE.CylinderGeometry(.015, .015, 1.5, 6), wood, 0, 0, .25, hand); jv.rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.03, .16, 8), metal, 0, 0, 1.06, hand).rotation.x = Math.PI / 2;
    const pg = grp(.36, .2, .28, spine); root.userData.parma = pg; // the IK grips this group
    add(new THREE.CylinderGeometry(.36, .36, .04, 28), shieldM, 0, 0, 0, pg).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(.36, .015, 6, 28), metal, 0, 0, .02, pg);
    add(new THREE.SphereGeometry(.07, 12, 8), metal, 0, 0, .03, pg);
  } else {
    // gladius continues the line of the forearm (−y), so the blade follows the swing arc
    // gladius hispaniensis: ~0.64 m blade, slight waist, long tapering point
    const bs = new THREE.Shape(); bs.moveTo(-.026, 0); bs.lineTo(.026, 0); bs.lineTo(.022, .3); bs.lineTo(.026, .44); bs.lineTo(0, .64); bs.lineTo(-.026, .44); bs.lineTo(-.022, .3); bs.closePath();
    root.userData.bladeLength = .64;
    const bg = new THREE.ExtrudeGeometry(bs, { depth: .008, bevelEnabled: true, bevelThickness: .003, bevelSize: .004, bevelSegments: 2, curveSegments: 4 });
    bg.translate(0, 0, -.004);
    add(bg, metal, 0, -.06, 0, hand).rotation.x = Math.PI;
    add(new THREE.BoxGeometry(.12, .035, .045), gold, 0, -.04, 0, hand);
    add(new THREE.CylinderGeometry(.016, .016, .1, 10), wood, 0, .02, 0, hand);
    add(new THREE.SphereGeometry(.03, 12, 8), gold, 0, .08, 0, hand);
    const sc = grp(.3, .17, .32, spine);
    // oval, curved scutum (≈1.15 × 0.68 m) with a vertical wooden spina and an iron umbo
    const W = .68, HH = 1.15, R = .62, bend = x => -(R - Math.sqrt(R * R - x * x));
    const pg = new THREE.PlaneGeometry(W, HH, 12, 20), pa = pg.attributes.position;
    for (let v = 0; v < pa.count; v++) {
      let x = pa.getX(v), y = pa.getY(v); const e = (x / (W / 2)) ** 2 + (y / (HH / 2)) ** 2;
      if (e > 1) { const k = 1 / Math.sqrt(e); x *= k; y *= k; }
      pa.setXYZ(v, x, y, bend(x));
    }
    pg.computeVertexNormals();
    add(pg, shieldM, 0, 0, 0, sc).name = 'scutum-oval';
    const back = pg.clone(); back.translate(0, 0, -.012); add(back, wood, 0, 0, 0, sc).material.side = THREE.BackSide;
    const rimPts = []; for (let t = 0; t < 40; t++) { const a = t / 40 * Math.PI * 2, x = Math.cos(a) * W / 2; rimPts.push(new THREE.Vector3(x, Math.sin(a) * HH / 2, bend(x))); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts, true), 40, .01, 4, true), gold, 0, 0, 0, sc);
    add(new THREE.BoxGeometry(.05, HH * .9, .025), wood, 0, 0, .012, sc).name = 'spina';
    const umbo = new THREE.SphereGeometry(.085, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); umbo.rotateX(Math.PI / 2); umbo.scale(1, 1.4, 1);
    add(umbo, metal, 0, 0, .025, sc).name = 'umbo';
    root.userData.scutum = sc;
  }
  return { root, legs, knees, arms, elbows, spine, head, mats, skin };
}

/* Rigged soldier: the Quaternius body and animation clips, wearing the kit built above on its bones. */
const HAND_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
function rigSoldier(kind, look = null) {
  const p = makeSoldier(kind), ud = p.root.userData, lus = kind === 'lusitano';
  const shield = ud.scutum || ud.parma;
  const white = p.mats[0].color.equals(MATS.wool_white.color);
  const outfit = look ? look.outfit : lus ? (rand() < .5 ? 'lusitano' : 'lusitano_b') : kind === 'velite' ? 'velite' : ud.armour === 'hamata' ? 'roman_mail' : white ? 'roman_white' : 'roman_red';
  const hair = look ? look.hair : lus ? ['hair_long', 'hair_beard'] : kind === 'velite' ? ['hair_beard'] : [];
  const rig = makeRig(THREE, chars.clone, chars, { outfit, hair, shielded: !!shield, tint: rr(.86, 1.05), hairColor: look ? look.hairColor : [0x2a1d14, 0x3b2a1e, 0x1c1410, 0x4a3524][Math.floor(rand() * 4)] });
  // helmet / cap: everything on the old head except the skin
  const hk = new THREE.Group();
  for (const o of [...p.head.children]) if (!(o.isMesh && o.material === p.skin)) hk.add(o);
  hk.position.set(0, 1.5, -.005); hk.scale.setScalar(.88); if (!look || look.cap) rig.attach('Head', hk);
  // weapon in the right fist: blade out past the thumb, edges along the fingers
  const hand = p.elbows[1].children.at(-1), wpn = new THREE.Group(); wpn.name = 'weapon';
  for (const o of [...hand.children]) wpn.add(o);
  wpn.quaternion.setFromRotationMatrix(HAND_BASIS); wpn.position.set(-.03, .085, 0);
  rig.bones.hand_r.add(wpn);
  // shield gripped in the left fist, placed for the shield-guard pose
  if (shield) {
    shield.parent.remove(shield); rig.root.add(shield); shield.rotation.set(0, 0, 0);
    // centre the board on the fist in the guard pose, a hand's breadth in front of it
    const SH = { scutum: [.02, -.02, .07], parma: [.0, 0, .05] }[ud.scutum ? 'scutum' : 'parma'];
    rig.poseAt('Idle_Shield_Loop', 1); const hp = rig.bones.hand_l.getWorldPosition(new THREE.Vector3()).sub(rig.root.position);
    shield.position.set(hp.x + SH[0], hp.y + SH[1], hp.z + SH[2]);
    rig.attachInPose('hand_l', shield, 'Idle_Shield_Loop', 1);
  }
  // body armour plates and the greave
  const plates = []; p.root.traverse(o => { if (o.name === 'pectorale' || o.name === 'pectorale-back') plates.push(o); });
  for (const o of plates) { o.parent.remove(o); o.position.set(0, 1.33, o.name === 'pectorale' ? .14 : -.17); o.scale.set(.9, .9, 1); rig.attach('spine_03', o); }
  const gr = []; p.root.traverse(o => { if (o.name === 'greave') gr.push(o); });
  gr.forEach((o, i) => { o.parent.remove(o); o.position.set(i ? -.114 : .114, .33, -.035); o.scale.set(.82, 1.05, .82); rig.attach(i ? 'calf_r' : 'calf_l', o); });
  // leather belt with a bronze buckle (a pugio on the Romans' left hip), tied to the waist bone so it turns with the body
  const bMat = MAT('leather'), gMat = MAT('iron', { metalness: .8, roughness: .45 }), sMat = MAT('leather');
  bMat.color.setHex(lus ? 0x4a3524 : 0x3a2616); gMat.color.setHex(lus ? 0x8a6d3b : 0xb8893c); sMat.color.setHex(0x2c1c10);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(1, .02, 6, 32).rotateX(Math.PI / 2).scale(.18, 1, .142), bMat); belt.position.set(0, 1.0, -.028);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(.045, .05, .012), gMat); buckle.position.set(0, 1.0, .118);
  const bg = new THREE.Group(); bg.add(belt, buckle);
  if (!lus && kind !== 'velite') {
    const sheath = new THREE.Mesh(new THREE.BoxGeometry(.035, .2, .02), sMat); sheath.position.set(.14, .9, .06); sheath.rotation.z = -.12;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .07, 6), gMat); hilt.position.set(.15, 1.04, .06); bg.add(sheath, hilt);
  }
  bg.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  rig.attach('spine_01', bg);
  let skirtMat = null;
  if (lus) {   // Lusitanian kilt-like skirt (saia) of wool, hanging from the hips to mid-thigh; follows the pelvis
    skirtMat = new THREE.MeshStandardMaterial({ color: { lusitano: 0x46341f, lusitano_b: 0x46341f, lusitano_c: 0x96682c, lusitano_d: 0x605440 }[outfit] || 0x46341f, roughness: .95, side: THREE.DoubleSide });
    const sk = new THREE.Group();
    sk.add(new THREE.Mesh(new THREE.CylinderGeometry(.185, .275, .36, 28, 1, true).translate(0, .82, 0), skirtMat));
    const hem = new THREE.Mesh(new THREE.TorusGeometry(.275, .012, 5, 28).rotateX(Math.PI / 2).translate(0, .64, 0), skirtMat.clone()); hem.material.color.multiplyScalar(.6); sk.add(hem);
    sk.scale.set(1, 1, .86); sk.traverse(o => { if (o.isMesh) o.castShadow = true; });
    rig.attach('pelvis', sk);
  }
  Object.assign(rig.root.userData, ud);
  const mats = [...new Set([...rig.mats, ...p.mats, bMat, gMat, sMat, ...(skirtMat ? [skirtMat] : [])])];
  return { root: rig.root, rig, mats, weapon: wpn };
}
const soldier = (kind, look) => { const m = chars ? rigSoldier(kind, look) : makeSoldier(kind); if (look) m.root.scale.setScalar(look.scale); return m; };

/* =========================================================
   Viewmodel (first-person weapons)
   ========================================================= */
const VM = new THREE.Group(); camera.add(VM);
const vmMat = (c) => new THREE.MeshStandardMaterial({ color: c === 0xd9d4c8 ? 0x8f969d : c, roughness: c === 0xd9d4c8 ? .35 : .6, metalness: c === 0xd9d4c8 || c === 0xcfc9bb ? .85 : 0, fog: false });
function vmMesh(g, c, x, y, z, p) { const m = new THREE.Mesh(g, vmMat(c)); m.position.set(x, y, z); (p || VM).add(m); return m; }
// falcata
const FAL = new THREE.Group(); VM.add(FAL);
{
  const sh = new THREE.Shape();
  sh.moveTo(0, 0); sh.lineTo(.045, 0); sh.quadraticCurveTo(.12, .26, .085, .52); sh.quadraticCurveTo(.06, .62, -.01, .66);
  sh.quadraticCurveTo(.0, .5, -.02, .38); sh.quadraticCurveTo(-.025, .2, 0, 0);
  const bg = new THREE.ExtrudeGeometry(sh, { depth: .006, bevelEnabled: true, bevelThickness: .004, bevelSize: .005, bevelSegments: 2, curveSegments: 14 });
  const blade = vmMesh(bg, 0xd9d4c8, -.03, .07, -.006, FAL);
  vmMesh(BOX(.05, .15, .045), 0x4a2f1c, 0, -.02, 0, FAL);
  const hook = vmMesh(new THREE.TorusGeometry(.05, .012, 6, 10, Math.PI * 1.2), 0x9a8a6a, .02, -.08, 0, FAL); hook.rotation.z = Math.PI * .6;
  vmMesh(BOX(.11, .1, .1), 0xb98a68, 0, -.04, .02, FAL); // fist
}
FAL.userData.base = { x: .34, y: -.36, z: -.55, rx: -.25, ry: -.2, rz: -.35 };
// shield (caetra)
const SHD = new THREE.Group(); VM.add(SHD);
{
  const d = vmMesh(new THREE.CylinderGeometry(.34, .34, .035, 24), 0x5b3a20, 0, 0, 0, SHD); d.rotation.x = Math.PI / 2;
  const r = vmMesh(new THREE.TorusGeometry(.34, .018, 6, 24), 0xa8834a, 0, 0, .01, SHD);
  const b = vmMesh(new THREE.SphereGeometry(.08, 12, 8, 0, TAU, 0, Math.PI / 2), 0xb89150, 0, 0, .02, SHD); b.rotation.x = Math.PI / 2;
  for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; vmMesh(new THREE.SphereGeometry(.018, 6, 4), 0xc9a560, Math.cos(a) * .22, Math.sin(a) * .22, .02, SHD); }
}
SHD.userData.idle = { x: -.56, y: -.56, z: -.7, ry: .55 };
SHD.scale.setScalar(.72); FAL.scale.setScalar(.85);
SHD.userData.block = { x: -.12, y: -.24, z: -.42, ry: .05 };
SHD.userData.bash = { x: -.1, y: -.26, z: -.7, ry: 0 };
const STUCK = [0, 1, 2].map(i => { const g = new THREE.Group(); const sh = vmMesh(new THREE.CylinderGeometry(.008, .008, .7, 5), 0x6e5032, 0, 0, .35, g); sh.rotation.x = Math.PI / 2; g.position.set(-.12 + i * .11, .06 - i * .09, .02); g.rotation.set(.25 - i * .2, .3 - i * .25, 0); g.visible = false; SHD.add(g); return g; });
const UP = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler();
const VM_SHOULDER = [.24, -.3, -.12];               // where the sword arm hinges, in camera space
// an enemy cut from HIS left arrives on YOUR right: mirror for the warning arrow and the guard
const MIRROR = { left: 'right', right: 'left', up: 'up', thrust: 'thrust' };
// first-person falcata poses: p = position, r = rotation (x,y,z)
const FAL_POSE = {
  idle: { p: [.36, -.42, -.6], r: [-.35, -.2, -.3] },
  wind_up: { p: [.3, -.05, -.42], r: [.9, -.1, -.2] }, wind_left: { p: [-.1, -.18, -.5], r: [-.2, .2, 1.25] },
  wind_right: { p: [.5, -.16, -.42], r: [-.2, -.3, -1.35] }, wind_thrust: { p: [.26, -.3, -.22], r: [-1.5, 0, 0] },
  hit_up: { p: [.1, -.48, -.62], r: [-1.6, 0, -.1] }, hit_left: { p: [.42, -.3, -.6], r: [-.3, -.3, -1.4] },
  hit_right: { p: [-.15, -.3, -.6], r: [-.3, .3, 1.3] }, hit_thrust: { p: [.12, -.24, -.85], r: [-1.55, 0, 0] },
  block_up: { p: [.05, -.12, -.5], r: [0, 0, 1.5] }, block_left: { p: [-.12, -.2, -.5], r: [0, .3, .2] },
  block_right: { p: [.3, -.2, -.5], r: [0, -.3, -.2] }, block_thrust: { p: [.08, -.24, -.48], r: [0, 0, .9] },
  stagger: { p: [.42, -.5, -.45], r: [-.6, -.4, -.6] },
};
// javelin
const JAV = new THREE.Group(); VM.add(JAV);
{
  const s = vmMesh(new THREE.CylinderGeometry(.012, .012, 1.4, 6), 0x6e5032, 0, 0, -.2, JAV); s.rotation.x = Math.PI / 2;
  const t = vmMesh(new THREE.ConeGeometry(.025, .16, 6), 0xcfc9bb, 0, 0, -.98, JAV); t.rotation.x = -Math.PI / 2;
  vmMesh(BOX(.1, .1, .12), 0xb98a68, 0, -.03, .1, JAV);
}
JAV.userData.base = { x: .26, y: -.16, z: -.35 };
// sling
const SLG = new THREE.Group(); VM.add(SLG);
const SLGpouch = new THREE.Group(); SLG.add(SLGpouch);
{
  vmMesh(BOX(.1, .1, .1), 0xb98a68, 0, 0, 0, SLG);
  const c1 = vmMesh(new THREE.CylinderGeometry(.004, .004, .34, 4), 0xcbb48a, 0, -.17, 0, SLGpouch);
  vmMesh(new THREE.SphereGeometry(.035, 8, 6), 0x5a3d26, 0, -.34, 0, SLGpouch);
}
SLG.userData.base = { x: .3, y: -.2, z: -.5 };

/* =========================================================
   Game state
   ========================================================= */
const DIFF = [{ dmg: .55, detect: .7, name: 'Fácil' }, { dmg: 1, detect: 1, name: 'Normal' }, { dmg: 1.45, detect: 1.35, name: 'Difícil' }];
let diff = 1, sens = .0024;
const WNAMES = ['Falcata', 'Dardos', 'Funda'];
let state = 'menu';
const P = { f: C.createFighter(), pos: new THREE.Vector3(), vy: 0, yaw: 0, pitch: 0, hp: 100, ground: true, crouch: 0, w: 0, dardos: 0, pedras: 0,
  atk: 0, cd: 0, kills: 0, shots: 0, hits: 0, heads: 0, time: 0, stepT: 0, bob: 0, swing: 0, throwT: 0, hurtT: 0 };
let enemies = [], projectiles = [], pickups = [], allies = [], companions = 3;
let forcedDir = null; // tests pin the blow direction
// orders for the companions: 'follow' (Z), 'hold' at the flag (X, then click), 'charge' (T)
let order = 'follow', placing = false; const flagAt = { x: 0, z: 0, yaw: 0 };
const FLAG = new THREE.Group(), FLAG_MATS = [];
{
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x6e5032, roughness: .8, transparent: true })); pole.position.y = 1.3;
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.8, .5), new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: .9, side: THREE.DoubleSide, transparent: true, emissive: 0x30100a })); cloth.position.set(.42, 2.3, 0);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.5, .62, 24), new THREE.MeshBasicMaterial({ color: 0xe8c36a, transparent: true, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .06;
  FLAG.add(pole, cloth, ring); FLAG_MATS.push(pole.material, cloth.material, ring.material); FLAG.visible = false; scene.add(FLAG);
}
function setFlagLook(preview) { for (const m of FLAG_MATS) m.opacity = preview ? .55 : 1; }
function giveOrder(o) {
  if (state !== 'play') return;
  if (!allies.some(a => !a.dead)) { showPrompt('Não tens companheiros vivos', 1.2); return; }
  if (o === 'hold') { placing = !placing; if (placing) showPrompt('Aponta e clica para pôr a bandeira (X cancela)', 2.5); else FLAG.visible = order === 'hold'; return; }
  placing = false; order = o; FLAG.visible = false;
  feed(o === 'follow' ? 'Ordem: sigam-me!' : 'Ordem: ao ataque!'); SFX.horn && o === 'charge' && SFX.grunt();
}
function aimPoint() { const d = V(0, 0, -1).applyQuaternion(camera.quaternion); return aimGround(camera.position, d, heightAt, 90); }
function placeFlag() {
  const g = aimPoint(); if (!g) { showPrompt('Aponta para o chão', 1); return false; }
  flagAt.x = g.x; flagAt.z = g.z; flagAt.yaw = Math.atan2(g.x - P.pos.x, g.z - P.pos.z);
  FLAG.position.set(g.x, g.y, g.z); FLAG.rotation.y = flagAt.yaw; FLAG.visible = true; setFlagLook(false);
  placing = false; order = 'hold'; feed('Ordem: para a bandeira!'); return true;
}
function updateFlag() {
  if (!placing) return;
  const g = aimPoint(); FLAG.visible = !!g; setFlagLook(true);
  if (g) { FLAG.position.set(g.x, g.y, g.z); FLAG.rotation.y = Math.atan2(g.x - P.pos.x, g.z - P.pos.z); }
}
let mission = 0, tentsBurnt = 0, missionMsgT = 0, alarm = false;
Object.defineProperty(P, 'st', { get() { return P.f.stamina; }, set(v) { P.f.stamina = v; }, enumerable: false });
Object.defineProperty(P, 'block', { get() { return P.f.blocking != null; }, enumerable: false });
const keys = {}; let mouseL = false, mouseR = false;
let view = 'third'; // M&B-style over-the-shoulder by default; V toggles first person

function resetWorld() {
  // clear dynamic objects
  for (const e of enemies) { scene.remove(e.m.root); if (e.corpse) phys.removeCorpse(e.corpse); }
  for (const a of allies) scene.remove(a.m.root);
  allies = []; order = 'follow'; placing = false; FLAG.visible = false;
  for (const p of projectiles) phys.remove(p.pid);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  enemies = []; projectiles = []; pickups = [];
  for (const p of particles) { p.live = false; p.s.visible = false; } particles.length = 0;
  for (const t of supplyTents) { t.burnt = false; t.t = 0; t.mat.color.setHex(0xc9b68c); t.light.intensity = 0; t.flag.visible = true; }
  setSeed(4242);
  endT = 0; endArgs = null;
  Object.assign(P, { throwPending: 0, throwKind: null, f: C.createFighter(), charging: false, chargeT: 0, acc: { x: 0, y: 0 }, intent: C.createIntent(), post: { x: 0, y: 0 }, prevL: false, swingDir: null, bashCd: 0, bashT: 0, cleanT: 0,
    lastDefense: null, incomingDir: null, vel: { x: 0, z: 0 }, push: null, kick: 0, swingHits: new Set(), vy: 0, hp: 100, ground: true, crouch: 0, w: 0, dardos: 5, pedras: 12, atk: 0, cd: 0,
    kills: 0, shots: 0, hits: 0, heads: 0, time: 0, swing: 0, throwT: 0, hurtT: 0 });
  P.pos.set(CASTRO.x - 8, 0, CASTRO.z - 8); P.pos.y = heightAt(P.pos.x, P.pos.z);
  P.yaw = Math.PI * .28; P.pitch = -.05;
  mission = 0; tentsBurnt = 0; alarm = false;
  for (let i = 0; i < companions; i++) spawnAlly(i);
  // patrol on the road, marching south
  const col = ['legio', 'legio', 'velite', 'legio', 'legio', 'velite', 'legio', 'legio'];
  col.forEach((k, i) => { const z = -18 - i * 3.2; spawn(k, roadX(z) + (i % 2 ? 1 : -1), z, 'patrol'); });
  // camp garrison
  const guards = [[-10, 0], [10, -2], [-3, -10], [12, 14], [-12, 16], [3, 14]];
  for (const [ox, oz] of guards) spawn('legio', CAMP.x + ox, CAMP.z + oz, 'camp');
  spawn('legio', CAMP.x - 3, CAMP.z + CAMP.half + 2, 'camp'); spawn('legio', CAMP.x + 3, CAMP.z + CAMP.half + 2, 'camp');
  spawn('velite', CAMP.x - 9, CAMP.z + CAMP.half + 6, 'camp'); spawn('velite', CAMP.x + 9, CAMP.z + CAMP.half + 5, 'camp');
  spawn('velite', CAMP.x, CAMP.z - 6, 'camp');
  // pickups
  addPickup('dardos', CASTRO.x - 4, CASTRO.z + 1); addPickup('pedras', CASTRO.x + 2, CASTRO.z + 2); addPickup('odre', CASTRO.x + 1, CASTRO.z - 3);
  const route = [[roadX(70) + 14, 70], [roadX(20) - 16, 20], [roadX(-40) + 15, -40], [roadX(-80) - 14, -80], [roadX(-100) + 18, -100]];
  route.forEach(([x, z], i) => addPickup(i % 2 ? 'odre' : 'dardos', x, z));
  addPickup('pedras', roadX(-60) - 20, -60); addPickup('odre', CAMP.x + 20, CAMP.z + CAMP.half + 10);
  setObjective();
}

function spawn(kind, x, z, group) {
  const m = soldier(kind === 'legio' ? 'legio' : kind);
  scene.add(m.root);
  const stats = { legio: { hp: 100, sp: 3.9, dmg: 13 }, velite: { hp: 65, sp: 3.7, dmg: 15 }, centurion: { hp: 460, sp: 4.4, dmg: 24 } }[kind];
  const e = { kind, m, pos: new THREE.Vector3(x, heightAt(x, z), z), hp: stats.hp, maxhp: stats.hp, sp: stats.sp, dmg: stats.dmg,
    state: group === 'patrol' ? 'march' : group === 'boss' ? 'chase' : 'guard', group, yaw: Math.PI, home: new THREE.Vector3(x, 0, z),
    dir: -1, aware: 0, atkT: 0, f: C.createFighter({ shieldHP: kind === 'velite' ? 0 : 220, stamina: kind === 'centurion' ? 140 : 100 }), aiT: rr(0, .3), act: 'approach', vel: { x: 0, z: 0 }, dodgeRoll: 1, mv: { x: 0, z: 0 }, releaseAt: 0, feintAt: 0, blockLeft: 0, slowT: 0, cd: rr(.5, 1.5), ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, wander: null, wT: 0, strafe: rand() < .5 ? 1 : -1, moving: 0, barkT: 0 };
  if (group === 'patrol') { e.yaw = 0; e.dir = 1; } // marching south (+z)
  enemies.push(e); return e;
}

/** One of Viriato's companions: follows him, joins the fight once the Romans are fighting. */
function spawnAlly(i) {
  const m = soldier('lusitano', allyLook(i)); scene.add(m.root);
  const s = followSlot(i, P.pos, flatFwd());
  const a = { kind: 'lusitano', ally: true, m, pos: new THREE.Vector3(s.x, heightAt(s.x, s.z), s.z), yaw: P.yaw + Math.PI, hp: 110, f: C.createFighter(), state: 'follow', i,
    vel: { x: 0, z: 0 }, mv: { x: 0, z: 0 }, aiT: rr(0, .3), blockLeft: 0, releaseAt: 0, stride: 0, ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, hits: 0, crouch: false, swingHits: new Set() };
  m.root.position.copy(a.pos); m.root.rotation.y = a.yaw;
  allies.push(a); return a;
}

function addPickup(type, x, z, y) {
  const g = new THREE.Group();
  if (type === 'odre') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(.28, 10, 8), M(0x6b4426)); b.scale.set(1, .8, .7); g.add(b);
    const n = new THREE.Mesh(new THREE.CylinderGeometry(.05, .08, .2, 6), M(0x4a2e18)); n.position.y = .26; g.add(n);
  } else if (type === 'dardos' || type === 'dardo1') {
    const n = type === 'dardos' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1.5, 5), M(0x6e5032)); s.rotation.z = Math.PI / 2 + (i - 1) * .12; s.position.y = i * .05; g.add(s);
      const t = new THREE.Mesh(new THREE.ConeGeometry(.04, .16, 5), M(0xcfc9bb)); t.rotation.z = -Math.PI / 2; t.position.set(.8, i * .05 - (i - 1) * .1, 0); g.add(t);
    }
  } else {
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(new THREE.DodecahedronGeometry(.09), M(0x8a857c)); s.position.set(rr(-.2, .2), rr(0, .12), rr(-.2, .2)); g.add(s); }
    const bag = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6), M(0x5a3d26)); bag.scale.y = .6; g.add(bag);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const p = { type, mesh: g, x, z, y: y == null ? heightAt(x, z) + .5 : y, spin: type !== 'dardo1', t: rr(0, 6) };
  g.position.set(x, p.y, z); scene.add(g); pickups.push(p); return p;
}

/* =========================================================
   Missions
   ========================================================= */
const MISSIONS = [
  { m: 'I · A EMBOSCADA', t: () => `Embosca a patrulha romana na estrada do vale (${patrolLeft()} restantes)` },
  { m: 'II · OS MANTIMENTOS', t: () => `Incendeia as tendas de mantimentos do acampamento (${tentsBurnt}/3)` },
  { m: 'III · O CENTURIÃO', t: () => 'Mata o centurião' },
];
const patrolLeft = () => enemies.filter(e => e.group === 'patrol' && !e.dead).length;
function setObjective() { $('objm').textContent = MISSIONS[mission].m; $('objt').textContent = MISSIONS[mission].t(); }
function showMsg(title, sub, dur = 3.2) { $('msg').innerHTML = ''; const s = document.createElement('span'); s.textContent = title; $('msg').appendChild(s); if (sub) { const sm = document.createElement('small'); sm.textContent = sub; $('msg').appendChild(sm); } $('msg').style.opacity = 1; missionMsgT = dur; }
function feed(text) {
  const d = document.createElement('div'); d.textContent = text; $('feed').prepend(d);
  setTimeout(() => { d.style.opacity = 0; }, 3500); setTimeout(() => d.remove(), 4200);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
}
function checkMission() {
  if (mission === 0 && patrolLeft() === 0) {
    mission = 1; setObjective();
    showMsg('A patrulha caiu', 'O acampamento romano fica a norte, ao fundo da estrada.');
  } else if (mission === 1 && tentsBurnt === 3) {
    mission = 2; setObjective();
    const b = spawn('centurion', CAMP.x, CAMP.z - 13, 'boss');
    for (const [ox, oz] of [[-3, -12], [3, -12], [-5, -15], [5, -15]]) spawn('legio', CAMP.x + ox, CAMP.z + oz, 'boss');
    SFX.horn();
    showMsg('O centurião sai da tenda', 'Derruba-o e o acampamento cairá.');
  } else if (mission === 2) {
    const c = enemies.find(e => e.kind === 'centurion');
    if (c && c.dead) win();
  }
  if (mission < 3) $('objt').textContent = MISSIONS[mission].t();
}
function raiseAlarm() {
  if (alarm) return; alarm = true; SFX.horn();
  for (const e of enemies) if (!e.dead && e.group === 'camp') alert(e);
  feed('O acampamento deu o alarme!');
}

/* =========================================================
   Input
   ========================================================= */
const cv = canvas;
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (state !== 'play') return;
  if (e.code === 'Digit1') selectW(0); if (e.code === 'Digit2') selectW(1); if (e.code === 'Digit3') selectW(2);
  if (e.code === 'KeyE') use();
  if (e.code === 'KeyF') bash();
  if (e.code === 'KeyV') view = view === 'third' ? 'first' : 'third';
  if (e.code === 'KeyR') cleanShield();
  if (e.code === 'KeyZ') giveOrder('follow'); if (e.code === 'KeyX') giveOrder('hold'); if (e.code === 'KeyT') giveOrder('charge');
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('mousemove', e => {
  if (state !== 'play' || document.pointerLockElement !== cv) return;
  P.yaw -= e.movementX * sens; P.pitch = clamp(P.pitch - e.movementY * sens, -1.45, 1.45);
  C.nudgeIntent(P.intent, e.movementX, e.movementY);
  if (P.charging) { P.acc.x += e.movementX; P.acc.y += e.movementY; }
  if (P.f.phase === 'windup' && !P.f.released) { P.post.x += e.movementX; P.post.y += e.movementY; }
});
window.addEventListener('mousedown', e => {
  if (state !== 'play') return;
  if (document.pointerLockElement !== cv) { lock(); return; }
  if (e.button === 0) mouseL = true; if (e.button === 2) mouseR = true;
});
window.addEventListener('mouseup', e => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('wheel', e => { if (state === 'play') selectW((P.w + (e.deltaY > 0 ? 1 : 2)) % 3); }, { passive: true });
function lock() { try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === cv) { if (resumePending && state === 'pause') finishResume(); }
  else if (state === 'play') pauseGame();
});
document.addEventListener('pointerlockerror', lockRefused);
function selectW(w) { if (w === P.w) return; P.w = w; P.swing = 0; P.charging = false; C.feint(P.f); C.endBlock(P.f); P.throwT = 0; P.cd = Math.max(P.cd, .3); updateHUDWeapon(); }

/* =========================================================
   Player actions
   ========================================================= */
const tmpV = new THREE.Vector3();
function fwd3() { const cp = Math.cos(P.pitch); return tmpV.set(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp).clone(); }
function eyePos() { return V(P.pos.x, P.pos.y + 1.68 - P.crouch * .6, P.pos.z); }
function makeNoise(r) { for (const e of enemies) if (!e.dead && e.state !== 'chase' && e.state !== 'skirmish' && e.pos.distanceTo(P.pos) < r) alert(e); }

function attack() {
  if (P.cd > 0 || P.block) return;
  if (P.w === 0) return;
  if (P.throwPending) return;
  if (P.w === 1) {
    if (P.dardos <= 0) { showPrompt('Sem dardos — apanha-os do chão', 1.2); return; }
    P.dardos--; P.cd = .85; P.throwT = 1; P.throwKind = 'javelin'; P.throwPending = .32; SFX.throwJ();
  } else {
    if (P.pedras <= 0) { showPrompt('Sem pedras para a funda', 1.2); return; }
    P.pedras--; P.cd = .75; P.throwT = 1; P.throwKind = 'sling'; P.throwPending = .5; SFX.sling();
  }
  updateHUDWeapon();
}
/** World position of Viriato's throwing hand (third person) or a point beside the eye (first person). */
function throwOrigin() {
  if (view === 'third') { AV.root.updateMatrixWorld(true); return AV_HAND.getWorldPosition(V(0, 0, 0)); }
  const f = fwd3(), right = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  return eyePos().addScaledVector(right, .22).add(V(0, -.08, 0)).addScaledVector(f, .5);
}
/** Release at the end of the wind-up: from the hand, aimed at what the crosshair points at. */
function releaseThrow() {
  const kind = P.throwKind, from = throwOrigin();
  const camFwd = V(0, 0, -1).applyQuaternion(camera.quaternion);
  const aim = camera.position.clone().addScaledVector(camFwd, 70);
  const dir = aim.sub(from).normalize();
  const vel = kind === 'javelin' ? dir.multiplyScalar(36).add(V(0, 1.4, 0)) : dir.multiplyScalar(50).add(V(0, .8, 0));
  spawnProj(kind === 'javelin' ? 'javelin' : 'stone', from, vel, 'player');
  P.shots++; makeNoise(kind === 'javelin' ? 16 : 11);
}
const deg = r => r * 180 / Math.PI;
const flatFwd = () => V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
/** Player falcata strike lands (called from the fighter's 'strike' event). */
const playerFacing = () => P.yaw + Math.PI; // swing.js convention: forward = (sin, cos)
/** The blade met a tree, log or wall before anyone: it bounces off. Checks the tip of the arc segment. */
function bladeBounced(pos, facing, dir, p) {
  const tip = toWorld(bladeSegment(dir, p).tip, pos, facing);
  return solidAt(tip.x, tip.z, tip.y - heightAt(tip.x, tip.z));
}
/** Player falcata: called every tick of the arc with the progress span [p0, p1]. */
function playerSwing(ev) {
  if (state !== 'play') return;
  if (ev.p0 === 0) { P.swingHits = new Set(); P.swing = 1; P.swingDir = ev.dir; SFX.swing(); }
  const facing = playerFacing();
  if (bladeBounced(P.pos, facing, ev.dir, ev.p1)) { C.stopBlade(P.f); SFX.clank(.7); P.kick = .12; showPrompt('A lâmina bateu num obstáculo', .7); return; }
  const f = flatFwd();
  for (const e of enemies) {
    if (e.dead || P.swingHits.has(e)) continue;
    if (Math.abs(e.pos.x - P.pos.x) > 4 || Math.abs(e.pos.z - P.pos.z) > 4) continue;
    const r = sweepHit(P.pos, facing, ev.dir, ev.p0, ev.p1, capsuleOf(e.pos));
    if (!r.hit) continue;
    P.swingHits.add(e);
    const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z).normalize();
    const ef = V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    const fromAngle = deg(Math.acos(clamp(ef.dot(d.clone().negate()), -1, 1)));
    const unaware = e.state === 'march' || e.state === 'guard';
    // speed bonus: running into the blow hits harder (relative closing speed)
    const ev2 = e.vel || { x: 0, z: 0 }, closing = (P.vel.x - ev2.x) * d.x + (P.vel.z - ev2.z) * d.z;
    const bonus = clamp(1 + closing * .08, .8, 1.5);
    const at = V(r.at.x, r.at.y, r.at.z);
    if (unaware && fromAngle > 90) { damageEnemy(e, 40 * C.DMG[ev.dir] * ev.power * 3.5, false, at, 'golpe furtivo'); hitStop(.07); continue; }
    const res = C.resolveHit(e.f, { dir: ev.dir, power: ev.power * glance(r.p) * bonus, fromAngle, baseDamage: 40 });
    if (res.result === 'parried') { C.stopBlade(P.f); C.stagger(P.f, res.attackerStagger); SFX.clank(); burst('spark', at, 12); showPrompt('O romano aparou o teu golpe!', .9); P.kick = .2; alert(e); return; }
    if (res.result === 'blocked') { C.stopBlade(P.f); SFX.clank(); burst('spark', at, 8); e.flash = .05; P.kick = .12; knock(e, d, .6); alert(e); return; }
    const hRel = clamp((r.at.y - e.pos.y) / 1.85, 0, 1), zone = zoneFromHeight(hRel);
    if (res.result === 'guardBroken') feed('Quebraste-lhe a guarda');
    if (zone === 'legs') e.slowT = LEG_SLOW.time;
    const g = glance(r.p);
    if (g < .55) showPrompt('De raspão', .5);
    damageEnemy(e, res.damage * ZONE_MULT[zone], zone === 'head', at);
    knock(e, d, 1.2 + ev.power); hitStop(.05 + .04 * g); P.kick = .08;
    alert(e);
  }
  if (ev.p1 >= 1) makeNoise(P.swingHits.size ? 14 : 6); // the swish is heard once the blow is done
}
/** Push a soldier back a little (he also flinches via resolveHit). */
function knock(e, d, strength) { if (!e.vel) e.vel = { x: 0, z: 0 }; e.vel.x += d.x * strength * 2; e.vel.z += d.z * strength * 2; }
let hitStopT = 0;
function hitStop(t) { hitStopT = Math.max(hitStopT, t); }
/** F: shield bash interrupts an enemy windup and knocks them back. */
function bash() {
  if (state !== 'play' || P.w === 2 || P.f.shieldHP <= 0 || P.f.stamina < 20 || P.f.phase !== 'idle' || P.bashCd > 0) return;
  P.f.stamina -= 20; P.bashCd = .9; P.bashT = .25; SFX.thud();
  const f = flatFwd();
  for (const e of enemies) {
    if (e.dead) continue;
    const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z), dist = d.length();
    if (dist > 2.4) continue; d.normalize(); if (d.dot(f) < .5) continue;
    if (e.f.phase === 'windup') { C.feint(e.f); feed('Empurrão! Golpe interrompido'); }
    C.endBlock(e.f); C.stagger(e.f, .6);
    e.pos.addScaledVector(d, .8); alert(e);
  }
}
/** R: pull stuck javelins out of the caetra. */
function cleanShield() { if (state === 'play' && P.f.stuckJavelins > 0 && P.cleanT <= 0) { P.cleanT = 1.2; showPrompt('A arrancar os dardos do escudo…', 1.2); } }
/** A Roman blow lands (enemy fighter 'strike' event). */
/** A Roman blade travelling its arc: hits only if it actually passes through the player. */
function enemySwing(e, ev) {
  if (ev.p0 === 0) { e.swingHit = false; SFX.swing(); }
  if (e.swingHit || state !== 'play') return;
  if (bladeBounced(e.pos, e.yaw, ev.dir, ev.p1)) { C.stopBlade(e.f); SFX.clank(spatial(e.pos) * .7); return; }
  const a = e.T && e.T.ally;
  if (a) {                               // the blow is aimed at a companion
    if (a.dead) return;
    const ra = sweepHit(e.pos, e.yaw, ev.dir, ev.p0, ev.p1, capsuleOf(a.pos));
    if (!ra.hit) return;
    e.swingHit = true;
    const da = V(a.pos.x - e.pos.x, 0, a.pos.z - e.pos.z).normalize(), af = V(Math.sin(a.yaw), 0, Math.cos(a.yaw));
    const res = C.resolveHit(a.f, { dir: ev.dir, power: ev.power * glance(ra.p), fromAngle: deg(Math.acos(clamp(af.dot(da.clone().negate()), -1, 1))), baseDamage: e.dmg });
    const at = V(ra.at.x, ra.at.y, ra.at.z);
    if (res.result === 'parried' || res.result === 'blocked') { C.stopBlade(e.f); if (res.attackerStagger) C.stagger(e.f, res.attackerStagger); SFX.clank(spatial(a.pos)); burst('spark', at, 8); return; }
    if (res.damage > 0) hurtAlly(a, res.damage, at);
    return;
  }
  const r = sweepHit(e.pos, e.yaw, ev.dir, ev.p0, ev.p1, capsuleOf(P.pos, .32, 1.75 - P.crouch * .55));
  if (!r.hit) return;
  e.swingHit = true;
  const dd = V(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z).normalize();
  const fromAngle = deg(Math.acos(clamp(flatFwd().dot(dd.clone().negate()), -1, 1)));
  const res = C.resolveHit(P.f, { dir: ev.dir, power: ev.power * glance(r.p), fromAngle, baseDamage: e.dmg * DIFF[diff].dmg });
  P.lastDefense = res.result;
  const spark = V(r.at.x, r.at.y, r.at.z);
  if (res.result === 'parried') { C.stopBlade(e.f); C.stagger(e.f, res.attackerStagger); SFX.clank(); burst('spark', spark, 14); showPrompt('Aparo perfeito!', .8); hitStop(.08); return; }
  if (res.result === 'blocked') { C.stopBlade(e.f); SFX.clank(); burst('spark', spark, 8); P.shake = .18; P.push = { x: dd.x * 1.5, z: dd.z * 1.5 }; return; }
  if (res.result === 'guardBroken') showPrompt('Guarda quebrada!', 1);
  if (res.damage > 0) { hurtPlayer(res.damage, e.pos); burst('blood', spark, 4); P.push = { x: dd.x * 2.5, z: dd.z * 2.5 }; P.kick = .25; hitStop(.05); }
}
function hurtAlly(a, dmg, at) {
  a.hp -= dmg; a.hits++; a.heavy = dmg >= 30; a.flash = .15; burst('blood', at, 6); SFX.flesh(spatial(a.pos));
  if (a.hp <= 0) { a.dead = true; a.deadT = 0; C.endBlock(a.f); SFX.die(spatial(a.pos)); feed('Um companheiro tombou'); }
}
/** A companion's falcata travelling its arc. */
function allySwing(a, ev) {
  if (ev.p0 === 0) { a.swingHits = new Set(); SFX.swing(spatial(a.pos)); }
  if (bladeBounced(a.pos, a.yaw, ev.dir, ev.p1)) { C.stopBlade(a.f); return; }
  for (const e of enemies) {
    if (e.dead || a.swingHits.has(e) || Math.abs(e.pos.x - a.pos.x) > 4 || Math.abs(e.pos.z - a.pos.z) > 4) continue;
    const r = sweepHit(a.pos, a.yaw, ev.dir, ev.p0, ev.p1, capsuleOf(e.pos));
    if (!r.hit) continue;
    a.swingHits.add(e);
    const d = V(e.pos.x - a.pos.x, 0, e.pos.z - a.pos.z).normalize(), ef = V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    const res = C.resolveHit(e.f, { dir: ev.dir, power: ev.power * glance(r.p), fromAngle: deg(Math.acos(clamp(ef.dot(d.clone().negate()), -1, 1))), baseDamage: 26 });
    const at = V(r.at.x, r.at.y, r.at.z);
    if (res.result === 'parried' || res.result === 'blocked') { C.stopBlade(a.f); if (res.attackerStagger) C.stagger(a.f, res.attackerStagger); SFX.clank(spatial(a.pos)); burst('spark', at, 8); return; }
    damageEnemy(e, res.damage, false, at, null, true); knock(e, d, 1);
  }
}
function updateAllies(dt) {
  const pf = flatFwd(), sprinting = Math.hypot(P.vel.x, P.vel.z) > 6;
  for (const a of allies) {
    const r = a.m.root;
    if (a.dead) {
      a.deadT += dt; a.mv.x = a.mv.z = 0;
      if (a.m.rig) setPose(a, dt); else if (a.deadT < 1) { r.rotation.x = -Math.PI / 2 * smooth(0, .7, a.deadT); r.position.y = a.pos.y + .15 * smooth(0, .7, a.deadT); }
      for (const m of a.m.mats) m.emissive.setRGB(0, 0, 0);
      continue;
    }
    const px0 = a.pos.x, pz0 = a.pos.z;
    if (a.flash > 0) a.flash -= dt; a.ph += dt;
    const fl = Math.max(0, a.flash) * 4; for (const m of a.m.mats) m.emissive.setRGB(fl * .6, 0, 0);
    const near = Math.hypot(P.pos.x - a.pos.x, P.pos.z - a.pos.z) < 32;
    const post = order === 'hold' ? holdSlot(a.i, flagAt, flagAt.yaw) : null;
    // follow: fight what is already fighting near Viriato; hold: defend the post; charge: go for any Roman
    const foe = state !== 'play' ? null : order === 'charge' ? pickFoe(a.pos, enemies, 60, true)
      : order === 'hold' ? (Math.hypot(a.pos.x - post.x, a.pos.z - post.z) < 12 ? pickFoe(post, enemies, 7) : null)
      : near ? pickFoe(a.pos, enemies, 22) : null;
    if (foe && foe.state !== 'chase' && foe.state !== 'skirmish' && foe.pos.distanceTo(a.pos) < 10) alert(foe);
    let want = { x: 0, z: 0 };
    if (foe) {
      a.state = 'chase'; a.crouch = false;
      const dx = foe.pos.x - a.pos.x, dz = foe.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      faceTo(a, foe.pos.x, foe.pos.z, dt, a.f.phase === 'windup' ? 3.5 : 7);
      a.aiT -= dt; a.blockLeft -= dt;
      if (a.f.phase === 'idle') { const wb = a.blockLeft > 0 && a.f.shieldHP > 0; if (wb && !a.f.blocking) C.beginBlock(a.f, 'shield'); else if (!wb && a.f.blocking) C.endBlock(a.f); }
      if (a.aiT <= 0 && a.f.phase === 'idle') {
        a.aiT = .3;
        const act = allyAct({ dist: d, foePhase: foe.f.phase, rng: rand });
        if (act === 'block') a.blockLeft = rr(.5, .8);
        else if (act === 'attack' && a.blockLeft <= 0) { C.endBlock(a.f); const dir = C.randomDir(a.lastDir, rand); if (C.beginAttack(a.f, dir)) { a.lastDir = dir; a.releaseAt = C.WINDUP[dir] + rr(0, .2); } }
      }
      if (a.f.phase === 'windup' && !a.f.released && a.f.t >= a.releaseAt) C.releaseAttack(a.f);
      const sp = d > REACH ? Math.min(4.6, Math.max(.8, (d - REACH) * 3)) * (a.f.blocking ? .6 : 1) : d < 1.1 ? -1.4 : a.f.phase === 'windup' ? .9 : 0;
      want = { x: dx / d * sp, z: dz / d * sp };
      for (const ev of C.tickFighter(a.f, dt)) if (ev.type === 'swing') allySwing(a, ev);
      sampleTrail(a, a.pos, a.yaw, a.f);
    } else {
      a.state = 'follow'; if (a.f.blocking) C.endBlock(a.f); if (a.f.phase === 'windup') C.feint(a.f);
      C.tickFighter(a.f, dt);
      a.crouch = !post && P.crouch > .5;
      const s = post || followSlot(a.i, P.pos, pf), dx = s.x - a.pos.x, dz = s.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 70 && !post) { a.pos.x = s.x; a.pos.z = s.z; a.vel.x = a.vel.z = 0; }
      else if (d > (a.moving ? .5 : 1.6)) {
        a.moving = true; const sp = Math.min(a.crouch ? 2.4 : sprinting || d > 9 ? 8 : 4.6, d * 2.2); want = { x: dx / d * sp, z: dz / d * sp };
        // blocked by a wall, hut or tree: slide round it for a moment
        if (sp > 1.5 && Math.hypot(a.mv.x, a.mv.z) < .6) a.stuckT = (a.stuckT || 0) + dt; else a.stuckT = 0;
        if (a.stuckT > .5) { a.detourT = 1.3; a.detour = a.detour ? -a.detour : (a.i % 2 ? 1 : -1); a.stuckT = 0; }
        if (a.detourT > 0) { a.detourT -= dt; want = { x: (-dz / d * a.detour * .9 + dx / d * .3) * sp, z: (dx / d * a.detour * .9 + dz / d * .3) * sp }; }
        faceTo(a, a.pos.x + want.x, a.pos.z + want.z, dt, 5);
      }
      else { a.moving = false; if (post) faceTo(a, a.pos.x + Math.sin(flagAt.yaw), a.pos.z + Math.cos(flagAt.yaw), dt, 3); else faceTo(a, a.pos.x + pf.x, a.pos.z + pf.z, dt, 3); }
    }
    a.vel = steer(a.vel, want, 12, dt);
    a.pos.x += a.vel.x * dt; a.pos.z += a.vel.z * dt;
    for (const o of allies) { if (o === a || o.dead) continue; const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 1.3 && d > 1e-3) { a.pos.x += dx / d * (1.3 - d) * .5; a.pos.z += dz / d * (1.3 - d) * .5; } }
    for (const o of enemies) { if (o.dead) continue; const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz); if (d < 1.0 && d > 1e-3) { a.pos.x += dx / d * (1 - d); a.pos.z += dz / d * (1 - d); } }
    { const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, d = Math.hypot(dx, dz); if (d < 1.1 && d > 1e-3) { a.pos.x += dx / d * (1.1 - d); a.pos.z += dz / d * (1.1 - d); } }
    resolve(a.pos, .4); a.pos.y = heightAt(a.pos.x, a.pos.z);
    if (dt > 1e-4) { const k = Math.min(1, dt * 12); a.mv.x = lerp(a.mv.x, (a.pos.x - px0) / dt, k); a.mv.z = lerp(a.mv.z, (a.pos.z - pz0) / dt, k); }
    const bob = setPose(a, dt);
    r.position.set(a.pos.x, a.pos.y + bob, a.pos.z); r.rotation.y = a.yaw;
  }
}
function use() {
  for (const t of supplyTents) {
    if (t.burnt) continue;
    if (Math.hypot(t.x - P.pos.x, t.z - P.pos.z) < 5) {
      t.burnt = true; t.t = 0; tentsBurnt++; SFX.fire();
      t.light.intensity = 2.2; t.flag.visible = false;
      feed('Mantimentos em chamas');
      if (mission < 1) { mission = 1; }
      raiseAlarm(); checkMission(); setObjective();
      return;
    }
  }
}

/* =========================================================
   Projectiles
   ========================================================= */
const javGeo = (() => { const s = new THREE.CylinderGeometry(.018, .018, 1.4, 5); s.rotateX(Math.PI / 2); return s; })();
const javTip = (() => { const t = new THREE.ConeGeometry(.035, .16, 5); t.rotateX(Math.PI / 2); t.translate(0, 0, .78); return t; })();
function spawnProj(type, pos, vel, owner, dmg) {
  let mesh;
  if (type === 'javelin') { mesh = new THREE.Group(); const a = new THREE.Mesh(javGeo, M(0x6e5032)); const b = new THREE.Mesh(javTip, M(0xcfc9bb)); a.castShadow = b.castShadow = true; mesh.add(a, b); }
  else { mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(.06), M(0x8a857c)); }
  mesh.position.copy(pos); scene.add(mesh);
  projectiles.push({ type, mesh, pid: phys.addProjectile(pos, vel, type), spawn: pos.clone(), vel0: vel.clone(), pos: pos.clone(), prev: pos.clone(), vel, owner, dmg: dmg || 0, life: 7, stuck: false, stuckT: 0 });
}
function segSphere(a, b, c, r) { // closest-point distance from segment ab to c < r
  const ab = tmpV.copy(b).sub(a); const t = clamp(V(c.x - a.x, c.y - a.y, c.z - a.z).dot(ab) / (ab.lengthSq() || 1), 0, 1);
  const px = a.x + ab.x * t, py = a.y + ab.y * t, pz = a.z + ab.z * t;
  return (px - c.x) ** 2 + (py - c.y) ** 2 + (pz - c.z) ** 2 < r * r;
}
function updateProjectiles(dt) {
  const groundHits = new Map(phys.step(dt).map(h => [h.id, h]));
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (p.stuck) { p.stuckT -= dt; if (p.stuckT <= 0) { scene.remove(p.mesh); projectiles.splice(i, 1); } continue; }
    p.life -= dt;
    p.prev.copy(p.pos);
    const landed = groundHits.get(p.pid);
    const np = landed ? landed.pos : phys.getPos(p.pid), nv = landed ? landed.vel : phys.getVel(p.pid);
    if (np) { p.pos.set(np.x, np.y, np.z); p.vel.set(nv.x, nv.y, nv.z); }
    p.mesh.position.copy(p.pos);
    if (p.type === 'javelin') p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
    else p.mesh.rotation.x += dt * 20;
    let done = false;
    if (p.owner === 'player') {
      for (const e of enemies) {
        if (e.dead) continue;
        const ex = e.pos.x, ey = e.pos.y, ez = e.pos.z;
        if (Math.abs(ex - p.pos.x) > 3 || Math.abs(ez - p.pos.z) > 3) continue;
        const head = V(ex, ey + 1.86, ez);
        const isHead = segSphere(p.prev, p.pos, head, .2);
        const isBody = isHead ? false : (segSphere(p.prev, p.pos, V(ex, ey + 1.3, ez), .4) || segSphere(p.prev, p.pos, V(ex, ey + .75, ez), .36));
        if (!isHead && !isBody) continue;
        // scutum block (front-facing, not attacking)
        const toProj = V(p.prev.x - ex, 0, p.prev.z - ez).normalize();
        const ef = V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        const fromAngle = deg(Math.acos(clamp(ef.dot(toProj), -1, 1)));
        if (e.f.blocking === 'shield' && fromAngle <= C.SHIELD_ARC) {
          SFX.clank(spatial(p.pos)); burst('spark', p.pos, 8); feed('Bloqueado pelo escudo');
          if (p.type === 'javelin') addPickup('dardo1', ex + toProj.x * 1.2, ez + toProj.z * 1.2);
          done = true; break;
        }
        const base = p.type === 'javelin' ? 82 : 32;
        const unaware = e.state === 'march' || e.state === 'guard';
        damageEnemy(e, base * (isHead ? (p.type === 'stone' ? 2.6 : 2) : 1) * (unaware ? 1.4 : 1), isHead, p.pos.clone());
        P.hits++;
        done = true; break;
      }
    } else {
      const c = V(P.pos.x, P.pos.y + 1.1 - P.crouch * .4, P.pos.z);
      if (segSphere(p.prev, p.pos, c, .55)) { damagePlayer(p.dmg, p.prev, true); done = true; }
    }
    if (!done) {
      if (landed || p.pos.y < heightAt(p.pos.x, p.pos.z) - .5) {
        p.pos.y = heightAt(p.pos.x, p.pos.z) + .02; p.mesh.position.copy(p.pos);
        burst('dust', p.pos, 4); SFX.thud(spatial(p.pos) * .6);
        if (p.type === 'javelin') {
          if (p.owner === 'player') { scene.remove(p.mesh); const k = addPickup('dardo1', p.pos.x, p.pos.z, p.pos.y + .1); k.mesh.rotation.y = Math.atan2(p.vel.x, p.vel.z) + Math.PI / 2; k.mesh.rotation.z = -.5; projectiles.splice(i, 1); continue; }
          p.stuck = true; p.stuckT = 6; continue;
        }
        done = true;
      }
    }
    if (done || p.life <= 0) { phys.remove(p.pid); scene.remove(p.mesh); projectiles.splice(i, 1); }
  }
}

/* =========================================================
   Damage
   ========================================================= */
let hitmT = 0, dmgT = 0;
function damageEnemy(e, dmg, head, where, special, byAlly) {
  e.hp -= dmg; e.flash = .15; e.hits = (e.hits || 0) + 1; e.heavy = dmg >= 45; burst('blood', where, head ? 14 : 8);
  SFX.flesh(); alert(e);
  if (!byAlly) { hitmT = .18; $('hitm').className = head ? 'head' : ''; $('hitm').style.opacity = 1; if (head) P.heads++; }
  if (e.hp <= 0) {
    e.dead = true; e.deadT = 0; if (!byAlly) P.kills++; SFX.die(spatial(e.pos));
    { const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z).normalize(); e.corpse = phys.addCorpse(e.pos, e.yaw, { x: d.x, y: .3, z: d.z }); }
    const name = { legio: 'Legionário', velite: 'Vélite', centurion: 'Centurião' }[e.kind];
    feed(`${name} abatido${byAlly ? ' por um companheiro' : special ? ' — ' + special : head ? ' — na cabeça' : ''}`);
    if (e.kind !== 'centurion' && rand() < .4) addPickup(rand() < .5 ? 'odre' : (rand() < .5 ? 'dardos' : 'pedras'), e.pos.x + rr(-.6, .6), e.pos.z + rr(-.6, .6));
    // the fallen alert their comrades
    for (const o of enemies) if (!o.dead && o.pos.distanceTo(e.pos) < 22) alert(o);
    checkMission();
  } else { if (rand() < .5) SFX.grunt(spatial(e.pos)); }
}
function damagePlayer(dmg, from, ranged) {
  if (state !== 'play') return;
  P.hitsTaken = (P.hitsTaken || 0) + 1;
  if (ranged && from !== P.pos) {
    const dd = V(from.x - P.pos.x, 0, from.z - P.pos.z).normalize();
    const fromAngle = deg(Math.acos(clamp(flatFwd().dot(dd), -1, 1)));
    const res = C.resolveHit(P.f, { dir: 'left', power: 1, fromAngle, baseDamage: dmg * DIFF[diff].dmg, kind: 'javelin' });
    P.lastDefense = res.result;
    if (res.result === 'blocked') { SFX.thud(); P.shake = .15; if (res.stuck) showPrompt('Dardo cravado no escudo — R para arrancar', 1.4); return; }
    hurtPlayer(res.damage, from); return;
  }
  hurtPlayer(dmg * DIFF[diff].dmg, from);
}
function hurtPlayer(dmg, from) {
  if (state !== 'play') return;
  SFX.hurt(); P.hurtT = .35; P.hp -= dmg;
  const d = V(from.x - P.pos.x, 0, from.z - P.pos.z).normalize();
  const f = flatFwd(), r = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  $('dmg').style.transform = `rotate(${Math.atan2(d.dot(r), d.dot(f))}rad)`; $('dmg').style.opacity = 1; dmgT = .8;
  if (P.hp <= 0) { P.hp = 0; die(); }
}
function spawnEnemyJavelin(from, target, dmg = 15) {
  const hd = Math.hypot(target.x - from.x, target.z - from.z), t = Math.max(.15, hd / 24);
  const vel = V((target.x - from.x) / t, (target.y - from.y) / t + .5 * 11 * t, (target.z - from.z) / t);
  spawnProj('javelin', from.clone(), vel, 'enemy', dmg); SFX.jav(spatial(from));
}

/* =========================================================
   Enemy AI
   ========================================================= */
function alert(e) {
  if (e.dead) return;
  if (e.state === 'chase' || e.state === 'skirmish') return;
  e.state = e.kind === 'velite' ? 'skirmish' : 'chase'; e.aware = 1;
  if (e.barkT <= 0) { SFX.grunt(spatial(e.pos) * .8); e.barkT = 3; }
  if (e.group === 'camp' && !alarm && mission >= 0) { e.alarmT = 2.5; }
}
function canSee(e) {
  const dx = P.pos.x - e.pos.x, dz = P.pos.z - e.pos.z, d = Math.hypot(dx, dz);
  const range = (e.kind === 'velite' ? 40 : 34) * (P.crouch > .5 ? .55 : 1) * (keys.ShiftLeft || keys.ShiftRight ? 1.2 : 1);
  if (d > range) return 0;
  const fa = Math.abs(wrapA(Math.atan2(dx, dz) - e.yaw));
  const behind = fa > 1.25;
  if (behind && d > (P.crouch > .5 ? 1 : 2.5)) return 0;
  if (!losTerrain(e.pos.x, e.pos.y + 1.7, e.pos.z, P.pos.x, P.pos.y + 1.4 - P.crouch * .5, P.pos.z)) return 0;
  return (1 - d / range) * (behind ? .25 : 1);
}
function moveEnemy(e, tx, tz, speed, dt) {
  const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
  if (d < .05) return 0;
  const s = Math.min(d, speed * dt);
  e.pos.x += dx / d * s; e.pos.z += dz / d * s;
  return speed;
}
function faceTo(e, tx, tz, dt, rate = 6) {
  const target = Math.atan2(tx - e.pos.x, tz - e.pos.z);
  e.yaw += clamp(wrapA(target - e.yaw), -rate * dt, rate * dt);
}
// Animation. Arms follow the same blade arc (swing.js) that decides hits, so what you see is what lands.
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), DOWN = new THREE.Vector3(0, -1, 0);
const GUARD = { x: -.1, y: -.45, z: .9 };          // combat stance: blade held toward the foe
const RELAX = { x: -.05, y: -1, z: .12 };          // arm hanging while marching
const toModel = v => ({ x: -v.x, y: v.y, z: v.z }); // swing.js x = attacker's right = model −x
const lerp3 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
function aimArm(arm, v, k) { _v.set(v.x, v.y, v.z).normalize(); _q.setFromUnitVectors(DOWN, _v); arm.quaternion.slerp(_q, k); }
const _S = new THREE.Vector3(), _T = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _el = new THREE.Vector3(), _qi = new THREE.Quaternion();
const UPPER = .3, FORE = .28;
/** Two-bone IK: put the left hand on the grip behind the shield (scutum or parma). */
function ikArm(m, k) {
  const sh = m.root.userData.scutum || m.root.userData.parma; if (!sh) return false;
  sh.updateMatrix(); _T.set(0, 0, -.09).applyMatrix4(sh.matrix);
  _S.copy(m.arms[0].position);
  _d.subVectors(_T, _S); const d = Math.min(_d.length(), UPPER + FORE - .002); _d.normalize();
  const a1 = Math.acos(clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1));
  _p.set(.8, -.35, -.45).normalize(); _p.addScaledVector(_d, -_p.dot(_d)).normalize(); // elbow out and back
  _u.copy(_d).multiplyScalar(Math.cos(a1)).addScaledVector(_p, Math.sin(a1));
  _q.setFromUnitVectors(DOWN, _u); m.arms[0].quaternion.slerp(_q, k);
  _el.set(0, -UPPER, 0).applyQuaternion(m.arms[0].quaternion).add(_S);
  _f.subVectors(_T, _el).normalize().applyQuaternion(_qi.copy(m.arms[0].quaternion).invert());
  m.elbows[0].quaternion.slerp(_q.setFromUnitVectors(DOWN, _f), k);
  return true;
}
/** Pose a soldier from its measured velocity and fighter state. Returns the vertical bob. */
function setPose(e, dt) {
  if (e.m.rig) {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const tk = e.throwT > 0 ? { k: 1 - e.throwT, rel: e.throwKind === 'sling' ? .83 : .53 } : e.kind === 'velite' && e.atkT > 0 ? { k: 1 - e.atkT / .55, rel: .64 } : null;
    driveRig(THREE, e.m.rig, { speed: e.mv.x * fx + e.mv.z * fz, side: e.mv.x * fz - e.mv.z * fx, crouch: e.crouch, combat: e.state === 'chase', f: e.f, T: C,
      throwK: tk ? clamp(tk.k * .33 / tk.rel, 0, 1) : -1, hit: e.hits, heavy: e.heavy, dead: e.dead }, dt);
    return 0;
  }
  const m = e.m, f = e.f, k = Math.min(1, dt * 14), combat = e.state === 'chase';
  // legs: stride advances with distance walked, so feet don't slide; works forwards, backwards and sideways
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  const vf = e.mv.x * fx + e.mv.z * fz, vs = e.mv.x * -fz + e.mv.z * fx, sp = Math.hypot(vf, vs);
  e.stride = (e.stride || 0) + sp * dt * 3.5;
  const amp = Math.min(.7, sp * .2), fwdK = sp > .05 ? vf / sp : 1, sideK = sp > .05 ? vs / sp : 0;
  const stance = combat ? .2 : .04;
  for (let i = 0; i < 2; i++) {
    const ph = e.stride + i * Math.PI, s = Math.sin(ph), lift = Math.max(0, Math.cos(ph));
    m.legs[i].rotation.x = lerp(m.legs[i].rotation.x, s * amp * fwdK - stance * .7, k);
    m.legs[i].rotation.z = lerp(m.legs[i].rotation.z, s * amp * sideK * .45 + (i ? -1 : 1) * (combat ? .06 : 0), k);
    m.knees[i].rotation.x = lerp(m.knees[i].rotation.x, stance + lift * amp * 1.3, k);
  }
  const bob = Math.abs(Math.sin(e.stride)) * amp * .06 - (combat ? .03 : 0);
  // sword arm, elbow, spine twist and lean
  let aim = combat ? GUARD : RELAX, elbow = combat ? .7 : .1, twist = 0, lean = clamp(vf * .04, -.1, .2) + (combat ? .1 : 0);
  if (f.phase === 'windup' && f.dir) {
    const q = Math.min(1, f.t / (C.WINDUP[f.dir] * .8));
    aim = lerp3(aim, toModel(bladeDir(f.dir, 0)), q);
    elbow = lerp(elbow, f.dir === 'thrust' ? 1.7 : f.dir === 'up' ? .55 : 1.2, q);
    twist = (f.dir === 'left' ? .55 : f.dir === 'right' ? -.6 : f.dir === 'thrust' ? -.3 : 0) * q;
    lean -= f.dir === 'up' ? .15 * q : 0;
  } else if (f.phase === 'strike' && f.dir) {
    const p = Math.min(1, f.t / C.STRIKE_TIME[f.dir]);
    aim = toModel(bladeDir(f.dir, p));
    elbow = f.dir === 'thrust' ? lerp(1.7, .05, p) : lerp(f.dir === 'up' ? .55 : 1.2, .15, Math.min(1, p * 1.6));
    twist = f.dir === 'left' ? lerp(.55, -.55, p) : f.dir === 'right' ? lerp(-.6, .55, p) : f.dir === 'thrust' ? lerp(-.3, .25, p) : 0;
    lean += .18 * Math.sin(Math.PI * p);
  } else if (f.phase === 'recovery' && f.dir) {
    aim = lerp3(toModel(bladeDir(f.dir, 1)), GUARD, .35); elbow = .4;
  } else if (f.phase === 'staggered') {
    aim = { x: -.5, y: -.5, z: .2 }; elbow = .3; lean = -.32; twist = .25;
  }
  if (f.blocking === 'sword') { aim = { x: -.3, y: .15, z: .95 }; elbow = 1.3; twist = -.2; }
  if (e.throwT > 0) {                    // javelin: arm back, then a hard forward release; sling: whirl overhead
    const k = 1 - e.throwT;
    if (e.throwKind === 'sling') { const a = k * 26; aim = k < .8 ? { x: -Math.cos(a) * .5, y: .8, z: Math.sin(a) * .5 } : { x: -.1, y: .1, z: 1 }; elbow = .2; twist = -.2; }
    else { aim = k < .5 ? { x: -.35, y: .55, z: -.75 } : { x: -.1, y: -.15, z: 1 }; elbow = k < .5 ? 1 : .1; twist = k < .5 ? -.6 : .35; lean += k < .5 ? -.1 : .2; }
  }
  const ka = f.phase === 'strike' || e.throwT > 0 ? Math.min(1, dt * 40) : k;
  aimArm(m.arms[1], aim, ka);
  m.elbows[1].rotation.x = lerp(m.elbows[1].rotation.x, -elbow, ka);
  m.spine.rotation.y = lerp(m.spine.rotation.y, twist, ka);
  m.spine.rotation.x = lerp(m.spine.rotation.x, lean, k);
  const sc = m.root.userData.scutum || m.root.userData.parma;
  if (sc) {
    const base = m.root.userData.shieldBase || (m.root.userData.shieldBase = sc.position.clone());
    const b = f.blocking === 'shield', atk = f.phase === 'windup' || f.phase === 'strike';
    sc.position.x = lerp(sc.position.x, b ? .02 : atk ? base.x + .08 : base.x, k);
    sc.position.y = lerp(sc.position.y, b ? .36 : base.y, k);
    sc.position.z = lerp(sc.position.z, b ? .44 : combat ? base.z + .04 : base.z - .04, k);
    sc.rotation.y = lerp(sc.rotation.y, b ? 0 : combat ? .3 : .6, k);
  }
  // shield arm: two-bone IK so the hand grips the shield from behind; free arm swings while marching
  if (!ikArm(m, k)) {
    aimArm(m.arms[0], { x: .08, y: -1, z: -Math.sin(e.stride) * amp * .5 }, k);
    m.elbows[0].rotation.x = lerp(m.elbows[0].rotation.x, -.15, k);
  }
  return bob;
}
// Blade trails: a fading ribbon along the arc (hand → tip) so every blow reads clearly.
const TRAIL_LIFE = .16, trails = new Map();
const trailMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
function trailFor(key) {
  let t = trails.get(key);
  if (!t) {
    const g = new THREE.BufferGeometry(), N = 24;
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, trailMat); mesh.frustumCulled = false; scene.add(mesh);
    t = { mesh, samples: [], N }; trails.set(key, t);
  }
  return t;
}
function sampleTrail(key, pos, facing, f) {
  const t = trailFor(key);
  if (f.phase === 'strike' && f.dir) {
    const p = Math.min(1, f.t / C.STRIKE_TIME[f.dir]), seg = bladeSegment(f.dir, p);
    t.samples.push({ a: toWorld(seg.hand, pos, facing), b: toWorld(seg.tip, pos, facing), age: 0 });
    if (t.samples.length > t.N) t.samples.shift();
  }
}
function updateTrails(dt) {
  for (const t of trails.values()) {
    for (const s of t.samples) s.age += dt;
    while (t.samples.length && t.samples[0].age > TRAIL_LIFE) t.samples.shift();
    const pa = t.mesh.geometry.attributes.position, ca = t.mesh.geometry.attributes.color, n = t.samples.length;
    for (let i = 0; i < t.N; i++) {
      const s = t.samples[Math.min(i, n - 1)];
      if (!s) { pa.setXYZ(i * 2, 0, -999, 0); pa.setXYZ(i * 2 + 1, 0, -999, 0); continue; }
      const a = i < n ? (1 - s.age / TRAIL_LIFE) * .55 : 0;
      pa.setXYZ(i * 2, lerp(s.a.x, s.b.x, .45), lerp(s.a.y, s.b.y, .45), lerp(s.a.z, s.b.z, .45)); pa.setXYZ(i * 2 + 1, s.b.x, s.b.y, s.b.z);
      ca.setXYZ(i * 2, 0, 0, 0); ca.setXYZ(i * 2 + 1, a, a * .97, a * .9);
    }
    pa.needsUpdate = true; ca.needsUpdate = true; t.mesh.visible = n > 1;
  }
}
const engaged = new Set();
/** Only the 2 (3 on Hard) nearest alerted swordsmen may close in; the rest wait in a ring. */
function updateEngaged() {
  engaged.clear();
  for (const e of enemies) e.T = !e.dead && e.state === 'chase' ? pickTarget(e.pos, P, allies) : null;
  const melee = enemies.filter(e => !e.dead && e.state === 'chase' && e.kind !== 'velite' && !e.T.ally);
  melee.sort((a, b) => a.pos.distanceToSquared(P.pos) - b.pos.distanceToSquared(P.pos));
  for (const e of melee.slice(0, diff === 2 ? 3 : 2)) engaged.add(e);
}
function updateEnemies(dt) {
  updateEngaged();
  const dm = DIFF[diff];
  for (const e of enemies) {
    const r = e.m.root;
    if (e.dead) {
      e.deadT += dt;
      if (e.m.rig) { setPose(e, dt); if (e.corpse && e.deadT > .1) { phys.removeCorpse(e.corpse); e.corpse = null; } for (const m of e.m.mats) m.emissive.setRGB(0, 0, 0); continue; }
      if (phys.ok && e.corpse) {
        if (e.deadT >= 6) { phys.removeCorpse(e.corpse); e.corpse = null; } // settled: freeze the pose, free the body
        else { const t = phys.getTransform(e.corpse); r.quaternion.set(t.q.x, t.q.y, t.q.z, t.q.w); r.position.set(0, -.9, 0).applyQuaternion(r.quaternion).add(V(t.p.x, t.p.y, t.p.z)); }
      } else if (e.deadT < 1) { r.rotation.x = -Math.PI / 2 * smooth(0, .7, e.deadT); r.position.y = e.pos.y + .15 * smooth(0, .7, e.deadT); }
      for (const m of e.m.mats) m.emissive.setRGB(0, 0, 0);
      continue;
    }
    const px0 = e.pos.x, pz0 = e.pos.z;
    e.ph += dt; e.barkT -= dt; e.cd -= dt;
    if (e.flash > 0) e.flash -= dt;
    const fl = Math.max(0, e.flash) * 4; for (const m of e.m.mats) m.emissive.setRGB(fl * .6, 0, 0);
    const pd = Math.hypot(P.pos.x - e.pos.x, P.pos.z - e.pos.z);
    let speed = 0;
    if (state === 'dead') { e.state = e.state === 'march' ? 'march' : 'guard'; }

    if (e.state === 'march' || e.state === 'guard') {
      if (e.state === 'march') {
        const tz = e.pos.z + e.dir * 3; speed = moveEnemy(e, roadX(tz) + (e.home.x - roadX(e.home.z)), tz, 1.7, dt);
        faceTo(e, roadX(tz) + (e.home.x - roadX(e.home.z)), tz, dt, 3);
        if (e.pos.z > 125 && e.dir > 0) e.dir = -1; if (e.pos.z < -70 && e.dir < 0) e.dir = 1;
      } else {
        e.wT -= dt;
        if (!e.wander || e.wT <= 0) { e.wander = V(e.home.x + rr(-6, 6), 0, e.home.z + rr(-6, 6)); e.wT = rr(4, 9); }
        const dw = Math.hypot(e.wander.x - e.pos.x, e.wander.z - e.pos.z);
        if (dw > .6 && e.wT < 6) { speed = moveEnemy(e, e.wander.x, e.wander.z, 1.2, dt); faceTo(e, e.wander.x, e.wander.z, dt, 3); }
      }
      if (state === 'play') {
        const s = canSee(e);
        if (s > 0) e.aware += dt * (.6 + s * 3.2) * dm.detect; else e.aware = Math.max(0, e.aware - dt * .3);
        if (e.aware >= 1) alert(e);
      }
    } else if (e.state === 'chase') {
      if (e.alarmT != null && e.alarmT > 0) { e.alarmT -= dt; if (e.alarmT <= 0) raiseAlarm(); }
      const T = e.T || pickTarget(e.pos, P, allies), td = T.dist, tf = T.ally ? T.ally.f : P.f; // fights Viriato or a companion
      faceTo(e, T.pos.x, T.pos.z, dt, e.f.phase === 'windup' ? 3.5 : 7);
      const slow = e.slowT > 0 ? LEG_SLOW.factor : 1; e.slowT -= dt;
      e.blockLeft -= dt; e.aiT -= dt;
      // raise the scutum against missiles while closing in, or when the AI chose to block
      if (e.f.phase === 'idle') {
        const want = e.blockLeft > 0 || (!T.ally && pd > 3.5 && P.w !== 0);
        if (want && !e.f.blocking) C.beginBlock(e.f, 'shield'); else if (!want && e.f.blocking) C.endBlock(e.f);
      }
      if (e.aiT <= 0 && state === 'play' && e.f.phase === 'idle') {
        e.aiT = e.kind === 'centurion' ? .18 : .26; e.dodgeRoll = rand(); if (rand() < .12) e.strafe *= -1;
        const attackersNow = enemies.filter(o => o !== e && !o.dead && o.kind !== 'velite' && o.f.phase === 'windup').length;
        e.act = decide({ kind: e.kind, fighter: e.f }, { dist: td, playerFighter: tf, difficulty: diff, attackersNow, rng: rand, engaged: engaged.has(e) || !!T.ally });
        if (e.act.startsWith('attack:')) { const dir = e.act.slice(7); C.endBlock(e.f); if (C.beginAttack(e.f, dir)) { e.releaseAt = C.WINDUP[dir] + rr(0, .25) * (e.kind === 'centurion' ? .4 : 1); e.feintAt = 0; } }
        else if (e.act === 'block') e.blockLeft = rr(.5, .9);
        else if (e.act === 'feint') { C.endBlock(e.f); if (C.beginAttack(e.f, C.DIRS[Math.floor(rand() * 4)])) { e.feintAt = rr(.15, .3); e.releaseAt = 99; } }
      }
      if (e.f.phase === 'windup') {
        if (e.feintAt && e.f.t >= e.feintAt) { C.feint(e.f); e.feintAt = 0; }
        else if (!e.f.released && e.f.t >= e.releaseAt) C.releaseAttack(e.f);
      }
      { // duel footwork with acceleration-limited steering (no instant starts, stops or sliding)
        const fw = footwork({ dist: td, sp: e.sp * slow * (e.f.blocking ? .6 : 1) * (td > 25 ? 1.15 : 1), act: e.act, strafe: e.strafe,
          difficulty: diff, rng: () => e.dodgeRoll, self: e.f, player: tf });
        const fx = (T.pos.x - e.pos.x) / (td || 1), fz = (T.pos.z - e.pos.z) / (td || 1);
        e.vel = steer(e.vel, { x: fx * fw.forward + fz * fw.strafe, z: fz * fw.forward - fx * fw.strafe }, 9, dt);
        e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt;
        speed = Math.hypot(e.vel.x, e.vel.z);
      }
      for (const ev of C.tickFighter(e.f, dt)) if (ev.type === 'swing') enemySwing(e, ev);
      sampleTrail(e, e.pos, e.yaw, e.f);
      if (e.kind === 'centurion' && e.barkT <= 0) { e.barkT = 6; SFX.grunt(spatial(e.pos)); for (const o of enemies) if (!o.dead && o.pos.distanceTo(e.pos) < 30) alert(o); }
    } else if (e.state === 'skirmish') {
      if (e.alarmT != null && e.alarmT > 0) { e.alarmT -= dt; if (e.alarmT <= 0) raiseAlarm(); }
      if (pd < 9) e.flee = true; else if (pd > 14) e.flee = false;
      if (e.flee && e.atkT <= 0) faceTo(e, 2 * e.pos.x - P.pos.x, 2 * e.pos.z - P.pos.z, dt, 6); else faceTo(e, P.pos.x, P.pos.z, dt, 6);
      const sees = losTerrain(e.pos.x, e.pos.y + 1.7, e.pos.z, P.pos.x, P.pos.y + 1.4, P.pos.z);
      if (e.flee) { const a = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z); speed = moveEnemy(e, e.pos.x + Math.sin(a) * 3, e.pos.z + Math.cos(a) * 3, e.sp, dt); }
      else if (pd > 26 || !sees) speed = moveEnemy(e, P.pos.x, P.pos.z, e.sp, dt);
      else { const a = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z) + Math.PI / 2 * e.strafe; speed = moveEnemy(e, e.pos.x + Math.sin(a) * 2, e.pos.z + Math.cos(a) * 2, 1.6, dt); if (rand() < dt * .3) e.strafe *= -1; }
      if (e.atkT > 0) {
        const prev = e.atkT; e.atkT -= dt;
        if (prev > .2 && e.atkT <= .2 && state === 'play') {
          const from = V(e.pos.x, e.pos.y + 1.75, e.pos.z);
          const target = V(P.pos.x + rr(-1, 1) * (1.4 - dm.detect * .4) * pd / 20, P.pos.y + 1.1, P.pos.z + rr(-1, 1) * (1.4 - dm.detect * .4) * pd / 20);
          const hd = Math.hypot(target.x - from.x, target.z - from.z), t = hd / 24;
          const vel = V((target.x - from.x) / t, (target.y - from.y) / t + .5 * 11 * t, (target.z - from.z) / t);
          spawnProj('javelin', from, vel, 'enemy', e.dmg); SFX.jav(spatial(from));
        }
      } else if (sees && !e.flee && pd < 34 && e.cd <= 0 && state === 'play') { e.atkT = .55; e.cd = rr(2.2, 3.6); }
    }
    // separation
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.45 && d > 1e-3) { e.pos.x += dx / d * (1.45 - d) * .5; e.pos.z += dz / d * (1.45 - d) * .5; }
    }
    // keep off the player
    if (pd < 1.0 && pd > 1e-3) { e.pos.x -= (P.pos.x - e.pos.x) / pd * (1 - pd); e.pos.z -= (P.pos.z - e.pos.z) / pd * (1 - pd); }
    resolve(e.pos, .4);
    e.pos.y = heightAt(e.pos.x, e.pos.z);
    // animate from the velocity actually travelled this frame
    if (dt > 1e-4) { const a = Math.min(1, dt * 12); e.mv.x = lerp(e.mv.x, (e.pos.x - px0) / dt, a); e.mv.z = lerp(e.mv.z, (e.pos.z - pz0) / dt, a); }
    const bob = setPose(e, dt);
    if (e.kind === 'velite' && e.atkT > 0 && e.m.arms) {
      const k = 1 - e.atkT / .55;
      e.m.arms[1].rotation.set(k < .7 ? lerp(0, -2.5, k / .7) : lerp(-2.5, .4, (k - .7) / .3), 0, 0);
    }
    r.position.set(e.pos.x, e.pos.y + bob, e.pos.z); r.rotation.y = e.yaw;
  }
}

/* =========================================================
   Player update
   ========================================================= */
function updatePlayer(dt) {
  P.time += dt;
  C.decayIntent(P.intent, dt);
  const sprintKey = (keys.ShiftLeft || keys.ShiftRight) && P.st > 1;
  const crouchKey = keys.KeyC || keys.ControlLeft;
  P.crouch = lerp(P.crouch, crouchKey ? 1 : 0, Math.min(1, dt * 10));
  // local input: W/S forward/back, A/D sideways
  const lf = ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0);
  const ls = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const ml = Math.hypot(lf, ls);
  const top = ml ? playerSpeed({ fwd: lf / ml, side: ls / ml, sprint: sprintKey, crouch: P.crouch > .5, f: P.f }) : 0;
  const sprint = sprintKey && top > 7;
  const tx = ml ? (fx * lf + rx * ls) / ml * top : 0, tz = ml ? (fz * lf + rz * ls) / ml * top : 0;
  // momentum: quick to start, quick to stop, but not instant (footwork you can read)
  const nv = steer(P.vel, { x: tx, z: tz }, P.ground ? (ml ? 26 : 34) : 6, dt); P.vel.x = nv.x; P.vel.z = nv.z;
  const speed = Math.hypot(P.vel.x, P.vel.z);
  if (P.push) { P.pos.x += P.push.x * dt; P.pos.z += P.push.z * dt; const k = Math.exp(-8 * dt); P.push.x *= k; P.push.z *= k; resolve(P.pos, .38); if (Math.hypot(P.push.x, P.push.z) < .05) P.push = null; }
  if (speed > .01) {
    const ox = P.pos.x, oz = P.pos.z;
    P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt;
    // steep climb check
    const nh = heightAt(P.pos.x, P.pos.z), oh = heightAt(ox, oz);
    if (P.ground && (nh - oh) / (speed * dt) > 1.6) { P.pos.x = ox; P.pos.z = oz; }
    resolve(P.pos, .38);
    if (P.ground) { P.bob += dt * speed * 1.6; P.stepT -= dt * speed; if (P.stepT <= 0) { P.stepT = 2.4; SFX.step(); } }
  }
  if (sprint) P.st = Math.max(0, P.st - dt * 36);
  if (keys.Space && P.ground && P.st > 10) { P.vy = 6.4; P.ground = false; P.st -= 8; }
  P.vy -= 19 * dt; P.pos.y += P.vy * dt;
  const gh = heightAt(P.pos.x, P.pos.z);
  if (P.pos.y <= gh) { if (!P.ground && P.vy < -12) damagePlayer((-P.vy - 12) * 4, P.pos, true); P.pos.y = gh; P.vy = 0; P.ground = true; }
  else if (P.pos.y - gh > .25) P.ground = false;

  // combat
  P.cd = Math.max(0, P.cd - dt); P.bashCd = Math.max(0, P.bashCd - dt); P.bashT = Math.max(0, P.bashT - dt);
  if (P.cleanT > 0) { P.cleanT -= dt; if (P.cleanT <= 0) { P.f.stuckJavelins = 0; feed('Escudo limpo'); } }
  // press / release edges of the left button
  if (mouseL && !P.prevL && placing) { placeFlag(); P.prevL = true; }
  else if (mouseL && !P.prevL) {
    if (P.w === 0) { P.charging = true; P.chargeT = 0; P.acc.x = P.intent.x; P.acc.y = P.intent.y; }
    else attack();
  }
  const released = !mouseL && P.prevL; P.prevL = mouseL;
  if (P.charging) {
    P.chargeT += dt;
    if (P.f.phase !== 'windup' && (P.chargeT >= .08 || released)) {
      // buffered: a click during recovery/flinch starts the blow as soon as the fighter is free
      P.post.x = 0; P.post.y = 0;
      // direction is random for now (no mouse sweep needed); C.dirFromMouse(P.acc) is the Mount & Blade alternative
      if (!C.beginAttack(P.f, forcedDir || C.randomDir(P.lastDir))) {
        if (P.f.phase === 'idle' && !P.f.blocking) { P.charging = false; showPrompt('Sem fôlego para atacar', .6); }
        else if (released) P.queued = true;
      } else if (P.queued) { P.queued = false; C.releaseAttack(P.f); P.charging = false; }
    }
    // a clear sweep right after the blow started still turns it (the first one may have been read from camera turning)
    if (P.f.phase === 'windup') P.lastDir = P.f.dir;
    if (released && P.f.phase === 'windup') { C.releaseAttack(P.f); P.charging = false; }
    if (P.w !== 0) P.charging = false;
  }
  // defence: Q = falcata (direction is automatic), right button = caetra
  const wantBlock = keys.KeyQ && P.w === 0 ? 'sword' : (mouseR && P.w !== 2 && P.f.shieldHP > 0 && P.cleanT <= 0 ? 'shield' : null);
  if (wantBlock !== P.f.blocking) { if (wantBlock) { if (C.beginBlock(P.f, wantBlock)) P.charging = false; } else C.endBlock(P.f); }
  // auto-aim the sword guard at the nearest enemy winding up
  let inc = null, incD = 4;
  for (const e of enemies) if (!e.dead && e.f.phase === 'windup') { const d = e.pos.distanceTo(P.pos); if (d < incD) { incD = d; inc = e.f.dir; } }
  P.incomingDir = inc;
  for (const ev of C.tickFighter(P.f, dt)) if (ev.type === 'swing') playerSwing(ev);
  sampleTrail('player', P.pos, playerFacing(), P.f);
  if (P.throwPending) { P.throwPending -= dt; if (P.throwPending <= 0) { P.throwPending = 0; releaseThrow(); } }
  P.swing = Math.max(0, P.swing - dt / .45); P.throwT = Math.max(0, P.throwT - dt / .6); P.hurtT = Math.max(0, P.hurtT - dt);

  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    k.t += dt;
    if (k.spin) { k.mesh.rotation.y += dt * 1.5; k.mesh.position.y = k.y + Math.sin(k.t * 2.5) * .08; }
    if (Math.hypot(k.x - P.pos.x, k.z - P.pos.z) < 1.7 && Math.abs(k.y - P.pos.y) < 2.2) {
      let ok = true;
      if (k.type === 'odre') { if (P.hp >= 100) ok = false; else { P.hp = Math.min(100, P.hp + 35); feed('Odre de água: +35 vida'); } }
      else if (k.type === 'dardos') { if (P.dardos >= 10) ok = false; else { P.dardos = Math.min(10, P.dardos + 3); feed('Dardos: +3'); } }
      else if (k.type === 'dardo1') { if (P.dardos >= 10) ok = false; else { P.dardos++; } }
      else if (k.type === 'pedras') { if (P.pedras >= 30) ok = false; else { P.pedras = Math.min(30, P.pedras + 8); feed('Pedras: +8'); } }
      if (ok) { SFX.pick(); scene.remove(k.mesh); pickups.splice(i, 1); updateHUDWeapon(); }
    }
  }
  // E prompt
  let pr = '';
  for (const t of supplyTents) if (!t.burnt && Math.hypot(t.x - P.pos.x, t.z - P.pos.z) < 5) pr = '<b>[E]</b> Incendiar os mantimentos';
  if (promptT > 0) { promptT -= dt; } else $('prompt').innerHTML = pr;
}
let promptT = 0;
function showPrompt(t, d) { $('prompt').textContent = t; promptT = d; }

/* camera + viewmodel */
function updateCamera(dt) {
  const bobA = P.ground ? 1 : 0;
  const by = Math.sin(P.bob * 2) * .035 * bobA, bx = Math.cos(P.bob) * .025 * bobA;
  camera.position.set(P.pos.x + bx * 0, P.pos.y + 1.68 - P.crouch * .6 + by, P.pos.z);
  const shake = P.hurtT > 0 ? (Math.random() - .5) * P.hurtT * .08 : 0;
  P.kick = Math.max(0, P.kick - dt * 1.5);
  camera.rotation.set(P.pitch + shake + P.kick * .12, P.yaw, shake * .5 + P.kick * .05);
  // Viriato himself, posed by the same rig and blade arcs as the Romans
  avatar.f = P.f; avatar.state = P.w === 0 ? 'chase' : 'idle'; avatar.crouch = P.crouch > .4; avatar.dead = state === 'dead'; avatar.hits = P.hitsTaken; avatar.yaw = P.yaw + Math.PI; avatar.mv.x = P.vel.x; avatar.mv.z = P.vel.z; avatar.throwT = P.throwT; avatar.throwKind = P.throwKind;
  const bob3 = setPose(avatar, dt);
  AV.root.position.set(P.pos.x, P.pos.y + bob3 - (AV.rig ? 0 : P.crouch * .3), P.pos.z); AV.root.rotation.y = avatar.yaw;
  AV.root.visible = view === 'third'; AV_FAL.visible = P.w === 0;
  const thrown = !P.throwPending && P.throwT > 0; // between release and drawing the next one
  AV_JAV.visible = P.w === 1 && P.dardos + (P.throwPending ? 1 : 0) > 0 && !thrown;
  AV_STONE.visible = P.w === 2 && P.pedras + (P.throwPending ? 1 : 0) > 0 && !thrown;
  if (view === 'third') {
    const dir = fwd3(), right = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const pivot = V(P.pos.x, P.pos.y + 1.6 - P.crouch * .5, P.pos.z);
    // over the right shoulder, Viriato left of centre so his sword arm and the foe are both in view
    const cp = pivot.addScaledVector(dir, -3).addScaledVector(right, .95).add(V(0, .3, 0));
    const gh = heightAt(cp.x, cp.z) + .4; if (cp.y < gh) cp.y = gh;
    camera.position.copy(cp);
  }
  // viewmodel
  FAL.visible = P.w === 0; JAV.visible = P.w === 1 && (P.dardos > 0 || P.throwT > 0); SLG.visible = P.w === 2;
  SHD.visible = P.w !== 2 && P.f.shieldHP > 0;
  STUCK.forEach((m, i) => { m.visible = i < P.f.stuckJavelins; });
  const sx = Math.cos(P.bob) * .012, sy = Math.abs(Math.sin(P.bob)) * .014;
  if (P.w === 0) {
    const b = FAL.userData.base, f = P.f;
    // windup / strike / recovery follow the same arc (swing.js) that decides hits; guard and idle use fixed poses
    let pos, quat, k = Math.min(1, dt * 12);
    const arc = (dir, p, reach) => {
      const v = bladeDir(dir, p), vc = _v.set(v.x, v.y, -v.z).normalize();
      pos = [VM_SHOULDER[0] + vc.x * reach, VM_SHOULDER[1] + vc.y * reach, VM_SHOULDER[2] + vc.z * reach];
      quat = _q.setFromUnitVectors(UP, vc).clone();
    };
    if (f.blocking === 'sword') { const t = FAL_POSE['block_' + MIRROR[P.incomingDir || 'up']]; pos = t.p; quat = _q.setFromEuler(_e.set(t.r[0], t.r[1], t.r[2])).clone(); }
    else if (f.phase === 'windup' && f.dir) { arc(f.dir, 0, f.dir === 'thrust' ? .2 : .32); }
    else if (f.phase === 'strike' && f.dir) { const p = Math.min(1, f.t / C.STRIKE_TIME[f.dir]); arc(f.dir, p, f.dir === 'thrust' ? .2 + .3 * p : .42); k = Math.min(1, dt * 45); }
    else if (f.phase === 'recovery' && f.dir) { arc(f.dir, 1, .38); k = Math.min(1, dt * 8); }
    else { const t = f.phase === 'staggered' ? FAL_POSE.stagger : FAL_POSE.idle; pos = t.p; quat = _q.setFromEuler(_e.set(t.r[0], t.r[1], t.r[2])).clone(); }
    FAL.position.set(lerp(FAL.position.x, pos[0] + sx, k), lerp(FAL.position.y, pos[1] - sy, k), lerp(FAL.position.z, pos[2], k));
    FAL.quaternion.slerp(quat, k);
  }
  if (P.w === 1) {
    const b = JAV.userData.base, t = P.throwT, k = 1 - t;
    const push = t > 0 ? (k < .3 ? -k / .3 * .18 : (k < .5 ? lerp(-.18, .7, (k - .3) / .2) : .7)) : 0;
    JAV.position.set(b.x + sx, b.y - sy + (t > 0 && k > .5 ? -1 : 0), b.z - push);
    JAV.rotation.set(.04, -.04, 0);
    if (P.block) JAV.position.y -= .15;
  }
  if (P.w === 2) {
    const b = SLG.userData.base;
    SLG.position.set(b.x + sx, b.y - sy, b.z);
    if (P.throwT > 0) { SLGpouch.rotation.x -= dt * 28; } else SLGpouch.rotation.x = lerp(SLGpouch.rotation.x % TAU, 0, Math.min(1, dt * 6));
  }
  const si = P.f.blocking === 'shield' ? SHD.userData.block : P.bashT > 0 ? SHD.userData.bash : SHD.userData.idle, cur = SHD.position;
  if (P.shake > 0) { P.shake -= dt; SHD.position.x += (Math.random() - .5) * .03; }
  const kk = Math.min(1, dt * 14);
  SHD.position.set(lerp(cur.x, si.x + sx * .5, kk), lerp(cur.y, si.y - sy * .5, kk), lerp(cur.z, si.z, kk));
  SHD.rotation.y = lerp(SHD.rotation.y, si.ry, kk);
  // sun follows player for shadow coverage
  sun.position.copy(P.pos).addScaledVector(SUN_DIR, 120); sun.target.position.copy(P.pos);
}

/* fires */
function updateFires(dt) {
  for (const t of supplyTents) {
    if (!t.burnt) continue;
    t.t += dt;
    t.mat.color.lerp(new THREE.Color(0x1d1712), Math.min(1, dt * .25));
    if (t.t < 40) {
      t.light.intensity = 1.8 + Math.sin(t.t * 13) * .4 + Math.random() * .4;
      if (Math.random() < dt * 40) emit(true, V(t.x + rr(-1.8, 1.8), CAMP.h + rr(.5, 2.5), t.z + rr(-1.2, 1.2)), V(rr(-.3, .3), rr(1.5, 3.2), rr(-.3, .3)), rr(.5, 1), rr(.6, 1.2), -.4, Math.random() < .5 ? 0xff7a26 : 0xffb64a, -1, .9);
      if (Math.random() < dt * 10) emit(false, V(t.x + rr(-1, 1), CAMP.h + 3.5, t.z + rr(-1, 1)), V(rr(-.4, .4), rr(1.5, 2.5), rr(-.4, .4)), rr(3, 5), 1.2, 4, 0x2e2a26, -.2, .5);
    } else t.light.intensity = Math.max(0, t.light.intensity - dt * .3);
  }
  // campfire
  const cf = fireLights[fireLights.length - 1]; cf.intensity = 1.1 + Math.sin(performance.now() / 70) * .2;
  if (Math.random() < dt * 14) emit(true, CAMP.fire.clone().add(V(rr(-.3, .3), 0, rr(-.3, .3))), V(0, rr(1, 2), 0), rr(.4, .8), .5, -.3, 0xff8a30, -1, .9);
}

/* =========================================================
   HUD
   ========================================================= */
const cmp = $('compass'); const cctx = cmp.getContext && cmp.getContext('2d');
function objectiveTarget() {
  if (mission === 0) { let best = null, bd = 1e9; for (const e of enemies) if (e.group === 'patrol' && !e.dead) { const d = e.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = e.pos; } } return best; }
  if (mission === 1) { let best = null, bd = 1e9; for (const t of supplyTents) if (!t.burnt) { const d = Math.hypot(t.x - P.pos.x, t.z - P.pos.z); if (d < bd) { bd = d; best = V(t.x, 0, t.z); } } return best; }
  const c = enemies.find(e => e.kind === 'centurion' && !e.dead); return c ? c.pos : null;
}
function drawCompass() {
  if (!cctx) return;
  const W = 420, Hh = 34, FOVC = 1.4;
  cctx.clearRect(0, 0, W, Hh);
  cctx.fillStyle = 'rgba(10,8,6,.55)'; cctx.fillRect(0, 6, W, 22);
  const heading = -P.yaw;
  cctx.font = '600 13px Cinzel, serif'; cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
  for (let deg = 0; deg < 360; deg += 15) {
    const rel = wrapA(deg * Math.PI / 180 - heading); if (Math.abs(rel) > FOVC) continue;
    const x = W / 2 + rel / FOVC * W / 2;
    const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[deg];
    if (lab) { cctx.fillStyle = lab === 'N' ? '#e0a64a' : '#efe4d2'; cctx.fillText(lab, x, 17); }
    else { cctx.fillStyle = 'rgba(239,228,210,.5)'; cctx.fillRect(x - .5, deg % 45 === 0 ? 11 : 14, 1, deg % 45 === 0 ? 12 : 6); }
  }
  const t = objectiveTarget();
  if (t) {
    const b = Math.atan2(t.x - P.pos.x, -(t.z - P.pos.z));
    const rel = wrapA(b - heading), x = W / 2 + clamp(rel / FOVC, -1, 1) * (W / 2 - 8);
    cctx.fillStyle = '#e0a64a'; cctx.beginPath(); cctx.moveTo(x, 4); cctx.lineTo(x + 6, 10); cctx.lineTo(x, 16); cctx.lineTo(x - 6, 10); cctx.fill();
    cctx.font = '11px "EB Garamond", serif'; cctx.fillStyle = '#efe4d2';
    cctx.fillText(Math.round(Math.hypot(t.x - P.pos.x, t.z - P.pos.z)) + ' m', clamp(x, 20, W - 20), 31);
  }
  cctx.fillStyle = '#efe4d2'; cctx.fillRect(W / 2 - .5, 6, 1, 4);
}
function updateHUDWeapon() {
  $('wname').textContent = WNAMES[P.w];
  $('wammo').textContent = P.w === 0 ? '—' : P.w === 1 ? `${P.dardos} / 10` : `${P.pedras} / 30`;
  for (const s of $('wlist').children) s.classList.toggle('on', +s.dataset.w === P.w);
  $('cross').classList.toggle('melee', P.w === 0);
}
function updateHUD(dt) {
  $('hpb').firstElementChild.style.width = P.hp + '%';
  $('stb').firstElementChild.style.width = P.st + '%';
  $('shb').firstElementChild.style.width = Math.max(0, P.f.shieldHP) + '%';
  const ARW = { up: '▲', left: '◀', right: '▶', thrust: '●' };
  $('chg').textContent = P.w === 0 && P.f.phase === 'windup' ? ARW[P.f.dir] : '';
  $('chg').style.opacity = P.f.phase === 'windup' ? .4 + .6 * Math.min(1, P.f.t / C.FULL_CHARGE) : 0;
  $('incoming').textContent = P.incomingDir ? ARW[MIRROR[P.incomingDir]] : '';
  $('vign').style.opacity = P.hp < 35 ? (.35 + Math.sin(P.time * 5) * .12) * (1 - P.hp / 35) + .2 : (P.hurtT > 0 ? P.hurtT * 1.6 : 0);
  if (hitmT > 0) { hitmT -= dt; if (hitmT <= 0) $('hitm').style.opacity = 0; }
  if (dmgT > 0) { dmgT -= dt; if (dmgT <= 0) $('dmg').style.opacity = 0; }
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  // awareness indicator
  let maxA = 0, hunted = false;
  for (const e of enemies) { if (e.dead) continue; if (e.state === 'chase' || e.state === 'skirmish') { if (e.pos.distanceTo(P.pos) < 45) hunted = true; } else maxA = Math.max(maxA, e.aware); }
  $('eye').textContent = hunted ? 'DESCOBERTO' : maxA > .25 ? 'SUSPEITAM…' : P.crouch > .5 ? 'ESCONDIDO' : '';
  $('eye').style.color = hunted ? '#e06a4a' : maxA > .25 ? '#e0a64a' : '';
  drawCompass();
}

/* =========================================================
   Flow: menu, pause, end
   ========================================================= */
function startGame() {
  initAudio();
  resetWorld();
  state = 'play';
  for (const k in keys) keys[k] = false; mouseL = mouseR = false;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden');
  updateHUDWeapon();
  showMsg('I · A Emboscada', 'Agacha-te (C) e aproxima-te sem seres visto. Um golpe pelas costas é mortal.', 5);
  lock();
}
/** Drop every held input and combat stance (used when the game loses focus). */
function releaseAll() {
  for (const k in keys) keys[k] = false; mouseL = mouseR = false;
  P.prevL = false; P.charging = false; C.feint(P.f); C.endBlock(P.f);
}
function pauseGame() { releaseAll(); state = 'pause'; $('pauseobj').textContent = $('objt').textContent; $('sens2').value = $('sens').value; $('pause').classList.remove('hidden'); }
// Resume only once the browser has actually granted pointer lock (Chrome refuses it for ~1 s after Esc).
let resumePending = false;
function finishResume() { resumePending = false; state = 'play'; $('pause').classList.add('hidden'); $('pausehint').textContent = ''; releaseAll(); }
function lockRefused() { if (state === 'pause') $('pausehint').textContent = 'O browser ainda não deixou prender o rato. Espera um segundo e clica em CONTINUAR outra vez.'; }
function resume() {
  releaseAll();
  if (!cv.requestPointerLock) { finishResume(); return; } // no pointer lock support (tests)
  resumePending = true;
  try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(lockRefused); } catch (_) { lockRefused(); }
}
function endScreen(kicker, title, text) {
  try { document.exitPointerLock && document.exitPointerLock(); } catch (_) {}
  $('endk').textContent = kicker; $('endt').textContent = title; $('endp').textContent = text;
  const mm = Math.floor(P.time / 60), ss = Math.floor(P.time % 60).toString().padStart(2, '0');
  const rows = [['Tempo', `${mm}:${ss}`], ['Romanos abatidos', P.kills], ['Tiros na cabeça', P.heads], ['Pontaria (dardos e funda)', P.shots ? Math.round(P.hits / P.shots * 100) + '%' : '—'], ['Dificuldade', DIFF[diff].name]];
  $('ends').innerHTML = ''; for (const [a, b] of rows) { const x = document.createElement('span'); x.textContent = a; const y = document.createElement('span'); y.textContent = b; $('ends').append(x, y); }
  $('hud').classList.add('hidden'); $('end').classList.remove('hidden');
}
let endT = 0, endArgs = null;
function die() { state = 'dead'; SFX.die(); endT = 1.4; endArgs = ['CAÍDO EM COMBATE', 'Viriato tombou', 'Roma não vencerá à primeira. Volta aos montes e tenta de novo.']; }
function win() { state = 'won'; SFX.horn(); endT = 1.8; endArgs = ['VITÓRIA', 'Os montes são lusitanos', 'A patrulha caiu, os mantimentos arderam e o centurião jaz no seu próprio acampamento. Esta noite, nos castros, contar-se-á o teu nome.']; }

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('resume').addEventListener('click', resume);
$('restart').addEventListener('click', startGame);
for (const b of document.querySelectorAll('[data-diff]')) b.addEventListener('click', () => { diff = +b.dataset.diff; for (const o of document.querySelectorAll('[data-diff]')) o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
const setSens = v => { sens = .0006 * v; };
$('sens').addEventListener('input', e => setSens(+e.target.value));
$('sens2').addEventListener('input', e => { setSens(+e.target.value); $('sens').value = e.target.value; });

/* =========================================================
   Main loop
   ========================================================= */
let menuT = 0;
function step(dt) {
  if (hitStopT > 0) { hitStopT -= dt; dt *= .15; } // brief impact freeze
  if (state === 'play') { updatePlayer(dt); updateEnemies(dt); updateAllies(dt); updateProjectiles(dt); updateCamera(dt); updateFlag(); updateHUD(dt); }
  else if (state === 'dead' || state === 'won') {
    if (endT > 0) { endT -= dt; if (endT <= 0 && endArgs) { endScreen(...endArgs); endArgs = null; } }
    updateEnemies(dt); updateAllies(dt); updateProjectiles(dt);
    if (state === 'dead') { P.crouch = Math.min(1.9, P.crouch + dt * 2); camera.position.y = Math.max(P.pos.y + .3, camera.position.y - dt * 2); camera.rotation.z = Math.min(.6, camera.rotation.z + dt); }
  } else if (state === 'menu') {
    menuT += dt * .04;
    const cx = CAMP.x + 20, cz = 40;
    camera.position.set(cx + Math.sin(menuT) * 90, 42, cz + Math.cos(menuT) * 90);
    camera.lookAt(cx, 8, cz - 40);
    sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 150); sun.target.position.set(cx, 0, cz);
    VM.visible = false;
  }
  if (state !== 'menu') VM.visible = view === 'first' && (state === 'play' || state === 'pause');
  updateFires(dt); updateParticles(dt); updateTrails(dt);
}
const AV = soldier('lusitano'); scene.add(AV.root); AV.root.visible = false;
let AV_FAL = null; AV.root.traverse(o => { if (o.name === 'falcata') AV_FAL = o; });
const AV_HAND = AV.rig ? AV.weapon : AV.elbows[1].children.at(-1);
// what Viriato holds for the ranged weapons: a dardo along the forearm line (hand +z, point forward) and a sling stone
const AV_JAV = new THREE.Group(), AV_STONE = new THREE.Group();
{
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, 1.35, 6), MAT('wood')); sh.rotation.x = Math.PI / 2; sh.position.z = .2; sh.castShadow = true;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.026, .17, 6), MAT('iron')); tip.rotation.x = Math.PI / 2; tip.position.z = .95; tip.castShadow = true;
  AV_JAV.add(sh, tip);
  const st = new THREE.Mesh(new THREE.SphereGeometry(.035, 8, 6), MAT('castro_stone')); st.position.set(0, -.04, .02); st.castShadow = true;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .55, 4), M(0x7a5a3a)); cord.position.set(0, -.3, 0); AV_STONE.add(st, cord);
  AV_HAND.add(AV_JAV, AV_STONE); AV_JAV.visible = AV_STONE.visible = false;
}
const avatar = { m: AV, f: P.f, yaw: 0, mv: { x: 0, z: 0 }, state: 'chase', kind: 'lusitano', stride: 0 };
R = await createRender({ THREE, renderer, scene, camera, sun, grass: GRASS, quality: resolveQuality(quality), devicePixelRatio: window.devicePixelRatio || 1 });
for (const b of document.querySelectorAll('[data-q]')) {
  b.setAttribute('aria-pressed', b.dataset.q === R.state.preset ? 'true' : 'false');
  b.addEventListener('click', () => { R.setQuality(b.dataset.q); try { window.localStorage.setItem('viriato.quality', b.dataset.q); } catch (_) {} for (const o of document.querySelectorAll('[data-q]')) o.setAttribute('aria-pressed', o.dataset.q === R.state.preset ? 'true' : 'false'); });
}
setListener(camera);
resetWorld();
$('start').disabled = false; $('start').textContent = 'COMEÇAR';
return {
  start: d => { if (d != null) diff = d; startGame(); }, step, render: () => R.render(), setQuality: q => R.setQuality(q), get quality() { return R.state.preset; }, resume, use, damagePlayer,
  P, supplyTents, heightAt, CAMP, scene, camera,
  get enemies() { return enemies; }, get allies() { return allies; }, setCompanions: n => { companions = n; }, forceDir: d => { forcedDir = d; }, get order() { return order; }, get placing() { return placing; }, flag: FLAG, flagAt, hurtAllyForTest: (a, d) => hurtAlly(a, d, a.pos.clone()), get mission() { return mission; }, get state() { return state; },
  get projectiles() { return projectiles; }, get pickups() { return pickups; },
  input: { mouse: (l, r) => { mouseL = l; mouseR = r; }, mouseMove: (dx, dy) => { C.nudgeIntent(P.intent, dx, dy); if (P.charging) { P.acc.x += dx; P.acc.y += dy; } if (P.f.phase === 'windup' && !P.f.released) { P.post.x += dx; P.post.y += dy; } } },
  studio: { pose: (e, dt) => { const b = setPose(e, dt); e.m.root.position.set(e.pos.x, e.pos.y + b, e.pos.z); e.m.root.rotation.y = e.yaw; }, freeze: () => { state = 'studio'; }, play: () => { state = 'play'; }, avatarEntity: () => avatar },
  avatar: AV, get view() { return view; }, avatarHand: () => throwOrigin(), trailCount: () => { let n = 0; for (const t of trails.values()) n += t.samples.length; return n; }, physicsOk: phys.ok, physCounts: () => phys.counts(), V3: THREE.Vector3, damageEnemyForTest: (e, d) => damageEnemy(e, d, false, e.pos.clone()), spawnEnemyJavelin, vm: { stuckVisible: () => STUCK.filter(m => m.visible).length, fal: FAL },
};
}

/** Browser entry point: real WebGL renderer + animation loop. */
export async function boot() {
  const THREE = await import('three');
  const canvas = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  let rapier = null;
  try { rapier = await withTimeout((async () => { const R = (await import('https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm')).default; await R.init(); return R; })(), 8000); }
  catch (err) { console.warn('Rapier unavailable, using simple physics', err); rapier = null; }
  renderer.useLegacyLights = true;
  const chars = await loadChars(THREE).catch(err => { console.warn('Animated characters unavailable, using simple models', err); return null; });
  const game = await createGame({ chars, THREE, renderer, canvas, document, window, rapier, loader: new THREE.TextureLoader(), quality: (() => { try { return window.localStorage.getItem('viriato.quality') || 'medium'; } catch (_) { return 'medium'; } })() });
  if (!game.physicsOk) document.getElementById('physnote').classList.remove('hidden');
  let last = 0;
  const frame = t => { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; game.step(dt); game.render(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  window.__game = game;
}

/** Load the CC0 Quaternius body, hair and animation clips (≈3 MB). */
export async function loadChars(THREE, base = 'assets/chars/') {
  const [{ GLTFLoader }, SkeletonUtils] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/utils/SkeletonUtils.js')]);
  // models ship as base64 ES modules (the host serves no other binary files); GLTFLoader parses them in memory
  const gl = new GLTFLoader(), get = async f => {
    const b64 = (await import(new URL(base + f + '.glb.js', document.baseURI).href)).default;
    const u8 = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return gl.parseAsync(u8.buffer, '');
  };
  const [body, a1, a2, hl, hb, hz] = await Promise.all(['body', 'anim_ual1', 'anim_ual2', 'hair_long', 'hair_beard', 'hair_buzzed'].map(get));
  const tl = new THREE.TextureLoader(), textures = {};
  await Promise.all(['roman_red', 'roman_white', 'roman_mail', 'velite', 'lusitano', 'lusitano_b', 'lusitano_c', 'lusitano_d'].map(async k => {
    const t = await tl.loadAsync(base + 'body_' + k + '.jpg'); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; textures[k] = t;
  }));
  return { body: body.scene, clips: [...a1.animations, ...a2.animations], hair: { hair_long: hl.scene, hair_beard: hb.scene, hair_buzzed: hz.scene }, textures, split: [null, null], clone: SkeletonUtils.clone };
}
