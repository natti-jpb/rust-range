import { BASE } from './rustvm.js';
import { GUNS } from './config.js';

// HUD com o layout do jogo (asset scene bootstrap): GameUI.Hud usa CanvasScaler 1280×720 casando pela altura,
// Inset de 16 px; Vitals.Main 192 px no canto inferior direito (linhas de 26 px); BeltBar centralizada (x −8),
// slots de 64 px sem espaçamento. Cores e tamanhos copiados dos componentes Image/Text do prefab.
const CSS = `
@font-face { font-family: RustRoboto; src: url(${BASE}hud/RobotoCondensed-Bold.ttf); }
#rhud { position: fixed; inset: 0; pointer-events: none; font-family: RustRoboto, 'Roboto Condensed', sans-serif; --k: calc(100vh / 720); }
#rhud[hidden] { display: none; }
#rhud .inset { position: absolute; inset: calc(16 * var(--k)); }
#rhud .vitals { position: absolute; right: 0; bottom: 0; width: calc(192 * var(--k)); display: flex; flex-direction: column; gap: calc(3 * var(--k)); }
#rhud .row { position: relative; height: calc(26 * var(--k)); background: rgba(247, 235, 225, 0.03); }
#rhud .icon { position: absolute; left: calc(4 * var(--k)); top: calc(5 * var(--k)); bottom: calc(5 * var(--k)); width: calc(32 * var(--k));
  background: rgba(247, 235, 225, 0.5); -webkit-mask: var(--m) center / contain no-repeat; mask: var(--m) center / contain no-repeat; }
#rhud .bar { position: absolute; left: calc(24.65 * var(--k)); right: calc(3.05 * var(--k)); top: calc(3 * var(--k)); bottom: calc(3 * var(--k)); }
#rhud .fill { position: absolute; inset: 0 auto 0 0; width: 100%; background: var(--c); overflow: hidden; }
#rhud .bar span { position: absolute; left: calc(3.5 * var(--k)); top: 50%; transform: translateY(-50%); font-size: calc(14 * var(--k)); color: var(--t);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5); white-space: nowrap; }
#rhud .belt { position: absolute; left: 50%; transform: translateX(calc(-50% - 8 * var(--k))); display: flex; }
#rhud .belt.b1 { bottom: 0; }
#rhud .belt.b2 { bottom: calc(69 * var(--k)); }
#rhud .slot { position: relative; width: calc(64 * var(--k)); height: calc(64 * var(--k)); }
#rhud .slot::before { content: ''; position: absolute; inset: calc(2 * var(--k)); background: rgba(247, 235, 225, 0.04); }
#rhud .slot .occ { position: absolute; inset: calc(2 * var(--k)); background: rgba(43, 41, 36, 0.95); }
#rhud .slot.sel .occ { background: rgba(31, 107, 160, 0.78); }
#rhud .slot img { position: absolute; left: calc(4 * var(--k)); right: calc(4 * var(--k)); top: calc(2 * var(--k)); bottom: calc(8 * var(--k));
  width: calc(100% - 8 * var(--k)); height: calc(100% - 10 * var(--k)); object-fit: contain; }
#rhud .cond { position: absolute; left: 0; top: 0; bottom: 0; width: calc(4 * var(--k)); background: #738d45; }
#rhud .amt { position: absolute; right: calc(3 * var(--k)); bottom: calc(1 * var(--k)); font-size: calc(14 * var(--k)); color: rgba(255, 255, 255, 0.32);
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.6); }
#rhud .cross { position: absolute; left: 50%; top: 50%; width: calc(8 * var(--k)); height: calc(8 * var(--k)); transform: translate(-50%, -50%);
  background: #f7ebe1; -webkit-mask: url(${BASE}hud/crosshair.png) center / contain no-repeat; mask: url(${BASE}hud/crosshair.png) center / contain no-repeat; }
#rhud .cross.ads { opacity: 0; }
`;

const VITALS = [
  ['health', 100, '#a5dd429e', '#d1ff7dd1'],
  ['cup_water', 250, '#4eb0f3b8', '#a8deffd1'],
  ['fork_and_spoon', 500, '#fb8b3994', '#ffae74'],
];

export class RustHud {
  constructor() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    this.el = document.createElement('div');
    this.el.id = 'rhud';
    this.el.hidden = true;
    const rows = VITALS.map(([icon, v, c, t]) => `<div class="row"><i class="icon" style="--m:url(${BASE}hud/${icon}.png)"></i>
      <div class="bar" style="--c:${c};--t:${t}"><div class="fill"></div><span>${v}</span></div></div>`).join('');
    const slot = (g) => `<div class="slot" data-id="${g?.id ?? ''}">${g ? `<div class="occ"></div><img src="${BASE}items/${g.id}.png" alt=""><i class="cond"></i><b class="amt"></b>` : ''}</div>`;
    const row = (list) => Array.from({ length: 6 }, (_, i) => slot(list[i])).join('');
    this.el.innerHTML = `<div class="cross"></div><div class="inset"><div class="vitals">${rows}</div>
      <div class="belt b2">${row(GUNS.slice(6))}</div><div class="belt b1">${row(GUNS.slice(0, 6))}</div></div>`;
    document.body.append(this.el);
    for (const id of ['crosshair', 'weapon']) document.getElementById(id).style.display = 'none';
  }

  show(on) { this.el.hidden = !on; }

  health(hp) {
    const row = this.el.querySelector('.row');
    row.querySelector('.fill').style.width = `${Math.max(0, Math.min(100, hp))}%`;
    row.querySelector('span').textContent = Math.ceil(hp);
    document.getElementById('hp').style.display = 'none';
  }
  ads(on) { this.el.querySelector('.cross').classList.toggle('ads', on); }

  // states: munição de cada arma (Weapons.state), mostrada no canto do slot como no jogo
  weapon(w, states) {
    for (const s of this.el.querySelectorAll('.slot[data-id]')) {
      if (!s.dataset.id) continue;
      s.classList.toggle('sel', s.dataset.id === w.id);
      s.querySelector('.amt').textContent = states[s.dataset.id]?.ammo ?? '';
    }
  }
}
