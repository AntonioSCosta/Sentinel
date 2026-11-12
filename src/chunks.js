// Distance culling for the 50 m scenery blocks (trees, shrubs, rocks, ferns).
// The mist hides everything past ~150 m, and the sun's shadow camera is 92 m wide,
// so a block outside those ranges costs draw calls for nothing.
export const DRAW_DIST = 150;
export const SHADOW_DIST = 62;

/**
 * @param chunks meshes carrying __c = { x, z, r }: the block's centre and radius
 * @param cam    { x, z } of the camera (the sun follows the player, so one distance serves both)
 */
export function cullChunks(chunks, cam) {
  for (const m of chunks) {
    const c = m.__c, d = Math.hypot(c.x - cam.x, c.z - cam.z) - c.r;
    m.visible = d < DRAW_DIST;
    m.castShadow = m.visible && d < SHADOW_DIST;
  }
}

export const CHAR_SHADOW_DIST = 42;
const TINY = /eyes|eyebrow|^face-|feather|cheek|crest|lash|teeth|tongue/i;

/** A part worth a shadow draw call: a body, a garment, a weapon or a shield, never an eyelash. */
export const bigEnoughForShadow = name => !TINY.test(name || '');

/** @param list entities with pos and m.cast (the parts collected by makeRig) */
export function cullCharacters(list, cam) {
  for (const e of list) {
    const parts = e && e.m && e.m.cast; if (!parts) continue;
    const on = Math.hypot(e.pos.x - cam.x, e.pos.z - cam.z) < CHAR_SHADOW_DIST;
    for (const p of parts) p.castShadow = on;
  }
}
