// PBR materials. CC0 photo textures from Poly Haven when the files are present under
// assets/textures/<name>/{color,normal,rough}.jpg; otherwise a procedural fallback (flat colour + roughness).

const PH = slug => `https://polyhaven.com/a/${slug}`;
const files = name => ({ color: `assets/textures/${name}/color.jpg`, normal: `assets/textures/${name}/normal.jpg`, rough: `assets/textures/${name}/rough.jpg` });

/** CC0 sets (all verified as CC0 on their Poly Haven page). `slug` is the Poly Haven asset name. */
export const TEXTURE_SETS = {
  terrain_grass: { source: 'Poly Haven', slug: 'coast_sand_rocks_02', url: PH('coast_sand_rocks_02'), files: files('terrain_grass') },
  terrain_dry:   { source: 'Poly Haven', slug: 'forest_ground_04',    url: PH('forest_ground_04'),    files: files('terrain_dry') },
  terrain_rock:  { source: 'Poly Haven', slug: 'rock_boulder_dry',    url: PH('rock_boulder_dry'),    files: files('terrain_rock') },
  road:          { source: 'Poly Haven', slug: 'rocks_ground_02',     url: PH('rocks_ground_02'),     files: files('road') },
  camp_ground:   { source: 'Poly Haven', slug: 'mud_cracked_dry_03',  url: PH('mud_cracked_dry_03'),  files: files('camp_ground') },
  bark_pine:     { source: 'Poly Haven', slug: 'chinese_cedar_bark',  url: PH('chinese_cedar_bark'),  files: files('bark_pine') },
  bark_oak:      { source: 'Poly Haven', slug: 'bark_platanus',       url: PH('bark_platanus'),       files: files('bark_oak') },
  castro_stone:  { source: 'Poly Haven', slug: 'stone_wall_04',       url: PH('stone_wall_04'),       files: files('castro_stone') },
  wood:          { source: 'Poly Haven', slug: 'raw_plank_wall',      url: PH('raw_plank_wall'),      files: files('wood') },
  iron:          { source: 'Poly Haven', slug: 'rusty_metal_03',      url: PH('rusty_metal_03'),      files: files('iron') },
  leather:       { source: 'Poly Haven', slug: 'leather_white',       url: PH('leather_white'),       files: files('leather') },
};

/** Every material the game uses: fallback colour, roughness, metalness, texture repeat, tint over the photo. */
export const MATERIALS = {
  terrain_grass: { color: 0x5b6b33, rough: .95, repeat: 1 },
  terrain_dry:   { color: 0x8a7a4a, rough: .95, repeat: 1 },
  terrain_rock:  { color: 0x7b756d, rough: .9, repeat: 2 },
  road:          { color: 0x7d6547, rough: .95, repeat: 1 },
  camp_ground:   { color: 0x6c573d, rough: .95, repeat: 1 },
  bark_pine:     { color: 0x4a3426, rough: .95, repeat: 1 },
  bark_oak:      { color: 0x55432f, rough: .95, repeat: 1 },
  castro_stone:  { color: 0x8d8274, rough: .9, repeat: 1.5 },
  wood:          { color: 0x6b4b2e, rough: .85, repeat: 1 },
  iron:          { color: 0x8c9094, rough: .45, metal: .85, repeat: 1, tint: 0xb8b8b8 },
  leather:       { color: 0x5a3b22, rough: .7, repeat: 1, tint: 0x6b4426 },
  // procedural only (no CC0 set verified yet)
  thatch:        { color: 0x9c8146, rough: 1, repeat: 1 },
  canvas:        { color: 0xd2c3a0, rough: .9, repeat: 1 },
  canvas_red:    { color: 0x8e231c, rough: .9, repeat: 1 },
  wool_red:      { color: 0x9a2a20, rough: 1, repeat: 1 },
  wool_brown:    { color: 0x7d5b38, rough: 1, repeat: 1 },
  bronze:        { color: 0xb08a3c, rough: .35, metal: .9, repeat: 1 },
  skin:          { color: 0xc2906c, rough: .75, repeat: 1 },
};

