// Task 8: model detail budget.
export default async function ({ G, check }) {
  const tris = obj => {
    let n = 0;
    obj.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry, t = (g.index ? g.index.count : g.attributes.position.count) / 3;
      n += t * (o.isInstancedMesh ? o.count : 1);
    });
    return n;
  };
  G.setQuality('high');
  const per = {};
  for (const e of G.enemies) per[e.kind] = tris(e.m.root);
  for (const [k, n] of Object.entries(per)) check(`${k} model has 1500-6000 triangles (${Math.round(n)})`, n >= 1500 && n <= 6000);
  const total = tris(G.scene);
  check(`scene under 700k triangles on Alta, batched per 50 m square so only those near and in view are drawn (${Math.round(total)})`, total < 700000);
}
