"""Constrói art/blender/casa_redonda.blend: a casa redonda lusitana de colmo (mapa estratégico, peça 1).

Registo de como a peça foi feita, não um passo da exportação: depois de construído, o .blend é a fonte e edita-se no
Blender. A exportação para o jogo é sempre tools/blender/export_kit.py.

Unidades: 1 unidade = 1 m. Pivot no centro da base (z = 0). Porta virada a -Y (no glTF fica +Z, a frente no Three.js).
Duas malhas de jogo, cada uma com dois materiais:
  M_casa_atlas  pedra, porta, lintel e soleira: imagens cozidas (bake) de uma versão de alto detalhe (pedras uma a uma,
                em fiadas irregulares: a alvenaria é geometria, não a grelha da fotografia)
  M_colmo       telhado, nó do cume e cordas: textura de colmo repetível (gerada em numpy, periódica em u e v) × cor por vértice
Uso: python casa_redonda_build.py <saida.blend> <pasta das texturas>   (python com o módulo bpy 5.3)
  ou: blender -b --factory-startup -P casa_redonda_build.py -- <saida.blend> <pasta das texturas>
"""
import sys, math, random, os
import bpy, bmesh
from mathutils import Vector, Matrix, noise

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]   # aceita as duas invocações
OUT, TEXDIR = ARGS[0], ARGS[1]
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
STONE_TEX = os.path.join(REPO, 'assets', 'textures', 'terrain_rock', 'color.jpg')   # granito (Poly Haven rock_boulder_dry, CC0): grão, fissuras e líquenes, sem fiadas próprias
rng = random.Random(147)
REAL = []          # elementos que ganham volume real na peça de jogo (preenchido em build_stones / build_door_hp)
REAL_STONES = 10   # 2 ombreiras + 2 junto ao arco da porta + 6 na fiada de fundação
REAL_MIN_OUT = 0.020   # nenhuma destas pedras fica mais recuada do que isto: sem volume não há silhueta nem sombra

