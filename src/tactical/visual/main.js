// M2 — demonstração isolada da linguagem visual das tropas. Não lê a simulação nem toca no protótipo:
// duas formações fixas, quatro representações, três distâncias de câmara e contadores de custo.
import * as THREE from 'three';
import { createStyle, budgetTable, STYLE_INFO } from './styles.js';
import { P } from './models.js';

const $ = id => document.getElementById(id);
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

// --- formações (locais: f = para a frente, r = para a direita do grupo) ---
// Uma formação romana de 15 legionários (3 filas × 5), signífero atrás e dois vélites à frente.
// Um grupo lusitano de 14 guerreiros em meia-lua e 4 fundeiros atrás. 36 soldados ao todo.
function romanRoster() {
  const out = [];
  for (let rank = 0; rank < 3; rank++) {
    for (let file = 0; file < 5; file++) out.push({ role: 'legionario', f: -rank * 1.15, r: (file - 2) * 0.95, squad: rank });
  }
  out.push({ role: 'signifer', f: -3.55, r: 0.15, squad: 3 });
  out.push({ role: 'velite', f: 2.7, r: -3.4, squad: 4 });
  out.push({ role: 'velite', f: 3.15, r: 3.4, squad: 4 });
  return out;
}
function lusRoster() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const r = (i - 3.5) * 1.5;
    out.push({ role: 'guerreiro', f: 0.5 - Math.abs(r) * 0.055, r, squad: i < 4 ? 0 : 1 });
  }
  for (let i = 0; i < 6; i++) {
    const r = (i - 2.5) * 1.7;
    out.push({ role: 'guerreiro', f: -1.6 - Math.abs(r) * 0.03, r, squad: i < 3 ? 2 : 3 });
  }
  for (let i = 0; i < 4; i++) out.push({ role: 'fundeiro', f: -4.7, r: (i - 1.5) * 1.9, squad: 4 });
  return out;
}

const START = {
  romanos: { x: -11, z: 0, yaw: 0.62 },
  lusitanos: { x: 11, z: 0, yaw: Math.PI - 0.62 },
};
const ANCHOR = {
  march: { romanos: { x: -11, z: 0 }, lusitanos: { x: 11, z: 0 } },
  charge: { romanos: { x: -4.8, z: 1.4 }, lusitanos: { x: 4.8, z: 1.4 } },
  melee: { romanos: { x: -1.3, z: 2.4 }, lusitanos: { x: 1.3, z: 2.4 } },
  withdraw: { romanos: { x: -6.5, z: 2.2 }, lusitanos: { x: 7, z: 1.4 } },
  rout: { romanos: { x: -7, z: 1.8 }, lusitanos: { x: 7.5, z: -1.4 } },
};
const SCATTER = { march: 0.06, charge: 0.22, melee: 0.42, withdraw: 0.32, rout: 1.3 };

function makeBand(faction, roster, offset) {
  const start = START[faction];
  const soldiers = roster.map((r, i) => ({
    id: `${faction}-${i}`, faction, role: r.role, squad: r.squad,
    slot: { f: r.f, r: r.r }, phase: hash(i + offset, faction.length) * Math.PI * 2,
    jx: hash(i * 3 + 1, offset) * 2 - 1, jz: hash(i * 7 + 2, offset) * 2 - 1,
    x: start.x, z: start.z, y: 0, yaw: start.yaw,
  }));
  return { faction, yaw: start.yaw, anchor: { x: start.x, z: start.z }, soldiers, squads: [] };
}

const bands = [makeBand('romanos', romanRoster(), 1), makeBand('lusitanos', lusRoster(), 7)];

