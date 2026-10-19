import { MODS, AMMO } from '../data/weapons.js';
import { gun } from './config.js';

// Itens do inventário (armas, attachments e munição) e as regras do Rust para combiná-los.
let nextUid = 1;

export const kind = (id) => (gun(id) ? 'weapon' : MODS[id] ? 'mod' : AMMO[id] ? 'ammo' : null);
export const itemName = (id) => gun(id)?.name ?? MODS[id]?.name ?? AMMO[id]?.name ?? id;
export const maxStack = (id) => AMMO[id]?.stack ?? 1;
export const ammoTypes = (g) => Object.keys(AMMO).filter((a) => AMMO[a].caliber === g.ammo);
export const defaultAmmo = (g) => `ammo.${g.ammo}`;

export function makeItem(id, amount = 1) {
  const it = { uid: nextUid++, id, amount };
  const g = gun(id);
  if (g) Object.assign(it, { ammo: 0, ammoType: defaultAmmo(g), mods: Array(g.modCapacity).fill(null), lightOn: false });
  return it;
}

// ItemContainer.CanAcceptItem com availableSlots: o mod precisa caber nos slots da arma
// e não pode dividir slot com outro mod já instalado (dois silenciadores, duas miras...).
export function canAttach(weapon, mod, index) {
  const g = gun(weapon.id), m = MODS[mod.id];
  if (!g || !m || !weapon.mods) return false;
  const avail = g.modSlots.reduce((a, s) => a | s, 0);
  if ((avail & m.slots) !== m.slots) return false;
  const used = weapon.mods.reduce((a, x, i) => (x && i !== index ? a | MODS[x.id].slots : a), 0);
  return (used & m.slots) === 0;
}

// Mods que valem agora: needsOnForEffects só conta ligado (laser e burst pelo toggle; mira com zoom no ADS).
export function activeMods(item, aiming) {
  return (item.mods || []).filter(Boolean).map((x) => MODS[x.id])
    .filter((m) => !m.needsOn || (m.isScope ? aiming : item.lightOn));
}

// ProjectileWeaponMod: Average dos scalars (cadência, dano, velocidade, recoil), Mult dos aimcones
// e do pente, Sum dos offsets. Base = arma com a munição carregada.
export function weaponStats(item, mode, aiming = false) {
  const g = gun(item.id), ms = activeMods(item, aiming);
  const on = (k) => ms.filter((m) => m[k]).map((m) => m[k]);
  const avg = (k) => { const l = on(k); return l.length ? l.reduce((a, v) => a + v[0], 0) / l.length : 1; };
  const mult = (k) => on(k).reduce((a, v) => a * v[0], 1);
  const sum = (k) => on(k).reduce((a, v) => a + v[1], 0);
  const base = AMMO[defaultAmmo(g)], a = AMMO[item.ammoType] ?? base;
  const cap = mode === 'legacy' && g.legacyMag ? g.legacyMag : g.mag;
  const sight = ms.find((m) => m.sight);
  return {
    ...g,
    repeatDelay: g.repeatDelay * avg('repeatDelay') + sum('repeatDelay'),
    capacity: Math.ceil(mult('magazineCapacity') * cap),
    velocity: (g.velocity / base.velocity) * a.velocity * avg('projectileVelocity') + sum('projectileVelocity'),
    damage: (g.damage / base.damage) * a.damage * avg('projectileDamage') + sum('projectileDamage'),
    drag: a.drag, gravity: a.gravity, ammoSpread: a.spread, heat: a.heat, radius: a.radius ?? 0,
    recoilScale: avg('recoil'),
    sightScale: mult('sightAimCone'), sightOffset: sum('sightAimCone'),
    hipScale: mult('hipAimCone'), hipOffset: sum('hipAimCone'),
    burst: ms.find((m) => m.burstCount)?.burstCount ?? 0,
    silencer: (item.mods || []).find((x) => x && MODS[x.id].isSilencer)?.id ?? null,
    // IronSights.GetFOVOffset: zoom = lerp(zoom da arma, zoom do override, fovBias)
    zoom: sight ? g.zoom + (sight.sight.zoomFactor - g.zoom) * sight.sight.fovBias : g.zoom,
    scope: !!(item.mods || []).find((x) => x && MODS[x.id].isScope),
  };
}
