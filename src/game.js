import { solidAt, TAU, rand, rr, clamp, lerp, smooth, wrapA, setSeed, vnoise, WORLD, roadX, CAMP, CASTRO, heightAt, inCamp, addCol, resolve, losTerrain, clearColliders } from './terrain.js';
import { initAudio, SFX, spatial, setListener } from './audio.js';
import * as C from './combat.js';
import { zoneFromHeight, ZONE_MULT, LEG_SLOW } from './damage.js';
import { decide, REACH } from './ai.js';
import { staminaUse, steer, footwork, playerSpeed } from './locomotion.js';
import { cullChunks, cullCharacters } from './chunks.js';
import { newFps, tickFps } from './fps.js';
import { shouldPose } from './lod.js';
import { papilioGeo } from './props.js';
import { makeWind } from './wind.js';
import { loadMaterials, terrainMaterial, makeMailMaps, loadFoliage, makeGrassMaterial } from './materials.js';
import { createPhysics } from './physics.js';
import { createRender } from './render.js';
import { withTimeout } from './physics.js';
import { sweepHit, capsuleOf, glance, bladeSegment, toWorld, bladeDir } from './swing.js';
import { resolveQuality } from './quality.js';
import { makeRig, driveRig, weaveTexture, slimBody } from './rig.js';
import { followSlot, pickFoe, pickTarget, allyAct, holdSlot, aimGround, allyLook } from './ally.js';
import { JAVELINS, throwPower, allyThrows, veliteState } from './missiles.js';
import { haltLayout, isFighter, companionsFrom, canLeave, alertRadius, REINFORCE_AFTER, RELIEF, CUT_TIME, FREE_TO_LEAVE } from './captives.js';
import { installHook } from './hook.js';
import { createCampaignUI } from './campaign/ui.js';
import { campStart, campGarrison, campPhase, CAMP_MISSIONS, TENTS_TO_BURN, RELIEF_GUARD } from './camp.js';

/**
 * Builds the whole game. Rendering, DOM and window are injected so the game can run headless in tests.
 * @returns game API used by boot() and by tools/smoke.mjs
 */
export async function createGame({ THREE, renderer, canvas, document, window, rapier = null, loader = null, quality = 'medium', chars = null, storage = (() => { try { return window.localStorage; } catch (_) { return null; } })() }) {
clearColliders();
const $ = id => document.getElementById(id);

/* =========================================================
   Renderer, scene, light
   ========================================================= */
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const FOG = 0xb7c2bf;   // the damp blue-grey haze of the Beira hills
scene.fog = new THREE.FogExp2(FOG, .017);   // thick hill mist: nothing is seen past ~120 m, so nothing is drawn past it either
scene.background = new THREE.Color(FOG);
const FOG_BASE = scene.fog.density;
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, .05, 132);
camera.rotation.order = 'YXZ';
scene.add(camera);
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); if (R) R.resize(window.innerWidth, window.innerHeight); });
let R = null, GRASS = null;

scene.add(new THREE.HemisphereLight(0xc9dcff, 0x5a4630, .62));
const sun = new THREE.DirectionalLight(0xffdcae, 1.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 300 });   // the mist hides the distance: spend the shadow map on what is near
sun.shadow.bias = -.0006;
sun.shadow.normalBias = .035;   // thin canvas and leaf cards shadow-acne into black without this: offset the lookup along the normal
scene.add(sun); scene.add(sun.target);
const SUN_DIR = new THREE.Vector3(-.55, .62, .56).normalize();

// sky dome
{
  const g = new THREE.SphereGeometry(190, 32, 16);
  const pos = g.attributes.position, cols = [];
  const top = new THREE.Color(0x7f9bb5), hor = new THREE.Color(FOG), low = new THREE.Color(0x8f9a86), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 190;
    if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 1.7));   // the mist reaches well up the sky else c.copy(hor).lerp(low, Math.min(1, -y * 4));
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
// low cloud lying on the hilltops all round the valley: the summits stay hidden
{
  const mist = new THREE.SpriteMaterial({ map: DOT, color: 0xd3d9d8, transparent: true, opacity: .62, depthWrite: false, fog: false });
  setSeed(424);
  for (let i = 0; i < 110; i++) {
    const a = rand() * TAU, r = 105 + rand() * 75, sp = new THREE.Sprite(mist);
    sp.position.set(Math.cos(a) * r, 34 + rand() * 30, Math.sin(a) * r); sp.scale.set(60 + rand() * 60, 16 + rand() * 20, 1); sp.renderOrder = 1;
    scene.add(sp);
  }
}