/** Escreve posições e squads (para os anéis do estilo M1) a partir da âncora e do espalhamento. */
function placeBands(state) {
  for (const band of bands) {
    const c = Math.cos(band.yaw), s = Math.sin(band.yaw);
    const scat = SCATTER[state] * (band.faction === 'romanos' ? 0.3 : 1);
    for (const sol of band.soldiers) {
      let ox = sol.jx * scat, oz = sol.jz * scat;
      if (state === 'rout' && band.faction === 'lusitanos') { ox -= c * 1.7; oz -= s * 1.7; }
      sol.x = band.anchor.x + c * sol.slot.f - s * sol.slot.r + ox;
      sol.z = band.anchor.z + s * sol.slot.f + c * sol.slot.r + oz;
      sol.yaw = band.yaw + (state === 'rout' ? sol.jx * 0.8 : sol.jx * 0.05);
    }
    const groups = new Map();
    for (const sol of band.soldiers) {
      if (!groups.has(sol.squad)) groups.set(sol.squad, []);
      groups.get(sol.squad).push(sol);
    }
    band.squads = [...groups.values()].map(list => ({
      side: band.faction, men: list.length,
      x: list.reduce((n, s) => n + s.x, 0) / list.length,
      z: list.reduce((n, s) => n + s.z, 0) / list.length,
    }));
  }
}

// --- cena ---
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const sky = new THREE.Color('#ccd0bd');
scene.background = sky;
scene.fog = new THREE.Fog(sky, 150, 360);
const camera = new THREE.PerspectiveCamera(38, 1, 1, 900);

scene.add(new THREE.HemisphereLight('#e9eff2', '#5f5336', 0.85));
const sun = new THREE.DirectionalLight('#fff0d0', 1.9);
sun.position.set(-55, 105, 70);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 20, far: 260 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);

/** Chão seco com manchas: a leitura das silhuetas é o que importa, não o cenário. */
{
  const g = new THREE.PlaneGeometry(280, 210, 140, 105);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const base = new THREE.Color('#8b8a55'), dark = new THREE.Color('#6c7144'), earth = new THREE.Color('#9c8659');
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = vnoise(x * 0.11, z * 0.11) * 0.65 + vnoise(x * 0.42, z * 0.42) * 0.35;
    c.copy(base).lerp(dark, n * 0.6).lerp(earth, vnoise(x * 0.045 + 9, z * 0.045) * 0.25);
    c.multiplyScalar(0.88 + n * 0.22);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

/** Tufos e pedras: dão escala e distância, sem esconder os soldados. */
{
  const n = 900, m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
  const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.14, 0.42, 4), new THREE.MeshStandardMaterial({ color: '#7f8a4c', roughness: 1 }), n);
  for (let i = 0; i < n; i++) {
    let x = -130 + hash(i, 3) * 260, z = -95 + hash(i, 5) * 190;
    if (Math.abs(x) < 24 && Math.abs(z) < 12) x += x < 0 ? -26 : 26;
    m.compose(new THREE.Vector3(x, 0.18, z), q, new THREE.Vector3(1, 0.7 + hash(i, 7), 1));
    tuft.setMatrixAt(i, m);
    tuft.setColorAt(i, c.setHSL(0.16 + hash(i, 11) * 0.05, 0.32, 0.28 + hash(i, 13) * 0.12));
  }
  tuft.receiveShadow = true;
  scene.add(tuft);

  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: '#8d887b', roughness: 0.95, flatShading: true }), 40);
  for (let i = 0; i < 40; i++) {
    const a = hash(i, 17) * Math.PI * 2, d = 30 + hash(i, 19) * 85;
    const x = Math.cos(a) * d, z = Math.sin(a) * d * 0.6;
    const s = 0.4 + hash(i, 23) * 1.5;
    m.compose(new THREE.Vector3(x, s * 0.28, z), q.setFromEuler(new THREE.Euler(hash(i, 29), hash(i, 31) * 6, 0)), new THREE.Vector3(s * 1.2, s * 0.7, s));
    rocks.setMatrixAt(i, m);
  }
  rocks.castShadow = rocks.receiveShadow = true;
  scene.add(rocks);
}

