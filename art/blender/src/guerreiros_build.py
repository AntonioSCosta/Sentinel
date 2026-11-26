"""Guerreiros lusitanos do mapa estratégico: Viriato e três companheiros, a partir do corpo Quaternius (CC0).

  node tools/blender/warband_source.mjs /tmp/guerreiro_fonte.glb
  python art/blender/src/guerreiros_build.py /tmp/guerreiro_fonte.glb art/blender/guerreiros.blend
  (ou: blender -b --factory-startup -P art/blender/src/guerreiros_build.py -- <fonte.glb> <saida.blend>)

A fonte é o corpo masculino da Universal Base Characters com o esqueleto de 65 ossos e as animações Idle_Loop e
Walk_Loop da Universal Animation Library (Quaternius, CC0), exatamente como o motor de batalha os usa. Aqui:
  - o corpo é reduzido para a escala do mapa (Decimate, simétrico) e pintado por regiões, por face: pele, túnica,
    cinto, faixas das pernas e sapatos;
  - a túnica ganha volume: uma casca suavizada sobre o tronco e os braços (sem a musculatura do corpo de super-herói),
    uma saia com pregas até meio da coxa e um cinto;
  - um manto de lã cai dos ombros pelas costas; o de Viriato é claro e cobre também a frente dos ombros;
  - os cabelos Quaternius (os mesmos das batalhas) presos ao osso Head;
  - lança e caetra encaixadas na mão e no antebraço na pose de repouso e convertidas para a pose de ligação.
Todas as peças levam pesos do mesmo esqueleto, juntam-se numa malha por guerreiro com um só material (cores por vértice)
e ficam na coleção «export». Nenhuma peça é gerada no jogo: o jogo carrega o GLB exportado deste .blend.
"""
import math
import sys
from pathlib import Path

import bpy  # primeiro: com o módulo bpy, bmesh e mathutils só existem depois de importar bpy
import bmesh
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
SOURCE, OUT = argv[0], argv[1]
CHARS = str(Path(__file__).resolve().parents[3] / 'assets' / 'chars')   # cabelos Quaternius, os mesmos das batalhas

BODY_TRIS = 1100          # corpo reduzido: chega para 25-85 px de altura no mapa
POSE_FRAME = 20           # fotograma do Idle_Loop em que a lança e a caetra se encaixam nas mãos

SKIN, LEATHER, WRAPS, SHOES = '#a07a5c', '#3a2c20', '#6b5a44', '#2c231b'
WARRIORS = [
    # nome, túnica, manto, cabelos (o curto por baixo do comprido tapa o couro cabeludo), cor do cabelo, caetra, lança,
    # manto também sobre a frente dos ombros
    # Viriato: lã crua clara (túnica e manto), reconhecível de frente, de costas e de cima; os companheiros em lã escura.
    ('viriato', '#b3a487', '#e2d8c2', ['hair_buzzed', 'hair_long', 'hair_beard'], '#2f2a25', False, True, True),
    ('a', '#4b3a29', '#2e2722', ['hair_buzzed', 'hair_beard'], '#3e3328', True, True, False),
    ('b', '#433528', '#3a2d24', ['hair_buzzed', 'hair_long'], '#2a2622', True, False, False),
    ('c', '#523f2d', '#2b2420', ['hair_beard', 'hair_buzzed'], '#4a3b2d', False, True, False),
]


def srgb(hex_color):
    h = hex_color.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def override(obj):
    return bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj])


