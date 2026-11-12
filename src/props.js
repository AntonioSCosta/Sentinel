// Hand-built props. Kept out of game.js so their shape can be checked without a browser.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A Roman papilio: the eight-man ridge tent of goat leather. Two sloping panels over a ridge pole
 * between two uprights, gable ends, and guy ropes pegged out at the corners — the ropes are what
 * read as a tent from a distance, far more than the shape of the roof.
 * @returns BufferGeometry standing on y = 0, centred on the origin, facing +z.
 */
export function papilioGeo(THREE, { w = 3, l = 4, h = 2, rope = .9 } = {}) {
  const parts = [];
  const push = (g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) => {
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
    g.translate(x, y, z); parts.push(g);
  };
  const eave = h * .28;                       // the panels stop short of the ground: the walls are nearly vertical
  const slope = Math.hypot(w / 2, h - eave);
  const pitch = Math.atan2(w / 2, h - eave);
  for (const s of [-1, 1]) {                  // the two leather panels
    const p = new THREE.PlaneGeometry(slope, l);
    p.rotateX(-Math.PI / 2);                  // lay it flat, then tilt it up to the ridge
    push(p, { rz: s * pitch, x: s * w / 4, y: eave + (h - eave) / 2 });
  }
  for (const s of [-1, 1]) {                  // gable ends, as a triangle each
    const t = new THREE.BufferGeometry();
    t.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, eave, 0, w / 2, eave, 0, 0, h, 0], 3));
    t.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, .5, 1], 2));
    t.setIndex([0, 1, 2]); t.computeVertexNormals();
    push(t, { z: s * l / 2 });
  }
  for (const s of [-1, 1]) {                  // short side walls down to the ground
    const p = new THREE.PlaneGeometry(l, eave); p.rotateY(s * Math.PI / 2);
    push(p, { x: s * w / 2, y: eave / 2 });
  }
  const pole = () => new THREE.CylinderGeometry(.05, .05, h, 5);
  for (const s of [-1, 1]) push(pole(), { y: h / 2, z: s * l / 2 });
  const ridge = new THREE.CylinderGeometry(.045, .045, l + .3, 5); ridge.rotateX(Math.PI / 2);
  push(ridge, { y: h });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {   // four guy ropes from the ridge ends to the pegs
    const len = Math.hypot(rope, h * .9);
    const r = new THREE.CylinderGeometry(.012, .012, len, 4);
    r.rotateX(Math.atan2(rope, h * .9) * sz * -1);
    r.rotateZ(Math.atan2(sx * rope * .35, h));
    push(r, { x: sx * (w / 2) * .25, y: h / 2, z: sz * (l / 2 + rope / 2) });
  }
  // each part already carries the normals its own builder set; recomputing them after the merge
  // would only smooth across parts that should stay sharp
  return mergeGeometries(parts.map(p => p.toNonIndexed ? p.toNonIndexed() : p), false);
}
