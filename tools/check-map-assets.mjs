// Verifica as peças do mapa 3D contra assets/map/budgets.json: nomes, LOD, triângulos, pivot, tamanho, materiais,
// texturas e extensões. Observações, não juízos de gosto: a aparência aprova-se pelas capturas.
//   node tools/check-map-assets.mjs            (todas as peças)   → sai com 1 se alguma falhar
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'assets/map/models');

/** Lê e verifica uma peça; devolve { name, problems: [], facts: {} }. */
export async function checkPiece(name, spec, conv, dir = DIR) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const file = path.join(dir, spec.file), problems = [], facts = {};
  if (!fs.existsSync(file)) return { name, problems: [`falta ${spec.file}`], facts };
  if (!fs.existsSync(file + '.js')) problems.push(`falta ${spec.file}.js (o anfitrião do artefacto só serve .js)`);
  const kb = fs.statSync(file).size / 1024; facts.kb = Math.round(kb);
  if (kb > spec.maxKB) problems.push(`${facts.kb} KB > ${spec.maxKB} KB`);
  const doc = await io.read(file), root = doc.getRoot();
  const used = root.listExtensionsUsed().map(e => e.extensionName).filter(e => !conv.extensionsAllowed.includes(e));
  if (used.length) problems.push(`extensões não previstas: ${used.join(', ')}`);
  for (const [lod, max] of Object.entries(spec.lods)) {
    const node = root.listNodes().find(n => n.getName() === `mapa_${name}_a_${lod}`);
    if (!node) { problems.push(`falta o nó mapa_${name}_a_${lod}`); continue; }
    // a posição e a escala do nó vêm da quantização (KHR_mesh_quantization); uma rotação seria uma transformação por aplicar
    if (node.getRotation().slice(0, 3).some(v => Math.abs(v) > 1e-4)) problems.push(`${lod}: rotação por aplicar`);
    const mesh = node.getMesh(); let tris = 0; const mats = new Set();
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
      mats.add(p.getMaterial());
    }
    facts[lod] = { tris, materials: mats.size };
    if (tris > max) problems.push(`${lod}: ${tris} triângulos > ${max}`);
    if (mats.size > conv.maxMaterials) problems.push(`${lod}: ${mats.size} materiais > ${conv.maxMaterials}`);
    const b = getBounds(node), h = b.max[1] - b.min[1], wx = b.max[0] - b.min[0], wz = b.max[2] - b.min[2];
    facts[lod].bounds = { min: b.min.map(v => +v.toFixed(2)), max: b.max.map(v => +v.toFixed(2)) };
    if (Math.abs(b.min[1]) > 0.05) problems.push(`${lod}: a base não está no chão (y mínimo ${b.min[1].toFixed(2)})`);
    if (Math.abs((b.max[0] + b.min[0]) / 2) > 0.15) problems.push(`${lod}: pivot fora do centro em x`);
    if (h < spec.height[0] || h > spec.height[1]) problems.push(`${lod}: altura ${h.toFixed(2)} m fora de ${spec.height}`);
    if (Math.max(wx, wz) < spec.footprint[0] || Math.max(wx, wz) > spec.footprint[1]) problems.push(`${lod}: largura ${Math.max(wx, wz).toFixed(2)} m fora de ${spec.footprint}`);
    if (!(b.max[2] > -b.min[2])) problems.push(`${lod}: a frente (porta) não está virada a +Z`);
  }
  for (const t of root.listTextures()) {
    const s = t.getSize();
    if (s && Math.max(...s) > conv.maxTexture) problems.push(`textura ${t.getName()} ${s.join('×')} > ${conv.maxTexture}`);
  }
  facts.textures = root.listTextures().map(t => `${t.getName()} ${t.getSize()?.join('×')}`);
  return { name, problems, facts };
}

export async function checkAll(budgetsFile = path.join(ROOT, 'assets/map/budgets.json'), dir = DIR) {
  const B = JSON.parse(fs.readFileSync(budgetsFile, 'utf8'));
  const out = [];
  for (const [name, spec] of Object.entries(B.pieces)) out.push(await checkPiece(name, spec, B.conventions, dir));
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const res = await checkAll();
  for (const r of res) {
    console.log(`${r.problems.length ? 'FALHA' : 'ok   '} ${r.name}  ${JSON.stringify(r.facts)}`);
    for (const p of r.problems) console.log('      - ' + p);
  }
  process.exit(res.some(r => r.problems.length) ? 1 : 0);
}