// ground mist: a few slow wisps lying among the trunks, always round the camera (not on the lowest preset)
const WISPS = [];
if (quality !== 'low') {
  const wm = new THREE.SpriteMaterial({ map: DOT, color: 0xdfe6e4, transparent: true, opacity: .13, depthWrite: false, fog: false });
  setSeed(911);
  for (let i = 0; i < 16; i++) { const sp = new THREE.Sprite(wm); sp.scale.set(rr(16, 30), rr(3.2, 5.5), 1); sp.renderOrder = 2; scene.add(sp); WISPS.push({ sp, x: rr(-55, 55), z: rr(-55, 55), h: rr(.7, 2.2), vx: rr(.15, .5), vz: rr(-.2, .2) }); }
}
function updateWisps(dt) {
  const cx = camera.position.x, cz = camera.position.z, R = 55, wrap = v => ((v + R) % (2 * R) + 2 * R) % (2 * R) - R;
  for (const w of WISPS) {
    w.x = wrap(w.x + w.vx * dt - cx + (w.cx ?? cx)); w.z = wrap(w.z + w.vz * dt - cz + (w.cz ?? cz)); w.cx = cx; w.cz = cz;
    const x = cx + w.x, z = cz + w.z, d = Math.hypot(w.x, w.z);
    w.sp.position.set(x, heightAt(x, z) + w.h, z); w.sp.material.opacity = .13; w.sp.visible = d > 9;   // never a sheet across the lens
  }
}
const phys = await createPhysics({ RAPIER: rapier, heightAt, half: WORLD });
const MATS = await loadMaterials({ THREE, loader, quality, anisotropy: renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4 });
const FOL = await loadFoliage({ THREE, loader, document, anisotropy: renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 4 });
const WIND = makeWind();
// canopies sway most, undergrowth less, grass least: all from one clock (src/wind.js)
for (const [k, sway, tall] of [['oak', .34, 5], ['pine', .26, 7], ['shrub', .16, 1.2], ['fern', .13, 1.2], ['moss', .07, .6], ['grass', .09, .5]]) {
  WIND.apply(FOL[k], { sway, tall }); WIND.apply(FOL[k + 'Depth'], { sway, tall });
}
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
const CELL = 50;   // m: scenery is batched per map square, so squares behind the camera or lost in the mist are not drawn at all
const CHUNKS = [];   // 50 m scenery blocks, culled by distance each frame (src/chunks.js)
function instanced(geo, mat, list, shadow = true, { chunk = true, name = '', depth = null, vary = 0, warm = 0 } = {}) {
  const tintC = new THREE.Color(), hash = (x, z, k) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };
  const cells = new Map();
  for (const t of list) { const k = chunk ? Math.floor(t.x / CELL) + ',' + Math.floor(t.z / CELL) : ''; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(t); }
  let last = null;
  for (const part of cells.values()) {
    const im = new THREE.InstancedMesh(geo, mat, part.length);
    part.forEach((t, i) => { dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0); dummy.scale.set(t.sx || t.s || 1, t.sy || t.s || 1, t.sz || t.s || 1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      if (vary) { const l = 1 - vary + 2 * vary * hash(t.x, t.z, 1), w = warm * (hash(t.x, t.z, 2) - .5); im.setColorAt(i, tintC.setRGB(l * (1 + w), l, l * (1 - w * 1.6))); } });   // no two trees quite the same green
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = shadow; im.receiveShadow = true; im.name = name; if (depth) im.customDepthMaterial = depth;
    im.computeBoundingSphere();
    if (chunk && shadow && im.boundingSphere) { const b = im.boundingSphere; im.__c = { x: b.center.x, z: b.center.z, r: b.radius }; CHUNKS.push(im); }
    scene.add(im); last = im;
  }
  return last;
}
const MEADOW = { x: 82, z: -122 }, ESCAPE = { x: 134, z: -156 };   // prologue: Galba's killing field and the forest it flees to
const AMBUSH = { x: roadX(34) + 17, z: 34 };
const HALT = { x: -110, z: -70 }, WOODS = { x: -62, z: -8 }, CSTART = { x: -63, z: -60 };   // 'Os Cativos': the Roman halt, the wood the freed run to, where Viriato starts                          // ambush: Viriato's hide in the scrub above the road
setSeed(777);
{
  const pines = [], oaks = [], rocks = [], grass = [], shrubs = [], ferns = [], moss = [];
  const blocked = (x, z, m) => Math.abs(x - roadX(z)) < 7 + m || inCamp(x, z, 12 + m) || Math.hypot(x - CASTRO.x, z - CASTRO.z) < 16 + m || Math.hypot(x - MEADOW.x, z - MEADOW.z) < 30 + m || Math.hypot(x - HALT.x, z - HALT.z) < 15 + m;
  const DENS = { low: .35, medium: .7, high: 1 }[quality] || .8, TREES = Math.round(4200 * DENS);
  for (let n = 0; n < 26000 && pines.length + oaks.length < TREES; n++) {
    const x = rr(-WORLD + 8, WORLD - 8), z = rr(-WORLD + 8, WORLD - 8);
    if (blocked(x, z, 0)) continue;
    const forest = vnoise(x * .025 + 40, z * .025);
    if (rand() > .3 + forest * 1.5) continue;
    const y = heightAt(x, z), s = rr(.8, 1.35);
    if (y > 52) continue;
    if (y > 22 || rand() < .3) pines.push({ x, y, z, s, ry: rr(0, TAU) }); else oaks.push({ x, y, z, s, ry: rr(0, TAU) });
    addCol(x, z, .45 * s);
  }
  // mountains: three more trees for every one already on the slopes (4x in all), thinning out toward the bare peaks
  { const mtn = pines.length + oaks.length ? [...pines, ...oaks].filter(t => t.y > 12).length : 0, want = Math.round(4200 * DENS) + mtn * 0;   // pine and oak woods climbing the slopes
    for (let n = 0, added = 0; n < want * 12 && added < want; n++) {
      const x = rr(-WORLD + 8, WORLD - 8), z = rr(-WORLD + 8, WORLD - 8);
      if (blocked(x, z, 0)) continue;
      const y = heightAt(x, z); if (y < 10 || y > 95) continue;
      if (rand() > .55 + vnoise(x * .03 + 11, z * .03) * .7 - (y - 10) / 160) continue;
      const s = rr(1, 1.55); (y > 45 || rand() < .5 ? pines : oaks).push({ x, y, z, s, ry: rr(0, TAU) }); addCol(x, z, .45 * s); added++;
    } }
  // thick groves: the forest the survivors run to, and cover round the ambush hide
  for (const [cx, cz, n, r] of [[ESCAPE.x, ESCAPE.z, 52, 24], [AMBUSH.x + 5, AMBUSH.z, 24, 13]]) for (let k = 0; k < n; k++) {
    const a = rr(0, TAU), d = Math.sqrt(rand()) * r, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (Math.abs(x - roadX(z)) < 8 || Math.hypot(x - MEADOW.x, z - MEADOW.z) < 32 || Math.hypot(x - AMBUSH.x, z - AMBUSH.z) < 3.5 || Math.hypot(x - ESCAPE.x, z - ESCAPE.z) < 3) continue;
    const y = heightAt(x, z), s = rr(.85, 1.3); (rand() < .4 ? pines : oaks).push({ x, y, z, s, ry: rr(0, TAU) }); addCol(x, z, .45 * s);
  }
  for (let n = 0; n < 700; n++) {   // penedos: rounded granite boulders, in clusters on the slopes
    const x = rr(-WORLD + 8, WORLD - 8), z = rr(-WORLD + 8, WORLD - 8);
    if (blocked(x, z, -3)) continue;
    if (rand() > .3 + vnoise(x * .04 + 7, z * .04)) continue;
    const s = rr(.6, 2.8), y = heightAt(x, z);
    rocks.push({ x, y: y - s * .25, z, s, sy: s * rr(.5, .9), ry: rr(0, TAU), rx: rr(-.3, .3) });
    addCol(x, z, s * .85, s * .55);
  }
  for (let n = 0; n < 20000 && grass.length < 9000; n++) {
    const x = rr(-WORLD + 4, WORLD - 4), z = rr(-WORLD + 4, WORLD - 4);
    if (Math.abs(x - roadX(z)) < 3 || inCamp(x, z, 2)) continue;
    const y = heightAt(x, z); if (y > 30) continue;
    grass.push({ x, y, z, s: rr(.9, 1.7), ry: rr(0, TAU) });
  }
  for (let n = 0; n < 12000 && ferns.length < Math.round(1000 * DENS); n++) {   // fetos: undergrowth, only in the damp shade of the woods
    const x = rr(-WORLD + 6, WORLD - 6), z = rr(-WORLD + 6, WORLD - 6);
    if (blocked(x, z, -3)) continue;
    if (rand() > .2 + vnoise(x * .03 + 91, z * .03)) continue;
    const y = heightAt(x, z); if (y > 34) continue;
    ferns.push({ x, y: y - .05, z, s: rr(.6, 1.1), sy: rr(.6, 1.05), ry: rr(0, TAU) });
  }
  for (let n = 0; n < 9000 && moss.length < Math.round(700 * DENS); n++) {   // licopódio: low club-moss between the ferns, where the ground is damp
    const x = rr(-WORLD + 6, WORLD - 6), z = rr(-WORLD + 6, WORLD - 6);
    if (blocked(x, z, -3)) continue;
    if (rand() > .14 + vnoise(x * .035 + 55, z * .035)) continue;
    const y = heightAt(x, z); if (y > 30) continue;
    moss.push({ x, y: y - .04, z, s: rr(.5, .9), sy: rr(.5, .85), ry: rr(0, TAU) });
  }
  const broom = [];
  for (let n = 0; n < 20000 && shrubs.length < Math.round(2900 * DENS); n++) {          // mato: low evergreen shrubs, thicker where the forest is
    const x = rr(-WORLD + 6, WORLD - 6), z = rr(-WORLD + 6, WORLD - 6);
    if (blocked(x, z, -4)) continue;
    if (rand() > .25 + vnoise(x * .025 + 40, z * .025)) continue;
    const y = heightAt(x, z); if (y > 40) continue;
    (rand() < .3 ? broom : shrubs).push({ x, y: y - .05, z, s: rr(.6, 1.4), sy: rr(.5, 1.1), ry: rr(0, TAU) });   // giesta in yellow flower among the green
  }
  for (let k = 0; k < 40; k++) { const a = rr(0, TAU), d = rr(1.6, 9), x = AMBUSH.x + Math.cos(a) * d, z = AMBUSH.z + Math.sin(a) * d; if (Math.abs(x - roadX(z)) < 6) continue; shrubs.push({ x, y: heightAt(x, z) - .05, z, s: rr(.9, 1.6), sy: rr(.7, 1.2), ry: rr(0, TAU) }); }
  // maritime pine: tall bare trunk with an umbrella crown; holm/cork oak: short trunk, forked limbs, wide dense crown
  const pineTrunk = new THREE.CylinderGeometry(.16, .3, 8.2, 6, 1, true);   // light geometry: thousands of these pineTrunk.translate(0, 4.1, 0);
  const oakTrunk = mergeGeos([
    (() => { const g = new THREE.CylinderGeometry(.24, .38, 3.4, 6, 1, true); g.translate(0, 1.7, 0); return g; })(),
    (() => { const g = new THREE.CylinderGeometry(.1, .2, 2.4, 5, 1, true); g.translate(0, 1.2, 0); g.rotateZ(.6); g.translate(.2, 3, 0); return g; })(),
    (() => { const g = new THREE.CylinderGeometry(.1, .2, 2.2, 5, 1, true); g.translate(0, 1.1, 0); g.rotateZ(-.55); g.rotateY(2.1); g.translate(-.1, 3, .1); return g; })(),
  ]);
  instanced(pineTrunk, MAT('bark_pine'), pines, true, { vary: .14 });
  instanced(oakTrunk, MAT('bark_oak'), oaks, true, { vary: .14 });
  const leafy = (name, geo, mat, depth, list) => instanced(geo, mat, list, true, { name, depth, vary: .2, warm: .22 });
  leafy('pine-canopy', canopyGeo({ cards: 23, rx: 2.2, ry: 2.5, cy: 7.2, w: 2.1, h: 1.9, seed: 5, flat: 0 }), FOL.pine, FOL.pineDepth, pines);
  leafy('oak-canopy', canopyGeo({ cards: 22, rx: 3.1, ry: 2.0, cy: 5.3, w: 2.8, h: 2.8, seed: 9 }), FOL.oak, FOL.oakDepth, oaks);
  leafy('shrubs', canopyGeo({ cards: 7, rx: .85, ry: .5, cy: .55, w: 1.3, h: 1.2, seed: 13 }), FOL.shrub, FOL.shrubDepth, shrubs);
  { const bm = FOL.shrub.clone(); bm.color = new THREE.Color(0xe6cf3a); leafy('broom', canopyGeo({ cards: 6, rx: .75, ry: .55, cy: .6, w: 1.1, h: 1.1, seed: 21 }), bm, FOL.shrubDepth, broom); }
  { const mg = new THREE.PlaneGeometry(.95, .62); mg.translate(0, .3, 0); const mg2 = mg.clone(); mg2.rotateY(Math.PI / 2);
    instanced(mergeGeos([mg, mg2]), FOL.moss, moss, true, { name: 'moss', depth: FOL.mossDepth, vary: .16, warm: .06 }); }
  { const fg = new THREE.PlaneGeometry(.9, 1.2); fg.translate(0, .6, 0); const fg2 = fg.clone(); fg2.rotateY(Math.PI / 2);
    instanced(mergeGeos([fg, fg2]), FOL.fern, ferns, true, { name: 'ferns', depth: FOL.fernDepth, vary: .18, warm: .1 }); }
  { const gm = MAT('terrain_rock', { flatShading: true }); gm.color = new THREE.Color(0x8d8e8c); instanced(new THREE.IcosahedronGeometry(1, 0), gm, rocks, true, { vary: .16, warm: .08 }); }   // grey granite
  const gg = new THREE.PlaneGeometry(.9, .45); gg.translate(0, .22, 0);
  const gg2 = gg.clone(); gg2.rotateY(Math.PI / 2);
  const grassGeo = mergeGeos([gg, gg2]);
  GRASS = instanced(grassGeo, FOL.grass.map ? FOL.grass : makeGrassMaterial(THREE, document), grass, false, { chunk: false, name: 'grass' });
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
  const huts = [[-2.5, -3.5], [5, -7], [8, 5], [-5, 7]];
  for (const [ox, oz] of huts) {
    const x = CASTRO.x + ox, z = CASTRO.z + oz, y = CASTRO.h;
    mesh(new THREE.CylinderGeometry(2.4, 2.5, 2.1, 14), stone, x, y + 1.05, z);
    mesh(new THREE.ConeGeometry(3.1, 2.6, 14), thatch, x, y + 3.4, z);
    addCol(x, z, 2.6);
  }
  // one continuous dry-stone ring wall following the ground, open at the gate toward the road
  {
    const R = 15, TH = 1.1, HT = 1.6, GATE = Math.PI * 1.25, GAP = .22, N = 160;
    const a0 = GATE + GAP, a1 = GATE + TAU - GAP, P3 = [], UV = [], IDX = [];
    const quad = (p, q, r, t, u0, u1, v0, v1) => { const i = P3.length / 3; P3.push(...p, ...q, ...r, ...t); UV.push(u0, v0, u1, v0, u1, v1, u0, v1); IDX.push(i, i + 2, i + 1, i, i + 3, i + 2); };
    const pt = (a, r, top) => { const x = CASTRO.x + Math.cos(a) * r, z = CASTRO.z + Math.sin(a) * r, y = heightAt(x, z); return [x, top ? y + HT - (r > R ? .08 : 0) : y - .4, z]; };
    for (let i = 0; i < N; i++) {
      const aa = a0 + (a1 - a0) * i / N, ab = a0 + (a1 - a0) * (i + 1) / N, u0 = aa * R / 2.2, u1 = ab * R / 2.2, ro = R + TH / 2, ri = R - TH / 2, v = HT / 2.2;
      quad(pt(aa, ro, 0), pt(ab, ro, 0), pt(ab, ro, 1), pt(aa, ro, 1), u0, u1, 0, v);   // outer face
      quad(pt(ab, ri, 0), pt(aa, ri, 0), pt(aa, ri, 1), pt(ab, ri, 1), u1, u0, 0, v);   // inner face
      quad(pt(aa, ro, 1), pt(ab, ro, 1), pt(ab, ri, 1), pt(aa, ri, 1), u0, u1, 0, TH / 2.2); // walk on top
      if (i % 3 === 0) addCol(CASTRO.x + Math.cos(aa) * R, CASTRO.z + Math.sin(aa) * R, .9);
    }
    for (const [aE, s] of [[a0, 1], [a1, -1]]) { const o0 = pt(aE, R + TH / 2, 0), i0 = pt(aE, R - TH / 2, 0), i1 = pt(aE, R - TH / 2, 1), o1 = pt(aE, R + TH / 2, 1); if (s > 0) quad(i0, o0, o1, i1, 0, TH / 2.2, 0, HT / 2.2); else quad(o0, i0, i1, o1, 0, TH / 2.2, 0, HT / 2.2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P3, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(IDX); g.computeVertexNormals();
    const wm = stone.clone(); wm.side = THREE.DoubleSide; const w = new THREE.Mesh(g, wm); w.castShadow = w.receiveShadow = true; w.name = 'castro-wall'; scene.add(w);
  }
}

// Roman camp
const supplyTents = [];
const fireLights = [];
{
  const wood = MAT('wood'), canvas = MAT('canvas', { flatShading: true }), red = MAT('canvas_red', { flatShading: true }), crate = MAT('wood');
  // papilio tents were goat leather, not white canvas: the leather photo set, bleached by the sun
  // leather and canvas let daylight through: without a little emissive the shaded slope renders almost black
  const hide = MAT('leather', { side: THREE.DoubleSide }); hide.color.setHex(0xb0a083); hide.emissive.setHex(0x4a3c28);
  red.side = THREE.DoubleSide; red.emissive.setHex(0x3a1210);
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
  const tentG = papilioGeo(THREE, { w: 3.1, l: 4.4, h: 2.3 });
  const rows = [-16, -8, 8, 16];
  for (const ox of rows) for (const oz of [-14, -6]) { mesh(tentG, hide, CAMP.x + ox, H0, CAMP.z + oz); addCol(CAMP.x + ox, CAMP.z + oz, 2.2); }
  // praetorium: the commander's tent, the one piece of dyed canvas in the camp
  mesh(papilioGeo(THREE, { w: 7, l: 9, h: 4.2, rope: 1.6 }), red, CAMP.x, H0, CAMP.z - 18); addCol(CAMP.x, CAMP.z - 18, 4.2);
  // standard
  mesh(new THREE.CylinderGeometry(.06, .06, 6, 6), wood, CAMP.x + 5, H0 + 3, CAMP.z - 12);
  mesh(new THREE.BoxGeometry(1.2, 1.5, .04), red, CAMP.x + 5.6, H0 + 5, CAMP.z - 12);
  mesh(new THREE.BoxGeometry(1.6, .08, .08), M(0xb8913a), CAMP.x + 5.6, H0 + 5.8, CAMP.z - 12);
  // supply tents (objectives)
  const spots = [[-17, 8], [0, 4], [17, 10]];
  for (const [ox, oz] of spots) {
    const x = CAMP.x + ox, z = CAMP.z + oz;
    const mat = hide.clone();
    const t = mesh(papilioGeo(THREE, { w: 4.2, l: 5.4, h: 3, rope: 1.2 }), mat, x, H0, z);
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
  fur.color.setHex(0x4a4036);   // wolf pelt, clearly darker than the skin so the vélite does not read as bald
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
    const dj = grp(0, 0, 0, hand); dj.name = 'dardo'; dj.visible = false;   // shown in the fist while throwing
    add(new THREE.CylinderGeometry(.013, .013, 1.3, 6), wood, 0, 0, .2, dj).rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.026, .14, 8), metal, 0, 0, .9, dj).rotation.x = Math.PI / 2;
    // caetra: small round concave shield (~0.6 m) with a central boss
    const pg = grp(.34, .2, .3, spine); root.userData.parma = pg; pg.name = 'caetra';
    const dome = new THREE.SphereGeometry(.5, 24, 6, 0, Math.PI * 2, 0, .64); dome.rotateX(Math.PI / 2); dome.translate(0, 0, -.42);
    add(dome, leather, 0, 0, 0, pg).material.side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 0, .07, pg).rotation.x = Math.PI / 2;
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; add(new THREE.SphereGeometry(.014, 6, 4), gold, Math.cos(a) * .2, Math.sin(a) * .2, .03, pg); }
  } else if (kind === 'velite') {
    const pil = grp(0, 0, 0, hand); pil.name = 'pilum';
    const jv = add(new THREE.CylinderGeometry(.015, .015, 1.5, 6), wood, 0, 0, .25, pil); jv.rotation.x = Math.PI / 2;
    add(new THREE.ConeGeometry(.03, .16, 8), metal, 0, 0, 1.06, pil).rotation.x = Math.PI / 2;
    makeGladius(hand, metal, gold, wood).visible = false;   // drawn once the javelins are spent
    root.userData.bladeLength = .64;
    const pg = grp(.36, .2, .28, spine); root.userData.parma = pg; // the IK grips this group
    add(new THREE.CylinderGeometry(.36, .36, .04, 28), shieldM, 0, 0, 0, pg).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(.36, .015, 6, 28), metal, 0, 0, .02, pg);
    add(new THREE.SphereGeometry(.07, 12, 8), metal, 0, 0, .03, pg);
  } else {
    // gladius continues the line of the forearm (−y), so the blade follows the swing arc
    // gladius hispaniensis: ~0.64 m blade, slight waist, long tapering point
    root.userData.bladeLength = .64;
    makeGladius(hand, metal, gold, wood);
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

/** Gladius hispaniensis (~0.64 m blade, slight waist, long point) as a named group in the fist, continuing the forearm (−y). */
function makeGladius(hand, metal, gold, wood) {
  const g = new THREE.Group(); g.name = 'gladius'; hand.add(g);
  const bs = new THREE.Shape(); bs.moveTo(-.026, 0); bs.lineTo(.026, 0); bs.lineTo(.022, .3); bs.lineTo(.026, .44); bs.lineTo(0, .64); bs.lineTo(-.026, .44); bs.lineTo(-.022, .3); bs.closePath();
  const bg = new THREE.ExtrudeGeometry(bs, { depth: .008, bevelEnabled: true, bevelThickness: .003, bevelSize: .004, bevelSegments: 2, curveSegments: 4 });
  bg.translate(0, 0, -.004);
  const parts = [[bg, metal, -.06], [new THREE.BoxGeometry(.12, .035, .045), gold, -.04], [new THREE.CylinderGeometry(.016, .016, .1, 10), wood, .02], [new THREE.SphereGeometry(.03, 12, 8), gold, .08]];
  for (const [geo, mat, y] of parts) { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; if (geo === bg) m.rotation.x = Math.PI; g.add(m); }
  return g;
}
/** A velite who has thrown his last javelin draws the gladius. */
function veliteDraws(e) { const r = e.m.root, pil = r.getObjectByName('pilum'), gl = r.getObjectByName('gladius'); if (pil) pil.visible = false; if (gl) gl.visible = true; e.state = 'chase'; e.act = 'approach'; }

/* Rigged soldier: the Quaternius body and animation clips, wearing the kit built above on its bones. */
const HAND_BASIS = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0));
function rigSoldier(kind, look = null) {
  const p = makeSoldier(kind), ud = p.root.userData, lus = kind === 'lusitano';
  if (look && look.unarmed) { delete ud.scutum; delete ud.parma; }   // the disarmed: no weapon, no shield
  const shield = ud.scutum || ud.parma;
  const white = p.mats[0].color.equals(MATS.wool_white.color);
  const outfit = look ? look.outfit : lus ? (rand() < .5 ? 'lusitano' : 'lusitano_b') : kind === 'velite' ? 'velite' : ud.armour === 'hamata' ? 'roman_mail' : white ? 'roman_white' : 'roman_red';
  let hair = look ? look.hair : lus ? ['hair_long', 'hair_beard'] : kind === 'velite' ? ['hair_long', 'hair_beard'] : [];
  if (hair.includes('hair_long') && !hair.includes('hair_buzzed')) hair = ['hair_buzzed', ...hair];   // the long cut leaves the crown bare: a close-cropped layer underneath covers it
  // one garment, one cloth: the tunic over the chest and the skirt below the belt share colour and weave
  if (!chars.weave) chars.weave = weaveTexture(THREE);
  const cloth = outfit === 'roman_mail' ? null : (look && look.palette && look.palette.dress) || { lusitano: 0x7a5a36, lusitano_b: 0x5c4630, lusitano_c: 0x96682c, lusitano_d: 0x605440, roman_red: 0x9a2a20, roman_white: 0xd8d0bc, velite: 0x5c4630 }[outfit] || 0x6b4a2e;
  const tint = rr(.86, 1.05);
  const rig = makeRig(THREE, chars.clone, chars, { female: !!(look && look.female), palette: look && look.palette, outfit, hair, shielded: !!shield, cloth, tint, hairColor: look ? look.hairColor : [0x2a1d14, 0x3b2a1e, 0x1c1410, 0x4a3524][Math.floor(rand() * 4)] });
  // helmet / cap: everything on the old head except the skin
  const hk = new THREE.Group();
  for (const o of [...p.head.children]) if (!(o.isMesh && o.material === p.skin)) hk.add(o);
  hk.position.set(0, 1.59, -.02); hk.scale.setScalar(.84); if (!look || look.cap) rig.attach('Head', hk);
  // weapon in the right fist: blade out past the thumb, edges along the fingers
  const hand = p.elbows[1].children.at(-1), wpn = new THREE.Group(); wpn.name = 'weapon';
  for (const o of [...hand.children]) wpn.add(o);
  wpn.quaternion.setFromRotationMatrix(HAND_BASIS); wpn.position.set(-.03, .085, 0);
  rig.bones.hand_r.add(wpn); if (look && look.unarmed) wpn.visible = false;
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
  const extraMats = [];
  /**
   * Hanging cloth: an open flared tube from the waist down, with soft folds and a darker hem.
   * It is skinned to the body's skeleton like game skirts are: the waist rides the pelvis, and lower down each side follows
   * its own thigh (and, on long dresses, a little of the shin), blended across the front and back. Simple, and it never pinches.
   */
  let fsm = null; rig.body.traverse(o => { if (o.isSkinnedMesh && !fsm && o.skeleton.bones.some(b => b.name === 'pelvis')) fsm = o; });
  /**
   * Two extra "panel" bones under the pelvis carry the front and back of every skirt: each frame the front panel takes the
   * rotation of whichever thigh is further forward and the back panel that of the one further back, so the cloth always
   * stays outside the legs; the sides follow their own thigh. (A plain 50/50 blend let the leading leg poke through.)
   */
  let panels = null;
  const getPanels = () => {
    if (panels) return panels;
    const sk = fsm.skeleton, names = sk.bones.map(b => b.name), I = n => names.indexOf(n);
    const pel = sk.bones[I('pelvis')], th = [sk.bones[I('thigh_l')], sk.bones[I('thigh_r')]], ca = [sk.bones[I('calf_l')], sk.bones[I('calf_r')]];
    const bindW = i => sk.boneInverses[i].clone().invert(), PB = bindW(I('pelvis')), TB = [bindW(I('thigh_l')), bindW(I('thigh_r'))];
    const hip = new THREE.Vector3().setFromMatrixPosition(TB[0]).add(new THREE.Vector3().setFromMatrixPosition(TB[1])).multiplyScalar(.5);
    const local = hip.clone().applyMatrix4(PB.clone().invert());
    const mk = () => { const b = new THREE.Bone(); b.position.copy(local); pel.add(b); return b; };
    const F = mk(), Bk = mk(), inv = PB.clone().multiply(new THREE.Matrix4().makeTranslation(local.x, local.y, local.z)).invert();
    const q = new THREE.Quaternion(), qp = new THREE.Quaternion(), pbq = new THREE.Quaternion(), tbq = TB.map(() => new THREE.Quaternion());
    PB.decompose(new THREE.Vector3(), pbq, new THREE.Vector3()); TB.forEach((m, i) => m.decompose(new THREE.Vector3(), tbq[i], new THREE.Vector3()));
    const bindRel = tbq.map(t => pbq.clone().invert().multiply(t));                // thigh relative to pelvis in the bind pose
    const fwd = new THREE.Vector3(), a = new THREE.Vector3(), c = new THREE.Vector3(), delta = [new THREE.Quaternion(), new THREE.Quaternion()];
    (rig.dyn = rig.dyn || []).push(() => {
      rig.root.updateMatrixWorld(true);
      fwd.set(0, 0, 1).applyQuaternion(rig.root.getWorldQuaternion(q));
      pel.getWorldQuaternion(qp); const qpi = qp.clone().invert(), fw = [0, 0];
      for (let i = 0; i < 2; i++) {
        th[i].getWorldQuaternion(q); delta[i].copy(qpi).multiply(q).multiply(bindRel[i].clone().invert());   // how far the thigh has swung, in the pelvis frame
        th[i].getWorldPosition(a); ca[i].getWorldPosition(c); fw[i] = c.sub(a).normalize().dot(fwd);
      }
      const front = fw[0] >= fw[1] ? 0 : 1;
      F.quaternion.copy(delta[front]); Bk.quaternion.copy(delta[1 - front]);
    });
    panels = { bones: [pel, th[0], th[1], F, Bk], inverses: [sk.boneInverses[I('pelvis')], sk.boneInverses[I('thigh_l')], sk.boneInverses[I('thigh_r')], inv, inv.clone()] };
    return panels;
  };
  const skirt = (color, { rTop = .2, rBot = .25, y0 = 1.09, y1 = .56, folds = 14, amp = .05, mat = null, zs = .9, waist = .8 } = {}) => {
    if (!fsm) return;
    const m = mat || new THREE.MeshStandardMaterial({ color: 0xffffff, map: chars.weave || null, vertexColors: true, roughness: 1, side: THREE.DoubleSide }); extraMats.push(m);
    const H = y0 - y1, g = new THREE.CylinderGeometry(rTop, rBot, H, 36, 10, true), pos = g.attributes.position;
    const HIP = .93, KNEE = .53, base = new THREE.Color(color).multiplyScalar(mat ? 1 : tint), col = [], si = [], sw = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), t = 1 - (pos.getY(i) + H / 2) / H, y = y0 - t * H, a = Math.atan2(z, x), r = Math.hypot(x, z) || 1;
      const cinch = lerp(waist, 1, smooth(0, .3, t));   // gathered at the waist under the belt, swelling over the hips: it hangs from the body instead of standing off it
      const k = (1 + amp * t * Math.sin(a * folds + t * 2) + amp * .4 * t * Math.sin(a * folds * 2.3)) * cinch;
      pos.setXYZ(i, x * k, y, z * k * zs);
      const long = y1 < .4, leg = smooth(1.0, .8, y) * (long ? .6 : .97), cz = z / r;   // follows the thigh from just under the hip; long dresses swing less (no sail)
      const wf = smooth(.3, .85, cz), wb = smooth(.3, .85, -cz), side = 1 - wf - wb, wl = (1 + clamp(x / .05, -1, 1)) / 2;
      // 0 pelvis, 1 thigh_l, 2 thigh_r, 3 front panel, 4 back panel
      si.push(0, 1, 2, wf > 0 ? 3 : 4);
      sw.push(1 - leg, leg * side * wl, leg * side * (1 - wl), leg * (wf > 0 ? wf : wb));
      const d = t > .93 ? .6 : 1; col.push(base.r * d, base.g * d, base.b * d);
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    rig.root.updateMatrixWorld(true); g.applyMatrix4(fsm.matrixWorld.clone().invert().multiply(rig.root.matrixWorld));   // into the body's own space
    const pn = getPanels(), sk = new THREE.SkinnedMesh(g, m); sk.castShadow = true; sk.frustumCulled = false; sk.name = 'skirt';
    fsm.parent.add(sk); sk.bind(new THREE.Skeleton(pn.bones, pn.inverses), fsm.bindMatrix);
  };
  /** Short loose sleeve over the upper arm so the muscle is not painted straight onto the body. */
  const sleeve = (side, color, r0 = .062, r1 = .095, from = .06, to = .6) => {
    const a = rig.bones['upperarm_' + side], b = rig.bones['lowerarm_' + side]; if (!a || !b) return;
    rig.root.updateMatrixWorld(true);
    const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3()), d = pb.clone().sub(pa), len = d.length();
    const m = new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }); extraMats.push(m);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, len * (to - from), 14, 1, true), m); mesh.castShadow = true;
    mesh.position.copy(rig.root.worldToLocal(pa.clone().addScaledVector(d, (from + to) / 2)));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    mesh.quaternion.premultiply(rig.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    rig.attach('upperarm_' + side, mesh);
  };
  if (lus) skirt(cloth, look && look.dress ? { rTop: .19, rBot: .33, y1: .2, amp: .07, folds: 16 } : {});   // wool saia to mid-thigh
  else if (kind !== 'velite') {   // Roman tunic to the knee, a short mail skirt over it for the hamata
    const col = outfit === 'roman_white' ? 0xd8d0bc : 0x9a2a20;
    skirt(col, { rTop: .2, rBot: .24, y1: .52, amp: .03, zs: .86 });
    if (outfit === 'roman_mail') { const mm = MATS.mail.clone(); if (mm.map) { mm.map = mm.map.clone(); mm.map.repeat.set(2.6, 1); mm.map.wrapS = mm.map.wrapT = THREE.RepeatWrapping; mm.map.needsUpdate = true; } mm.side = THREE.DoubleSide; mm.color.setHex(0xb4b4b4); mm.roughness = .75; skirt(0xffffff, { rTop: .2, rBot: .25, y0: 1.04, y1: .74, amp: .02, mat: mm, folds: 8, zs: .84 }); }
  } else { skirt(0x5c4630, { rTop: .19, rBot: .27, y1: .68 }); }
  if (look && look.unarmed && !look.female) slimBody(rig.bones);   // the people of the villages are not built like warriors (done last: everything is already fitted to the body)
  Object.assign(rig.root.userData, ud);
  const mats = [...new Set([...rig.mats, ...p.mats, bMat, gMat, sMat, ...extraMats])];
  return { root: rig.root, rig, mats, weapon: wpn, shield };
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
let riders = [];
let chapter = 'prologo', civs = [], betrayed = false, betrayT = 0, envoy = null, elder = null;   // 'prologo' = Galba's massacre (150 BC), 'emboscada' = the ambush campaign
Object.defineProperty(P, 'st', { get() { return P.f.stamina; }, set(v) { P.f.stamina = v; }, enumerable: false });
Object.defineProperty(P, 'block', { get() { return P.f.blocking != null; }, enumerable: false });
const keys = {}; let mouseL = false, mouseR = false;
let view = 'third'; // M&B-style over-the-shoulder by default; V toggles first person

