import { TAU, rand, rr, clamp, lerp, smooth, wrapA, setSeed, vnoise, WORLD, roadX, CAMP, CASTRO, heightAt, inCamp, addCol, resolve, losTerrain, clearColliders } from './terrain.js';
import { initAudio, SFX, spatial, setListener } from './audio.js';
import * as C from './combat.js';
import { zoneFromHeight, ZONE_MULT, LEG_SLOW } from './damage.js';
import { decide, REACH } from './ai.js';
import { loadMaterials, terrainMaterial } from './materials.js';
import { createPhysics } from './physics.js';
import { createRender } from './render.js';
import { withTimeout } from './physics.js';
import { resolveQuality } from './quality.js';

/**
 * Builds the whole game. Rendering, DOM and window are injected so the game can run headless in tests.
 * @returns game API used by boot() and by tools/smoke.mjs
 */
export async function createGame({ THREE, renderer, canvas, document, window, rapier = null, loader = null, quality = 'medium' }) {
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
  const pines = [], oaks = [], rocks = [], grass = [];
  const blocked = (x, z, m) => Math.abs(x - roadX(z)) < 7 + m || inCamp(x, z, 12 + m) || Math.hypot(x - CASTRO.x, z - CASTRO.z) < 16 + m;
  for (let n = 0; n < 1400 && pines.length + oaks.length < 520; n++) {
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
    addCol(x, z, s * .85);
  }
  for (let n = 0; n < 14000 && grass.length < 7000; n++) {
    const x = rr(-WORLD + 4, WORLD - 4), z = rr(-WORLD + 4, WORLD - 4);
    if (Math.abs(x - roadX(z)) < 3 || inCamp(x, z, 2)) continue;
    const y = heightAt(x, z); if (y > 30) continue;
    grass.push({ x, y, z, s: rr(.7, 1.4), ry: rr(0, TAU) });
  }
  const trunkG = new THREE.CylinderGeometry(.18, .3, 4, 10); trunkG.translate(0, 2, 0);
  const pineG = new THREE.ConeGeometry(2.3, 6.5, 7); pineG.translate(0, 6.2, 0);
  const pineG2 = new THREE.ConeGeometry(1.7, 4.5, 7); pineG2.translate(0, 8.6, 0);
  const oakG = new THREE.IcosahedronGeometry(2.8, 1); oakG.translate(0, 5.2, 0); oakG.scale(1.2, .85, 1.2);
  const trunkM = MAT('bark_pine');
  instanced(trunkG, trunkM, pines.concat(oaks));
  instanced(pineG, new THREE.MeshStandardMaterial({ color: 0x2f4a26, roughness: .9, flatShading: true }), pines);
  instanced(pineG2, new THREE.MeshStandardMaterial({ color: 0x36522a, roughness: .9, flatShading: true }), pines);
  instanced(oakG, new THREE.MeshStandardMaterial({ color: 0x55652c, roughness: .9, flatShading: true }), oaks);
  instanced(new THREE.DodecahedronGeometry(1, 0), MAT('terrain_rock', { flatShading: true }), rocks);
  const gg = new THREE.PlaneGeometry(.9, .7); gg.translate(0, .35, 0);
  const gg2 = gg.clone(); gg2.rotateY(Math.PI / 2);
  const grassGeo = mergeGeos([gg, gg2]);
  GRASS = instanced(grassGeo, new THREE.MeshStandardMaterial({ color: 0x7c8040, roughness: 1, side: THREE.DoubleSide }), grass, false);
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
  const tunic = mm(kind === 'velite' ? 'wool_brown' : 'wool_red'), armor = mm('iron'), skin = mm('skin'),
        helm = mm(kind === 'centurion' ? 'bronze' : 'iron'), metal = mm('iron', { roughness: .3 }), leather = mm('leather'),
        shieldM = mm(kind === 'velite' ? 'leather' : 'canvas_red', { side: THREE.DoubleSide }), gold = mm('bronze'),
        crestM = mm('wool_red'), fur = mm('wool_brown'), wood = mm('wood');
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; (p || root).add(o); return o; };
  const CAP = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
  // legs: thigh, shin, caliga (sandal-boot)
  const legs = [];
  for (const sx of [-.12, .12]) {
    const hip = new THREE.Group(); hip.position.set(sx, .92, 0); root.add(hip);
    add(CAP(.075, .3), skin, 0, -.22, 0, hip);
    add(CAP(.062, .32), skin, 0, -.6, .01, hip);
    add(new THREE.CylinderGeometry(.075, .085, .16, 12), leather, 0, -.82, .02, hip);
    add(new THREE.BoxGeometry(.12, .06, .24), leather, 0, -.89, .05, hip);
    legs.push(hip);
  }
  // body
  const torso = new THREE.CylinderGeometry(.25, .28, .62, 20); torso.scale(1, 1, .72);
  add(torso, tunic, 0, 1.3, 0);
  const skirt = new THREE.CylinderGeometry(.28, .33, .28, 20, 1, true); skirt.scale(1, 1, .75);
  add(skirt, tunic, 0, .95, 0).material.side = THREE.DoubleSide;
  if (kind !== 'velite') {
    for (let k = 0; k < 5; k++) { const b = new THREE.CylinderGeometry(.285 - k * .004, .3 - k * .004, .075, 20, 1, true); b.scale(1, 1, .76); add(b, armor, 0, 1.12 + k * .08, 0); }
    for (const sx of [-1, 1]) { const sp = new THREE.SphereGeometry(.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2); sp.scale(1, .55, 1.1); add(sp, armor, sx * .24, 1.56, 0); }
    // pteruges: leather strips over the skirt
    for (let k = 0; k < 8; k++) { const a = (k / 8 - .5) * 1.6; add(new THREE.BoxGeometry(.05, .22, .015), leather, Math.sin(a) * .29, .96, Math.cos(a) * .22 + .02).rotation.y = a; }
  }
  const belt = new THREE.TorusGeometry(.27, .025, 6, 24); belt.rotateX(Math.PI / 2); belt.scale(1, 1, .76);
  add(belt, leather, 0, 1.06, 0);
  // head
  const head = new THREE.Group(); head.position.set(0, 1.66, 0); root.add(head);
  add(new THREE.CylinderGeometry(.06, .07, .1, 10), skin, 0, .03, 0, head);
  const hg = new THREE.SphereGeometry(.12, 14, 10); hg.scale(.95, 1.1, 1); add(hg, skin, 0, .18, .01, head);
  add(new THREE.ConeGeometry(.025, .06, 6), skin, 0, .17, .125, head).rotation.x = Math.PI / 2; // nose
  if (kind === 'velite') {
    const hood = new THREE.SphereGeometry(.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * .62); add(hood, fur, 0, .2, -.02, head);
    const pelt = new THREE.ConeGeometry(.16, .3, 12, 1, true); add(pelt, fur, 0, .02, -.12, head).rotation.x = .5;
  } else {
    const cap = new THREE.SphereGeometry(.14, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); add(cap, helm, 0, .22, 0, head);
    const ng = new THREE.CylinderGeometry(.15, .19, .07, 18, 1, true, Math.PI * .65, Math.PI * .7); add(ng, helm, 0, .2, 0, head).material.side = THREE.DoubleSide;
    add(new THREE.BoxGeometry(.02, .015, .2), helm, 0, .24, .07, head); // brow ridge
    for (const sx of [-1, 1]) { const cg = new THREE.BoxGeometry(.015, .15, .09); add(cg, helm, sx * .125, .13, .05, head).rotation.z = sx * .08; }
    if (kind === 'centurion') { const crest = new THREE.TorusGeometry(.17, .035, 8, 28, Math.PI); add(crest, crestM, 0, .3, 0, head); }
    else add(new THREE.CylinderGeometry(.015, .025, .06, 8), helm, 0, .37, 0, head);
  }
  // arms: upper arm, forearm, hand
  const arms = [];
  for (const sx of [-.34, .34]) {
    const sh = new THREE.Group(); sh.position.set(sx, 1.56, 0); root.add(sh);
    add(CAP(.058, .2), kind === 'velite' ? skin : armor, 0, -.15, 0, sh);
    add(CAP(.05, .2), skin, 0, -.42, 0, sh);
    add(new THREE.CylinderGeometry(.055, .055, .08, 10), leather, 0, -.48, 0, sh); // bracer
    add(new THREE.SphereGeometry(.05, 10, 8), skin, 0, -.58, 0, sh);
    arms.push(sh);
  }
  const hand = new THREE.Group(); hand.position.set(0, -.6, 0); arms[1].add(hand);
  if (kind === 'velite') {
    const jv = add(new THREE.CylinderGeometry(.015, .015, 1.5, 6), wood, 0, 0, .25, hand); jv.rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.03, .16, 8), metal, 0, 0, 1.06, hand).rotation.x = Math.PI / 2;
    const pa = add(new THREE.CylinderGeometry(.36, .36, .04, 28), shieldM, -.36, 1.15, .28); pa.rotation.x = Math.PI / 2;
    const rim = new THREE.TorusGeometry(.36, .015, 6, 28); add(rim, metal, -.36, 1.15, .3);
    add(new THREE.SphereGeometry(.07, 12, 8), metal, -.36, 1.15, .31);
  } else {
    // gladius: leaf blade, guard, grip, pommel — blade points forward (+z)
    const bs = new THREE.Shape(); bs.moveTo(-.025, 0); bs.lineTo(.025, 0); bs.lineTo(.028, .38); bs.lineTo(.0, .5); bs.lineTo(-.028, .38); bs.closePath();
    const bg = new THREE.ExtrudeGeometry(bs, { depth: .008, bevelEnabled: true, bevelThickness: .003, bevelSize: .004, bevelSegments: 2, curveSegments: 4 });
    const blade = add(bg, metal, 0, -.02, .1, hand); blade.rotation.x = Math.PI / 2;
    add(new THREE.BoxGeometry(.12, .035, .045), gold, 0, -.02, .08, hand);
    const grip = add(new THREE.CylinderGeometry(.016, .016, .1, 10), wood, 0, -.02, .02, hand); grip.rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(.03, 12, 8), gold, 0, -.02, -.04, hand);
    // curved scutum
    const sc = new THREE.Group(); sc.position.set(-.3, 1.12, .3); root.add(sc);
    const sg = new THREE.CylinderGeometry(.62, .62, 1.08, 20, 2, true, -.6, 1.2); sg.translate(0, 0, -.62);
    add(sg, shieldM, 0, 0, 0, sc);
    const inner = new THREE.CylinderGeometry(.6, .6, 1.06, 24, 1, true, -.59, 1.18); inner.translate(0, 0, -.62); add(inner, wood, 0, 0, 0, sc).material.side = THREE.BackSide;
    for (const y of [-.53, .53]) { const e = new THREE.TorusGeometry(.62, .012, 4, 16, 1.2); e.rotateX(Math.PI / 2); e.rotateY(Math.PI / 2 - .6); e.translate(0, y, -.62); add(e, gold, 0, 0, 0, sc); }
    const boss = new THREE.SphereGeometry(.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2); boss.rotateX(Math.PI / 2); add(boss, gold, 0, 0, .01, sc);
    add(new THREE.BoxGeometry(.04, .9, .02), gold, 0, 0, .005, sc);
    root.userData.scutum = sc;
  }
  return { root, legs, arms, head, mats };
}

