import { clamp } from './terrain.js';
// Web Audio sound design, all synthesised (no samples): modal metal, formant voices, filtered noise for cloth, earth and wind,
// a generated valley reverb and a bus compressor. `listener` is any object with a `position` Vector3 (the camera).
let listener = { position: { distanceTo: () => 0 } };
export function setListener(o) { listener = o; }

let AC = null, bus = null, dry = null, wet = null, white = null, pink = null, birdsT = null;
const R = (a, b) => a + Math.random() * (b - a);

function makeNoise(kind) {
  const n = AC.sampleRate * 2, buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') { d[i] = w; continue; }
    b0 = .99765 * b0 + w * .099; b1 = .963 * b1 + w * .2965; b2 = .57 * b2 + w * 1.0527;   // pink (Paul Kellet, cheap)
    d[i] = (b0 + b1 + b2 + w * .1848) * .2;
  }
  return buf;
}
/** An outdoor reverb: decaying stereo noise, darker as it fades — a wide valley with trees, not a hall. */
function makeImpulse(seconds = 2.4) {
  const n = Math.floor(AC.sampleRate * seconds), ir = AC.createBuffer(2, n, AC.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) { const t = i / n, a = Math.pow(1 - t, 3.2) * (i < AC.sampleRate * .012 ? i / (AC.sampleRate * .012) : 1); lp += ((Math.random() * 2 - 1) - lp) * (.55 - t * .45); d[i] = lp * a; }
  }
  return ir;
}

export function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume().catch(() => {}); return; }
  try {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext; if (!Ctx) return;
    AC = new Ctx();
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = .004; comp.release.value = .22;
    const out = AC.createGain(); out.gain.value = .9; comp.connect(out).connect(AC.destination);
    bus = AC.createGain(); bus.gain.value = 1;
    dry = AC.createGain(); dry.gain.value = 1; bus.connect(dry).connect(comp);
    const verb = AC.createConvolver(); verb.buffer = makeImpulse(); wet = AC.createGain(); wet.gain.value = 1;
    const vg = AC.createGain(); vg.gain.value = .22; wet.connect(verb).connect(vg).connect(comp);
    white = makeNoise('white'); pink = makeNoise('pink');
    ambience();
  } catch (_) { AC = null; }
}

/* ---------- building blocks ---------- */
const now = () => AC.currentTime;
function env(g, t, a, peak, d, hold = 0) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), t + a); if (hold) g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(.0001, t + a + hold + d); }
/** route a node to the mix: dry plus a send to the valley reverb */
function out(node, send = .25) { node.connect(bus); if (send > 0) { const s = AC.createGain(); s.gain.value = send; node.connect(s).connect(wet); } }
function noiseSrc(buf = white, t = now(), dur = 1) { const s = AC.createBufferSource(); s.buffer = buf; s.start(t, Math.random() * 1.5); s.stop(t + dur + .05); return s; }
function filt(type, f, q = .7) { const b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

/** filtered noise burst with an optional sweep */
function hiss({ t = now(), dur = .2, type = 'bandpass', f = 1000, f2 = null, q = 1, vol = .3, a = .005, buf = white, send = .2 }) {
  const s = noiseSrc(buf, t, dur + a), b = filt(type, f, q), g = AC.createGain();
  if (f2) b.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
  env(g, t, a, vol, dur); s.connect(b).connect(g); out(g, send);
}
/** a body thump: a sine dropping in pitch */
function thump({ t = now(), f = 110, f2 = 45, dur = .18, vol = .5, send = .1 }) {
  const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, .004, vol, dur); o.connect(g); out(g, send); o.start(t); o.stop(t + dur + .05);
}
/** struck metal: inharmonic partials of a bar/blade, each decaying at its own rate */
function metal({ t = now(), f0 = R(600, 900), vol = .25, decay = .9, send = .45, bright = 1 }) {
  const ratios = [1, 2.32, 4.25, 6.63, 9.38, 12.4], g = AC.createGain(); g.gain.value = 1; out(g, send);
  ratios.forEach((r, i) => {
    const o = AC.createOscillator(), og = AC.createGain(); o.frequency.value = f0 * r * R(.995, 1.005);
    env(og, t, .002, vol * Math.pow(.62, i) * (i ? bright : 1), decay * Math.pow(.72, i)); o.connect(og).connect(g); o.start(t); o.stop(t + decay + .1);
  });
  hiss({ t, dur: .03, type: 'highpass', f: 3500, vol: vol * 1.3, send: .1 });   // the scrape of the edge
}
/** a voice: a buzzing glottal source shaped by vowel formants, with a pitch contour and a little breath */
const VOWELS = { a: [800, 1150, 2800], o: [500, 900, 2600], u: [350, 650, 2500], e: [550, 1800, 2600] };
function voice({ t = now(), p0 = 140, p1 = 90, dur = .35, vol = .2, vowel = 'a', breath = .25, shake = 0, send = .2, high = 1 }) {
  const o = AC.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(p0 * high, t); o.frequency.exponentialRampToValueAtTime(Math.max(40, p1 * high), t + dur);
  if (shake) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = R(6, 9); lg.gain.value = p0 * high * shake; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + .1); }
  const src = AC.createGain(); src.gain.value = 1; o.connect(src);
  const n = noiseSrc(pink, t, dur), ng = AC.createGain(); ng.gain.value = breath; n.connect(ng).connect(src);
  const g = AC.createGain(); env(g, t, .03, vol, dur);
  const fm = VOWELS[vowel].map(f => f * (high > 1.2 ? 1.18 : 1));
  fm.forEach((f, i) => { const b = filt('bandpass', f * R(.95, 1.05), [9, 11, 13][i]), bg = AC.createGain(); bg.gain.value = [1, .55, .22][i] * 3.2; src.connect(b).connect(bg).connect(g); });
  const lp = filt('lowpass', 3600); g.connect(lp); out(lp, send);
  o.start(t); o.stop(t + dur + .1);
}

