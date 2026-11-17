"""Constrói art/blender/casa_redonda.blend: a casa redonda lusitana de colmo (mapa estratégico, peça 1).

Registo de como a peça foi feita, não um passo da exportação: depois de construído, o .blend é a fonte e edita-se no
Blender. A exportação para o jogo é sempre tools/blender/export_kit.py.

Unidades: 1 unidade = 1 m. Pivot no centro da base (z = 0). Porta virada a -Y (no glTF fica +Z, a frente no Three.js).
Duas malhas de jogo, cada uma com dois materiais:
  M_casa_atlas  pedra, porta, lintel e soleira: imagens cozidas (bake) de uma versão de alto detalhe (pedras uma a uma)
  M_colmo       telhado, nó do cume e cordas: textura de colmo repetível (cozida de um shader procedimental) × cor por vértice
Uso: python casa_redonda_build.py <saida.blend> <pasta das texturas>   (python com o módulo bpy 5.3)
"""
import sys, math, random, os
import bpy, bmesh
from mathutils import Vector, Matrix, noise

OUT, TEXDIR = sys.argv[1], sys.argv[2]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
STONE_TEX = os.path.join(REPO, 'assets', 'textures', 'castro_stone', 'color.jpg')
rng = random.Random(147)

# ——— medidas (m) ———
R_OUT, BATTER = 3.05, 0.04        # raio exterior da parede na base; recuo por metro de altura (parede ligeiramente inclinada)
THICK, WALL_H = 0.45, 1.9         # espessura e altura da parede
DOOR_W, DOOR_H, DOOR_DEPTH = 0.95, 1.55, 0.26
LINTEL_H = 0.26
EAVE_R, EAVE_Z, EAVE_T = 3.62, 1.70, 0.34   # beiral: raio, altura da face de baixo, espessura do colmo no beiral
PITCH = math.radians(47)
APEX_Z = EAVE_Z + EAVE_T + EAVE_R * math.tan(PITCH) * 0.93
TILE = 1.2                        # o colmo repete-se a cada 1,2 m
ATLAS, COLMO_RES = 2048, 1024

r_at = lambda z: R_OUT - BATTER * z
DOOR_A = -math.pi / 2                       # ângulo do centro da porta (-Y)
DOOR_HALF = (DOOR_W / 2) / R_OUT            # meia abertura, em ângulo

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = 'METRIC'; s.unit_settings.scale_length = 1.0
    s.render.engine = 'CYCLES'; s.cycles.device = 'CPU'
    return s

def coll(name, parent=None):
    c = bpy.data.collections.new(name); (parent or bpy.context.scene.collection).children.link(c); return c

def obj_from_bm(name, bm, c):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); c.objects.link(o); return o

def in_gap(a, margin=0.0):
    d = math.atan2(math.sin(a - DOOR_A), math.cos(a - DOOR_A))
    return abs(d) < DOOR_HALF + margin

# ======================================================================================= materiais de alto detalhe

def nodes(mat):
    mat.use_nodes = True; nt = mat.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0]); return nt, bsdf