/* =========================================================
   Viewmodel (first-person weapons)
   ========================================================= */
const VM = new THREE.Group(); camera.add(VM);
const vmMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .6, metalness: c === 0xd9d4c8 || c === 0xcfc9bb ? .8 : 0, fog: false });
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
SHD.userData.idle = { x: -.5, y: -.46, z: -.62, ry: .5 };
SHD.userData.block = { x: -.12, y: -.24, z: -.42, ry: .05 };
SHD.userData.bash = { x: -.1, y: -.26, z: -.7, ry: 0 };
const STUCK = [0, 1, 2].map(i => { const g = new THREE.Group(); const sh = vmMesh(new THREE.CylinderGeometry(.008, .008, .7, 5), 0x6e5032, 0, 0, .35, g); sh.rotation.x = Math.PI / 2; g.position.set(-.12 + i * .11, .06 - i * .09, .02); g.rotation.set(.25 - i * .2, .3 - i * .25, 0); g.visible = false; SHD.add(g); return g; });
// first-person falcata poses: p = position, r = rotation (x,y,z)
const FAL_POSE = {
  idle: { p: [.34, -.36, -.55], r: [-.25, -.2, -.35] },
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
let enemies = [], projectiles = [], pickups = [];
let mission = 0, tentsBurnt = 0, missionMsgT = 0, alarm = false;
Object.defineProperty(P, 'st', { get() { return P.f.stamina; }, set(v) { P.f.stamina = v; }, enumerable: false });
Object.defineProperty(P, 'block', { get() { return P.f.blocking != null; }, enumerable: false });
const keys = {}; let mouseL = false, mouseR = false;

function resetWorld() {
  // clear dynamic objects
  for (const e of enemies) { scene.remove(e.m.root); if (e.corpse) phys.removeCorpse(e.corpse); }
  for (const p of projectiles) phys.remove(p.pid);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  enemies = []; projectiles = []; pickups = [];
  for (const p of particles) { p.live = false; p.s.visible = false; } particles.length = 0;
  for (const t of supplyTents) { t.burnt = false; t.t = 0; t.mat.color.setHex(0xc9b68c); t.light.intensity = 0; t.flag.visible = true; }
  setSeed(4242);
  endT = 0; endArgs = null;
  Object.assign(P, { f: C.createFighter(), charging: false, chargeT: 0, acc: { x: 0, y: 0 }, prevL: false, swingDir: null, bashCd: 0, bashT: 0, cleanT: 0,
    lastDefense: null, incomingDir: null, vy: 0, hp: 100, ground: true, crouch: 0, w: 0, dardos: 5, pedras: 12, atk: 0, cd: 0,
    kills: 0, shots: 0, hits: 0, heads: 0, time: 0, swing: 0, throwT: 0, hurtT: 0 });
  P.pos.set(CASTRO.x - 9, 0, CASTRO.z - 5); P.pos.y = heightAt(P.pos.x, P.pos.z);
  P.yaw = Math.PI * .28; P.pitch = -.05;
  mission = 0; tentsBurnt = 0; alarm = false;
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
  const m = makeSoldier(kind === 'legio' ? 'legio' : kind);
  scene.add(m.root);
  const stats = { legio: { hp: 100, sp: 3.9, dmg: 13 }, velite: { hp: 65, sp: 3.7, dmg: 15 }, centurion: { hp: 460, sp: 4.4, dmg: 24 } }[kind];
  const e = { kind, m, pos: new THREE.Vector3(x, heightAt(x, z), z), hp: stats.hp, maxhp: stats.hp, sp: stats.sp, dmg: stats.dmg,
    state: group === 'patrol' ? 'march' : group === 'boss' ? 'chase' : 'guard', group, yaw: Math.PI, home: new THREE.Vector3(x, 0, z),
    dir: -1, aware: 0, atkT: 0, f: C.createFighter({ shieldHP: kind === 'velite' ? 0 : 220, stamina: kind === 'centurion' ? 140 : 100 }), aiT: rr(0, .3), act: 'approach', releaseAt: 0, feintAt: 0, blockLeft: 0, slowT: 0, cd: rr(.5, 1.5), ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, wander: null, wT: 0, strafe: rand() < .5 ? 1 : -1, moving: 0, barkT: 0 };
  if (group === 'patrol') { e.yaw = 0; e.dir = 1; } // marching south (+z)
  enemies.push(e); return e;
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
  if (e.code === 'KeyR') cleanShield();
  if (e.code === 'Space') e.preventDefault();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('mousemove', e => {
  if (state !== 'play' || document.pointerLockElement !== cv) return;
  P.yaw -= e.movementX * sens; P.pitch = clamp(P.pitch - e.movementY * sens, -1.45, 1.45);
  if (P.charging) { P.acc.x += e.movementX; P.acc.y += e.movementY; }
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
  if (P.w === 1) {
    if (P.dardos <= 0) { showPrompt('Sem dardos — apanha-os do chão', 1.2); return; }
    P.dardos--; P.cd = .85; P.throwT = 1; P.shots++; SFX.throwJ();
    const f = fwd3(), e = eyePos();
    const right = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const start = e.clone().addScaledVector(right, .22).add(V(0, -.08, 0)).addScaledVector(f, .5);
    spawnProj('javelin', start, f.multiplyScalar(36).add(V(0, 1.4, 0)), 'player');
    makeNoise(16);
  } else {
    if (P.pedras <= 0) { showPrompt('Sem pedras para a funda', 1.2); return; }
    P.pedras--; P.cd = .75; P.throwT = 1; P.shots++; SFX.sling();
    const f = fwd3(), e = eyePos();
    spawnProj('stone', e.clone().addScaledVector(f, .4).add(V(0, -.05, 0)), f.multiplyScalar(50).add(V(0, .8, 0)), 'player');
    makeNoise(11);
  }
  updateHUDWeapon();
}
const deg = r => r * 180 / Math.PI;
const flatFwd = () => V(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
/** Player falcata strike lands (called from the fighter's 'strike' event). */
function meleeStrike(dir, power) {
  if (state !== 'play') return;
  P.swing = 1; P.swingDir = dir; SFX.swing();
  const f = flatFwd(), reach = dir === 'thrust' ? 3.2 : 2.8;
  let hitAny = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z), dist = d.length();
    if (dist > reach || Math.abs(e.pos.y - P.pos.y) > 1.8) continue;
    d.normalize(); if (d.dot(f) < (dir === 'thrust' ? .8 : .45)) continue;
    hitAny = true;
    const ef = V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    const fromAngle = deg(Math.acos(clamp(ef.dot(d.clone().negate()), -1, 1)));
    const unaware = e.state === 'march' || e.state === 'guard';
    const at = V(e.pos.x - d.x * .4, e.pos.y + 1.2, e.pos.z - d.z * .4);
    if (unaware && fromAngle > 90) { damageEnemy(e, 40 * C.DMG[dir] * power * 3.5, false, at, 'golpe furtivo'); continue; }
    const res = C.resolveHit(e.f, { dir, power, fromAngle, baseDamage: 40 });
    if (res.result === 'parried') { C.stagger(P.f, res.attackerStagger); SFX.clank(); burst('spark', at, 12); showPrompt('O romano aparou o teu golpe!', .9); }
    else if (res.result === 'blocked') { SFX.clank(); burst('spark', at, 8); e.flash = .05; }
    else {
      const hRel = clamp(.62 + P.pitch * .6 + (dir === 'up' ? .12 : 0), 0, 1), zone = zoneFromHeight(hRel);
      if (res.result === 'guardBroken') feed('Quebraste-lhe a guarda');
      if (zone === 'legs') e.slowT = LEG_SLOW.time;
      damageEnemy(e, res.damage * ZONE_MULT[zone], zone === 'head', V(e.pos.x, e.pos.y + 1.85 * hRel, e.pos.z));
    }
    alert(e);
  }
  makeNoise(hitAny ? 14 : 6);
}
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
function enemyStrike(e, ev) {
  const dd = V(P.pos.x - e.pos.x, 0, P.pos.z - e.pos.z), pd = dd.length(); dd.normalize();
  const ef = V(Math.sin(e.yaw), 0, Math.cos(e.yaw));
  if (state !== 'play' || pd > 2.7 || ef.dot(dd) < .4 || Math.abs(P.pos.y - e.pos.y) > 1.8) { SFX.swing(); return; }
  const fromAngle = deg(Math.acos(clamp(flatFwd().dot(dd.clone().negate()), -1, 1)));
  const res = C.resolveHit(P.f, { dir: ev.dir, power: ev.power, fromAngle, baseDamage: e.dmg * DIFF[diff].dmg });
  P.lastDefense = res.result;
  const spark = eyePos().addScaledVector(flatFwd(), .6).add(V(0, -.3, 0));
  if (res.result === 'parried') { C.stagger(e.f, res.attackerStagger); SFX.clank(); burst('spark', spark, 14); showPrompt('Aparo perfeito!', .8); }
  else if (res.result === 'blocked') { SFX.clank(); burst('spark', spark, 8); P.shake = .18; }
  if (res.result === 'guardBroken') showPrompt('Guarda quebrada!', 1);
  if (res.damage > 0) { hurtPlayer(res.damage, e.pos); burst('blood', eyePos().add(V(0, -.4, 0)), 3); }
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
  projectiles.push({ type, mesh, pid: phys.addProjectile(pos, vel, type), pos: pos.clone(), prev: pos.clone(), vel, owner, dmg: dmg || 0, life: 7, stuck: false, stuckT: 0 });
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
function damageEnemy(e, dmg, head, where, special) {
  e.hp -= dmg; e.flash = .15; burst('blood', where, head ? 14 : 8);
  SFX.flesh(); alert(e);
  hitmT = .18; $('hitm').className = head ? 'head' : ''; $('hitm').style.opacity = 1;
  if (head) P.heads++;
  if (e.hp <= 0) {
    e.dead = true; e.deadT = 0; P.kills++; SFX.die(spatial(e.pos));
    { const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z).normalize(); e.corpse = phys.addCorpse(e.pos, e.yaw, { x: d.x, y: .3, z: d.z }); }
    const name = { legio: 'Legionário', velite: 'Vélite', centurion: 'Centurião' }[e.kind];
    feed(`${name} abatido${special ? ' — ' + special : head ? ' — na cabeça' : ''}`);
    if (e.kind !== 'centurion' && rand() < .4) addPickup(rand() < .5 ? 'odre' : (rand() < .5 ? 'dardos' : 'pedras'), e.pos.x + rr(-.6, .6), e.pos.z + rr(-.6, .6));
    // the fallen alert their comrades
    for (const o of enemies) if (!o.dead && o.pos.distanceTo(e.pos) < 22) alert(o);
    checkMission();
  } else { if (rand() < .5) SFX.grunt(spatial(e.pos)); }
}
function damagePlayer(dmg, from, ranged) {
  if (state !== 'play') return;
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
  if (behind && d > (P.crouch > .5 ? 1.5 : 3)) return 0;
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
// Readable, direction-specific poses: the raised gladius shows where the blow will come from (player's view).
const WINDUP_POSE = { up: { x: -2.8, z: 0 }, left: { x: -1.5, z: 1.3 }, right: { x: -1.5, z: -1.1 }, thrust: { x: .7, z: .2 } };
const STRIKE_POSE = { up: { x: .5, z: 0 }, left: { x: -1.2, z: -.7 }, right: { x: -1.2, z: .9 }, thrust: { x: -1.6, z: 0 } };
function setPose(e, w, dt) {
  const arm = e.m.arms[1], f = e.f, k = Math.min(1, dt * 12);
  let tx = w * .5 - (e.state === 'chase' ? .5 : 0), tz = 0;
  if (f.phase === 'windup') { const p = WINDUP_POSE[f.dir], q = Math.min(1, f.t / (C.WINDUP[f.dir] * .7)); tx = p.x * q; tz = p.z * q; }
  else if (f.phase === 'recovery' && f.dir) { const p = STRIKE_POSE[f.dir]; tx = p.x; tz = p.z; }
  arm.rotation.x = lerp(arm.rotation.x, tx, f.phase === 'recovery' ? Math.min(1, dt * 30) : k);
  arm.rotation.z = lerp(arm.rotation.z, tz, f.phase === 'recovery' ? Math.min(1, dt * 30) : k);
  const sc = e.m.root.userData.scutum;
  if (sc) { const b = f.blocking === 'shield'; sc.position.x = lerp(sc.position.x, b ? -.04 : -.3, k); sc.position.y = lerp(sc.position.y, b ? 1.28 : 1.12, k); sc.position.z = lerp(sc.position.z, b ? .4 : .3, k); }
}
function updateEnemies(dt) {
  const dm = DIFF[diff];
  for (const e of enemies) {
    const r = e.m.root;
    if (e.dead) {
      e.deadT += dt;
      if (phys.ok && e.corpse) {
        if (e.deadT >= 6) { phys.removeCorpse(e.corpse); e.corpse = null; } // settled: freeze the pose, free the body
        else { const t = phys.getTransform(e.corpse); r.quaternion.set(t.q.x, t.q.y, t.q.z, t.q.w); r.position.set(0, -.9, 0).applyQuaternion(r.quaternion).add(V(t.p.x, t.p.y, t.p.z)); }
      } else if (e.deadT < 1) { r.rotation.x = -Math.PI / 2 * smooth(0, .7, e.deadT); r.position.y = e.pos.y + .15 * smooth(0, .7, e.deadT); }
      for (const m of e.m.mats) m.emissive.setRGB(0, 0, 0);
      continue;
    }
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
      faceTo(e, P.pos.x, P.pos.z, dt, e.f.phase === 'windup' ? 3.5 : 7);
      const slow = e.slowT > 0 ? LEG_SLOW.factor : 1; e.slowT -= dt;
      e.blockLeft -= dt; e.aiT -= dt;
      // raise the scutum against missiles while closing in, or when the AI chose to block
      if (e.f.phase === 'idle') {
        const want = e.blockLeft > 0 || (pd > 3.5 && P.w !== 0);
        if (want && !e.f.blocking) C.beginBlock(e.f, 'shield'); else if (!want && e.f.blocking) C.endBlock(e.f);
      }
      if (e.aiT <= 0 && state === 'play' && e.f.phase === 'idle') {
        e.aiT = e.kind === 'centurion' ? .18 : .26;
        const attackersNow = enemies.filter(o => o !== e && !o.dead && o.kind !== 'velite' && o.f.phase === 'windup').length;
        e.act = decide({ kind: e.kind, fighter: e.f }, { dist: pd, playerFighter: P.f, difficulty: diff, attackersNow, rng: rand });
        if (e.act.startsWith('attack:')) { const dir = e.act.slice(7); C.endBlock(e.f); if (C.beginAttack(e.f, dir)) { e.releaseAt = C.WINDUP[dir] + rr(0, .25) * (e.kind === 'centurion' ? .4 : 1); e.feintAt = 0; } }
        else if (e.act === 'block') e.blockLeft = rr(.5, .9);
        else if (e.act === 'feint') { C.endBlock(e.f); if (C.beginAttack(e.f, C.DIRS[Math.floor(rand() * 4)])) { e.feintAt = rr(.15, .3); e.releaseAt = 99; } }
      }
      if (e.f.phase === 'windup') {
        if (e.feintAt && e.f.t >= e.feintAt) { C.feint(e.f); e.feintAt = 0; }
        else if (!e.f.released && e.f.t >= e.releaseAt) C.releaseAttack(e.f);
      }
      if (e.f.phase === 'idle' || e.f.phase === 'recovery') {
        const sp = e.sp * slow * (e.f.blocking ? .6 : 1);
        if (pd > REACH - .3) {
          const off = (e.strafe * .9) * clamp((pd - 2) / 6, 0, 1);
          const ang = Math.atan2(P.pos.x - e.pos.x, P.pos.z - e.pos.z) + off * .5;
          speed = moveEnemy(e, e.pos.x + Math.sin(ang) * 3, e.pos.z + Math.cos(ang) * 3, sp * (pd > 25 ? 1.15 : 1), dt);
        } else if (e.act === 'circle') {
          const a = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z) + e.strafe * .9 * dt;
          speed = moveEnemy(e, P.pos.x + Math.sin(a) * 2.6, P.pos.z + Math.cos(a) * 2.6, 1.8 * slow, dt);
        }
      }
      for (const ev of C.tickFighter(e.f, dt)) if (ev.type === 'strike') enemyStrike(e, ev);
      if (e.kind === 'centurion' && e.barkT <= 0) { e.barkT = 6; SFX.grunt(spatial(e.pos)); for (const o of enemies) if (!o.dead && o.pos.distanceTo(e.pos) < 30) alert(o); }
    } else if (e.state === 'skirmish') {
      if (e.alarmT != null && e.alarmT > 0) { e.alarmT -= dt; if (e.alarmT <= 0) raiseAlarm(); }
      faceTo(e, P.pos.x, P.pos.z, dt, 6);
      const sees = losTerrain(e.pos.x, e.pos.y + 1.7, e.pos.z, P.pos.x, P.pos.y + 1.4, P.pos.z);
      if (pd < 11) { const a = Math.atan2(e.pos.x - P.pos.x, e.pos.z - P.pos.z); speed = moveEnemy(e, e.pos.x + Math.sin(a) * 3, e.pos.z + Math.cos(a) * 3, e.sp, dt); }
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
      } else if (sees && pd < 34 && e.cd <= 0 && state === 'play') { e.atkT = .55; e.cd = rr(2.2, 3.6); }
    }
    // separation
    for (const o of enemies) {
      if (o === e || o.dead) continue;
      const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.1 && d > 1e-3) { e.pos.x += dx / d * (1.1 - d) * .5; e.pos.z += dz / d * (1.1 - d) * .5; }
    }
    // keep off the player
    if (pd < 1.0 && pd > 1e-3) { e.pos.x -= (P.pos.x - e.pos.x) / pd * (1 - pd); e.pos.z -= (P.pos.z - e.pos.z) / pd * (1 - pd); }
    resolve(e.pos, .4);
    e.pos.y = heightAt(e.pos.x, e.pos.z);
    // animate
    e.moving = lerp(e.moving, speed > 0 ? 1 : 0, Math.min(1, dt * 8));
    const w = Math.sin(e.ph * (speed > 2.5 ? 10 : 6.5)) * .6 * e.moving;
    e.m.legs[0].rotation.x = w; e.m.legs[1].rotation.x = -w;
    e.m.arms[0].rotation.x = -w * .5;
    if (e.kind === 'velite' && e.atkT > 0) {
      const k = 1 - e.atkT / .55;
      e.m.arms[1].rotation.x = k < .7 ? lerp(0, -2.5, k / .7) : lerp(-2.5, .4, (k - .7) / .3);
    } else setPose(e, w, dt);
    r.position.set(e.pos.x, e.pos.y + Math.abs(w) * .04, e.pos.z); r.rotation.y = e.yaw;
    r.rotation.x = e.f.phase === 'staggered' ? lerp(r.rotation.x, -.22, Math.min(1, dt * 10)) : lerp(r.rotation.x, 0, Math.min(1, dt * 6));
  }
}

