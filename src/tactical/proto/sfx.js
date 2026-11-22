// Protótipo M1 — sons sintetizados com Web Audio (sem ficheiros). Provisórios: servem para avaliar o feedback, não são o som final.

/** Cria o sistema de som. Só arranca no primeiro gesto do jogador (`unlock`), como os browsers exigem. */
export function createSfx() {
  let ctx = null, master = null, noiseBuf = null, muted = false, drumT = 0;
  const lastAt = new Map();

  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.55; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      wind();
    } catch { ctx = null; }
  }

  /** Limita a repetição: no máximo uma vez a cada `gap` segundos por nome. */
  function throttle(name, gap) {
    if (!ctx) return false;
    const t = ctx.currentTime, prev = lastAt.get(name) ?? -1;
    if (t - prev < gap) return false;
    lastAt.set(name, t);
    return true;
  }

  function env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, peak = 0.4, a = 0.005, sweep = null } = {}) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain(); env(g, t, a, peak, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + a + dur + 0.05);
  }

  function tone(t, dur, { type = 'sine', freq = 440, to = null, peak = 0.3, a = 0.01, lp = null, detune = 0 } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + dur);
    const g = ctx.createGain(); env(g, t, a, peak, dur);
    let node = o.connect(g);
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node = g.connect(f); }
    node.connect(master);
    o.start(t); o.stop(t + a + dur + 0.05);
  }

  function wind() {   // vento de fundo, muito baixo, para o silêncio antes do sinal ter textura
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 0.25;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.05;
    src.connect(f).connect(g).connect(master); src.start();
  }

  const play = {
    /** Corneta lusitana: o sinal. */
    signal() {
      if (!ctx) return; const t = ctx.currentTime;
      for (const [f, d] of [[110, 0], [110 * 1.5, 6], [220, -5]]) tone(t, 1.5, { type: 'sawtooth', freq: f * 0.94, to: f, peak: 0.16, a: 0.18, lp: 1100, detune: d });
      noise(t, 0.9, { type: 'lowpass', freq: 300, peak: 0.25, a: 0.25 });   // o grito do bando
    },
    /** Corneta romana curta: fomos vistos. */
    alarm() {
      if (!throttle('alarm', 1.5)) return; const t = ctx.currentTime;
      tone(t, 0.22, { type: 'square', freq: 330, peak: 0.08, lp: 1800 });
      tone(t + 0.28, 0.35, { type: 'square', freq: 440, peak: 0.08, lp: 1800 });
    },
    /** Choque de armas. */
    clash() {
      if (!throttle('clash', 0.07)) return; const t = ctx.currentTime;
      noise(t, 0.08, { freq: 2600 + Math.random() * 1500, q: 2, peak: 0.22 });
      tone(t, 0.18, { type: 'triangle', freq: 1400 + Math.random() * 900, peak: 0.05 });
    },
    /** Pedra de funda a passar. */
    sling() {
      if (!throttle('sling', 0.12)) return; const t = ctx.currentTime;
      noise(t, 0.12, { freq: 700, sweep: 2400, q: 3, peak: 0.12 });
    },
    /** Dardo dos vélites. */
    javelin() {
      if (!throttle('javelin', 0.15)) return; const t = ctx.currentTime;
      noise(t, 0.2, { freq: 1600, sweep: 500, q: 4, peak: 0.12 });
    },
    /** Um homem cai. `ours` muda o timbre: as nossas baixas soam mais pesadas. */
    death(ours) {
      if (!throttle('death', 0.06)) return; const t = ctx.currentTime;
      noise(t, 0.18, { type: 'lowpass', freq: ours ? 260 : 420, peak: 0.35 });
      tone(t, 0.25, { freq: ours ? 62 : 85, to: ours ? 40 : 55, peak: ours ? 0.3 : 0.2 });
    },
    /** Carga: rugido do bando. */
    charge() {
      if (!throttle('charge', 0.5)) return; const t = ctx.currentTime;
      noise(t, 0.9, { type: 'lowpass', freq: 500, peak: 0.3, a: 0.15 });
      for (const f of [130, 165, 196]) tone(t, 0.7, { type: 'sawtooth', freq: f, to: f * 1.08, peak: 0.05, a: 0.12, lp: 800 });
    },
    /** Um grupo quebra: corneta descendente (boa notícia se forem romanos). */
    broken(ours) {
      if (!ctx) return; const t = ctx.currentTime;
      if (ours) tone(t, 0.9, { type: 'sine', freq: 98, to: 65, peak: 0.25 });
      else tone(t, 0.8, { type: 'sawtooth', freq: 392, to: 196, peak: 0.1, lp: 1400 });
    },
    /** Fim da batalha. */
    end(win) {
      if (!ctx) return; const t = ctx.currentTime;
      const chord = win ? [196, 247, 294, 392] : [147, 175, 220];
      chord.forEach((f, i) => tone(t + i * 0.08, 2.2, { type: 'sawtooth', freq: f, peak: 0.05, a: 0.3, lp: 1200 }));
    },
    /** Tambor de marcha romano: chamado a cada fotograma; toca de 0,75 em 0,75 s enquanto `marching`. */
    march(dt, marching, closeness) {
      if (!ctx || !marching) { drumT = 0; return; }
      drumT -= dt;
      if (drumT > 0) return;
      drumT = 0.75;
      const t = ctx.currentTime;
      tone(t, 0.18, { freq: 70, to: 48, peak: 0.08 + 0.18 * closeness });
      noise(t, 0.06, { type: 'lowpass', freq: 180, peak: 0.05 + 0.1 * closeness });
    },
  };

  return {
    unlock, play,
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.55; },
  };
}