def apply_modifier(obj, mod):
    with override(obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def paint_faces(obj, color_of):
    """Cor por canto de face, escolhida pela região do centro da face (pose de ligação, coordenadas do Blender)."""
    me = obj.data
    attr = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        c = srgb(color_of(poly.center, poly))
        for li in poly.loop_indices:
            attr.data[li].color_srgb = c
    me.color_attributes.active_color = attr
    return attr


def new_object(name, bm, parent):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for poly in me.polygons:
        poly.use_smooth = True
    obj.parent = parent
    return obj


def skin(obj, arm, weights):
    """weights(co) -> {osso: peso}; cria os grupos e o modificador Armature."""
    groups = {}
    for v in obj.data.vertices:
        for bone, w in weights(v.co).items():
            if w <= 0:
                continue
            if bone not in groups:
                groups[bone] = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone].add([v.index], w, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


def push_outside(obj, target, offset):
    """Empurra para fora do corpo os vértices que o atravessam (Shrinkwrap «Outside»), sem mexer nos outros."""
    mod = obj.modifiers.new('fora', 'SHRINKWRAP')
    mod.target, mod.wrap_method, mod.wrap_mode, mod.offset = target, 'NEAREST_SURFACEPOINT', 'OUTSIDE', offset
    obj.modifiers.move(len(obj.modifiers) - 1, 0)
    apply_modifier(obj, mod)


def smooth(obj, factor=0.5, repeat=4, pin_boundary=False):
    """Alisamento laplaciano. Com pin_boundary só se alisam os vértices interiores e as bordas ficam onde estão."""
    if not pin_boundary:
        mod = obj.modifiers.new('suave', 'SMOOTH')
        mod.factor, mod.iterations = factor, repeat
        obj.modifiers.move(len(obj.modifiers) - 1, 0)
        apply_modifier(obj, mod)
        return
    bm = bmesh.new(); bm.from_mesh(obj.data)
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(repeat):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(obj.data); bm.free()
    obj.data.update()


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# --- fonte -----------------------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.name = 'guerreiro_esqueleto'
if 'Icosphere' in bpy.data.objects:
    bpy.data.objects.remove(bpy.data.objects['Icosphere'])
body = bpy.data.objects['SuperHero_Male']
eyes, brows = bpy.data.objects['Eyes'], bpy.data.objects['Eyebrows']   # sem eles as órbitas ficam ocas e escuras
for obj, ratio in ((eyes, 0.12), (brows, 0.08)):
    mod = obj.modifiers.new('reduzir', 'DECIMATE')
    mod.decimate_type, mod.ratio, mod.use_symmetry = 'COLLAPSE', ratio, True
    obj.modifiers.move(len(obj.modifiers) - 1, 0)
    apply_modifier(obj, mod)
    for poly in obj.data.polygons:
        poly.use_smooth = True
for action in bpy.data.actions:
    action.use_fake_user = True

# --- corpo: redução e pintura ---------------------------------------------------------------------------------------
dec = body.modifiers.new('reduzir', 'DECIMATE')
dec.decimate_type, dec.ratio, dec.use_symmetry, dec.symmetry_axis = 'COLLAPSE', BODY_TRIS / tris(body), True, 'X'
body.modifiers.move(len(body.modifiers) - 1, 0)
apply_modifier(body, dec)
# Cortes nas fronteiras das regiões de cor (pose de ligação em T: braços ao longo de x, pernas ao longo de z), para a
# pintura por face ter fronteiras direitas e não dentes de serra nos triângulos da redução.
bm = bmesh.new(); bm.from_mesh(body.data)
for co, no in [((0, 0, z), (0, 0, 1)) for z in (0.085, 0.44, 0.6, 0.97, 1.04, 1.53)] + \
              [((x, 0, 0), (1, 0, 0)) for x in (0.36, 0.55, 0.68, -0.36, -0.55, -0.68)]:
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no)
bm.to_mesh(body.data); bm.free()


def body_color(tunic):
    def color(c, poly=None):
        x, z = abs(c.x), c.z
        if x > 0.19 and z > 1.3:                       # braços em T: manga até meio do braço, braçadeira de couro
            if x < 0.36: return tunic
            if 0.55 < x < 0.68: return LEATHER
            return SKIN
        if z > 1.53: return SKIN                        # cabeça e pescoço
        if z < 0.085: return SHOES
        if z < 0.44: return WRAPS                       # faixas das pernas até abaixo do joelho
        if z < 0.6: return SKIN                         # joelhos à vista sob a saia
        if 0.97 < z < 1.04: return LEATHER
        return tunic
    return color


# --- túnica: casca suavizada sobre o tronco e os braços --------------------------------------------------------------
def make_shell(source, name):
    me = source.data.copy()
    shell = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(shell)
    shell.parent = arm
    if not shell.vertex_groups:                          # no Blender 5 os nomes dos grupos já vêm com a malha
        for g in source.vertex_groups:
            shell.vertex_groups.new(name=g.name)
    bm = bmesh.new(); bm.from_mesh(me)
    keep = lambda c: 0.97 < c.z < 1.53 and abs(c.x) < 0.36   # os mesmos cortes do corpo: bordas direitas
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not keep(f.calc_center_median())], context='FACES')
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    disp = shell.modifiers.new('folga', 'DISPLACE')
    disp.direction, disp.strength, disp.mid_level = 'NORMAL', 0.016, 0.0
    shell.modifiers.move(len(shell.modifiers) - 1, 0)
    apply_modifier(shell, disp)
    # As bordas (gola, mangas, cintura) assentam no corpo: o pano afunila para a pele, sem frestas nem orlas rasgadas.
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        if v.is_boundary:
            v.co -= v.normal * 0.013
    bm.to_mesh(me); bm.free()
    smooth(shell, 0.6, 8, pin_boundary=True)          # apaga a musculatura: pano, não peito de super-herói
    push_outside(shell, source, 0.004)
    mod = shell.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    return shell


