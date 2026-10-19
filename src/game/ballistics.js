import * as THREE from 'three';
import { holeTexture } from './textures.js';

const G = 9.81;
const STEP = 1 / 120;
const _dir = new THREE.Vector3();

// Projéteis simulados como no Rust: v += g·gravityModifier·dt; v -= v·drag·dt.
// Colisão: DDA no mundo de blocos + caixas dos mobs (entities.raycast).
export class Ballistics {
  constructor(scene, world, entities, onImpact) {
    this.scene = scene;
    this.world = world;
    this.entities = entities;
    this.onImpact = onImpact;
    this.list = [];
    this.fx = new Effects(scene);
  }

  fire(origin, dir, w, owner = null) {
    this.list.push({ pos: origin.clone(), vel: dir.clone().multiplyScalar(w.velocity), w, owner, dist: 0, age: 0, tracer: this.fx.tracer() });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      let left = dt, done = false;
      while (left > 0 && !done) {
        const h = Math.min(STEP, left);
        left -= h;
        p.vel.y -= G * p.w.gravity * h;
        p.vel.multiplyScalar(1 - p.w.drag * h);
        const step = p.vel.length() * h;
        _dir.copy(p.vel).normalize();
        const b = this.world.raycast(p.pos, _dir, step);
        const e = this.entities?.raycast(p.pos, _dir, step, p.owner);
        let hitPoint = null;
        if (e && (!b || e.dist < b.dist)) hitPoint = { point: e.point, normal: e.normal, object: e.object, mob: e.mob, part: e.part, dist: p.dist + e.dist };
        else if (b) hitPoint = { point: b.point, normal: b.normal, object: null, block: b, dist: p.dist + b.dist };
        if (hitPoint) {
          p.pos.copy(hitPoint.point);
          this.onImpact(hitPoint, p.w);
          done = true;
        } else {
          p.pos.addScaledVector(_dir, step);
          p.dist += step;
        }
      }
      p.age += dt;
      this.fx.moveTracer(p.tracer, p.pos, _dir.copy(p.vel).normalize(), p.dist);
      if (done || p.age > 3 || p.pos.y < -10) {
        this.fx.freeTracer(p.tracer);
        this.list.splice(i, 1);
      }
    }
    this.fx.update(dt);
  }
}

// Dano com queda por distância: lerp(mult.x, mult.y, invLerp(dist.x, dist.y, d)).
export function falloff(w, d) {
  const [d0, d1] = w.damageDistances, [m0, m1] = w.damageMultipliers;
  const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
  return w.damage * (m0 + (m1 - m0) * t);
}

const KIND_FX = {
  metal: { color: [1, 0.78, 0.4], n: 10, speed: 5, spark: true },
  wood: { color: [0.55, 0.4, 0.25], n: 8, speed: 2.5 },
  dirt: { color: [0.42, 0.35, 0.26], n: 14, speed: 2 },
  flesh: { color: [0.55, 0.08, 0.06], n: 10, speed: 1.5 },
  stone: { color: [0.5, 0.5, 0.5], n: 12, speed: 2.5 },
  sand: { color: [0.85, 0.8, 0.6], n: 14, speed: 2 },
  glass: { color: [0.8, 0.9, 0.95], n: 14, speed: 3 },
  cloth: { color: [0.92, 0.92, 0.9], n: 10, speed: 1.5 },
  smoke: { color: [0.75, 0.75, 0.75], n: 1, speed: 3 },
};