/* ---------- ambience: wind in the trees, now and then a bird ---------- */
function ambience() {
  const s = AC.createBufferSource(); s.buffer = pink; s.loop = true;
  const b = filt('lowpass', 420, .5), g = AC.createGain(); g.gain.value = .04;
  const l1 = AC.createOscillator(), l1g = AC.createGain(); l1.frequency.value = .07; l1g.gain.value = .028; l1.connect(l1g).connect(g.gain); l1.start();
  const l2 = AC.createOscillator(), l2g = AC.createGain(); l2.frequency.value = .11; l2g.gain.value = 220; l2.connect(l2g).connect(b.frequency); l2.start();
  s.connect(b).connect(g); out(g, .05); s.start();
  // leaves: a thin high rustle riding the gusts
  const s2 = AC.createBufferSource(); s2.buffer = white; s2.loop = true; const b2 = filt('bandpass', 5200, .6), g2 = AC.createGain(); g2.gain.value = .006;
  const l3 = AC.createGain(); l3.gain.value = .006; l1.connect(l3).connect(g2.gain); s2.connect(b2).connect(g2); out(g2, .1); s2.start();
  const bird = () => {
    if (!AC) return; const t = now() + R(0, .3), base = R(2400, 4200), n = Math.floor(R(2, 6));
    for (let i = 0; i < n; i++) {
      const o = AC.createOscillator(), og = AC.createGain(), tt = t + i * R(.09, .16), f = base * R(.9, 1.15);
      o.frequency.setValueAtTime(f, tt); o.frequency.exponentialRampToValueAtTime(f * R(1.2, 1.6), tt + .04); o.frequency.exponentialRampToValueAtTime(f * R(.7, .9), tt + .08);
      env(og, tt, .006, R(.008, .02), .08); o.connect(og); out(og, .5); o.start(tt); o.stop(tt + .12);
    }
    birdsT = setTimeout(bird, R(2500, 9000));
  };
  birdsT = setTimeout(bird, 3000);
}

export function spatial(pos) { // distance attenuation
  const d = listener.position.distanceTo(pos); return clamp(1.4 / (1 + d * .08), 0, 1);
}

