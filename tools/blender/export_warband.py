"""Exporta os guerreiros do mapa (art/blender/guerreiros.blend) para GLB: o esqueleto, as quatro malhas
«mapa_guerreiro_*» com pesos e cores por vértice, e as ações Idle_Loop e Walk_Loop.

  python tools/blender/export_warband.py art/blender/guerreiros.blend <saida.glb>
  (ou: blender -b art/blender/guerreiros.blend -P tools/blender/export_warband.py -- <saida.glb>)

A compressão (meshopt, quantização) e o .glb.js fazem-se depois em tools/export-map-assets.mjs.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
if len(argv) == 2:
    bpy.ops.wm.open_mainfile(filepath=argv[0]); out = argv[1]
else:
    out = argv[0]

col = bpy.data.collections.get('export')
objs = [o for o in col.objects if o.type == 'ARMATURE' or (o.type == 'MESH' and o.name.startswith('mapa_guerreiro_'))]
if sum(o.type == 'MESH' for o in objs) != 4: sys.exit('export_warband: esperava quatro malhas mapa_guerreiro_*')
for o in bpy.context.view_layer.objects: o.select_set(False)
for o in objs: o.select_set(True)
arm = next(o for o in objs if o.type == 'ARMATURE')
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=False, export_normals=True, export_tangents=False, export_vertex_color='ACTIVE',
    export_materials='EXPORT', export_cameras=False, export_lights=False, export_skins=True, export_def_bones=False,
    export_animations=True, export_animation_mode='ACTIONS', export_anim_single_armature=True,
    export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True, export_extras=False)
print('export_warband:', out, [o.name for o in objs], [a.name for a in bpy.data.actions])