/* Broken shields: hacked apart, they drop where their bearer stands and stay there, useless. */
const fallen = [];
function dropShield(ent, mine = false) {
  if (ent.shieldLost) return; ent.shieldLost = true;
  const sh = ent.m && (ent.m.shield || ent.m.root.userData.scutum || ent.m.root.userData.parma); if (ent.m && ent.m.rig) ent.m.rig.bareArm = true;
  if (!sh || !sh.visible) return;
  sh.updateWorldMatrix(true, false);
  const c = sh.clone(); sh.matrixWorld.decompose(c.position, c.quaternion, c.scale); scene.add(c); sh.visible = false;
  fallen.push({ mesh: c, vy: 1.5, t: 0, spin: rr(-3, 3) });
  SFX.thud(mine ? 1 : spatial(c.position)); burst('dust', c.position, 5);
  if (mine) { showPrompt('O escudo partiu-se! Apara com a falcata (BOTÃO DIREITO ou Q)', 2.4); clog('Escudo partido', '#e08a6a'); } else if (!ent.ally) feed('Escudo romano partido');
}
const FLAT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
function updateFallen(dt) {
  for (const s of fallen) {
    if (s.done) continue;
    s.t += dt; s.vy -= 14 * dt; s.mesh.position.y += s.vy * dt; s.mesh.rotateZ(s.spin * dt); s.mesh.quaternion.slerp(FLAT, Math.min(1, dt * 3));
    const g = heightAt(s.mesh.position.x, s.mesh.position.z) + .06;
    if (s.mesh.position.y <= g) { s.mesh.position.y = g; s.mesh.quaternion.copy(FLAT); s.done = true; }
  }
}
/* The marching pack (sarcina) each man of the patrol carried: it falls beside him, and is what the ambushers come for. */
const packs = [];
function dropPack(e) {
  const src = chars && chars.props && chars.props.sack; if (!src || e.pack) return;
  const g = src.clone(true), a = rr(0, TAU), x = e.pos.x + Math.sin(a) * .75, z = e.pos.z + Math.cos(a) * .75;
  g.scale.setScalar(4.6); g.position.set(x, heightAt(x, z), z); g.rotation.y = rr(0, TAU); scene.add(g); packs.push(g); e.pack = g;
}
function resetWorld() {
  for (const g of packs) scene.remove(g); packs.length = 0;
  if (halt) { for (const o of halt.objs) scene.remove(o); for (const c of halt.cols) c.off = true; halt = null; }
  for (const s of fallen) scene.remove(s.mesh); fallen.length = 0; loot = null; catOut = null; campOut = null; campSaid = 0;
  scene.fog.density = FOG_BASE;
  if (typeof avatar !== 'undefined') { avatar.shieldLost = false; if (AV.shield) AV.shield.visible = true; }
  // clear dynamic objects
  for (const e of enemies) { scene.remove(e.m.root); if (e.corpse) phys.removeCorpse(e.corpse); }
  for (const a of allies) scene.remove(a.m.root);
  for (const c of civs) scene.remove(c.m.root); civs = [];
  for (const r of riders) { scene.remove(r.horse); scene.remove(r.m.root); } riders = []; betrayed = false; betrayT = 0;
  allies = []; order = 'follow'; placing = false; FLAG.visible = false;
  for (const p of projectiles) phys.remove(p.pid);
  for (const p of projectiles) scene.remove(p.mesh);
  for (const p of pickups) scene.remove(p.mesh);
  enemies = []; projectiles = []; pickups = [];
  for (const p of particles) { p.live = false; p.s.visible = false; } particles.length = 0;
  for (const t of supplyTents) { t.burnt = false; t.t = 0; t.mat.color.setHex(0xb0a083); t.light.intensity = 0; t.flag.visible = true; }
  setSeed(4242);
  endT = 0; endArgs = null;
  Object.assign(P, { throwPending: 0, throwKind: null, aimT: null, throwPow: null, f: C.createFighter({ passiveShield: true }), charging: false, chargeT: 0, acc: { x: 0, y: 0 }, intent: C.createIntent(), post: { x: 0, y: 0 }, prevL: false, swingDir: null, bashCd: 0, bashT: 0, cleanT: 0,
    lastDefense: null, incomingDir: null, vel: { x: 0, z: 0 }, push: null, kick: 0, swingHits: new Set(), vy: 0, hp: 100, ground: true, crouch: 0, w: 0, dardos: JAVELINS.lusitano, pedras: 12, atk: 0, cd: 0,
    kills: 0, shots: 0, hits: 0, heads: 0, time: 0, swing: 0, throwT: 0, hurtT: 0 });
  mission = 0; tentsBurnt = 0; alarm = false;
  P.unarmed = chapter === 'prologo';
  if (chapter === 'prologo') { resetPrologue(); setObjective(); return; }
  if (chapter === 'cativos') { resetCativos(); setObjective(); return; }
  if (chapter === 'acampamento') { resetCamp(); setObjective(); return; }
  // hidden in the scrub above the road, looking north up the valley where the patrol will come from
  P.pos.set(AMBUSH.x, 0, AMBUSH.z); P.pos.y = heightAt(P.pos.x, P.pos.z);
  P.yaw = Math.PI * .3; P.pitch = -.05;
  for (let i = 0; i < companions; i++) spawnAlly(i);
  // patrol on the road, marching south
  const col8 = ['legio', 'legio', 'velite', 'legio', 'legio', 'velite', 'legio', 'legio'], col = [...col8, ...col8];   // sixteen men in two files
  col.forEach((k, i) => { const z = -18 - Math.floor(i / 2) * 3.2; spawn(k, roadX(z) + (i % 2 ? 1.1 : -1.1), z, 'patrol'); });
  // pickups
  addPickup('dardos', AMBUSH.x + 2.5, AMBUSH.z + 1.5); addPickup('pedras', AMBUSH.x + 3, AMBUSH.z - 1.5); addPickup('odre', AMBUSH.x + .5, AMBUSH.z + 3);
  const route = [[roadX(70) + 14, 70], [roadX(20) - 16, 20], [roadX(-40) + 15, -40], [roadX(-80) - 14, -80], [roadX(-100) + 18, -100]];
  route.forEach(([x, z], i) => addPickup(i % 2 ? 'odre' : 'dardos', x, z));
  addPickup('pedras', roadX(-60) - 20, -60);
  setObjective();
}

function spawn(kind, x, z, group) {
  const m = soldier(kind === 'legio' ? 'legio' : kind);
  scene.add(m.root);
  const stats = { legio: { hp: 100, sp: 3.9, dmg: 13 }, velite: { hp: 65, sp: 3.7, dmg: 15 }, centurion: { hp: 460, sp: 4.4, dmg: 24 } }[kind];
  const e = { kind, m, pos: new THREE.Vector3(x, heightAt(x, z), z), hp: stats.hp, maxhp: stats.hp, sp: stats.sp, dmg: stats.dmg,
    state: group === 'patrol' ? 'march' : group === 'boss' ? 'chase' : 'guard', group, yaw: Math.PI, home: new THREE.Vector3(x, 0, z),
    dir: -1, aware: 0, atkT: 0, f: C.createFighter({ shieldHP: kind === 'velite' ? 35 : kind === 'centurion' ? 140 : 90, stamina: kind === 'centurion' ? 140 : 100, tele: kind === 'velite' ? 1.4 : kind === 'centurion' ? 1.5 : 1.7 }), aiT: rr(0, .3), act: 'approach', vel: { x: 0, z: 0 }, dodgeRoll: 1, mv: { x: 0, z: 0 }, releaseAt: 0, feintAt: 0, blockLeft: 0, slowT: 0, cd: rr(.5, 1.5), ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, wander: null, wT: 0, strafe: rand() < .5 ? 1 : -1, moving: 0, barkT: 0, jav: kind === 'velite' ? JAVELINS.velite : 0 };
  if (group === 'patrol') { e.yaw = 0; e.dir = 1; } // marching south (+z)
  enemies.push(e); return e;
}

/* =========================================================
   Prologue: the betrayal of Galba (150 BC)
   ========================================================= */
const RING_FAR = 42, RING_N = 36, RING_R0 = 30, RING_R1 = 11.5, RING_R2 = 7;
function ringRadius(t) { return lerp(RING_R0, RING_R1, t); }
function setRing(R) { for (const e of enemies) if (e.group === 'cordon' && e.state === 'cordon' && !(e.party && !betrayed)) e.home.set(MEADOW.x + Math.cos(e.ang) * R, 0, MEADOW.z + Math.sin(e.ang) * R); }
function resetPrologue() {
  setSeed(150);
  const dx = ESCAPE.x - MEADOW.x, dz = ESCAPE.z - MEADOW.z, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
  P.pos.set(MEADOW.x + ux * 4.5, 0, MEADOW.z + uz * 4.5); P.pos.y = heightAt(P.pos.x, P.pos.z);
  P.yaw = Math.atan2(-ux, -uz); P.pitch = -.05; P.dardos = 0; P.pedras = 0;   // disarmed with the rest: only a falcata hidden in his cloak
  // the people who laid down their arms, split by Galba into three groups: men, women and children
  const OUT = ['lusitano', 'lusitano_b', 'lusitano_c', 'lusitano_d'], HC = [0x2a1d14, 0x3b2a1e, 0x1c1410, 0x4a3524, 0x5a3d24];
  const pick = a => a[Math.floor(rand() * a.length)];
  for (let gI = 0; gI < 3; gI++) {
    const ga = Math.atan2(uz, ux) + 2.1 * gI + 1.05, gx = MEADOW.x + Math.cos(ga) * 4.5, gz = MEADOW.z + Math.sin(ga) * 4.5;
    for (let k = 0; k < 8; k++) {
      const r = rand(), child = r < .25, woman = !child && r < .62;
      const DRESS = [0x6b4a2e, 0x8a5a2b, 0x4f5a3a, 0x7a3b2a, 0x5c4f45, 0x9a7a4a];
      const look = { unarmed: true, cap: false, outfit: pick(OUT), hairColor: pick(HC), female: woman || child,
        palette: { dress: pick(DRESS), skin: pick([0x9c6e52, 0x8a5e44, 0xa87a5a, 0x93664a]), long: woman || (child && rand() < .5) },
        scale: child ? rr(.56, .68) : woman ? rr(.9, .96) : rr(.95, 1.06),
        dress: woman || (child && rand() < .5), hair: woman ? ['hair_long'] : child ? [rand() < .5 ? 'hair_long' : 'hair_buzzed'] : [rand() < .6 ? 'hair_long' : 'hair_buzzed', 'hair_beard'] };
      const a = rr(0, TAU), d = rr(.6, 2.6); spawnCiv(look, gx + Math.cos(a) * d, gz + Math.sin(a) * d, child);
    }
  }
  // the parley: a Roman envoy and a Lusitanian elder in the open ground between the people and the legions
  const na = Math.atan2(uz, ux) + Math.PI;
  const lx = MEADOW.x + Math.cos(na) * 7.6, lz = MEADOW.z + Math.sin(na) * 7.6;
  elder = spawnCiv({ unarmed: true, cap: false, outfit: 'lusitano_b', hairColor: 0x8f8a82, scale: 1.0, hair: ['hair_long', 'hair_beard'] }, lx, lz, false); elder.elder = true;
  const ex = MEADOW.x + Math.cos(na) * 9.4, ez = MEADOW.z + Math.sin(na) * 9.4;
  envoy = spawn('legio', ex, ez, 'cordon'); envoy.state = 'cordon'; envoy.ang = na; envoy.envoyDone = false; envoy.home.set(ex, 0, ez);
  envoy.yaw = Math.atan2(lx - ex, lz - ez); elder.yaw = Math.atan2(ex - lx, ez - lz); envoy.party = true;
  { const bx = (ex - lx) / 1.8, bz = (ez - lz) / 1.8, px = -bz, pz = bx;   // two guards a step behind him, one each side
    for (const sd of [-1, 1]) { const gx = ex + bx * 1.2 + px * sd * 1.3, gz = ez + bz * 1.2 + pz * sd * 1.3, g = spawn('legio', gx, gz, 'cordon');
      g.state = 'cordon'; g.ang = na + sd * .05; g.party = true; g.envoyDone = false; g.home.set(gx, 0, gz); g.yaw = envoy.yaw; } }
  armEnvoy(false);   // he comes to talk with his sword in its sheath and no shield, so as to raise no suspicion
  // the legions, standing in a wide ring round the field
  for (let i = 0; i < RING_N; i++) {
    const ang = i / RING_N * TAU; if (Math.abs(wrapA(ang - Math.atan2(uz, ux))) < .27) continue;   // a breach on the forest side
    const e = spawn('legio', MEADOW.x + Math.cos(ang) * RING_R0, MEADOW.z + Math.sin(ang) * RING_R0, 'cordon');
    e.ang = ang; e.state = 'cordon'; e.yaw = Math.atan2(-Math.cos(ang), -Math.sin(ang));
  }
  if (chars && chars.horse) { spawnRider(0, 1); spawnRider(Math.PI, 1); }   // two riders of the cavalry
}
function armEnvoy(on) {
  if (!envoy) return;
  if (envoy.m.weapon) envoy.m.weapon.visible = on; if (envoy.m.rig) envoy.m.rig.bareArm = !on;
  const sh = envoy.m.root.userData.scutum || envoy.m.root.userData.parma; if (sh) sh.visible = on;
}
/* Cavalry: two riders sweep in with the legions, circle the field cutting down whoever runs, then flank the captives. */
const SADDLE = 1.0;   // rider root height above the horse (crouched legs astride its back)
function spawnRider(ang, dir) {
  const h = chars.horse, hg = h.scene.clone(true); hg.scale.setScalar(.0095);
  hg.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = o.material.clone(); o.material.color.setHex(0x8f7464); } });   // a darker bay
  const grp = new THREE.Group(); grp.add(hg); scene.add(grp);
  const mixer = new THREE.AnimationMixer(hg), act = mixer.clipAction(h.clip); act.play();
  const m = soldier('legio'); scene.add(m.root);
  const r = { kind: 'legio', m, f: C.createFighter(), state: 'chase', crouch: true, mv: { x: 0, z: 0 }, yaw: 0, stride: 0, ph: 0, flash: 0, dead: false, deadT: 0, hits: 0,
    pos: V(MEADOW.x + Math.cos(ang) * 70, 0, MEADOW.z + Math.sin(ang) * 70), horse: grp, mixer, act, ang, dir, hitCd: 0, i: riders.length };
  riders.push(r); return r;
}
function updateRiders(dt) {
  for (const r of riders) {
    r.hitCd -= dt;
    const waiting = state === 'intro' && introT < 10.6;
    r.horse.visible = r.m.root.visible = !waiting;
    let tx, tz, sp;
    if (state === 'outro' && outroCam && outroCam.column && outroCam.column.length) {   // walking beside the column on the far side
      const col = outroCam.column, C0 = V(0, 0, 0); for (const c of col) C0.add(c.pos); C0.multiplyScalar(1 / col.length);
      const t = C0.addScaledVector(outroCam.q, -4.2).addScaledVector(outroCam.w, r.i ? 4 : -4); tx = t.x; tz = t.z; sp = 2.2;
    } else if (waiting) { tx = r.pos.x; tz = r.pos.z; sp = 0; }
    else { r.ang += dt * .42 * r.dir; tx = MEADOW.x + Math.cos(r.ang) * 19; tz = MEADOW.z + Math.sin(r.ang) * 19; sp = 9.5; }   // round the outside of the ring at a gallop
    const dx = tx - r.pos.x, dz = tz - r.pos.z, d = Math.hypot(dx, dz), step = Math.min(sp * dt, d);
    if (d > .05) { r.pos.x += dx / d * step; r.pos.z += dz / d * step; r.yaw += wrapA(Math.atan2(dx, dz) - r.yaw) * Math.min(1, dt * 4); }
    const v = step / Math.max(dt, 1e-4); r.act.timeScale = clamp(v / 8, .2, 1.3); r.act.paused = v < .2;
    r.pos.y = heightAt(r.pos.x, r.pos.z);
    r.horse.position.copy(r.pos); r.horse.rotation.y = r.yaw; r.mixer.update(dt);
    if (betrayed && state === 'play') {
      for (const c of civs) if (!c.dead && !c.gone && !c.child && !c.spared && !c.prisoner && Math.hypot(c.pos.x - r.pos.x, c.pos.z - r.pos.z) < 2.2) {
        if (r.f.phase === 'idle') { C.beginAttack(r.f, Math.random() < .5 ? 'left' : 'right'); C.releaseAttack(r.f); }
        killCiv(c, V(Math.sin(r.yaw), 0, Math.cos(r.yaw)).multiplyScalar(4));
      }
      if (r.hitCd <= 0 && Math.hypot(P.pos.x - r.pos.x, P.pos.z - r.pos.z) < 1.8) { r.hitCd = 1.5; damagePlayer(16, r.pos.clone()); }   // ridden down
    }
    C.tickFighter(r.f, dt);
    const b = setPose(r, dt); r.m.root.position.set(r.pos.x, r.pos.y + SADDLE + b * .2, r.pos.z); r.m.root.rotation.y = r.yaw;
  }
}
function spawnCiv(look, x, z, child) {
  const m = soldier('lusitano', look); scene.add(m.root);
  const c = { kind: 'lusitano', civ: true, m, pos: new THREE.Vector3(x, heightAt(x, z), z), yaw: Math.atan2(x - MEADOW.x, z - MEADOW.z), f: C.createFighter(), state: 'idle',
    vel: { x: 0, z: 0 }, mv: { x: 0, z: 0 }, stride: 0, ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, hits: 0, crouch: false,
    sp: child ? 3.4 : rr(3.6, 4.3), child: !!child, female: !!look.female, hp: child ? 1 : look.female ? 3 : 4,
    resist: !child && rand() < (look.female ? .12 : .5), punchCd: 0, home: V(x, 0, z), flee: null, gone: false, delay: rr(0, .7) };
  m.root.position.copy(c.pos); m.root.rotation.y = c.yaw; civs.push(c); return c;
}
/** The betrayal: Galba gives the signal, the ring tightens and the people break and run in every direction. */
function betray() {
  if (betrayed) return; betrayed = true; betrayT = 0; SFX.horn(); SFX.warcry(1.2); armEnvoy(true);
  civs.filter(c => !c.child && !c.female && !c.elder).slice(0, 3).forEach(c => { c.spared = true; c.surrenderT = rr(1.2, 2.6); });   // a few men are taken alive, to be sold
  const near = enemies.filter(e => e.group === 'cordon' && !e.dead).sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos));
  near.slice(0, 3).forEach((e, i) => { e.alertIn = 3 + i * 1.2; });
  // the signal: a volley of pila into the crowd at once, a few of them at Viriato
  near.forEach((e, i) => { e.huntIn = rr(1, 16); e.style = rand() < .35 ? 'bash' : 'sword'; if (i < 3) { e.pilaAt = 'P'; e.pilaT = rr(1.6, 3.4); } else if (rand() < .12) { e.pilaAt = nearestAdultCiv(e.pos, 30); e.pilaT = rr(0, 6); } });   // the nearest legionaries turn on Viriato a few seconds later
  showMsg('A TRAIÇÃO', 'Há uma brecha no cerco. Corre por ela até ao fumo na orla da floresta.', 6);
}
function nearestAdultCiv(pos, r) {
  let best = null, bd = r;
  for (const c of civs) { if (c.dead || c.gone || c.child || c.spared) continue; const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z); if (d < bd) { bd = d; best = c; } }
  return best;
}
/** A blow lands on one of the people: they stagger and bleed, and fall only when it is too much. */
function hitCiv(c, push) {
  if (c.dead) return;
  if (--c.hp <= 0) return killCiv(c, push);
  c.knock = push.clone().multiplyScalar(.7); c.stun = .5; c.hits = (c.hits || 0) + 1; c.flash = .08; SFX.flesh(spatial(c.pos) * .6);
}
function killCiv(c, push) { if (c.dead) return; c.dead = true; c.deadT = 0; c.mv.x = c.mv.z = 0; c.knock = push || null; SFX.thud(spatial(c.pos) * .5); }
function updateCivs(dt) {
  if (halt) return updateCaptiveCivs(dt);
  if (betrayed) { betrayT += dt; setRing(state === 'outro' ? 17 : lerp(RING_R1, RING_R2, smooth(0, 24, betrayT))); }   // after the killing the line opens out round the field
  for (const c of civs) {
    if (c.gone) continue;
    if (c.knock) { c.pos.x += c.knock.x * dt; c.pos.z += c.knock.z * dt; c.knock.multiplyScalar(Math.exp(-6 * dt)); if (c.knock.length() < .05) c.knock = null; }
    if (c.dead) { c.deadT += dt; c.pos.y = heightAt(c.pos.x, c.pos.z); const b = setPose(c, dt); c.m.root.position.set(c.pos.x, c.pos.y + b, c.pos.z); continue; }
    let tx = c.home.x, tz = c.home.z, sp = 0;
    if (c.stun > 0) { c.stun -= dt; c.crouch = true; c.mv.x = c.mv.z = 0; const b = setPose(c, dt); c.m.root.position.set(c.pos.x, heightAt(c.pos.x, c.pos.z) + b, c.pos.z); continue; }
    if (c.resist && betrayed && !c.prisoner && !c.spared) {   // he will not die running: fists against the nearest soldier
      let foe = null, fd = 12;
      for (const e of enemies) if (!e.dead && !e.hidden) { const d = Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z); if (d < fd) { fd = d; foe = e; } }
      if (foe) {
        const dx = foe.pos.x - c.pos.x, dz = foe.pos.z - c.pos.z;
        if (fd > 1.3) { const v = Math.min(4, fd / Math.max(dt, 1e-3)); c.mv.x = dx / fd * v; c.mv.z = dz / fd * v; c.pos.x += c.mv.x * dt; c.pos.z += c.mv.z * dt; } else { c.mv.x = c.mv.z = 0; }
        c.yaw += wrapA(Math.atan2(dx, dz) - c.yaw) * Math.min(1, dt * 8); c.crouch = false;
        c.punchCd -= dt;
        if (fd < 1.6 && c.f.phase === 'idle' && c.punchCd <= 0) { C.beginAttack(c.f, C.randomDir(c.f.dir)); C.releaseAttack(c.f); c.punchCd = rr(.7, 1.5); }
        for (const ev of C.tickFighter(c.f, dt)) if (ev.type === 'swing' && !c.punched && fd < 1.9) {
          c.punched = true; C.stagger(foe.f, .55); foe.flash = .06; knock(foe, V(dx / fd, 0, dz / fd), .5); SFX.thud(spatial(foe.pos) * .7); foe.victim = c;   // the blow lands: the soldier reels and turns on him
        }
        if (c.f.phase !== 'strike') c.punched = false;
        c.pos.y = heightAt(c.pos.x, c.pos.z); const b = setPose(c, dt); c.m.root.position.set(c.pos.x, c.pos.y + b, c.pos.z); c.m.root.rotation.y = c.yaw;
        continue;
      }
    }
    if (c.spared && betrayed && !c.prisoner && (c.surrenderT -= dt) <= 0) {   // he gives up: kneels where he is, hands empty
      c.crouch = true; c.mv.x = c.mv.z = 0; c.yaw += wrapA(Math.atan2(MEADOW.x - c.pos.x, MEADOW.z - c.pos.z) - c.yaw) * Math.min(1, dt * 3);
      c.pos.y = heightAt(c.pos.x, c.pos.z); const b = setPose(c, dt); c.m.root.position.set(c.pos.x, c.pos.y + b, c.pos.z); c.m.root.rotation.y = c.yaw; continue;
    }
    if (betrayed && (c.delay -= dt) <= 0) {
      if (!c.flee) { const a = Math.atan2(c.pos.z - MEADOW.z, c.pos.x - MEADOW.x) + rr(-.6, .6); c.flee = V(MEADOW.x + Math.cos(a) * 90, 0, MEADOW.z + Math.sin(a) * 90); c.crouch = false; }
      if (!c.prisoner && (c.blockCd = (c.blockCd || 0) - dt) <= 0) {   // the shields are in the way: turn back and run another way
        const fx = c.flee.x - c.pos.x, fz = c.flee.z - c.pos.z, fl = Math.hypot(fx, fz) || 1;
        for (const e of enemies) {
          if (e.dead || e.hidden || e.state === 'escort') continue;
          const ex = e.pos.x - c.pos.x, ez = e.pos.z - c.pos.z, ed = Math.hypot(ex, ez);
          if (ed < 2.6 && (ex * fx + ez * fz) / (ed * fl) > .35) {
            const a = Math.atan2(c.pos.z - MEADOW.z, c.pos.x - MEADOW.x) + Math.PI + rr(-1.1, 1.1);
            c.flee = V(MEADOW.x + Math.cos(a) * 90, 0, MEADOW.z + Math.sin(a) * 90); c.blockCd = .8; break;
          }
        }
      }
      tx = c.flee.x; tz = c.flee.z; sp = c.sp;
    } else if (Math.hypot(c.pos.x - c.home.x, c.pos.z - c.home.z) > .6) sp = .9;
    const dx = tx - c.pos.x, dz = tz - c.pos.z, d = Math.hypot(dx, dz);
    let want;
    if (sp > 0 && d > .3) { const v = Math.min(sp, d / Math.max(dt, 1e-3)); c.mv.x = dx / d * v; c.mv.z = dz / d * v; c.pos.x += c.mv.x * dt; c.pos.z += c.mv.z * dt; want = Math.atan2(dx, dz); }
    else { c.mv.x = c.mv.z = 0; c.ph += dt; want = c.elder && envoy && !betrayed ? Math.atan2(envoy.pos.x - c.pos.x, envoy.pos.z - c.pos.z) : Math.atan2(c.pos.x - MEADOW.x, c.pos.z - MEADOW.z) + Math.sin(c.ph * .7) * .6; }   // restless, watching the soldiers
    c.yaw += wrapA(want - c.yaw) * Math.min(1, dt * 6);
    c.pos.y = heightAt(c.pos.x, c.pos.z);
    if (!c.prisoner && Math.hypot(c.pos.x - MEADOW.x, c.pos.z - MEADOW.z) > 50) { c.gone = true; c.m.root.visible = false; continue; }   // out among the trees
    const b = setPose(c, dt); c.m.root.position.set(c.pos.x, c.pos.y + b, c.pos.z); c.m.root.rotation.y = c.yaw;
  }
}
function checkPrologue() {
  setObjective();
  if (state === 'play' && (Math.hypot(P.pos.x - ESCAPE.x, P.pos.z - ESCAPE.z) < 9 || Math.hypot(P.pos.x - MEADOW.x, P.pos.z - MEADOW.z) > 50)) startOutro();   // into the wood, wherever he broke through
}
/* Escape: Viriato runs on into the trees, then stops, turns and looks back at the field. */
const OUTRO_LEN = 15;
let outroT = 0, outroCam = null, outroSaid = 0;
function startOutro() {
  state = 'outro'; outroT = 0; outroSaid = 0; introView = view;
  $('hud').classList.add('intro'); $('msg').style.opacity = 0; missionMsgT = 0;
  releaseAll(); C.endBlock(P.f);
  for (const e of enemies) if (!e.dead && e.group === 'cordon') { e.alertIn = null; if (e.state === 'chase') { e.state = 'cordon'; e.victim = null; } }   // the hunters give him up
  const dx = P.pos.x - MEADOW.x, dz = P.pos.z - MEADOW.z, dl = Math.hypot(dx, dz) || 1, u = V(dx / dl, 0, dz / dl), n = V(-u.z, 0, u.x);   // onward, away from the field
  outroCam = { u, n, at: V(P.pos.x, 0, P.pos.z).addScaledVector(u, 7).addScaledVector(n, 4.2) };
  outroCam.at.y = heightAt(outroCam.at.x, outroCam.at.z) + 1.5;
  // the survivors: roped in a double file and led off toward Galba's camp, between the bodies
  const wx = CAMP.x - MEADOW.x, wz = CAMP.z - MEADOW.z, wl = Math.hypot(wx, wz), w = V(wx / wl, 0, wz / wl), q = V(-w.z, 0, w.x);
  const alive = civs.filter(c => !c.dead), men = alive.filter(c => c.spared), rest = alive.filter(c => !c.spared).slice(0, 14 - men.length), caught = [...rest];
  for (const c of alive) if (!men.includes(c) && !rest.includes(c)) { c.gone = true; c.m.root.visible = false; }
  men.forEach((c, i) => caught.splice(Math.min(caught.length, 1 + i * 3), 0, c));   // the men walk among the women and children
  const S = V(MEADOW.x, 0, MEADOW.z).addScaledVector(w, -5);
  caught.forEach((c, i) => {
    const row = Math.floor(i / 2), p = S.clone().addScaledVector(w, -row * 1.5).addScaledVector(q, i % 2 ? .65 : -.65);
    c.pos.set(p.x, heightAt(p.x, p.z), p.z); c.gone = false; c.m.root.visible = true; c.prisoner = true; c.crouch = false; c.delay = 0; c.surrenderT = 0;
    c.sp = 1.15; c.flee = p.clone().addScaledVector(w, 120); c.yaw = Math.atan2(w.x, w.z);
  });
  const guards = enemies.filter(e => !e.dead && e.group === 'cordon').sort((a, b) => a.pos.distanceTo(S) - b.pos.distanceTo(S)).slice(0, 7);
  guards.forEach((e, k) => {
    const c = caught[Math.min(caught.length - 1, Math.round(k * (caught.length - 1) / Math.max(1, guards.length - 1)))]; if (!c) return;
    e.state = 'escort'; e.escortOf = c; e.victim = null; e.f.phase = 'idle';
    e.off = k === 0 ? w.clone().multiplyScalar(1.8) : k === guards.length - 1 ? w.clone().multiplyScalar(-1.8) : q.clone().multiplyScalar(-1.9);   // ahead, behind, and along the far side
    e.pos.set(c.pos.x + e.off.x, c.pos.y, c.pos.z + e.off.z); e.m.root.position.copy(e.pos);
  });
  outroCam.column = caught; outroCam.w = w; outroCam.q = q;
  outroCam.base = V(P.pos.x, 0, P.pos.z).addScaledVector(u, -2.6).addScaledVector(n, 1.3); outroCam.base.y = heightAt(outroCam.base.x, outroCam.base.z) + 1.6;
}
/* =========================================================
   'O Acampamento' (147 BC): the camp that fed the patrol. Burn its stores, then the centurion comes out.
   ========================================================= */
