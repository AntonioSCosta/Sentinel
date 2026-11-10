import { clamp } from './terrain.js';
// Small Web Audio synth. `listener` is any object with a `position` Vector3 (the camera).
let listener = { position: { distanceTo: () => 0 } };
export function setListener(o) { listener = o; }
/* =========================================================
   Audio (small synth)
   ========================================================= */
let AC = null, master = null, noiseBuf = null;
export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => {}); return; }
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctx) return;
    AC = new Ctx();
    master = AC.createGain(); master.gain.value = .55; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // ambient wind
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = AC.createGain(); g.gain.value = .045;
    const lfo = AC.createOscillator(); lfo.frequency.value = .08; const lg = AC.createGain(); lg.gain.value = .025; lfo.connect(lg).connect(g.gain); lfo.start();
    src.connect(f).connect(g).connect(master); src.start();
  } catch (_) { AC = null; }
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  if (!AC) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + .02);
}
function noise(dur, freq, q, vol, sweepTo, type = 'bandpass', delay = 0) {
  if (!AC) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + .02);
}
export function spatial(pos) { // crude distance attenuation
  const d = listener.position.distanceTo(pos); return clamp(1.4 / (1 + d * .08), 0, 1);
}
export const SFX = {
  swing: () => noise(.22, 900, 1.2, .35, 2600),
  flesh: (v = 1) => { noise(.12, 500, 1, .5 * v); tone('sine', 160, 70, .12, .35 * v); },
  clank: (v = 1) => { tone('square', 1900, 1300, .16, .12 * v); tone('triangle', 2700, 2200, .25, .1 * v); noise(.08, 4000, 2, .25 * v); },
  throwJ: () => noise(.35, 600, 1.5, .4, 2200),
  sling: () => { tone('sine', 300, 700, .25, .12); noise(.18, 1800, 2, .25, 3000, 'bandpass', .18); },
  thud: (v = 1) => { noise(.12, 260, 1, .5 * v); },
  hurt: () => { tone('sawtooth', 210, 95, .25, .22); noise(.15, 700, 1, .2); },
  grunt: (v = 1) => tone('sawtooth', 150 + Math.random() * 40, 70, .3, .2 * v),
  die: (v = 1) => { tone('sawtooth', 170, 55, .6, .22 * v); },
  pick: () => { tone('sine', 620, 940, .14, .18); tone('sine', 940, 1240, .12, .12, .08); },
  step: () => noise(.06, 240, .8, .07, null, 'lowpass'),
  horn: () => { tone('sawtooth', 196, 190, 1.6, .16); tone('sawtooth', 294, 288, 1.6, .08, .05); tone('sawtooth', 196, 186, 1.2, .14, 1.7); },
  fire: () => { noise(1.2, 300, .7, .45, 120, 'lowpass'); noise(.6, 1500, 1, .2, 600); },
  jav: (v = 1) => noise(.25, 900, 1.4, .3 * v, 2500),
};

