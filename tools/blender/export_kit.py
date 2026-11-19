"""Exporta as peças de um .blend do mapa para GLB (passo repetível do pipeline; corre sem interface).

  blender -b art/blender/<ficheiro>.blend -P tools/blender/export_kit.py -- <saida.glb>
  (ou, com o módulo bpy:  python tools/blender/export_kit.py <ficheiro.blend> <saida.glb>)

Exporta os objetos da coleção «export» cujo nome começa por «mapa_», cada um na origem (a posição no .blend é só para
os ver lado a lado). glTF 2.0 binário, Y para cima, só malhas, materiais e cores por vértice; sem câmaras, luzes,
animações nem modificadores por aplicar. A compressão e as verificações fazem-se depois em tools/export-map-assets.mjs.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if len(argv) == 2:
    bpy.ops.wm.open_mainfile(filepath=argv[0]); out = argv[1]
else:
    out = argv[0]

col = bpy.data.collections.get('export')
if not col: sys.exit('export_kit: o .blend não tem a coleção «export»')
objs = [o for o in col.objects if o.type == 'MESH' and o.name.startswith('mapa_')]
if not objs: sys.exit('export_kit: nenhum objeto «mapa_…» na coleção «export»')
saved = {o.name: o.location.copy() for o in objs}
for o in bpy.context.view_layer.objects: o.select_set(False)
for o in objs:
    o.location = (0, 0, 0); o.select_set(True)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
    export_texcoords=True, export_normals=True, export_tangents=False, export_vertex_color='ACTIVE',
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False,
    export_animations=False, export_extras=True)
for o in objs: o.location = saved[o.name]
print('export_kit:', out, [o.name for o in objs])
