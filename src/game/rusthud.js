import { BASE } from './rustvm.js';

// HUD com o layout do jogo (asset scene bootstrap): GameUI.Hud usa CanvasScaler 1280×720 casando pela altura,
// Inset de 16 px; Vitals.Main 192 px no canto inferior direito (linhas de 26 px). O belt (BeltBar) fica em
// invui.js, junto do inventário. Cores e tamanhos copiados dos componentes Image/Text do prefab.
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
    this.el.innerHTML = `<div class="cross"></div><div class="inset"><div class="vitals">${rows}</div></div>`;
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
}
