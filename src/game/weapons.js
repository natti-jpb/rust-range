import * as THREE from 'three';
import { Recoil, recoilProps } from '../core/recoil.js';
import { evalCurve } from '../core/curve.js';
import { MODS } from '../data/weapons.js';
import { gun, settings, save } from './config.js';
import { kind, makeItem, ammoTypes, weaponStats } from './items.js';

const DEG = Math.PI / 180;
const _e = new THREE.Euler();

export const capacity = (w) => w.capacity ?? (settings.mode === 'legacy' && w.legacyMag ? w.legacyMag : w.mag);

// Caminho do padrão legado para o painel: mesmo loop por frame do jogo, sem compensar.
// Pente estendido e mods de recoil mudam o padrão (t = tiros/capacidade, alvo × média dos scalars).
const cache = {};
export function legacyPath(w) {
  const rp = recoilProps(w, 'legacy');
  if (!rp.useCurves) return null;
  const cap = capacity(w), k0 = w.recoilScale ?? 1, key = `${w.id}${cap}:${k0}:${w.repeatDelay}`;
  if (cache[key]) return cache[key];
  const out = [], dt = 1 / 240;
  let p = 0, y = 0, shots = 0, next = 0;
  for (let t = 0; shots < cap; t += dt) {
    if (t >= next - 1e-9) { out.push([y, -p]); shots++; next += w.repeatDelay; }
    const k = Math.min(1, shots / cap);
    const tp = rp.recoilPitchMax * evalCurve(rp.pitchCurve, k) * k0, ty = rp.recoilYawMax * evalCurve(rp.yawCurve, k) * k0;
    const dp = tp - p, dy = ty - y, len = Math.hypot(dp, dy), max = dt * 20;
    if (len <= max) { p = tp; y = ty; } else { p += (dp / len) * max; y += (dy / len) * max; }
  }
  return (cache[key] = out);
}

// Arma na mão = item do belt. Estado de spray (tiros, penalidades) fica no próprio item, como no BaseProjectile.
export class Weapons {
  constructor({ player, ballistics, vm, audio, hud, camera, light, inv }) {
    Object.assign(this, { player, ballistics, vm, audio, hud, camera, light, inv });
    this.recoil = new Recoil(player.aim);
    this.item = null;
    this.w = null;
    this.nextFire = 0;
    this.reload = null;
    this.deployT = 0;
    this.aiming = false;
    this.adsLatched = false;
    this.burstLeft = 0;
  }

  // segura o item (ou guarda a arma com null / item que não é arma)
  hold(item) {
    if (this.item === item) return;
    this.recoil.finalize();
    this.item = item && kind(item.id) === 'weapon' ? item : null;
    this.reload = null;
    this.deployT = 0;
    this.adsLatched = false;
    this.burstLeft = 0;
    this.aiming = false;
    if (!this.item) { this.w = null; this.vm.show(null); this.hud.weapon(null, null); this.hud.ads(false); return; }
    this.item.rs ??= { shots: 0, lastShot: -1e9, stance: 0, penalty: 0, yawAcc: 0, capacity: 0 };
    this.stats();
    this.vm.show(this.w, this.item);
    this.pattern(true);
    this.ui();
    settings.weapon = this.item.id;
    save();
  }

  stats() {
    this.w = weaponStats(this.item, settings.mode, this.aiming);
    // variable zoom scope: nível escolhido na roda do mouse
    const zl = this.item.mods.map((m) => m && MODS[m.id].zoomLevels).find(Boolean);
    if (zl) this.w.zoom = zl[this.item.zoomI ?? 1];
    this.item.rs.capacity = this.w.capacity;
    // pente menor (tirou o extended mag): o excedente volta para o inventário (DelayedModsChanged)
    const extra = this.item.ammo - this.w.capacity;
    if (extra > 0) {
      this.item.ammo = this.w.capacity;
      const back = makeItem(this.item.ammoType, extra);
      if (!this.inv.give(back)) this.onOverflow?.(back);
    }
    return this.w;
  }

  ui() { if (this.item) this.hud.weapon(this.w, this.item, this.inv.count(this.item.ammoType)); }

  // painel do padrão: só redesenha quando o caminho muda (pente/mods/modo), senão apagaria os tiros
  pattern(force = false) {
    const path = legacyPath(this.w);
    if (!force && path === this.path) return;
    this.path = path;
    this.hud.pattern(this.w, path);
  }

  // mods/munição mudaram no inventário
  changed() {
    if (!this.item) return;
    this.stats();
    this.vm.attach?.(this.item);
    this.pattern();
    this.ui();
  }

  setMode(mode) {
    settings.mode = mode;
    save();
    this.recoil.finalize();
    this.recoil.kicks.length = 0;
    this.reload = null;
    this.hud.mode(mode);
    if (this.item) { this.stats(); this.pattern(true); this.ui(); }
  }

