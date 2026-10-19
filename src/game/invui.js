import { MODS, AMMO } from '../data/weapons.js';
import { gun, settings } from './config.js';
import { kind, itemName, maxStack, ammoTypes, weaponStats } from './items.js';
import { modContainer } from './inventory.js';
import { t } from './i18n.js';

// Inventário com o layout do GameUI.Inventory (asset scene bootstrap, CanvasScaler 1280×720 pela altura):
// fundo "Inventory Menu" com margem de 17,5; Container 1161×571 a 64 do chão; grade Inventory 6×4 de 64 px
// (388×260) embaixo no centro; SelectedItem 380×288,6 em cima no centro; Loadout 380 à esquerda; Loot 380 à
// direita. O belt fica no lugar do da HUD (inset 16, centro −8). Ícones (ItemIcon): fundo 0,035, ocupado
// rgba(43,41,36,0,95), barra de condição de 4 px, quantidade 14 px no canto.
const CSS = (base) => `
#inv, #belt, #invghost { --k: min(calc(100vh / 720), calc(100vw / 1280)); font-family: RustRoboto, 'Roboto Condensed', 'Arial Narrow', sans-serif;
  color: #f7ebe1; user-select: none; -webkit-user-select: none; }
#inv { position: fixed; inset: 0; z-index: 5; }
#inv[hidden] { display: none; }
#inv .menu { position: absolute; inset: calc(17.5 * var(--k)); transform: translateX(calc(-8 * var(--k)));
  background: rgba(29, 32, 31, 0.94) ${base ? `url(${base}hud/UI.Background.Tile.png)` : ''}; background-size: calc(256 * var(--k));
  background-blend-mode: multiply; } /* Image.color tinge o sprite do tile */
#inv .cont { position: absolute; left: 50%; bottom: calc(64 * var(--k)); width: calc(1161 * var(--k)); height: calc(571 * var(--k));
  transform: translateX(-50%); }
#inv .tile { background-color: rgba(247, 235, 225, 0.04); }
#inv .tile2 { background-color: rgba(247, 235, 225, 0.078); }
#inv .loadout { position: absolute; left: 0; top: 0; bottom: 0; width: calc(380 * var(--k)); display: flex; flex-direction: column;
  gap: calc(2 * var(--k)); padding-bottom: calc(35 * var(--k)); background: rgba(29, 32, 31, 0.56); }
#inv .pname { height: calc(24 * var(--k)); font-size: calc(20 * var(--k)); text-transform: uppercase; padding-left: calc(4 * var(--k)); }
#inv .model { flex: 1; }
#inv .wear { display: flex; justify-content: center; gap: 0; }
#inv .wear .cell { width: calc(54 * var(--k)); height: calc(54 * var(--k)); }
#inv .grid { position: absolute; left: 50%; bottom: 0; width: calc(388 * var(--k)); height: calc(260 * var(--k)); transform: translateX(-50%); }
#inv .grid .cells { display: grid; grid-template-columns: repeat(6, calc(64 * var(--k))); }
#inv .label { position: absolute; left: calc(4 * var(--k)); top: calc(-24 * var(--k)); font-size: calc(18 * var(--k)); line-height: 1; text-transform: uppercase; }
#inv .sel { position: absolute; left: 50%; top: 0; width: calc(380 * var(--k)); height: calc(284 * var(--k)); transform: translateX(-50%);
  display: flex; flex-direction: column; gap: calc(2 * var(--k)); overflow: hidden; }
#inv .sel[hidden] { display: none; }
#inv .iname { height: calc(23 * var(--k)); font-size: calc(18 * var(--k)); text-transform: uppercase; padding-left: calc(4 * var(--k)); }
#inv .info { position: relative; height: calc(60 * var(--k)); flex: none; }
#inv .info p { position: absolute; left: calc(8 * var(--k)); top: calc(6 * var(--k)); width: calc(270 * var(--k)); margin: 0;
  font-size: calc(12 * var(--k)); line-height: 1.15; max-height: calc(48 * var(--k)); overflow: hidden; color: rgba(247, 235, 225, 0.9); }
#inv .info img { position: absolute; right: calc(8 * var(--k)); top: 0; height: 100%; width: calc(100 * var(--k)); object-fit: contain; }
#inv .horiz { flex: 1; display: flex; gap: calc(2 * var(--k)); min-height: 0; }
#inv .left { width: calc(218 * var(--k)); display: flex; flex-direction: column; gap: calc(1 * var(--k)); }
#inv .opts { flex: 1; display: flex; flex-direction: column; gap: calc(1 * var(--k)); overflow-y: auto; scrollbar-width: none; }
#inv .hdr { height: calc(18 * var(--k)); flex: none; font-size: calc(11 * var(--k)); line-height: calc(18 * var(--k)); padding-left: calc(4 * var(--k));
  color: rgba(247, 235, 225, 0.6); text-transform: uppercase; }
#inv .mods { display: flex; justify-content: center; gap: calc(2 * var(--k)); padding: calc(5 * var(--k)) calc(8 * var(--k)); }
#inv .mods .cell { width: calc(50 * var(--k)); height: calc(50 * var(--k)); }
#inv .stats { flex: 1; padding: calc(4 * var(--k)) calc(4 * var(--k)); display: flex; flex-direction: column; gap: calc(2 * var(--k)); }
#inv .stat { position: relative; height: calc(12 * var(--k)); font-size: calc(10 * var(--k)); line-height: calc(12 * var(--k)); }
#inv .stat .bar { position: absolute; left: calc(70 * var(--k)); width: calc(117 * var(--k)); top: calc(1 * var(--k)); height: calc(10 * var(--k)); }
#inv .stat .bar i { position: absolute; inset: 0 auto 0 0; background: rgba(247, 235, 225, 0.253); }
#inv .stat .bar i.up { background: #95bf4a; }
#inv .stat .bar i.down { background: #c8543f; }
#inv .stat b { position: absolute; left: calc(192 * var(--k)); font-weight: 400; font-size: calc(11 * var(--k)); color: rgba(247, 235, 225, 0.6); }
#inv .stat b.txt { left: calc(90 * var(--k)); font-size: calc(12 * var(--k)); color: #f7ebe1; }
#inv .opt { height: calc(26 * var(--k)); flex: none; display: flex; align-items: center; padding: 0 calc(8 * var(--k)); font-size: calc(14 * var(--k));
  background: rgba(247, 235, 225, 0.08); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#inv .opt:hover { background: rgba(247, 235, 225, 0.16); }
#inv .opt.on { background: rgba(31, 107, 160, 0.78); }
#inv .right { position: absolute; right: 0; top: calc(16.5 * var(--k)); bottom: calc(-6.5 * var(--k)); width: calc(380 * var(--k)); }
#inv .right[hidden] { display: none; }
#inv .loot .cells { display: grid; grid-template-columns: repeat(6, calc(60 * var(--k))); justify-content: center; padding: calc(4 * var(--k)) 0; }
#inv .loot .cell { width: calc(60 * var(--k)); height: calc(60 * var(--k)); }
#invghost { position: fixed; width: calc(64 * var(--k)); height: calc(64 * var(--k)); pointer-events: none; transform: translate(-50%, -50%); z-index: 10; }
#invghost[hidden] { display: none; }
#belt { position: fixed; left: 50%; bottom: calc(16 * var(--k)); transform: translateX(calc(-50% - 8 * var(--k))); display: flex; z-index: 6; pointer-events: none; }
#belt[hidden] { display: none; }
#belt.open { pointer-events: auto; }
.cell { position: relative; width: calc(64 * var(--k)); height: calc(64 * var(--k)); }
.cell::before { content: ''; position: absolute; inset: calc(2 * var(--k)); background: rgba(247, 235, 225, 0.035); }
.cell .occ { position: absolute; inset: calc(2 * var(--k)); background: rgba(43, 41, 36, 0.953); cursor: grab; }
.cell.hl .occ { outline: calc(2 * var(--k)) solid rgba(247, 235, 225, 0.25); }
#belt .cell.on .occ { background: rgba(31, 107, 160, 0.78); }
.cell.ok::before { background: rgba(115, 141, 69, 0.35); }
.cell.drag .occ { opacity: 0.35; }
.cell img { position: absolute; left: calc(2 * var(--k)); right: calc(2 * var(--k)); top: 0; bottom: calc(6 * var(--k));
  width: calc(100% - 4 * var(--k)); height: calc(100% - 6 * var(--k)); object-fit: contain; pointer-events: none; }
.cell .cond { position: absolute; left: 0; top: 0; bottom: 0; width: calc(4 * var(--k)); background: #738d45; }
.cell .amt { position: absolute; right: calc(3 * var(--k)); bottom: calc(1 * var(--k)); font-size: calc(14 * var(--k)); font-weight: 400;
  color: rgba(255, 255, 255, 0.4); text-shadow: 0 1px 1px rgba(0, 0, 0, 0.6); }
.cell .lbl { position: absolute; inset: calc(4 * var(--k)); font-size: calc(10 * var(--k)); line-height: 1.1; color: rgba(247, 235, 225, 0.8);
  text-transform: uppercase; overflow: hidden; pointer-events: none; }
.cell .key { position: absolute; left: calc(5 * var(--k)); top: calc(2 * var(--k)); font-size: calc(10 * var(--k)); color: rgba(247, 235, 225, 0.35); }
.cell .ammoi { position: absolute; left: 50%; bottom: calc(3 * var(--k)); transform: translateX(-50%); width: calc(6 * var(--k)); height: calc(6 * var(--k));
  border-radius: 50%; }
.cell .modn { position: absolute; left: calc(7 * var(--k)); bottom: calc(3 * var(--k)); display: flex; gap: calc(1 * var(--k)); }
.cell .modn i { width: calc(4 * var(--k)); height: calc(4 * var(--k)); background: rgba(247, 235, 225, 0.25); }
.cell .modn i.f { background: #f7ffff; }
`;

