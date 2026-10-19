import { WEAPONS } from '../data/weapons.js';

// Metadados que não vêm do weapons.js gerado.
// zoom = IronSights.zoomFactor dos *.viewmodel.prefab (FOV no ADS = fov / zoom).
// legacyMag: pente da época do recoil legado quando diferente do atual (Custom SMG tinha 24, rustlabs jan–mai/2022).
const META = {
  'rifle.ak': { name: 'Assault Rifle', zoom: 1.6667, model: 'ak', snd: { tone: 0.9, body: 1.0, gain: 1.0 } },
  'rifle.lr300': { name: 'LR-300 Assault Rifle', zoom: 1.6667, model: 'lr', snd: { tone: 1.1, body: 0.85, gain: 0.9 } },
  'smg.mp5': { name: 'MP5A4', zoom: 1.6667, model: 'mp5', snd: { tone: 1.35, body: 0.6, gain: 0.75 } },
  'smg.thompson': { name: 'Thompson', zoom: 1.3636, model: 'thompson', snd: { tone: 0.95, body: 0.75, gain: 0.85 } },
  'smg.2': { name: 'Custom SMG', zoom: 1.3636, model: 'custom', legacyMag: 24, snd: { tone: 1.3, body: 0.55, gain: 0.75 } },
  'lmg.m249': { name: 'M249', zoom: 1.6667, model: 'm249', snd: { tone: 0.8, body: 1.2, gain: 1.05 } },
  'rifle.semiauto': { name: 'Semi-Automatic Rifle', zoom: 1.6667, model: 'sar', snd: { tone: 1.0, body: 0.9, gain: 0.95 } },
  'rifle.m39': { name: 'M39 Rifle', zoom: 1.25, model: 'm39', snd: { tone: 0.85, body: 1.1, gain: 1.0 } },
  'pistol.python': { name: 'Python Revolver', zoom: 1.25, model: 'python', snd: { tone: 0.8, body: 1.0, gain: 0.95 } },
  'pistol.semiauto': { name: 'Semi-Automatic Pistol', zoom: 1.1538, model: 'p250', snd: { tone: 1.4, body: 0.5, gain: 0.7 } },
  'pistol.m92': { name: 'M92 Pistol', zoom: 1.1538, model: 'm92', snd: { tone: 1.3, body: 0.55, gain: 0.75 } },
};

export const GUNS = WEAPONS.map((w) => ({ ...w, ...META[w.id] }));
export const gun = (id) => GUNS.find((g) => g.id === id);

const KEY = 'rustrange:settings';
const DEFAULTS = { sens: 0.5, fov: 90, vol: 0.7, mode: 'legacy', adsToggle: false, showTrainer: true, lang: null, weapon: 'rifle.ak' };

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* modo privado: segue sem salvar */
  }
}
