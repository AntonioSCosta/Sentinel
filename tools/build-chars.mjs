// Dev tool: packs the Quaternius CC0 Universal Base Character + Universal Animation Library 1/2 into small GLBs.
// usage: node tools/build-chars.mjs <extracted dir> <prepared textures dir>
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
import fs from 'fs'; import path from 'path';
const [,, SRC, TEX] = process.argv, OUT = new URL('../assets/chars/', import.meta.url).pathname;
const io = new NodeIO();
const img = f => fs.readFileSync(f);
const mime = f => f.endsWith('.png') ? 'image/png' : 'image/jpeg';
function setTex(doc, map) {
  for (const t of doc.getRoot().listTextures()) {
    const k = Object.keys(map).find(k => (t.getURI() + t.getName()).includes(k));
    if (k) { t.setImage(img(map[k])).setMimeType(mime(map[k])).setURI(path.basename(map[k])); }
  }
}
function slim(doc) {
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives())
    for (const s of ['TEXCOORD_1', 'TEXCOORD_2', 'TEXCOORD_3', 'COLOR_0', 'COLOR_1']) p.setAttribute(s, null);
}
// body
{
  const doc = await io.read(path.join(SRC, 'Superhero_Male_FullBody.gltf'));
  setTex(doc, { Superhero_Male_Dark: OUT + 'body_roman_red.jpg', Superhero_Male_Normal: OUT + 'body_normal.jpg', Superhero_Male_Roughness: OUT + 'body_roughness.jpg',
    Eye_Brown: TEX + '/T_Eye_Brown.png', Eye_Normal: TEX + '/T_Eye_Normal.png', Hair_1_Normal: TEX + '/T_Hair_1_Normal.jpg', Hair_1_BaseColor: TEX + '/T_Hair_1_BaseColor.jpg' });
  slim(doc); await doc.transform(prune());
  await io.write(OUT + 'body.bin', doc);
}
// hair (origin at 0 = modelled in place on the bind-pose head)
for (const h of ['Hair_Long', 'Hair_Beard', 'Hair_Buzzed']) {
  const doc = await io.read(path.join(SRC, 'hair', h + '.gltf'));
  setTex(doc, { Hair_1_Normal: TEX + '/T_Hair_1_Normal.jpg', Hair_1_BaseColor: TEX + '/T_Hair_1_BaseColor.jpg', Hair_2_Normal: TEX + '/T_Hair_2_Normal.jpg', Hair_2_BaseColor: TEX + '/T_Hair_2_BaseColor.jpg' });
  slim(doc); await doc.transform(prune());
  await io.write(OUT + h.toLowerCase() + '.bin', doc);
}
// animations: keep only the clips the game uses; drop the mannequin mesh, scale tracks and non-root translations
const KEEP = {
  UAL1_Standard: ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Death01', 'Hit_Chest', 'Hit_Head', 'Sword_Attack', 'Sword_Idle', 'Roll'],
  UAL2_Standard: ['Idle_Shield_Loop', 'Idle_Shield_Break', 'Shield_OneShot', 'Hit_Knockback', 'OverhandThrow', 'Sword_Block', 'Sword_Regular_A', 'Sword_Regular_B'],
};
for (const [f, keep] of Object.entries(KEEP)) {
  const doc = await io.read(path.join(SRC, f + '.glb'));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (!keep.includes(a.getName())) { for (const c of a.listChannels()) c.dispose(); for (const sm of a.listSamplers()) sm.dispose(); a.dispose(); continue; }
    for (const c of a.listChannels()) {
      const p = c.getTargetPath(), n = c.getTargetNode()?.getName();
      if (p === 'scale' || (p === 'translation' && n !== 'pelvis' && n !== 'root')) { c.getSampler().dispose(); c.dispose(); }
    }
  }
  for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
  for (const s of root.listSkins()) s.dispose();
  await doc.transform(prune({ keepLeaves: true }), dedup());
  await io.write(OUT + 'anim_' + f.slice(0, 4).toLowerCase() + '.bin', doc);
}
console.log(fs.readdirSync(OUT).map(f => f + ' ' + (fs.statSync(OUT + f).size / 1024 | 0) + 'KB').join('\n'));
