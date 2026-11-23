"""Renderizações de verificação da casa redonda no Blender (Cycles): perto, à distância do mapa (várias casas) e malha.
Não altera o .blend: abre-o, monta a cena de bancada (chão, sol, céu, câmaras) em memória e grava PNG.
Uso: python render_casa.py <casa_redonda.blend> <pasta de saída> [amostras]
"""
import sys, math, os, random
import bpy
from mathutils import Vector

BLEND, OUT = sys.argv[1], sys.argv[2]
SAMPLES = int(sys.argv[3]) if len(sys.argv) > 3 else 64
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
bpy.ops.wm.open_mainfile(filepath=BLEND)
s = bpy.context.scene
s.render.engine = 'CYCLES'; s.cycles.device = 'CPU'; s.cycles.samples = SAMPLES; s.cycles.use_denoising = True
s.render.resolution_x, s.render.resolution_y = 1280, 800
s.view_settings.view_transform = 'AgX'; s.view_settings.look = 'AgX - Medium High Contrast'; s.view_settings.exposure = 0.4
house0 = bpy.data.objects['mapa_casa_redonda_a_LOD0']; house1 = bpy.data.objects['mapa_casa_redonda_a_LOD1']
house1.hide_render = True
os.makedirs(OUT, exist_ok=True)

# céu e sol baixo da manhã (luz da direção artística)
w = bpy.data.worlds.new('mundo'); s.world = w; w.use_nodes = True; nt = w.node_tree
sky = nt.nodes.new('ShaderNodeTexSky')
for k, v in (('sky_type', 'NISHITA'), ('sky_type', 'HOSEK_WILKIE')):
    try: sky.sky_type = v; break
    except Exception: pass
try:
    sky.sun_elevation = math.radians(24); sky.sun_rotation = math.radians(125)
except Exception: pass
bg = nt.nodes['Background']; nt.links.new(sky.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = 0.8
sun_d = bpy.data.lights.new('sol', 'SUN'); sun_d.energy = 5.0; sun_d.color = (1.0, 0.88, 0.72); sun_d.angle = math.radians(1.5)
sun = bpy.data.objects.new('sol', sun_d); s.collection.objects.link(sun)
to_sun = Vector((-0.55, -0.72, 0.42)).normalized()   # sol à esquerda e à frente da câmara, baixo
sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()

# chão: terra seca do projeto (Poly Haven forest_ground_04, CC0), com ondulação ligeira
bpy.ops.mesh.primitive_plane_add(size=400); g = bpy.context.active_object; g.name = 'chao'
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=60); bpy.ops.object.mode_set(mode='OBJECT')
from mathutils import noise
for v in g.data.vertices:
    d = Vector((v.co.x, v.co.y)).length
    v.co.z = noise.noise(v.co * 0.02) * 2.5 * min(1, max(0, (d - 8) / 25)) - 0.02
m = bpy.data.materials.new('chao'); m.use_nodes = True; t = m.node_tree; b = t.nodes['Principled BSDF']
tex = t.nodes.new('ShaderNodeTexImage'); tex.image = bpy.data.images.load(os.path.join(REPO, 'assets/textures/terrain_dry/color.jpg'))
mp = t.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.12, 0.12, 0.12); tc = t.nodes.new('ShaderNodeTexCoord')
t.links.new(tc.outputs['Object'], mp.inputs[0]); t.links.new(mp.outputs[0], tex.inputs[0])
hsv = t.nodes.new('ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = 0.75; hsv.inputs['Value'].default_value = 0.85
t.links.new(tex.outputs[0], hsv.inputs['Color']); t.links.new(hsv.outputs[0], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.95
g.data.materials.append(m)

def cam(name, loc, target, lens=50):
    c = bpy.data.cameras.new(name); c.lens = lens; c.clip_end = 2000
    o = bpy.data.objects.new(name, c); s.collection.objects.link(o); o.location = loc
    d = Vector(target) - Vector(loc); o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); return o

def render(cam_obj, name):
    s.camera = cam_obj; s.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True); print('render', name, flush=True)

# 1. perto: três quartos, porta à vista (a porta está em -Y)
render(cam('perto', (7.5, -11.5, 3.2), (0, 0, 2.3), 45), 'blender_perto.png')
# 2. perto, de cima a 55° (como o mapa no zoom máximo)
render(cam('mapa_perto', (0, -13, 18), (0, 0, 1.5), 50), 'blender_mapa_zoom.png')

# 3. à distância: um casal de casas e pátios (instâncias da mesma malha, rodadas e com escala ±8%)
rnd = random.Random(7); spots = []
while len(spots) < 14:
    p = Vector((rnd.uniform(-22, 22), rnd.uniform(-16, 16), 0))
    if all((p - q).length > 8.5 for q in spots): spots.append(p)
for i, p in enumerate(spots):
    o = house0.copy(); s.collection.objects.link(o)
    o.location = p; o.rotation_euler.z = rnd.uniform(0, 2 * math.pi); sc = rnd.uniform(0.92, 1.08); o.scale = (sc, sc, sc)
render(cam('mapa_longe', (0, -78, 100), (0, 0, 0), 50), 'blender_mapa_longe.png')

# 4. malha (LOD0 e LOD1 lado a lado), em arame sobre cinzento
for o in list(s.collection.objects):
    if o.name.startswith('mapa_casa_redonda_a_LOD0.') : bpy.data.objects.remove(o)
house1.hide_render = False; house1.location = (9, 0, 0)
wf = bpy.data.materials.new('arame'); wf.use_nodes = True; t = wf.node_tree; b = t.nodes['Principled BSDF']
wire = t.nodes.new('ShaderNodeWireframe'); wire.inputs[0].default_value = 0.012; wire.use_pixel_size = False
mix = t.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.inputs[6].default_value = (0.55, 0.55, 0.55, 1); mix.inputs[7].default_value = (0.05, 0.05, 0.05, 1)
t.links.new(wire.outputs[0], mix.inputs['Factor']); t.links.new(mix.outputs[2], b.inputs['Base Color'])
for o in (house0, house1):
    o.data = o.data.copy()
    for i in range(len(o.data.materials)): o.data.materials[i] = wf
g.hide_render = True
render(cam('malha', (4.5, -20, 7), (4.5, 0, 2.5), 45), 'blender_malha.png')
