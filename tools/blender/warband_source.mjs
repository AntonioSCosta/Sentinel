// Prepara a fonte do Blender para os guerreiros do mapa: o corpo Quaternius (assets/chars/body.bin) com as duas
// animações da Universal Animation Library que o mapa usa (Idle_Loop e Walk_Loop, de assets/chars/anim_ual1.bin),
// ligadas aos ossos do corpo pelo nome. Só copia dados (canais e amostradores); a modelação faz-se no Blender.
//   node tools/blender/warband_source.mjs <saida.glb>
import { NodeIO } from '@gltf-transform/core';

const OUT = process.argv[2];
if (!OUT) { console.error('uso: node tools/blender/warband_source.mjs <saida.glb>'); process.exit(2); }
const CLIPS = ['Idle_Loop', 'Walk_Loop'];
const root = new URL('../../assets/chars/', import.meta.url).pathname;
const io = new NodeIO();
const body = await io.read(root + 'body.bin');
const anims = await io.read(root + 'anim_ual1.bin');
const buffer = body.getRoot().listBuffers()[0];
const nodes = new Map(body.getRoot().listNodes().map(node => [node.getName(), node]));

const copy = accessor => body.createAccessor(accessor.getName())
  .setType(accessor.getType()).setArray(accessor.getArray().slice()).setBuffer(buffer);
for (const name of CLIPS) {
  const source = anims.getRoot().listAnimations().find(animation => animation.getName() === name);
  if (!source) throw new Error(`falta a animação ${name} em anim_ual1.bin`);
  const clip = body.createAnimation(name);
  let missing = 0;
  for (const channel of source.listChannels()) {
    const target = nodes.get(channel.getTargetNode()?.getName());
    if (!target) { missing++; continue; }
    const sampler = channel.getSampler();
    const copied = body.createAnimationSampler().setInput(copy(sampler.getInput())).setOutput(copy(sampler.getOutput()))
      .setInterpolation(sampler.getInterpolation());
    clip.addSampler(copied).addChannel(body.createAnimationChannel().setTargetNode(target)
      .setTargetPath(channel.getTargetPath()).setSampler(copied));
  }
  console.log(`${name}: ${clip.listChannels().length} canais${missing ? `, ${missing} sem osso correspondente` : ''}`);
}
await io.write(OUT, body);
console.log('escrito', OUT);
