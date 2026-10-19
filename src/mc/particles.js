import * as THREE from 'three';
import { MC_BASE } from './sounds.js';

// Partículas de explosão do Minecraft (particle/explosion_0..15.png, 16 quadros):
// HugeExplosionParticle: vida 6–9 ticks, tamanho 2·(1 − r·0,5), cinza r·0,6 + 0,4 (4 tons: um material por quadro e tom).
// HugeExplosionSeedParticle (potência ≥ 2): por 8 ticks solta 6 por tick a ±4 blocos.
const TICK = 1 / 20;

export class McParticles {
  constructor(scene) {
    this.scene = scene;
    const load = new THREE.TextureLoader();
    const GREYS = [0.47, 0.62, 0.78, 0.93];
    this.mats = Array.from({ length: 16 }, (_, i) => {
      const t = load.load(`${MC_BASE}particle/explosion_${i}.png`);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      return GREYS.map((g) => new THREE.SpriteMaterial({ map: t, color: new THREE.Color(g, g, g), alphaTest: 0.1, fog: true, toneMapped: false }));
    });
    this.list = [];
    this.seeds = [];
    this.acc = 0;
  }

  spawn(x, y, z) {
    const tone = (Math.random() * 4) | 0;
    const s = new THREE.Sprite(this.mats[0][tone]);
    const r = Math.random();
    s.position.set(x, y, z);
    s.scale.setScalar(2 * (1 - r * 0.5));
    this.scene.add(s);
    this.list.push({ s, tone, age: 0, life: 6 + ((Math.random() * 4) | 0) });
  }

  // potência ≥ 2: emissor; senão um único quadro (Explosion.finalizeExplosion)
  explosion(pos, power = 4) {
    if (power >= 2) this.seeds.push({ pos: pos.clone(), age: 0 });
    else this.spawn(pos.x, pos.y, pos.z);
  }

  update(dt) {
    this.acc += dt;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      for (let i = this.seeds.length - 1; i >= 0; i--) {
        const e = this.seeds[i];
        for (let k = 0; k < 6; k++) {
          const r = () => (Math.random() - Math.random()) * 4;
          this.spawn(e.pos.x + r(), e.pos.y + r(), e.pos.z + r());
        }
        if (++e.age >= 8) this.seeds.splice(i, 1);
      }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        if (++p.age >= p.life) { this.scene.remove(p.s); this.list.splice(i, 1); continue; }
        p.s.material = this.mats[Math.min(15, ((p.age * 15) / p.life) | 0)][p.tone];
      }
    }
  }
}
