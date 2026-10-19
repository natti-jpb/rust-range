import * as THREE from 'three';
import { bullseyeTexture, sprayWallTexture } from './textures.js';

// Multiplicadores por região: aproximação (cabeça ×2, pernas ×0,5).
const ZONE = { head: 2, body: 1, legs: 0.5 };

export class Targets {
  constructor(scene, hit, mats) {
    this.scene = scene;
    this.hit = hit;
    this.mats = mats;
    this.list = [];
    this.burlap = new THREE.MeshStandardMaterial({ color: 0x9c8460, roughness: 1 });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.45, metalness: 0.8 });
    this.eye = new THREE.MeshStandardMaterial({ map: bullseyeTexture(), roughness: 0.9 });

    this.sprayWall(0, -25, 6, 5);
    this.sprayWall(-11, -10, 4, 3);
    for (const [x, z] of [[8, -15], [12, -30], [16, -50], [10, -75], [18, -100], [14, -150]]) this.reactive(x, z);
    for (const [x, z, strafe] of [[-6, -20, 0], [-15, -40, 3.5], [5, -60, 0], [-19, -80, 4.5], [-8, -120, 0], [7, -170, 3]]) this.dummy(x, z, strafe);
    for (const [x, z, s] of [[24, -100, 0.6], [22, -150, 0.8], [20, -200, 1]]) this.gong(x, z, s);
  }

  mesh(geo, mat, kind, owner, zone) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    Object.assign(m.userData, { kind, target: owner, zone });
    this.hit.push(m);
    return m;
  }

  sprayWall(x, z, w, h) {
    const t = { type: 'wall', x, z, w, h };
    const mat = new THREE.MeshStandardMaterial({ map: sprayWallTexture(w, h), roughness: 0.75, metalness: 0.3 });
    const m = this.mesh(new THREE.BoxGeometry(w, h, 0.06), [this.mats.metal, this.mats.metal, this.mats.metal, this.mats.metal, mat, this.mats.metal], 'metal', t, 'wall');
    m.position.set(x, h / 2, z);
    this.scene.add(m);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, h + 0.3, 0.15), this.mats.wood);
      post.position.set(x + sx * (w / 2 + 0.08), (h + 0.3) / 2, z - 0.05);
      post.castShadow = true;
      this.scene.add(post);
    }
    this.list.push(t);
  }

  reactive(x, z) {
    const t = { type: 'reactive', down: 0, fall: 0, timer: 0 };
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.75, 0.07), this.mats.wood);
    post.position.y = 0.375;
    post.castShadow = true;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.5), this.mats.wood);
    base.position.y = 0.03;
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.75, 0);
    const disk = this.mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 28), [this.mats.wood, this.eye, this.mats.wood], 'wood', t, 'plate');
    disk.rotation.x = Math.PI / 2;
    disk.position.y = 0.34;
    hinge.add(disk);
    g.add(post, base, hinge);
    this.scene.add(g);
    t.hinge = hinge;
    t.disk = disk;
    this.list.push(t);
  }

  dummy(x, z, strafe) {
    const t = { type: 'dummy', hp: 100, x, z, strafe, phase: Math.random() * 6, dead: 0 };
    const g = new THREE.Group();
    const parts = [
      ['legs', [0.16, 0.86, 0.2], [-0.11, 0.43, 0]], ['legs', [0.16, 0.86, 0.2], [0.11, 0.43, 0]],
      ['body', [0.46, 0.62, 0.26], [0, 1.17, 0]],
      ['body', [0.12, 0.6, 0.14], [-0.31, 1.15, 0]], ['body', [0.12, 0.6, 0.14], [0.31, 1.15, 0]],
      ['head', [0.24, 0.27, 0.26], [0, 1.63, 0]],
    ];
    for (const [zone, s, p] of parts) {
      const m = this.mesh(new THREE.BoxGeometry(...s), this.burlap, 'flesh', t, zone);
      m.position.set(...p);
      g.add(m);
    }
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.06), new THREE.MeshBasicMaterial({ color: 0x8fb35b }));
    bar.position.set(0, 1.95, 0);
    g.add(bar);
    g.position.set(x, 0, z);
    this.scene.add(g);
    Object.assign(t, { group: g, bar });
    this.list.push(t);
  }

  gong(x, z, s) {
    const t = { type: 'gong', swing: 0, vel: 0 };
    const frame = this.mats.wood;
    const h = 1.6 + s;
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), frame);
      post.position.set(x + sx * (s / 2 + 0.25), h / 2, z);
      post.castShadow = true;
      this.scene.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(s + 0.6, 0.1, 0.1), frame);
    beam.position.set(x, h, z);
    this.scene.add(beam);
    const pivot = new THREE.Group();
    pivot.position.set(x, h, z);
    const plate = this.mesh(new THREE.BoxGeometry(s, s, 0.025), this.steel, 'metal', t, 'plate');
    plate.position.y = -0.25 - s / 2;
    pivot.add(plate);
    this.scene.add(pivot);
    t.pivot = pivot;
    this.list.push(t);
  }

  // Devolve o resultado para HUD/áudio: { dmg, head, kill, ring }
  onHit(mesh, point, dmg) {
    const t = mesh.userData.target;
    if (!t) return null;
    if (t.type === 'dummy') {
      if (t.dead) return null;
      const d = dmg * ZONE[mesh.userData.zone];
      t.hp -= d;
      const kill = t.hp <= 0;
      if (kill) { t.dead = 3; t.hp = 0; }
      t.bar.scale.x = Math.max(0.001, t.hp / 100);
      return { dmg: d, head: mesh.userData.zone === 'head', kill };
    }
    if (t.type === 'reactive') {
      if (t.down) return null;
      const local = t.disk.worldToLocal(point.clone());
      const ring = Math.min(6, Math.floor(Math.hypot(local.x, local.z) / (0.32 / 6)));
      t.down = 1;
      t.timer = 2.5;
      return { dmg, ring: 6 - ring };
    }
    if (t.type === 'gong') {
      t.vel += 2.5 * Math.sign(Math.random() - 0.3);
      return { dmg, gong: true };
    }
    return { dmg, wall: true };
  }

  update(dt, now) {
    for (const t of this.list) {
      if (t.type === 'reactive') {
        const goal = t.down ? -Math.PI / 2 : 0;
        t.fall += (goal - t.fall) * Math.min(1, dt * (t.down ? 14 : 5));
        t.hinge.rotation.x = t.fall;
        if (t.down && (t.timer -= dt) <= 0) t.down = 0;
      } else if (t.type === 'gong') {
        t.vel += (-t.swing * 30 - t.vel * 1.8) * dt;
        t.swing += t.vel * dt;
        t.pivot.rotation.x = t.swing * 0.35;
      } else if (t.type === 'dummy') {
        if (t.strafe) {
          // ADAD irregular: muda de lado em intervalos variáveis
          t.phase += dt * (1.6 + Math.sin(now * 0.7 + t.x) * 0.6);
          t.group.position.x = t.x + Math.sin(t.phase) * t.strafe;
        }
        if (t.dead) {
          t.dead -= dt;
          t.group.rotation.x = Math.max(-Math.PI / 2, t.group.rotation.x - dt * 6);
          if (t.dead <= 0) { t.dead = 0; t.hp = 100; t.bar.scale.x = 1; t.group.rotation.x = 0; }
        }
      }
    }
  }
}
