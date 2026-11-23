// Kits e poses C do estudo FreeBuff, commit 1afd725. Recorte para a arena jogável.
// Modelos processuais. Unidades em metros, +X em frente, +Y para cima.
import * as THREE from 'three';
import { mergeGeometries } from '../../../vendor/three/addons/utils/BufferGeometryUtils.js';

/** Paleta do estudo: dois blocos de cor distintos, ambos legíveis sobre o chão seco. */
export const P = {
  skin: '#c08f66', skinDark: '#a97a55', hair: '#2b2119',
  romanTunic: '#9c2c26', romanTunicDark: '#76201c', mail: '#8f938d', mailDark: '#6e726d',
  crest: '#7d1f1b', scutum: '#d8cdad', scutumRim: '#a12b25', bronze: '#b28a48', bronzeDark: '#82602f',
  leather: '#493424', iron: '#71757a', wood: '#6a4c2e',
  lusTunic: '#6f6b44', lusTunic2: '#7f7148', cloak: '#46543a', cloakDark: '#36442e',
  caetra: '#5c3d22', caetraWood: '#6f4b29', caetraRim: '#8a5c2e', slingTunic: '#b3a274', headband: '#a3472b',
  pelt: '#7a5f42', peltDark: '#5e4832', dust: '#b7a37a',
};

/** Altura da anca no esqueleto (metros). */
export const HIP = 0.95;