# --- saia, cinto, manto ----------------------------------------------------------------------------------------------
def leg_weights(co, top, bottom, share=0.45):
    t = smoothstep(top, bottom, co.z)                   # 0 na cintura, 1 na bainha
    side = smoothstep(-0.07, 0.07, co.x)                # 0 à direita (x<0), 1 à esquerda
    left, right = share * t * side, share * t * (1 - side)
    return {'pelvis': 1 - left - right, 'thigh_l': left, 'thigh_r': right}


def make_skirt(name):
    bm = bmesh.new()
    seg, rings = 22, 5
    rows = []
    for r in range(rings):
        t = r / (rings - 1)
        z = lerp(1.03, 0.58, t)
        rx, ry = lerp(0.168, 0.228, t ** 0.8), lerp(0.125, 0.178, t ** 0.8)
        fold = 0.014 * t
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            k = 1 + fold * math.sin(7 * a) / 0.2
            row.append(bm.verts.new((math.sin(a) * rx * k, 0.03 + math.cos(a) * ry * k, z - 0.012 * t * math.cos(3 * a))))
        rows.append(row)
    for r in range(rings - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rows[r][i], rows[r][j], rows[r + 1][j], rows[r + 1][i]))
    obj = new_object(name, bm, arm)
    skin(obj, arm, lambda co: leg_weights(co, 0.98, 0.58))
    return obj


def make_belt(name):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=1, radius2=1, depth=0.045)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.176, 0.03 + v.co.y * 0.134, 1.005 + v.co.z))
    obj = new_object(name, bm, arm)
    skin(obj, arm, lambda co: {'pelvis': 0.6, 'spine_01': 0.4})
    return obj


# Linhas do manto (pose de ligação em T): z, rx, ry, meia-abertura em graus a partir do meio das costas. Nos ombros a
# abertura acaba antes do braço (|x| < 0.2): em T o braço está levantado e um manto por cima dele ficaria espetado quando
# o braço desce; a borda do ombro segue em parte o upperarm (cloak_weights).
CLOAK_ROWS = [
    (1.58, 0.082, 0.082, 150), (1.53, 0.15, 0.125, 120), (1.48, 0.198, 0.15, 100), (1.38, 0.228, 0.165, 92),
    (1.22, 0.228, 0.178, 88), (1.06, 0.236, 0.196, 86), (0.9, 0.256, 0.214, 84), (0.75, 0.278, 0.234, 82)]


def cloak_weights(co):
    x, z = co.x, co.z
    if z >= 1.4:
        k = smoothstep(0.05, 0.18, abs(x))              # 0 junto ao pescoço, 1 na borda do ombro
        side = 'l' if x > 0 else 'r'
        return {'neck_01': 0.25 * (1 - k), 'spine_03': 0.75 - 0.35 * k, f'clavicle_{side}': 0.2 * k, f'upperarm_{side}': 0.15 * k}
    if z >= 1.15:
        t = smoothstep(1.4, 1.15, z)
        return {'spine_03': 1 - t, 'spine_02': t}
    if z >= 0.95:
        t = smoothstep(1.15, 0.95, z)
        return {'spine_02': 1 - t, 'spine_01': t * 0.5, 'pelvis': t * 0.5}
    return {'pelvis': 1.0}


def make_cloak(name, front, shell):
    rows = [list(r) for r in CLOAK_ROWS]
    if front:                                            # o manto de Viriato fecha-se também sobre o peito
        for k, r in enumerate(rows[:5]):
            r[3] = min(174, r[3] + (24, 52, 64, 48, 20)[k])
            r[2] += 0.012
    bm = bmesh.new()
    cols = 18
    grid = []
    for z, rx, ry, half in rows:
        line = []
        for i in range(cols + 1):
            a = math.radians(-half + 2 * half * i / cols)
            line.append(bm.verts.new((math.sin(a) * rx, 0.035 + math.cos(a) * ry, z)))
        grid.append(line)
    for r in range(len(grid) - 1):
        for i in range(cols):
            bm.faces.new((grid[r][i], grid[r][i + 1], grid[r + 1][i + 1], grid[r + 1][i]))
    obj = new_object(name, bm, arm)
    smooth(obj, 0.4, 3)
    # Por fora do corpo e da túnica; depois de empurrar, alisa (sem isto os vértices empurrados ficam em bico) e volta a
    # empurrar só o que o alisamento tiver feito reentrar.
    for target, gap in ((body, 0.02), (shell, 0.012)):
        push_outside(obj, target, gap)
    smooth(obj, 0.5, 6)
    push_outside(obj, shell, 0.008)
    smooth(obj, 0.25, 2)
    skin(obj, arm, cloak_weights)
    return obj


