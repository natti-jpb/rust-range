import * as THREE from 'three';
import { t } from './i18n.js';
import { settings } from './config.js';

const $ = (id) => document.getElementById(id);
const _v = new THREE.Vector3();

export class Hud {
  constructor(camera) {
    this.camera = camera;
    this.el = $('hud');
    this.cv = $('trainer');
    this.cx = this.cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = 240 * dpr;
    this.cv.height = 300 * dpr;
    this.cx.scale(dpr, dpr);
    this.ideal = null;
    this.mine = [];
    this.trainerVisible(settings.showTrainer);
  }

  show(on) { this.el.hidden = !on; this.rust?.show(on); }
  trainerVisible(on) { this.cv.hidden = !on; }
  texts() { $('hints').innerHTML = t('hints'); this.mode(settings.mode); this.draw(); }

  mode(m) {
    const el = $('mode');
    el.textContent = t(m === 'legacy' ? 'modeLegacy' : 'modeCurrent');
    el.classList.toggle('current', m !== 'legacy');
  }

  // item: arma na mão (null = mão vazia); reserve = munição do tipo carregado no inventário
  weapon(w, item, reserve = 0) {
    this.w = w ?? this.w;
    $('weapon').hidden = !item;
    if (!item) return;
    $('wname').textContent = w.name;
    $('mag').textContent = item.ammo;
    $('reserve').textContent = `/ ${reserve}`; // '∞' com munição infinita
    $('ammo').classList.toggle('empty', item.ammo === 0);
  }

  // [E] abrir / pegar
  prompt(text) {
    const el = $('prompt');
    el.hidden = !text;
    if (text) el.textContent = text;
  }

  // overlay da luneta (ViewmodelScope.scopeMaterialOverride) por cima de tudo quando o ADS completa
  scope(src) {
    const el = $('scope');
    el.hidden = !src;
    if (src && el.dataset.src !== src) { el.dataset.src = src; el.querySelector('img').src = src; }
  }

  reload(p) {
    $('reload').classList.toggle('on', p != null);
    $('reload').firstElementChild.style.width = `${(p ?? 0) * 100}%`;
  }

  health(hp) {
    $('hp').firstElementChild.textContent = Math.ceil(hp);
    this.rust?.health(hp);
  }

  hurt() {
    const el = $('hurt');
    el.classList.add('on');
    clearTimeout(this.hurtT);
    this.hurtT = setTimeout(() => el.classList.remove('on'), 120);
  }

  dead(on) { $('dead').hidden = !on; }

  ads(on) { $('crosshair').classList.toggle('ads', on); this.rust?.ads(on); }

  // ponto do laser (posição de tela) — o laser do Rust marca onde a mira aponta
  laser(p) {
    const el = $('laser');
    el.hidden = !p;
    if (p) { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
  }

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.remove('show');
    h.classList.toggle('head', !!head);
    void h.offsetWidth;
    h.classList.add('show');
  }

  info(text) {
    const el = $('hitinfo');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.infoT);
    this.infoT = setTimeout(() => el.classList.remove('show'), 900);
  }

  damage(point, value, head) {
    _v.copy(point).project(this.camera);
    if (_v.z > 1) return;
    const s = document.createElement('span');
    s.textContent = Math.round(value);
    if (head) s.className = 'head';
    s.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
    s.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight}px`;
    $('dmg').append(s);
    setTimeout(() => s.remove(), 900);
  }

  // Painel: padrão sem compensar (cinza) e direção da mira em cada tiro do spray atual (laranja).
  pattern(w, path) { this.w = w; this.ideal = settings.mode === 'legacy' ? path : null; this.mine = []; this.errs = []; this.draw(); }
  trainerReset() { this.mine = []; this.errs = []; }
  // (x, y): ponto desenhado; err: desvio real da mira no tiro (para a nota)
  trainerShot(x, y, err = [x, y]) { this.mine.push([x, y]); (this.errs ??= []).push(err); this.draw(); }

  draw() {
    const c = this.cx, W = 240, H = 300;
    c.clearRect(0, 0, W, H);
    c.font = '600 11px "Roboto Condensed", "Arial Narrow", sans-serif';
    c.fillStyle = '#a59d8e';
    c.fillText(t('trainerTitle'), 10, 17);
    if (this.w) { c.textAlign = 'right'; c.fillText(this.w.name.toUpperCase(), W - 10, 17); c.textAlign = 'left'; }

    const pts = [...(this.ideal || []), ...this.mine];
    const maxX = Math.max(4, ...pts.map((p) => Math.abs(p[0]))) + 1;
    const maxY = Math.max(8, ...pts.map((p) => p[1])) + 1.5;
    const top = 30, bottom = H - 38, left = 10, right = W - 10;
    const s = Math.min((right - left) / (2 * maxX), (bottom - top) / (maxY + 1));
    const ox = W / 2, oy = bottom - s;
    const X = (v) => ox + v * s, Y = (v) => oy - v * s;

    c.strokeStyle = 'rgba(232,226,214,0.08)';
    c.lineWidth = 1;
    const step = maxY > 20 ? 5 : 2;
    for (let v = -Math.floor(maxX / step) * step; v <= maxX; v += step) { c.beginPath(); c.moveTo(X(v), top); c.lineTo(X(v), bottom); c.stroke(); }
    for (let v = 0; v <= maxY; v += step) { c.beginPath(); c.moveTo(left, Y(v)); c.lineTo(right, Y(v)); c.stroke(); }
    c.strokeStyle = 'rgba(226,86,61,0.9)';
    c.beginPath(); c.moveTo(ox - 5, oy); c.lineTo(ox + 5, oy); c.moveTo(ox, oy - 5); c.lineTo(ox, oy + 5); c.stroke();

    if (this.ideal) {
      c.strokeStyle = 'rgba(200,195,185,0.35)';
      c.beginPath();
      this.ideal.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
      c.stroke();
      c.fillStyle = 'rgba(200,195,185,0.75)';
      this.ideal.forEach(([x, y], i) => {
        c.beginPath(); c.arc(X(x), Y(y), 2.2, 0, 7); c.fill();
        if ((i + 1) % 10 === 0) c.fillText(String(i + 1), X(x) + 5, Y(y) + 4);
      });
    } else {
      c.fillStyle = '#7d7568';
      c.fillText(t('trainerPunch'), 10, top + 14);
    }
    c.fillStyle = '#ff7a3c';
    for (const [x, y] of this.mine) { c.beginPath(); c.arc(X(x), Y(y), 2.6, 0, 7); c.fill(); }

    // legenda + desvio médio (graus e cm a 25 m)
    c.fillStyle = 'rgba(200,195,185,0.75)';
    c.fillRect(10, H - 22, 7, 7);
    c.fillStyle = '#a59d8e';
    c.fillText(t('trainerIdeal'), 21, H - 15);
    c.fillStyle = '#ff7a3c';
    c.fillRect(110, H - 22, 7, 7);
    c.fillStyle = '#a59d8e';
    c.fillText(t(this.ideal ? 'trainerComp' : 'trainerYou'), 121, H - 15);
    if (this.mine.length > 1) {
      const errs = this.errs?.length === this.mine.length ? this.errs : this.mine;
      const avg = errs.reduce((a, [x, y]) => a + Math.hypot(x, y), 0) / errs.length;
      const cm = Math.tan(avg * Math.PI / 180) * 2500;
      c.fillStyle = '#e8e2d6';
      c.fillText(`${t('trainerScore')}: ${avg.toFixed(2)}° (${cm.toFixed(0)} cm @25 m)`, 10, H - 2 - 32 + 4);
    }
  }
}
