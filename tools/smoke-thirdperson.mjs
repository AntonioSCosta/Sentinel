// Third-person view: Viriato is visible, the camera sits behind his shoulder; V toggles first person.
export default async function ({ G, THREE, st, key, check, forcePlay }) {
  G.start(1); forcePlay(); st(5);
  const av = G.avatar;
  check('third person is the default and Viriato is visible', G.view === 'third' && av.root.visible);
  const eye = new THREE.Vector3(G.P.pos.x, G.P.pos.y + 1.6, G.P.pos.z), d = G.camera.position.distanceTo(eye);
  const fwd = new THREE.Vector3(-Math.sin(G.P.yaw), 0, -Math.cos(G.P.yaw));
  const behind = new THREE.Vector3().subVectors(G.camera.position, eye).dot(fwd) < 0;
  check(`camera behind the shoulder (${d.toFixed(2)} m)`, d > 1.8 && d < 4 && behind);
  const names = new Set(); av.root.traverse(o => o.name && names.add(o.name));
  check('Viriato carries a falcata and a caetra', names.has('falcata') && names.has('caetra'));
  key('KeyV'); key('KeyV', false); st(3);
  check('V switches to first person (weapons in view, body hidden)', G.view === 'first' && !av.root.visible && G.vm.fal.parent.visible !== false);
  key('KeyV'); key('KeyV', false); st(3);
  check('V switches back to third person', G.view === 'third' && av.root.visible);
}