def mat_stone():
    m = bpy.data.materials.new('HP_granito'); nt, b = nodes(m); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(STONE_TEX)
    img.projection = 'BOX'; img.projection_blend = 0.3
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.9, 0.9, 0.9)
    L(tc.outputs['Object'], mp.inputs['Vector']); L(mp.outputs[0], img.inputs['Vector'])
    attr = nt.nodes.new('ShaderNodeAttribute'); attr.attribute_name = 'tom'   # 0..1 por pedra
    ramp = nt.nodes.new('ShaderNodeValToRGB')                                # granito: cinzento quente a ocre de líquen
    ramp.color_ramp.elements[0].color = (0.50, 0.48, 0.45, 1); ramp.color_ramp.elements[1].color = (0.78, 0.74, 0.66, 1)
    e = ramp.color_ramp.elements.new(0.85); e.color = (0.72, 0.66, 0.50, 1)
    L(attr.outputs['Fac'], ramp.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    L(img.outputs['Color'], mix.inputs[6]); L(ramp.outputs['Color'], mix.inputs[7])
    # líquen claro nas faces de cima e manchas escuras de humidade em baixo
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); geo = nt.nodes.new('ShaderNodeNewGeometry'); L(geo.outputs['Normal'], sep.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 6; nz.inputs['Detail'].default_value = 6
    L(tc.outputs['Object'], nz.inputs['Vector'])
    lich = nt.nodes.new('ShaderNodeMath'); lich.operation = 'MULTIPLY'; L(sep.outputs['Z'], lich.inputs[0]); L(nz.outputs['Fac'], lich.inputs[1])
    lich2 = nt.nodes.new('ShaderNodeMapRange'); lich2.inputs['From Min'].default_value = 0.45; lich2.inputs['From Max'].default_value = 0.75; lich2.inputs['To Max'].default_value = 0.6
    L(lich.outputs[0], lich2.inputs['Value'])
    mix2 = nt.nodes.new('ShaderNodeMix'); mix2.data_type = 'RGBA'; mix2.inputs[7].default_value = (0.42, 0.43, 0.36, 1)
    L(lich2.outputs['Result'], mix2.inputs['Factor']); L(mix.outputs[2], mix2.inputs[6])
    L(mix2.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.86
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.35; bump.inputs['Distance'].default_value = 0.01
    nz2 = nt.nodes.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 45; nz2.inputs['Detail'].default_value = 8
    L(tc.outputs['Object'], nz2.inputs['Vector']); L(nz2.outputs['Fac'], bump.inputs['Height']); L(bump.outputs[0], b.inputs['Normal'])
    return m

def mat_flat(name, rgb, rough):
    m = bpy.data.materials.new(name); nt, b = nodes(m)
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; return m

def mat_wood():
    m = bpy.data.materials.new('HP_madeira'); nt, b = nodes(m); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 14, 1.2)   # veio ao alto
    L(tc.outputs['Object'], mp.inputs['Vector'])
    w = nt.nodes.new('ShaderNodeTexWave'); w.wave_type = 'BANDS'; w.bands_direction = 'X'
    w.inputs['Distortion'].default_value = 6; w.inputs['Detail'].default_value = 4; w.inputs['Scale'].default_value = 1.0
    L(mp.outputs[0], w.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.22, 0.17, 0.12, 1); ramp.color_ramp.elements[1].color = (0.46, 0.38, 0.28, 1)
    L(w.outputs['Fac'], ramp.inputs[0]); L(ramp.outputs[0], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.8
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; bump.inputs['Distance'].default_value = 0.006
    L(w.outputs['Fac'], bump.inputs['Height']); L(bump.outputs[0], b.inputs['Normal'])
    return m

# ======================================================================================= alto detalhe (só para o bake)

def stone_block(bm, lenx, depth, h, mat_idx=0, tom=0):
    """Um bloco de granito: caixa com bisel largo, subdividida (aresta gasta, faces que o ruído deforma). Devolve os vértices novos."""
    t = bmesh.new()
    bmesh.ops.create_cube(t, size=1.0)
    for v in t.verts: v.co = Vector((v.co.x * lenx, v.co.y * depth, v.co.z * h))
    bmesh.ops.bevel(t, geom=list(t.edges), offset=min(lenx, h, depth) * 0.24, segments=2, affect='EDGES', profile=0.55)
    bmesh.ops.subdivide_edges(t, edges=list(t.edges), cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(t, faces=[f for f in t.faces if len(f.verts) > 4])
    m = {}
    for v in t.verts: m[v] = bm.verts.new(v.co)
    for f in t.faces:
        try: bm.faces.new([m[v] for v in f.verts])
        except ValueError: pass
    t.free()
    return list(m.values())

def build_stones(c, m_stone, m_core):
    """Pedras uma a uma, por fiadas, à volta da parede (menos na porta); por trás, o enchimento de terra escura."""
    bm = bmesh.new(); tom = bm.verts.layers.float.new('tom')
    z = 0.0
    while z < WALL_H - 0.08:
        h = min(rng.uniform(0.2, 0.36), WALL_H - z)
        zc = z + h / 2
        lo = DOOR_A + DOOR_HALF if zc < DOOR_H else DOOR_A   # por baixo do lintel a fiada começa na ombreira
        span = 2 * math.pi - (2 * DOOR_HALF if zc < DOOR_H else 0)
        a = lo
        end = lo + span
        while a < end - 1e-3:
            r = r_at(zc)
            L = rng.choice((rng.uniform(0.24, 0.42), rng.uniform(0.38, 0.7)))
            da = min(L / r, end - a)
            if zc >= DOOR_H and zc < DOOR_H + LINTEL_H and in_gap(a + da / 2, 0.14):   # o lintel ocupa este lugar
                a += da; continue
            Lr = da * r
            depth = THICK if (zc < DOOR_H and (abs(a - lo) < 1e-6 or a + da >= end - 1e-6)) else rng.uniform(0.28, THICK)
            hs = (h - 0.008) * rng.uniform(0.9, 1.04)
            new = stone_block(bm, Lr - rng.uniform(0.008, 0.025), depth, hs)
            t = rng.random(); amp = rng.uniform(0.02, 0.04); seed = rng.random() * 100; fq = rng.uniform(1.8, 3.4)
            for v in new:
                n = noise.noise(Vector((v.co.x * fq + seed, v.co.y * fq, v.co.z * fq))) * amp
                v.co = v.co * (1 + n * 2.2)
                v[tom] = t
            am = a + da / 2 + rng.uniform(-0.01, 0.01)
            out = rng.uniform(0.0, 0.035)                # umas pedras saem mais do que outras
            zs = z + hs / 2 + rng.uniform(0, (h - 0.025) - hs) * 0.7   # pedras mais baixas assentam em alturas diferentes
            M = (Matrix.Translation(Vector((math.cos(am) * (r - depth / 2 + out), math.sin(am) * (r - depth / 2 + out), zs)))
                 @ Matrix.Rotation(am + math.pi / 2, 4, 'Z') @ Matrix.Rotation(rng.uniform(-0.09, 0.09), 4, 'Y') @ Matrix.Rotation(rng.uniform(-0.05, 0.05), 4, 'X'))
            bmesh.ops.transform(bm, matrix=M, verts=new)
            a += da
        z += h
    o = obj_from_bm('HP_pedras', bm, c); o.data.materials.append(m_stone)
    for p in o.data.polygons: p.use_smooth = True
    # enchimento: terra e cascalho entre as pedras
    core = bmesh.new()
    bmesh.ops.create_cone(core, cap_ends=False, segments=96, radius1=R_OUT - 0.05, radius2=r_at(WALL_H) - 0.05, depth=WALL_H)
    bmesh.ops.translate(core, verts=core.verts, vec=(0, 0, WALL_H / 2))
    oc = obj_from_bm('HP_enchimento', core, c); oc.data.materials.append(m_core)
    return [o, oc]

def build_door_hp(c, m_wood, m_stone):
    objs = []
    # porta de tábuas, recuada
    bm = bmesh.new(); n = 6; w = DOOR_W + 0.12
    for i in range(n):
        x0 = -w / 2 + i * w / n
        g = bmesh.ops.create_cube(bm, size=1.0)['verts']
        for v in g: v.co = Vector((v.co.x * (w / n - 0.012) + x0 + w / n / 2, v.co.y * 0.06, v.co.z * (DOOR_H - rng.uniform(0, 0.03)) + DOOR_H / 2))
    for x in (-0.25, 0.25):   # travessas
        pass
    for zz in (0.35, 1.2):
        g = bmesh.ops.create_cube(bm, size=1.0)['verts']
        for v in g: v.co = Vector((v.co.x * w * 0.92, v.co.y * 0.05 - 0.05, v.co.z * 0.12 + zz))
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -(R_OUT - DOOR_DEPTH), 0))
    o = obj_from_bm('HP_porta', bm, c); o.data.materials.append(m_wood); objs.append(o)
    # lintel: laje de granito por cima da porta, e soleira
    for name, (lx, ly, lz, z0, out) in {'HP_lintel': (DOOR_W + 0.6, THICK + 0.06, LINTEL_H, DOOR_H, 0.03),
                                         'HP_soleira': (DOOR_W + 0.25, THICK + 0.28, 0.12, 0.0, 0.14)}.items():
        bm = bmesh.new()
        stone_block(bm, lx, ly, lz)
        tom = bm.verts.layers.float.new('tom')
        for v in bm.verts:
            v.co = v.co * (1 + noise.noise(v.co * 4) * 0.03); v[tom] = 0.35 if name == 'HP_lintel' else 0.2
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -(R_OUT - THICK / 2) - out, z0 + lz / 2 - (0.06 if name == 'HP_soleira' else 0)))
        o = obj_from_bm(name, bm, c); o.data.materials.append(m_stone); objs.append(o)
        for p in o.data.polygons: p.use_smooth = True
    return objs

