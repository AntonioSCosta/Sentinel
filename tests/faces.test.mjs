// Rostos de mulheres e crianças: o rosto emprestado do corpo masculino tem de chegar inteiro, ter a cor da pele do corpo,
// seguir a cabeça de pé e agachado; as crianças têm proporções de criança; os homens ficam exatamente como estavam.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadAssets, fingerprint, THREE } from './faces.helpers.mjs';
import { makeRig, driveRig, headParts, childBody, CHILD, FACE_SKIN } from '../src/rig.js';
import * as C from '../src/combat.js';

const A = await loadAssets();
const mk = o => makeRig(THREE, A.clone, A, o);
const SKINS = [0x9c6e52, 0x8a5e44, 0xa87a5a, 0x93664a];
const girl = (o = {}) => mk({ female: true, child: true, outfit: 'lusitano_b', hair: ['hair_buzzed'], palette: { dress: 0x6b4a2e, skin: SKINS[0], long: true }, cloth: 0x6b4a2e, ...o });
const boy = (o = {}) => mk({ female: false, child: true, outfit: 'lusitano_c', hair: ['hair_buzzed'], cloth: 0x96682c, ...o });
const woman = (o = {}) => mk({ female: true, outfit: 'lusitano', hair: ['hair_long'], palette: { dress: 0x8a5a2b, skin: SKINS[1], long: true }, cloth: 0x8a5a2b, ...o });
const crone = (o = {}) => mk({ female: true, outfit: 'lusitano_d', hair: ['hair_long'], hairColor: 0x8f8a82, palette: { dress: 0x5c4f45, skin: SKINS[3], long: true }, cloth: 0x5c4f45, ...o });
const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;
const skinPart = parts => parts.find(p => p.mat.name === 'MI_Superhero_Male');
const faceMeshes = rig => { const out = []; rig.root.traverse(o => { if (o.isSkinnedMesh && /^face-/.test(o.name)) out.push(o); }); return out; };
const pose = (rig, s, frames = 40) => { for (let i = 0; i < frames; i++) driveRig(THREE, rig, { speed: 0, side: 0, f: { phase: 'idle' }, T: C, throwK: -1, ...s }, 1 / 60); rig.root.updateMatrixWorld(true); };
const worldY = (rig, n) => rig.bones[n].getWorldPosition(new THREE.Vector3()).y;
const lowest = rig => Math.min(...['foot_l', 'foot_r', 'ball_l', 'ball_r'].map(n => worldY(rig, n)));
/** Centro do rosto da pele (já com os ossos aplicados), em espaço do mundo. */
function faceCentre(rig) {
  const m = faceMeshes(rig).find(x => x.material.name === 'MI_Superhero_Male'); assert.ok(m, 'o rosto de pele existe');
  const P = m.geometry.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3(); m.skeleton.update();
  for (let i = 0; i < P.count; i++) { m.applyBoneTransform(i, v.set(0, 0, 0).fromBufferAttribute(P, i)); c.add(v.applyMatrix4(m.matrixWorld)); }
  return c.multiplyScalar(1 / P.count);
}

test('headParts lê os pesos intercalados: o rosto de pele devolve mais de 1000 triângulos', () => {
  const parts = headParts(A.body), skin = skinPart(parts);
  assert.ok(skin, 'a parte de pele da cabeça existe');
  assert.ok(tris(skin.geo) > 1000, `triângulos do rosto de pele: ${skin ? tris(skin.geo) : 0}`);
  assert.ok(parts.reduce((n, p) => n + tris(p.geo), 0) > 1000);
  assert.ok(parts.some(p => /eye/i.test(p.name)) && parts.some(p => /brow/i.test(p.name)), 'olhos e sobrancelhas continuam lá');
});

test('o rosto de pele não leva o anel do pescoço (a textura aí é a da roupa, daí a mancha escura)', () => {
  const g = skinPart(headParts(A.body)).geo, P = g.attributes.position;
  let low = 1e9; for (let i = 0; i < P.count; i++) low = Math.min(low, P.getY(i));
  assert.ok(low >= 1.58, `vértice mais baixo do rosto: ${low.toFixed(3)} (a pele da textura só vale acima de ~1.59)`);
});

for (const [name, make] of [['criança (rapariga)', girl], ['mulher adulta', woman], ['idosa', crone]]) {
  test(`${name}: o rosto acompanha a cabeça, de pé e agachada`, () => {
    const rig = make();
    for (const [label, crouch] of [['de pé', false], ['agachada', true]]) {
      pose(rig, { crouch });
      const head = rig.bones.Head.getWorldPosition(new THREE.Vector3()), c = faceCentre(rig);
      assert.ok(Number.isFinite(c.x + c.y + c.z), 'posição finita');
      assert.ok(c.distanceTo(head) < .17, `${label}: o rosto está a ${c.distanceTo(head).toFixed(3)} m da cabeça`);
      assert.ok(c.y > rig.bones.neck_01.getWorldPosition(new THREE.Vector3()).y, `${label}: o rosto está acima do pescoço`);
    }
    const f = faceMeshes(rig).find(x => x.material.name === 'MI_Superhero_Male');
    assert.ok(tris(f.geometry) > 1000, 'o rosto tem os seus triângulos');
  });
}