function resetCamp() {
  const s = campStart(CAMP);
  P.pos.set(s.x, heightAt(s.x, s.z), s.z); P.yaw = s.yaw; P.pitch = -.03;
  mission = 1;                                     // the stores: there is no patrol in this chapter
  for (let i = 0; i < companions; i++) spawnAlly(i);
  for (const g of campGarrison(CAMP)) spawn(g.kind, g.x, g.z, 'camp');
  addPickup('dardos', s.x + 2.5, s.z + 1.5); addPickup('pedras', s.x - 2.5, s.z + 1.5); addPickup('odre', s.x + .5, s.z + 3.5);
  addPickup('odre', CAMP.x + 20, CAMP.z + CAMP.half + 10);
}

/** Opening: the palisade and its gate, then over the wall to the stores, then down to Viriato in the scrub. */
let campSaid = 0;
function updateIntroCamp(dt) {
  const T = introT, L = CAMP_INTRO, y0 = heightAt(CAMP.x, CAMP.z), gz = CAMP.z + CAMP.half;
  P.crouch = 1; view = 'third'; updateCamera(dt); view = introView; AV.root.visible = true;
  introP1.copy(camera.position); introQ1.copy(camera.quaternion);
  let tgt; const look = (p, q) => { tgt = q; introP0.copy(p); introQ0.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, q, V(0, 1, 0))); };
  if (T < 4.2) {            // 1 · the gate and its towers, from outside, drifting in
    const k = T / 4.2, z = gz + 26 - k * 7;
    look(V(CAMP.x + 5 - k * 3, heightAt(CAMP.x, z) + 3.4, z), V(CAMP.x, y0 + 3.2, gz - 2));
  } else if (T < 8.4) {     // 2 · over the wall, along the lanes to the three stores
    const k = (T - 4.2) / 4.2, t = supplyTents[1] || { x: CAMP.x, z: CAMP.z + 4 };
    look(V(CAMP.x + 22 - k * 10, y0 + 13 - k * 3, CAMP.z + 24 - k * 8), V(t.x, y0 + 2, t.z));
  } else {                  // 3 · down to Viriato and his men in the scrub, looking at the gate
    const k = smooth(10.2, L, T), dx = CAMP.x - P.pos.x, dz = CAMP.z - P.pos.z, dl = Math.hypot(dx, dz) || 1;
    look(V(P.pos.x + dx / dl * 4.4 - dz / dl * 2, P.pos.y + 1.05, P.pos.z + dz / dl * 4.4 + dx / dl * 2), V(P.pos.x, P.pos.y + .95, P.pos.z));
    introP0.lerp(introP1, k); introQ0.slerp(introQ1, k);
  }
  camera.position.copy(introP0); camera.quaternion.copy(introQ0);
  sun.position.copy(tgt).addScaledVector(SUN_DIR, 120); sun.target.position.copy(tgt);
  const cut = [0, 4.2, 8.4].reduce((m, c) => Math.min(m, Math.abs(T - c)), 9);
  if (introVeil) introVeil.style.opacity = String(Math.max(clamp(1 - (T - .2) / 1.6, 0, 1), clamp(1 - cut / .3, 0, 1) * (T > 1 ? .85 : 0)));
  if (campSaid < 1 && T > .6) { campSaid = 1; showMsg('LUSITÂNIA · 147 A.C.', 'A patrulha caiu na estrada. Resta o acampamento que a sustentava.', 3.4); }
  if (campSaid < 2 && T > 4.5) { campSaid = 2; showMsg('', 'Três depósitos de mantimentos, e um centurião no pretório.', 3.4); }
  if (campSaid < 3 && T > 8.7) { campSaid = 3; showMsg('III · O ACAMPAMENTO', 'Entra sem que te oiçam.', 3); }
  if (T >= L) endIntro();
}

/** Closing: the band walks out of the gate with the stores burning behind them, and the camera rises on the fire. */
const CAMP_OUT = 13;
let campOut = null;
function startCampOutro() {
  state = 'outro'; outroT = 0; outroSaid = 0; introView = view;
  $('hud').classList.add('intro'); $('msg').style.opacity = 0; missionMsgT = 0;
  releaseAll(); C.endBlock(P.f); C.feint(P.f); P.charging = false; P.aimT = null; order = 'follow'; FLAG.visible = false;
  for (const e of enemies) if (!e.dead) { e.state = 'guard'; e.home.copy(e.pos); e.wander = V(e.pos.x, 0, e.pos.z); e.wT = 99; e.aware = 0; e.alarmT = null; if (e.f.blocking) C.endBlock(e.f); C.feint(e.f); }
  for (const a of allies) if (!a.dead) { if (a.f.blocking) C.endBlock(a.f); C.feint(a.f); a.throwPending = 0; a.throwT = 0; a.crouch = false; a.reach = 0; a.state = 'follow'; }
  const gz = CAMP.z + CAMP.half;
  campOut = { gate: V(CAMP.x, 0, gz), cam: V(CAMP.x - 7, 0, gz + 17), out: V(CAMP.x - 2, 0, gz + 34) };
}
function updateCampOutro(dt) {
  outroT += dt; const T = outroT, O = campOut;
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  const walk = (ent, tx, tz, sp) => {
    const dx = tx - ent.pos.x, dz = tz - ent.pos.z, d = Math.hypot(dx, dz) || 1;
    ent.pos.x += dx / d * sp * dt; ent.pos.z += dz / d * sp * dt; resolve(ent.pos, .4); ent.pos.y = heightAt(ent.pos.x, ent.pos.z);
    return { dx, dz, d };
  };
  allies.filter(a => !a.dead).forEach((a, i) => {
    const tx = O.out.x + ((i % 3) - 1) * 2.4, tz = O.out.z + Math.floor(i / 3) * 2.2, m = walk(a, tx, tz, 2.8);
    a.mv.x = lerp(a.mv.x, m.dx / m.d * 2.8, Math.min(1, dt * 6)); a.mv.z = lerp(a.mv.z, m.dz / m.d * 2.8, Math.min(1, dt * 6)); a.vel.x = a.vel.z = 0;
    faceTo(a, tx, tz, dt, 5); C.tickFighter(a.f, dt); a.flash = 0; for (const mt of a.m.mats) mt.emissive.setRGB(0, 0, 0);
    const bob = setPose(a, dt); a.m.root.position.set(a.pos.x, a.pos.y + bob, a.pos.z); a.m.root.rotation.y = a.yaw;
  });
  { const sp = T > 1.4 ? 2.5 : 0, m = walk(P, O.out.x + 2.6, O.out.z - 2, sp);   // Viriato last, looking back once
    P.vel.x = m.dx / (m.d || 1) * sp; P.vel.z = m.dz / (m.d || 1) * sp;
    const back = T > 5 && T < 7.4, want = back ? Math.atan2(CAMP.x - P.pos.x, CAMP.z - P.pos.z) : Math.atan2(m.dx, m.dz);
    P.yaw = wrapA(P.yaw + clamp(wrapA(want - P.yaw), -dt * 2.6, dt * 2.6)); P.pitch = 0; P.crouch = lerp(P.crouch, 0, Math.min(1, dt * 5)); }
  view = 'third'; updateCamera(dt); view = introView; VM.visible = false; AV.root.visible = true;
  const k = smooth(5, CAMP_OUT, T), cam = O.cam.clone();
  cam.y = heightAt(cam.x, cam.z) + 1.6 + k * 9;                       // rises to take in the burning camp
  const tgt = V(lerp(P.pos.x, CAMP.x, k), lerp(P.pos.y + 1.1, heightAt(CAMP.x, CAMP.z) + 4, k), lerp(P.pos.z, CAMP.z, k));
  camera.position.copy(cam); camera.lookAt(tgt); sun.position.copy(tgt).addScaledVector(SUN_DIR, 120); sun.target.position.copy(tgt);
  if (outroSaid < 1 && T > 1) { outroSaid = 1; showMsg('O ACAMPAMENTO ARDE', '', 2.6); }
  if (outroSaid < 2 && T > 5.2) { outroSaid = 2; showMsg('', 'Sem mantimentos e sem centurião, a guarnição não segura o vale.', 3.4); }
  if (outroSaid < 3 && T > 9.4) { outroSaid = 3; showMsg('', 'Viriato levou os montes. Roma ainda não sabe o nome dele.', 3.2); }
  if (T >= CAMP_OUT) {
    campOut = null; $('hud').classList.remove('intro'); state = 'won'; SFX.horn(); endT = .05; nextChapter = null;
    endArgs = ['III · 147 A.C.', 'Os montes são lusitanos', 'A patrulha caiu, os mantimentos arderam e o centurião está morto.'];
  }
}

/* =========================================================
   'Os Cativos' (149 BC): the survivors of the massacre, roped to stakes at a Roman halt. Viriato comes alone.
   ========================================================= */
