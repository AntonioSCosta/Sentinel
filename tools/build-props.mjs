// Packs a few CC0 props (KayKit Medieval Hexagon Pack, Kay Lousberg) into one small GLB: assets/chars/props.bin.
// usage: node tools/build-props.mjs <path to the pack's Assets/gltf/decoration/props>
import fs from 'fs';
import { NodeIO } from '@gltf-transform/core';
import { mergeDocuments, unpartition, dedup, prune, getBounds } from '@gltf-transform/functions';
const SRC = process.argv[2], NAMES = ['sack', 'barrel', 'crate_A_small', 'crate_open', 'tent', 'bucket_water', 'weaponrack'];
const io = new NodeIO(); let main = null;
for (const n of NAMES) {
  const doc = await io.read(`${SRC}/${n}.gltf`);
  for (const s of doc.getRoot().listScenes()) { s.setName(n); const b = getBounds(s); console.log(n, b.min.map(v => v.toFixed(2)), b.max.map(v => v.toFixed(2))); }
  if (!main) main = doc; else mergeDocuments(main, doc);
}
await main.transform(unpartition(), dedup(), prune());
const out = new URL('../assets/chars/props.bin', import.meta.url).pathname;
fs.writeFileSync(out, await io.writeBinary(main));
console.log('props.bin', fs.statSync(out).size, 'bytes; scenes', main.getRoot().listScenes().map(s => s.getName()).join(','), 'textures', main.getRoot().listTextures().length);