/* =========================================================
   Player update
   ========================================================= */
function updatePlayer(dt) {
  P.time += dt;
  const sprint = (keys.ShiftLeft || keys.ShiftRight) && P.st > 1 && !P.block;
  const crouchKey = keys.KeyC || keys.ControlLeft;
  P.crouch = lerp(P.crouch, crouchKey ? 1 : 0, Math.min(1, dt * 10));
  let mx = 0, mz = 0;
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  if (keys.KeyW || keys.ArrowUp) { mx += fx; mz += fz; }
  if (keys.KeyS || keys.ArrowDown) { mx -= fx; mz -= fz; }
  if (keys.KeyD || keys.ArrowRight) { mx += rx; mz += rz; }
  if (keys.KeyA || keys.ArrowLeft) { mx -= rx; mz -= rz; }
  const ml = Math.hypot(mx, mz);
  let speed = 5.2;
  if (P.crouch > .5) speed = 2.6; else if (sprint && ml > 0) speed = 8.6;
  if (P.block) speed *= .55;
  if (ml > 0) {
    const ox = P.pos.x, oz = P.pos.z;
    P.pos.x += mx / ml * speed * dt; P.pos.z += mz / ml * speed * dt;
    // steep climb check
    const nh = heightAt(P.pos.x, P.pos.z), oh = heightAt(ox, oz);
    if (P.ground && (nh - oh) / (speed * dt) > 1.6) { P.pos.x = ox; P.pos.z = oz; }
    resolve(P.pos, .38);
    if (P.ground) { P.bob += dt * speed * 1.6; P.stepT -= dt * speed; if (P.stepT <= 0) { P.stepT = 2.4; SFX.step(); } }
  }
  if (sprint && ml > 0) P.st = Math.max(0, P.st - dt * 36);
  if (keys.Space && P.ground && P.st > 10) { P.vy = 6.4; P.ground = false; P.st -= 8; }
  P.vy -= 19 * dt; P.pos.y += P.vy * dt;
  const gh = heightAt(P.pos.x, P.pos.z);
  if (P.pos.y <= gh) { if (!P.ground && P.vy < -12) damagePlayer((-P.vy - 12) * 4, P.pos, true); P.pos.y = gh; P.vy = 0; P.ground = true; }
  else if (P.pos.y - gh > .25) P.ground = false;

  // combat
  P.cd = Math.max(0, P.cd - dt); P.bashCd = Math.max(0, P.bashCd - dt); P.bashT = Math.max(0, P.bashT - dt);
  if (P.cleanT > 0) { P.cleanT -= dt; if (P.cleanT <= 0) { P.f.stuckJavelins = 0; feed('Escudo limpo'); } }
  // press / release edges of the left button
  if (mouseL && !P.prevL) {
    if (P.w === 0) { P.charging = true; P.chargeT = 0; P.acc.x = 0; P.acc.y = 0; }
    else attack();
  }
  const released = !mouseL && P.prevL; P.prevL = mouseL;
  if (P.charging) {
    P.chargeT += dt;
    if (P.f.phase !== 'windup' && (P.chargeT >= .12 || released)) {
      if (!C.beginAttack(P.f, C.dirFromMouse(P.acc.x, P.acc.y))) P.charging = false;
    }
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
  for (const ev of C.tickFighter(P.f, dt)) if (ev.type === 'strike') meleeStrike(ev.dir, ev.power);
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
  camera.rotation.set(P.pitch + shake, P.yaw, shake * .5);
  // viewmodel
  FAL.visible = P.w === 0; JAV.visible = P.w === 1 && (P.dardos > 0 || P.throwT > 0); SLG.visible = P.w === 2;
  SHD.visible = P.w !== 2 && P.f.shieldHP > 0;
  STUCK.forEach((m, i) => { m.visible = i < P.f.stuckJavelins; });
  const sx = Math.cos(P.bob) * .012, sy = Math.abs(Math.sin(P.bob)) * .014;
  if (P.w === 0) {
    const b = FAL.userData.base, f = P.f;
    let t = FAL_POSE.idle;
    if (f.blocking === 'sword') t = FAL_POSE['block_' + (P.incomingDir || 'up')];
    else if (f.phase === 'windup') t = FAL_POSE['wind_' + f.dir];
    else if (f.phase === 'recovery' && f.dir) t = FAL_POSE['hit_' + f.dir];
    else if (f.phase === 'staggered') t = FAL_POSE.stagger;
    const k = Math.min(1, dt * (f.phase === 'recovery' ? 26 : 12));
    FAL.position.set(lerp(FAL.position.x, t.p[0] + sx, k), lerp(FAL.position.y, t.p[1] - sy, k), lerp(FAL.position.z, t.p[2], k));
    FAL.rotation.set(lerp(FAL.rotation.x, t.r[0], k), lerp(FAL.rotation.y, t.r[1], k), lerp(FAL.rotation.z, t.r[2], k));
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
  $('incoming').textContent = P.incomingDir ? ARW[P.incomingDir] : '';
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
  if (state === 'play') { updatePlayer(dt); updateEnemies(dt); updateProjectiles(dt); updateCamera(dt); updateHUD(dt); }
  else if (state === 'dead' || state === 'won') {
    if (endT > 0) { endT -= dt; if (endT <= 0 && endArgs) { endScreen(...endArgs); endArgs = null; } }
    updateEnemies(dt); updateProjectiles(dt);
    if (state === 'dead') { P.crouch = Math.min(1.9, P.crouch + dt * 2); camera.position.y = Math.max(P.pos.y + .3, camera.position.y - dt * 2); camera.rotation.z = Math.min(.6, camera.rotation.z + dt); }
  } else if (state === 'menu') {
    menuT += dt * .04;
    const cx = CAMP.x + 20, cz = 40;
    camera.position.set(cx + Math.sin(menuT) * 90, 42, cz + Math.cos(menuT) * 90);
    camera.lookAt(cx, 8, cz - 40);
    sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 150); sun.target.position.set(cx, 0, cz);
    VM.visible = false;
  }
  if (state !== 'menu') VM.visible = state === 'play' || state === 'pause';
  updateFires(dt); updateParticles(dt);
}
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
  get enemies() { return enemies; }, get mission() { return mission; }, get state() { return state; },
  get projectiles() { return projectiles; }, get pickups() { return pickups; },
  input: { mouse: (l, r) => { mouseL = l; mouseR = r; }, mouseMove: (dx, dy) => { if (P.charging) { P.acc.x += dx; P.acc.y += dy; } } },
  physicsOk: phys.ok, physCounts: () => phys.counts(), V3: THREE.Vector3, damageEnemyForTest: (e, d) => damageEnemy(e, d, false, e.pos.clone()), spawnEnemyJavelin, vm: { stuckVisible: () => STUCK.filter(m => m.visible).length },
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
  const game = await createGame({ THREE, renderer, canvas, document, window, rapier, loader: new THREE.TextureLoader(), quality: (() => { try { return window.localStorage.getItem('viriato.quality') || 'medium'; } catch (_) { return 'medium'; } })() });
  if (!game.physicsOk) document.getElementById('physnote').classList.remove('hidden');
  let last = 0;
  const frame = t => { const dt = Math.min(.05, (t - last) / 1000 || 0); last = t; game.step(dt); game.render(); requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  window.__game = game;
}
