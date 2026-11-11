# Dev tool: paints tunics onto the Quaternius body texture by rasterising the mesh's UV triangles that lie in
# the torso / skirt / sleeve regions of the bind pose (front AND back), shading cloth with the skin's luminance.
# usage: python3 -I tools/paint-outfits.py <dir with Superhero_Male_FullBody.gltf/.bin + T_Superhero_Male_Dark.png>
import json, sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
SRC = sys.argv[1]
OUT = __file__.rsplit('/tools/', 1)[0] + '/assets/chars/'
S = 1024
j = json.load(open(SRC + '/Superhero_Male_FullBody.gltf')); b = open(SRC + '/Superhero_Male_FullBody.bin', 'rb').read()
def acc(i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: '<f4', 5123: '<u2', 5125: '<u4'}[a['componentType']]
    return np.frombuffer(b, dtype=dt, count=a['count'] * n, offset=v.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)
prim = next(p for m in j['meshes'] for p in m['primitives'] if j['materials'][p['material']]['name'] == 'MI_Superhero_Male')
P = acc(prim['attributes']['POSITION']); UV = acc(prim['attributes']['TEXCOORD_0']); I = acc(prim['indices']).reshape(-1, 3)
masks = {k: Image.new('L', (S, S), 0) for k in ('upper', 'lower', 'sleeve', 'shoe', 'strap', 'trim')}
draw = {k: ImageDraw.Draw(m) for k, m in masks.items()}
for tri in I:
    c = P[tri].mean(0); x, y = abs(c[0]), c[1]
    k = None
    if x < .26 and .98 <= y <= 1.58: k = 'upper'          # chest, back, and the shoulder tops round the neck opening
    elif x < .26 and .6 <= y < .98: k = 'lower'           # belly, hips, skirt to mid-thigh
    elif .2 <= x < .4 and y > 1.28: k = 'sleeve'          # short sleeves
    elif y < .095 and x < .3: k = 'shoe'                  # closed leather shoe
    elif (.095 <= y < .125 or .19 <= y < .215) and x < .3: k = 'strap'  # ankle cuff and a thong tied above it
    trim = (k == 'lower' and y < .7) or (k == 'sleeve' and x > .34) or (k == 'upper' and y > 1.5)   # hem, cuffs, neckline
    if not k: continue
    uv = UV[tri]
    if np.ptp(uv[:, 0]) > .3 or np.ptp(uv[:, 1]) > .3: continue  # seam-spanning triangle
    draw[k].polygon([(u * S, v * S) for u, v in uv], fill=255)
    if trim: draw['trim'].polygon([(u * S, v * S) for u, v in uv], fill=255)
for k in masks: masks[k] = masks[k].filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
skin = Image.open(SRC + '/T_Superhero_Male_Dark.png').convert('RGB').resize((S, S), Image.LANCZOS)
lum = np.asarray(skin.convert('L'), np.float32) / 255; shade = np.clip(lum / max(1e-3, np.median(lum)), .55, 1.35)[..., None]
# ring mail: rows of small iron rings, each row offset by half a ring
t = Image.new('RGB', (24, 24), (46, 48, 52)); dr = ImageDraw.Draw(t)
for cx, cy in ((6, 6), (18, 6), (0, 18), (12, 18), (24, 18)):
    dr.ellipse((cx - 6, cy - 6, cx + 6, cy + 6), outline=(150, 154, 160), width=2)
    dr.arc((cx - 6, cy - 6, cx + 6, cy + 6), 200, 280, fill=(210, 214, 220), width=2)
tile = np.asarray(t, np.float32)
mail = np.tile(tile, (S // 24 + 1, S // 24 + 1, 1))[:S, :S]
OUTFITS = {   # (upper, lower, sleeve) colours, or 'mail'
  'roman_red':   ((142, 32, 26), (142, 32, 26), (142, 32, 26)),
  'roman_white': ((196, 186, 164), (196, 186, 164), (196, 186, 164)),
  'roman_mail':  ('mail', (142, 32, 26), (142, 32, 26)),
  'velite':      ((150, 118, 80), (150, 118, 80), (150, 118, 80)),     # undyed brown wool
  'lusitano':    ((206, 196, 170), (70, 52, 36), (206, 196, 170)),   # linen corslet over a dark wool tunic
  'lusitano_b':  ((92, 72, 48), (70, 52, 36), (92, 72, 48)),
  'lusitano_c':  ((150, 104, 44), (150, 104, 44), (150, 104, 44)),   # ochre wool tunic
  'lusitano_d':  ((58, 78, 56), (96, 84, 62), (58, 78, 56)),         # green tunic over undyed wool
}
rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:S, 0:S]
noise = np.asarray(Image.fromarray((rng.standard_normal((S // 2, S // 2)) * 40 + 128).clip(0, 255).astype(np.uint8)).resize((S, S), Image.BICUBIC), np.float32) / 255 - .5
weave = (1 + .10 * noise)[..., None].astype(np.float32)   # soft mottling of dyed wool, no hard stripes (they alias)
base = np.asarray(skin, np.float32)
for name, cols in OUTFITS.items():
    img = base.copy()
    for k, col in zip(('upper', 'lower', 'sleeve'), cols):
        m = np.asarray(masks[k], np.float32)[..., None] / 255
        cloth = mail * shade if col == 'mail' else np.array(col, np.float32) * shade * weave
        img = img * (1 - m) + cloth * m
    tm = np.asarray(masks['trim'], np.float32)[..., None] / 255       # darker hem / cuffs / neckline, with a stitch line
    img = img * (1 - tm * .22)
    for k, col in (('shoe', (74, 50, 32)), ('strap', (58, 38, 24))):
        m = np.asarray(masks[k], np.float32)[..., None] / 255
        img = img * (1 - m) + np.array(col, np.float32) * np.clip(shade, .7, 1.25) * m
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(OUT + 'body_' + name + '.jpg', quality=88)
    print('body_' + name + '.jpg')