let halt = null;
// the marching party's papilio: undyed goat leather, same shape as the ones in the camp
const TENT_MAT = MAT('leather', { side: THREE.DoubleSide }); TENT_MAT.color.setHex(0xb0a083); TENT_MAT.emissive.setHex(0x4a3c28);
const HALT_TENT_GEO = papilioGeo(THREE, { w: 3, l: 4.2, h: 2.2 });
const HALT_COLS = [];   // tent colliders, made once and switched on for this mission only
function resetCativos() {
  const L = haltLayout(HALT), objs = [], add = o => { scene.add(o); objs.push(o); return o; }, Y = (x, z) => heightAt(x, z);
  P.pos.set(CSTART.x, Y(CSTART.x, CSTART.z), CSTART.z); P.yaw = Math.atan2(P.pos.x - HALT.x, P.pos.z - HALT.z); P.pitch = -.05; P.pedras = 0;
  for (let i = 0; i < 2; i++) spawnAlly(i);   // two men who escaped the field with him
  // tents and the fire
  if (!HALT_COLS.length) for (const t of L.tents) HALT_COLS.push(addCol(t.x, t.z, 1.25));
  for (const c of HALT_COLS) c.off = false;
  for (const t of L.tents) {
    const g = new THREE.Mesh(HALT_TENT_GEO, TENT_MAT); g.castShadow = true; g.receiveShadow = true;
    const h = new THREE.Group(); h.add(g); h.position.set(t.x, Y(t.x, t.z), t.z); h.rotation.y = t.ry; add(h);
  }
  { const f = new THREE.Group(); f.position.set(L.fire.x, Y(L.fire.x, L.fire.z), L.fire.z);
    const ember = new THREE.Mesh(new THREE.ConeGeometry(.28, .5, 7), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); ember.position.y = .25;
    const lt = new THREE.PointLight(0xff9a40, 1.6, 12); lt.position.y = .7; f.add(ember, lt); add(f); }
  // three stakes, four captives roped to each, two guards
  const HC = [0x2a1d14, 0x3b2a1e, 0x1c1410, 0x4a3524, 0x5a3d24], DRESS = [0x6b4a2e, 0x8a5a2b, 0x4f5a3a, 0x7a3b2a, 0x5c4f45, 0x9a7a4a], OUT = ['lusitano', 'lusitano_b', 'lusitano_c', 'lusitano_d'];
  const pick = a => a[Math.floor(rand() * a.length)], stakeGeo = new THREE.CylinderGeometry(.07, .09, 1.7, 7), stakeMat = M(0x4a3524);
  const groups = L.groups.map(g => {
    const st = new THREE.Mesh(stakeGeo, stakeMat); st.position.set(g.x, Y(g.x, g.z) + .85, g.z); st.castShadow = true; add(st);
    const cs = g.captives.map(c => {
      const child = c.kind === 'child', woman = c.kind === 'woman', old = c.kind === 'elder';
      const look = { unarmed: true, cap: false, outfit: pick(OUT), hairColor: old ? 0x8f8a82 : pick(HC), female: woman || child,
        palette: { dress: pick(DRESS), skin: pick([0x9c6e52, 0x8a5e44, 0xa87a5a, 0x93664a]), long: woman }, scale: child ? rr(.56, .68) : woman ? rr(.9, .96) : rr(.95, 1.04),
        dress: woman, hair: woman ? ['hair_long'] : child ? ['hair_buzzed'] : [old || rand() < .6 ? 'hair_long' : 'hair_buzzed', 'hair_beard'] };
      const e = spawnCiv(look, c.x, c.z, child); e.kind2 = c.kind; e.yaw = c.yaw; e.bound = true; e.crouch = true; return e;
    });
    g.guards.forEach((q, k) => { const e = spawn('legio', q.x, q.z, 'halt'); e.yaw = q.yaw; e.wT = rr(2, 7); e.beat = k ? 6 : 1.5; });
    return { ...g, bound: true, civs: cs };
  });
  for (const q of L.sentinel) { const e = spawn('legio', q.x, q.z, 'halt'); e.yaw = q.yaw; e.beat = 3; }
  addPickup('dardos', CSTART.x - 6, CSTART.z + 3); addPickup('odre', CSTART.x - 2, CSTART.z - 4);
  halt = { groups, objs, cols: HALT_COLS, freed: 0, fighters: 0, cut: null, cutT: 0, reinfT: null, warned: 0, said: 0 };
}
const boundNear = (r = 3.2) => halt ? halt.groups.find(g => g.bound && Math.hypot(g.x - P.pos.x, g.z - P.pos.z) < r) : null;
/** The ropes are cut: the men look for arms among the dead, the others run for the woods. */
function freeGroup(g) {
  g.bound = false; SFX.swing(); let men = 0;
  for (const c of g.civs) {
    c.bound = false; c.crouch = false; halt.freed++;
    if (!isFighter(c.kind2)) { c.fleeTo = WOODS; c.delay = rr(0, .5); continue; }
    scene.remove(c.m.root); c.gone = true; men++;
    const a = spawnAlly(allies.length); a.pos.copy(c.pos); a.yaw = c.yaw; a.jav = 0; a.unarmed = true; a.armT = 0; a.freed = true;
    a.f.shieldHP = 0; a.shieldLost = true; if (a.m.shield) a.m.shield.visible = false; if (a.m.rig) a.m.rig.bareArm = true; if (a.m.weapon) a.m.weapon.visible = false;
    a.m.root.position.copy(a.pos);
  }
  halt.fighters += men;
  feed(`Cativos libertados: ${halt.freed} de 12`); showMsg('Cordas cortadas', men ? `${men} homens procuram armas entre os mortos.` : '', 2.6);
}
/** A freed man with empty hands: to the nearest fallen Roman, down beside him, and up again with his sword. → true while busy */
function armAlly(a, dt) {
  if (a.arming && (a.arming.stripped || !a.arming.dead)) a.arming = null;
  if (!a.arming) { let bd = 60; for (const e of enemies) if (e.dead && !e.stripped && (!e.takenBy || e.takenBy.dead || e.takenBy === a)) { const d = e.pos.distanceTo(a.pos); if (d < bd) { bd = d; a.arming = e; } } if (a.arming) { a.arming.takenBy = a; a.armT = 0; } }
  const b = a.arming; if (!b) return false;
  const there = lootWalk(a, b, 4.4, dt); faceTo(a, b.pos.x, b.pos.z, dt, 7);
  if (there) a.armT += dt;
  a.crouch = a.armT > .15; a.reach = a.armT > .4 ? .5 - .5 * Math.cos((a.armT - .4) * 5.2) : 0; a.vel.x = a.vel.z = 0;
  if (a.armT > 1.6) { a.unarmed = false; a.arming = null; a.crouch = false; a.reach = 0; b.stripped = true; if (b.m.weapon) b.m.weapon.visible = false; if (a.m.weapon) a.m.weapon.visible = true; SFX.clank(spatial(a.pos) * .5); }
  return true;
}
function updateCaptiveCivs(dt) {
  for (const c of civs) {
    if (c.gone) continue;
    if (c.fleeTo && (c.delay -= dt) <= 0) {
      const dx = c.fleeTo.x - c.pos.x, dz = c.fleeTo.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d < 7) { c.gone = true; scene.remove(c.m.root); continue; }
      c.mv.x = dx / d * c.sp; c.mv.z = dz / d * c.sp; c.pos.x += c.mv.x * dt; c.pos.z += c.mv.z * dt; resolve(c.pos, .35);
      c.yaw += wrapA(Math.atan2(dx, dz) - c.yaw) * Math.min(1, dt * 8);
    } else { c.mv.x = c.mv.z = 0; }
    c.pos.y = heightAt(c.pos.x, c.pos.z); const b = setPose(c, dt); c.m.root.position.set(c.pos.x, c.pos.y + b, c.pos.z); c.m.root.rotation.y = c.yaw;
  }
}
function updateCaptives(dt) {
  const H = halt; if (!H || state !== 'play') return;
  // cutting the ropes: stay beside the stake until it is done
  if (H.cut) {
    if (!H.cut.bound || Math.hypot(H.cut.x - P.pos.x, H.cut.z - P.pos.z) > 3.6 || P.f.phase === 'staggered') { H.cut = null; showPrompt('', .01); }
    else if ((H.cutT += dt) >= CUT_TIME) { freeGroup(H.cut); H.cut = null; }
    else showPrompt('A cortar as cordas…', .2);
  }
  // the alarm was given: a rider is gone for help
  if (alarm && H.reinfT == null) H.reinfT = REINFORCE_AFTER;
  if (H.reinfT != null && H.reinfT > 0 && (H.reinfT -= dt) <= 0) {
    const a = Math.atan2(roadX(HALT.z) - HALT.x, 0), bx = HALT.x + Math.sin(a) * 58, bz = HALT.z + Math.cos(a) * 58;
    for (let i = 0; i < RELIEF; i++) { const e = spawn('legio', bx + (i % 3 - 1) * 2.2, bz + Math.floor(i / 3) * 2.4, 'relief'); e.state = 'chase'; e.aware = 1; }
    SFX.horn(); showMsg('Chegaram os reforços', 'Foge para a floresta com quem libertaste.', 3.4);
  }
  // away into the woods
  if (Math.hypot(P.pos.x - WOODS.x, P.pos.z - WOODS.z) < 9) {
    if (canLeave(H.freed)) startCatOutro();
    else if ((H.warned -= dt) <= 0) { H.warned = 6; showPrompt(`Ainda só libertaste ${H.freed} cativos: precisas de ${FREE_TO_LEAVE}`, 2.5); }
  }
  setObjective();
}
/** Opening: the stakes and the guards seen close, the halt from above the fire, then Viriato and his two men in the scrub. */
function updateIntroCativos(dt) {
  const T = introT, L = CAT_INTRO, y0 = heightAt(HALT.x, HALT.z), H = halt;
  P.crouch = 1; view = 'third'; updateCamera(dt); view = introView; AV.root.visible = true;
  introP1.copy(camera.position); introQ1.copy(camera.quaternion);
  let tgt; const look = (p, q) => { tgt = q; introP0.copy(p); introQ0.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, q, V(0, 1, 0))); };
  if (T < 4.5) {          // 1 · among the captives at the first stake, low: roped, on their knees, a guard beside them
    const g = H.groups[0], gy = heightAt(g.x, g.z), a = Math.atan2(g.x - HALT.x, g.z - HALT.z) + .5 + T * .07;
    look(V(g.x + Math.sin(a) * 3.6, gy + 1.05, g.z + Math.cos(a) * 3.6), V(g.x, gy + .8, g.z));
  } else if (T < 9) {     // 2 · the halt from above the clearing: the awnings, the fire, the guards on their beats
    const a = 2.3 + (T - 4.5) * .08;
    look(V(HALT.x + Math.sin(a) * 12.5, y0 + 6.4 - (T - 4.5) * .25, HALT.z + Math.cos(a) * 12.5), V(HALT.x, y0 + .8, HALT.z));
  } else {                // 3 · from the scrub: Viriato and his two men watching, then down to his shoulder
    const dx = HALT.x - P.pos.x, dz = HALT.z - P.pos.z, dl = Math.hypot(dx, dz) || 1, k = smooth(11, L, T);
    look(V(P.pos.x + dx / dl * 4.6 - dz / dl * 1.8, P.pos.y + 1.0, P.pos.z + dz / dl * 4.6 + dx / dl * 1.8), V(P.pos.x, P.pos.y + .95, P.pos.z));
    introP0.lerp(introP1, k); introQ0.slerp(introQ1, k);
  }
  camera.position.copy(introP0); camera.quaternion.copy(introQ0);
  sun.position.copy(tgt).addScaledVector(SUN_DIR, 120); sun.target.position.copy(tgt);
  const cut = [0, 4.5, 9].reduce((m, c) => Math.min(m, Math.abs(T - c)), 9);
  if (introVeil) introVeil.style.opacity = String(Math.max(clamp(1 - (T - .2) / 1.6, 0, 1), clamp(1 - cut / .3, 0, 1) * (T > 1 ? .85 : 0)));
  if (H.said < 1 && T > .6) { H.said = 1; showMsg('LUSITÂNIA · 149 A.C.', 'Os que Galba não matou vão a caminho dos mercados de escravos.', 3.6); }
  if (H.said < 2 && T > 4.9) { H.said = 2; showMsg('', 'A coluna parou numa clareira. Sete legionários, doze cativos.', 3.6); }
  if (H.said < 3 && T > 9.4) { H.said = 3; showMsg('I · OS CATIVOS', 'Viriato seguiu-os com dois homens.', 3.2); }
  if (T >= L) endIntro();
}
/** Closing: the freed and the armed walk on into the wood past the smoke, Viriato last, and the mist closes behind them. */
const CAT_OUT = 12;
let catOut = null;
function startCatOutro() {
  state = 'outro'; outroT = 0; outroSaid = 0; introView = view;
  $('hud').classList.add('intro'); $('msg').style.opacity = 0; missionMsgT = 0;
  releaseAll(); C.endBlock(P.f); C.feint(P.f); P.charging = false; P.aimT = null; halt.cut = null;
  for (const e of enemies) if (!e.dead) { e.state = 'guard'; e.home.copy(e.pos); e.wander = V(e.pos.x, 0, e.pos.z); e.wT = 99; e.aware = 0; e.alarmT = null; if (e.f.blocking) C.endBlock(e.f); C.feint(e.f); }   // the Romans lose them in the mist
  const dx = WOODS.x - HALT.x, dz = WOODS.z - HALT.z, dl = Math.hypot(dx, dz) || 1, u = V(dx / dl, 0, dz / dl), n = V(-u.z, 0, u.x);
  for (const c of civs) if (c.fleeTo && !c.gone) c.fleeTo = { x: WOODS.x + u.x * 45, z: WOODS.z + u.z * 45 };
  for (const a of allies) if (!a.dead) { if (a.f.blocking) C.endBlock(a.f); C.feint(a.f); a.throwPending = 0; a.throwT = 0; a.crouch = false; a.reach = 0; a.state = 'follow'; }
  // a place for the camera beside their path with no trunk right in front of the lens
  let cam = null; for (const [b, sd] of [[-8, 5.5], [-8, -5.5], [-5, 6.5], [-11, 4.5], [-5, -6.5], [-11, -4.5]]) { const p = V(WOODS.x, 0, WOODS.z).addScaledVector(u, b).addScaledVector(n, sd); if (!cam) cam = p; if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oz]) => solidAt(p.x + ox, p.z + oz))) { cam = p; break; } }
  catOut = { u, n, cam };
}
function updateCatOutro(dt) {
  outroT += dt; const T = outroT, O = catOut, u = O.u, n = O.n;
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  const c0 = V(P.pos.x, 0, P.pos.z); let cn = 1;
  allies.filter(a => !a.dead).forEach((a, i) => {   // a loose file, each a little to one side of the last
    const tx = WOODS.x + u.x * 60 + n.x * ((i % 3) - 1) * 2.2, tz = WOODS.z + u.z * 60 + n.z * ((i % 3) - 1) * 2.2, dx = tx - a.pos.x, dz = tz - a.pos.z, d = Math.hypot(dx, dz) || 1, sp = 2.9;
    a.pos.x += dx / d * sp * dt; a.pos.z += dz / d * sp * dt; resolve(a.pos, .35); a.pos.y = heightAt(a.pos.x, a.pos.z);
    a.mv.x = lerp(a.mv.x, dx / d * sp, Math.min(1, dt * 6)); a.mv.z = lerp(a.mv.z, dz / d * sp, Math.min(1, dt * 6)); a.vel.x = a.vel.z = 0;
    faceTo(a, tx, tz, dt, 5); C.tickFighter(a.f, dt); a.flash = 0; for (const mt of a.m.mats) mt.emissive.setRGB(0, 0, 0);
    const bob = setPose(a, dt); a.m.root.position.set(a.pos.x, a.pos.y + bob, a.pos.z); a.m.root.rotation.y = a.yaw; c0.add(V(a.pos.x, 0, a.pos.z)); cn++;
  });
  // Viriato goes last
  { const sp = T > 1.2 ? 2.5 : 0; P.vel.x = u.x * sp; P.vel.z = u.z * sp; P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; resolve(P.pos, .4); P.pos.y = heightAt(P.pos.x, P.pos.z);
    P.yaw = wrapA(P.yaw + clamp(wrapA(Math.atan2(-u.x, -u.z) - P.yaw), -dt * 4, dt * 4)); P.pitch = 0; P.crouch = lerp(P.crouch, 0, Math.min(1, dt * 5)); }
  view = 'third'; updateCamera(dt); view = introView; VM.visible = false; AV.root.visible = true;
  // the camera waits at the edge of the wood by the smoke, lets them pass, and rises as the mist takes them
  c0.multiplyScalar(1 / cn); const cam = O.cam.clone(); cam.y = heightAt(cam.x, cam.z) + 1.5 + smooth(3, CAT_OUT, T) * .9;   // kept under the crowns of the trees
  const tgt = V(c0.x, heightAt(c0.x, c0.z) + 1.1, c0.z);
  camera.position.copy(cam); camera.lookAt(tgt); sun.position.copy(tgt).addScaledVector(SUN_DIR, 120); sun.target.position.copy(tgt);
  scene.fog.density = FOG_BASE * (1 + 1.6 * smooth(5.5, CAT_OUT, T));
  const men = allies.filter(a => !a.dead).length, freedMen = allies.filter(a => !a.dead && a.freed).length;
  if (outroSaid < 1 && T > 1) { outroSaid = 1; showMsg('OS CATIVOS ESTÃO LIVRES', '', 2.6); }
  if (outroSaid < 2 && T > 4.6) { outroSaid = 2; showMsg('', `${halt.freed} de 12 saíram da clareira. ${freedMen} ${freedMen === 1 ? 'leva' : 'levam'} armas romanas.`, 3.4); }
  if (outroSaid < 3 && T > 8.6) { outroSaid = 3; showMsg('', 'Nos montes, outros fugitivos juntaram-se a eles.', 3); }
  if (T >= CAT_OUT) {
    companions = companionsFrom(men); catOut = null;
    $('hud').classList.remove('intro'); state = 'won'; SFX.horn(); endT = .05; nextChapter = 'emboscada';
    endArgs = ['I · 149 A.C.', 'Os cativos estão livres', `${halt.freed} de 12 libertados. Viriato segue para os montes com ${men} ${men === 1 ? 'homem' : 'homens'}.`];
  }
}