  // ---------- munição ----------
  // TryReload: usa o tipo selecionado; sem ele no inventário, troca para outro do mesmo calibre
  reloadType() {
    const it = this.item;
    if (this.inv.count(it.ammoType) > 0) return it.ammoType;
    return ammoTypes(gun(it.id)).find((a) => this.inv.count(a) > 0) ?? null;
  }

  startReload() {
    const it = this.item, type = this.reloadType();
    if (!type || this.reload || (it.ammo >= this.w.capacity && type === it.ammoType)) return false;
    this.reload = { t: 0, dur: this.w.reloadTime, type };
    if (!this.vm.reloadStart?.()) this.audio.reload(this.w.reloadTime);
    return true;
  }

  finishReload() {
    const it = this.item, type = this.reload.type;
    if (type !== it.ammoType) { this.unload(it); it.ammoType = type; }
    it.ammo += this.inv.take(type, this.w.capacity - it.ammo);
    this.reload = null;
    this.ui();
  }

  // devolve o pente ao inventário (opção "Unload Ammo")
  unload(it) {
    if (!it.ammo) return;
    const back = makeItem(it.ammoType, it.ammo);
    it.ammo = 0;
    if (!this.inv.give(back)) this.onOverflow?.(back);
    if (it === this.item) this.ui();
  }

  // escolher o tipo no painel: descarrega e recarrega com o novo (SwitchAmmoTo)
  switchAmmo(it, type) {
    if (it.ammoType === type && it.ammo) return;
    this.unload(it);
    it.ammoType = type;
    if (it === this.item) { this.reload = null; this.stats(); this.startReload(); }
    this.inv.changed();
  }

  // F: liga/desliga laser, lanterna e burst
  toggleLight() {
    const it = this.item;
    if (!it || !it.mods.some((m) => m && (MODS[m.id].isLight || MODS[m.id].burstCount))) return;
    it.lightOn = !it.lightOn;
    this.audio.click?.();
    this.changed();
  }

  // roda do mouse com a luneta variável no ADS: troca o zoom em vez do item
  zoomWheel(dir) {
    const it = this.item, zl = it && this.aiming && it.mods.map((m) => m && MODS[m.id].zoomLevels).find(Boolean);
    if (!zl) return false;
    it.zoomI = Math.max(0, Math.min(zl.length - 1, (it.zoomI ?? 1) + dir));
    return true;
  }

  update(dt, now, inp) {
    const { item: it, player: p } = this;
    if (!it) return;
    const w = this.stats(), g = it.rs;
    this.deployT += dt;
    const deployed = this.deployT >= w.deployDelay;

    if (settings.adsToggle) { if (inp.rightPressed) this.adsLatched = !this.adsLatched; } else this.adsLatched = p.mouse.right;
    this.aiming = this.adsLatched && !this.reload && !p.sprinting;

    if (this.reload) {
      this.reload.t += dt;
      if (this.reload.t >= this.reload.dur) this.finishReload();
    }
    if (inp.pressed.has('KeyR') && deployed) this.startReload();

    const rp = recoilProps(w, settings.mode);
    this.recoil.frame(dt, now, w, g, rp, { ducked: p.ducked, speed: p.speed });

    // burst module: um aperto = burstCount tiros na cadência do mod
    if (w.burst && inp.leftPressed && !this.burstLeft) this.burstLeft = w.burst;
    const trigger = w.burst ? this.burstLeft > 0 : w.automatic ? p.mouse.left : inp.leftPressed;
    if (trigger && deployed && !this.reload && !p.sprinting && now >= this.nextFire) {
      if (it.ammo > 0) { this.fire(now, rp); if (this.burstLeft) this.burstLeft--; }
      else {
        this.burstLeft = 0;
        if (inp.leftPressed && !this.vm.dry?.()) this.audio.click();
      }
    }

    this.light.intensity = Math.max(0, this.light.intensity - dt * 400);
    this.hud.reload(this.reload ? this.reload.t / this.reload.dur : null);
    this.hud.ads(this.aiming);
  }

  fire(now, rp) {
    const { w, item: it, player: p } = this, g = it.rs;
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
    this.ballistics.fire(this.camera.position, dir, { ...w, ammoType: it.ammoType });

    g.shots++;
    g.lastShot = now;
    it.ammo--;
    this.nextFire = now - this.nextFire < w.repeatDelay ? this.nextFire + w.repeatDelay : now + w.repeatDelay;
    this.audio.shot(w);
    this.vm.shot(w.model === 'm249' ? 0.7 : 1);
    if (!w.silencer) {
      this.light.position.copy(this.camera.position).addScaledVector(dir, 1.2);
      this.light.intensity = 18;
    }
    this.ui();
    this.inv.changed();
  }
}