# --- adereços encaixados na pose de repouso --------------------------------------------------------------------------
def to_bind(obj, bone_name):
    """Leva uma peça desenhada na pose de repouso (Idle_Loop, POSE_FRAME) para a pose de ligação do osso."""
    arm.animation_data.action = bpy.data.actions['Idle_Loop']
    bpy.context.scene.frame_set(POSE_FRAME)
    pose = arm.matrix_world @ arm.pose.bones[bone_name].matrix
    rest = arm.matrix_world @ arm.data.bones[bone_name].matrix_local
    obj.data.transform(rest @ pose.inverted())
    obj.data.update()
    skin(obj, arm, lambda co: {bone_name: 1.0})


def posed(bone_name):
    arm.animation_data.action = bpy.data.actions['Idle_Loop']
    bpy.context.scene.frame_set(POSE_FRAME)
    return arm.matrix_world @ arm.pose.bones[bone_name].matrix


def make_spear(name):
    hand = posed('hand_r') @ Vector((0, 0.075, 0))       # palma: um pouco além do pulso, ao longo do osso
    bm = bmesh.new()
    shaft = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.016, radius2=0.013, depth=2.0)['verts']
    bmesh.ops.translate(bm, verts=shaft, vec=(0, 0, 1.0))
    blade = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.036, radius2=0.0, depth=0.24)['verts']
    bmesh.ops.scale(bm, verts=blade, vec=(1, 0.35, 1))
    bmesh.ops.translate(bm, verts=blade, vec=(0, 0, 2.11))
    ferrule = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.0, radius2=0.017, depth=0.07)['verts']
    bmesh.ops.translate(bm, verts=ferrule, vec=(0, 0, -0.03))
    obj = new_object(name, bm, arm)
    paint_faces(obj, lambda c, p: '#cfc8b4' if c.z > 2.0 or c.z < 0.02 else '#5e4630')
    # haste quase vertical na mão direita, a apontar ligeiramente para a frente; o punho a 0.85 m da base
    m = Matrix.Translation(hand) @ Matrix.Rotation(math.radians(8), 4, 'X') @ Matrix.Rotation(math.radians(-4), 4, 'Y') @ Matrix.Translation((0, 0, -0.85))
    obj.data.transform(m)
    to_bind(obj, 'hand_r')
    return obj


def make_shield(name):
    fore = posed('lowerarm_l')
    middle = fore @ Vector((0, 0.13, 0))                 # meio do antebraço esquerdo, na pose de repouso
    facing = Vector((0.45, -0.89, 0.06)).normalized()    # para fora (+x, a esquerda) e para a frente (-y)
    bm = bmesh.new()
    R, SAG, SEG, K = 0.27, 0.05, 24, 4                  # caetra: calote baixa de 0.27 m de raio, 5 cm de flecha
    center = bm.verts.new((0, 0, SAG))
    rings = [[bm.verts.new((math.cos(2 * math.pi * i / SEG) * R * k / K, math.sin(2 * math.pi * i / SEG) * R * k / K,
                            SAG * (1 - (k / K) ** 2))) for i in range(SEG)] for k in range(1, K + 1)]
    lip = [bm.verts.new((math.cos(2 * math.pi * i / SEG) * (R + 0.012), math.sin(2 * math.pi * i / SEG) * (R + 0.012), -0.012))
           for i in range(SEG)]
    for i in range(SEG):
        j = (i + 1) % SEG
        bm.faces.new((center, rings[0][i], rings[0][j]))
        for a, b in zip(rings, rings[1:] + [lip]):
            bm.faces.new((a[i], b[i], b[j], a[j]))
    boss = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=0.05)['verts']
    bmesh.ops.scale(bm, verts=boss, vec=(1, 1, 0.7))
    bmesh.ops.translate(bm, verts=boss, vec=(0, 0, SAG))
    obj = new_object(name, bm, arm)
    def color(c, poly):
        r = math.hypot(c.x, c.y)
        if r < 0.052 and c.z > SAG * 0.8: return '#d9cfb4'      # umbo
        if r > 0.255: return '#cdbf9b'                          # aro
        if 0.17 < r < 0.215: return '#7a4a2c'                   # anel pintado
        return '#a77d4e'
    paint_faces(obj, color)
    # face para fora e para a frente, presa ao antebraço esquerdo
    m = Matrix.Translation(middle + facing * 0.07) @ Vector((0, 0, 1)).rotation_difference(facing).to_matrix().to_4x4()
    obj.data.transform(m)
    to_bind(obj, 'lowerarm_l')
    return obj


