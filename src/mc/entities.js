import * as THREE from 'three';
import { B, BLOCKS } from './blocks.js';
import { buildModel, MODELS, SKINS } from './models.js';

// Física e IA no estilo do Minecraft, em ticks de 20/s (unidades: blocos por tick).
// LivingEntity.travel: gravidade 0,08 e arrasto 0,98 no Y; atrito 0,6·0,91 no chão e 0,91 no ar;
// aceleração no chão = speed·0,16277136/atrito³, no ar 0,02; pulo 0,42.
const TICK = 1 / 20;
const HP = 5; // 1 ponto de vida do Minecraft = 5 de dano do Rust (zumbi: 20 → 100)

const TYPES = {
  zombie: { w: 0.6, h: 1.95, hp: 20, speed: 0.23, follow: 35, attack: 3, hostile: true, eye: 1.74 },
  skeleton: { w: 0.6, h: 1.99, hp: 20, speed: 0.25, follow: 16, hostile: true, ranged: true, eye: 1.74 },
  creeper: { w: 0.6, h: 1.7, hp: 20, speed: 0.25, follow: 16, hostile: true, creeper: true, eye: 1.45 },
  pig: { w: 0.9, h: 0.9, hp: 10, speed: 0.25, passive: true, eye: 0.7 },
};

const _ray = new THREE.Ray(), _box = new THREE.Box3(), _inv = new THREE.Matrix4(), _p = new THREE.Vector3();

class Mob {
  constructor(type, pos, skin) {
    this.type = type;
    this.t = TYPES[type];
    this.pos = pos.clone();
    this.prev = pos.clone();
    this.motion = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.prevYaw = this.yaw;
    this.hp = this.t.hp * HP;
    this.ground = false;
    this.input = { fwd: 0, jump: false };
    this.hurtT = 0;
    this.dead = 0;
    this.cool = 0;
    this.fuse = 0;
    this.walk = 0;
    this.wander = 0;
    const m = buildModel(MODELS[type], skin);
    this.model = m.root;
    this.parts = m.parts;
    this.mat = m.mat;
    this.model.traverse((o) => { if (o.isMesh) { o.userData.mob = this; } });
  }

  get center() { return _p.set(this.pos.x, this.pos.y + this.t.h / 2, this.pos.z); }
}

