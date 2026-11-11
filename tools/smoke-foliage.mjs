// Trees and shrubs are made of leaf cards; budget stays sane.
export default async function ({ G, check }) {
  const found = {};
  G.scene.traverse(o => { if (o.isInstancedMesh && o.name) found[o.name] = (found[o.name] || 0) + o.count; });
  check(`oak canopies, pine canopies and shrubs exist (${JSON.stringify(found)})`, found['oak-canopy'] > 20 && found['pine-canopy'] > 20 && found['shrubs'] > 200);
}