# ——— medidas (m) ———
R_OUT, BATTER = 3.05, 0.04        # raio exterior da parede na base; recuo por metro de altura (parede ligeiramente inclinada)
THICK, WALL_H = 0.45, 1.9         # espessura e altura da parede
DOOR_W, DOOR_H, DOOR_DEPTH = 0.95, 1.55, 0.26
LINTEL_H = 0.26
EAVE_R, EAVE_Z, EAVE_T = 3.62, 1.70, 0.34   # beiral: raio, altura da face de baixo, espessura do colmo no beiral
PITCH = math.radians(47)
APEX_Z = EAVE_Z + EAVE_T + EAVE_R * math.tan(PITCH) * 0.93
TILE = 1.6                        # o colmo repete-se a cada 1,6 m (menos repetições: fibras mais largas)
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
    """Granito: grão, fissuras e líquenes de uma foto de rocha sem fiadas próprias — as fiadas e as juntas são a
    geometria que o bake passa à cor e ao normal map. Cada pedra desloca a projeção (atributo «semente») para o padrão
    da fotografia não se repetir como papel de parede."""
    m = bpy.data.materials.new('HP_granito'); nt, b = nodes(m); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    img = nt.nodes.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(STONE_TEX)
    img.projection = 'BOX'; img.projection_blend = 0.25
    img2 = nt.nodes.new('ShaderNodeTexImage'); img2.image = img.image          # manchas grandes: fissuras e líquenes
    img2.projection = 'BOX'; img2.projection_blend = 0.25
    sem = nt.nodes.new('ShaderNodeAttribute'); sem.attribute_name = 'semente'
    tom = nt.nodes.new('ShaderNodeAttribute'); tom.attribute_name = 'tom'       # 0..1 por pedra
    def muladd(src, k, off):
        n = nt.nodes.new('ShaderNodeMath'); n.operation = 'MULTIPLY_ADD'
        L(src, n.inputs[0]); n.inputs[1].default_value = k; n.inputs[2].default_value = off; return n.outputs[0]
    offs = nt.nodes.new('ShaderNodeCombineXYZ')
    L(muladd(sem.outputs['Fac'], 37.13, 2.7), offs.inputs[0])
    L(muladd(sem.outputs['Fac'], 61.77, 9.1), offs.inputs[1])
    L(muladd(sem.outputs['Fac'], 23.41, 4.3), offs.inputs[2])
    pos = nt.nodes.new('ShaderNodeVectorMath'); pos.operation = 'ADD'
    L(tc.outputs['Object'], pos.inputs[0]); L(offs.outputs[0], pos.inputs[1])
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.42, 0.42, 0.42)     # grão da pedra
    L(pos.outputs[0], mp.inputs[0]); L(mp.outputs[0], img.inputs['Vector'])
    mp2 = nt.nodes.new('ShaderNodeMapping'); mp2.inputs['Scale'].default_value = (0.13, 0.13, 0.13)    # manchas
    L(pos.outputs[0], mp2.inputs[0]); L(mp2.outputs[0], img2.inputs['Vector'])
    grain = nt.nodes.new('ShaderNodeMix'); grain.data_type = 'RGBA'; grain.blend_type = 'MIX'; grain.inputs['Factor'].default_value = 0.32
    L(img.outputs['Color'], grain.inputs[6]); L(img2.outputs['Color'], grain.inputs[7])
    # a foto é bege-quente: dessatura-se para granito cinzento (multiplicar por cinzento não tira a cor da foto)
    desat = nt.nodes.new('ShaderNodeHueSaturation'); desat.inputs['Saturation'].default_value = 0.28
    desat.inputs['Value'].default_value = 0.92; desat.inputs['Fac'].default_value = 1.0
    L(grain.outputs[2], desat.inputs['Color'])
    spec = nt.nodes.new('ShaderNodeTexNoise'); spec.inputs['Scale'].default_value = 26    # manchas de 4 cm
    spec.inputs['Detail'].default_value = 8; spec.inputs['Roughness'].default_value = 0.7
    L(pos.outputs[0], spec.inputs['Vector'])
    spm = nt.nodes.new('ShaderNodeMix'); spm.data_type = 'RGBA'; spm.blend_type = 'OVERLAY'; spm.inputs['Factor'].default_value = 0.20
    L(desat.outputs['Color'], spm.inputs[6]); L(spec.outputs['Color'], spm.inputs[7])
    spec2 = nt.nodes.new('ShaderNodeTexNoise'); spec2.inputs['Scale'].default_value = 110   # grão de granito (~1 cm)
    spec2.inputs['Detail'].default_value = 4; spec2.inputs['Roughness'].default_value = 0.55
    L(pos.outputs[0], spec2.inputs['Vector'])
    spm2 = nt.nodes.new('ShaderNodeMix'); spm2.data_type = 'RGBA'; spm2.blend_type = 'OVERLAY'; spm2.inputs['Factor'].default_value = 0.30
    L(spm.outputs[2], spm2.inputs[6]); L(spec2.outputs['Color'], spm2.inputs[7])
    # (o grão entra depois de dessaturar, para não voltar a puxar para o bege)
    ramp = nt.nodes.new('ShaderNodeValToRGB'); cr = ramp.color_ramp   # cinzento frio → cinzento quente → ocre → claro
    cr.elements[0].position = 0.05; cr.elements[0].color = (0.310, 0.312, 0.320, 1)
    cr.elements[1].position = 0.60; cr.elements[1].color = (0.470, 0.455, 0.420, 1)
    e = cr.elements.new(0.88); e.color = (0.500, 0.460, 0.375, 1)
    L(tom.outputs['Fac'], ramp.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
    L(spm2.outputs[2], mix.inputs[6]); L(ramp.outputs['Color'], mix.inputs[7])
    # líquenes nas faces de cima; granito húmido e mais escuro junto ao chão
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L(geo.outputs['Normal'], sep.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.6
    nz.inputs['Detail'].default_value = 7; nz.inputs['Roughness'].default_value = 0.62
    L(pos.outputs[0], nz.inputs['Vector'])
    up = nt.nodes.new('ShaderNodeMath'); up.operation = 'MULTIPLY'; L(sep.outputs['Z'], up.inputs[0]); L(nz.outputs['Fac'], up.inputs[1])
    upm = nt.nodes.new('ShaderNodeMapRange'); upm.inputs['From Min'].default_value = 0.42
    upm.inputs['From Max'].default_value = 0.80; upm.inputs['To Max'].default_value = 0.60
    L(up.outputs[0], upm.inputs['Value'])
    lich = nt.nodes.new('ShaderNodeMix'); lich.data_type = 'RGBA'; lich.inputs[7].default_value = (0.37, 0.39, 0.31, 1)
    L(upm.outputs['Result'], lich.inputs['Factor']); L(mix.outputs[2], lich.inputs[6])
    oz = nt.nodes.new('ShaderNodeSeparateXYZ'); L(tc.outputs['Object'], oz.inputs[0])
    dampf = nt.nodes.new('ShaderNodeMapRange'); dampf.inputs['From Min'].default_value = 0.0
    dampf.inputs['From Max'].default_value = 0.60; dampf.inputs['To Min'].default_value = 0.78; dampf.inputs['To Max'].default_value = 1.0
    L(oz.outputs['Z'], dampf.inputs['Value'])
    damp = nt.nodes.new('ShaderNodeMix'); damp.data_type = 'RGBA'; damp.blend_type = 'MULTIPLY'; damp.inputs['Factor'].default_value = 1
    L(lich.outputs[2], damp.inputs[6]); L(dampf.outputs['Result'], damp.inputs[7])
    L(damp.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.88
    nz2 = nt.nodes.new('ShaderNodeTexNoise'); nz2.inputs['Scale'].default_value = 34
    nz2.inputs['Detail'].default_value = 8; L(pos.outputs[0], nz2.inputs['Vector'])
    nz3 = nt.nodes.new('ShaderNodeTexNoise'); nz3.inputs['Scale'].default_value = 7.5
    nz3.inputs['Detail'].default_value = 5; L(pos.outputs[0], nz3.inputs['Vector'])
    b1 = nt.nodes.new('ShaderNodeBump'); b1.inputs['Strength'].default_value = 0.30; b1.inputs['Distance'].default_value = 0.004
    L(nz3.outputs['Fac'], b1.inputs['Height'])
    b2 = nt.nodes.new('ShaderNodeBump'); b2.inputs['Strength'].default_value = 0.45; b2.inputs['Distance'].default_value = 0.006
    L(nz2.outputs['Fac'], b2.inputs['Height']); L(b1.outputs[0], b2.inputs['Normal']); L(b2.outputs[0], b.inputs['Normal'])
    return m

def mat_flat(name, rgb, rough):
    m = bpy.data.materials.new(name); nt, b = nodes(m)
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough; return m

def mat_earth():
    """Terra e cascalho da junta: o fundo que se vê entre as pedras, com grão, para a junta não parecer argamassa lisa."""
    m = bpy.data.materials.new('HP_terra'); nt, b = nodes(m); L = nt.links.new
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 24
    nz.inputs['Detail'].default_value = 8; nz.inputs['Roughness'].default_value = 0.65
    L(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (0.050, 0.040, 0.030, 1); ramp.color_ramp.elements[1].color = (0.115, 0.098, 0.075, 1)
    L(nz.outputs['Fac'], ramp.inputs[0]); L(ramp.outputs[0], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.97
    return m

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

def stone_block(bm, lenx, depth, h, bevel=0.010):
    """Um bloco de granito tosco: caixa com um chamfro curto de 1 cm (aresta viva: a junta é o que se vê entre as
    pedras, não o fio gasto de cada uma), faces convexas e deformação de dois níveis — a ondulação da pedra e o grão.
    É este volume que o bake passa ao normal map. Devolve os vértices novos."""
    t = bmesh.new()
    bmesh.ops.create_cube(t, size=1.0)
    for v in t.verts: v.co = Vector((v.co.x * lenx, v.co.y * depth, v.co.z * h))
    bmesh.ops.bevel(t, geom=list(t.edges), offset=min(bevel, min(lenx, h, depth) * 0.14), segments=1, affect='EDGES', profile=0.5)
    bmesh.ops.subdivide_edges(t, edges=list(t.edges), cuts=2 if min(lenx, h) > 0.26 else 1, use_grid_fill=True)
    bmesh.ops.triangulate(t, faces=[f for f in t.faces if len(f.verts) > 4])
    t.normal_update()
    sd = rng.uniform(0, 90); fq1 = rng.uniform(2.0, 3.6); a1 = rng.uniform(0.010, 0.022)
    fq2 = rng.uniform(7.0, 12.0); a2 = rng.uniform(0.002, 0.006); bulge = rng.uniform(0.012, 0.024)
    chip = rng.uniform(0.005, 0.011)          # fio lascado: desloca cada vértice na face da pedra, não só na normal
    hx, hz = max(lenx, 1e-3) * 0.5, max(h, 1e-3) * 0.5
    cutx = (rng.uniform(0.0, 0.034), rng.uniform(0.0, 0.034))   # cantos lascados: o contorno deixa de ser rectangular
    cutz = (rng.uniform(0.0, 0.030), rng.uniform(0.0, 0.030))
    for v in t.verts:
        p = v.co
        n1 = noise.noise(Vector((p.x * fq1 + sd, p.y * fq1 + 13.7, p.z * fq1 + 6.1)))
        n2 = noise.noise(Vector((p.x * fq2 + 41.3, p.y * fq2 + sd, p.z * fq2 + 8.9)))
        v.co = p + v.normal * (n1 * a1 + n2 * a2)
        c1 = noise.noise(Vector((p.x * 18.0 + 7.1, p.y * 18.0 + sd, p.z * 18.0 + 3.3)))
        c2 = noise.noise(Vector((p.x * 16.0 + 3.9, p.y * 16.0 + 21.7, p.z * 16.0 + sd)))
        v.co.x += (c1 - 0.5) * chip
        v.co.z += (c2 - 0.5) * chip
        if p.y < 0:   # face de fora (local -Y): convexa — pedra rolada pela mão e não serrada
            k = max(0.0, 1 - (p.x / hx) ** 2) * max(0.0, 1 - (p.z / hz) ** 2)
            v.co.y -= bulge * k
            ex, ez = abs(p.x) / hx, abs(p.z) / hz
            if ex > 0.6 and ez > 0.6:                       # canto quebrado, esbatido para dentro da face
                k2 = ((ex - 0.6) / 0.4) * ((ez - 0.6) / 0.4)
                v.co.x -= math.copysign(cutx[0] if p.x < 0 else cutx[1], p.x) * k2
                v.co.z -= math.copysign(cutz[0] if p.z < 0 else cutz[1], p.z) * k2
    m = {}
    for v in t.verts: m[v] = bm.verts.new(v.co)
    for f in t.faces:
        try: bm.faces.new([m[v] for v in f.verts])
        except ValueError: pass
    t.free()
    return list(m.values())

def stone_matrix(st):
    """Matriz da pedra com volume real: a mesma da versão de alto detalhe (a silhueta cai onde caiu o bake, que é o que
    se vê na parede), empurrada para fora o suficiente para o volume real tapar o que ficou cozido."""
    L, depth, h, am, zs = st['L'], st['depth'], st['h'], st['am'], st['z']
    out = max(st['out'], REAL_MIN_OUT - 0.012) + 0.012
    r = r_at(zs)
    return (Matrix.Translation(Vector((math.cos(am) * (r - depth / 2 + out), math.sin(am) * (r - depth / 2 + out), zs)))
            @ Matrix.Rotation(am + math.pi / 2, 4, 'Z') @ Matrix.Rotation(st['yaw'], 4, 'Z')
            @ Matrix.Rotation(st['roll'], 4, 'Y') @ Matrix.Rotation(st['pitch'], 4, 'X'))

def build_real(c, specs, wall):
    """Pedras, ombreiras e lintel com volume real, construídos depois do bake: as UVs são tiradas da parede já
    arrumada no atlas (cada face cai no sítio onde aquela pedra foi cozida), por isso herdam a cor e o relevo que lá
    estão e o atlas não cresce — as faces finas de topo e de lado caem na junta, a poucos texels da frente."""
    me = wall.data
    bpy.context.view_layer.update()
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new('UVMap')

    def hit_uv(co):
        """UV exacta da parede no ponto por trás deste vértice (o ponto onde aquela pedra foi cozida): raio radial e
        interpolação baricêntrica dentro da face apanhada."""
        a = math.atan2(co.y, co.x)
        ok = False
        for z in (co.z, min(max(co.z, 0.035), WALL_H - 0.035)):   # à rasquinha do chão o raio passa ao lado da face
            R = r_at(z) + 0.30
            ok, loc, nrm, fi = wall.ray_cast(Vector((math.cos(a) * R, math.sin(a) * R, z)), Vector((-math.cos(a), -math.sin(a), 0)))
            if ok: break
        if not ok: return None
        p = me.polygons[fi]
        li = list(range(p.loop_start, p.loop_start + p.loop_total))
        co3 = [me.vertices[me.loops[i].vertex_index].co for i in li]
        uv2 = [Vector(me.uv_layers.active.data[i].uv) for i in li]
        for t in range(1, len(co3) - 1):
            v0, v1, v2 = co3[t] - co3[0], co3[t + 1] - co3[0], loc - co3[0]
            d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
            d20, d21 = v2.dot(v0), v2.dot(v1)
            den = d00 * d11 - d01 * d01
            if abs(den) < 1e-12: continue
            b1 = (d11 * d20 - d01 * d21) / den; b2 = (d00 * d21 - d01 * d20) / den; b0 = 1 - b1 - b2
            if min(b0, b1, b2) > -0.05: return uv2[0] * b0 + uv2[t] * b1 + uv2[t + 1] * b2
        return None

    for st in specs:
        M = st['M'] if 'M' in st else stone_matrix(st)
        hx, hy, hz = st['L'] / 2, st['depth'] / 2, st['h'] / 2
        P, UV = {}, {}
        for i in (0, 1):
            for j in (0, 1):
                for kk in (0, 1):
                    v = bm.verts.new(M @ Vector(((1 if i else -1) * hx, (1 if j else -1) * hy, (1 if kk else -1) * hz)))
                    P[i, j, kk] = v; UV[i, j, kk] = None
        for i in (0, 1):
            for kk in (0, 1):
                UV[i, 0, kk] = hit_uv(P[i, 0, kk].co)      # aresta da frente: UV tirada da parede
        if any(UV[i, 0, kk] is None for i in (0, 1) for kk in (0, 1)):
            print('sem parede à frente de', st.get('kind'), flush=True); continue
        du = (UV[1, 0, 0] - UV[0, 0, 0]).normalized()     # direção da largura no atlas
        dv = (UV[0, 0, 1] - UV[0, 0, 0]).normalized()     # direção da altura no atlas
        su = (UV[1, 0, 0] - UV[0, 0, 0]).length / max(1e-6, (P[1, 0, 0].co - P[0, 0, 0].co).length)
        sv = (UV[0, 0, 1] - UV[0, 0, 0]).length / max(1e-6, (P[0, 0, 1].co - P[0, 0, 0].co).length)
        for i in (0, 1):
            for kk in (0, 1):
                # topo e base continuam a projeção métrica para dentro da junta acima e abaixo
                # (para dentro da pedra: assim a junta nunca sai da ilha do atlas e a face fina fica com a cor da pedra)
                UV[i, 1, kk] = UV[i, 0, kk] + dv * (min(st['depth'], 0.06) * sv * (-1 if kk else 1))
        for q, kind in zip((((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),    # frente (local -Y): virada para fora
                            ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),    # topo
                            ((0, 1, 0), (1, 1, 0), (1, 0, 0), (0, 0, 0)),    # base
                            ((0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0)),    # lado esquerdo
                            ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))),   # lado direito
                           ('frente', 'topo', 'base', 'esq', 'dir')):
            f = bm.faces.new([P[t] for t in q])
            for lp in f.loops:
                i, j, kk = [t for t, v in P.items() if v is lp.vert][0]
                uv = UV[i, j, kk]
                if kind in ('esq', 'dir') and j == 1:       # os lados caem na junta ao lado (projeção métrica)
                    uv = UV[i, 1, kk] + du * (min(st['depth'], 0.04) * su * (-1 if i else 1))
                lp[uvl].uv = (uv.x, uv.y)
    o = obj_from_bm('casa_reais', bm, c)
    return o

def build_stones(c, m_stone, m_core):
    """Pedras uma a uma, por fiadas, à volta da parede (menos na porta); por trás, o enchimento de terra escura.
    Fiadas de altura irregular, juntas estreitas mas de largura variável, travessas compridas, cunhas de aperto e pedras
    que sobressaem ou recolhem: a alvenaria é esta geometria (o bake passa-a ao GLB sem lhe custar polígonos)."""
    bm = bmesh.new(); tom = bm.verts.layers.float.new('tom'); sem = bm.verts.layers.float.new('semente')

    def place(Lr, depth, hs, am, zs, t, s, roll=0.0, pitch=0.0, yaw=0.0, out=None):
        if out is None:
            out = rng.uniform(-0.020, 0.050)        # era o último argumento da chamada: a sequência de rng não muda
        Lr, hs = max(Lr, 0.05), max(hs, 0.04)
        new = stone_block(bm, Lr, depth, hs)
        for v in new:
            v[tom] = t; v[sem] = s
        r = r_at(zs)
        M = (Matrix.Translation(Vector((math.cos(am) * (r - depth / 2 + out), math.sin(am) * (r - depth / 2 + out), zs)))
             @ Matrix.Rotation(am + math.pi / 2, 4, 'Z') @ Matrix.Rotation(yaw, 4, 'Z')
             @ Matrix.Rotation(roll, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'X'))
        bmesh.ops.transform(bm, matrix=M, verts=new)
        return dict(L=Lr, depth=depth, h=hs, am=am, z=zs, out=out, roll=roll, pitch=pitch, yaw=yaw)

    def tone(am):
        n = noise.noise(Vector((math.cos(am) * 1.2, math.sin(am) * 1.2, z * 2.3)))   # pedras vizinhas parecem-se
        t = 0.5 + 0.9 * (n - 0.5) + rng.uniform(-0.18, 0.18)
        if rng.random() < 0.05: t = rng.uniform(0.02, 0.15)      # pedra húmida, quase negra
        elif rng.random() < 0.05: t = rng.uniform(0.88, 1.0)     # pedra clara, coberta de líquen
        return min(1.0, max(0.0, t))

    def side(am):
        return math.atan2(math.sin(am - DOOR_A), math.cos(am - DOOR_A))

    def strip_ok(st):
        """Fora das viradas de tira do atlas (6 tiras de 60°): a pedra real herda as UVs da parede, e uma pedra a
        cavalo entre duas tiras ficaria com a textura cortada ao meio."""
        a = st['am'] % (2 * math.pi); half = st['L'] / 2 / r_at(st['z'])
        lo = int(a // (math.pi / 3)) * math.pi / 3
        return lo + half < a < lo + math.pi / 3 - half

    def pick_sides(cs, key):
        """Uma pedra de cada lado do vão: o par fica simétrico."""
        got = []
        for sgn in (-1, 1):
            s = sorted([c for c in cs if side(c['am']) * sgn > 0], key=key)
            if s: got.append(s[0])
        return got

    z, course, cands = 0.0, 0, []
    while z < WALL_H - 0.07:
        rem = WALL_H - z
        if course == 0: hc = rng.uniform(0.30, 0.38)                       # fiada de fundação: pedras maiores
        elif rem <= 0.33: hc = rem
        else:
            k = rng.random()
            hc = rng.uniform(0.13, 0.18) if k < 0.20 else (rng.uniform(0.20, 0.27) if k < 0.78 else rng.uniform(0.28, 0.34))
        hc = min(hc, rem)
        zc = z + hc / 2
        bed = rng.uniform(0.008, 0.017)                                     # junta de leito
        open_row = z < DOOR_H - 0.01                                        # fiada cortada pelo vão da porta
        lo, span = (DOOR_A + DOOR_HALF, 2 * math.pi - 2 * DOOR_HALF) if open_row else (0.0, 2 * math.pi)
        a, end = lo, lo + span
        to_through = rng.uniform(0.8, 2.2)                                  # distância até à próxima travessa
        while a < end - 0.02:
            r = r_at(zc)
            if to_through <= 0:
                L = rng.uniform(0.52, 0.80); to_through = rng.uniform(1.2, 2.4)
            else:
                k = rng.random()
                L = rng.uniform(0.17, 0.31) if k < 0.45 else (rng.uniform(0.31, 0.50) if k < 0.90 else rng.uniform(0.50, 0.72))
            to_through -= L
            chink = rng.uniform(0.030, 0.062) if (rng.random() < 0.10 and a + (L + 0.09) / r < end) else 0.0
            k = rng.random()
            gap = rng.uniform(0.002, 0.007) if k < 0.26 else (rng.uniform(0.007, 0.020) if k < 0.82 else rng.uniform(0.020, 0.045))
            da = (L + gap + chink) / r
            if a + da > end - 0.02:                                         # a última pedra fecha na ombreira
                da = end - a; L = da * r; gap = min(gap, L * 0.2); chink = 0.0; L -= gap
            if L < 0.07: break
            if not open_row and zc < DOOR_H + LINTEL_H and in_gap(a + da / 2, 0.12):   # o lintel ocupa este lugar
                a += da; continue
            jamb = open_row and (abs(a - lo) < 1e-6 or a + da >= end - 1e-6)
            depth = THICK if jamb else rng.uniform(0.26, THICK)
            # uma em cada oito pedras atravessa a fiada (pedra passante): quebra as linhas de leito, que não são uma grelha
            hs = hc * (rng.uniform(1.35, 1.70) if rng.random() < 0.12 else 1.0) - bed - rng.uniform(0.0, 0.008)
            hs = min(hs, WALL_H - z - 0.010)
            bottom = max(0.002, z + bed / 2 + rng.uniform(0.0, 0.012) - (hs - (hc - bed)) / 2)
            st = place(L - rng.uniform(0.006, 0.020), depth, hs, a + da / 2 + rng.uniform(-0.008, 0.008), bottom + hs / 2,
                       tone(a + da / 2), rng.uniform(0, 100), roll=rng.uniform(-0.14, 0.14),
                       pitch=rng.uniform(-0.05, 0.05), yaw=rng.uniform(-0.05, 0.05))
            if not strip_ok(st): pass
            elif jamb and course == 0: cands.append(dict(st, kind='ombreira'))
            elif jamb and open_row and DOOR_H - (z + hc) < 0.40: cands.append(dict(st, kind='arco'))
            elif course == 0 and not jamb and st['L'] > 0.30: cands.append(dict(st, kind='fundacao'))
            a += da
            if chink:                                                       # cunha de aperto dentro da junta larga
                ch = rng.uniform(0.030, min(0.075, hs * 0.5))
                cz = bottom + rng.uniform(0.0, max(0.0, hs - ch))
                place(chink - 0.010, rng.uniform(0.16, 0.28), ch, a + (chink / 2) / r, cz + ch / 2, tone(a),
                      rng.uniform(0, 100), roll=rng.uniform(-0.12, 0.12), pitch=rng.uniform(-0.06, 0.06),
                      out=rng.uniform(-0.02, 0.02))
                a += 0.010 / r
        z += hc; course += 1
    # ——— as poucas pedras que ganham volume real na peça de jogo (o resto fica cozido, como está) ———
    chosen = pick_sides([c for c in cands if c['kind'] == 'ombreira'], lambda c: (-c['z'], -c['out']))
    chosen += pick_sides([c for c in cands if c['kind'] == 'arco'], lambda c: (-round(c['z'] / 0.06), -c['out']))
    for cand in sorted([f for f in cands if f['kind'] == 'fundacao'], key=lambda f: -(f['L'] + 8 * f['out'])):
        if len(chosen) >= REAL_STONES: break
        if all(abs(math.atan2(math.sin(cand['am'] - o['am']), math.cos(cand['am'] - o['am']))) > 0.55 for o in chosen):
            chosen.append(cand)
    REAL.extend(sorted(chosen, key=lambda c: (c['kind'], c['am'])))
    print('pedras com volume real:', len(REAL), [c['kind'] for c in REAL], flush=True)
    o = obj_from_bm('HP_pedras', bm, c); o.data.materials.append(m_stone)
    for p in o.data.polygons: p.use_smooth = True
    # enchimento: terra e cascalho entre as pedras (superfície irregular: a junta não é um cilindro liso)
    core = bmesh.new()
    bmesh.ops.create_cone(core, cap_ends=False, segments=96, radius1=R_OUT - 0.02, radius2=r_at(WALL_H) - 0.02, depth=WALL_H)
    bmesh.ops.subdivide_edges(core, edges=list(core.edges), cuts=6, use_grid_fill=True)
    for v in core.verts:
        r = math.hypot(v.co.x, v.co.y)
        if r < 1e-6: continue
        nz = noise.noise(Vector((v.co.x * 4.5, v.co.y * 4.5, (v.co.z + WALL_H / 2) * 6.0)))
        k = 1 + (nz - 0.5) * 0.05
        v.co.x *= k; v.co.y *= k
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
        stone_block(bm, lx, ly, lz, bevel=0.006)
        tom = bm.verts.layers.float.new('tom'); sem = bm.verts.layers.float.new('semente'); s0 = rng.uniform(0, 100)
        for v in bm.verts:
            v.co = v.co * (1 + noise.noise(v.co * 4) * 0.03)
            v[tom] = 0.35 if name == 'HP_lintel' else 0.2; v[sem] = s0
        bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -(R_OUT - THICK / 2) - out, z0 + lz / 2 - (0.06 if name == 'HP_soleira' else 0)))
        o = obj_from_bm(name, bm, c); o.data.materials.append(m_stone); objs.append(o)
        for p in o.data.polygons: p.use_smooth = True
    # a mesma laje, agora com volume real: 8 mm à frente e 1 cm maior em volta, para tapar o que está cozido por baixo
    ly, lz = THICK + 0.075, LINTEL_H + 0.012
    front = -(R_OUT - THICK / 2) - 0.03 - (THICK + 0.06) / 2 - 0.008
    REAL.append(dict(kind='lintel', L=DOOR_W + 0.62, depth=ly, h=lz,
                     M=Matrix.Translation(Vector((0, front + ly / 2, DOOR_H + LINTEL_H / 2 - 0.002)))))
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
            if 1 <= i <= 5:   # beiral irregular: pontas de palha de comprimento desigual
                jr = noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, 1.5))) * 0.085
                jz = noise.noise(Vector((math.cos(a) * 3.4, math.sin(a) * 3.4, 4.5))) * 0.085
            p = Vector((math.cos(a) * (r + jr), math.sin(a) * (r + jr), z + jz))
            v = bm.verts.new(p)
            ring.append((v, roof_tom(p, under=i <= 1)))    # cor contínua: nada de fiadas pintadas
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
                # a junta entre repetições da textura desliza com o ângulo (as fibras são verticais, por isso a
                # translação não as inclina): as pontas de uma camada deixam de ser um anel perfeito
                ac = math.atan2(p.y, p.x)
                wob = 0.22 * math.sin(ac + 0.7) + 0.13 * math.sin(2 * ac + 2.1) + 0.07 * math.sin(5 * ac + 4.4)
                l[uv].uv = (ss / seg * n_tiles, (slant_tot - dist_s(p)) / TILE + wob + (0.37 if i < 2 else 0))
                g = tm
                l[col] = (g * 1.0, g * 0.97, g * 0.92, 1)
    # nó do cume: feixe atado, cone curto
    r_top, z_top = cone_at(0.93)
    knot = [(r_top, z_top), (0.24, z_top + 0.12), (0.21, z_top + 0.16), (0.20, z_top + 0.24), (0.22, z_top + 0.28), (0.0, z_top + 0.55)]
    prev = rings[-1]
    for (r, z) in knot:
        if r == 0:
            tip = bm.verts.new((0, 0, z))
            for s in range(seg):
                s2 = (s + 1) % seg
                f = bm.faces.new((prev[s][0], prev[s2][0], tip))
                g = roof_tom(Vector((0, 0, z)), under=True) * 0.92
                for l in f.loops:
                    l[uv].uv = (s / seg * n_tiles, slant_tot / TILE + 0.3); l[col] = (g, g * 0.96, g * 0.9, 1)
            break
        ring = []
        for s in range(seg):
            p = Vector((math.cos(2 * math.pi * s / seg) * r, math.sin(2 * math.pi * s / seg) * r, z))
            ring.append((bm.verts.new(p), roof_tom(p, under=True)))
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