const AMMO_DOT = { hv: '#7fb6e6', incendiary: '#e3803f', fire: '#e3803f', explosive: '#d24b3a' };
const short = (id) => itemName(id).replace(/ Rifle Ammo| Ammo|Weapon /g, '').slice(0, 22);

export class InventoryUI {
  constructor(inv, { base, items, onDrop, onAmmo, onUnload, onChange }) {
    Object.assign(this, { inv, base, items: items || {}, onDrop, onAmmo, onUnload, onChange });
    const st = document.createElement('style');
    st.textContent = CSS(base);
    document.head.append(st);
    this.el = document.createElement('div');
    this.el.id = 'inv';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="menu"><div class="cont">
      <div class="loadout panel"><div class="pname"></div><div class="model tile"></div><div class="wear">${'<div class="cell"></div>'.repeat(7)}</div></div>
      <div class="sel panel tile" hidden></div>
      <div class="grid panel"><div class="label"></div><div class="cells"></div></div>
      <div class="right panel" hidden><div class="loot"><div class="hdr tile2"></div><div class="cells tile"></div></div></div>
    </div></div>`;
    document.body.append(this.el);
    this.belt = document.createElement('div');
    this.belt.id = 'belt';
    this.belt.hidden = true;
    document.body.append(this.belt);
    this.$ = (s) => this.el.querySelector(s);
    this.ghost = document.createElement('div');
    this.ghost.id = 'invghost';
    this.ghost.hidden = true;
    document.body.append(this.ghost);
    this.loot = null;
    this.selected = null; // { c, i }
    inv.listeners.push(() => this.render());
    for (const root of [this.el, this.belt]) {
      root.addEventListener('pointerdown', (e) => this.down(e));
      root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.quick(e); });
    }
    addEventListener('pointermove', (e) => this.drag(e));
    addEventListener('pointerup', (e) => this.up(e));
    this.texts();
  }

  get open() { return !this.el.hidden; }

  show(on, loot = null) {
    this.el.hidden = !on;
    this.loot = on ? loot : null;
    this.belt.classList.toggle('open', on);
    if (!on) { this.selected = null; this.cancelDrag(); }
    this.render();
  }

  hud(on) { this.belt.hidden = !on; }

  texts() {
    this.$('.pname').textContent = t('player');
    this.$('.grid .label').textContent = t('inventory');
    this.$('.loot .hdr').textContent = t('arsenal');
    this.render();
  }

  // ---------- containers ----------
  cont(name) {
    if (name === 'main') return this.inv.main;
    if (name === 'belt') return this.inv.belt;
    if (name === 'loot') return this.loot;
    if (name === 'mods') { const w = this.selItem(); return w?.mods ? modContainer(w) : null; }
    return null;
  }

  selItem() { const s = this.selected; return s ? this.cont(s.c)?.slots[s.i] ?? null : null; }

  // ---------- desenho ----------
  icon(id) { return this.base ? `<img src="${this.base}items/${id}.png" alt="">` : `<span class="lbl">${short(id)}</span>`; }

  cellHTML(it, extra = '') {
    if (!it) return extra;
    let s = `<div class="occ">${this.icon(it.id)}`;
    const k = kind(it.id);
    if (k === 'weapon') {
      s += `<i class="cond"></i><b class="amt">${it.ammo}</b>`;
      const dot = Object.entries(AMMO_DOT).find(([n]) => it.ammoType.includes('.' + n));
      if (dot) s += `<i class="ammoi" style="background:${dot[1]}"></i>`;
      if (it.mods.length) s += `<span class="modn">${it.mods.map((m) => `<i class="${m ? 'f' : ''}"></i>`).join('')}</span>`;
    } else if (maxStack(it.id) > 1) s += `<b class="amt">${it.amount}</b>`;
    return s + '</div>' + extra;
  }

  cells(el, name, c, n = c?.slots.length ?? 0) {
    let h = '';
    for (let i = 0; i < n; i++) {
      const sel = this.selected && this.selected.c === name && this.selected.i === i;
      h += `<div class="cell${sel ? ' hl' : ''}" data-c="${name}" data-i="${i}">${this.cellHTML(c?.slots[i])}</div>`;
    }
    el.innerHTML = h;
  }

  render() {
    // belt (HUD e inventário)
    this.cells(this.belt, 'belt', this.inv.belt);
    this.belt.querySelectorAll('.cell').forEach((el, i) => el.classList.toggle('on', i === this.inv.active));
    if (!this.open) return;
    this.cells(this.$('.grid .cells'), 'main', this.inv.main);
    this.$('.right').hidden = !this.loot;
    if (this.loot) this.cells(this.$('.loot .cells'), 'loot', this.loot);
    this.panel();
  }

  // painel SelectedItem: nome, descrição, MODIFICATIONS, informação e ações
  panel() {
    const el = this.$('.sel'), it = this.selItem();
    el.hidden = !it;
    if (!it) return;
    const k = kind(it.id), desc = this.items[it.id]?.desc ?? '';
    let left = '', opts = '';
    if (k === 'weapon') {
      left += `<div class="hdr tile2">${t('modifications')}</div><div class="mods tile"></div>`;
      left += `<div class="hdr tile2">${t('information')}</div><div class="stats tile">${this.weaponInfo(it)}</div>`;
      if (it.ammo > 0) opts += `<div class="opt" data-a="unload">${t('unload')}</div>`;
      for (const a of ammoTypes(gun(it.id))) {
        const n = this.inv.count(a);
        if (a === it.ammoType || n > 0) opts += `<div class="opt${a === it.ammoType ? ' on' : ''}" data-a="ammo" data-v="${a}">${short(a)} (${n})</div>`;
      }
    } else {
      left += `<div class="hdr tile2">${t('information')}</div><div class="stats tile">${k === 'mod' ? this.modInfo(MODS[it.id]) : this.ammoInfo(AMMO[it.id])}</div>`;
      if (it.amount > 1) opts += `<div class="opt" data-a="split">${t('split')}</div>`;
    }
    opts += `<div class="opt" data-a="drop">${t('drop')}</div>`;
    el.innerHTML = `<div class="iname">${itemName(it.id)}</div><div class="info tile"><p>${desc}</p>${this.base ? `<img src="${this.base}items/${it.id}.png" alt="">` : ''}</div>
      <div class="horiz"><div class="left">${left}</div><div class="opts"><div class="hdr tile2">${t('actions')}</div>${opts}</div></div>`;
    const mods = el.querySelector('.mods');
    if (mods) this.cells(mods, 'mods', modContainer(it));
    el.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => this.action(it, o.dataset.a, o.dataset.v)));
  }

  stat(label, v, max, txt, cls = '') {
    return `<div class="stat">${label}<span class="bar"><i class="${cls}" style="width:${Math.max(0, Math.min(1, v / max)) * 100}%"></i></span><b>${txt}</b></div>`;
  }

  weaponInfo(it) {
    const s = weaponStats(it, settings.mode), g = gun(it.id);
    const rpm = 60 / s.repeatDelay, rpm0 = 60 / g.repeatDelay;
    const cmp = (a, b, hi = true) => (Math.abs(a - b) < 1e-6 ? '' : (a > b) === hi ? 'up' : 'down');
    return this.stat(t('damage'), s.damage, 60, Math.round(s.damage), cmp(s.damage, g.damage))
      + this.stat(t('fireRate'), rpm, 900, Math.round(rpm), cmp(rpm, rpm0))
      + this.stat(t('velocity'), s.velocity, 700, Math.round(s.velocity), cmp(s.velocity, g.velocity))
      + this.stat(t('capacity'), s.capacity, 100, s.capacity, cmp(s.capacity, g.mag))
      + this.stat(t('recoil'), s.recoilScale, 2, `${Math.round(s.recoilScale * 100)}%`, cmp(s.recoilScale, 1, false))
      + this.stat(t('aimcone'), s.hipAimCone * s.hipScale + s.hipOffset, 5, `${(g.aimCone * s.sightScale + s.sightOffset).toFixed(2)}° / ${(g.hipAimCone * s.hipScale + s.hipOffset + s.sightOffset).toFixed(1)}°`);
  }

  modInfo(m) {
    const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
    const row = (label, txt) => `<div class="stat">${label}<b class="txt">${txt}</b></div>`;
    let h = '';
    if (m.repeatDelay) h += row(t('fireRate'), pct(1 / m.repeatDelay[0] - 1));
    if (m.projectileVelocity) h += row(t('velocity'), pct(m.projectileVelocity[0] - 1));
    if (m.projectileDamage) h += row(t('damage'), pct(m.projectileDamage[0] - 1));
    if (m.sightAimCone || m.hipAimCone) {
      const sc = m.sightAimCone ?? [1, 0], hc = m.hipAimCone ?? [1, 0];
      h += row(t('aimcone'), `×${sc[0]}${sc[1] ? ` +${sc[1]}°` : ''} / ×${(sc[0] * hc[0]).toFixed(2)}${hc[1] ? ` +${hc[1]}°` : ''}`);
    }
    if (m.recoil) h += row(t('recoil'), pct(m.recoil[0] - 1));
    if (m.magazineCapacity) h += row(t('capacity'), pct(m.magazineCapacity[0] - 1));
    if (m.zoomLevels) h += row(t('zoom'), m.zoomLevels.map((z) => `${z}x`).join(' / '));
    else if (m.sight) h += row(t('zoom'), `${m.sight.zoomFactor}x`);
    if (m.burstCount) h += row(t('burst'), `${m.burstCount}`);
    if (m.isSilencer) h += row(t('silenced'), '✓');
    if (m.isLight || m.needsOn && !m.isScope) h += row(t('toggle'), '[F]');
    return h;
  }

  ammoInfo(a) {
    return this.stat(t('damage'), a.damage, 60, a.damage) + this.stat(t('velocity'), a.velocity, 500, `${a.velocity} m/s`)
      + (a.heat ? this.stat(t('fire'), a.heat, 10, a.heat) : '') + (a.radius ? this.stat(t('radius'), a.radius, 3, `${a.radius} m`) : '');
  }

  action(it, a, v) {
    const s = this.selected, c = this.cont(s.c);
    if (a === 'drop') { c.slots[s.i] = null; this.selected = null; this.onDrop?.(it); this.inv.changed(); }
    if (a === 'split') this.inv.move(c, s.i, ...this.free(c), Math.floor(it.amount / 2));
    if (a === 'unload') this.onUnload?.(it);
    if (a === 'ammo') this.onAmmo?.(it, v);
    this.render();
  }

  free(pref) {
    for (const c of [pref, this.inv.main, this.inv.belt]) { const i = c?.slots.indexOf(null) ?? -1; if (i >= 0) return [c, i]; }
    return [pref, -1];
  }

  // ---------- arrastar e soltar ----------
  slotAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest('.cell[data-c]');
    return el ? { el, c: el.dataset.c, i: Number(el.dataset.i) } : null;
  }

  down(e) {
    if (!this.open || e.button !== 0) return;
    const s = this.slotAt(e.clientX, e.clientY);
    if (!s || !this.cont(s.c)?.slots[s.i]) return;
    e.preventDefault();
    this.pending = { ...s, x: e.clientX, y: e.clientY, split: e.shiftKey };
  }

  drag(e) {
    const p = this.pending;
    if (!p) return;
    if (!this.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) {
      this.dragging = true;
      p.el.classList.add('drag');
      this.ghost.innerHTML = `<div class="cell">${this.cellHTML(this.cont(p.c).slots[p.i])}</div>`;
      this.ghost.hidden = false;
    }
    if (!this.dragging) return;
    this.ghost.style.left = `${e.clientX}px`;
    this.ghost.style.top = `${e.clientY}px`;
    for (const el of document.querySelectorAll('.cell.ok')) el.classList.remove('ok');
    const s = this.slotAt(e.clientX, e.clientY), src = this.cont(p.c), it = src.slots[p.i], dst = s && this.cont(s.c);
    if (dst && (!dst.accept || dst.accept(it, s.i))) s.el.classList.add('ok');
  }

  up(e) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (!this.dragging) {
      if (p.c !== 'mods') this.selected = { c: p.c, i: p.i }; // mods: o painel continua na arma
      this.render();
      return;
    }
    this.cancelDrag();
    const src = this.cont(p.c), it = src.slots[p.i];
    const s = this.slotAt(e.clientX, e.clientY);
    if (s) {
      const dst = this.cont(s.c), target = dst.slots[s.i];
      const n = p.split && it.amount > 1 ? Math.floor(it.amount / 2) : null;
      // mod solto em cima de uma arma: instala no primeiro slot que aceitar
      if (kind(it.id) === 'mod' && target?.mods && !dst.accept) this.inv.attach(src, p.i, target);
      else if (this.inv.move(src, p.i, dst, s.i, n) && this.selected?.c === p.c && this.selected.i === p.i && kind(it.id) !== 'mod') this.selected = { c: s.c, i: s.i };
    } else if (!document.elementFromPoint(e.clientX, e.clientY)?.closest('.panel, #belt')) {
      // fora dos painéis: solta no mundo
      src.slots[p.i] = null;
      if (this.selected?.c === p.c && this.selected.i === p.i) this.selected = null;
      this.onDrop?.(it);
      this.inv.changed();
    }
    this.render();
  }

  cancelDrag() {
    this.dragging = false;
    this.ghost.hidden = true;
    for (const el of document.querySelectorAll('.cell.drag, .cell.ok')) el.classList.remove('drag', 'ok');
  }

  // botão direito: move rápido entre loot e jogador (ou main ↔ belt)
  quick(e) {
    if (!this.open) return;
    const s = this.slotAt(e.clientX, e.clientY), src = s && this.cont(s.c), it = src?.slots[s.i];
    if (!it) return;
    if (s.c === 'loot' || s.c === 'mods') {
      src.slots[s.i] = null;
      if (!this.inv.give(it)) src.slots[s.i] = it;
      this.inv.changed();
      return;
    }
    const dst = this.loot ?? (s.c === 'main' ? this.inv.belt : this.inv.main);
    const i = dst.slots.indexOf(null);
    if (i >= 0) this.inv.move(src, s.i, dst, i);
  }
}
