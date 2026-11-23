import * as THREE from 'three';
import { kitFor, poseMatrices, soldierMatrices } from './models.js';

const ROLES = { guerreiro: 'lusitanos', fundeiro: 'lusitanos', legionario: 'romanos', velite: 'romanos' };

// Positions are drawn around the existing group centre. Keep Roman ranks aligned and vary Lusitanian spacing.
export function hybridSlots(n, group, marching) {
  const roman = group.side === 'romanos';
  const columns = marching && roman ? 2 : Math.ceil(Math.sqrt(n * (roman ? 2 : 1.5)));
  const rows = Math.ceil(n / columns), fx = Math.cos(group.facing ?? 0), fy = Math.sin(group.facing ?? 0);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / columns), column = i % columns;
    const inRow = Math.min(columns, n - row * columns);
    const across = (column - (inRow - 1) / 2) * 1.24 + (roman ? 0 : Math.sin(i * 4.7 + 1) * 0.19);
    const back = (row - (rows - 1) / 2) * (marching ? 1.55 : 1.36) + (roman ? 0 : Math.cos(i * 2.6) * 0.24);
    return { x: group.x - fy * across - fx * back, y: group.y + fx * across - fy * back };
  });
}

export function hybridAction(group, moving) {
  if (group.state === 'debandada') return 'rout';
  if (group.hidden) return 'idle';
  if (group.order?.type === 'retirar') return 'withdraw';
  if (group.chargeT > 0) return 'charge';
  if (group.engaged) return 'melee';
  return moving || group.order?.type === 'mover' ? 'march' : 'idle';
}

// Separation is applied to temporary render positions. It never displaces a simulation group or its visual slots.
function separate(figures) {
  for (let i = 0; i < figures.length; i++) {
    const a = figures[i];
    for (let j = i + 1; j < figures.length; j++) {
      const b = figures[j];
      if (a.group === b.group || (!a.engaged && !b.engaged)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= 0.76) continue;
      const offset = (0.76 - d) * 0.5;
      a.dx -= offset * (d ? dx / d : 1); b.dx += offset * (d ? dx / d : 1);
      a.dz -= offset * (d ? dz / d : 0); b.dz += offset * (d ? dz / d : 0);
    }
  }
}

// Based on createC in FreeBuff's styles.js (1afd725): a batch per role and kit part, animated with matrices.
export function createHybridTroops({ heightAt, capacity }) {
  const root = new THREE.Group(), batches = new Map(), ghosts = [];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true });
  const tint = new THREE.Color(), matrices = soldierMatrices();
  let count = 0;
  for (const [role, faction] of Object.entries(ROLES)) {
    const parts = Object.entries(kitFor(faction, role).parts).map(([name, geo]) => {
      const mesh = new THREE.InstancedMesh(geo, material, capacity * 3);
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, tint.setRGB(1, 1, 1));
      root.add(mesh);
      return [name, mesh];
    });
    const torso = parts.find(([name]) => name === 'torso')[1];
    const outline = new THREE.InstancedMesh(torso.geometry, new THREE.MeshBasicMaterial({
      color: faction === 'romanos' ? '#ff8f80' : '#fff1c9', transparent: true, opacity: 0.36, depthWrite: false, depthFunc: THREE.GreaterDepth,
    }), capacity);
    outline.instanceMatrix = torso.instanceMatrix;
    outline.count = 0;
    outline.frustumCulled = false;
    outline.renderOrder = 15;
    root.add(outline);
    ghosts.push(outline);
    batches.set(role, { parts, outline, live: 0, dead: 0 });
  }

  function draw(figure, time, batch) {
    const dead = figure.fall !== undefined;
    if (dead ? batch.dead >= capacity * 2 : batch.live >= capacity) return;
    const index = dead ? batch.live + batch.dead++ : batch.live++;
    poseMatrices(figure, matrices, time, figure.action);
    const shade = dead ? 0.54 : figure.hidden ? 0.62 : 1;
    const flash = figure.flash || 0;
    tint.setRGB(shade + flash * 0.9, shade + flash * 0.42, shade + flash * 0.32);
    for (const [name, mesh] of batch.parts) {
      mesh.setMatrixAt(index, matrices[name]);
      mesh.setColorAt(index, tint);
    }
  }

  function sync(groups, visuals, corpses, time) {
    const figures = [];
    for (const g of groups) {
      if (g.left != null) continue;
      for (const s of visuals.get(g.id).soldiers) {
        if (!s.alive) continue;
        figures.push({ group: g.id, role: g.role, x: s.x, z: s.y, yaw: s.yaw, phase: s.phase,
          flash: s.flash, action: hybridAction(g, s.moving), engaged: g.engaged, hidden: g.hidden, dx: 0, dz: 0 });
      }
    }
    if (figures.some(s => s.engaged)) separate(figures);
    for (const batch of batches.values()) batch.live = batch.dead = 0;
    for (const s of figures) {
      s.x += Math.max(-0.43, Math.min(0.43, s.dx));
      s.z += Math.max(-0.43, Math.min(0.43, s.dz));
      s.y = heightAt(s.x, s.z);
      draw(s, time, batches.get(s.role));
    }
    for (const c of corpses) draw({ role: c.role, x: c.x, z: c.y, y: heightAt(c.x, c.y) + 0.11,
      yaw: c.yaw, phase: 0, fall: c.t, action: 'idle' }, time, batches.get(c.role));
    count = 0;
    for (const { parts, outline, live, dead } of batches.values()) {
      count += live;
      outline.count = live;
      for (const [, mesh] of parts) {
        mesh.count = live + dead;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  return { root, sync, slots: hybridSlots, get count() { return count; },
    closeView(close) { for (const ghost of ghosts) ghost.visible = !close; },
    dispose() {
      root.removeFromParent();
      for (const child of root.children) child.dispose();
      for (const ghost of ghosts) ghost.material.dispose();
      material.dispose();
    },
  };
}