// --- pó de carga e de combate ---
const DUST = 260;
const dustPos = new Float32Array(DUST * 3), dust = [];
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustPoints = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: P.dust, size: 0.34, transparent: true, opacity: 0.55, depthWrite: false }));
dustPoints.frustumCulled = false;
scene.add(dustPoints);
let dustAcc = 0;
function emitDust(dt, state, soldiers) {
  if (!['charge', 'melee', 'rout'].includes(state)) return;
  dustAcc += dt * (state === 'charge' ? 70 : 34);
  while (dustAcc >= 1) {
    dustAcc -= 1;
    if (dust.length >= DUST) dust.shift();
    const s = soldiers[Math.floor(Math.random() * soldiers.length)];
    dust.push({ x: s.x + (Math.random() - 0.5) * 0.8, y: 0.1, z: s.z + (Math.random() - 0.5) * 0.8,
      vx: (Math.random() - 0.5) * 0.9, vy: 0.6 + Math.random() * 0.9, vz: (Math.random() - 0.5) * 0.9, life: 0.7 + Math.random() * 0.6, max: 1.3 });
  }
}
function updateDust(dt) {
  for (let i = dust.length - 1; i >= 0; i--) {
    const p = dust[i]; p.life -= dt;
    if (p.life <= 0) { dust.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= 1.4 * dt;
  }
  for (let i = 0; i < dust.length; i++) {
    const p = dust[i];
    dustPos[i * 3] = p.x; dustPos[i * 3 + 1] = p.y; dustPos[i * 3 + 2] = p.z;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustGeo.setDrawRange(0, dust.length);
}

// --- câmara tática ---
const cam = { yaw: -0.22, pitch: 0.95, dist: 65, target: new THREE.Vector3(0, 0, 0) };
function aimCamera(dt) {
  const midX = (bands[0].anchor.x + bands[1].anchor.x) / 2;
  const midZ = (bands[0].anchor.z + bands[1].anchor.z) / 2;
  cam.target.x += (midX - cam.target.x) * Math.min(1, dt * 2.2);
  cam.target.z += (midZ - cam.target.z) * Math.min(1, dt * 2.2);
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * cp * cam.dist,
    sp * cam.dist,
    cam.target.z + Math.cos(cam.yaw) * cp * cam.dist,
  );
  camera.lookAt(cam.target.x, 0, cam.target.z);
}
const REF_ASPECT = 16 / 9, BASE_FOV = 38;
function resize() {
  const w = $('view').clientWidth, h = $('view').clientHeight;
  const ratio = renderer.getPixelRatio();
  if ($('view').width !== Math.floor(w * ratio) || $('view').height !== Math.floor(h * ratio)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    // Janelas estreitas: abre o campo vertical para o enquadramento horizontal aguentar as duas formações.
    camera.fov = camera.aspect >= REF_ASPECT ? BASE_FOV
      : Math.min(74, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) * REF_ASPECT / camera.aspect)));
    camera.updateProjectionMatrix();
  }
}

// --- estado da demonstração ---
const ui = { style: 'c', state: 'march', paused: false, time: 0, picking: null };
const layers = new Map(), styleApi = new Map();
let style = null;
const budget = budgetTable(bands);

function setStyle(name) {
  for (const [k, layer] of layers) layer.visible = k === name;   // as quatro representações ficam montadas; só muda a visível
  if (!layers.has(name)) {
    const layer = new THREE.Group();
    scene.add(layer);
    layers.set(name, layer);
    styleApi.set(name, createStyle(name, bands, layer));
  }
  style = styleApi.get(name);
  ui.style = name;
  for (const b of document.querySelectorAll('[data-style]')) b.classList.toggle('on', b.dataset.style === name);
  $('style-name').textContent = style.info.name;
  $('style-tag').textContent = style.info.tag;
  $('style-desc').textContent = style.info.desc;
  $('style-note').textContent = {
    m1: 'No standard, no articulation; each squad is an overlapping ring.',
    a: 'One merged body per role: cheap, but limbs, equipment and poses are faked.',
    b: 'Every part is a draw call: the closest authored look, the worst scaling.',
    c: 'The same animation as B at a fraction of the draw calls.',
  }[name];
  renderBudget();
  updateStats(true);
}

function setState(name) {
  ui.state = name;
  for (const b of document.querySelectorAll('[data-state]')) b.classList.toggle('on', b.dataset.state === name);
}
function setDistance(d) {
  cam.dist = d;
  for (const b of document.querySelectorAll('[data-dist]')) b.classList.toggle('on', +b.dataset.dist === d);
}