# ======================================================================================= peça de jogo

def wall_low(c, seg=40, rows=(0.0, 0.62, 1.1, DOOR_H, DOOR_H + LINTEL_H, WALL_H), lod=0):
    """Parede exterior + ombreiras + intradorso do lintel + porta + soleira. Só as faces que se veem."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap')
    ring = []
    a0 = DOOR_A + DOOR_HALF
    angles = [a0 + (2 * math.pi - 2 * DOOR_HALF) * i / seg for i in range(seg + 1)]
    gap = [DOOR_A - DOOR_HALF + 2 * DOOR_HALF * i / 3 for i in range(4)]
    def V(a, z, rr=None):
        r = r_at(z) if rr is None else rr
        jitter = 0.0 if (z <= 0 or rr is not None) else noise.noise(Vector((math.cos(a) * 2, math.sin(a) * 2, z * 3))) * 0.012
        top = (noise.noise(Vector((a * 2.0, 7.0, 0))) * 0.035) if z >= WALL_H else 0
        return bm.verts.new((math.cos(a) * (r + jitter), math.sin(a) * (r + jitter), z + top))
    def quads(gridA, gridB):
        for i in range(len(gridA) - 1):
            bm.faces.new((gridA[i], gridA[i + 1], gridB[i + 1], gridB[i]))
    # zona com porta: anel aberto; acima da porta: anel completo (inclui o vão)
    low_rows = [z for z in rows if z <= DOOR_H]
    high_rows = [z for z in rows if z >= DOOR_H]
    grids = [[V(a, z) for a in angles] for z in low_rows]
    for g0, g1 in zip(grids, grids[1:]): quads(g0, g1)
    full = angles + [a + 2 * math.pi for a in gap[1:]]
    hgrid = [[V(a, z) for a in full] for z in high_rows]
    # cose a fiada da altura da porta ao anel completo (vértices partilhados)
    hgrid[0][:len(angles)] = grids[-1]
    for g0, g1 in zip(hgrid, hgrid[1:]): quads(g0, g1)
    # ombreiras e intradorso
    rd = lambda z: r_at(z) - DOOR_DEPTH
    for a in (DOOR_A + DOOR_HALF, DOOR_A - DOOR_HALF):
        col_o = [grids[k][0 if a > DOOR_A else -1] for k in range(len(low_rows))]
        col_i = [V(a, z, rd(z)) for z in low_rows]
        for k in range(len(low_rows) - 1):
            f = (col_o[k], col_o[k + 1], col_i[k + 1], col_i[k]) if a > DOOR_A else (col_i[k], col_i[k + 1], col_o[k + 1], col_o[k])
            bm.faces.new(f)
    top_o = [V(a, DOOR_H) for a in gap]
    # intradorso: debaixo do lintel, do plano da parede ao plano da porta
    top_i = [V(a, DOOR_H, rd(DOOR_H)) for a in gap]
    for i in range(3): bm.faces.new((top_i[i], top_i[i + 1], top_o[i + 1], top_o[i]))
    # porta (plano recuado)
    door = [[V(a, z, rd(z)) for a in gap] for z in (0.0, DOOR_H)]
    for i in range(3): bm.faces.new((door[0][i + 1], door[0][i], door[1][i], door[1][i + 1]))
    # soleira: uma caixa baixa à frente da porta
    t = bmesh.ops.create_cube(bm, size=1.0)['verts']
    for v in t: v.co = Vector((v.co.x * (DOOR_W + 0.25), v.co.y * (THICK + 0.28), v.co.z * 0.1 + 0.03)) + Vector((0, -(R_OUT - THICK / 2) - 0.14, 0))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # UVs da parede: cilíndricas, em 4 tiras (ilhas separadas para arrumarem bem no atlas). O resto (ombreiras, porta,
    # soleira) fica marcado e é desdobrado depois com smart project. A densidade iguala-se no fim (average_islands_scale).
    wall_tag = bm.faces.layers.int.new('parede')
    for f in bm.faces:
        cen = f.calc_center_median(); n = f.normal
        radial = Vector((cen.x, cen.y, 0))
        is_wall = abs(n.z) < 0.5 and radial.length > r_at(cen.z) - 0.03 and Vector((n.x, n.y, 0)).normalized().dot(radial.normalized()) > 0.8
        f[wall_tag] = 1 if is_wall else 0
        if not is_wall:   # projeção plana na direção da face, em metros
            if abs(n.z) > 0.7: tb = (Vector((1, 0, 0)), Vector((0, 1, 0)))
            else: tb = (Vector((0, 0, 1)).cross(n).normalized(), Vector((0, 0, 1)))
            for l in f.loops: l[uv].uv = (l.vert.co.dot(tb[0]), l.vert.co.dot(tb[1]) + 40)
            continue
        ac = math.atan2(cen.y, cen.x) % (2 * math.pi)
        k = int(ac // (math.pi / 3))
        for l in f.loops:
            p = l.vert.co
            a = math.atan2(p.y, p.x) % (2 * math.pi)
            if a - ac > math.pi: a -= 2 * math.pi
            if ac - a > math.pi: a += 2 * math.pi
            l[uv].uv = ((a - k * math.pi / 3) * R_OUT, p.z + k * 3.0)
    o = obj_from_bm(f'parede_LOD{lod}', bm, c)
    return o

def roof_low(c, seg=40, lod=0):
    """Telhado cónico de colmo: beiral grosso e irregular, quatro fiadas sobrepostas, cordas e nó do cume."""
    bm = bmesh.new(); uv = bm.loops.layers.uv.new('UVMap'); col = bm.loops.layers.color.new('Color')
    n_tiles = round(2 * math.pi * EAVE_R / TILE)
    slant_tot = math.hypot(EAVE_R, APEX_Z - (EAVE_Z + EAVE_T))
    prof = []   # (r, z, tom): perfil do telhado, de dentro (encostado à parede) para o cume
    r_wall_top = r_at(WALL_H) - 0.02
    zt = EAVE_Z + EAVE_T
    prof.append((r_wall_top, WALL_H + 0.04, 0.30))             # encosta à parede
    prof.append((EAVE_R - 0.35, EAVE_Z + 0.03, 0.40))           # face de baixo do beiral
    for k in range(4 if lod == 0 else 2):                       # aresta do beiral, arredondada (pontas da palha)
        t = k / (3 if lod == 0 else 1); ang = -math.pi / 2 + t * math.pi * 0.62
        prof.append((EAVE_R - 0.16 + math.cos(ang) * 0.17, EAVE_Z + EAVE_T * 0.5 + math.sin(ang) * EAVE_T * 0.5, 0.5 + 0.35 * t))
    bulge = 0.16
    def cone_at(f):   # superfície exterior a uma fração f do beiral ao cume, ligeiramente bojuda
        return (EAVE_R * (1 - f) - 0.05 * (1 - f) + bulge * math.sin(math.pi * f), zt + (APEX_Z - zt) * f)
    n_steps = 9 if lod == 0 else 3
    lips = ()
    for j in range(1, n_steps + 1):
        f = 0.93 * j / n_steps
        r, z = cone_at(f)
        if any(abs(f - lf) < 0.93 / n_steps / 2 for lf in lips):   # uma fiada mais nova por cima da velha
            prof.append((r + 0.05, z - 0.04, 0.7)); prof.append((r + 0.05, z + 0.03, 1.0)); continue
        prof.append((r, z, 0.88 + 0.12 * f))
    rings = []
    for i, (r, z, tom) in enumerate(prof):
        ring = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            jr = jz = 0.0
            if 1 <= i <= 5:   # beiral irregular
                jr = noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 1.5))) * 0.07
                jz = noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 4.5))) * 0.05
            v = bm.verts.new((math.cos(a) * (r + jr), math.sin(a) * (r + jr), z + jz))
            ring.append((v, tom * (0.93 + 0.14 * rng.random())))
        rings.append(ring)
    def face(a, b, cc, d):
        return bm.faces.new((a[0], b[0], cc[0], d[0])), (a[1], b[1], cc[1], d[1])
    def dist_s(p):   # distância ao cume, ao longo da superfície (v da textura)
        return math.hypot(p.x, p.y) / EAVE_R * slant_tot
    for i in range(len(rings) - 1):
        for s in range(seg):
            s2 = (s + 1) % seg
            f, toms = face(rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s])
            for l, tm, ss in zip(f.loops, toms, (s, s + 1, s + 1, s)):
                p = l.vert.co
                l[uv].uv = (ss / seg * n_tiles, (slant_tot - dist_s(p)) / TILE + (0.37 if i < 2 else 0))
                g = tm
                l[col] = (g * 1.0, g * 0.97, g * 0.92, 1)
    # nó do cume: feixe atado, cone curto
    r_top, z_top = cone_at(0.93)
    knot = [(r_top, z_top, 0.9), (0.24, z_top + 0.12, 0.7), (0.21, z_top + 0.16, 0.42), (0.20, z_top + 0.24, 0.42), (0.22, z_top + 0.28, 0.85), (0.0, z_top + 0.55, 0.8)]
    prev = rings[-1]
    for (r, z, tom) in knot:
        if r == 0:
            tip = bm.verts.new((0, 0, z))
            for s in range(seg):
                s2 = (s + 1) % seg
                f = bm.faces.new((prev[s][0], prev[s2][0], tip))
                for l in f.loops:
                    l[uv].uv = (s / seg * n_tiles, slant_tot / TILE + 0.3); l[col] = (tom, tom * 0.96, tom * 0.9, 1)
            break
        ring = [(bm.verts.new((math.cos(2 * math.pi * s / seg) * r, math.sin(2 * math.pi * s / seg) * r, z)), tom) for s in range(seg)]
        for s in range(seg):
            s2 = (s + 1) % seg
            f, toms = face(prev[s], prev[s2], ring[s2], ring[s])
            for l, tm, ss in zip(f.loops, toms, (s, s + 1, s + 1, s)):
                l[uv].uv = (ss / seg * n_tiles, slant_tot / TILE + l.vert.co.z * 0.5); l[col] = (tm, tm * 0.95, tm * 0.88, 1)
        prev = ring
    # cordas: dois aros de corda de esparto sobre o colmo (cor escura sobre a mesma textura: parece fibra torcida)
    if lod == 0:
        for f in ():
            rr, zz = cone_at(f)
            nrm = Vector((math.sin(PITCH), 0, math.cos(PITCH)))
            sec = [(0.035, 0.0), (0.0, 0.035), (-0.03, 0.0)]
            rs = []
            for s in range(seg):
                a = 2 * math.pi * s / seg
                base = Vector((math.cos(a) * (rr + 0.045), math.sin(a) * (rr + 0.045), zz + 0.02))
                outw = Vector((math.cos(a), math.sin(a), 0)); up = Vector((0, 0, 1))
                rs.append([bm.verts.new(base + outw * dx * 0.7 + up * dy) for dx, dy in sec])
            for s in range(seg):
                s2 = (s + 1) % seg
                for j in range(len(sec) - 1):
                    f2 = bm.faces.new((rs[s][j], rs[s2][j], rs[s2][j + 1], rs[s][j + 1]))
                    for l, ss in zip(f2.loops, (s, s + 1, s + 1, s)):
                        l[uv].uv = (ss / seg * n_tiles * 3, j * 0.1); l[col] = (0.33, 0.25, 0.17, 1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(f'telhado_LOD{lod}', bm, c)
    for p in o.data.polygons: p.use_smooth = True
    return o

# ======================================================================================= textura de colmo repetível

def mat_thatch_proc():
    """Colmo procedimental, periódico em u e v (ruído 4D sobre um toro): cozido para uma textura que repete sem costura."""
    m = bpy.data.materials.new('PROC_colmo'); nt, b = nodes(m); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['UV'], sep.inputs[0])
    def torus(Ru, Rv, off=0.0):
        """(cos 2πu·Ru, sin 2πu·Ru, cos 2πv·Rv) e w = sin 2πv·Rv: o ruído fica periódico nos dois eixos."""
        def trig(src, fn, R):
            m1 = nt.nodes.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.inputs[1].default_value = 2 * math.pi; L(src, m1.inputs[0])
            m2 = nt.nodes.new('ShaderNodeMath'); m2.operation = fn; L(m1.outputs[0], m2.inputs[0])
            m3 = nt.nodes.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'; m3.inputs[1].default_value = R; L(m2.outputs[0], m3.inputs[0])
            m4 = nt.nodes.new('ShaderNodeMath'); m4.operation = 'ADD'; m4.inputs[1].default_value = off; L(m3.outputs[0], m4.inputs[0])
            return m4.outputs[0]
        cx = nt.nodes.new('ShaderNodeCombineXYZ')
        L(trig(sep.outputs['X'], 'COSINE', Ru), cx.inputs[0]); L(trig(sep.outputs['X'], 'SINE', Ru), cx.inputs[1])
        L(trig(sep.outputs['Y'], 'COSINE', Rv), cx.inputs[2])
        return cx.outputs[0], trig(sep.outputs['Y'], 'SINE', Rv)
    def noise4(vec, w, scale, detail=4, rough=0.5, dist=0.0):
        n = nt.nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '4D'
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = dist
        L(vec, n.inputs['Vector']); L(w, n.inputs['W']); return n.outputs['Fac']
    # fios: muito finos ao longo de u, esticados ao longo de v (os fios descem pelo telhado)
    v1, w1 = torus(40.0, 1.2)
    s_a = noise4(v1, w1, 1.6, detail=3, rough=0.6, dist=0.4)
    v0, w0 = torus(95.0, 2.0, 11.0)
    s_b = noise4(v0, w0, 1.5, detail=2, rough=0.5)
    sm = nt.nodes.new('ShaderNodeMath'); sm.operation = 'MULTIPLY_ADD'; L(s_a, sm.inputs[0]); sm.inputs[1].default_value = 0.6
    sm2 = nt.nodes.new('ShaderNodeMath'); sm2.operation = 'MULTIPLY'; L(s_b, sm2.inputs[0]); sm2.inputs[1].default_value = 0.6
    L(sm2.outputs[0], sm.inputs[2])
    strands = sm.outputs[0]
    v2, w2 = torus(14.0, 0.8, 3.0)
    clumps = noise4(v2, w2, 1.2, detail=2, rough=0.5)        # molhos
    v3, w3 = torus(3.0, 3.0, 7.0)
    patches = noise4(v3, w3, 1.0, detail=3, rough=0.55)      # manchas de colmo velho e novo
    # pontas cortadas: bandas em v (onde acaba cada camada de molhos), quebradas pelo ruído dos molhos
    wave = nt.nodes.new('ShaderNodeMath'); wave.operation = 'MULTIPLY'; wave.inputs[1].default_value = 2.0; L(sep.outputs['Y'], wave.inputs[0])
    addc = nt.nodes.new('ShaderNodeMath'); addc.operation = 'MULTIPLY_ADD'; L(clumps, addc.inputs[0]); addc.inputs[1].default_value = 0.9; L(wave.outputs[0], addc.inputs[2])
    frac = nt.nodes.new('ShaderNodeMath'); frac.operation = 'FRACT'; L(addc.outputs[0], frac.inputs[0])
    ends = nt.nodes.new('ShaderNodeMapRange'); ends.inputs['From Min'].default_value = 0.0; ends.inputs['From Max'].default_value = 0.3
    ends.inputs['To Min'].default_value = 0.74; ends.inputs['To Max'].default_value = 1.0; L(frac.outputs[0], ends.inputs['Value'])
    # altura = fios × molhos × pontas
    h1 = nt.nodes.new('ShaderNodeMath'); h1.operation = 'MULTIPLY'; L(strands, h1.inputs[0]); L(clumps, h1.inputs[1])
    h2 = nt.nodes.new('ShaderNodeMath'); h2.operation = 'MULTIPLY'; L(h1.outputs[0], h2.inputs[0]); L(ends.outputs['Result'], h2.inputs[1])
    # cor: palha de centeio envelhecida (cinzento-dourado), mais escura entre os fios
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.12; cr.elements[0].color = (0.07, 0.055, 0.035, 1)
    cr.elements[1].position = 0.62; cr.elements[1].color = (0.52, 0.41, 0.24, 1)
    e = cr.elements.new(0.36); e.color = (0.27, 0.21, 0.13, 1)
    L(h2.outputs[0], ramp.inputs[0])
    age = nt.nodes.new('ShaderNodeMix'); age.data_type = 'RGBA'; age.blend_type = 'MIX'
    agef = nt.nodes.new('ShaderNodeMapRange'); agef.inputs['From Min'].default_value = 0.42; agef.inputs['From Max'].default_value = 0.62
    agef.inputs['To Max'].default_value = 0.55; L(patches, agef.inputs['Value'])
    L(agef.outputs['Result'], age.inputs['Factor']); L(ramp.outputs[0], age.inputs[6])
    grey = nt.nodes.new('ShaderNodeMix'); grey.data_type = 'RGBA'; grey.blend_type = 'MULTIPLY'; grey.inputs['Factor'].default_value = 1
    L(ramp.outputs[0], grey.inputs[6]); grey.inputs[7].default_value = (0.78, 0.78, 0.8, 1)
    L(grey.outputs[2], age.inputs[7])
    L(age.outputs[2], b.inputs['Base Color'])
    rr = nt.nodes.new('ShaderNodeMapRange'); rr.inputs['To Min'].default_value = 0.95; rr.inputs['To Max'].default_value = 0.78
    L(h2.outputs[0], rr.inputs['Value']); L(rr.outputs['Result'], b.inputs['Roughness'])
    bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 1.0; bump.inputs['Distance'].default_value = 0.02
    L(h2.outputs[0], bump.inputs['Height']); L(bump.outputs[0], b.inputs['Normal'])
    return m

def new_image(name, w, h, data=False):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False, is_data=data)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img

def bake(obj, img, kind, selected=None, **kw):
    s = bpy.context.scene
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for m in obj.data.materials:
        nt = m.node_tree
        for n in nt.nodes: n.select = False
        node = nt.nodes.get('BAKE') or nt.nodes.new('ShaderNodeTexImage'); node.name = 'BAKE'
        node.image = img; node.select = True; nt.nodes.active = node
    if selected:
        for o in selected: o.select_set(True)
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    rb = s.render.bake
    rb.use_selected_to_active = bool(selected); rb.cage_extrusion = kw.get('cage', 0.12); rb.max_ray_distance = kw.get('ray', 0.25)
    rb.margin = 8; rb.use_clear = kw.get('clear', True)
    s.cycles.samples = kw.get('samples', 16)
    args = dict(type=kind)
    if kind == 'DIFFUSE': args['pass_filter'] = {'COLOR'}
    if kind == 'NORMAL': rb.normal_space = 'TANGENT'
    bpy.ops.object.bake(**args)

def save_img(img, path, quality=90):
    img.filepath_raw = path; img.file_format = 'JPEG'
    s = bpy.context.scene; s.render.image_settings.quality = quality
    img.save()

# ======================================================================================= montar

def main():
    s = reset()
    root = s.collection
    c_export = coll('export'); c_hp = coll('alto_detalhe'); c_work = coll('trabalho')
    m_stone, m_core, m_wood = mat_stone(), mat_flat('HP_terra', (0.035, 0.028, 0.02), 0.95), mat_wood()
    hp = build_stones(c_hp, m_stone, m_core) + build_door_hp(c_hp, m_wood, m_stone)

    # ——— parede: UVs em metros arrumadas num atlas, bake da versão de alto detalhe ———
    wall0 = wall_low(c_export)
    m_tmp = bpy.data.materials.new('BAKE_tmp'); nodes(m_tmp); wall0.data.materials.append(m_tmp)
    bpy.context.view_layer.objects.active = wall0; wall0.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, rotate_method='CARDINAL', margin=0.006, shape_method='AABB', scale=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    img_col = new_image('casa_atlas_cor', ATLAS, ATLAS); img_nrm = new_image('casa_atlas_normal', ATLAS, ATLAS, True)
    img_ao = new_image('casa_atlas_ao', ATLAS, ATLAS, True); img_rgh = new_image('casa_atlas_rug', ATLAS, ATLAS, True)
    for img, kind, smp in ((img_col, 'DIFFUSE', 4), (img_nrm, 'NORMAL', 4), (img_rgh, 'ROUGHNESS', 2), (img_ao, 'AO', 24)):
        print('bake', kind, flush=True)
        bake(wall0, img, kind, selected=hp, samples=smp)
    # ORM: R = oclusão, G = rugosidade, B = metal (0)
    import numpy as np
    A = np.array(img_ao.pixels[:]).reshape(-1, 4); R = np.array(img_rgh.pixels[:]).reshape(-1, 4)
    orm = np.zeros_like(A); orm[:, 0] = A[:, 0]; orm[:, 1] = R[:, 0]; orm[:, 2] = 0; orm[:, 3] = 1
    img_orm = new_image('casa_atlas_orm', ATLAS, ATLAS, True); img_orm.pixels[:] = orm.ravel()
    # a oclusão também escurece a cor (o glTF só a aplica à luz ambiente): metade do efeito na cor
    C = np.array(img_col.pixels[:]).reshape(-1, 4); C[:, :3] *= (0.5 + 0.5 * A[:, :1]); img_col.pixels[:] = C.ravel()
    os.makedirs(TEXDIR, exist_ok=True)
    for img, name in ((img_col, 'casa_atlas_cor'), (img_nrm, 'casa_atlas_normal')):
        save_img(img, os.path.join(TEXDIR, name + '.jpg'), 92)
        img.filepath = '//texturas/' + name + '.jpg'

    # ——— colmo: bake de um plano 1×1 com o shader procedimental ———
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    uvl = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops: l[uvl].uv = (l.vert.co.x + 0.5, l.vert.co.y + 0.5)
    plane = obj_from_bm('colmo_amostra', bm, c_work); m_proc = mat_thatch_proc(); plane.data.materials.append(m_proc)
    t_col = new_image('colmo_cor', COLMO_RES, COLMO_RES); t_nrm = new_image('colmo_normal', COLMO_RES, COLMO_RES, True)
    t_rgh = new_image('colmo_rug', COLMO_RES, COLMO_RES, True)
    for img, kind in ((t_col, 'DIFFUSE'), (t_nrm, 'NORMAL'), (t_rgh, 'ROUGHNESS')):
        print('bake colmo', kind, flush=True); bake(plane, img, kind, samples=4)
    R = np.array(t_rgh.pixels[:]).reshape(-1, 4); o2 = np.zeros_like(R); o2[:, 0] = 1; o2[:, 1] = R[:, 0]; o2[:, 3] = 1
    t_orm = new_image('colmo_orm', COLMO_RES, COLMO_RES, True); t_orm.pixels[:] = o2.ravel()
    for img, name in ((t_col, 'colmo_cor'), (t_nrm, 'colmo_normal')):
        save_img(img, os.path.join(TEXDIR, name + '.jpg'), 90); img.filepath = '//texturas/' + name + '.jpg'

    # ——— materiais de jogo (Principled só com imagens: o exportador glTF leva-os tal como estão) ———
    def game_mat(name, col, nrm, rough, vcol=False):
        """Cor + normal; rugosidade constante (a oclusão já está cozida na cor). Menos uma textura por material."""
        m = bpy.data.materials.new(name); nt, b = nodes(m); L = nt.links.new
        ic = nt.nodes.new('ShaderNodeTexImage'); ic.image = col
        inn = nt.nodes.new('ShaderNodeTexImage'); inn.image = nrm
        nm = nt.nodes.new('ShaderNodeNormalMap'); L(inn.outputs[0], nm.inputs['Color']); L(nm.outputs[0], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0.0
        if vcol:
            va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Color'
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
            L(ic.outputs[0], mx.inputs[6]); L(va.outputs[0], mx.inputs[7]); L(mx.outputs[2], b.inputs['Base Color'])
        else:
            L(ic.outputs[0], b.inputs['Base Color'])
        return m
    M_atlas = game_mat('M_casa_atlas', img_col, img_nrm, 0.88)
    M_colmo = game_mat('M_colmo', t_col, t_nrm, 0.9, vcol=True)
    wall0.data.materials.clear(); wall0.data.materials.append(M_atlas)

    roof0 = roof_low(c_export, 36, 0); roof0.data.materials.append(M_colmo)
    # LOD0: uma só malha com os dois materiais
    house0 = join('mapa_casa_redonda_a_LOD0', [wall0, roof0])
    # LOD1: parede dizimada (mantém as UVs do atlas) + telhado simples
    w1 = wall0_copy = None
    roof1 = roof_low(c_export, 16, 1); roof1.data.materials.append(M_colmo)
    w1 = bpy.data.objects.new('parede_LOD1', house0.data.copy()); c_export.objects.link(w1)
    keep_material(w1, 'M_casa_atlas')
    dec = w1.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.35; dec.delimit = {'UV', 'SEAM'}
    apply_mods(w1)
    house1 = join('mapa_casa_redonda_a_LOD1', [w1, roof1])
    house1.location.x = 9   # lado a lado no ficheiro; a exportação repõe a origem
    for o in c_hp.objects: o.hide_render = True
    c_hp.hide_viewport = True; c_work.hide_viewport = True
    for o in c_work.objects: o.hide_render = True
    for o in (house0, house1):
        for x in bpy.context.view_layer.objects: x.select_set(False)
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))   # arestas vivas nas ombreiras, suave no resto
        o['peca'] = 'casa_redonda'; o['licenca'] = 'CC0 (original do projeto; textura de pedra Poly Haven stone_wall_04, CC0)'
    house0.data.name = 'casa_redonda_a_LOD0'; house1.data.name = 'casa_redonda_a_LOD1'
    print('tris', tris(house0), tris(house1), flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), relative_remap=True)

def keep_material(o, name):
    me = o.data; idx = [i for i, m in enumerate(me.materials) if m and m.name == name][0]
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != idx], context='FACES')
    for f in bm.faces: f.material_index = 0
    bm.to_mesh(me); bm.free()
    while len(me.materials) > 1:
        me.materials.pop(index=[i for i, m in enumerate(me.materials) if m.name != name][0])

def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def join(name, objs):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); o = bpy.context.view_layer.objects.active; o.name = name; return o

def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)

main()
