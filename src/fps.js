// Rolling frame counter for the pause screen: tells the player whether the machine or the settings are the problem.
export const newFps = () => ({ t0: 0, n: 0 });

/** Call once per rendered frame with the clock in ms; returns the rate once a second, otherwise null. */
export function tickFps(s, now) {
  if (!s.t0) { s.t0 = now; s.n = 0; return null; }
  s.n++;
  const dt = now - s.t0;
  if (dt < 1000) return null;
  const fps = Math.round(s.n * 1000 / dt);
  s.t0 = now; s.n = 0;
  return fps;
}
