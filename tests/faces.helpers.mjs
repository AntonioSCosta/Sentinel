// Helpers for the face tests: the real CC0 character GLBs loaded in node (textures stripped: node has no image decoder),
// the same assets the game loads, and a stable fingerprint of a rig to prove who did and did not change.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Loads assets/chars/<name>.glb.js (a base64 GLB) without its textures. */
export async function loadGlb(name) {
  const b = Buffer.from((await import(`../assets/chars/${name}.glb.js`)).default, 'base64'), jl = b.readUInt32LE(12), json = JSON.parse(b.subarray(20, 20 + jl).toString());
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials || []) { if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; } delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture; }
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const out = Buffer.concat([b.subarray(0, 12), Buffer.alloc(8), js, b.subarray(20 + jl)]);
  out.writeUInt32LE(out.length, 8); out.writeUInt32LE(js.length, 12); out.writeUInt32LE(0x4E4F534A, 16);
  return new GLTFLoader().parseAsync(out.buffer.slice(out.byteOffset, out.byteOffset + out.length), '');
}
/** The assets object `makeRig` takes, as `loadChars` in game.js builds it (minus textures and props). */
export async function loadAssets() {
  const [body, a1, a2, hl, hb, hz, bf] = await Promise.all(['body', 'anim_ual1', 'anim_ual2', 'hair_long', 'hair_beard', 'hair_buzzed', 'body_f'].map(loadGlb));
  return { body: body.scene, bodyF: bf.scene, clips: [...a1.animations, ...a2.animations], hair: { hair_long: hl.scene, hair_beard: hb.scene, hair_buzzed: hz.scene }, textures: {}, split: [null, null], clone: (await import('three/addons/utils/SkeletonUtils.js')).clone };
}
const r = x => Math.round(x * 1e4) / 1e4;
/** Mesh names, vertex counts, summed bind positions and every bone's local transform: equal fingerprints = same rig. */
export function fingerprint(rig) {
  rig.root.updateMatrixWorld(true);
  const meshes = [], bones = [];
  rig.root.traverse(o => {
    if (o.isMesh) { const P = o.geometry.attributes.position; let s = 0; for (let i = 0; i < P.count; i++) s += P.getX(i) + 2 * P.getY(i) + 3 * P.getZ(i); meshes.push(`${o.name}|${P.count}|${r(s)}|${o.material.name}|${o.material.color ? o.material.color.getHexString() : ''}`); }
    if (o.isBone) bones.push(`${o.name}|${o.position.toArray().map(r)}|${o.scale.toArray().map(r)}`);
  });
  return { meshes, bones };
}
export { THREE };