def make_hair(kind, color):
    path = f'{CHARS}/{kind}.bin'
    tmp = bpy.app.tempdir + kind + '.glb'
    open(tmp, 'wb').write(open(path, 'rb').read())
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=tmp)
    obj = next(o for o in bpy.data.objects if o not in before and o.type == 'MESH')
    for o in set(bpy.data.objects) - before - {obj}:
        bpy.data.objects.remove(o)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    if kind == 'hair_long':   # o mesmo ajuste das batalhas (src/rig.js): a franja não pode tapar as sobrancelhas
        obj.data.transform(Matrix.Translation((0, 0.018, 0.028)))
    dec = obj.modifiers.new('reduzir', 'DECIMATE')
    dec.decimate_type, dec.ratio, dec.use_symmetry = 'COLLAPSE', {'hair_long': 0.22, 'hair_beard': 0.25, 'hair_buzzed': 0.3}[kind], True
    apply_modifier(obj, dec)
    obj.data.materials.clear()
    for poly in obj.data.polygons:
        poly.use_smooth = True
    paint_faces(obj, lambda c, p: color)
    obj.parent = arm
    skin(obj, arm, lambda co: {'Head': 1.0})
    return obj


# --- montagem dos quatro guerreiros ----------------------------------------------------------------------------------
material = bpy.data.materials.new('guerreiro')
material.use_nodes = True
nodes = material.node_tree.nodes
bsdf = nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = 1.0
bsdf.inputs['Metallic'].default_value = 0.0
vc = nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
material.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
material.use_backface_culling = False

export = bpy.data.collections.new('export')
bpy.context.scene.collection.children.link(export)

for name, tunic, cloak, hair, hair_color, shield, spear, front in WARRIORS:
    figure = body.copy(); figure.data = body.data.copy(); figure.name = f'mapa_guerreiro_{name}'
    bpy.context.scene.collection.objects.link(figure)
    paint_faces(figure, body_color(tunic))
    shell = make_shell(body, f'tunica_{name}')
    parts = [shell, make_skirt(f'saia_{name}'), make_belt(f'cinto_{name}'), make_cloak(f'manto_{name}', front, shell)]
    paint_faces(parts[0], lambda c, p: tunic)
    paint_faces(parts[1], lambda c, p: tunic)
    paint_faces(parts[2], lambda c, p: LEATHER)
    paint_faces(parts[3], lambda c, p: cloak)
    parts += [make_hair(kind, hair_color) for kind in hair]
    for src, color in ((eyes, '#2a2420'), (brows, hair_color)):
        extra = src.copy(); extra.data = src.data.copy(); bpy.context.scene.collection.objects.link(extra)
        paint_faces(extra, lambda c, p, color=color: color)
        parts.append(extra)
    if spear: parts.append(make_spear(f'lanca_{name}'))
    if shield: parts.append(make_shield(f'caetra_{name}'))
    print(f'  {name}: corpo {tris(figure)}, ' + ', '.join(f'{o.name.split("_")[0]} {tris(o)}' for o in parts))
    for obj in [figure] + parts:
        obj.data.materials.clear(); obj.data.materials.append(material)
    with bpy.context.temp_override(object=figure, active_object=figure, selected_objects=[figure] + parts,
                                   selected_editable_objects=[figure] + parts):
        bpy.ops.object.join()
    figure.parent = arm
    figure.data.name = figure.name                       # a malha no glTF com o nome do guerreiro, não o da fonte
    for c in figure.users_collection: c.objects.unlink(figure)
    export.objects.link(figure)
    print(f'guerreiro {name}: {tris(figure)} triângulos, {len(figure.vertex_groups)} grupos')

for obj in (body, eyes, brows):
    bpy.data.objects.remove(obj)
for c in arm.users_collection: c.objects.unlink(arm)
export.objects.link(arm)
arm.animation_data.action = bpy.data.actions['Idle_Loop']
bpy.context.scene.frame_set(0)
bpy.context.scene.render.fps = 24
bpy.data.orphans_purge(do_recursive=True)
bpy.context.preferences.filepaths.save_version = 0     # sem cópias .blend1 ao reescrever a fonte
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('guardado', OUT)