class Effects {
  constructor(scene) {
    this.scene = scene;
    const holeMap = holeTexture();
    const holeMat = (opacity) => new THREE.MeshBasicMaterial({ map: holeMap, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.holeNew = holeMat(1);
    this.holeOld = holeMat(0.3);
    this.holeGeo = new THREE.PlaneGeometry(0.045, 0.045);
    this.holes = [];
    this.wallHoles = [];
    this.byBlock = {};

    // Partículas (CPU): faíscas aditivas + poeira
    this.parts = [];
    for (const additive of [true, false]) {
      const N = 400;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const mat = new THREE.PointsMaterial({ size: additive ? 0.05 : 0.09, vertexColors: true, transparent: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      scene.add(pts);
      this.parts.push({ pts, N, data: Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3() })), next: 0, additive });
    }

    // Traçantes
    this.TN = 48;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.TN * 6), 3));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    this.freeT = Array.from({ length: this.TN }, (_, i) => i);
  }

  tracer() { return this.freeT.length ? this.freeT.pop() : -1; }

  freeTracer(i) {
    if (i < 0) return;
    this.tracers.geometry.attributes.position.array.fill(0, i * 6, i * 6 + 6);
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.freeT.push(i);
  }

  moveTracer(i, pos, dir, dist) {
    if (i < 0) return;
    const a = this.tracers.geometry.attributes.position.array;
    const len = Math.min(Math.max(dist - 4, 0), 7); // só aparece depois de 4 m
    a[i * 6] = pos.x - dir.x * len; a[i * 6 + 1] = pos.y - dir.y * len; a[i * 6 + 2] = pos.z - dir.z * len;
    a[i * 6 + 3] = pos.x; a[i * 6 + 4] = pos.y; a[i * 6 + 5] = pos.z;
    this.tracers.geometry.attributes.position.needsUpdate = true;
  }

  // Furo colado no objeto atingido (acompanha alvos que caem/balançam).
  hole(hit, onWall) {
    const m = new THREE.Mesh(this.holeGeo, this.holeNew);
    const parent = hit.object || this.scene;
    const p = hit.point.clone().addScaledVector(hit.normal, 0.004);
    m.position.copy(p);
    m.lookAt(p.clone().add(hit.normal));
    m.rotateZ(Math.random() * 6.28);
    const s = 0.8 + Math.random() * 0.5;
    m.scale.set(s, s, s);
    if (hit.object) parent.attach(m); else this.scene.add(m);
    if (hit.block) {
      const key = `${hit.block.x},${hit.block.y},${hit.block.z}`;
      m.userData.block = key;
      (this.byBlock[key] ??= []).push(m);
    }
    this.holes.push(m);
    if (onWall) this.wallHoles.push(m);
    if (this.holes.length > 700) this.drop(this.holes.shift());
  }

  // bloco quebrou: some com os furos dele
  clearBlock(key) {
    for (const m of this.byBlock[key] || []) {
      m.removeFromParent();
      this.holes.splice(this.holes.indexOf(m), 1);
      const i = this.wallHoles.indexOf(m);
      if (i >= 0) this.wallHoles.splice(i, 1);
    }
    delete this.byBlock[key];
  }

  drop(m) {
    if (m.userData.block) this.byBlock[m.userData.block] = this.byBlock[m.userData.block]?.filter((x) => x !== m);
    m.removeFromParent();
    const i = this.wallHoles.indexOf(m);
    if (i >= 0) this.wallHoles.splice(i, 1);
  }

  // explosão: muita fumaça e lascas em todas as direções
  explosion(c) {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) {
      const n = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.burst(c.clone().addScaledVector(n, Math.random() * 1.5), n, 'stone');
      this.burst(c, up, 'dirt');
    }
  }

  fadeWall() { for (const m of this.wallHoles) m.material = this.holeOld; }

  clearWall() {
    for (const m of this.wallHoles) {
      m.removeFromParent();
      this.holes.splice(this.holes.indexOf(m), 1);
    }
    this.wallHoles.length = 0;
  }

  burst(point, normal, kind) {
    const k = KIND_FX[kind] || KIND_FX.dirt;
    const sys = this.parts[k.spark ? 0 : 1];
    for (let i = 0; i < k.n; i++) {
      const d = sys.data[sys.next];
      sys.next = (sys.next + 1) % sys.N;
      d.life = k.spark ? 0.25 + Math.random() * 0.25 : 0.5 + Math.random() * 0.6;
      d.max = d.life;
      d.p.copy(point).addScaledVector(normal, 0.02);
      d.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(k.speed * 0.8)
        .addScaledVector(normal, k.speed * (0.4 + Math.random()));
      d.c = k.color;
      d.g = k.spark ? 9.8 : 3;
    }
  }

  update(dt) {
    for (const sys of this.parts) {
      const pos = sys.pts.geometry.attributes.position.array, col = sys.pts.geometry.attributes.color.array;
      sys.data.forEach((d, i) => {
        if (d.life <= 0) { pos[i * 3 + 1] = -999; return; }
        d.life -= dt;
        d.v.y -= d.g * dt;
        d.v.multiplyScalar(1 - 2.5 * dt);
        d.p.addScaledVector(d.v, dt);
        pos[i * 3] = d.p.x; pos[i * 3 + 1] = d.p.y; pos[i * 3 + 2] = d.p.z;
        const f = sys.additive ? d.life / d.max : 1;
        col[i * 3] = d.c[0] * f; col[i * 3 + 1] = d.c[1] * f; col[i * 3 + 2] = d.c[2] * f;
      });
      sys.pts.geometry.attributes.position.needsUpdate = true;
      sys.pts.geometry.attributes.color.needsUpdate = true;
    }
  }
}
