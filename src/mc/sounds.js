// Sons reais do Minecraft (exportados por tools/extract/export_mc.py para mc-assets/, só local).
// Volume e pitch como no código do jogo; atenuação linear até attenuation_distance × max(1, volume)
// (padrão 16 blocos), igual ao SoundEngine. Pan estéreo pela direção da fonte.
export const MC_BASE = 'mc-assets/';

const r = Math.random;
const voice = () => ({ volume: 1, pitch: (r() - r()) * 0.2 + 1 }); // LivingEntity.getVoicePitch
const PARAMS = {
  explode: () => ({ volume: 4, pitch: (1 + (r() - r()) * 0.2) * 0.7 }),
  explode_small: () => ({ volume: 1, pitch: (1 + (r() - r()) * 0.2) * 1.1 }),
  tnt_fuse: () => ({ volume: 1, pitch: 1 }),
  creeper_fuse: () => ({ volume: 1, pitch: 0.5 }),
  bow: () => ({ volume: 1, pitch: 1 / (r() * 0.4 + 0.8) }),
  arrow_hit: () => ({ volume: 1, pitch: 1.2 / (r() * 0.2 + 0.9) }),
  glass_break: () => ({ volume: 1, pitch: 0.8 }), // (SoundType.volume + 1) / 2, pitch × 0.8
  chest_open: () => ({ volume: 0.5, pitch: r() * 0.1 + 0.9 }),
  chest_close: () => ({ volume: 0.5, pitch: r() * 0.1 + 0.9 }),
  pop: () => ({ volume: 0.2, pitch: ((r() - r()) * 0.7 + 1) * 2 }),
};
const step = () => ({ volume: 0.15, pitch: 1 });
const place = () => ({ volume: 1, pitch: 0.8 });

export async function loadMcManifest() {
  try {
    const res = await fetch(MC_BASE + 'manifest.json', { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export class McSounds {
  constructor(audio, manifest) {
    this.audio = audio;
    this.m = manifest;
    this.buf = {};
  }

  get(file) {
    const ctx = this.audio.ctx;
    this.buf[file] ??= fetch(MC_BASE + file).then((x) => x.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
    return this.buf[file];
  }

  preload() { for (const defs of Object.values(this.m.sounds)) for (const d of defs) this.get(d.file); }

  // dist em blocos; pan ∈ [−1, 1]. Devolve false se o som não existe (cai no sintetizado).
  play(name, dist = 0, pan = 0) {
    const defs = this.m.sounds[name];
    if (!defs?.length || !this.audio.ctx) return false;
    const total = defs.reduce((a, d) => a + d.weight, 0);
    let k = r() * total, d = defs[0];
    for (const x of defs) { if ((k -= x.weight) <= 0) { d = x; break; } }
    const p = (PARAMS[name] ?? (name.includes('_step') || name.startsWith('step_') ? step : name.startsWith('place_') ? place : voice))();
    const range = d.dist * Math.max(1, p.volume);
    if (dist >= range) return true;
    const gain = d.volume * Math.min(1, p.volume) * (1 - dist / range);
    this.get(d.file).then((b) => {
      if (!b) return;
      const ctx = this.audio.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), st = ctx.createStereoPanner();
      src.buffer = b;
      src.playbackRate.value = Math.max(0.5, Math.min(2, d.pitch * p.pitch)); // OpenAL limita o pitch a [0,5; 2]
      g.gain.value = gain;
      st.pan.value = pan;
      src.connect(g).connect(st).connect(this.audio.master);
      src.start();
    });
    return true;
  }
}