def thatch_textures(seed=4711):
    """Colmo procedimental em numpy: fibras quebradas com pontas que afinam, molhos, ondulação e manchas de
    intempérie. Todos os campos são periódicos em u e v, por isso a textura repete sem costura em nenhuma direção.
    A cor é escrita em linear (é o que o Blender guarda em `pixels`), o normal em espaço tangente."""
    import numpy as np
    r = np.random.default_rng(seed)
    N = COLMO_RES
    U = np.arange(N)[None, :] / N          # à volta do telhado (u)
    V = np.arange(N)[:, None] / N          # pela água abaixo (v)

    def terms(n, kmax, kmin=1, slope=0.9, kvmax=None):
        """Frequências inteiras ao acaso; `kvmax=0` dá veios que só variam em u (não fazem anéis)."""
        out = []
        for _ in range(n):
            ku = int(r.integers(kmin, kmax + 1))
            kv = 0 if kvmax == 0 else int(r.integers(kmin, (kmax if kvmax is None else kvmax) + 1))
            out.append((ku, kv, r.uniform(0.35, 1.0) / (1 + slope * math.hypot(ku, kv) / kmax)))
        return out

    def pn(t):
        """Ruído suave periódico: soma de cossenos com frequências inteiras em u e v, normalizado a 0..1."""
        f = np.zeros((N, N))
        for ku, kv, a in t:
            f += a * np.cos(2 * np.pi * (ku * U + kv * V) + r.uniform(0, 2 * np.pi))
        f -= f.min()
        return f / max(1e-9, f.max())

    def fibers(F, warp, segf, ph):
        """Uma camada de fibras: perfil arredondado em u, ondulação ao longo de v, quebrada em segmentos com pontas
        que afinam; cada fibra leva o seu tom e a sua altura."""
        w = np.zeros((N, N))
        for k, amp in ((2, 1.0), (3, 0.6), (5, 0.35), (8, 0.2)):
            w += (warp * amp / k) * np.cos(2 * np.pi * (k * V + r.uniform(0, 1)) + ph)
        s = ((U + w) * F) % 1.0
        prof = np.sin(np.pi * s) ** 0.6
        seg = 0.5 + 0.5 * np.cos(2 * np.pi * (segf * V + 0.6 * s) + 2.1 * ph)
        taper = np.clip((seg - 0.20) / 0.62, 0, 1) ** 0.55          # pontas de palha
        tones = r.uniform(0.55, 1.0, F) * r.uniform(0.78, 1.0, F)
        tone = tones[np.floor((U + w) * F).astype(np.int32) % F]
        return prof * taper * tone, taper, prof * tone      # altura (com pontas), máscara das pontas, só cor

    f1, t1, c1 = fibers(200, 0.013, 2.1, 0.0)
    f2, t2, c2 = fibers(94, 0.030, 1.3, 1.7)
    f3, t3, c3 = fibers(340, 0.006, 3.6, 3.3)
    clump = pn(terms(16, 9, 1, 1.1, kvmax=2))          # molhos: feixes ao alto, não anéis à volta do telhado
    fine = pn(terms(20, 26, 5, 0.6, kvmax=6))
    vst = pn(terms(18, 40, 3, 0.5, kvmax=0))           # veios só em u: não têm como fazer anéis
    h = (0.40 * f2 + 0.40 * f1 + 0.20 * f3) * (0.55 + 0.70 * clump) + 0.06 * fine
    h = (h - h.min()) / max(1e-9, h.max() - h.min())
    hc = (0.45 * c1 + 0.40 * c2 + 0.15 * c3) * (0.66 + 0.60 * vst)     # cor: só a fibra, sem as pontas das camadas
    hc = ((hc - hc.min()) / max(1e-9, hc.max() - hc.min())) ** 0.85     # meios-tons acima: palha, não borra

    dark, mid, light = (np.array(c) for c in ((0.120, 0.098, 0.062), (0.445, 0.360, 0.220), (0.760, 0.665, 0.470)))
    e = hc[..., None]
    col = dark + (mid - dark) * np.clip(e / 0.55, 0, 1) + (light - mid) * np.clip((e - 0.55) / 0.45, 0, 1)
    col = col * (0.96 + 0.08 * np.clip(t1 + t2, 0, 1)[..., None])                      # pontas branqueadas
    wx = np.clip((pn(terms(14, 6, 1, 1.0, kvmax=1)) - 0.42) / 0.58, 0, 1)[..., None]
    col = col * (1 - 0.50 * wx) + np.array([0.232, 0.242, 0.188]) * (0.50 * wx)         # líquenes e intempérie
    col = col * (0.90 + 0.18 * pn(terms(24, 60, 8, 0.4))[..., None])                    # grão fino
    col = np.clip(col, 0, 1)        # a paleta já está em sRGB: `Image.save()` escreve os bytes tal e qual

    k = 9.0
    du = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k
    dv = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k
    n = np.dstack((-du, -dv, np.ones_like(h)))
    n /= np.linalg.norm(n, axis=2, keepdims=True)

    ic = new_image('colmo_cor', N, N)
    ic.pixels[:] = np.dstack([col, np.ones((N, N))]).ravel()
    inn = new_image('colmo_normal', N, N, True)
    inn.pixels[:] = np.dstack([np.clip(n * 0.5 + 0.5, 0, 1), np.ones((N, N))]).ravel()
    for img, name, q in ((ic, 'colmo_cor', 88), (inn, 'colmo_normal', 86)):
        save_img(img, os.path.join(TEXDIR, name + '.jpg'), q)
        img.filepath = '//texturas/' + name + '.jpg'
    return ic, inn