async function tryLoad(loader, url) {
  try { return await loader.loadAsync(url); } catch (_) { return null; }
}

/**
 * @param THREE injected Three.js namespace
 * @param loader object with loadAsync(url) (THREE.TextureLoader) or null for no loading
 * @param quality 'low' | 'medium' | 'high' — low loads colour maps only
 * @returns Promise<Record<name, MeshStandardMaterial>> — always one material per MATERIALS entry
 */
export async function loadMaterials({ THREE, loader, quality = 'medium', anisotropy = 4 }) {
  const out = {};
  await Promise.all(Object.entries(MATERIALS).map(async ([name, def]) => {
    const m = new THREE.MeshStandardMaterial({ color: def.color, roughness: def.rough, metalness: def.metal || 0 });
    const set = TEXTURE_SETS[name];
    if (set && loader) {
      const want = quality === 'low' ? ['color'] : ['color', 'normal', 'rough'];
      const [color, normal, rough] = await Promise.all(['color', 'normal', 'rough'].map(k => want.includes(k) ? tryLoad(loader, set.files[k]) : null));
      const prep = (t, srgb) => { if (!t) return null; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(def.repeat, def.repeat); t.anisotropy = anisotropy; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      if (color) { m.map = prep(color, true); m.color.setHex(def.tint || 0xffffff); }
      m.normalMap = prep(normal, false);
      if (rough) { m.roughnessMap = prep(rough, false); m.roughness = 1; }
    }
    m.name = name;
    out[name] = m;
  }));
  return out;
}

/**
 * Terrain: blends grass / dry ground / rock / road / camp by a per-vertex `splat` attribute (vec4 + camp in a float).
 * Uses world-space UVs so the 420 m terrain tiles cleanly. Falls back to flat colours when maps are missing.
 */
export function terrainMaterial(THREE, mats) {
  const layers = ['terrain_grass', 'terrain_dry', 'terrain_rock', 'road', 'camp_ground'];
  const m = new THREE.MeshStandardMaterial({ roughness: .95, metalness: 0, vertexColors: false });
  const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); blank.needsUpdate = true;
  const uniforms = {};
  layers.forEach((n, i) => {
    uniforms['uTex' + i] = { value: mats[n].map || blank };
    uniforms['uCol' + i] = { value: mats[n].map ? new THREE.Color(0xffffff) : mats[n].color.clone() };
  });
  uniforms.uScale = { value: new THREE.Vector4(1 / 4, 1 / 5, 1 / 6, 1 / 3) }; // metres per tile (inverse)
  uniforms.uCampScale = { value: 1 / 4 };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nattribute float campW;\nvarying vec4 vSplat;\nvarying float vCamp;\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vCamp = campW; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const decl = layers.map((_, i) => `uniform sampler2D uTex${i}; uniform vec3 uCol${i};`).join('\n');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${decl}\nuniform vec4 uScale; uniform float uCampScale;\nvarying vec4 vSplat;\nvarying float vCamp;\nvarying vec3 vWPos;`)
      .replace('#include <map_fragment>', `
        vec2 wp = vWPos.xz;
        // two scales of the grass layer hide tiling at a glance
        vec3 g = texture2D(uTex0, wp * uScale.x).rgb * uCol0 * mix(.85, 1.1, texture2D(uTex0, wp * uScale.x * .13).g);
        vec3 d = texture2D(uTex1, wp * uScale.y).rgb * uCol1;
        vec3 r = texture2D(uTex2, wp * uScale.z).rgb * uCol2;
        vec3 rd = texture2D(uTex3, wp * uScale.w).rgb * uCol3;
        vec3 c = texture2D(uTex4, wp * uCampScale).rgb * uCol4;
        vec4 w = max(vSplat, 0.0); float sum = w.x + w.y + w.z + w.w + 1e-4;
        vec3 col = (g * w.x + d * w.y + r * w.z + rd * w.w) / sum;
        col = mix(col, c, clamp(vCamp, 0.0, 1.0));
        diffuseColor.rgb *= col;`);
  };
  m.customProgramCacheKey = () => 'terrain-splat-v1';
  return m;
}
