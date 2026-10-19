// Sons sintetizados com WebAudio (nenhum áudio do jogo).
export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
  }

  start() {
    if (this.ctx) return this.ctx.resume();
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // Reverb: impulso de ruído com decaimento (eco de campo aberto)
    const len = ctx.sampleRate * 1.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < ctx.sampleRate * 0.03 ? 0.2 : 1);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    const nl = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  out(gain, verb = 0.6, when = 0) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.connect(this.master);
    if (verb) {
      const v = this.ctx.createGain();
      v.gain.value = verb;
      g.connect(v).connect(this.verb);
    }
    return [g, this.ctx.currentTime + when];
  }

  burst(dest, t, dur, type, freq, q = 0.7, gain = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(gain, t);
    e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(e).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, f0, f1, gain, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const e = this.ctx.createGain();
    e.gain.setValueAtTime(gain, t);
    e.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(e).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(w) {
    if (!this.ctx) return;
    const info = this.manifest?.weapons[w.id];
    if (this.rust?.has(info, 'attack')) return this.rust.effect(info, 'attack');
    const { tone, body, gain } = w.snd;
    const [d, t] = this.out(0.55 * gain, 0.9);
    this.burst(d, t, 0.02, 'highpass', 2500 * tone, 0.5, 1.2); // estalo
    this.burst(d, t, 0.16 * body + 0.05, 'lowpass', 2600 * tone, 0.8, 1); // corpo
    this.burst(d, t, 0.35 * body, 'lowpass', 420 * tone, 1, 0.6); // cauda
    this.tone(d, t, 0.09 * body + 0.03, 150 * tone, 45, 0.9 * body); // soco
  }

  impact(kind, dist, head = false) {
    if (!this.ctx) return;
    const when = dist / 343; // velocidade do som
    const fall = Math.min(1, 12 / Math.max(dist, 6));
    if (this.rust?.env(`impact_${kind}`, fall, when)) {
      if (head) this.tone(this.out(0.35, 0)[0], this.ctx.currentTime, 0.25, 2400, 2350, 0.5, 'triangle');
      return;
    }
    const [d, t] = this.out(fall, 0.4, when);
    if (kind === 'metal') {
      this.tone(d, t, 0.5, 1900 + Math.random() * 300, 1800, 0.5);
      this.tone(d, t, 0.35, 3100 + Math.random() * 400, 3000, 0.25);
      this.burst(d, t, 0.03, 'highpass', 4000, 0.5, 0.6);
    } else if (kind === 'wood') {
      this.burst(d, t, 0.08, 'bandpass', 900, 1.5, 1.2);
    } else if (kind === 'flesh') {
      this.burst(d, t, 0.07, 'lowpass', 700, 1, 1.4);
    } else {
      this.burst(d, t, 0.1, 'lowpass', 500, 0.7, 0.8);
    }
    if (head) this.tone(this.out(0.35, 0)[0], this.ctx.currentTime, 0.25, 2400, 2350, 0.5, 'triangle');
  }

  hitmarker() {
    if (!this.ctx || this.rust?.env('hitmarker', 0.8)) return;
    const [d, t] = this.out(0.18, 0);
    this.burst(d, t, 0.03, 'bandpass', 3000, 3, 1);
  }

  click(when = 0, f = 2200, g = 0.25) {
    if (!this.ctx) return;
    const [d, t] = this.out(g, 0.1, when);
    this.burst(d, t, 0.025, 'bandpass', f, 4, 1);
    this.tone(d, t, 0.03, f * 0.6, f * 0.5, 0.3, 'square');
  }

  reload(dur) {
    this.click(dur * 0.18, 1400, 0.3);
    this.click(dur * 0.62, 1800, 0.3);
    this.click(dur * 0.88, 2600, 0.35);
  }
}
