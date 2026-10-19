import * as THREE from 'three';
import { Recoil, recoilProps } from '../core/recoil.js';
import { evalCurve } from '../core/curve.js';
import { GUNS, gun, settings, save } from './config.js';

const DEG = Math.PI / 180;
const _e = new THREE.Euler();

export const capacity = (w) => (settings.mode === 'legacy' && w.legacyMag ? w.legacyMag : w.mag);

// Caminho do padrão legado para o painel: mesmo loop por frame do jogo, sem compensar.
const cache = {};
export function legacyPath(w) {
  const rp = recoilProps(w, 'legacy');
  if (!rp.useCurves) return null;
  const cap = capacity(w), key = w.id + cap;
  if (cache[key]) return cache[key];
  const out = [], dt = 1 / 240;
  let p = 0, y = 0, shots = 0, next = 0;
  for (let t = 0; shots < cap; t += dt) {
    if (t >= next - 1e-9) { out.push([y, -p]); shots++; next += w.repeatDelay; }
    const k = Math.min(1, shots / cap);
    const tp = rp.recoilPitchMax * evalCurve(rp.pitchCurve, k), ty = rp.recoilYawMax * evalCurve(rp.yawCurve, k);
    const dp = tp - p, dy = ty - y, len = Math.hypot(dp, dy), max = dt * 20;
    if (len <= max) { p = tp; y = ty; } else { p += (dp / len) * max; y += (dy / len) * max; }
  }
  return (cache[key] = out);
}

export class Weapons {
  constructor({ player, ballistics, vm, audio, hud, camera, light }) {
    Object.assign(this, { player, ballistics, vm, audio, hud, camera, light });
    this.recoil = new Recoil(player.aim);
    this.state = {};
    for (const w of GUNS) this.state[w.id] = { ammo: 0, shots: 0, lastShot: -1e9, stance: 0, penalty: 0, yawAcc: 0, capacity: 0 };
    this.resetAmmo();
    this.nextFire = 0;
    this.reload = null;
    this.deployT = 0;
    this.aiming = false;
    this.adsLatched = false;
    this.select(settings.weapon in this.state ? settings.weapon : 'rifle.ak');
  }

  resetAmmo() {
    for (const w of GUNS) {
      const s = this.state[w.id];
      s.capacity = s.ammo = capacity(w);
      s.shots = 0;
    }
  }

  select(id) {
    if (this.w?.id === id) return;
    this.recoil.finalize();
    this.w = gun(id);
    this.g = this.state[id];
    this.reload = null;
    this.deployT = 0;
    this.adsLatched = false;
    this.vm.show(this.w);
    this.hud.weapon(this.w, this.g);
    this.hud.pattern(this.w, legacyPath(this.w));
    settings.weapon = id;
    save();
  }

  cycle(dir) {
    const i = GUNS.findIndex((g) => g.id === this.w.id);
    this.select(GUNS[(i + dir + GUNS.length) % GUNS.length].id);
  }

  setMode(mode) {
    settings.mode = mode;
    save();
    this.recoil.finalize();
    this.recoil.kicks.length = 0;
    this.resetAmmo();
    this.reload = null;
    this.hud.mode(mode);
    this.hud.weapon(this.w, this.g);
    this.hud.pattern(this.w, legacyPath(this.w));
  }

  update(dt, now, inp) {
    const { w, g, player: p } = this;
    this.deployT += dt;
    const deployed = this.deployT >= w.deployDelay;

    if (settings.adsToggle) { if (inp.rightPressed) this.adsLatched = !this.adsLatched; } else this.adsLatched = p.mouse.right;
    this.aiming = this.adsLatched && !this.reload && !p.sprinting;

    if (this.reload) {
      this.reload.t += dt;
      if (this.reload.t >= this.reload.dur) { g.ammo = g.capacity; this.reload = null; this.hud.weapon(w, g); }
    }
    if (inp.pressed.has('KeyR') && !this.reload && g.ammo < g.capacity && deployed) {
      this.reload = { t: 0, dur: w.reloadTime };
      if (!this.vm.reloadStart?.()) this.audio.reload(w.reloadTime);
    }

    const rp = recoilProps(w, settings.mode);
    this.recoil.frame(dt, now, w, g, rp, { ducked: p.ducked, speed: p.speed });

    const trigger = w.automatic ? p.mouse.left : inp.leftPressed;
    if (trigger && deployed && !this.reload && !p.sprinting && now >= this.nextFire) {
      if (g.ammo > 0) this.fire(now, rp);
      else if (inp.leftPressed && !this.vm.dry?.()) this.audio.click();
    }

    this.light.intensity = Math.max(0, this.light.intensity - dt * 400);
    this.hud.reload(this.reload ? this.reload.t / this.reload.dur : null);
    this.hud.ads(this.aiming);
  }

  fire(now, rp) {
    const { w, g, player: p } = this;
    const { body, recoil } = p.aim;
    const pitch = body.pitch + recoil.pitch, yaw = body.yaw + recoil.yaw;
    if (g.shots === 0) {
      this.start = { pitch, yaw };
      this.hud.trainerReset();
      this.ballistics.fx.fadeWall();
    }
    this.hud.trainerShot(yaw - this.start.yaw, -(pitch - this.start.pitch));

    const cone = this.recoil.cone(w, g, rp, this.aiming);
    const off = this.recoil.spread(w, rp, cone);
    this.recoil.shot(w, g, rp, { aiming: this.aiming, ducked: p.ducked, moveFrac: Math.min(1, p.speed / 5.5) });

    const dir = new THREE.Vector3(0, 0, -1).applyEuler(_e.set(-(pitch + off.pitch) * DEG, -(yaw + off.yaw) * DEG, 0, 'YXZ'));
    this.ballistics.fire(this.camera.position, dir, w);

    g.shots++;
    g.lastShot = now;
    g.ammo--;
    this.nextFire = now - this.nextFire < w.repeatDelay ? this.nextFire + w.repeatDelay : now + w.repeatDelay;
    this.audio.shot(w);
    this.vm.shot(w.model === 'm249' ? 0.7 : 1);
    this.light.position.copy(this.camera.position).addScaledVector(dir, 1.2);
    this.light.intensity = 18;
    this.hud.weapon(w, g);
  }
}
