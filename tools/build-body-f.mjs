// Dev tool: packs the Quaternius CC0 female mannequin (same skeleton as the male body) for women and children.
// usage: node tools/build-body-f.mjs <extracted dir>   then: node tools/pack-chars.mjs
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import path from 'path'; import fs from 'fs';
const [,, SRC] = process.argv, OUT = new URL('../assets/chars/', import.meta.url).pathname;
const io = new NodeIO(), doc = await io.read(path.join(SRC, 'Mannequin_F.glb'));
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) for (const s of ['TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']) p.setAttribute(s, null);
await doc.transform(dedup(), prune());
fs.writeFileSync(OUT + 'body_f.bin', await io.writeBinary(doc));   // binary glTF, whatever the extension
