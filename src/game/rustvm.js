import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { evalCurve } from '../core/curve.js';
import { flashTexture } from './textures.js';

// Viewmodels reais do Rust, exportados localmente por tools/extract/export_assets.py.
// Só existem na máquina de quem tem o jogo (public/rust-assets/ fica fora do git e da Vercel).
export const BASE = 'rust-assets/';

export async function loadManifest() {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function f32(b64) {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

function buildClip(c) {
  const tracks = c.tracks.map((t) => {
    const times = t.n > 1 ? Float32Array.from({ length: t.n }, (_, i) => i / c.fps) : new Float32Array([0]);
    const T = t.type === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new T(`${t.node}.${t.type}`, times, f32(t.values));
  });
  return new THREE.AnimationClip(c.name, c.duration, tracks);
}

const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(0, 0, -1);
const IDENT = new THREE.Quaternion();

export class RustViewModel {
  constructor(manifest, sounds) {
    this.m = manifest;
    this.sounds = sounds;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xd6dfe6, 0x6b5f4b, 1.6));
    const d = new THREE.DirectionalLight(0xfff0d8, 2.4);
    d.position.set(-0.5, 1, 0.6);
    this.scene.add(d);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.loader = new GLTFLoader();
    this.cache = {};
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.s = { adsP: 0, ads: 0, aiming: false, bob: 0, lower: 0, swayX: 0, swayY: 0, punchT: 1, flashT: 0 };
  }

  has(id) { return !!this.m.weapons[id]; }

  load(id) {
    this.cache[id] ??= Promise.all([
      this.loader.loadAsync(`${BASE}vm/${id}.glb`),
      fetch(`${BASE}vm/${id}.anim.json`).then((r) => r.json()),
    ]).then(([gltf, anim]) => {
      const obj = gltf.scene;
      obj.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      const info = this.m.weapons[id];
      const name = (n) => (n ? obj.getObjectByName(n) : null);
      return {
        id, obj, info, mixer: new THREE.AnimationMixer(obj),
        clips: Object.fromEntries(anim.clips.map((c) => [c.name, buildClip(c)])),
        events: Object.fromEntries(anim.clips.map((c) => [c.name, c.events])),
        aim: name(info.IronSights?.aimPoint), target: name(info.IronSights?.targetPoint), muzzle: name(info.BaseViewModel?.MuzzlePoint),
      };
    });
    return this.cache[id];
  }

  preload() { for (const id of Object.keys(this.m.weapons)) this.load(id); }

  show(w) {
    this.want = w.id;
    this.load(w.id).then((v) => {
      if (this.want !== w.id) return;
      this.root.clear();
      this.cur = v;
      this.root.add(v.obj);
      (v.muzzle || v.obj).add(this.flash);
      this.action = null;
      this.play('deploy', true);
    });
  }

  clipName(...names) { return names.find((n) => this.cur?.clips[n]); }

  play(name, once, fade = 0.08) {
    const v = this.cur;
    if (!v || !name || !v.clips[name]) return;
    const a = v.mixer.clipAction(v.clips[name]);
    a.reset();
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = once;
    if (this.action && this.action !== a) {
      a.crossFadeFrom(this.action, fade, false);
    }
    a.play();
    this.action = a;
    this.actionName = name;
    this.once = once;
    this.evT = -1;
  }

  base() { return this.s.aiming ? this.clipName('idle_ADS', 'idle') : this.clipName('idle'); }

  shot() {
    if (!this.cur) return;
    // nomes variam por arma: fire-1..3, attack, attack-2, fire_ADS, attack-1_ADS...
    const names = Object.keys(this.cur.clips);
    const hip = names.filter((n) => /^(fire|attack)(-\d+)?$/.test(n));
    const ads = names.filter((n) => /^(fire|attack)(-\d+)?_ADS$/.test(n));
    const pick = (l) => l[(Math.random() * l.length) | 0];
    const name = this.s.aiming && ads.length ? pick(ads) : pick(hip);
    this.play(name, true, 0.03);
    this.s.punchT = 0;
    this.s.flashT = 0.05;
    this.flash.material.rotation = Math.random() * 6.28;
    const k = 0.12 + Math.random() * 0.08;
    this.flash.scale.set(k, k, k);
  }

  reloadStart() { this.play(this.clipName('reload'), true, 0.1); return true; }
  dry() { this.play(this.s.aiming ? this.clipName('dryfire_ADS', 'dryfire') : this.clipName('dryfire'), true, 0.05); return true; }

  // st: { aiming, sprint, speed, dx, dy }
  update(dt, st) {
    const v = this.cur, s = this.s;
    if (!v) return;
    const isp = v.info.IronSights || {};
    if (st.aiming !== s.aiming) {
      s.aiming = st.aiming;
      if (!this.once) this.play(this.base(), false, 0.15);
    }
    // estado: one-shot acabou -> volta para o idle
    if (this.once && this.action && this.action.time >= this.action.getClip().duration - 1e-3) this.play(this.base(), false, 0.15);
    if (!this.action) this.play(this.base(), false);
    v.mixer.update(dt);
    // eventos do clip (DoEffect -> sons de reload, deploy, etc.)
    if (this.once && this.action) {
      const t = this.action.time;
      for (const [et, fn, data] of v.events[this.actionName] || []) {
        if (fn === 'DoEffect' && et > this.evT && et <= t) this.sounds?.effect(v.info, data);
      }
      this.evT = t;
    }

    // IronSights: alinha aimPoint -> targetPoint com o eixo da câmera (intro/outro com as curvas do jogo)
    s.adsP = st.aiming ? Math.min(1, s.adsP + dt * (isp.introSpeed ?? 3)) : Math.max(0, s.adsP - dt * (isp.outroSpeed ?? 2));
    s.ads = st.aiming ? evalCurve(isp.introCurve ?? [[0, 0, 1, 1], [1, 1, 1, 1]], s.adsP) : 1 - evalCurve(isp.outroCurve ?? [[0, 0, 1, 1], [1, 1, 1, 1]], 1 - s.adsP);
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    this.root.updateMatrixWorld(true);
    if (v.aim && v.target && s.ads > 0) {
      v.aim.getWorldPosition(_a);
      v.target.getWorldPosition(_t);
      _q.setFromUnitVectors(_t.sub(_a).normalize(), _fwd);
      this.root.quaternion.slerpQuaternions(IDENT, _q, s.ads);
      this.root.position.copy(_a).applyQuaternion(this.root.quaternion).multiplyScalar(-s.ads);
    }

    // ViewmodelBob / Sway / Lower / Punch (parâmetros do prefab; fórmulas aproximadas)
    const bob = v.info.ViewmodelBob || {}, run = st.sprint;
    const spd = Math.min(1, st.speed / 5.5);
    s.bob += dt * (run ? bob.bobSpeedRun ?? 13 : bob.bobSpeedWalk ?? 9) * (st.speed > 0.2 ? 1 : 0);
    const amt = (run ? bob.bobAmountRun ?? 0.02 : bob.bobAmountWalk ?? 0.005) * spd * (1 - 0.85 * s.ads);
    s.lower += ((run && (v.info.ViewmodelLower?.lowerOnSprint ?? 1) ? 1 : 0) - s.lower) * Math.min(1, dt * 8);
    s.swayX += (-st.dx * 0.0004 - s.swayX) * Math.min(1, dt * 10);
    s.swayY += (-st.dy * 0.0004 - s.swayY) * Math.min(1, dt * 10);
    const p = v.info.ViewmodelPunch;
    let punch = 0;
    if (p && s.punchT < 1) {
      s.punchT = Math.min(1, s.punchT + dt / p.punchDuration);
      punch = evalCurve(p.punchScale, s.punchT) * p.punchMagnitude;
    }
    const pd = p?.punchDirection ?? [0, 0, -1];
    this.root.position.x += Math.sin(s.bob) * amt - s.lower * (bob.leftOffsetRun ?? 0.04) * 0.5 + pd[0] * punch;
    this.root.position.y += -Math.abs(Math.cos(s.bob)) * amt - s.lower * 0.05 + pd[1] * punch;
    this.root.position.z += -pd[2] * punch;
    this.root.rotateY(s.swayX * (1 - 0.7 * s.ads) + s.lower * 0.5);
    this.root.rotateX(s.swayY * (1 - 0.7 * s.ads) - s.lower * 0.3);

    this.camera.fov = 75 + (isp.fieldOfViewOffset ?? 0) * s.ads;
    this.camera.updateProjectionMatrix();
    s.flashT -= dt;
    this.flash.visible = s.flashT > 0 && s.ads < 0.5;
  }
}