/* Ambush won: Viriato's men come out of the scrub and strip the fallen patrol of its arms and rations. */
const LOOT_LEN = 13;
let loot = null;
function startLoot() {
  state = 'outro'; outroT = 0; outroSaid = 0; introView = view;
  $('hud').classList.add('intro'); $('msg').style.opacity = 0; missionMsgT = 0;
  releaseAll(); C.endBlock(P.f); C.feint(P.f); P.charging = false; P.aimT = null; P.vel.x = P.vel.z = 0; order = 'follow'; FLAG.visible = false;
  const dead = enemies.filter(e => e.dead), c = V(0, 0, 0);
  for (const e of dead) c.add(e.pos); if (dead.length) c.multiplyScalar(1 / dead.length); else c.copy(P.pos);
  c.y = heightAt(c.x, c.z);
  // at least three men for the work: those who fought, and others who had stayed hidden above the road
  let k = allies.length; while (allies.filter(a => !a.dead).length < 3 && k < 8) { const a = spawnAlly(k++), ang = Math.atan2(AMBUSH.x - c.x, AMBUSH.z - c.z) + rr(-.5, .5); a.pos.set(c.x + Math.sin(ang) * 13, 0, c.z + Math.cos(ang) * 13); a.pos.y = heightAt(a.pos.x, a.pos.z); }
  const free = [...dead], pickNear = p => { let b = null, bd = 1e9; for (const e of free) { const d = e.pos.distanceTo(p); if (d < bd) { bd = d; b = e; } } if (b) free.splice(free.indexOf(b), 1); return b; };
  const men = allies.filter(a => !a.dead).map(a => { if (a.f.blocking) C.endBlock(a.f); C.feint(a.f); a.state = 'follow'; a.throwPending = 0; a.throwT = 0; return { a, body: pickNear(a.pos), at: 0 }; });
  loot = { c, men, mine: pickNear(P.pos), mineAt: 0, a0: Math.atan2(P.pos.x - c.x, P.pos.z - c.z) + .9 };
}
/** Walk `pos` toward the fallen man and stop beside him. → true once there. */
function lootWalk(ent, body, sp, dt) {
  if (!body) { ent.mv.x = ent.mv.z = 0; return false; }
  const dx = body.pos.x - ent.pos.x, dz = body.pos.z - ent.pos.z, d = Math.hypot(dx, dz) || 1, near = d < 1.05;
  const v = near ? 0 : Math.min(sp, (d - .9) * 3 + .6);
  ent.pos.x += dx / d * v * dt; ent.pos.z += dz / d * v * dt; resolve(ent.pos, .35); ent.pos.y = heightAt(ent.pos.x, ent.pos.z);
  ent.mv.x = lerp(ent.mv.x, dx / d * v, Math.min(1, dt * 8)); ent.mv.z = lerp(ent.mv.z, dz / d * v, Math.min(1, dt * 8));
  return near;
}
function updateLoot(dt) {
  outroT += dt; const T = outroT, L = loot;
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  for (const m of L.men) {
    const a = m.a, there = lootWalk(a, m.body, 3.2, dt) || (!m.body && T > 2);
    if (m.body) faceTo(a, m.body.pos.x, m.body.pos.z, dt, 6);
    if (there) m.at += dt;
    a.crouch = m.at > .25; a.reach = m.at > .8 ? .5 - .5 * Math.cos((m.at - .8) * 2.6) : 0;   // down beside him, hands going over belt, purse and blade
    if (m.at > 3.2 && m.body) { if (m.body.m.weapon) m.body.m.weapon.visible = false; if (m.body.pack) m.body.pack.visible = false; }   // gladius and pack change hands
    const fa = a.m.root.getObjectByName('falcata'), dj = a.m.root.getObjectByName('dardo'); if (fa) fa.visible = !a.crouch; if (dj) dj.visible = false;
    a.vel.x = a.vel.z = 0; C.tickFighter(a.f, dt); a.flash = 0; for (const mt of a.m.mats) mt.emissive.setRGB(0, 0, 0);
    const bob = setPose(a, dt); a.m.root.position.set(a.pos.x, a.pos.y + bob, a.pos.z); a.m.root.rotation.y = a.yaw;
  }
  // Viriato goes to one of the fallen himself
  { const there = lootWalk({ pos: P.pos, mv: P.vel }, L.mine, 2.6, dt); if (there) L.mineAt += dt;
    if (L.mine) { const dx = L.mine.pos.x - P.pos.x, dz = L.mine.pos.z - P.pos.z; P.yaw = wrapA(P.yaw + clamp(wrapA(Math.atan2(-dx, -dz) - P.yaw), -dt * 5, dt * 5)); }
    P.pitch = 0; P.crouch = lerp(P.crouch, L.mineAt > .3 ? 1 : 0, Math.min(1, dt * 6)); avatar.reach = L.mineAt > 1 ? .5 - .5 * Math.cos((L.mineAt - 1) * 2.4) : 0;
    if (L.mineAt > 3.4 && L.mine) { if (L.mine.m.weapon) L.mine.m.weapon.visible = false; if (L.mine.pack) L.mine.pack.visible = false; } }
  view = 'third'; updateCamera(dt); view = introView; VM.visible = false; AV.root.visible = true; if (AV_FAL) AV_FAL.visible = L.mineAt < .3 && !P.unarmed;
  // the camera circles the road slowly, closing in
  const ang = L.a0 + T * .11, r = lerp(10.5, 7, smooth(0, LOOT_LEN, T)), cam = V(L.c.x + Math.sin(ang) * r, 0, L.c.z + Math.cos(ang) * r);
  cam.y = Math.max(heightAt(cam.x, cam.z) + 1.6, L.c.y + lerp(3.8, 2.8, smooth(0, LOOT_LEN, T)));   // high enough to see over the roadside rocks
  camera.position.copy(cam); camera.lookAt(L.c.x, L.c.y + .7, L.c.z);
  sun.position.copy(L.c).addScaledVector(SUN_DIR, 120); sun.target.position.copy(L.c);
  if (outroSaid < 1 && T > 1.2) { outroSaid = 1; showMsg('A PATRULHA CAIU', '', 2.6); }
  if (outroSaid < 2 && T > 5) { outroSaid = 2; showMsg('', 'Gládios, dardos, escudos e pão: tudo o que a patrulha trazia muda de mãos.', 3.4); }
  if (outroSaid < 3 && T > 9.2) { outroSaid = 3; showMsg('', 'A cada emboscada, os homens de Viriato ficavam mais bem armados.', 3.2); }
  if (T >= LOOT_LEN) {
    for (const m of L.men) { m.a.crouch = false; m.a.reach = 0; } avatar.reach = 0; P.crouch = 0; loot = null;
    $('hud').classList.remove('intro'); state = 'won'; SFX.horn(); endT = .05;
    nextChapter = 'acampamento';
    endArgs = ['VITÓRIA', 'A patrulha caiu', 'Nenhum romano voltou ao acampamento. Resta o acampamento que a abastecia, ao fundo da estrada.'];
  }
}
function updateOutro(dt) {
  if (loot) return updateLoot(dt);
  if (catOut) return updateCatOutro(dt);
  if (campOut) return updateCampOutro(dt);
  outroT += dt; const T = outroT, { u } = outroCam;
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  // he keeps running, deeper and deeper among the trees, until the wood swallows him
  if (T < 6) { const sp = 4.4; P.vel.x = u.x * sp; P.vel.z = u.z * sp; P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; } else { P.vel.x = P.vel.z = 0; }
  P.yaw = Math.atan2(-u.x, -u.z); P.pos.y = heightAt(P.pos.x, P.pos.z); P.pitch = 0;
  view = 'third'; updateCamera(dt); view = introView; VM.visible = false; AV.root.visible = T < 4.8;
  // the camera stays at the edge of the wood, then rises up through the leaves and turns to the field
  const col = outroCam.column, C0 = V(0, 0, 0);
  if (col.length) { for (const c of col) C0.add(c.pos); C0.multiplyScalar(1 / col.length); } else C0.set(MEADOW.x, heightAt(MEADOW.x, MEADOW.z), MEADOW.z);
  const rise = smooth(4.6, 9.5, T), drift = smooth(9, OUTRO_LEN, T), turn = smooth(5, 9.2, T);
  scene.fog.density = FOG_BASE * (1 - .5 * rise);   // above the trees the mist thins and the field shows
  const cam = outroCam.base.clone(); cam.y += rise * 17;
  cam.addScaledVector(V(C0.x - cam.x, 0, C0.z - cam.z), drift * .6); cam.y = lerp(cam.y, Math.max(C0.y + 7, heightAt(cam.x, cam.z) + 4), drift);   // glide out over the field toward the column
  camera.position.copy(cam);
  const tgt = V(P.pos.x, P.pos.y + 1.2, P.pos.z).lerp(V(C0.x, C0.y + 1, C0.z), turn);
  camera.lookAt(tgt);
  sun.position.copy(tgt).addScaledVector(SUN_DIR, 120); sun.target.position.copy(tgt);   // shadows where the camera looks
  if (outroSaid < 1 && T > 3) { outroSaid = 1; showMsg('VIRIATO ESCAPOU', '', 2.6); }
  if (outroSaid < 2 && T > 8.6) { outroSaid = 2; showMsg('', 'Galba matou ou vendeu como escravos milhares de lusitanos.', 3.2); }
  if (outroSaid < 3 && T > 11.9) { outroSaid = 3; showMsg('', 'Dos que fugiram, um voltaria com um exército.', 3); }
  if (T >= OUTRO_LEN) {
    $('hud').classList.remove('intro'); state = 'won'; endT = .05; nextChapter = 'cativos';
    endArgs = ['PRÓLOGO · 150 A.C.', 'Viriato escapou', 'Galba voltou a Roma, foi julgado e absolvido. A guerra na Lusitânia continuou.'];
  }
}
let nextChapter = null;
const SIGNAL = new THREE.Group(); SIGNAL.visible = false; scene.add(SIGNAL);
{
  const g = new THREE.CylinderGeometry(1.6, .5, 34, 16, 6, true), col = [], pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const t = (pos.getY(i) + 17) / 34; col.push(1, 1, 1, 0); pos.setX(i, pos.getX(i) + Math.sin(t * 5) * t * 1.2); }
  const m = new THREE.MeshBasicMaterial({ color: 0xcfc4b0, transparent: true, opacity: .32, depthWrite: false, side: THREE.DoubleSide });
  const smoke = new THREE.Mesh(g, m); smoke.position.y = 17; smoke.name = 'signal-smoke'; SIGNAL.add(smoke);
  const fire = new THREE.PointLight(0xff9a40, 2.4, 14); fire.position.y = .8; SIGNAL.add(fire);
  const ember = new THREE.Mesh(new THREE.ConeGeometry(.45, .9, 8), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); ember.position.y = .45; SIGNAL.add(ember);
  const ring = new THREE.Mesh(new THREE.RingGeometry(7.4, 8, 48), new THREE.MeshBasicMaterial({ color: 0xe8c36a, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = .08; SIGNAL.add(ring);
}
function updateSignal(dt) {
  SIGNAL.visible = (chapter === 'prologo' || chapter === 'cativos') && state !== 'menu' && (state !== 'outro' || chapter === 'cativos');
  if (!SIGNAL.visible) return;
  const sg = chapter === 'cativos' ? WOODS : ESCAPE; SIGNAL.position.set(sg.x, heightAt(sg.x, sg.z), sg.z);
  SIGNAL.children[0].rotation.y += dt * .25; SIGNAL.children[1].intensity = 2 + Math.sin(performance.now() * .013) * .5;
}

/** One of Viriato's companions: follows him, joins the fight once the Romans are fighting. */
function spawnAlly(i) {
  const m = soldier('lusitano', allyLook(i)); scene.add(m.root);
  const s = followSlot(i, P.pos, flatFwd());
  const a = { kind: 'lusitano', ally: true, m, pos: new THREE.Vector3(s.x, heightAt(s.x, s.z), s.z), yaw: P.yaw + Math.PI, hp: 110, f: C.createFighter(), state: 'follow', i,
    vel: { x: 0, z: 0 }, mv: { x: 0, z: 0 }, aiT: rr(0, .3), blockLeft: 0, releaseAt: 0, stride: 0, ph: rr(0, TAU), flash: 0, dead: false, deadT: 0, hits: 0, crouch: false, swingHits: new Set(), jav: JAVELINS.lusitano, throwT: 0, throwCd: 0, throwPending: 0 };
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
  { m: 'II · A EMBOSCADA', t: () => `Embosca a patrulha romana na estrada do vale (${patrolLeft()} restantes)` },
  { m: CAMP_MISSIONS[0].m, t: () => CAMP_MISSIONS[0].t(tentsBurnt) },
  { m: CAMP_MISSIONS[1].m, t: () => CAMP_MISSIONS[1].t() },
];
const patrolLeft = () => enemies.filter(e => e.group === 'patrol' && !e.dead).length;
function setObjective() { if (chapter === 'cativos' && halt) { const left = halt.groups.filter(g => g.bound).length, t = halt.reinfT; $('objm').textContent = 'I · OS CATIVOS';
    $('objt').textContent = (left ? `Liberta os cativos (${3 - left}/3 grupos)` + (canLeave(halt.freed) ? ' ou leva-os para o fumo na floresta' : '') : 'Leva-os para o fumo na floresta') + (t > 0 ? ` · reforços romanos em ${Math.ceil(t)} s` : ''); return; }
  if (chapter === 'prologo') { $('objm').textContent = 'PRÓLOGO · A TRAIÇÃO DE GALBA'; $('objt').textContent = `Foge pela brecha até ao fumo na floresta (${Math.round(Math.hypot(P.pos.x - ESCAPE.x, P.pos.z - ESCAPE.z))} m)`; return; } $('objm').textContent = MISSIONS[mission].m; $('objt').textContent = MISSIONS[mission].t(); }
function showMsg(title, sub, dur = 3.2) { $('msg').innerHTML = ''; const s = document.createElement('span'); s.textContent = title; $('msg').appendChild(s); if (sub) { const sm = document.createElement('small'); sm.textContent = sub; $('msg').appendChild(sm); } $('msg').style.opacity = 1; missionMsgT = dur; }
function feed(text) {
  const d = document.createElement('div'); d.textContent = text; $('feed').prepend(d);
  setTimeout(() => { d.style.opacity = 0; }, 3500); setTimeout(() => d.remove(), 4200);
  while ($('feed').children.length > 5) $('feed').lastChild.remove();
}
function checkMission() {
  if (chapter === 'prologo' || chapter === 'cativos') return;
  if (chapter !== 'acampamento') {
    if (mission === 0 && patrolLeft() === 0 && state === 'play') startLoot();   // the ambush is the whole chapter
    return;
  }
  const cent = enemies.find(e => e.kind === 'centurion');
  const phase = campPhase(tentsBurnt, !!(cent && cent.dead));
  if (phase === 'centurion' && mission === 1) {
    mission = 2; setObjective();
    spawn('centurion', CAMP.x, CAMP.z - 13, 'boss');
    for (const [ox, oz] of [[-3, -12], [3, -12], [-5, -15], [5, -15]].slice(0, RELIEF_GUARD)) spawn('legio', CAMP.x + ox, CAMP.z + oz, 'boss');
    SFX.horn();
    showMsg('O centurião sai do pretório', 'Derruba-o e o acampamento cai.');
  } else if (phase === 'won' && state === 'play') startCampOutro();
  if (mission < 3) $('objt').textContent = MISSIONS[mission].t();
}
function raiseAlarm() {
  if (alarm) return; alarm = true; SFX.horn();
  for (const e of enemies) if (!e.dead && (e.group === 'camp' || e.group === 'halt')) alert(e);
  if (chapter === 'cativos') { feed('Deram o alarme!'); showMsg('Alarme!', 'Um cavaleiro partiu a pedir reforços.', 3.2); } else feed('O acampamento deu o alarme!');
}

/* =========================================================
   Input
   ========================================================= */
const cv = canvas;
window.addEventListener('keydown', e => {
  if (state === 'intro' || state === 'outro') { if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { if (state === 'intro') introT = introLen(); else outroT = 99; } return; }   // only Enter skips: clicks and held keys from the fight do not
  keys[e.code] = true;
  if (state !== 'play') return;
  if (e.code === 'Digit1') selectW(0); if (e.code === 'Digit2') selectW(1); if (e.code === 'Digit3') selectW(2);
  if (e.code === 'KeyE') use();
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
  if (state === 'intro' || state === 'outro') return;
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
function selectW(w) { if (w === P.w) return; P.w = w; P.aimT = null; P.swing = 0; P.charging = false; C.feint(P.f); C.endBlock(P.f); P.throwT = 0; P.cd = Math.max(P.cd, .3); updateHUDWeapon(); }

/* =========================================================
   Player actions
   ========================================================= */
const tmpV = new THREE.Vector3();
function fwd3() { const cp = Math.cos(P.pitch); return tmpV.set(-Math.sin(P.yaw) * cp, Math.sin(P.pitch), -Math.cos(P.yaw) * cp).clone(); }
function eyePos() { return V(P.pos.x, P.pos.y + 1.68 - P.crouch * .6, P.pos.z); }
function makeNoise(r) { for (const e of enemies) if (!e.dead && e.state !== 'chase' && e.state !== 'skirmish' && e.pos.distanceTo(P.pos) < r) alert(e); }

/** Left button down with the javelins or the sling: draw back (javelin) or start whirling (sling) and keep charging. */
function beginThrow() {
  if (P.cd > 0 || P.throwPending || P.aimT != null) return;
  if (P.w === 1 && P.dardos <= 0) { showPrompt('Sem dardos — apanha-os do chão', 1.2); return; }
  if (P.w === 2 && P.pedras <= 0) { showPrompt('Sem pedras para a funda', 1.2); return; }
  P.aimT = 0; P.throwKind = P.w === 1 ? 'javelin' : 'sling';
}
/** Holding: arm drawn back / sling whirling. Released: the longer the hold, the faster and harder the throw (capped). */
function holdThrow(dt, held) {
  if (P.aimT == null) return;
  if (P.w === 0 || (P.w === 1 ? 'javelin' : 'sling') !== P.throwKind) { P.aimT = null; P.throwT = 0; return; }
  P.aimT += dt;
  if (held) { P.throwT = P.throwKind === 'javelin' ? 1 - .42 * Math.min(1, P.aimT / .25) : 1 - (P.aimT * .9) % .7; return; }
  P.throwPow = throwPower(P.aimT); P.aimT = null;
  if (P.throwKind === 'javelin') { P.dardos--; P.cd = .6; P.throwT = 1 - .45; P.throwPending = .05; SFX.throwJ(); }
  else { P.pedras--; P.cd = .55; P.throwT = 1 - .78; P.throwPending = .04; SFX.sling(); }
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
  const pw = P.throwPow || throwPower(1);
  const vel = kind === 'javelin' ? dir.multiplyScalar(pw.speed).add(V(0, 1.4, 0)) : dir.multiplyScalar(pw.speed * 1.35).add(V(0, .8, 0));
  spawnProj(kind === 'javelin' ? 'javelin' : 'stone', from, vel, 'player', pw.dmg);
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
    if (unaware && fromAngle > 90) { damageEnemy(e, 40 * C.DMG[ev.dir] * ev.power * 3.5, false, at, 'golpe furtivo'); hitStop(.07); P.quiet = true; continue; }
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
  if (ev.p1 >= 1) { makeNoise(P.quiet ? 4 : P.swingHits.size ? 14 : 6); P.quiet = false; } // the swish is heard once the blow is done
}
/** Push a soldier back a little (he also flinches via resolveHit). */
function knock(e, d, strength) { if (!e.vel) e.vel = { x: 0, z: 0 }; e.vel.x += d.x * strength * 2; e.vel.z += d.z * strength * 2; }
let hitStopT = 0;
function hitStop(t) { hitStopT = Math.max(hitStopT, t); }
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
  if (res.result === 'blocked' || res.result === 'parried') clog(res.result === 'parried' ? 'Aparo perfeito' : 'Bloqueado', '#a8c8e0');
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
    if (a.unarmed && state === 'play' && armAlly(a, dt)) { const bob = setPose(a, dt); r.position.set(a.pos.x, a.pos.y + bob, a.pos.z); r.rotation.y = a.yaw; continue; }
    const foe = state !== 'play' || a.unarmed ? null : order === 'charge' ? pickFoe(a.pos, enemies, 60, true)
      : order === 'hold' ? (Math.hypot(a.pos.x - post.x, a.pos.z - post.z) < 12 ? pickFoe(post, enemies, 7) : null)
      : near ? pickFoe(a.pos, enemies, 22) : null;
    if (foe && foe.state !== 'chase' && foe.state !== 'skirmish' && foe.pos.distanceTo(a.pos) < 10) alert(foe);
    let want = { x: 0, z: 0 };
    if (foe) {
      a.state = 'chase'; a.crouch = false;
      const dx = foe.pos.x - a.pos.x, dz = foe.pos.z - a.pos.z, d = Math.hypot(dx, dz) || 1;
      faceTo(a, foe.pos.x, foe.pos.z, dt, a.f.phase === 'windup' ? 3.5 : 7);
      a.aiT -= dt; a.blockLeft -= dt; a.throwCd -= dt;
      // javelins first: at range, while he has any (the falcata comes out once they are gone or the Roman is close)
      if (a.throwPending > 0) { if ((a.throwPending -= dt) <= 0) allyRelease(a, foe); }
      else if (allyThrows({ dist: d, jav: a.jav, phase: a.f.phase, cd: a.throwCd, sees: !a.f.blocking && losTerrain(a.pos.x, a.pos.y + 1.7, a.pos.z, foe.pos.x, foe.pos.y + 1.4, foe.pos.z) })) {
        a.jav--; a.throwCd = rr(1.6, 2.6); a.throwT = 1; a.throwKind = 'javelin'; a.throwPending = .32;
      }
      a.throwT = Math.max(0, a.throwT - dt / .6);
      { const dj = a.m.root.getObjectByName('dardo'), fa = a.m.root.getObjectByName('falcata'); if (dj) dj.visible = a.throwPending > 0; if (fa) fa.visible = !(a.throwPending > 0); }
      const throwing = a.throwPending > 0 || a.throwT > .45;
      if (a.f.phase === 'idle') { const wb = a.blockLeft > 0; if (wb && !a.f.blocking) { C.beginBlock(a.f, C.guardFor(a.f)); a.blockDir = foe.f.dir || 'left'; } else if (!wb && a.f.blocking) C.endBlock(a.f); }
      if (a.f.shieldHP <= 0) dropShield(a);
      if (a.aiT <= 0 && a.f.phase === 'idle' && !throwing) {
        a.aiT = .3;
        const act = allyAct({ dist: d, foePhase: foe.f.phase, rng: rand });
        if (act === 'block') a.blockLeft = rr(.5, .8);
        else if (act === 'attack' && a.blockLeft <= 0) { C.endBlock(a.f); const dir = C.randomDir(a.lastDir, rand); if (C.beginAttack(a.f, dir)) { a.lastDir = dir; a.releaseAt = C.WINDUP[dir] + rr(0, .2); } }
      }
      if (a.f.phase === 'windup' && !a.f.released && a.f.t >= a.releaseAt) C.releaseAttack(a.f);
      const sp = d > REACH ? Math.min(4.6, Math.max(.8, (d - REACH) * 3)) * (a.f.blocking ? .6 : 1) : d < 1.1 ? -1.4 : a.f.phase === 'windup' ? .9 : 0;
      want = throwing ? { x: 0, z: 0 } : { x: dx / d * sp, z: dz / d * sp };
      for (const ev of C.tickFighter(a.f, dt)) if (ev.type === 'swing') allySwing(a, ev);
      sampleTrail(a, a.pos, a.yaw, a.f);
    } else {
      a.state = 'follow'; if (a.f.blocking) C.endBlock(a.f); if (a.f.phase === 'windup') C.feint(a.f);
      C.tickFighter(a.f, dt);
      a.crouch = !post && P.crouch > .5;
      const s = post || followSlot(a.i, P.pos, pf), dx = s.x - a.pos.x, dz = s.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 70 && !post) { a.pos.x = s.x; a.pos.z = s.z; a.vel.x = a.vel.z = 0; }
      a.restT = d < 4 ? (a.restT || 0) - dt : 0;   // his place is taken by a tree or a rock: near enough, he stays put
      if (d > 70 && !post) {} else if (a.restT > 0) { a.moving = false; a.stuckT = 0; }
      else if (d > (a.moving ? .5 : 1.6)) {
        a.moving = true; const sp = Math.min(a.crouch ? 2.4 : sprinting || d > 9 ? 8 : 4.6, d * 2.2); want = { x: dx / d * sp, z: dz / d * sp };
        // blocked by a wall, hut or tree: slide round it for a moment
        if (sp > 1.5 && Math.hypot(a.mv.x, a.mv.z) < .6) a.stuckT = (a.stuckT || 0) + dt; else a.stuckT = 0;
        if (a.stuckT > .5 && d < 4) { a.restT = 999; a.stuckT = 0; }
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
/** A companion's javelin leaves his hand, aimed where the Roman will be. */
function allyRelease(a, foe) {
  if (!foe || foe.dead) return;
  const from = V(a.pos.x, a.pos.y + 1.75, a.pos.z), to = V(foe.pos.x + foe.mv.x * .45, foe.pos.y + 1.2, foe.pos.z + foe.mv.z * .45);
  const hd = Math.hypot(to.x - from.x, to.z - from.z), t = hd / 26;
  spawnProj('javelin', from, V((to.x - from.x) / t, (to.y - from.y) / t + .5 * 11 * t, (to.z - from.z) / t), 'ally', .75); SFX.jav(spatial(from));
}
function use() {
  if (chapter === 'cativos') { const g = boundNear(); if (g && state === 'play' && !halt.cut) { halt.cut = g; halt.cutT = 0; C.feint(P.f); P.charging = false; } return; }
  if (chapter !== 'acampamento') return;
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
    if (p.owner === 'player' || p.owner === 'ally') {
      const byAlly = p.owner === 'ally';
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
        if (!e.shieldLost && C.missileBlocked(e.f, { fromAngle, head: isHead, aware: e.state !== 'march' && e.state !== 'guard' })) {
          SFX.thud(spatial(p.pos)); burst('dust', p.pos, 6); if (!byAlly) feed('Bloqueado pelo escudo');
          e.f.shieldHP = Math.max(0, e.f.shieldHP - (p.type === 'javelin' ? 14 : 4)); if (e.f.shieldHP <= 0) dropShield(e);   // javelins ruin a shield
          alert(e);
          if (p.type === 'javelin' && !byAlly) addPickup('dardo1', ex + toProj.x * 1.2, ez + toProj.z * 1.2);
          done = true; break;
        }
        const base = p.type === 'javelin' ? 82 : 32;
        const unaware = e.state === 'march' || e.state === 'guard';
        damageEnemy(e, base * (p.dmg || 1) * (isHead ? (p.type === 'stone' ? 2.6 : 2) : 1) * (unaware ? 1.4 : 1), isHead, p.pos.clone(), null, byAlly);
        if (!byAlly) P.hits++;
        done = true; break;
      }
    } else {
      const c = V(P.pos.x, P.pos.y + 1.1 - P.crouch * .4, P.pos.z);
      if (segSphere(p.prev, p.pos, c, .55)) { damagePlayer(p.dmg, p.prev, true); done = true; }
      if (!done && civs.length) for (const cv of civs) if (!cv.dead && !cv.gone && !cv.child && !cv.spared && segSphere(p.prev, p.pos, V(cv.pos.x, cv.pos.y + 1, cv.pos.z), .5)) { killCiv(cv, p.vel.clone().setY(0).setLength(3)); done = true; break; }
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
const CLOG = []; let clogEl = null;
/** Bottom-left combat log: 'Golpe: 26 de dano', 'Recebeste 8 de dano'… fades out on its own. */
function clog(text, color = '#e8dcc4') {
  if (!clogEl) { clogEl = document.createElement('div'); clogEl.id = 'clog'; clogEl.style.cssText = 'position:absolute;left:18px;bottom:178px;font:15px/1.35 Georgia,serif;text-shadow:0 1px 2px #000;pointer-events:none'; ($('hud') || document.body).appendChild(clogEl); }
  CLOG.push({ text, color, t: 4 }); if (CLOG.length > 6) CLOG.shift(); drawClog();
}
function drawClog() { if (clogEl) clogEl.innerHTML = CLOG.map(l => `<div style="color:${l.color};opacity:${Math.min(1, l.t)}">${l.text}</div>`).join(''); }
function tickClog(dt) { if (!CLOG.length) return; for (const l of CLOG) l.t -= dt; while (CLOG.length && CLOG[0].t <= 0) CLOG.shift(); drawClog(); }
function damageEnemy(e, dmg, head, where, special, byAlly) {
  if (!byAlly && dmg > 0) clog(`${head ? 'Golpe na cabeça' : 'Golpe'}: ${Math.round(dmg)} de dano`, '#f0d9a0');
  e.hp -= dmg; e.flash = .15; e.hits = (e.hits || 0) + 1; e.heavy = dmg >= 45; burst('blood', where, head ? 14 : 8);
  const quiet = e.state === 'march' || e.state === 'guard';   // struck before he knew anyone was there
  SFX.flesh(); alert(e);
  if (!byAlly) { hitmT = .18; $('hitm').className = head ? 'head' : ''; $('hitm').style.opacity = 1; if (head) P.heads++; }
  if (e.hp <= 0) {
    e.dead = true; e.deadT = 0; if (!byAlly) P.kills++; SFX.die(spatial(e.pos)); if (e.group === 'patrol') dropPack(e);
    { const d = V(e.pos.x - P.pos.x, 0, e.pos.z - P.pos.z).normalize(); e.corpse = phys.addCorpse(e.pos, e.yaw, { x: d.x, y: .3, z: d.z }); }
    const name = { legio: 'Legionário', velite: 'Vélite', centurion: 'Centurião' }[e.kind];
    feed(`${name} abatido${byAlly ? ' por um companheiro' : special ? ' — ' + special : head ? ' — na cabeça' : ''}`);
    if (e.kind !== 'centurion' && rand() < .4) addPickup(rand() < .5 ? 'odre' : (rand() < .5 ? 'dardos' : 'pedras'), e.pos.x + rr(-.6, .6), e.pos.z + rr(-.6, .6));
    // the fallen alert their comrades
    for (const o of enemies) if (!o.dead && o.pos.distanceTo(e.pos) < alertRadius(quiet)) alert(o);
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
    if (res.result === 'blocked') { SFX.thud(); P.shake = .15; clog('Dardo bloqueado', '#a8c8e0'); if (res.stuck) showPrompt('Dardo cravado no escudo — R para arrancar', 1.4); return; }
    hurtPlayer(res.damage, from); return;
  }
  hurtPlayer(dmg * DIFF[diff].dmg, from);
}
function hurtPlayer(dmg, from) {
  if (state !== 'play') return;
  SFX.hurt(); P.hurtT = .35; P.hp -= dmg; clog(`Recebeste ${Math.round(dmg)} de dano`, '#e88a78');
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
  e.state = e.kind === 'velite' ? veliteState(e.jav) : 'chase'; e.aware = 1;
  if (e.barkT <= 0) { SFX.grunt(spatial(e.pos) * .8); e.barkT = 3; }
  if ((e.group === 'camp' || e.group === 'halt') && !alarm && mission >= 0) { e.alarmT = e.group === 'halt' ? 3.5 : 2.5; }   // he shouts for the horn unless silenced first
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
let frameNo = 0, lodSeq = 0;
/**
 * Pose the character, but not necessarily this frame: far-off and settled-dead bodies are posed less often
 * (src/lod.js). The skipped time is carried over, so the animation plays at the right speed either way.
 */
function setPose(e, dt) {
  if (e.pos) {
    e.poseDt = (e.poseDt || 0) + dt;
    if (e.lodId === undefined) e.lodId = lodSeq++;
    const dist = Math.hypot(e.pos.x - camera.position.x, e.pos.z - camera.position.z);
    if (!shouldPose({ dist, frame: frameNo, id: e.lodId, dead: !!e.dead, deadT: e.deadT || 0 })) return e.bob || 0;
    dt = e.poseDt; e.poseDt = 0;
  }
  return (e.bob = posePrecise(e, dt));
}

function posePrecise(e, dt) {
  if (e.m.rig) {
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    const tk = e.throwT > 0 ? { k: 1 - e.throwT, rel: e.throwKind === 'sling' ? .83 : .53 } : e.kind === 'velite' && e.atkT > 0 ? { k: 1 - e.atkT / .55, rel: .64 } : null;
    driveRig(THREE, e.m.rig, { speed: e.mv.x * fx + e.mv.z * fz, side: e.mv.x * fz - e.mv.z * fx, crouch: e.crouch, combat: e.state === 'chase', f: e.f, T: C, reach: e.reach || 0,
      throwK: tk ? clamp(tk.k * .33 / tk.rel, 0, 1) : -1, hit: e.hits, heavy: e.heavy, dead: e.dead, blockDir: e.blockDir || (e === avatar ? P.incomingDir : null) }, dt);
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
const engaged = new Set(); let armed = [];
/** Only the 2 (3 on Hard) nearest alerted swordsmen may close in; the rest wait in a ring. */
function updateEngaged() {
  engaged.clear(); armed = allies.some(a => a.unarmed) ? allies.filter(a => !a.unarmed) : allies;   // the Romans go for men with weapons first
  for (const e of enemies) e.T = !e.dead && e.state === 'chase' ? pickTarget(e.pos, P, armed) : null;
  const melee = enemies.filter(e => !e.dead && e.state === 'chase' && !e.T.ally);
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

    if (e.state === 'escort') {   // leading the captives away
      const t = e.escortOf, tx = t.pos.x + e.off.x, tz = t.pos.z + e.off.z, d = Math.hypot(tx - e.pos.x, tz - e.pos.z);
      if (d > .2) speed = moveEnemy(e, tx, tz, Math.min(2.4, d * 1.5 + .9), dt);
      faceTo(e, t.flee.x, t.flee.z, dt, 3);
    } else if (e.state === 'cordon') {   // the ring: hold the line; after the signal, cut down whoever runs within reach
      if (betrayed && state === 'play' && (!e.victim || e.victim.dead || e.victim.gone)) e.victim = Math.hypot(e.pos.x - MEADOW.x, e.pos.z - MEADOW.z) < 48 ? nearestAdultCiv(e.pos, 28) : null;
      if (e.huntIn > 0) e.huntIn -= dt;
      const v = betrayed && state === 'play' && !(e.huntIn > 0) ? e.victim : null;
      if (v) {
        const dv = Math.hypot(v.pos.x - e.pos.x, v.pos.z - e.pos.z);
        if (dv > 1.3) speed = moveEnemy(e, v.pos.x, v.pos.z, 3.7, dt);
        faceTo(e, v.pos.x, v.pos.z, dt, 8);
        e.civCd = Math.max(0, (e.civCd || 0) - dt);
        if (dv < 1.9 && e.f.phase === 'idle' && !(e.bashT > 0) && e.civCd <= 0) {
          if (e.style === 'bash' && !v.knocked) { e.bashT = .5; if (e.m.rig) e.m.rig.oneShot = { clip: 'Shield_OneShot', t: 0 }; }   // shield in the face first
          else { C.beginAttack(e.f, C.randomDir(e.f.dir)); C.releaseAttack(e.f); }   // overhead, either side or a thrust
        }
        if (e.bashT > 0 && (e.bashT -= dt) < .25 && !v.knocked) { v.knocked = true; v.stun = 1.1; v.knock = V(v.pos.x - e.pos.x, 0, v.pos.z - e.pos.z).setLength(4.5); SFX.thud(spatial(v.pos) * .6); }
        if (e.f.phase !== 'strike') e.struck = false;
        else if (!e.struck && dv < 2.4) { e.struck = true; e.civCd = rr(1.5, 2.8); hitCiv(v, V(v.pos.x - e.pos.x, 0, v.pos.z - e.pos.z).setLength(2.4)); }
      } else {
        const dh = Math.hypot(e.home.x - e.pos.x, e.home.z - e.pos.z);
        if (dh > .25) speed = moveEnemy(e, e.home.x, e.home.z, Math.min(e.party && !betrayed ? 1.3 : betrayed ? 4.6 : 6, dh * 2.5), dt);
        const ft = e.party && !betrayed && elder ? elder.pos : MEADOW; faceTo(e, ft.x, ft.z, dt, e.party ? 6 : 3);   // the parley party backs away still facing the elder
      }
      if (e.pilaT != null && state === 'play' && (e.pilaT -= dt) <= 0) {
        const tg = e.pilaAt === 'P' ? V(P.pos.x + P.vel.x * .35, P.pos.y + 1.1, P.pos.z + P.vel.z * .35)
          : e.pilaAt && !e.pilaAt.dead && !e.pilaAt.gone ? V(e.pilaAt.pos.x + e.pilaAt.mv.x * .5, e.pilaAt.pos.y + 1.1, e.pilaAt.pos.z + e.pilaAt.mv.z * .5) : null;
        e.pilaT = null; if (tg) { faceTo(e, tg.x, tg.z, 1, 99); spawnEnemyJavelin(V(e.pos.x, e.pos.y + 1.7, e.pos.z), tg, 14); }
      }
      for (const ev of C.tickFighter(e.f, dt)) if (ev.type === 'swing') enemySwing(e, ev);
      if (e.alertIn != null && state === 'play' && (e.alertIn -= dt) <= 0) { e.alertIn = null; alert(e); }
      if (state === 'play' && (pd < 3.5 || e.hp < e.maxhp)) alert(e);
    } else if (e.state === 'march' || e.state === 'guard') {
      if (e.state === 'march') {
        const tz = e.pos.z + e.dir * 3; speed = moveEnemy(e, roadX(tz) + (e.home.x - roadX(e.home.z)), tz, 1.7, dt);
        faceTo(e, roadX(tz) + (e.home.x - roadX(e.home.z)), tz, dt, 3);
        if (e.pos.z > 125 && e.dir > 0) e.dir = -1; if (e.pos.z < -70 && e.dir < 0) e.dir = 1;
      } else {
        e.wT -= dt;
        if (!e.wander || e.wT <= 0) { { const bt = e.beat || 6; e.wander = V(e.home.x + rr(-bt, bt), 0, e.home.z + rr(-bt, bt)); } e.wT = rr(4, 9); }
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
      const T = e.T || pickTarget(e.pos, P, armed), td = T.dist, tf = T.ally ? T.ally.f : P.f; // fights Viriato or a companion
      faceTo(e, T.pos.x, T.pos.z, dt, e.f.phase === 'windup' ? 3.5 : 7);
      const slow = e.slowT > 0 ? LEG_SLOW.factor : 1; e.slowT -= dt;
      e.blockLeft -= dt; e.aiT -= dt;
      // raise the scutum against missiles while closing in, or when the AI chose to block
      if (e.f.phase === 'idle') {
        const want = e.blockLeft > 0 || (!T.ally && pd > 3.5 && P.w !== 0);
        const g = C.guardFor(e.f), wantG = g === 'shield' ? want : e.blockLeft > 0;   // a sword is no cover against missiles
        if (wantG && !e.f.blocking) { C.beginBlock(e.f, g); e.blockDir = tf.dir || 'left'; } else if (!wantG && e.f.blocking) C.endBlock(e.f);
      }
      if (e.f.shieldHP <= 0) dropShield(e);
      if (e.aiT <= 0 && state === 'play' && e.f.phase === 'idle') {
        e.aiT = e.kind === 'centurion' ? .18 : .26; e.dodgeRoll = rand(); if (rand() < .12) e.strafe *= -1;
        const attackersNow = enemies.filter(o => o !== e && !o.dead && (o.T && o.T.ally) === (e.T && e.T.ally) && o.state === 'chase' && (o.f.phase === 'windup' || o.f.phase === 'strike' || o.f.phase === 'recovery' || /^attack/.test(o.act || ''))).length;   // anyone already swinging, or about to, at the same target
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
        // a tree or a rock in the way: after a moment of pushing against it, step round it
        if (td > 3 && fw.forward > 1.5 && Math.hypot(e.mv.x, e.mv.z) < .5) e.stuckT = (e.stuckT || 0) + dt; else e.stuckT = 0;
        if (e.stuckT > .4) { e.tries = (e.tries || 0) + 1; e.roundT = .9 + .5 * e.tries; if (e.tries % 2 || !e.round) e.round = e.round ? -e.round : e.strafe; e.stuckT = 0; }   // same side twice, a longer way round each time
        if (e.roundT > 0) { e.roundT -= dt; fw.strafe = e.round * e.sp; fw.forward = e.roundT > .5 * (.9 + .5 * e.tries) ? -.4 : fw.forward * .5; } else if (Math.hypot(e.mv.x, e.mv.z) > 2) e.tries = 0;
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
          spawnProj('javelin', from, vel, 'enemy', e.dmg); SFX.jav(spatial(from)); e.jav--;
        }
        if (e.atkT <= 0 && e.jav <= 0) veliteDraws(e);
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
  const mvArg = { fwd: lf / ml, side: ls / ml, sprint: sprintKey, crouch: P.crouch > .5, f: P.f };
  const sprint = ml > 0 && sprintKey && playerSpeed(mvArg) > 7;
  let slope = 0;
  if (ml) { const dx = (fx * lf + rx * ls) / ml, dz = (fz * lf + rz * ls) / ml; slope = heightAt(P.pos.x + dx, P.pos.z + dz) - heightAt(P.pos.x, P.pos.z); }
  const top = ml ? playerSpeed({ ...mvArg, slope }) : 0;
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
  { // running tires a little, sprinting a lot; while moving fast the breath does not come back
    const use = staminaUse({ speed, sprint });
    const inFight = !sprint && enemies.some(e => !e.dead && e.state === 'chase' && Math.abs(e.pos.x - P.pos.x) < 10 && Math.abs(e.pos.z - P.pos.z) < 10);
    if (use > 0 && inFight) P.st = Math.max(0, P.st - dt * (P.f.phase === 'idle' && !P.f.blocking ? C.STAMINA_REGEN * .4 : 0));   // footwork in a fight: the breath still comes back, slower
    else if (use > 0) P.st = Math.max(0, P.st - dt * (use + (P.f.phase === 'idle' && !P.f.blocking ? C.STAMINA_REGEN : 0)));
  }
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
  else if (mouseL && !P.prevL && P.unarmed) { showPrompt('Estás desarmado. Foge!', 1); }
  else if (mouseL && !P.prevL) {
    if (P.w === 0) { P.charging = true; P.chargeT = 0; P.acc.x = P.intent.x; P.acc.y = P.intent.y; }
    else beginThrow();
  }
  const released = !mouseL && P.prevL; P.prevL = mouseL;
  holdThrow(dt, mouseL);
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
  P.f.passiveShield = !P.unarmed && P.w !== 2 && P.cleanT <= 0;
  const wantBlock = P.unarmed ? null : keys.KeyQ && P.w === 0 ? 'sword' : mouseR && P.w !== 2 && P.f.shieldHP > 0 && P.cleanT <= 0 ? 'shield' : mouseR && P.w === 0 && P.f.shieldHP <= 0 ? 'sword' : null;   // shield gone: the right button raises the falcata
  if (P.f.shieldHP <= 0 && !P.unarmed) dropShield(avatar, true);
  if (wantBlock !== P.f.blocking) { if (wantBlock) { if (C.beginBlock(P.f, wantBlock)) P.charging = false; } else C.endBlock(P.f); }
  // auto-aim the sword guard at the nearest enemy winding up
  let inc = null, incD = 4;
  for (const e of enemies) if (!e.dead && e.f.phase === 'windup') { const d = e.pos.distanceTo(P.pos); if (d < incD) { incD = d; inc = e.f.dir; } }
  P.incomingDir = inc;
  P.hintCd = Math.max(0, (P.hintCd || 0) - dt);
  if (inc && incD < 3.4 && !P.f.blocking && !P.unarmed && P.w !== 2 && (P.blockHints || 0) < 4 && P.hintCd <= 0) { P.blockHints = (P.blockHints || 0) + 1; P.hintCd = 6; showPrompt('Golpe a caminho: segura o BOTÃO DIREITO para levantar o escudo', 1.4); }
  for (const ev of C.tickFighter(P.f, dt)) if (ev.type === 'swing') playerSwing(ev);
  sampleTrail('player', P.pos, playerFacing(), P.f);
  if (P.throwPending) { P.throwPending -= dt; if (P.throwPending <= 0) { P.throwPending = 0; releaseThrow(); } }
  P.swing = Math.max(0, P.swing - dt / .45); if (P.aimT == null) P.throwT = Math.max(0, P.throwT - dt / .6); P.hurtT = Math.max(0, P.hurtT - dt);

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
  if (chapter === 'acampamento') for (const t of supplyTents) if (!t.burnt && Math.hypot(t.x - P.pos.x, t.z - P.pos.z) < 5) pr = '<b>[E]</b> Incendiar os mantimentos';
  if (chapter === 'cativos' && boundNear() && !(halt && halt.cut)) pr = '<b>[E]</b> Cortar as cordas';
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
  avatar.f = P.f; avatar.state = P.w === 0 && !P.unarmed ? 'chase' : 'idle'; avatar.crouch = P.crouch > .4; avatar.dead = state === 'dead'; avatar.hits = P.hitsTaken; avatar.yaw = P.yaw + Math.PI; avatar.mv.x = P.vel.x; avatar.mv.z = P.vel.z; avatar.throwT = P.throwT; avatar.throwKind = P.throwKind;
  if (AV.rig) AV.rig.bareArm = !!P.unarmed || !!avatar.shieldLost;   // no shield in the prologue: the left arm swings free
  const bob3 = setPose(avatar, dt);
  AV.root.position.set(P.pos.x, P.pos.y + bob3 - (AV.rig ? 0 : P.crouch * .3), P.pos.z); AV.root.rotation.y = avatar.yaw;
  AV.root.visible = view === 'third'; AV_FAL.visible = P.w === 0 && !P.unarmed; if (AV.shield) AV.shield.visible = !P.unarmed && !avatar.shieldLost;
  const thrown = !P.throwPending && P.aimT == null && P.throwT > 0; // between release and drawing the next one
  AV_JAV.visible = P.w === 1 && P.dardos + (P.throwPending ? 1 : 0) > 0 && !thrown;
  AV_STONE.visible = P.w === 2 && P.pedras + (P.throwPending ? 1 : 0) > 0 && !thrown;
  if (view === 'third') {
    const dir = fwd3(), right = V(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
    const pivot = V(P.pos.x, P.pos.y + 1.6 - P.crouch * .5, P.pos.z);
    // over the right shoulder, Viriato left of centre so his sword arm and the foe are both in view
    const cp = pivot.addScaledVector(dir, -2.15).addScaledVector(right, .7).add(V(0, .22, 0));   // close over the shoulder, as in Warband
    const gh = heightAt(cp.x, cp.z) + .4; if (cp.y < gh) cp.y = gh;
    camera.position.copy(cp);
  }
  // viewmodel
  FAL.visible = P.w === 0 && !P.unarmed; JAV.visible = P.w === 1 && (P.dardos > 0 || P.throwT > 0); SLG.visible = P.w === 2;
  SHD.visible = !P.unarmed && P.w !== 2 && P.f.shieldHP > 0;
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
  if (chapter === 'prologo') return V(ESCAPE.x, 0, ESCAPE.z);
  if (chapter === 'cativos') { let best = null, bd = 1e9; if (halt) for (const g of halt.groups) if (g.bound) { const d = Math.hypot(g.x - P.pos.x, g.z - P.pos.z); if (d < bd) { bd = d; best = V(g.x, 0, g.z); } } return best || V(WOODS.x, 0, WOODS.z); }
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
  $('wname').textContent = P.unarmed ? 'Desarmado' : WNAMES[P.w];
  $('wlist').style.visibility = P.unarmed ? 'hidden' : '';
  $('wammo').textContent = P.w === 0 ? '—' : P.w === 1 ? `${P.dardos} / 10` : `${P.pedras} / 30`;
  for (const s of $('wlist').children) s.classList.toggle('on', +s.dataset.w === P.w);
  $('cross').classList.toggle('melee', P.w === 0);
}
function updateHUD(dt) {
  { // charge meter under the crosshair: how much strength the held button has stored
    const f = P.f, k = P.aimT != null ? throwPower(P.aimT).k : f.phase === 'windup' && !f.released && P.w === 0 ? Math.min(1, f.t / C.FULL_CHARGE) : -1, el = $('charge');
    if (el) { el.style.opacity = k >= 0 ? 1 : 0; if (k >= 0) { el.firstChild.style.width = (k * 100).toFixed(0) + '%'; el.className = k >= 1 ? 'full' : ''; } }
  }
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
let introT = 0, introView = 'third';
const INTRO_LEN = 9.5, CAT_INTRO = 13, CAMP_INTRO = 12;
const introLen = () => chapter === 'prologo' ? INTRO_P : chapter === 'cativos' ? CAT_INTRO : chapter === 'acampamento' ? CAMP_INTRO : INTRO_LEN;
let skipEl = null;
function skipHint() {
  const on = state === 'intro' || state === 'outro';
  if (on && !skipEl) { skipEl = document.createElement('div'); skipEl.textContent = 'ENTER para saltar'; skipEl.style.cssText = 'position:fixed;right:22px;bottom:18px;z-index:6;font:13px Georgia,serif;letter-spacing:.12em;color:rgba(232,220,196,.55);pointer-events:none'; document.body.appendChild(skipEl); }
  if (skipEl) skipEl.style.display = on ? 'block' : 'none';
}
let introVeil = null, introTitled = false, introHorn = false;
const OPENING = {
  cativos: ['I · Os Cativos', 'Agacha-te (C), mata os guardas pelas costas ou com dardos, e corta as cordas (E). Os teus dois homens só atacam quando a luta começar.'],
  emboscada: ['II · A Emboscada', 'Agacha-te (C) e aproxima-te sem seres visto. Um golpe pelas costas é mortal.'],
  acampamento: ['III · O Acampamento', 'Entra sem dar o alarme. Queima os três depósitos (E) e o centurião sai para te enfrentar.'],
};
function startGame(intro = false) {
  initAudio();
  intro = intro === true; nextChapter = null; $('next').classList.add('hidden');
  resetWorld();
  state = intro ? 'intro' : 'play'; introT = 0; introView = view;
  for (const k in keys) keys[k] = false; mouseL = mouseR = false;
  $('menu').classList.add('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden');
  updateHUDWeapon();
  if (intro) {
    if (chapter === 'prologo') { setRing(RING_FAR); for (const e of enemies) if (e.group === 'cordon' && !e.party) { e.pos.set(e.home.x, heightAt(e.home.x, e.home.z), e.home.z); e.m.root.position.copy(e.pos); e.m.root.visible = false; e.hidden = true; } }
    $('hud').classList.remove('hidden'); $('hud').classList.add('intro'); introTitled = introHorn = false; $('msg').style.opacity = 0;
    if (!introVeil) { introVeil = document.createElement('div'); introVeil.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;background:radial-gradient(ellipse at 50% 45%,rgba(4,6,10,.15) 20%,rgba(2,3,6,.92) 100%);transition:none'; document.body.appendChild(introVeil); }
    introVeil.style.display = 'block'; introVeil.style.opacity = 1;
  }
  else if (chapter === 'prologo') { setRing(RING_R1); for (const e of enemies) if (e.group === 'cordon') { e.pos.set(e.home.x, heightAt(e.home.x, e.home.z), e.home.z); e.m.root.position.copy(e.pos); } betray(); }
  else showMsg(...OPENING[chapter] || OPENING.emboscada, 5);
  lock();
}
const INTRO_P = 17;
/**
 * Prologue opening: a parley. A Roman envoy and his two guards promise land to an elder in front of the disarmed people.
 * The three back away; then the legions come running from all round the field and shut it, and at the horn the killing starts.
 */
function updateIntroPrologue(dt) {
  const L = INTRO_P, T = introT, y0 = heightAt(MEADOW.x, MEADOW.z);
  if (T > 10.6 && !envoy.cried) { envoy.cried = true; SFX.warcry(); }
  if (T > 10.6) for (const e of enemies) if (e.hidden) { e.hidden = false; e.m.root.visible = true; }   // out of the trees, at a run
  setRing(T < 10.6 ? RING_FAR : lerp(RING_FAR, RING_R1, smooth(10.6, 16.2, T)));
  view = 'third'; updateCamera(dt); view = introView; AV.root.visible = true;
  introP1.copy(camera.position); introQ1.copy(camera.quaternion);
  const look = (p, q) => { introP0.copy(p); introQ0.setFromRotationMatrix(new THREE.Matrix4().lookAt(p, q, V(0, 1, 0))); };
  if (!envoy.u) { const ux = elder.pos.x - envoy.pos.x, uz = elder.pos.z - envoy.pos.z, ul = Math.hypot(ux, uz) || 1; envoy.u = V(ux / ul, 0, uz / ul); envoy.p0 = envoy.pos.clone(); }
  const u = envoy.u, n = V(-u.z, 0, u.x), E = envoy.pos, D = elder.pos;
  const head = (p, h = 1.6) => V(p.x, p.y + h, p.z), mid = V((envoy.p0.x + D.x) / 2, (envoy.p0.y + D.y) / 2, (envoy.p0.z + D.z) / 2);
  if (T > 9.6 && !envoy.envoyDone) for (const e of enemies) if (e.party) { e.envoyDone = true; e.home.set(e.pos.x - u.x * 9, 0, e.pos.z - u.z * 9); }   // the three step back
  if (T < 5) {             // 1 · the envoy, his two guards and the elder; the people behind
    look(head(mid, 1.5).addScaledVector(n, 4.2).addScaledVector(u, -.9 + T * .08), head(mid, 1.3));
  } else if (T < 9) {      // 2 · over the envoy's shoulder: the elder answers
    look(head(envoy.p0, 1.75).addScaledVector(u, -1.5).addScaledVector(n, .55), head(D, 1.5));
  } else if (T < 12) {     // 3 · over the elder's shoulder: the three Romans back away
    look(head(D, 1.7).addScaledVector(u, 1.2).addScaledVector(n, -.5), head(E, 1.3));
  } else {                 // 4 · high over the field: the legions run in from every side… then down to Viriato
    const k = smooth(15.2, L, T), a = envoy.ang + Math.PI / 2;
    look(V(MEADOW.x + Math.cos(a) * 24, y0 + 10, MEADOW.z + Math.sin(a) * 24), V(MEADOW.x, y0 + 1, MEADOW.z));
    introP0.lerp(introP1, k); introQ0.slerp(introQ1, k);
  }
  camera.position.copy(introP0); camera.quaternion.copy(introQ0);
  const cut = [0, 5, 9, 12].reduce((m, c) => Math.min(m, Math.abs(T - c)), 9);
  if (introVeil) introVeil.style.opacity = String(Math.max(clamp(1 - (T - .2) / 1.6, 0, 1), clamp(1 - cut / .3, 0, 1) * (T > 1 ? .85 : 0)));
  if (!introTitled && T > .6) { introTitled = true; showMsg('LEGADO ROMANO', '«Ordens do pretor Galba: as armas no chão. Depois recebereis terras.»', 4.2); }
  if (!introHorn && T > 5.3) { introHorn = true; showMsg('ANCIÃO LUSITANO', '«Estão no chão. Que terras?»', 3.5); }
  if (!elder.said && T > 9.3) { elder.said = true; showMsg('LEGADO ROMANO', '«Já vos mostro.»', 2.4); }
  if (!envoy.saidTitle && T > 12.4) { envoy.saidTitle = true; showMsg('LUSITÂNIA · 150 A.C.', '', 2.4); }
  if (T >= L) endIntro();
}
/** Opening shot: the camera drops from above the castro and settles behind Viriato, who stands at the gate looking out over the valley. */
const introQ0 = new THREE.Quaternion(), introQ1 = new THREE.Quaternion(), introP0 = new THREE.Vector3(), introP1 = new THREE.Vector3();
function updateIntro(dt) {
  introT += dt;
  if (missionMsgT > 0) { missionMsgT -= dt; if (missionMsgT <= 0) $('msg').style.opacity = 0; }
  if (chapter === 'prologo') return updateIntroPrologue(dt);
  if (chapter === 'cativos' && halt) return updateIntroCativos(dt);
  if (chapter === 'acampamento') return updateIntroCamp(dt);
  view = 'third'; updateCamera(dt); view = introView;        // avatar posed, camera at its final third-person spot
  AV.root.visible = true;
  introP1.copy(camera.position); introQ1.copy(camera.quaternion);
  const t = clamp(introT / INTRO_LEN, 0, 1), e = t * t * (3 - 2 * t), k = 1 - e;
  const head = V(P.pos.x, P.pos.y + 1.55, P.pos.z);
  // creeping orbit: starts low in the mist in front of him, looking up at the silhouette, then rises and slips round to his shoulder
  const off = introP1.clone().sub(head); off.y = 0; off.multiplyScalar(1 + k * 1.9).applyAxisAngle(V(0, 1, 0), k * 2.9);
  introP0.copy(head).add(off);
  const lowY = heightAt(introP0.x, introP0.z) + .55; introP0.y = lowY + (introP1.y - lowY) * Math.pow(e, 1.4);
  introP0.x += Math.sin(introT * 1.3) * .05 * k; introP0.y += Math.sin(introT * 1.9) * .03 * k;   // a breath of hand-held sway
  const gh = heightAt(introP0.x, introP0.z) + .45; if (introP0.y < gh) introP0.y = gh;
  introQ0.setFromRotationMatrix(new THREE.Matrix4().lookAt(introP0, head, V(0, 1, 0)));
  camera.position.copy(introP0); camera.quaternion.slerpQuaternions(introQ0, introQ1, Math.pow(e, 3));
  // mist and darkness lift slowly; a carnyx sounds far off, then the title
  scene.fog.density = FOG_BASE * (1 + 2.6 * k * k);
  if (introVeil) introVeil.style.opacity = String(clamp(1 - (introT - .5) / 5.5, 0, 1));
  if (!introHorn && introT > 1.3) { introHorn = true; SFX.horn(); }
  if (!introTitled && introT > 4.2) { introTitled = true; showMsg('VIRIATO', chapter === 'cativos' ? 'Lusitânia · 149 a.C.' : 'Montes Hermínios, Lusitânia · 147 a.C.', 4.2); }
  if (introT >= INTRO_LEN) endIntro();
}
function endIntro() {
  scene.fog.density = FOG_BASE; if (introVeil) introVeil.style.display = 'none'; $('hud').classList.remove('intro');
  state = 'play';
  if (chapter === 'prologo') {
    $('hud').classList.remove('hidden'); updateHUDWeapon(); setRing(RING_R1);
    for (const e of enemies) { if (e.hidden) { e.hidden = false; e.m.root.visible = true; } if (e.group === 'cordon' && !e.party && Math.hypot(e.pos.x - e.home.x, e.pos.z - e.home.z) > 6) { e.pos.set(e.home.x, heightAt(e.home.x, e.home.z), e.home.z); e.m.root.position.copy(e.pos); } }   // skipped: the ring is already shut
    betray(); return;
  } view = introView; $('hud').classList.remove('hidden'); updateHUDWeapon();
  showMsg(...OPENING[chapter] || OPENING.emboscada, 5);
}
/** Drop every held input and combat stance (used when the game loses focus). */
function releaseAll() {
  for (const k in keys) keys[k] = false; mouseL = mouseR = false;
  P.prevL = false; P.charging = false; P.aimT = null; C.feint(P.f); C.endBlock(P.f);
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
  $('next').classList.toggle('hidden', !nextChapter); if (nextChapter) $('next').textContent = 'CONTINUAR · ' + ({ cativos: 'OS CATIVOS', emboscada: 'A EMBOSCADA', acampamento: 'O ACAMPAMENTO' }[nextChapter] || '');
}
let endT = 0, endArgs = null;
function die() { avatar.deadT = 0; avatar.f = P.f; C.endBlock(P.f); state = 'dead'; SFX.die(); endT = 2.8; endArgs = ['CAÍDO EM COMBATE', 'Viriato tombou', 'Tenta de novo.']; }
function win() { state = 'won'; SFX.horn(); endT = 1.8; endArgs = chapter === 'acampamento' ? ['VITÓRIA', 'Os montes são lusitanos', 'A patrulha caiu, os mantimentos arderam e o centurião está morto.'] : ['VITÓRIA', 'A patrulha caiu', 'Nenhum romano voltou ao acampamento. A notícia da emboscada vai correr os vales.']; }

$('start').addEventListener('click', () => startGame(!navigator.webdriver));
$('again').addEventListener('click', () => startGame(false));
$('next').addEventListener('click', () => { if (!nextChapter) return; setChapter(nextChapter); startGame(true); });
const BRIEF = {
  prologo: ['LUSITÂNIA · 150 A.C.', 'Prólogo. O pretor Sérvio Galba promete terras aos lusitanos que entreguem as armas. Viriato está entre os que as entregaram.'],
  emboscada: ['LUSITÂNIA · 147 A.C.', 'Três anos depois de Galba, Roma volta aos vales. Uma patrulha desce a estrada do vale. Viriato e os seus esperam-na escondidos no mato. Não deixes nenhum voltar.'],
  cativos: ['LUSITÂNIA · 149 A.C.', 'Os que Galba não matou vão a caminho dos mercados de escravos. A coluna parou numa clareira. Viriato seguiu-a com dois homens.'],
  acampamento: ['LUSITÂNIA · 147 A.C.', 'A patrulha caiu na estrada, mas é o acampamento que a sustenta. Queima-lhe os mantimentos e derruba o centurião, e Roma não aguenta estes vales.'],
};
function setChapter(c) {
  chapter = c; for (const o of document.querySelectorAll('[data-ch]')) o.setAttribute('aria-pressed', o.dataset.ch === c ? 'true' : 'false');
  if ($('kicker')) $('kicker').textContent = BRIEF[c][0]; if ($('brief')) $('brief').textContent = BRIEF[c][1];
}
for (const b of document.querySelectorAll('[data-ch]')) b.addEventListener('click', () => setChapter(b.dataset.ch));
setChapter(chapter);
$('resume').addEventListener('click', resume);
$('restart').addEventListener('click', () => startGame(false));
for (const b of document.querySelectorAll('[data-diff]')) b.addEventListener('click', () => { diff = +b.dataset.diff; for (const o of document.querySelectorAll('[data-diff]')) o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
const setSens = v => { sens = .0006 * v; };
$('sens').addEventListener('input', e => setSens(+e.target.value));
$('sens2').addEventListener('input', e => { setSens(+e.target.value); $('sens').value = e.target.value; });

/* =========================================================
   Main loop
   ========================================================= */
/* Campanha: ecrã do mapa (src/campaign/ui.js). Estado 'map': o 3D não corre nem pede o rato. */
const campUI = createCampaignUI({ document, window, storage, onClose: () => { state = 'menu'; $('menu').classList.remove('hidden'); refreshCampMenu(); } });
function refreshCampMenu() { $('camp-cont').classList.toggle('hidden', !campUI.hasSave()); }
function openCampaign(f) { try { document.exitPointerLock && document.exitPointerLock(); } catch (_) {} releaseAll(); if (!f()) { refreshCampMenu(); return; } state = 'map'; for (const id of ['menu', 'end', 'pause', 'hud']) $(id).classList.add('hidden'); }
function startCampaign(seed) { openCampaign(() => !!campUI.fresh(seed)); }
$('camp-new').addEventListener('click', () => startCampaign());
$('camp-cont').addEventListener('click', () => openCampaign(() => campUI.resume()));
refreshCampMenu();
let menuT = 0;
function step(dt) {
  if (state === 'map') { frameNo++; return; }
  frameNo++;
  WIND.tick(dt);
  skipHint();
  if (hitStopT > 0) { hitStopT -= dt; dt *= .15; } // brief impact freeze
  if (state === 'outro') { updateEnemies(dt); updateCivs(dt); updateRiders(dt); updateProjectiles(dt); updateOutro(dt); }
  else if (state === 'intro') { updateAllies(dt); updateEnemies(dt); updateCivs(dt); updateRiders(dt); updateProjectiles(dt); updateIntro(dt); }
  else if (state === 'play') { if (chapter === 'cativos') updateCaptives(dt); updatePlayer(dt); updateEnemies(dt); updateAllies(dt); updateProjectiles(dt); updateFallen(dt); updateCivs(dt); updateRiders(dt); updateCamera(dt); tickClog(dt); updateFlag(); updateHUD(dt); if (chapter === 'prologo') checkPrologue(); }
  else if (state === 'dead' || state === 'won') {
    if (endT > 0) { endT -= dt; if (endT <= 0 && endArgs) { endScreen(...endArgs); endArgs = null; } }
    updateEnemies(dt); updateAllies(dt); updateCivs(dt); updateProjectiles(dt);
    if (state === 'dead') {
      avatar.dead = true; avatar.deadT = (avatar.deadT || 0) + dt; avatar.mv.x = avatar.mv.z = 0;
      setPose(avatar, dt); AV.root.position.set(P.pos.x, P.pos.y, P.pos.z); AV.root.rotation.y = avatar.yaw; AV.root.visible = true; VM.visible = false;
      // the camera rises and draws back to look down on the fallen man, whatever the view
      const k = smooth(0, 2.2, avatar.deadT), back = V(Math.sin(P.yaw), 0, Math.cos(P.yaw));
      const cp = V(P.pos.x, P.pos.y, P.pos.z).addScaledVector(back, 2.4 + k * 1.6).add(V(0, 1.6 + k * 2.4, 0));
      camera.position.lerp(cp, Math.min(1, dt * 3)); camera.lookAt(P.pos.x, P.pos.y + .3, P.pos.z);
    }
  } else if (state === 'menu') {
    menuT += dt * .04;
    const cx = CAMP.x + 20, cz = 40;
    camera.position.set(cx + Math.sin(menuT) * 90, 42, cz + Math.cos(menuT) * 90);
    camera.lookAt(cx, 8, cz - 40);
    sun.position.set(cx, 0, cz).addScaledVector(SUN_DIR, 150); sun.target.position.set(cx, 0, cz);
    VM.visible = false;
  }
  if (state !== 'menu') VM.visible = view === 'first' && (state === 'play' || state === 'pause');
  updateFires(dt); updateParticles(dt); updateTrails(dt); updateSignal(dt); updateWisps(dt);
}
const AV = soldier('lusitano', { scale: 1.04, outfit: 'lusitano_b', hair: ['hair_long', 'hair_beard'], hairColor: 0x2a1d14, cap: false }); scene.add(AV.root); AV.root.visible = false;
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
  startCampaign, campaignStorage: storage, campaign: campUI,
  start: (d, ch = 'emboscada') => { if (d != null) diff = d; setChapter(ch); startGame(false); }, startIntro: (ch = chapter) => { setChapter(ch); startGame(true); }, get civs() { return civs; }, get riders() { return riders; }, get chapter() { return chapter; }, MEADOW, ESCAPE, CASTRO, get introT() { return introT; }, step, render: () => { if (state === 'map') return; cullChunks(CHUNKS, camera.position); cullCharacters(enemies, camera.position); cullCharacters(allies, camera.position); cullCharacters(civs, camera.position); R.render(); }, setQuality: q => R.setQuality(q), get quality() { return R.state.preset; }, resume, use, damagePlayer,
  P, supplyTents, heightAt, CAMP, scene, camera, CHUNKS,
  get enemies() { return enemies; }, get allies() { return allies; }, setCompanions: n => { companions = n; }, forceDir: d => { forcedDir = d; }, get order() { return order; }, get placing() { return placing; }, flag: FLAG, flagAt, hurtAllyForTest: (a, d) => hurtAlly(a, d, a.pos.clone()), get mission() { return mission; }, get tentsBurnt() { return tentsBurnt; }, alertForTest: e => alert(e), get halt() { return halt; }, get companions() { return companions; }, get alarm() { return alarm; }, get nextChapter() { return nextChapter; }, HALT, WOODS, CSTART, get state() { return state; },
  get projectiles() { return projectiles; }, get pickups() { return pickups; },
  input: { mouse: (l, r) => { mouseL = l; mouseR = r; }, mouseMove: (dx, dy) => { C.nudgeIntent(P.intent, dx, dy); if (P.charging) { P.acc.x += dx; P.acc.y += dy; } if (P.f.phase === 'windup' && !P.f.released) { P.post.x += dx; P.post.y += dy; } } },
  prompt: (t) => showPrompt(t, 1.2),
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
  try { rapier = await withTimeout((async () => { const R = (await import('../vendor/rapier/rapier.es.js')).default; await R.init(); return R; })(), 8000); }
  catch (err) { console.warn('Rapier unavailable, using simple physics', err); rapier = null; }
  renderer.useLegacyLights = true;
  const chars = await loadChars(THREE).catch(err => { console.warn('Animated characters unavailable, using simple models', err); return null; });
  const game = await createGame({ chars, THREE, renderer, canvas, document, window, rapier, loader: new THREE.TextureLoader(), quality: (() => { try { return window.localStorage.getItem('viriato.quality') || 'medium'; } catch (_) { return 'medium'; } })() });
  if (!game.physicsOk) document.getElementById('physnote').classList.remove('hidden');
  let last = 0;
  // tuning aids: F8 = slow motion (1×, ½×, ¼×); window.__moves / window.__combat = poses and timings, editable live in the console
  let timeScale = 1;
  window.addEventListener('keydown', e => { if (e.code !== 'F8') return; e.preventDefault(); timeScale = timeScale === 1 ? .5 : timeScale === .5 ? .25 : 1; game.prompt && game.prompt(`Velocidade ${timeScale === 1 ? 'normal' : timeScale === .5 ? '½×' : '¼×'}`); });
  import('./moves.js').then(m => { window.__moves = m; }); import('./combat.js').then(m => { window.__combat = m; });
  // window.game: the hook the studio framework's checks drive the game through (src/hook.js).
  // ?manual=1 holds the loop so only step() moves the game; ?scene=<chapter> starts in that chapter.
  const { manual, scene } = installHook(game, window);
  if (scene) game.start(null, scene);
  const fps = newFps(), fpsEl = document.getElementById('fps');
  const frame = t => {
    const dt = Math.min(.05, (t - last) / 1000 || 0) * timeScale; last = t;
    game.step(dt); game.render();
    const f = tickFps(fps, t);
    if (f != null && fpsEl) fpsEl.textContent = `${f} imagens por segundo · gráficos ${{ low: 'Baixa', medium: 'Média', high: 'Alta' }[game.quality]}`;
    requestAnimationFrame(frame);
  };
  if (!manual) requestAnimationFrame(frame);
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
  const [body, a1, a2, hl, hb, hz, bf, hr, pr] = await Promise.all(['body', 'anim_ual1', 'anim_ual2', 'hair_long', 'hair_beard', 'hair_buzzed', 'body_f', 'horse'].map(get).concat(get('props').catch(() => null)));
  const props = {}; if (pr) for (const sc of pr.scenes) { sc.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.metalness = 0; o.material.roughness = 1; } }); props[sc.name] = sc; }   // CC0 props (KayKit): sack, barrel, crates, tent…
  const tl = new THREE.TextureLoader(), textures = {};
  await Promise.all(['roman_red', 'roman_white', 'roman_mail', 'velite', 'lusitano', 'lusitano_b', 'lusitano_c', 'lusitano_d'].map(async k => {
    const t = await tl.loadAsync(base + 'body_' + k + '.jpg'); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; textures[k] = t;
  }));
  return { props, body: body.scene, bodyF: bf.scene, horse: { scene: hr.scene, clip: hr.animations[0] }, clips: [...a1.animations, ...a2.animations], hair: { hair_long: hl.scene, hair_beard: hb.scene, hair_buzzed: hz.scene }, textures, split: [null, null], clone: SkeletonUtils.clone };
}
