// Protótipo M1 — vista 3D da emboscada: terreno, bosques, soldados instanciados, anéis, linhas de ordem, projéteis e partículas.
// Só desenha: lê o estado (colocação na preparação, ou os grupos da simulação) e nunca decide nada do jogo.
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/three/addons/utils/BufferGeometryUtils.js';
import { FIELD, ROAD, WOODS, ROCKS, STREAM, EXITS, FIELD_TUNING } from './field.js';
import { radius } from '../combat.js';

const FIG = 1.45;            // as figuras são desenhadas maiores do que o real, para se lerem de longe
const SPACING = 1.25;        // distância visual entre homens de um grupo
const COLORS = {
  lus: new THREE.Color('#efe0b0'), rom: new THREE.Color('#d8483c'), sel: new THREE.Color('#ffcf4a'), threat: new THREE.Color('#ff5a3c'), broken: new THREE.Color('#f0a23a'),
  ground: new THREE.Color('#6d7444'), groundDark: new THREE.Color('#4f5a30'), road: new THREE.Color('#a48a5a'), water: new THREE.Color('#58767c'),
};

// --- ruído determinista para variar cores e posições ---
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Altura visual do chão: plano no campo (a simulação é plana), outeiros à volta e um montículo nas rochas. */
export function heightAt(x, y) {
  let h = 0;
  const ox = Math.max(0, -x, x - FIELD.w), oy = Math.max(0, -y, y - FIELD.h), out = Math.hypot(ox, oy);
  if (out > 0) h += Math.pow(out, 1.25) * 0.22 + vnoise(x * 0.05, y * 0.05) * out * 0.12;
  for (const r of ROCKS) { const d = Math.hypot(x - r.x, y - r.y); if (d < r.r) h += 0.9 * (1 - (d / r.r) ** 2); }
  return h;
}

// --- geometria ---
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, w = 8, hh = 6) => new THREE.SphereGeometry(r, w, hh);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);

/** Modelos simples (virados para +X). Provisórios: só têm de ler bem a 60 m e distinguir os papéis. */
function soldierGeometry(role) {
  const skin = '#c99a72', legs = '#3a2b20';
  const P = [part(cyl(0.13, 0.15, 0.55), legs, 0, 0.28, 0), part(sph(0.15), skin, 0, 1.2, 0)];
  if (role === 'legionario') {
    P.push(part(cyl(0.2, 0.24, 0.6), '#9b2a22', 0, 0.84, 0), part(sph(0.165, 8, 4), '#a87a3c', 0, 1.25, 0),
      part(box(0.22, 0.1, 0.05), '#b3201e', 0, 1.43, 0), part(box(0.07, 0.9, 0.62), '#8d221f', 0.3, 0.8, -0.04),
      part(box(0.08, 0.16, 0.16), '#c79a4a', 0.35, 0.8, -0.04), part(box(0.04, 1.9, 0.04), '#5d452a', 0.12, 0.95, 0.3));
  } else if (role === 'velite') {
    P.push(part(cyl(0.19, 0.22, 0.58), '#b4492f', 0, 0.83, 0), part(sph(0.17, 8, 4), '#6e5a3c', 0, 1.25, 0),
      part(cyl(0.3, 0.3, 0.05, 12), '#7b2a1d', 0.27, 0.82, -0.05, 0, 0, Math.PI / 2), part(box(0.03, 1.5, 0.03), '#6b4f2e', 0.08, 0.95, 0.28, 0.3, 0, 0));
  } else if (role === 'guerreiro') {
    P.push(part(cyl(0.19, 0.25, 0.62), '#b19b70', 0, 0.85, 0), part(sph(0.17, 8, 4), '#2b2018', 0, 1.27, -0.03),
      part(cyl(0.29, 0.29, 0.06, 12), '#4a3020', 0.28, 0.85, -0.05, 0, 0, Math.PI / 2), part(sph(0.07), '#b08d57', 0.32, 0.85, -0.05),
      part(box(0.05, 0.6, 0.06), '#9c9a94', 0.15, 0.75, 0.3, 0, 0, -0.5));
  } else {   // fundeiro
    P.push(part(cyl(0.17, 0.22, 0.6), '#7e6b4a', 0, 0.84, 0), part(sph(0.17, 8, 4), '#3a2a1c', 0, 1.27, -0.03),
      part(box(0.06, 0.06, 0.5), '#5a4630', 0.1, 1.15, 0.28, 0.6, 0, 0), part(sph(0.07), '#6d6a64', 0.12, 1.32, 0.48));
  }
  return mergeGeometries(P);
}