def roof_tom(p, under=False):
    """Cor da palha por vértice: manchas suaves e contínuas (nada de fiadas pintadas), mais escura e densa para o
    cume, mais clara a meio da água; à sombra por baixo do beiral e no nó do cume."""
    a = math.atan2(p.y, p.x)
    f = max(0.0, min(1.0, (EAVE_R - math.hypot(p.x, p.y)) / (EAVE_R - 0.24)))          # 0 no beiral, 1 no cume
    n1 = 0.5 + 0.5 * noise.noise(Vector((math.cos(a) * 1.9, math.sin(a) * 1.9, f * 2.2 + 7.0)))
    n2 = 0.5 + 0.5 * noise.noise(Vector((math.cos(a) * 5.7, math.sin(a) * 5.7, f * 6.5 + 2.0)))
    t = 0.92 + 0.24 * (n1 - 0.5) + 0.10 * (n2 - 0.5)
    t *= 1.0 - 0.24 * f ** 1.6                     # o cume é um feixe apertado: mais escuro
    t *= 1.0 + 0.06 * math.sin(min(1.0, f / 0.45) * math.pi) ** 2                  # meio da água mais claro
    if under: t *= 0.68
    return max(0.34, min(1.05, t))

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
    rb.use_selected_to_active = bool(selected); rb.cage_extrusion = kw.get('cage', 0.16); rb.max_ray_distance = kw.get('ray', 0.30)
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
    m_stone, m_core, m_wood = mat_stone(), mat_earth(), mat_wood()
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

    # ——— colmo: textura procedimental (numpy), periódica nas duas direções ———
    t_col, t_nrm = thatch_textures()

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
    reais0 = build_real(c_export, REAL, wall0); reais0.data.materials.append(M_atlas)   # UVs tiradas do atlas cozido

    roof0 = roof_low(c_export, 36, 0); roof0.data.materials.append(M_colmo)
    # LOD1: a parede sem as pedras reais, dizimada (mantém as UVs do atlas) + telhado simples: fica como estava
    w1 = bpy.data.objects.new('parede_LOD1', wall0.data.copy()); c_export.objects.link(w1)
    dec = w1.modifiers.new('dec', 'DECIMATE'); dec.ratio = 0.35; dec.delimit = {'UV', 'SEAM'}
    apply_mods(w1)
    # LOD0: uma só malha com os dois materiais (parede + pedras reais + colmo)
    roof1 = roof_low(c_export, 16, 1); roof1.data.materials.append(M_colmo)
    house0 = join('mapa_casa_redonda_a_LOD0', [wall0, reais0, roof0])
    house1 = join('mapa_casa_redonda_a_LOD1', [w1, roof1])
    house1.location.x = 9   # lado a lado no ficheiro; a exportação repõe a origem
    for o in c_hp.objects: o.hide_render = True
    c_hp.hide_viewport = True; c_work.hide_viewport = True
    for o in c_work.objects: o.hide_render = True
    for o in (house0, house1):
        for x in bpy.context.view_layer.objects: x.select_set(False)
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))   # arestas vivas nas ombreiras, suave no resto
        o['peca'] = 'casa_redonda'; o['licenca'] = 'CC0 (original do projeto; grão de granito Poly Haven rock_boulder_dry, CC0)'
    house0.data.name = 'casa_redonda_a_LOD0'; house1.data.name = 'casa_redonda_a_LOD1'
    print('tris', tris(house0), tris(house1), 'reais', len(REAL), flush=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(OUT), relative_remap=True)

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