// Sons das SoundDefinitions (camadas do tiro, reload, deploy...)
export class RustSounds {
  constructor(audio) {
    this.audio = audio;
    this.buf = {};
  }

  get(file) {
    const ctx = this.audio.ctx;
    if (!ctx) return null;
    this.buf[file] ??= fetch(BASE + file).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
    return this.buf[file];
  }

  preload(groups) {
    for (const defs of Object.values(groups || {})) for (const d of defs) for (const [f] of d.files) this.get(f);
  }

  async def(d, gain = 1, delay = 0) {
    const total = d.files.reduce((a, [, w]) => a + w, 0);
    let r = Math.random() * total, file = d.files[0]?.[0];
    for (const [f, w] of d.files) { if ((r -= w) <= 0) { file = f; break; } }
    const b = file && (await this.get(file));
    if (!b) return;
    const ctx = this.audio.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b;
    src.playbackRate.value = (d.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * (d.pitchVariation ?? 0));
    g.gain.value = (d.volume ?? 1) * (1 + (Math.random() * 2 - 1) * (d.volumeVariation ?? 0)) * gain;
    src.connect(g).connect(this.audio.master);
    src.start(ctx.currentTime + delay);
  }

  has(info, name) { return !!info?.sounds?.[name]?.length; }
  effect(info, name, gain = 1) { for (const d of info?.sounds?.[name] || []) this.def(d, gain); }

  // impactos, passos, hit marker (manifest.env)
  env(name, gain = 1, delay = 0) {
    const defs = this.audio.manifest?.env?.[name];
    if (!defs?.length) return false;
    for (const d of defs) this.def(d, gain, delay);
    return true;
  }
}