function ribbon(points, width, y, color, jitter = 0) {
  const pos = [], col = [], idx = [], c = new THREE.Color(color);
  const pts = [];
  for (let i = 0; i < points.length - 1; i++) {   // subdivide para seguir a curva
    const a = points[i], b = points[i + 1], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
    for (let k = 0; k < n; k++) pts.push({ x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n });
  }
  pts.push(points[points.length - 1]);
  pts.forEach((p, i) => {
    const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    const dx = q.x - o.x, dy = q.y - o.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    for (const s of [-1, 1]) {
      const w = width / 2 * (1 + (vnoise(p.x * 0.3, s * 9) - 0.5) * jitter);
      pos.push(p.x + nx * w * s, y + heightAt(p.x, p.y), p.y + ny * w * s);
      const v = 0.88 + vnoise(p.x * 0.5, p.y * 0.5 + s) * 0.2;
      col.push(c.r * v, c.g * v, c.b * v);
    }
    if (i) { const b = i * 2; idx.push(b - 2, b - 1, b, b - 1, b + 1, b); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/**
 * Cria a vista. `canvas`: o elemento onde desenhar.
 * Devolve funções para sincronizar grupos, disparar efeitos, mexer a câmara e converter coordenadas.
 */
export function createView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const sky = new THREE.Color('#c9cdbd');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 170, 380);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 900);

  scene.add(new THREE.HemisphereLight('#e5ebef', '#5a4b32', 1.1));
  const sun = new THREE.DirectionalLight('#fff0d2', 2.4);
  sun.position.set(-60, 120, 140); sun.target.position.set(FIELD.w / 2, 0, FIELD.h / 2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 10, far: 400 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.4;
  scene.add(sun, sun.target);

  // --- chão ---
  {
    const W = 340, H = 280, g = new THREE.PlaneGeometry(W, H, 170, 140);
    g.rotateX(-Math.PI / 2); g.translate(FIELD.w / 2, 0, FIELD.h / 2);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getZ(i);
      p.setY(i, heightAt(x, y));
      let wood = 0;
      for (const w of WOODS) wood = Math.max(wood, 1 - Math.min(1, Math.max(0, (Math.hypot(x - w.x, y - w.y) - w.r * 0.75) / (w.r * 0.45))));
      const n = vnoise(x * 0.08, y * 0.08) * 0.6 + vnoise(x * 0.4, y * 0.4) * 0.4;
      c.copy(COLORS.ground).lerp(COLORS.groundDark, wood * 0.85).multiplyScalar(0.82 + n * 0.3);
      const out = Math.max(0, -x, x - FIELD.w, -y, y - FIELD.h);
      if (out > 0) c.lerp(new THREE.Color('#7c7650'), Math.min(1, out / 40) * 0.5);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    ground.receiveShadow = true;
    scene.add(ground);
    const road = new THREE.Mesh(ribbon(ROAD, 4.6, 0.04, COLORS.road, 0.35), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    road.receiveShadow = true;
    const water = new THREE.Mesh(ribbon(STREAM, 3.2, 0.06, COLORS.water, 0.5), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2 }));
    scene.add(road, water);
  }

  // --- relva miúda (decoração) ---
  {
    const n = 2200, tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.55, 4), new THREE.MeshStandardMaterial({ color: '#7d8a4a', roughness: 1 }), n);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = -20 + hash(i, 1) * 200, y = -15 + hash(i, 2) * 140;
      m.makeScale(1, 0.6 + hash(i, 3), 1).setPosition(x, heightAt(x, y) + 0.2, y);
      tuft.setMatrixAt(i, m);
      tuft.setColorAt(i, c.setHSL(0.17 + hash(i, 4) * 0.05, 0.35, 0.3 + hash(i, 5) * 0.12));
    }
    scene.add(tuft);
  }

  // --- bosques: sobreiros e azinheiras de copa redonda ---
  {
    const trees = [];
    for (const w of WOODS) {
      const n = Math.round(w.r * w.r * 0.3);
      for (let i = 0; i < n; i++) {
        const a = hash(w.x + i, w.y) * Math.PI * 2, d = Math.sqrt(hash(w.y + i, w.x)) * w.r * 0.92;
        trees.push({ x: w.x + Math.cos(a) * d, y: w.y + Math.sin(a) * d, s: 0.75 + hash(i, w.r) * 0.6 });
      }
    }
    const trunk = new THREE.InstancedMesh(cyl(0.18, 0.28, 2.6, 6), new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 1 }), trees.length);
    const crownGeo = new THREE.IcosahedronGeometry(1.7, 1); crownGeo.scale(1, 0.62, 1);
    const crown = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true }), trees.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    trees.forEach((t, i) => {
      const h = heightAt(t.x, t.y);
      m.compose(new THREE.Vector3(t.x, h + 1.3 * t.s, t.y), q, new THREE.Vector3(t.s, t.s, t.s)); trunk.setMatrixAt(i, m);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 7) * 6);
      m.compose(new THREE.Vector3(t.x, h + 3.1 * t.s, t.y), q, new THREE.Vector3(t.s, t.s, t.s)); crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.setHSL(0.24 + hash(i, 8) * 0.06, 0.38, 0.2 + hash(i, 9) * 0.08));
      q.identity();
    });
    for (const o of [trunk, crown]) { o.castShadow = true; o.receiveShadow = true; scene.add(o); }
    const rocks = [];
    for (const r of ROCKS) for (let i = 0; i < 9; i++) {
      const a = hash(i, r.x) * 6.28, d = Math.sqrt(hash(r.y, i)) * r.r * 0.8;
      rocks.push({ x: r.x + Math.cos(a) * d, y: r.y + Math.sin(a) * d, s: 0.6 + hash(i, 3) * 1.1 });
    }
    const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#8b857a', roughness: 0.9, flatShading: true }), rocks.length);
    rocks.forEach((r, i) => { m.compose(new THREE.Vector3(r.x, heightAt(r.x, r.y) + r.s * 0.3, r.y), q.setFromEuler(new THREE.Euler(hash(i, 1), hash(i, 2) * 3, 0)), new THREE.Vector3(r.s * 1.2, r.s * 0.8, r.s)); rock.setMatrixAt(i, m); });
    rock.castShadow = true; rock.receiveShadow = true; scene.add(rock);
  }

  // --- camada da preparação: estrada proibida, orla de entrada e contornos dos bosques ---
  const prepLayer = new THREE.Group();
  {
    const red = new THREE.MeshBasicMaterial({ color: '#c0392b', transparent: true, opacity: 0.3, depthWrite: false });
    const band = new THREE.Mesh(ribbon(ROAD, FIELD_TUNING.roadClear * 2, 0.08, '#ffffff'), red);
    const west = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_TUNING.minX + 6, FIELD.h + 12).rotateX(-Math.PI / 2), red);
    west.position.set((FIELD_TUNING.minX - 6) / 2, 0.1, FIELD.h / 2);
    prepLayer.add(band, west);
    const outline = new THREE.LineDashedMaterial({ color: '#f3dd8c', dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.9, depthTest: false });
    for (const w of [...WOODS, ...ROCKS]) {
      const pts = [];
      for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; pts.push(new THREE.Vector3(w.x + Math.cos(a) * w.r, 0.25, w.y + Math.sin(a) * w.r)); }
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), outline); l.computeLineDistances(); l.renderOrder = 5; prepLayer.add(l);
    }
  }
  scene.add(prepLayer);

  // --- anéis do alcance de deteção romana (preparação e espera): tracejado no chão, sem preencher nada ---
  const rangeGeo = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 97 }, (_, i) => { const a = i / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(a), 0, Math.sin(a)); }));
  const rangeMats = {
    exposed: new THREE.LineDashedMaterial({ color: '#ff7a5c', dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.85, depthTest: false }),
    hidden: new THREE.LineDashedMaterial({ color: '#f3dd8c', dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.5, depthTest: false }),
  };
  const rangeRings = [];
  function rangeRing(i) {
    if (!rangeRings[i]) {
      const l = new THREE.Line(rangeGeo, rangeMats.exposed); l.computeLineDistances(); l.renderOrder = 4; l.frustumCulled = false;
      scene.add(l); rangeRings[i] = l;
    }
    return rangeRings[i];
  }

  // --- setas de retirada nas orlas ---
  {
    const mat = new THREE.MeshBasicMaterial({ color: '#efe0b0', transparent: true, opacity: 0.35, depthWrite: false });
    const shape = new THREE.Shape([new THREE.Vector2(-2, 0), new THREE.Vector2(0, 2.6), new THREE.Vector2(2, 0), new THREE.Vector2(0, 1)]);
    for (const e of EXITS.lusitanos) {
      const a = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), mat);
      a.position.set(e.x, 0.15, e.y + (e.y === 0 ? 3 : -3));
      if (e.y !== 0) a.rotation.y = Math.PI;
      scene.add(a);
    }
  }

  // --- soldados instanciados por papel, vivos e mortos ---
  const CAP = 40, kinds = {};
  for (const role of ['guerreiro', 'fundeiro', 'legionario', 'velite']) {
    const geo = soldierGeometry(role), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const live = new THREE.InstancedMesh(geo, mat, CAP), dead = new THREE.InstancedMesh(geo, mat, CAP * 2);
    for (const o of [live, dead]) { o.castShadow = true; o.frustumCulled = false; o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); o.count = 0; scene.add(o); }
    live.setColorAt(0, new THREE.Color(1, 1, 1)); dead.setColorAt(0, new THREE.Color(1, 1, 1));
    // silhueta «raio-X»: só se desenha onde o soldado está tapado (pelas copas), para nunca se perder um grupo de vista
    const ghost = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
      color: ['legionario', 'velite'].includes(role) ? '#ff8f80' : '#fff1c9', transparent: true, opacity: 0.55, depthWrite: false, depthFunc: THREE.GreaterDepth }), CAP);
    ghost.instanceMatrix = live.instanceMatrix; ghost.frustumCulled = false; ghost.count = 0; ghost.renderOrder = 15;
    scene.add(ghost);
    kinds[role] = { live, dead, ghost };
  }
  const corpses = [];
  const visuals = new Map();   // id → { id, side, role, men, soldiers: [...], ring, line, x, y }

  const ringGeo = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
  function makeVisual(g) {
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: g.side === 'lusitanos' ? COLORS.lus : COLORS.rom, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
    ring.renderOrder = 20;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: '#f4e7c0', dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0.9, depthTest: false }));
    line.renderOrder = 19; line.visible = false; line.frustumCulled = false;
    scene.add(ring, line);
    const soldiers = [];
    for (let i = 0; i < g.men; i++) soldiers.push({ x: g.x + (hash(i, 1) - 0.5) * 3, y: g.y + (hash(i, 2) - 0.5) * 3, yaw: g.facing ?? 0, phase: hash(i, 9) * 6.28, flash: 0, alive: true });
    return { id: g.id, side: g.side, role: g.role, soldiers, ring, line, x: g.x, y: g.y, men: g.men };
  }
  function dropVisual(v) { scene.remove(v.ring, v.line); v.ring.material.dispose(); v.line.geometry.dispose(); v.line.material.dispose(); }

  /** Lugares dos homens à volta do centro do grupo, virados para `facing`. Em marcha, duas filas; senão, um bloco. */
  function slots(n, x, y, facing, marching) {
    const cols = marching ? 2 : Math.max(1, Math.ceil(Math.sqrt(n * 1.6)));
    const fx = Math.cos(facing), fy = Math.sin(facing), rx = -fy, ry = fx, rows = Math.ceil(n / cols), out = [];
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), inRow = Math.min(cols, n - row * cols), col = i % cols;
      const side = (col - (inRow - 1) / 2) * SPACING, back = (row - (rows - 1) / 2) * SPACING;
      out.push({ x: x + rx * side - fx * back, y: y + ry * side - fy * back });
    }
    return out;
  }

  // --- projéteis e partículas ---
  const stones = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 4), new THREE.MeshBasicMaterial({ color: '#2d2a26' }), 160);
  const javs = new THREE.InstancedMesh(box(1.7, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: '#3b2b1a' }), 48);
  for (const o of [stones, javs]) { o.instanceMatrix.setUsage(THREE.DynamicDrawUsage); o.count = 0; o.frustumCulled = false; scene.add(o); }
  const shots = [];
  const PN = 600, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), parts = [];
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  points.frustumCulled = false; scene.add(points);
  function burst(x, y, n, color, speed = 4, up = 3, size = 1) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (parts.length >= PN) parts.shift();
      const a = Math.random() * 6.28, s = speed * (0.4 + Math.random() * 0.8);
      parts.push({ x, y: heightAt(x, y) + 0.8, z: y, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * s, life: 0.6 + Math.random() * 0.5 * size, max: 1.1, c });
    }
  }

  // --- câmara ---
  const cam = { tx: 86, ty: 58, dist: 96, yaw: 0, pitch: 0.95, shake: 0 };
  function placeCamera() {
    cam.tx = Math.min(FIELD.w + 10, Math.max(-10, cam.tx)); cam.ty = Math.min(FIELD.h + 10, Math.max(-10, cam.ty));
    cam.dist = Math.min(150, Math.max(32, cam.dist));
    const s = cam.shake > 0 ? cam.shake : 0, jx = (Math.random() - 0.5) * s, jy = (Math.random() - 0.5) * s;
    camera.position.set(cam.tx + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist + jx, Math.sin(cam.pitch) * cam.dist + jy,
      cam.ty + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(cam.tx + jx * 0.5, 0, cam.ty);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    }
  }

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const tmpC = new THREE.Color(), fallAxis = new THREE.Vector3();
  let clock = 0;

  return {
    /** Mostra ou esconde a camada da preparação. */
    setPrep(on) { prepLayer.visible = on; },

    /** Anéis de alcance de deteção: `rings` = [{ x, y, r, kind: 'exposed' | 'hidden' }]; os que faltam escondem-se. */
    setRanges(rings) {
      rings.forEach((g, i) => { const l = rangeRing(i); l.visible = true; l.material = rangeMats[g.kind] || rangeMats.hidden; l.position.set(g.x, 0.3, g.y); l.scale.setScalar(g.r); });
      for (let i = rings.length; i < rangeRings.length; i++) rangeRings[i].visible = false;
    },

    /** Esquece todos os grupos e mortos (nova partida). */
    reset() { for (const v of visuals.values()) dropVisual(v); visuals.clear(); corpses.length = 0; shots.length = 0; parts.length = 0; },

    /**
     * Sincroniza com o estado: `groups` = grupos da simulação ou da colocação ({id, side, role, men, x, y, facing, hidden, state, left, engaged, order, target}).
     * `opts.selected`: id selecionado; `opts.showPlans`: mostrar linhas de ordens dos lusitanos; `opts.lookup(id)`: grupo por id.
     */
    sync(groups, dt, opts = {}) {
      clock += dt;
      const seen = new Set();
      for (const g of groups) {
        seen.add(g.id);
        let v = visuals.get(g.id);
        if (!v || v.role !== g.role) { if (v) dropVisual(v); v = makeVisual(g); visuals.set(g.id, v); }
        v.x = g.x; v.y = g.y;
        const alive = v.soldiers.filter(s => s.alive);
        if (g.men < alive.length) {   // morreram homens: os últimos caem onde estão
          for (const s of alive.slice(g.men)) {
            s.alive = false;
            corpses.push({ role: g.role, x: s.x, y: s.y, yaw: s.yaw, t: 0, side: g.side });
          }
        }
        const living = v.soldiers.filter(s => s.alive);
        const off = g.left !== null && g.left !== undefined;
        v.ring.visible = !off && living.length > 0;
        v.line.visible = false;
        if (off) continue;
        const marching = g.order?.type === 'mover' && g.order.pace === 'marcha' && !g.engaged;
        const target = g.target && opts.lookup ? opts.lookup(g.target) : null;
        const sl = slots(living.length, g.x, g.y, g.facing ?? 0, marching);
        const moving = !g.engaged && (g.order?.type === 'mover' || g.order?.type === 'atacar' || g.order?.type === 'retirar' || g.state === 'debandada') && !g.hidden;
        living.forEach((s, i) => {
          const t = sl[i], dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy);
          const sp = d > 12 ? d : Math.min(d, (g.state === 'debandada' ? 9 : 6.5) * dt + d * Math.min(1, dt * 5));   // longe demais (tempo acelerado): salta
          if (d > 1e-3) { s.x += dx / d * sp; s.y += dy / d * sp; }
          let want = g.facing ?? 0;
          if (g.engaged && target) want = Math.atan2(target.y - s.y, target.x - s.x);
          else if (d > 0.4) want = Math.atan2(dy, dx);
          let dyaw = want - s.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); s.yaw += dyaw * Math.min(1, dt * 8);
          s.moving = d > 0.25 || moving;
          s.flash = Math.max(0, s.flash - dt * 3);
        });
        // anel e linha da ordem
        const r = radius(Math.max(1, living.length)) * 1.15 + 0.9;
        const sel = opts.selected === g.id;
        v.ring.position.set(g.x, heightAt(g.x, g.y) + 0.12, g.y);
        v.ring.scale.setScalar(r * (sel ? 1 + Math.sin(clock * 6) * 0.05 : 1));
        const threat = opts.threats?.has(g.id);
        v.ring.material.color.copy(sel ? COLORS.sel : threat ? COLORS.threat : g.side === 'lusitanos' ? COLORS.lus : g.rough ? COLORS.broken : COLORS.rom);
        // em corpo a corpo os anéis romanos ficam discretos: o que tem de saltar à vista é o anel do grupo lusitano em perigo
        v.ring.material.opacity = g.hidden ? 0.45 : g.state === 'debandada' ? 0.35 : threat ? 0.6 + Math.abs(Math.sin(clock * 7)) * 0.4 : g.side === 'romanos' && g.engaged && !sel ? 0.4 : 0.9;
        if (threat && !sel) v.ring.scale.setScalar(r * (1.05 + Math.abs(Math.sin(clock * 7)) * 0.12));
        if (g.side === 'romanos' && g.order?.type === 'atacar' && g.order.target !== undefined && !g.engaged && g.state === 'ativo') {   // ameaça romana visível
          const to = opts.lookup?.(g.order.target);
          if (to && to.left == null && !to.hidden) {
            const a = v.line.geometry.attributes.position;
            a.setXYZ(0, g.x, 0.3, g.y); a.setXYZ(1, to.x, 0.3, to.y); a.needsUpdate = true;
            v.line.computeLineDistances(); v.line.visible = true; v.line.material.color.set('#ff4a33'); v.line.material.opacity = 0.75;
          }
        }
        if (g.side === 'lusitanos' && (sel || opts.showPlans) && g.order && ['atacar', 'mover', 'retirar'].includes(g.order.type)) {
          let to = null;
          if (g.order.type === 'atacar') to = g.order.target !== undefined ? opts.lookup?.(g.order.target) : { x: g.order.x, y: g.order.y };
          else if (g.order.type === 'mover') to = g.order.path[g.order.path.length - 1];
          else if (g.order.type === 'retirar' && g.order.x !== undefined) to = { x: g.order.x, y: g.order.y };
          else if (g.order.type === 'retirar') to = EXITS.lusitanos.reduce((b, e) => (!b || Math.hypot(e.x - g.x, e.y - g.y) < Math.hypot(b.x - g.x, b.y - g.y) ? e : b), null);
          if (to && to.left == null) {
            const a = v.line.geometry.attributes.position;
            a.setXYZ(0, g.x, 0.3, g.y); a.setXYZ(1, to.x, 0.3, to.y); a.needsUpdate = true;
            v.line.computeLineDistances(); v.line.visible = true;
            v.line.material.color.set(g.order.type === 'retirar' ? (g.order.x !== undefined ? '#8fd0a8' : '#9fc3d6') : g.order.type === 'atacar' && g.order.target !== undefined ? '#ff8a6a' : '#f4e7c0');
            v.line.material.opacity = g.hidden ? 0.55 : 0.9;
          }
        }
      }
      for (const [id, v] of visuals) if (!seen.has(id)) { dropVisual(v); visuals.delete(id); }

      // escrever as instâncias
      const counts = { guerreiro: 0, fundeiro: 0, legionario: 0, velite: 0 }, dcounts = { ...counts };
      for (const v of visuals.values()) {
        const g = groups.find(o => o.id === v.id);
        const off = g.left !== null && g.left !== undefined;
        if (off) continue;
        const k = kinds[v.role].live;
        for (const s of v.soldiers) {
          if (!s.alive || counts[v.role] >= CAP) continue;
          const i = counts[v.role]++;
          const bob = s.moving ? Math.abs(Math.sin(clock * 9 + s.phase)) * 0.14 : 0;
          const lunge = g.engaged ? Math.max(0, Math.sin(clock * 6.5 + s.phase)) * 0.35 : 0;
          tmpP.set(s.x + Math.cos(s.yaw) * lunge, heightAt(s.x, s.y) + bob, s.y + Math.sin(s.yaw) * lunge);
          tmpQ.setFromAxisAngle(up, -s.yaw);
          tmpS.set(FIG, FIG * (g.hidden ? 0.68 : 1), FIG);
          k.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS));
          const tint = g.hidden ? 0.62 : 1;
          k.setColorAt(i, tmpC.setRGB(tint + s.flash * 1.6, tint + s.flash * 0.7, tint + s.flash * 0.5));
        }
      }
      for (const c of corpses) {
        c.t = Math.min(1, c.t + dt * 3);
        const k = kinds[c.role].dead;
        if (dcounts[c.role] >= CAP * 2) continue;
        const i = dcounts[c.role]++;
        fallAxis.set(Math.sin(c.yaw), 0, Math.cos(c.yaw));
        tmpQ.setFromAxisAngle(up, -c.yaw).premultiply(new THREE.Quaternion().setFromAxisAngle(fallAxis, -c.t * Math.PI / 2 * 0.95));
        tmpP.set(c.x, heightAt(c.x, c.y) + 0.1, c.y);
        k.setMatrixAt(i, tmpM.compose(tmpP, tmpQ, tmpS.set(FIG, FIG, FIG)));
        k.setColorAt(i, tmpC.setRGB(0.55, 0.5, 0.48));
      }
      for (const role of Object.keys(kinds)) {
        const { live, dead, ghost } = kinds[role];
        live.count = counts[role]; dead.count = dcounts[role]; ghost.count = counts[role];
        live.instanceMatrix.needsUpdate = true; dead.instanceMatrix.needsUpdate = true;
        if (live.instanceColor) live.instanceColor.needsUpdate = true;
        if (dead.instanceColor) dead.instanceColor.needsUpdate = true;
      }

      // projéteis
      let si = 0, ji = 0;
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.t += dt;
        if (s.t < 0) continue;
        const u = s.t / s.dur;
        if (u >= 1) { burst(s.tx, s.ty, 4, '#8a7a5a', 2, 1.5); shots.splice(i, 1); continue; }
        const x = s.fx + (s.tx - s.fx) * u, y = s.fy + (s.ty - s.fy) * u, h = 1.3 + Math.sin(u * Math.PI) * s.arc;
        if (s.kind === 'stone' && si < 160) { tmpM.makeTranslation(x, h, y); stones.setMatrixAt(si++, tmpM); }
        if (s.kind === 'jav' && ji < 48) {
          const vy = Math.cos(u * Math.PI) * s.arc * Math.PI / s.dur, vh = Math.hypot(s.tx - s.fx, s.ty - s.fy) / s.dur;
          tmpQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tmpP.set((s.tx - s.fx) / s.dur, vy, (s.ty - s.fy) / s.dur).normalize());
          javs.setMatrixAt(ji++, tmpM.compose(new THREE.Vector3(x, h, y), tmpQ, tmpS.set(1, 1, 1))); void vh;
        }
      }
      stones.count = si; javs.count = ji; stones.instanceMatrix.needsUpdate = true; javs.instanceMatrix.needsUpdate = true;

      // partículas
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy -= 9 * dt; p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt;
      }
      for (let i = 0; i < PN; i++) {
        const p = parts[i];
        if (p) { pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z; const f = Math.min(1, p.life / 0.4); pCol[i * 3] = p.c.r * f + sky.r * (1 - f); pCol[i * 3 + 1] = p.c.g * f + sky.g * (1 - f); pCol[i * 3 + 2] = p.c.b * f + sky.b * (1 - f); }
        else { pPos[i * 3 + 1] = -100; }
      }
      pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
      cam.shake = Math.max(0, cam.shake - dt * 2.5);
    },

    /** Uma salva: pedras de funda ou dardos, do grupo `from` para o grupo `to`. */
    volley(from, to, kind, men) {
      const n = Math.min(kind === 'stone' ? 8 : 4, Math.max(1, men));
      for (let i = 0; i < n; i++) {
        const sx = from.x + (Math.random() - 0.5) * 3, sy = from.y + (Math.random() - 0.5) * 3, d = Math.hypot(to.x - sx, to.y - sy);
        shots.push({ kind: kind === 'stone' ? 'stone' : 'jav', fx: sx, fy: sy, tx: to.x + (Math.random() - 0.5) * 3, ty: to.y + (Math.random() - 0.5) * 3,
          t: -i * 0.07, dur: 0.35 + d / 45, arc: kind === 'stone' ? 1.5 + d * 0.07 : 2 + d * 0.12 });
      }
    },
    /** Golpes que fazem baixas: faíscas e o grupo a piscar. */
    hit(id, n) {
      const v = visuals.get(id); if (!v) return;
      burst(v.x, v.y, 10 + n * 8, '#d9572e', 5, 3);
      for (const s of v.soldiers) if (s.alive) s.flash = 1;
    },
    /** Pó de uma carga. */
    charge(id) { const v = visuals.get(id); if (v) { burst(v.x, v.y, 45, '#b59b6a', 8, 2.2, 1.6); cam.shake = Math.max(cam.shake, 0.8); } },
    /** Abanão de câmara (sinal, rotura). */
    shake(s) { cam.shake = Math.max(cam.shake, s); },
    /** Posição atual de um grupo desenhado (para os textos que flutuam). */
    where(id) { const v = visuals.get(id); return v ? { x: v.x, y: v.y } : null; },

    /** Converte um ponto do ecrã em coordenadas do campo ({x, y}), ou null. */
    pick(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.z } : null;
    },
    /** Projeta um ponto do campo (com altura `h`) para pixels do ecrã; `visible` falso se estiver atrás. */
    project(x, y, h = 0) {
      tmpP.set(x, heightAt(x, y) + h, y).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: (tmpP.x + 1) / 2 * r.width, y: (1 - tmpP.y) / 2 * r.height, visible: tmpP.z < 1 };
    },
    /** Câmara: deslocar (metros no ecrã), aproximar, rodar, centrar. */
    pan(dx, dy) { const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); cam.tx += dx * c + dy * s; cam.ty += -dx * s + dy * c; },
    zoom(f) { cam.dist *= f; },
    rotate(a) { cam.yaw += a; },
    get camera() { return cam; },

    /** Desenha um fotograma. */
    render() { resize(); placeCamera(); renderer.render(scene, camera); },
    /** Estatísticas do renderer (para medir desempenho). */
    info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  };
}
