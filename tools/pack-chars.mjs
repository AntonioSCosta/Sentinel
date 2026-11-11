// Wraps each character .bin (binary glTF) as an ES module exporting base64, because the artifact host serves no other binaries.
import fs from 'fs';
const D = new URL('../assets/chars/', import.meta.url).pathname;
for (const f of fs.readdirSync(D).filter(f => f.endsWith('.bin')))
  fs.writeFileSync(D + f.replace('.bin', '.glb.js'), 'export default "' + fs.readFileSync(D + f).toString('base64') + '";\n');