// --- contadores ---
const frameMs = { ema: 0 };
let lastStats = 0;
function updateStats(force = false) {
  const now = performance.now();
  if (!force && now - lastStats < 180) return;
  lastStats = now;
  const calls = renderer.info.render.calls, tris = renderer.info.render.triangles;
  const px = Math.round(style.stats.height / (2 * cam.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * $('view').clientHeight);
  $('stat-calls').textContent = String(style.stats.drawCalls);
  $('stat-tris').textContent = `${(style.stats.triangles / 1000).toFixed(1)}k`;
  $('stat-soldier').textContent = `${Math.round(style.stats.triangles / bands.reduce((n, b) => n + b.soldiers.length, 0))}`;
  $('stat-px').textContent = `${px} px`;
  $('stat-total').textContent = `${calls} / ${(tris / 1000).toFixed(0)}k`;
  $('stat-frame').textContent = `${frameMs.ema.toFixed(1)} ms`;
  $('stat-dist').textContent = `${Math.round(cam.dist)} m`;
}
function renderBudget() {
  const rows = ['m1', 'a', 'b', 'c'].map(k => {
    const b = budget[k];
    const label = { m1: 'M1.2', a: 'A', b: 'B', c: 'C' }[k];
    return `<tr${k === ui.style ? ' class="on"' : ''}><td>${label}</td><td>${b.drawCalls}</td><td>${(b.triangles / 1000).toFixed(1)}k</td><td>${b.perSoldier}</td></tr>`;
  }).join('');
  $('budget').innerHTML = `<thead><tr><th></th><th>calls</th><th>tris</th><th>/man</th></tr></thead><tbody>${rows}</tbody>`;
}

// --- rato e teclado ---
{
  const canvas = $('view');
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    cam.yaw -= dx * 0.006;
    cam.pitch = Math.min(1.25, Math.max(0.4, cam.pitch + dy * 0.004));
  });
  const end = () => { drag = null; canvas.style.cursor = 'default'; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    setDistance(Math.min(150, Math.max(30, cam.dist * (e.deltaY > 0 ? 1.08 : 0.92))));
    for (const b of document.querySelectorAll('[data-dist]')) b.classList.remove('on');
  }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); ui.paused = !ui.paused; $('pause').classList.toggle('on', ui.paused); }
    const styles = ['m1', 'a', 'b', 'c'];
    if (/^Digit[1-4]$/.test(e.code)) setStyle(styles[+e.code.slice(5) - 1]);
    if (e.code === 'KeyQ') setDistance(40);
    if (e.code === 'KeyW') setDistance(65);
    if (e.code === 'KeyE') setDistance(110);
    if (e.code === 'KeyR') { cam.yaw = -0.22; cam.pitch = 0.95; setDistance(65); }
  });
}

for (const b of document.querySelectorAll('[data-style]')) b.addEventListener('click', () => setStyle(b.dataset.style));
for (const b of document.querySelectorAll('[data-dist]')) b.addEventListener('click', () => setDistance(+b.dataset.dist));
for (const b of document.querySelectorAll('[data-state]')) b.addEventListener('click', () => setState(b.dataset.state));
$('pause').addEventListener('click', () => { ui.paused = !ui.paused; $('pause').classList.toggle('on', ui.paused); });

// --- ciclo ---
placeBands(ui.state);
renderBudget();
setStyle('c');
setDistance(65);

let last = performance.now();
function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  const dt = ui.paused ? 0 : raw;
  ui.time += dt;

  for (const band of bands) {
    const target = ANCHOR[ui.state][band.faction];
    const k = Math.min(1, (ui.paused ? 0 : raw) * 2.4);
    band.anchor.x += (target.x - band.anchor.x) * k;
    band.anchor.z += (target.z - band.anchor.z) * k;
  }
  placeBands(ui.state);
  style.update(ui.time, ui.state);
  emitDust(dt, ui.state, bands.flatMap(b => b.soldiers));
  updateDust(dt);
  aimCamera(ui.paused ? 0 : raw);
  resize();
  const t0 = performance.now();
  renderer.render(scene, camera);
  frameMs.ema = frameMs.ema * 0.9 + (performance.now() - t0) * 0.1;
  updateStats();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Gancho para as capturas e para quem quiser medir sem a interface.
window.__visual = {
  ui, cam, bands,
  budget,
  setStyle, setState, setDistance,
  stats: () => ({
    style: ui.style, state: ui.state, distance: Math.round(cam.dist),
    calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    playerCalls: style.stats.drawCalls, playerTriangles: style.stats.triangles,
    soldiers: bands.flatMap(b => b.soldiers).length, frameMs: frameMs.ema,
  }),
};