test('a cor da pele do rosto bate com a do corpo pintado (um só tom por personagem)', () => {
  for (const skin of SKINS) {
    const rig = woman({ palette: { dress: 0x8a5a2b, skin, long: true } }), m = faceMeshes(rig).find(x => x.material.name === 'MI_Superhero_Male').material;
    const want = new THREE.Color(skin), ref = new THREE.Color(FACE_SKIN);
    assert.ok(Math.abs(m.color.r * ref.r - want.r) < .01 && Math.abs(m.color.g * ref.g - want.g) < .01 && Math.abs(m.color.b * ref.b - want.b) < .01, `pele ${skin.toString(16)}`);
  }
});

test('o rosto é partilhado entre personagens (nada de clonar a geometria por pessoa)', () => {
  const a = faceMeshes(woman()), b = faceMeshes(girl());
  assert.equal(a.length, b.length); a.forEach((m, i) => assert.equal(m.geometry, b[i].geometry, m.name));
});

test('rapazes têm o corpo masculino; raparigas o feminino', () => {
  const names = rig => { const n = []; rig.body.traverse(o => { if (o.isMesh) n.push(o.name); }); return n; };
  assert.ok(names(boy()).includes('SuperHero_Male') && !names(boy()).some(n => /Mannequin/.test(n)), 'rapaz: corpo masculino');
  assert.ok(names(girl()).some(n => /Mannequin/.test(n)), 'rapariga: corpo feminino');
  assert.equal(faceMeshes(boy()).length, 0, 'o rapaz não leva rosto emprestado');
});

test('crianças: cabeça maior e pernas mais curtas, sem sair do chão', () => {
  for (const [label, kid, adult] of [['rapariga', girl(), woman()], ['rapaz', boy(), mk({ outfit: 'lusitano', hair: ['hair_buzzed'], cloth: 0x7a5a36 })]]) {
    for (const r of [kid, adult]) { r.root.updateMatrixWorld(true); }
    assert.ok(kid.bones.Head.scale.x >= CHILD.head - 1e-6 && adult.bones.Head.scale.x === 1, `${label}: cabeça ×${kid.bones.Head.scale.x}`);
    const leg = r => (worldY(r, 'thigh_l') - worldY(r, 'foot_l')) / worldY(r, 'Head');
    assert.ok(leg(kid) < leg(adult) * .95, `${label}: perna/altura ${leg(kid).toFixed(3)} vs ${leg(adult).toFixed(3)}`);
    for (const crouch of [false, true]) { pose(kid, { crouch }); pose(adult, { crouch }); assert.ok(Math.abs(lowest(kid) - lowest(adult)) < .06, `${label} ${crouch ? 'agachado' : 'de pé'}: pés a ${(lowest(kid) - lowest(adult)).toFixed(3)} m do chão do adulto`); }
  }
});

test('animações intactas: as crianças correm, agacham, atacam e morrem sem NaN, e os clips não trazem escala', () => {
  assert.ok(A.clips.every(c => c.tracks.every(t => !/\.scale$/.test(t.name))), 'nenhum clip anima a escala (por isso a escala dos ossos fica)');
  for (const rig of [girl(), boy()]) {
    const s0 = rig.bones.Head.scale.x;
    pose(rig, { speed: 3.3 }, 90); pose(rig, { crouch: true, speed: 1 }, 60); pose(rig, { combat: true, f: { phase: 'strike', dir: 'right', t: .1 } }, 20); pose(rig, { dead: true }, 60);
    rig.root.traverse(o => { if (o.isBone) for (const v of [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()]) assert.ok(Number.isFinite(v), o.name); });
    assert.equal(rig.bones.Head.scale.x, s0, 'a escala da cabeça não muda com as animações');
  }
});

test('sobrancelhas femininas mais finas; as masculinas ficam como estão', () => {
  const brow = rig => { let h = 0; rig.root.traverse(o => { if (o.isMesh && /brow/i.test(o.name)) { o.geometry.computeBoundingBox(); h = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y; } }); return h; };
  const m = brow(mk({ outfit: 'lusitano', hair: [], cloth: 0x7a5a36 })), w = brow(woman());
  assert.ok(w < m * .8, `altura das sobrancelhas: mulher ${w.toFixed(4)} vs homem ${m.toFixed(4)}`);
});

test('os homens não mudam: mesma geometria, ossos e materiais de antes das correções', () => {
  const hash = f => crypto.createHash('sha1').update(JSON.stringify(f)).digest('hex').slice(0, 12);
  assert.equal(hash(fingerprint(mk({ outfit: 'lusitano', hair: ['hair_buzzed', 'hair_long', 'hair_beard'], hairColor: 0x3b2a1e, cloth: 0x7a5a36 }))), '3f0fd65b025c', 'guerreiro lusitano');
  assert.equal(hash(fingerprint(mk({ outfit: 'lusitano_c', hair: ['hair_long', 'hair_beard'], hairColor: 0x8f8a82, cloth: 0x96682c }))), 'f48cc85525c8', 'homem idoso');
  assert.equal(hash(fingerprint(mk({ outfit: 'roman_red', shielded: true, tint: .95 }))), 'db085375188a', 'legionário');
});