export class Entities {
  constructor(scene, world, hooks) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks; // { hurtPlayer(dmg, from), sound(name, pos), fx(kind, pos), drop(mob) }
    this.mobs = [];
    this.arrows = [];
    this.falling = [];
    this.tnt = [];
    this.items = [];
    this.acc = 0;
    this.skins = {};
    this.enabled = true;
    this.maxHostile = 8;
    this.blockGeo = new THREE.BoxGeometry(0.98, 0.98, 0.98);
    world.listeners.push((x, y, z) => this.checkFall(x, y + 1, z));
  }

  skin(type) { return (this.skins[type] ??= SKINS[type]()); }

  spawn(type, pos) {
    const m = new Mob(type, pos, this.skin(type));
    this.scene.add(m.model);
    this.mobs.push(m);
    return m;
  }

  // posição de spawn na superfície entre r0 e r1 do jogador
  spawnAround(type, player, r0, r1) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const x = Math.floor(player.pos.x + Math.cos(a) * r), z = Math.floor(player.pos.z + Math.sin(a) * r);
      const y = this.world.top(x, z);
      const ground = this.world.get(x, y - 1, z);
      if (ground !== B.GRASS && ground !== B.SAND && ground !== B.DIRT) continue;
      if (this.world.get(x, y, z) !== B.AIR || this.world.get(x, y + 1, z) !== B.AIR) continue;
      return this.spawn(type, new THREE.Vector3(x + 0.5, y, z + 0.5));
    }
    return null;
  }

  update(dt, player) {
    this.player = player;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n++ < 5) { this.acc -= TICK; this.tick(); }
    const a = this.acc / TICK;
    for (const m of this.mobs) this.render(m, a);
    for (const f of this.falling) f.mesh.position.lerpVectors(f.prev, f.pos, a).add(new THREE.Vector3(0, 0.49, 0));
    for (const t of this.tnt) t.mesh.position.lerpVectors(t.prev, t.pos, a).add(new THREE.Vector3(0, 0.49, 0));
    for (const ar of this.arrows) ar.mesh.position.lerpVectors(ar.prev, ar.pos, a);
    for (const it of this.items) {
      it.mesh.position.lerpVectors(it.prev, it.pos, a);
      it.mesh.position.y += 0.15 + Math.sin(it.age * 0.15) * 0.06;
      it.mesh.rotation.y += dt * 1.5;
    }
  }

  tick() {
    const p = this.player;
    if (this.enabled) {
      const hostile = this.mobs.filter((m) => m.t.hostile && !m.dead).length;
      if (hostile < this.maxHostile && Math.random() < 0.015) {
        const r = Math.random();
        this.spawnAround(r < 0.5 ? 'zombie' : r < 0.78 ? 'skeleton' : 'creeper', p, 24, 46);
      }
      if (this.mobs.filter((m) => m.type === 'pig').length < 6 && Math.random() < 0.02) this.spawnAround('pig', p, 16, 60);
    }
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      m.prev.copy(m.pos);
      m.prevYaw = m.yaw;
      if (m.dead) {
        if (++m.dead > 20) { this.remove(m); this.mobs.splice(i, 1); }
        continue;
      }
      if (m.pos.distanceTo(p.pos) > 110 || m.pos.y < -10) { this.remove(m); this.mobs.splice(i, 1); continue; }
      this.ai(m, p);
      this.physics(m);
      if (m.hurtT > 0) m.hurtT--;
      if (m.cool > 0) m.cool--;
    }
    this.tickArrows();
    this.tickFalling();
    this.tickTnt();
    this.tickItems();
  }

  // ---------- IA ----------
  ai(m, p) {
    const t = m.t;
    const toP = new THREE.Vector3().subVectors(p.pos, m.pos);
    const dist = toP.length();
    const alive = p.alive !== false;
    m.input.fwd = 0;
    m.input.jump = false;
    if (t.passive) {
      if (m.panic > 0) { m.panic--; m.input.fwd = 1.4; if (Math.random() < 0.05) m.yaw += (Math.random() - 0.5) * 2; }
      else if (--m.wander <= 0) { m.wander = 60 + Math.random() * 120; m.walking = Math.random() < 0.5; m.yaw += (Math.random() - 0.5) * 3; }
      else if (m.walking) m.input.fwd = 0.6;
      if (m.hitWall) m.input.jump = true;
      return;
    }
    const sees = alive && dist < t.follow && (dist < 6 || this.sight(m, p));
    if (!sees) {
      if (--m.wander <= 0) { m.wander = 80 + Math.random() * 120; m.walking = Math.random() < 0.4; m.yaw += (Math.random() - 0.5) * 2; }
      if (m.walking) m.input.fwd = 0.5;
      if (m.hitWall) m.input.jump = true;
      if (t.creeper) m.fuse = Math.max(0, m.fuse - 1);
      return;
    }
    const want = Math.atan2(toP.x, toP.z);
    let dy = want - m.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.yaw += Math.max(-0.5, Math.min(0.5, dy));
    if (t.ranged) {
      // esqueleto: mantém 6–12 blocos e atira a cada 2 s (40 ticks)
      m.input.fwd = dist > 12 ? 1 : dist < 6 ? -0.7 : 0;
      m.strafe = (m.strafe ?? 1) * (Math.random() < 0.02 ? -1 : 1);
      m.input.side = dist < 14 ? m.strafe * 0.5 : 0;
      if (m.cool <= 0 && dist < 16) { m.cool = 40; this.shootArrow(m, p); }
    } else if (t.creeper) {
      if (dist < 3) m.fuse++;
      else { m.fuse = Math.max(0, m.fuse - 1); m.input.fwd = 1; }
      if (m.fuse === 1) this.hooks.sound('creeper_fuse', m.pos);
      if (m.fuse >= 30) { this.explode(m.center.clone(), 3, m); m.dead = 21; m.hp = 0; return; }
    } else {
      m.input.fwd = 1;
      if (dist < 1.6 && Math.abs(p.pos.y - m.pos.y) < 1.5 && m.cool <= 0) {
        m.cool = 20;
        m.swing = 8;
        this.hooks.hurtPlayer(t.attack * HP, m);
      }
    }
    if (m.hitWall) m.input.jump = true;
  }

  sight(m, p) {
    const eye = new THREE.Vector3(m.pos.x, m.pos.y + m.t.eye, m.pos.z);
    const to = new THREE.Vector3(p.pos.x, p.eye, p.pos.z).sub(eye);
    const d = to.length();
    return !this.world.raycast(eye, to.normalize(), d, (id) => BLOCKS[id].opaque);
  }

  // ---------- física (LivingEntity.travel) ----------
  physics(m) {
    if (m.input.jump && m.ground) { m.motion.y = 0.42; m.ground = false; }
    const fr = m.ground ? 0.6 * 0.91 : 0.91;
    const accel = m.ground ? m.t.speed * (0.16277136 / (fr * fr * fr)) : 0.02;
    const f = m.input.fwd || 0, s = m.input.side || 0;
    if (f || s) {
      const len = Math.max(1, Math.hypot(f, s));
      const sin = Math.sin(m.yaw), cos = Math.cos(m.yaw);
      m.motion.x += ((f * sin + s * cos) / len) * accel;
      m.motion.z += ((f * cos - s * sin) / len) * accel;
    }
    const before = m.motion.clone();
    const hit = this.world.moveBox(m.pos, m.t.w / 2, m.t.h, m.motion.clone());
    m.hitWall = (hit.x || hit.z) && m.ground;
    if (hit.x) m.motion.x = 0;
    if (hit.z) m.motion.z = 0;
    if (hit.y) m.motion.y = 0;
    const wasGround = m.ground;
    m.ground = !this.world.boxFree({ x: m.pos.x, y: m.pos.y - 0.04, z: m.pos.z }, m.t.w / 2, 0.04);
    if (m.ground && !wasGround && before.y < -0.6) this.damage(m, (Math.abs(before.y) * 20 - 3) * HP * 0.5, null);
    m.motion.y = (m.motion.y - 0.08) * 0.98;
    m.motion.x *= fr;
    m.motion.z *= fr;
    if (m.ground && m.motion.y < 0) m.motion.y = 0;
    m.walk += Math.hypot(m.pos.x - m.prev.x, m.pos.z - m.prev.z) * 4;
  }

  // ---------- render/animação ----------
  render(m, a) {
    m.model.position.lerpVectors(m.prev, m.pos, a);
    let yaw = m.prevYaw + Math.atan2(Math.sin(m.yaw - m.prevYaw), Math.cos(m.yaw - m.prevYaw)) * a;
    m.model.rotation.y = yaw;
    const sw = Math.sin(m.walk) * Math.min(1, Math.hypot(m.pos.x - m.prev.x, m.pos.z - m.prev.z) * 8) * 0.9;
    const P = m.parts;
    if (P.rleg) { P.rleg.rotation.x = sw; P.lleg.rotation.x = -sw; }
    if (P.leg1) { P.leg1.rotation.x = sw; P.leg4.rotation.x = sw; P.leg2.rotation.x = -sw; P.leg3.rotation.x = -sw; }
    if (m.type === 'zombie') { P.rarm.rotation.x = P.larm.rotation.x = -Math.PI / 2 + Math.sin(m.walk * 0.5) * 0.05 + (m.swing > 0 ? -0.4 : 0); if (m.swing > 0) m.swing--; }
    else if (m.type === 'skeleton') { P.rarm.rotation.x = -Math.PI / 2; P.larm.rotation.x = -sw * 0.6; }
    // dano: avermelha 0,5 s; creeper pisca e incha no pavio; morte: tomba para o lado
    const red = m.hurtT > 0 || m.dead;
    let col = red ? [1, 0.45, 0.45] : [1, 1, 1];
    if (m.fuse > 0) {
      const k = m.fuse / 30;
      if (Math.floor(m.fuse / 3) % 2) col = [1.6, 1.6, 1.6];
      m.model.scale.setScalar(MODELS.creeper.scale * (1 + k * 0.12));
    }
    m.mat.color.setRGB(...col);
    m.model.rotation.z = m.dead ? Math.min(Math.PI / 2, (m.dead + a) * 0.2) : 0;
  }

  remove(m) { this.scene.remove(m.model); }

  // ---------- dano ----------
  damage(m, dmg, from, dir) {
    if (m.dead || dmg <= 0) return { dmg: 0, kill: false };
    m.hp -= dmg;
    m.hurtT = 10;
    if (dir) { // empurrão (knockback 0,4)
      const k = new THREE.Vector3(dir.x, 0, dir.z).normalize().multiplyScalar(0.4);
      m.motion.x += k.x; m.motion.z += k.z; m.motion.y = Math.max(m.motion.y, 0.36);
      m.ground = false;
    }
    if (m.t.passive) m.panic = 100;
    this.hooks.sound(m.hp <= 0 ? `${m.type}_death` : `${m.type}_hurt`, m.pos);
    if (m.hp <= 0) { m.dead = 1; this.hooks.drop?.(m); return { dmg, kill: true }; }
    return { dmg, kill: false };
  }

  // raio contra as caixas de cada parte (no espaço local da peça)
  raycast(o, d, max, owner) {
    let best = null;
    for (const m of this.mobs) {
      if (m.dead || m === owner) continue;
      if (m.center.distanceTo(o) > max + 3) continue;
      m.model.updateMatrixWorld(true);
      m.model.traverse((mesh) => {
        if (!mesh.isMesh) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        _inv.copy(mesh.matrixWorld).invert();
        _ray.set(o, d).applyMatrix4(_inv);
        const hp = _ray.intersectBox(mesh.geometry.boundingBox, new THREE.Vector3());
        if (!hp) return;
        const w = hp.applyMatrix4(mesh.matrixWorld);
        const dist = w.distanceTo(o);
        if (dist <= max && (!best || dist < best.dist)) best = { dist, point: w.clone(), normal: d.clone().negate(), mob: m, part: mesh.userData.zone, object: mesh };
      });
    }
    return best;
  }

  // ---------- flechas ----------
  shootArrow(m, p) {
    const eye = new THREE.Vector3(m.pos.x, m.pos.y + m.t.eye, m.pos.z);
    const tgt = new THREE.Vector3(p.pos.x, p.pos.y + 1.1, p.pos.z);
    const d = tgt.sub(eye);
    const horiz = Math.hypot(d.x, d.z);
    d.y += horiz * 0.2; // compensação da queda (AbstractSkeleton.performRangedAttack)
    d.normalize();
    const spread = 0.0075 * 6;
    d.x += (Math.random() - 0.5) * 2 * spread; d.y += (Math.random() - 0.5) * 2 * spread; d.z += (Math.random() - 0.5) * 2 * spread;
    const vel = d.normalize().multiplyScalar(1.6);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0x8b6a3e }));
    this.scene.add(mesh);
    this.arrows.push({ pos: eye.clone(), prev: eye.clone(), vel, mesh, life: 0, stuck: false });
    this.hooks.sound('bow', eye);
  }

  tickArrows() {
    const p = this.player;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.prev.copy(a.pos);
      if (++a.life > 400) { this.scene.remove(a.mesh); this.arrows.splice(i, 1); continue; }
      if (a.stuck) continue;
      const step = a.vel.length(), dir = a.vel.clone().normalize();
      const hit = this.world.raycast(a.pos, dir, step);
      // jogador: caixa 0,6 × altura
      const pb = new THREE.Box3(new THREE.Vector3(p.pos.x - 0.3, p.pos.y, p.pos.z - 0.3), new THREE.Vector3(p.pos.x + 0.3, p.pos.y + p.height, p.pos.z + 0.3));
      const ph = p.alive !== false && new THREE.Ray(a.pos, dir).intersectBox(pb, new THREE.Vector3());
      if (ph && ph.distanceTo(a.pos) <= step && (!hit || ph.distanceTo(a.pos) < hit.dist)) {
        this.hooks.hurtPlayer(Math.ceil(step * 2) * HP, null);
        this.scene.remove(a.mesh); this.arrows.splice(i, 1); continue;
      }
      if (hit) { a.pos.copy(hit.point); a.stuck = true; a.life = 340; this.hooks.sound('arrow_hit', a.pos); continue; }
      a.pos.add(a.vel);
      a.vel.multiplyScalar(0.99);
      a.vel.y -= 0.05;
      a.mesh.lookAt(a.pos.clone().add(a.vel));
    }
  }

  // ---------- blocos que caem (areia/cascalho) ----------
  checkFall(x, y, z) {
    const id = this.world.get(x, y, z);
    if (!BLOCKS[id]?.gravity || this.world.solid(x, y - 1, z)) return;
    this.world.set(x, y, z, B.AIR);
    const mesh = this.blockMesh(id);
    const pos = new THREE.Vector3(x + 0.5, y, z + 0.5);
    this.falling.push({ id, pos, prev: pos.clone(), vy: 0, mesh });
  }

  blockMesh(id) {
    const mesh = new THREE.Mesh(this.blockGeo, this.hooks.blockMaterial(id));
    this.scene.add(mesh);
    return mesh;
  }

  tickFalling() {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.prev.copy(f.pos);
      f.vy = (f.vy - 0.04) * 0.98;
      const ny = f.pos.y + f.vy;
      const bx = Math.floor(f.pos.x), bz = Math.floor(f.pos.z);
      if (this.world.solid(bx, Math.floor(ny), bz) || ny < 0) {
        const y = Math.floor(ny) + 1;
        this.world.set(bx, y, bz, f.id);
        this.scene.remove(f.mesh);
        this.falling.splice(i, 1);
        this.hooks.sound('place_' + BLOCKS[f.id].sound, f.pos);
      } else f.pos.y = ny;
    }
  }

  // ---------- TNT ----------
  primeTnt(x, y, z, fuse = 80) {
    this.world.set(x, y, z, B.AIR);
    const pos = new THREE.Vector3(x + 0.5, y, z + 0.5);
    this.tnt.push({ pos, prev: pos.clone(), vy: 0.2, fuse, mesh: this.blockMesh(B.TNT) });
    this.hooks.sound('tnt_fuse', pos);
  }

  tickTnt() {
    for (let i = this.tnt.length - 1; i >= 0; i--) {
      const t = this.tnt[i];
      t.prev.copy(t.pos);
      t.vy = (t.vy - 0.04) * 0.98;
      const ny = t.pos.y + t.vy;
      if (this.world.solid(Math.floor(t.pos.x), Math.floor(ny), Math.floor(t.pos.z))) { t.pos.y = Math.floor(ny) + 1; t.vy = 0; } else t.pos.y = ny;
      t.mesh.material = this.hooks.blockMaterial(B.TNT, Math.floor(t.fuse / 5) % 2 === 0);
      if (--t.fuse <= 0) {
        this.scene.remove(t.mesh);
        this.tnt.splice(i, 1);
        this.explode(t.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 4, null);
      }
    }
  }

  // ---------- explosão (Explosion: blocos numa esfera irregular + dano por distância) ----------
  // small: munição explosiva (sem o estrondo do Minecraft)
  explode(c, power, source, small = false) {
    const r = power * 1.1;
    const ix = Math.floor(c.x), iy = Math.floor(c.y), iz = Math.floor(c.z);
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y, z);
      if (d > r * (0.7 + Math.random() * 0.45)) continue;
      const bx = ix + x, by = iy + y, bz = iz + z;
      const id = this.world.get(bx, by, bz);
      if (!id || id === B.BEDROCK || BLOCKS[id].liquid || BLOCKS[id].container) continue;
      if (id === B.TNT) { this.primeTnt(bx, by, bz, 10 + (Math.random() * 20) | 0); continue; }
      this.world.set(bx, by, bz, B.AIR);
    }
    const reach = power * 2;
    const hurt = (pos, h) => {
      const d = new THREE.Vector3(pos.x, pos.y + h / 2, pos.z).distanceTo(c);
      if (d > reach) return 0;
      const impact = 1 - d / reach;
      return ((impact * impact + impact) / 2) * 7 * reach + 1; // pontos de vida do Minecraft
    };
    const p = this.player;
    const pd = hurt(p.pos, p.height);
    if (pd > 0) this.hooks.hurtPlayer(pd * HP, source, true);
    for (const m of this.mobs) {
      if (m === source || m.dead) continue;
      const md = hurt(m.pos, m.t.h);
      if (md > 0) this.damage(m, md * HP, source, new THREE.Vector3().subVectors(m.pos, c));
    }
    this.hooks.sound(small ? 'explode_small' : 'explode', c);
    this.hooks.fx(small ? 'explosion_small' : 'explosion', c);
  }

  // ---------- itens no chão ----------
  dropItem(pos, item, mesh, vel = null) {
    const it = { pos: pos.clone(), prev: pos.clone(), vel: vel ?? new THREE.Vector3((Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2), item, mesh, age: 0 };
    this.scene.add(mesh);
    this.items.push(it);
  }

  tickItems() {
    const p = this.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.prev.copy(it.pos);
      it.age++;
      it.vel.y = (it.vel.y - 0.04) * 0.98;
      const hit = this.world.moveBox(it.pos, 0.125, 0.25, it.vel.clone());
      if (hit.y) it.vel.y = 0;
      const ground = hit.y;
      it.vel.x *= ground ? 0.6 * 0.98 : 0.98;
      it.vel.z *= ground ? 0.6 * 0.98 : 0.98;
      if (it.age > 10 && p.alive !== false && it.pos.distanceTo(p.pos) < 1.6) {
        if (this.hooks.pickup(it.item)) { this.scene.remove(it.mesh); this.items.splice(i, 1); }
      } else if (it.age > 6000) { this.scene.remove(it.mesh); this.items.splice(i, 1); }
    }
  }
}
