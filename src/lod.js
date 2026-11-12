// How often a character's skeleton is recalculated. Posing a rig runs an AnimationMixer with three
// layers and rebuilds the bone matrices: worth doing 60 times a second for the man in front of you,
// not for a shape in the mist, and never for a body that has finished falling.
export const DEAD_SETTLE = 2.5;
const NEAR = 25, MID = 60;

/** Frames between poses, by distance to the camera. */
export const poseEvery = dist => (dist < NEAR ? 1 : dist < MID ? 2 : 4);

/** @param e { dist, frame, id, dead, deadT } — id spreads the far ones over different frames */
export function shouldPose({ dist, frame, id = 0, dead = false, deadT = 0 }) {
  if (dead && deadT > DEAD_SETTLE) return false;
  const every = poseEvery(dist);
  return every === 1 || (frame + id) % every === 0;
}
