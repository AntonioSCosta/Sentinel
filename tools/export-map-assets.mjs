// Pós-processamento das peças do mapa 3D: GLB exportado do Blender → GLB do jogo (+ .glb.js para o anfitrião do artefacto).
//   node tools/export-map-assets.mjs <entrada.glb> <saida.glb> [--max-tex 1024]
// dedup, prune, weld, quantize e compressão meshopt (EXT_meshopt_compression); texturas em JPEG redimensionadas.
// Escreve também <saida>.js (base64, como os personagens: o anfitrião do artefacto não serve binários).
import fs from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize, reorder, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , IN, OUT, ...rest] = process.argv;
if (!IN || !OUT) { console.error('uso: node tools/export-map-assets.mjs <entrada.glb> <saida.glb> [--max-tex 1024]'); process.exit(2); }
const maxTex = Number(rest[rest.indexOf('--max-tex') + 1]) || 1024;   // 1024: densidade de ~130 px/m, a do mapa

await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(IN);
await doc.transform(
  dedup(), prune(), weld(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [maxTex, maxTex], quality: 82 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(OUT, doc);
const bin = fs.readFileSync(OUT);
fs.writeFileSync(OUT + '.js', `// Gerado por tools/export-map-assets.mjs a partir de ${IN.split('/').pop()}. Não editar.\nexport default "${bin.toString('base64')}";\n`);
const tex = doc.getRoot().listTextures().map(t => `${t.getName() || t.getURI()} ${t.getImage().byteLength >> 10} KB`);
console.log(`${OUT}: ${(bin.length / 1024).toFixed(0)} KB (.glb.js ${(fs.statSync(OUT + '.js').size / 1024).toFixed(0)} KB)`);
console.log('  texturas:', tex.join(', '));