const ok = () => !!AC;
export const SFX = {
  // a blade cutting the air: a band of noise sweeping up then down
  swing: () => { if (!ok()) return; const t = now(); hiss({ t, dur: .26, f: R(450, 600), f2: R(1600, 2200), q: 2.2, vol: .34, a: .06, send: .08 }); hiss({ t: t + .05, dur: .14, type: 'lowpass', f: 700, vol: .08, send: 0 }); },
  // blade into a body: a deep thump, a wet slap and a muffled tear
  flesh: (v = 1) => { if (!ok()) return; const t = now(); thump({ t, f: 120, f2: 50, dur: .16, vol: .55 * v }); hiss({ t, dur: .07, f: 1700, q: .9, vol: .3 * v, send: .05 }); hiss({ t: t + .01, dur: .16, type: 'lowpass', f: 900, vol: .25 * v, buf: pink, send: .1 }); },
  // metal on metal: blade on blade, blade on a boss or helmet
  clank: (v = 1) => { if (!ok()) return; metal({ f0: R(520, 820), vol: .2 * v, decay: R(.7, 1.1) }); thump({ f: 160, f2: 90, dur: .08, vol: .2 * v }); },
  // javelin leaving the hand
  throwJ: () => { if (!ok()) return; const t = now(); hiss({ t, dur: .35, f: 380, f2: 1400, q: 2, vol: .22, a: .05, send: .1 }); hiss({ t, dur: .12, type: 'lowpass', f: 500, vol: .08, buf: pink, send: 0 }); },
  // sling: the whirl and the crack of the release
  sling: () => { if (!ok()) return; const t = now(); for (let i = 0; i < 3; i++) hiss({ t: t + i * .07, dur: .06, f: 900, q: 3, vol: .1, send: .02 }); hiss({ t: t + .22, dur: .05, type: 'highpass', f: 2500, vol: .25, send: .2 }); hiss({ t: t + .22, dur: .2, f: 1500, f2: 3200, q: 2, vol: .12, send: .1 }); },
  // a blow on wood and hide (shield), or a body hitting the ground
  thud: (v = 1) => { if (!ok()) return; const t = now(); thump({ t, f: 95, f2: 42, dur: .2, vol: .55 * v }); hiss({ t, dur: .09, f: 420, q: 1.4, vol: .3 * v, buf: pink, send: .15 }); hiss({ t, dur: .03, f: 2200, q: 1, vol: .12 * v, send: .05 }); },
  // no synthesised voices (they never sounded human): pain is the blow itself, effort is the body moving
  hurt: () => { if (!ok()) return; SFX.flesh(.8); hiss({ dur: .14, type: 'lowpass', f: 600, vol: .12, buf: pink, send: 0 }); },
  grunt: () => {},
  die: (v = 1) => { if (!ok()) return; SFX.thud(.6 * v); },
  // picking something up: leather, cloth, a knock of wood
  pick: () => { if (!ok()) return; const t = now(); hiss({ t, dur: .08, f: 2400, q: .8, vol: .12, send: 0 }); hiss({ t: t + .07, dur: .1, f: 1300, q: .8, vol: .1, send: 0 }); thump({ t: t + .05, f: 260, f2: 160, dur: .05, vol: .12 }); },
  // a footfall on earth and grass
  step: () => { if (!ok()) return; const t = now(); hiss({ t, dur: R(.05, .08), type: 'lowpass', f: R(500, 900), vol: R(.07, .1), buf: pink, send: 0 }); hiss({ t: t + .01, dur: .04, f: R(3000, 5000), q: .7, vol: .015, send: 0 }); },
  // the war horn: a deep bronze drone with a swell, vibrato and the valley answering
  horn: () => {
    if (!ok()) return; const t = now();
    const blast = (t0, f, dur) => {
      const g = AC.createGain(); env(g, t0, .28, .14, .7, dur); const lp = filt('lowpass', 700, 4); lp.frequency.setValueAtTime(380, t0); lp.frequency.linearRampToValueAtTime(950, t0 + .5);
      [1, 1.004, .5].forEach((m, i) => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * m * .97, t0); o.frequency.linearRampToValueAtTime(f * m, t0 + .2);
        const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = 5.2; lg.gain.value = f * .006; l.connect(lg).connect(o.frequency); l.start(t0); l.stop(t0 + dur + 1.1);
        const og = AC.createGain(); og.gain.value = i === 2 ? .5 : .6; o.connect(og).connect(lp); o.start(t0); o.stop(t0 + dur + 1.1); });
      lp.connect(g); out(g, .7); hiss({ t: t0, dur: dur + .4, type: 'bandpass', f: 1200, q: .6, vol: .02, a: .2, buf: pink, send: .3 });
    };
    blast(t, 98, 1.3); blast(t + 1.7, 110, 1.6);
  },
  // fire catching: a low roar with crackles
  fire: () => { if (!ok()) return; const t = now(); hiss({ t, dur: 1.4, type: 'lowpass', f: 380, vol: .35, a: .3, buf: pink, send: .2 }); for (let i = 0; i < 14; i++) hiss({ t: t + R(0, 1.4), dur: .015, type: 'highpass', f: R(2000, 5000), vol: R(.05, .15), send: .1 }); },
  // the legions as they charge: pila beaten on shields and the tramp of many feet, rolling round the valley
  warcry: (v = 1) => {
    if (!ok()) return; const t = now();
    for (let i = 0; i < 6; i++) for (let k = 0; k < 7; k++) { const tt = t + i * .42 + R(0, .06); thump({ t: tt, f: R(95, 130), f2: 50, dur: .16, vol: .09 * v, send: .5 }); hiss({ t: tt, dur: .06, f: R(500, 900), q: 1.2, vol: .05 * v, buf: pink, send: .5 }); }
    for (let i = 0; i < 40; i++) hiss({ t: t + R(0, 2.6), dur: .07, type: 'lowpass', f: R(400, 800), vol: R(.02, .05) * v, buf: pink, send: .3 });
  },
  // a javelin passing close
  jav: (v = 1) => { if (!ok()) return; hiss({ dur: .25, f: 700, f2: 2600, q: 3, vol: .2 * v, a: .08, send: .1 }); },
};
