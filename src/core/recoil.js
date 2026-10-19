// Recoil do Rust reconstruído a partir do GameAssembly.dylib (arm64, build 6000.3.15x1-13).
// Convenção Unity/Rust: ângulos em graus, pitch negativo = para cima, yaw positivo = direita.
//
//   0x159a1a4  BaseProjectile, por frame  -> frame()   caminho com curvas (padrão legado) + stancePenalty
//   0x159b1c8  BaseProjectile, por tiro   -> shot()    caminho "punch" (Random.Range por tiro)
//   0x1594af4  LaunchProjectile           -> spread()  raio do aimcone = curva(Random01)
//   0x12e7e50  PlayerInput.FinalizeRecoil -> finalize() soma recoilAngles na mira e zera
//   0x1418bec  RecoilProperties.GetRecoil -> newRecoilOverride ?? this  (modo "atual")
import { evalCurve } from './curve.js';
import { RECOIL } from '../data/weapons.js';

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toward = (v, target, max) => (Math.abs(target - v) <= max ? target : v + Math.sign(target - v) * max);

export function recoilProps(weapon, mode) {
  return RECOIL[mode === 'legacy' ? weapon.recoilLegacy : weapon.recoilCurrent];
}

export class Recoil {
  constructor(aim) {
    this.aim = aim; // { body: {pitch, yaw}, recoil: {pitch, yaw} } — recoil = input.recoilAngles
    this.kicks = []; // punches em andamento: { pitch, yaw, dur, t }
  }

  finalize() {
    const { body, recoil } = this.aim;
    body.pitch += recoil.pitch;
    body.yaw += recoil.yaw;
    recoil.pitch = recoil.yaw = 0;
  }

  // ctx: { ducked, speed }. g: estado da arma { shots, lastShot, capacity, stance, penalty }
  frame(dt, now, w, g, rp, ctx) {
    const since = now - g.lastShot;
    if (since > w.repeatDelay * 2) g.shots = 0;

    if (rp.useCurves) {
      // Alvo absoluto ao longo do pente; nada de ADS/agachar/movimento neste caminho.
      // w.recoilScale: média dos scalars de recoil dos mods (ProjectileWeaponMod.Average)
      const t = clamp01(g.shots / g.capacity), k = w.recoilScale ?? 1;
      const tp = rp.recoilPitchMax * evalCurve(rp.pitchCurve, t) * k;
      const ty = rp.recoilYawMax * evalCurve(rp.yawCurve, t) * k;
      const r = this.aim.recoil;
      if (g.shots === 0 && (r.pitch || r.yaw)) this.finalize(); // sem recuperação: fica na mira
      // Vector3.MoveTowards(recoilAngles, alvo, deltaTime * 20)
      const dp = tp - r.pitch, dy = ty - r.yaw;
      const len = Math.hypot(dp, dy), max = dt * 20;
      if (len <= max) { r.pitch = tp; r.yaw = ty; } else { r.pitch += (dp / len) * max; r.yaw += (dy / len) * max; }
    }

    // Punches: aplicados linearmente em timeToTake e permanentes (vão direto para a mira).
    for (let i = this.kicks.length - 1; i >= 0; i--) {
      const k = this.kicks[i];
      const step = Math.min(dt, k.dur - k.t);
      this.aim.body.pitch += (k.pitch * step) / k.dur;
      this.aim.body.yaw += (k.yaw * step) / k.dur;
      k.t += step;
      if (k.t >= k.dur - 1e-6) this.kicks.splice(i, 1);
    }

    // stancePenalty (fim de 0x159a1a4): só cresce durante o spray; agachado zera.
    let st = 0;
    if (!ctx.ducked) st = clamp01((g.shots - 1) / 3) * (ctx.speed > 0.25 ? 1 : 0.5);
    g.stance = toward(g.stance, st, dt * 2);
    if (since > w.aimconePenaltyRecoverDelay) g.penalty = 0;
  }

  // Chamado no disparo, antes de incrementar g.shots. ctx: { aiming, ducked, moveFrac }
  shot(w, g, rp, ctx) {
    g.penalty = Math.min(g.penalty + w.aimconePenaltyPerShot, w.aimConePenaltyMax);
    if (rp.useCurves) return;
    let s = (ctx.ducked ? 0.5 : 1) * (ctx.aiming ? rp.ADSScale : 1) * (1 + ctx.moveFrac * rp.movementPenalty) * (w.recoilScale ?? 1);
    let pitch = s * rand(rp.recoilPitchMin, rp.recoilPitchMax);
    let yaw = s * rand(rp.recoilYawMin, rp.recoilYawMax);
    if (rp.curvesAsScalar) {
      const t = clamp01(g.shots / rp.shotsUntilMax);
      pitch *= evalCurve(rp.pitchCurve, t);
      yaw *= evalCurve(rp.yawCurve, t);
    }
    // maxRecoilRadius limita o yaw acumulado no spray
    if (g.shots === 0) g.yawAcc = 0;
    const acc = g.yawAcc + yaw;
    if (Math.abs(acc) > rp.maxRecoilRadius) yaw = Math.max(-rp.maxRecoilRadius, Math.min(rp.maxRecoilRadius, acc)) - g.yawAcc;
    g.yawAcc += yaw;
    this.kicks.push({ pitch, yaw, dur: Math.max(rand(rp.timeToTakeMin, rp.timeToTakeMax), 1e-3), t: 0 });
  }

  // Aimcone em graus (largura total do cone). Fórmula do GetAimCone; mods: (base)·sightScale + sightOffset,
  // no hip ainda + hipAimCone·hipScale + hipOffset. ammoSpread = projectileSpread da munição.
  cone(w, g, rp, aiming) {
    let c = (w.aimCone + g.penalty + g.stance) * (w.sightScale ?? 1) + (w.sightOffset ?? 0);
    if (!aiming) c += (w.hipAimCone + g.stance) * (w.hipScale ?? 1) + (w.hipOffset ?? 0);
    if (rp.overrideAimconeWithCurve) c *= rp.aimconeCurveScale * evalCurve(rp.aimconeCurve, clamp01(g.shots / rp.shotsUntilMax));
    return c + (w.ammoSpread ?? 0);
  }

  // Desvio (graus) do tiro dentro do cone: direção aleatória, raio = curva(Random01).
  spread(w, rp, cone) {
    const curve = rp.overrideAimconeWithCurve ? rp.aimconeProbabilityCurve : w.aimconeCurve;
    const r = clamp01(curve ? evalCurve(curve, Math.random()) : Math.sqrt(Math.random()));
    const a = Math.random() * Math.PI * 2;
    return { pitch: Math.sin(a) * r * cone * 0.5, yaw: Math.cos(a) * r * cone * 0.5 };
  }
}
