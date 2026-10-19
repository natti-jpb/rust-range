import { GUNS, settings, save } from './config.js';
import { t, lang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

export class Menu {
  constructor({ onPlay, onMode, onWeapon, onSettings }) {
    this.el = $('menu');
    $('play').addEventListener('click', onPlay);
    $('touchwarn').hidden = !matchMedia('(hover: none) and (pointer: coarse)').matches;
    $('modeSeg').addEventListener('click', (e) => {
      const m = e.target.closest('button')?.dataset.mode;
      if (m) { onMode(m); this.refresh(); }
    });
    const grid = $('weaponGrid');
    GUNS.forEach((g, i) => {
      const b = document.createElement('button');
      b.dataset.id = g.id;
      b.innerHTML = `<span>${g.name}</span><kbd>${KEYS[i] ?? ''}</kbd>`;
      b.addEventListener('click', () => { onWeapon(g.id); this.refresh(); });
      grid.append(b);
    });
    const bind = (id, key, fmt, num = true) => {
      const el = $(id), out = $(id + 'Out');
      const set = () => { if (out) out.textContent = fmt(settings[key]); };
      if (el.type === 'checkbox') el.checked = key === 'lang' ? settings.lang === 'en' : !!settings[key];
      else el.value = settings[key];
      set();
      el.addEventListener('input', () => {
        if (el.type === 'checkbox') settings[key] = key === 'lang' ? (el.checked ? 'en' : 'pt') : el.checked;
        else settings[key] = num ? Number(el.value) : el.value;
        set();
        save();
        onSettings(key);
        if (key === 'lang') this.texts();
      });
    };
    bind('sens', 'sens', (v) => v.toFixed(2));
    bind('fov', 'fov', (v) => `${v}°`);
    bind('vol', 'vol', (v) => `${Math.round(v * 100)}%`);
    bind('adsToggle', 'adsToggle', String);
    bind('showTrainer', 'showTrainer', String);
    bind('mobs', 'mobs', String);
    bind('lang', 'lang', String);
    if (!settings.lang) $('lang').checked = !navigator.language?.startsWith('pt');
    this.texts();
  }

  texts() {
    document.documentElement.lang = lang() === 'pt' ? 'pt-BR' : 'en';
    for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
    if (this.local) document.querySelector('footer').textContent = t('disclaimerLocal');
    $('how').innerHTML = t('how');
    if (this.started) $('play').textContent = t('resume');
    this.refresh();
  }

  refresh() {
    for (const b of $('modeSeg').children) b.classList.toggle('on', b.dataset.mode === settings.mode);
    $('modeNote').textContent = t(settings.mode === 'legacy' ? 'legacyNote' : 'currentNote');
    for (const b of $('weaponGrid').children) b.classList.toggle('on', b.dataset.id === settings.weapon);
  }

  show(on) {
    this.el.hidden = !on;
    if (on) this.refresh();
  }

  markStarted() {
    this.started = true;
    $('play').textContent = t('resume');
  }
}
