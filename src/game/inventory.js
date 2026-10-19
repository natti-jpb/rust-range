import { gun } from './config.js';
import { kind, maxStack, makeItem, canAttach } from './items.js';

// Containers do jogador como no Rust: main 24 slots (6×4), belt 6. Mods ficam no container da própria arma.
export class Container {
  constructor(name, size, accept = null) {
    this.name = name;
    this.slots = Array(size).fill(null);
    this.accept = accept; // (item, index) => bool
  }
}

export const modContainer = (weapon) => ({ name: 'mods', owner: weapon, slots: weapon.mods, accept: (it, i) => canAttach(weapon, it, i) });

export class Inventory {
  constructor() {
    this.main = new Container('main', 24);
    this.belt = new Container('belt', 6);
    this.active = -1; // slot do belt na mão
    this.listeners = [];
  }

  changed() { for (const f of this.listeners) f(); }
  get held() { return this.active >= 0 ? this.belt.slots[this.active] : null; }

  *all() {
    for (const c of [this.main, this.belt]) for (let i = 0; i < c.slots.length; i++) if (c.slots[i]) yield [c, i, c.slots[i]];
  }

  count(id) {
    let n = 0;
    for (const [, , it] of this.all()) if (it.id === id) n += it.amount;
    return n;
  }

  // Tira até n unidades (main primeiro, como ItemContainer.Take); devolve quanto tirou.
  take(id, n) {
    let got = 0;
    for (const [c, i, it] of this.all()) {
      if (it.id !== id || got >= n) continue;
      const k = Math.min(it.amount, n - got);
      it.amount -= k;
      got += k;
      if (it.amount <= 0) c.slots[i] = null;
    }
    if (got) this.changed();
    return got;
  }

  // GiveItem / GetIdealPickupContainer: empilháveis completam pilhas existentes; armas vão para o belt.
  give(item) {
    const max = maxStack(item.id);
    if (max > 1) {
      for (const [, , it] of this.all()) {
        if (it.id !== item.id || it.amount >= max) continue;
        const k = Math.min(max - it.amount, item.amount);
        it.amount += k;
        item.amount -= k;
        if (!item.amount) { this.changed(); return true; }
      }
    }
    const order = kind(item.id) === 'weapon' ? [this.belt, this.main] : [this.main, this.belt];
    for (const c of order) {
      const i = c.slots.indexOf(null);
      if (i >= 0) { c.slots[i] = item; this.changed(); return true; }
    }
    this.changed();
    return false;
  }

  // Arrastar de (src, si) para (dst, di). amount: dividir pilha. Junta pilhas iguais, senão troca.
  move(src, si, dst, di, amount = null) {
    const a = src.slots[si];
    if (!a || (src === dst && si === di)) return false;
    if (dst.owner === a) return false; // arma dentro dela mesma
    const b = dst.slots[di];
    if (dst.accept && !dst.accept(a, di)) return false;
    const max = maxStack(a.id), n = Math.min(amount ?? a.amount, a.amount);
    if (b && b.id === a.id && max > 1) {
      const k = Math.min(n, max - b.amount);
      if (!k) return false;
      b.amount += k;
      a.amount -= k;
      if (!a.amount) src.slots[si] = null;
    } else if (b) {
      if (n < a.amount || (src.accept && !src.accept(b, si))) return false;
      src.slots[si] = b;
      dst.slots[di] = a;
    } else if (n < a.amount) {
      dst.slots[di] = makeItem(a.id, n);
      a.amount -= n;
    } else {
      dst.slots[di] = a;
      src.slots[si] = null;
    }
    this.changed();
    return true;
  }

  // Soltar um mod em cima de uma arma: vai para o primeiro slot livre que aceite.
  attach(src, si, weapon) {
    const mc = modContainer(weapon);
    for (let i = 0; i < mc.slots.length; i++) if (!mc.slots[i] && mc.accept(src.slots[si], i)) return this.move(src, si, mc, i);
    return false;
  }

  // Equipa a arma pelo id (menu): seleciona no belt, ou traz do main, ou cria uma nova.
  equip(id) {
    let i = this.belt.slots.findIndex((it) => it?.id === id);
    if (i < 0) {
      const j = this.main.slots.findIndex((it) => it?.id === id);
      const slot = this.active >= 0 ? this.active : Math.max(0, this.belt.slots.indexOf(null));
      if (j >= 0) this.move(this.main, j, this.belt, slot);
      else if (gun(id)) {
        const old = this.belt.slots[slot];
        this.belt.slots[slot] = makeItem(id);
        if (old) this.give(old);
      }
      i = slot;
    }
    this.active = i;
    this.changed();
  }
}