const cyl = (rt, rb, h, s = 6, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const sph = (r, w = 8, h = 5) => new THREE.SphereGeometry(r, w, h);
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cone = (r, h, s = 5) => new THREE.ConeGeometry(r, h, s);
/** Disco com o eixo em X (a face olha para ±X), para escudos e discos do signum. */
function disc(radius, thickness, seg = 12) {
  const g = new THREE.CylinderGeometry(radius, radius, thickness, seg);
  g.rotateZ(Math.PI / 2);
  return g;
}

function paint(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** Peça colorida: aplica escala, rotações e translação, e pinta os vértices (cores assadas, sem instancing color). */
function part(geo, color, t = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (t.s) g.scale(t.s[0] ?? 1, t.s[1] ?? 1, t.s[2] ?? 1);
  if (t.rx) g.rotateX(t.rx);
  if (t.ry) g.rotateY(t.ry);
  if (t.rz) g.rotateZ(t.rz);
  g.translate(t.x || 0, t.y || 0, t.z || 0);
  return paint(g, color);
}
const merge = parts => mergeGeometries(parts, false);

// --- peças do esqueleto (pivôs: anca, ombro, pescoço) ---

function leg(detail, skin, boot = P.leather) {
  const seg = detail === 'high' ? 7 : 5;
  const parts = [
    part(cyl(0.078, 0.055, 0.86, seg), skin, { y: -0.45 }),
    part(box(0.19, 0.09, 0.13), boot, { x: 0.045, y: -0.9 }),
  ];
  if (detail === 'high') parts.push(part(sph(0.07, 6, 4), skin, { y: -0.86 }));
  return merge(parts);
}

function arm(detail, skin, sleeve = null) {
  const seg = detail === 'high' ? 6 : 5;
  const parts = [part(cyl(0.062, 0.048, 0.5, seg), skin, { y: -0.25 })];
  if (detail === 'high') parts.push(part(sph(0.055, 6, 4), skin, { y: -0.5 }));
  if (sleeve) parts.push(part(cyl(0.075, 0.066, 0.14, seg), sleeve, { y: -0.06 }));
  return merge(parts);
}

/** Peito de legionário: cota de malha, túnica escarlate por baixo, cinto e fivela. */
function romanTorso(detail, pelt = false) {
  const seg = detail === 'high' ? 9 : 7;
  const parts = [
    part(cyl(0.205, 0.245, 0.5, seg), P.mail, { y: 0.34 }),
    part(cyl(0.245, 0.30, 0.25, seg), P.romanTunic, { y: 0.08 }),
    part(cyl(0.25, 0.25, 0.055, 8), P.leather, { y: 0.245 }),
    part(box(0.05, 0.075, 0.05), P.bronze, { x: 0.235, y: 0.245 }),
  ];
  if (detail === 'high') {
    parts.push(
      part(sph(0.105, 7, 4), P.mail, { y: 0.56, z: 0.205, s: [0.9, 0.65, 1] }),
      part(sph(0.105, 7, 4), P.mail, { y: 0.56, z: -0.205, s: [0.9, 0.65, 1] }),
      part(cyl(0.235, 0.245, 0.08, seg), P.romanTunicDark, { y: 0.2 }),
    );
  }
  if (pelt) {   // pele de lobo do signífero, sobre os ombros e a cabeça
    parts.push(
      part(cyl(0.27, 0.33, 0.34, 7), P.pelt, { y: 0.47 }),
      part(box(0.04, 0.72, 0.56), P.pelt, { x: -0.235, y: 0.3, rz: -0.06 }),
      part(cone(0.07, 0.18, 4), P.peltDark, { x: -0.2, y: 0.02, z: 0.2, rx: Math.PI }),
      part(cone(0.07, 0.18, 4), P.peltDark, { x: -0.2, y: 0.02, z: -0.2, rx: Math.PI }),
    );
  }
  return merge(parts);
}

/** Cabeça romana: elmo Montefortino, crista de crina (Polybius: a crista fazia o soldado parecer mais alto). */
function romanHead(detail, { crest = true, pelt = false, wolf = false } = {}) {
  const seg = detail === 'high' ? 9 : 8;
  const parts = [
    part(sph(0.115), P.skin, { y: 0.14 }),
    part(cyl(0.06, 0.07, 0.08, 6), P.skin, { y: 0.04 }),
    part(sph(0.138, seg, 4), P.bronze, { y: 0.21, s: [1, 0.85, 1] }),
    part(cyl(0.158, 0.162, 0.03, seg), P.bronze, { y: 0.19 }),
  ];
  if (detail === 'high') {
    parts.push(
      part(box(0.05, 0.12, 0.035), P.bronze, { y: 0.12, z: 0.128, rx: 0.12 }),
      part(box(0.05, 0.12, 0.035), P.bronze, { y: 0.12, z: -0.128, rx: -0.12 }),
    );
  }
  if (crest) {
    parts.push(
      part(box(0.38, 0.17, 0.08), P.crest, { y: 0.35 }),
      part(box(0.3, 0.06, 0.09), P.bronzeDark, { y: 0.3 }),
    );
  }
  if (pelt) {   // capa de lobo sobre o elmo
    parts.push(part(sph(0.155, 7, 4), P.pelt, { y: 0.25, s: [1, 0.9, 1] }));
  }
  if (wolf) {   // vélite: gorro de pele com orelhas, sem crista
    parts.push(
      part(sph(0.15, 7, 4), P.pelt, { y: 0.25, s: [1, 0.85, 1] }),
      part(cone(0.045, 0.14, 4), P.peltDark, { y: 0.36, z: 0.11, rx: 0.25 }),
      part(cone(0.045, 0.14, 4), P.peltDark, { y: 0.36, z: -0.11, rx: -0.25 }),
    );
  }
  return merge(parts);
}

/** Peito lusitano: túnica de lã, cinto e manto por cima do ombro esquerdo. */
function lusTorso(detail) {
  const seg = detail === 'high' ? 8 : 6;
  const parts = [
    part(cyl(0.2, 0.26, 0.55, seg), P.lusTunic, { y: 0.31 }),
    part(cyl(0.245, 0.285, 0.24, seg), P.lusTunic2, { y: 0.1 }),
    part(cyl(0.252, 0.252, 0.05, 8), P.leather, { y: 0.245 }),
    part(box(0.04, 0.66, 0.5), P.cloak, { x: -0.235, y: 0.26, rz: -0.07 }),
    part(box(0.34, 0.055, 0.52), P.cloak, { x: -0.05, y: 0.575, rz: 0.06 }),
    part(sph(0.045, 6, 4), P.bronze, { x: 0.17, y: 0.56, z: 0.2 }),
  ];
  if (detail === 'high') {
    parts.push(
      part(box(0.035, 0.5, 0.46), P.cloakDark, { x: -0.255, y: 0.18, rz: -0.09 }),
      part(box(0.28, 0.04, 0.48), P.cloakDark, { x: -0.16, y: 0.55, rz: -0.2 }),
    );
  }
  return merge(parts);
}

/** Cabeça lusitana: cabelo comprido, barba e fita na testa. */
function lusHead(detail, { band = true, sling = false } = {}) {
  const parts = [
    part(sph(0.115, 8, 5), P.skinDark, { y: 0.14 }),
    part(cyl(0.06, 0.07, 0.08, 6), P.skinDark, { y: 0.04 }),
    part(sph(0.121, 8, 4), P.hair, { y: 0.185, s: [1, 0.72, 1] }),
    part(box(0.09, 0.11, 0.17), P.hair, { x: -0.075, y: 0.11 }),
    part(cone(0.05, 0.13, 4), P.hair, { x: 0.075, y: 0.055, rx: Math.PI }),
  ];
  if (band) parts.push(part(cyl(0.122, 0.122, 0.035, 8), sling ? P.headband : P.bronze, { y: 0.225 }));
  if (detail === 'high') {
    parts.push(
      part(box(0.06, 0.26, 0.14), P.hair, { x: -0.12, y: 0.02 }),
      part(cyl(0.132, 0.132, 0.022, 8), P.leather, { y: 0.245, ry: 0.3 }),
    );
  }
  return merge(parts);
}

// --- escudos (origem no punho; a face olha para +X) ---

function scutum(detail) {
  const seg = detail === 'high' ? 18 : 12;
  const parts = [
    part(disc(0.455, 0.035, seg), P.scutumRim, { s: [1, 1.26, 1] }),
    part(disc(0.425, 0.05, seg), P.scutum, { x: 0.012, s: [1, 1.26, 1] }),
    part(sph(0.082, 7, 4), P.bronze, { x: 0.055 }),
    part(box(0.02, 0.92, 0.085), P.scutumRim, { x: 0.045 }),
    part(box(0.02, 0.085, 0.62), P.bronzeDark, { x: 0.045 }),
  ];
  if (detail === 'high') {
    parts.push(
      part(sph(0.022, 5, 3), P.bronze, { x: 0.05, y: 0.36, z: 0.28 }),
      part(sph(0.022, 5, 3), P.bronze, { x: 0.05, y: 0.36, z: -0.28 }),
      part(sph(0.022, 5, 3), P.bronze, { x: 0.05, y: -0.36, z: 0.28 }),
      part(sph(0.022, 5, 3), P.bronze, { x: 0.05, y: -0.36, z: -0.28 }),
    );
  }
  return merge(parts);
}

function caetra(detail) {
  const seg = detail === 'high' ? 14 : 10;
  return merge([
    part(disc(0.335, 0.03, seg), P.caetraRim),
    part(disc(0.30, 0.045, seg), P.caetra, { x: 0.012 }),
    part(disc(0.19, 0.05, seg), P.caetraWood, { x: 0.016 }),
    part(sph(0.075, 7, 4), P.bronze, { x: 0.05 }),
  ]);
}

function parma(detail) {
  const seg = detail === 'high' ? 12 : 9;
  return merge([
    part(disc(0.30, 0.028, seg), P.scutumRim),
    part(disc(0.27, 0.04, seg), P.scutum, { x: 0.012 }),
    part(sph(0.06, 6, 4), P.bronze, { x: 0.045 }),
  ]);
}

// --- armas (origem no punho; o gume aponta para +Y em descanso) ---

const pilum = () => merge([
  part(cyl(0.021, 0.023, 1.35, 4), P.wood, { y: 0.48 }),
  part(cyl(0.012, 0.012, 0.34, 4), P.iron, { y: 1.28 }),
  part(cone(0.034, 0.17, 4), P.iron, { y: 1.53 }),
]);

const javelin = () => merge([
  part(cyl(0.018, 0.02, 1.18, 4), P.wood, { y: 0.42 }),
  part(cone(0.028, 0.13, 4), P.iron, { y: 1.06 }),
]);

const spear = () => merge([
  part(cyl(0.022, 0.024, 2.0, 5), P.wood, { y: 0.56 }),
  part(cone(0.045, 0.27, 4), P.iron, { y: 1.7 }),
  part(cone(0.032, 0.11, 4), P.bronze, { y: -0.47, rz: Math.PI }),
]);

const falcata = () => merge([
  part(cyl(0.03, 0.034, 0.22, 5), P.leather, { y: 0.02 }),
  part(box(0.035, 0.45, 0.075), P.iron, { y: 0.3 }),
  part(box(0.035, 0.22, 0.07), P.iron, { x: 0.045, y: 0.58, rz: -0.55 }),
  part(box(0.02, 0.05, 0.16), P.bronzeDark, { y: 0.09 }),
]);

const slingStaff = () => merge([
  part(cyl(0.02, 0.024, 1.15, 5), P.wood, { y: 0.4 }),
  part(box(0.015, 0.3, 0.015), P.leather, { y: 1.09, rz: 0.35 }),
  part(box(0.07, 0.09, 0.05), P.leather, { x: 0.09, y: 1.22 }),
]);

/** Signum: haste, discos, trança e pequeno pendão. Segurado na vertical, origem no punho (a haste desce até ao chão). */
const signum = () => merge([
  part(cyl(0.028, 0.034, 2.6, 6), P.wood, { y: 0.4 }),
  part(disc(0.115, 0.03, 10), P.bronze, { y: 1.02 }),
  part(disc(0.1, 0.03, 10), P.bronze, { y: 1.18 }),
  part(disc(0.085, 0.03, 10), P.bronze, { y: 1.33 }),
  part(box(0.05, 0.05, 0.6), P.wood, { y: 1.45 }),
  part(sph(0.045, 6, 4), P.bronze, { y: 1.45, z: 0.3 }),
  part(sph(0.045, 6, 4), P.bronze, { y: 1.45, z: -0.3 }),
  part(box(0.02, 0.44, 0.28), P.crest, { x: -0.02, y: 0.82 }),
  part(cone(0.045, 0.16, 5), P.bronze, { y: 1.6 }),
]);

// --- fatos completos ---

const KITS = new Map();

/** Peças de um soldado. Devolve { parts: {nome: geometry} }. */
export function kitFor(faction, role, detail = 'low') {
  const key = `${faction}:${role}:${detail}`;
  if (KITS.has(key)) return KITS.get(key);
  const high = detail === 'high';
  const roman = faction === 'romanos';
  let parts = {};
  if (roman) {
    const pelt = role === 'signifer';
    const crest = role === 'legionario';
    parts = {
      torso: romanTorso(detail, pelt),
      head: romanHead(detail, { crest, pelt, wolf: role === 'velite' }),
      legL: leg(detail, P.skin), legR: leg(detail, P.skin),
      armL: arm(detail, P.skin, P.romanTunic), armR: arm(detail, P.skin, P.romanTunic),
    };
    if (role === 'legionario') parts.shield = scutum(detail);
    if (role === 'velite') parts.shield = parma(detail);
    parts.weapon = role === 'legionario' ? pilum() : role === 'velite' ? javelin() : signum();
  } else {
    parts = {
      torso: lusTorso(detail),
      head: lusHead(detail, { band: true, sling: role === 'fundeiro', bandit: false }),
      legL: leg(detail, P.skinDark), legR: leg(detail, P.skinDark),
      armL: arm(detail, P.skinDark), armR: arm(detail, P.skinDark),
      weapon: role === 'fundeiro' ? slingStaff() : role === 'chefe' ? falcata() : spear(),
      shield: role === 'fundeiro' ? null : caetra(detail),
    };
    if (role === 'chefe') {
      parts.torso = merge([
        lusTorso(detail),
        part(sph(0.04, 6, 4), P.bronze, { y: 0.45, z: 0.0 }),
        part(box(0.03, 0.62, 0.5), P.cloakDark, { x: -0.26, y: 0.25, rz: -0.1 }),
      ]);
    }
    if (role === 'fundeiro') {
      parts.torso = merge([
        part(cyl(0.2, 0.255, 0.54, high ? 8 : 6), P.slingTunic, { y: 0.3 }),
        part(cyl(0.245, 0.28, 0.24, high ? 8 : 6), P.slingTunic, { y: 0.1 }),
        part(cyl(0.25, 0.25, 0.05, 8), P.leather, { y: 0.24 }),
        part(box(0.16, 0.17, 0.11), P.leather, { x: -0.16, y: 0.12, z: 0.22 }),
      ]);
    }
  }
  for (const k of Object.keys(parts)) if (!parts[k]) delete parts[k];
  const kit = { parts };
  KITS.set(key, kit);
  return kit;
}

// --- pose: parâmetros de animação e matrizes das peças ---

const HZ = { idle: 0.55, march: 1.35, charge: 2.25, melee: 1.8, withdraw: 1.05, rout: 2.4 };
const STATE_POSE = {
  idle: { stride: 0, lean: 0.03, arm: 0.04, bob: 0.012, shield: 0.36, weapon: -0.12 },
  march: { stride: 0.42, lean: 0.04, arm: 0.42, bob: 0.035, shield: 0.3, weapon: -0.12 },
  charge: { stride: 0.8, lean: 0.3, arm: 0.62, bob: 0.06, shield: 0.5, weapon: -1.4 },
  melee: { stride: 0.16, lean: 0.14, arm: 0.2, bob: 0.02, shield: 1, weapon: -1.0 },
  withdraw: { stride: 0.38, lean: -0.12, arm: 0.18, bob: 0.03, shield: 0.95, weapon: -0.05 },
  rout: { stride: 0.95, lean: -0.22, arm: 0.85, bob: 0.09, shield: 0, weapon: 0.45 },
};

/**
 * Parâmetros de uma pose para `state` em `t` (segundos). `s` precisa de `phase`, `role` e `faction`.
 * Sem aleatoriedade: o mesmo instante dá sempre a mesma pose.
 */
export function motionOf(s, t, state) {
  const base = STATE_POSE[state] || STATE_POSE.march;
  const w = Math.sin(t * (HZ[state] || 1.2) * Math.PI * 2 + s.phase);
  const w2 = Math.sin((t * (HZ[state] || 1.2) * Math.PI * 2 + s.phase) * 2);
  const a = {
    legL: 0, legR: 0, armL: 0, armR: 0, lean: base.lean, twist: 0, bob: 0,
    shieldUp: base.shield, shieldTilt: 0.36, weaponPitch: base.weapon, weaponSpin: 0, headYaw: 0,
  };
  a.legL = w * base.stride;
  a.legR = -w * base.stride;
  a.armL = -w * base.arm * 0.45;
  a.armR = w * base.arm;
  a.bob = Math.abs(w2) * base.bob;
  a.twist = w * 0.05 * (state === 'rout' ? 2 : 1);
  a.headYaw = w * 0.05;

  if (state === 'melee') {
    const swing = Math.sin(t * 6.2 + s.phase);
    a.weaponPitch = -0.85 + swing * 0.5;
    a.armR = -0.5 + swing * 0.35;
    a.legL = 0.22; a.legR = -0.22;
    a.twist = swing * 0.16;
  }
  if (state === 'rout') {
    a.headYaw = Math.sin(t * 3 + s.phase) * 0.35;
    a.weaponPitch = 0.5;
  }
  if (s.role === 'fundeiro') {   // fundeiros: sem escudo, funda a girar por cima
    a.shieldUp = 0;
    a.weaponPitch = -1.15;
    a.weaponSpin = state === 'march' || state === 'charge' ? t * 6.5 + s.phase : 0;
    if (state === 'melee') a.weaponPitch = -0.5;
  }
  if (s.role === 'velite') {
    a.shieldUp = state === 'melee' || state === 'withdraw' ? 1 : 0.4;
    a.weaponPitch = state === 'charge' ? -1.15 : state === 'melee' ? -0.6 : -0.25;
  }
  if (s.role === 'signifer') {   // o signum fica sempre direito
    a.weaponPitch = 0.02;
    a.weaponSpin = 0;
    a.armR = 0;
    a.armL = 0;
  }
  return a;
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
function setTRS(m, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _v.set(x, y, z);
  m.compose(_v, _q, ONE);
}

/** Escreve as matrizes do esqueleto de um soldado. `m` é { root, torso, head, armL, armR, legL, legR, shield, weapon, cloak? }. */
export function poseMatrices(s, m, t, state) {
  const a = motionOf(s, t, state);
  setTRS(m.root, s.x, s.y + (s.fall === undefined ? a.bob : 0), s.z, 0, -s.yaw, -(s.fall ?? 0) * Math.PI * 0.48);
  setTRS(m.torso, 0, HIP, 0, 0, a.twist, -a.lean + (s.flash ?? 0) * 0.19); m.torso.premultiply(m.root);
  setTRS(m.head, 0, 0.62, 0, 0, a.headYaw, 0); m.head.premultiply(m.torso);
  const leftRoll = -a.armL + a.shieldUp * 0.66, rightRoll = -a.armR;
  setTRS(m.armL, 0, 0.52, 0.24, 0, 0, leftRoll); m.armL.premultiply(m.torso);
  setTRS(m.armR, 0, 0.52, -0.24, 0, 0, rightRoll); m.armR.premultiply(m.torso);
  setTRS(m.legL, 0, HIP, 0.135, 0, 0, a.legL); m.legL.premultiply(m.root);
  setTRS(m.legR, 0, HIP, -0.135, 0, 0, a.legR); m.legR.premultiply(m.root);
  if (m.cloak) { m.cloak.copy(m.torso); }
  if (m.shield) {
    setTRS(m.shield, 0.08, -0.47, 0.06, 0, 0.06, a.shieldTilt + 0.28 * a.shieldUp - leftRoll);
    m.shield.premultiply(m.armL);
  }
  if (m.weapon) {
    setTRS(m.weapon, 0.035, -0.48, -0.045, 0, a.weaponSpin, a.weaponPitch - rightRoll);
    m.weapon.premultiply(m.armR);
  }
  return a;
}

/** Cria o conjunto de matrizes de um soldado. */
export function soldierMatrices() {
  const m = {};
  for (const k of ['root', 'torso', 'head', 'armL', 'armR', 'legL', 'legR', 'shield', 'weapon', 'cloak']) m[k] = new THREE.Matrix4();
  return m;
}
