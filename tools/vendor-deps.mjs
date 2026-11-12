// Copies everything the game loads at runtime out of node_modules into vendor/, so the game
// needs no network at all: three.js and its add-ons, the Rapier physics engine, and the two
// webfonts. A blocked CDN would otherwise cost a black screen (three), the real physics
// (Rapier) or the lettering (the fonts).
// Modules are copied as they are, keeping their folder structure and their relative imports,
// so every `import ... from 'three'` and `three/addons/...` in src/ stays exactly as written.
// Run it again after an upgrade: node tools/vendor-deps.mjs
import fs from 'fs';
import path from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = path.join(ROOT, 'node_modules/three');
const OUT = path.join(ROOT, 'vendor/three');
const VERSION = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8')).version;

// what src/ imports; their own imports are followed from here
const ENTRIES = [
  'loaders/GLTFLoader.js', 'utils/SkeletonUtils.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
  'postprocessing/OutputPass.js', 'postprocessing/SSAOPass.js', 'postprocessing/UnrealBloomPass.js',
];

const specifiers = code => [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);

const seen = new Set(), queue = [...ENTRIES];
while (queue.length) {
  const rel = queue.shift();
  if (seen.has(rel)) continue;
  seen.add(rel);
  const code = fs.readFileSync(path.join(SRC, 'examples/jsm', rel), 'utf8');
  for (const spec of specifiers(code)) {
    if (!spec.startsWith('.')) continue;                       // bare 'three' resolves via the import map
    queue.push(path.normalize(path.join(path.dirname(rel), spec)));
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'addons'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'build/three.module.js'), path.join(OUT, 'three.module.js'));
let bytes = fs.statSync(path.join(OUT, 'three.module.js')).size;
for (const rel of [...seen].sort()) {
  const dst = path.join(OUT, 'addons', rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'examples/jsm', rel), dst);
  bytes += fs.statSync(dst).size;
}
fs.writeFileSync(path.join(OUT, 'README.md'),
  `# vendor/three\n\nthree.js ${VERSION}, copied from node_modules by \`node tools/vendor-three.mjs\`.\nDo not edit by hand. three.js is MIT licensed (see assets/CREDITS.md).\n\n` +
  `${seen.size} add-on files, reached from: ${ENTRIES.join(', ')}.\n`);
console.log(`three ${VERSION}: three.module.js + ${seen.size} add-on files, ${(bytes / 1048576).toFixed(2)} MB`);

// --- Rapier: one self-contained ES module with the wasm inlined as base64, so nothing else to copy
const RSRC = path.join(ROOT, 'node_modules/@dimforge/rapier3d-compat');
const rver = JSON.parse(fs.readFileSync(path.join(RSRC, 'package.json'), 'utf8')).version;
fs.mkdirSync(path.join(ROOT, 'vendor/rapier'), { recursive: true });
fs.copyFileSync(path.join(RSRC, 'rapier.es.js'), path.join(ROOT, 'vendor/rapier/rapier.es.js'));
fs.copyFileSync(path.join(RSRC, 'LICENSE'), path.join(ROOT, 'vendor/rapier/LICENSE.txt'));   // .txt so it can be served with the game
console.log(`rapier ${rver}: rapier.es.js, ${(fs.statSync(path.join(ROOT, 'vendor/rapier/rapier.es.js')).size / 1048576).toFixed(2)} MB (wasm inlined)`);

// --- the two webfonts, with a stylesheet the page loads instead of Google's
const FONTS = [
  ['@fontsource/cinzel', 'Cinzel', [['500', 'normal'], ['700', 'normal']]],
  ['@fontsource/eb-garamond', 'EB Garamond', [['400', 'normal'], ['600', 'normal'], ['400', 'italic']]],
];
const SUBSETS = ['latin', 'latin-ext'];   // latin-ext carries the rest of the Portuguese accents
fs.rmSync(path.join(ROOT, 'vendor/fonts'), { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'vendor/fonts/files'), { recursive: true });
let css = '/* Written by tools/vendor-deps.mjs. The fonts are SIL Open Font License 1.1; see assets/CREDITS.md. */\n', nf = 0, fb = 0;
for (const [pkg, family, faces] of FONTS) {
  const dir = path.join(ROOT, 'node_modules', pkg, 'files'), slug = pkg.split('/')[1];
  for (const [weight, style] of faces) for (const subset of SUBSETS) {
    const name = `${slug}-${subset}-${weight}-${style}.woff2`;
    if (!fs.existsSync(path.join(dir, name))) continue;
    fs.copyFileSync(path.join(dir, name), path.join(ROOT, 'vendor/fonts/files', name));
    nf++; fb += fs.statSync(path.join(dir, name)).size;
    css += `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url('./files/${name}') format('woff2')}\n`;
  }
}
fs.writeFileSync(path.join(ROOT, 'vendor/fonts/fonts.css'), css);
console.log(`fonts: ${nf} woff2 files, ${(fb / 1024).toFixed(0)} KB`);
