// Copies three.js and the add-ons this game imports out of node_modules into vendor/three/,
// so index.html needs no CDN: a blocked or failing jsdelivr would otherwise leave a black screen.
// ES modules are copied as they are, keeping their folder structure and their relative imports,
// so every `import ... from 'three'` and `three/addons/...` in src/ stays exactly as written.
// Run it again after upgrading three: node tools/vendor-three.mjs
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
console.log([...seen].sort().join('\n'));
