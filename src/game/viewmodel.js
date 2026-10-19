import * as THREE from 'three';
import { woodTexture, flashTexture } from './textures.js';

// Armas em primeira pessoa feitas de primitivas (nenhum modelo do jogo).
// Frame local: cano para -Z, +Y para cima, origem no gatilho. Metros.
const M = {
  dark: new THREE.MeshStandardMaterial({ color: 0x27282a, roughness: 0.5, metalness: 0.65 }),
  worn: new THREE.MeshStandardMaterial({ color: 0x6e695f, roughness: 0.6, metalness: 0.5 }),
  poly: new THREE.MeshStandardMaterial({ color: 0x1d1d1e, roughness: 0.7, metalness: 0.1 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x4a4c36, roughness: 0.8, metalness: 0.1 }),
  tan: new THREE.MeshStandardMaterial({ color: 0x6f5e44, roughness: 0.85 }),
  wood: new THREE.MeshStandardMaterial({ map: woodTexture(), color: 0xb0794a, roughness: 0.65 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xa97e64, roughness: 0.85 }),
};

class B {
  constructor() { this.g = new THREE.Group(); }
  box(m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M[m]);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    this.g.add(o);
    return o;
  }
  cyl(m, r, len, x, y, z, seg = 14) {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), M[m]);
    o.rotation.x = Math.PI / 2;
    o.position.set(x, y, z);
    this.g.add(o);
    return o;
  }
}

// Cada modelo devolve { muzzle, grip, fore, mag } (mãos e pente em coordenadas locais).
const MODELS = {
  ak(b) {
    b.box('dark', 0.055, 0.085, 0.36, 0, 0.02, -0.05);
    b.box('dark', 0.05, 0.02, 0.3, 0, 0.07, -0.04);
    b.box('wood', 0.045, 0.09, 0.28, 0, -0.005, 0.27, 0.1);
    b.box('dark', 0.05, 0.12, 0.02, 0, -0.03, 0.41, 0.1);
    b.box('wood', 0.04, 0.1, 0.045, 0, -0.075, 0.06, -0.35);
    b.box('wood', 0.06, 0.055, 0.19, 0, 0.0, -0.31);
    b.box('wood', 0.045, 0.03, 0.16, 0, 0.05, -0.31);
    b.cyl('dark', 0.011, 0.26, 0, 0.02, -0.53);
    b.box('dark', 0.018, 0.05, 0.03, 0, 0.05, -0.6);
    b.cyl('dark', 0.014, 0.05, 0, 0.02, -0.68);
    b.box('dark', 0.03, 0.02, 0.04, 0, 0.085, -0.22);
    const mag = new THREE.Group();
    [[-0.06, -0.12, 0.15], [-0.13, -0.105, 0.3], [-0.2, -0.08, 0.45]].forEach(([y, z, r]) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.07), M.worn);
      s.position.set(0, y, z); s.rotation.x = r; mag.add(s);
    });
    b.g.add(mag);
    return { muzzle: [0, 0.02, -0.71], grip: [0, -0.08, 0.06], fore: [0, -0.01, -0.3], mag };
  },
  lr(b) {
    b.box('poly', 0.05, 0.06, 0.3, 0, 0.03, -0.05);
    b.box('poly', 0.03, 0.03, 0.22, 0, 0.075, -0.06);
    b.box('poly', 0.05, 0.05, 0.15, 0, -0.02, 0);
    b.cyl('poly', 0.028, 0.26, 0, 0.03, -0.33);
    b.cyl('dark', 0.009, 0.2, 0, 0.03, -0.55);
    b.box('dark', 0.015, 0.07, 0.02, 0, 0.07, -0.45);
    b.box('poly', 0.035, 0.08, 0.24, 0, 0.0, 0.22);
    b.box('poly', 0.035, 0.09, 0.04, 0, -0.07, 0.05, -0.3);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.16, 0.06), M.poly);
    m.position.set(0, -0.1, -0.1); m.rotation.x = 0.12; mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.03, -0.66], grip: [0, -0.08, 0.05], fore: [0, 0.0, -0.32], mag };
  },
  mp5(b) {
    b.cyl('dark', 0.03, 0.3, 0, 0.02, -0.08);
    b.box('poly', 0.055, 0.05, 0.15, 0, 0.0, -0.26);
    b.cyl('dark', 0.009, 0.08, 0, 0.02, -0.38);
    b.cyl('dark', 0.018, 0.03, 0, 0.065, -0.32);
    b.box('dark', 0.03, 0.025, 0.03, 0, 0.065, 0.03);
    b.box('poly', 0.035, 0.1, 0.045, 0, -0.06, 0.05, -0.25);
    b.box('dark', 0.008, 0.008, 0.2, 0.02, 0.02, 0.18);
    b.box('dark', 0.008, 0.008, 0.2, -0.02, 0.02, 0.18);
    b.box('poly', 0.045, 0.1, 0.02, 0, 0.0, 0.29);
    const mag = new THREE.Group();
    [[-0.06, -0.14, 0.2], [-0.14, -0.12, 0.35]].forEach(([y, z, r]) => {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.09, 0.04), M.dark);
      s.position.set(0, y, z); s.rotation.x = r; mag.add(s);
    });
    b.g.add(mag);
    return { muzzle: [0, 0.02, -0.43], grip: [0, -0.07, 0.05], fore: [0, -0.02, -0.26], mag };
  },
  thompson(b) {
    b.box('dark', 0.05, 0.07, 0.24, 0, 0.02, -0.04);
    b.box('wood', 0.04, 0.1, 0.3, 0, -0.01, 0.25, 0.12);
    b.box('wood', 0.035, 0.1, 0.045, 0, -0.06, 0.07, -0.3);
    b.box('wood', 0.035, 0.09, 0.04, 0, -0.05, -0.22, -0.1);
    b.cyl('dark', 0.017, 0.22, 0, 0.03, -0.28);
    b.cyl('dark', 0.015, 0.05, 0, 0.03, -0.42);
    b.box('dark', 0.015, 0.03, 0.02, 0, 0.06, -0.4);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.17, 0.05), M.dark);
    m.position.set(0, -0.1, -0.1); mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.03, -0.45], grip: [0, -0.07, 0.07], fore: [0, -0.07, -0.22], mag };
  },
  custom(b) {
    b.box('worn', 0.05, 0.06, 0.3, 0, 0.02, -0.05);
    b.cyl('worn', 0.014, 0.22, 0, 0.03, -0.3);
    b.box('worn', 0.008, 0.008, 0.2, 0, 0.03, 0.2);
    b.box('worn', 0.008, 0.008, 0.2, 0, -0.05, 0.2);
    b.box('worn', 0.02, 0.1, 0.02, 0, -0.01, 0.3);
    b.box('wood', 0.035, 0.1, 0.045, 0, -0.06, 0.05, -0.25);
    b.box('worn', 0.012, 0.025, 0.012, 0, 0.065, -0.38);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.15, 0.045), M.dark);
    m.position.set(0, -0.09, -0.12); mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.03, -0.42], grip: [0, -0.07, 0.05], fore: [0, 0.0, -0.25], mag };
  },
  m249(b) {
    b.box('dark', 0.07, 0.1, 0.32, 0, 0.02, -0.05);
    b.box('dark', 0.07, 0.03, 0.18, 0, 0.085, 0);
    b.cyl('dark', 0.013, 0.38, 0, 0.02, -0.4);
    b.box('worn', 0.04, 0.03, 0.16, 0, 0.05, -0.27);
    b.box('poly', 0.07, 0.05, 0.12, 0, -0.01, -0.22);
    b.box('poly', 0.05, 0.1, 0.26, 0, -0.01, 0.27);
    b.box('dark', 0.02, 0.04, 0.12, 0, 0.11, -0.13);
    b.box('poly', 0.035, 0.1, 0.045, 0, -0.07, 0.08, -0.3);
    b.box('dark', 0.015, 0.06, 0.02, 0, 0.06, -0.55);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.12), M.olive);
    m.position.set(-0.01, -0.09, -0.06); mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.02, -0.6], grip: [0, -0.08, 0.08], fore: [0, -0.03, -0.22], mag };
  },
  sar(b) {
    b.box('wood', 0.05, 0.06, 0.5, 0, 0.0, -0.12);
    b.box('wood', 0.05, 0.1, 0.24, 0, -0.03, 0.27, 0.12);
    b.box('dark', 0.045, 0.05, 0.22, 0, 0.035, -0.05);
    b.cyl('dark', 0.01, 0.32, 0, 0.035, -0.4);
    b.box('dark', 0.015, 0.04, 0.02, 0, 0.06, -0.54);
    b.box('dark', 0.02, 0.02, 0.03, 0, 0.07, 0.02);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 0.08), M.dark);
    m.position.set(0, -0.06, -0.06); mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.035, -0.57], grip: [0, -0.05, 0.08], fore: [0, -0.02, -0.28], mag };
  },
  m39(b) {
    b.box('olive', 0.052, 0.065, 0.52, 0, 0.0, -0.12);
    b.box('olive', 0.05, 0.11, 0.25, 0, -0.03, 0.27, 0.1);
    b.box('dark', 0.045, 0.05, 0.24, 0, 0.035, -0.05);
    b.box('dark', 0.025, 0.02, 0.2, 0, 0.07, -0.04);
    b.cyl('dark', 0.011, 0.3, 0, 0.035, -0.45);
    b.cyl('dark', 0.015, 0.05, 0, 0.035, -0.6);
    b.box('olive', 0.035, 0.09, 0.04, 0, -0.07, 0.06, -0.3);
    const mag = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.08), M.dark);
    m.position.set(0, -0.08, -0.07); mag.add(m);
    b.g.add(mag);
    return { muzzle: [0, 0.035, -0.63], grip: [0, -0.08, 0.06], fore: [0, -0.02, -0.3], mag };
  },
  python(b) {
    b.box('worn', 0.03, 0.06, 0.1, 0, 0.02, -0.02);
    b.cyl('worn', 0.022, 0.045, 0, 0.02, -0.04, 6);
    b.cyl('worn', 0.011, 0.16, 0, 0.035, -0.15);
    b.box('worn', 0.015, 0.012, 0.16, 0, 0.05, -0.15);
    b.box('wood', 0.032, 0.1, 0.04, 0, -0.05, 0.04, -0.35);
    const mag = new THREE.Group();
    b.g.add(mag);
    return { muzzle: [0, 0.035, -0.24], grip: [0, -0.05, 0.04], fore: [0, -0.06, 0.02], mag, pistol: true };
  },
  p250(b) {
    b.box('dark', 0.028, 0.035, 0.19, 0, 0.035, -0.07);
    b.box('poly', 0.026, 0.03, 0.15, 0, 0.005, -0.06);
    b.box('poly', 0.03, 0.1, 0.045, 0, -0.05, 0.02, -0.25);
    const mag = new THREE.Group();
    b.g.add(mag);
    return { muzzle: [0, 0.035, -0.17], grip: [0, -0.05, 0.02], fore: [0, -0.06, 0.0], mag, pistol: true };
  },
  m92(b) {
    b.box('dark', 0.028, 0.035, 0.21, 0, 0.035, -0.08);
    b.box('worn', 0.026, 0.03, 0.16, 0, 0.005, -0.07);
    b.box('wood', 0.031, 0.1, 0.047, 0, -0.05, 0.02, -0.25);
    const mag = new THREE.Group();
    b.g.add(mag);
    return { muzzle: [0, 0.035, -0.19], grip: [0, -0.05, 0.02], fore: [0, -0.06, 0.0], mag, pistol: true };
  },
};

function arm(group, hand, elbow) {
  const h = new THREE.Vector3(...hand), e = new THREE.Vector3(...elbow);
  const len = h.distanceTo(e);
  const fore = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.066, len), M.skin);
  fore.position.copy(h).add(e).multiplyScalar(0.5);
  fore.lookAt(e);
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.085, 0.1), M.skin);
  palm.position.copy(h);
  palm.lookAt(e);
  group.add(fore, palm);
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xd6dfe6, 0x6b5f4b, 2.4));
    const d = new THREE.DirectionalLight(0xfff0d8, 3.2);
    d.position.set(-0.5, 1, 0.8);
    this.scene.add(d);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.models = {};
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.s = { ads: 0, sprint: 0, kick: 0, kickV: 0, rot: 0, rotV: 0, swayX: 0, swayY: 0, bob: 0, flashT: 0 };
  }

  get(model) {
    if (!this.models[model]) {
      const b = new B();
      const info = MODELS[model](b);
      // Linha de visada = topo das peças atrás da massa de mira; massa fina até essa altura.
      const bb = new THREE.Box3();
      let top = 0;
      for (const o of b.g.children) {
        if (!o.isMesh) continue;
        bb.setFromObject(o);
        if (bb.min.z > info.muzzle[2] + 0.12) top = Math.max(top, bb.max.y);
      }
      info.sightY = top + 0.004;
      const y0 = info.muzzle[1];
      b.box('dark', 0.005, info.sightY - y0, 0.006, 0, (info.sightY + y0) / 2, info.muzzle[2] + 0.06);
      arm(b.g, info.grip, [0.2, -0.34, 0.26]);
      arm(b.g, info.fore, info.pistol ? [-0.16, -0.34, 0.26] : [-0.3, -0.36, 0.02]);
      // Peças atrás do rosto (coronha, antebraços) somem no ADS para não cobrir a tela
      b.g.traverse((o) => { o.castShadow = false; if (o.isMesh && o.position.z > 0.14) o.userData.rear = true; });
      this.models[model] = { group: b.g, ...info };
    }
    return this.models[model];
  }

  show(w) {
    this.root.clear();
    this.cur = this.get(w.model);
    this.root.add(this.cur.group);
    this.cur.group.add(this.flash);
    this.rearHidden = null;
    this.flash.position.set(...this.cur.muzzle).add(new THREE.Vector3(0, 0, -0.04));
  }

  shot(strength = 1) {
    this.s.kickV += 1.6 * strength;
    this.s.rotV += 2.4 * strength;
    this.s.flashT = 0.045;
    this.flash.material.rotation = Math.random() * 6.28;
    const k = 0.11 + Math.random() * 0.07;
    this.flash.scale.set(k, k, k);
  }

  // st: { aiming, sprint, speed, dx, dy, reload (0..1|null), deploy (0..1) }
  update(dt, st) {
    const s = this.s, c = this.cur;
    if (!c) return;
    s.ads += ((st.aiming ? 1 : 0) - s.ads) * Math.min(1, dt * 14);
    s.sprint += ((st.sprint ? 1 : 0) - s.sprint) * Math.min(1, dt * 8);
    // molas do kick
    s.kickV += (-s.kick * 260 - s.kickV * 22) * dt; s.kick += s.kickV * dt;
    s.rotV += (-s.rot * 220 - s.rotV * 20) * dt; s.rot += s.rotV * dt;
    s.swayX += (-st.dx * 0.0005 - s.swayX) * Math.min(1, dt * 10);
    s.swayY += (st.dy * 0.0005 - s.swayY) * Math.min(1, dt * 10);
    s.bob += dt * st.speed * 1.9;
    const bobK = Math.min(1, st.speed / 5) * (1 - s.ads * 0.85);

    const hip = c.pistol ? [0.13, -0.16, -0.44] : [0.17, -0.2, -0.56];
    const ads = [0, -c.sightY, c.pistol ? -0.4 : -0.42];
    const g = c.group;
    g.position.set(
      hip[0] + (ads[0] - hip[0]) * s.ads + s.swayX + Math.sin(s.bob) * 0.008 * bobK + s.sprint * 0.03,
      hip[1] + (ads[1] - hip[1]) * s.ads + s.swayY + Math.abs(Math.cos(s.bob)) * 0.01 * bobK - s.sprint * 0.04,
      hip[2] + (ads[2] - hip[2]) * s.ads + s.kick * 0.035,
    );
    g.rotation.set(s.rot * 0.05 - s.sprint * 0.25, (1 - s.ads) * 0.04 + s.sprint * 0.75, s.sprint * 0.2);

    if (st.reload != null) {
      const p = st.reload, dip = Math.sin(Math.min(1, p * 1.15) * Math.PI);
      g.position.y -= 0.07 * dip;
      g.rotation.x += 0.45 * dip;
      g.rotation.z += 0.35 * dip;
      const out = p < 0.2 ? p / 0.2 : p < 0.55 ? 1 : p < 0.75 ? 1 - (p - 0.55) / 0.2 : 0;
      c.mag.position.y = -0.22 * out;
      c.mag.visible = !(p > 0.35 && p < 0.5);
    } else {
      c.mag.position.y = 0;
      c.mag.visible = true;
    }
    if (st.deploy < 1) {
      const k = (1 - st.deploy) ** 2;
      g.position.y -= 0.25 * k;
      g.rotation.x -= 0.9 * k;
    }
    const hideRear = s.ads > 0.6;
    if (hideRear !== this.rearHidden) {
      this.rearHidden = hideRear;
      g.traverse((o) => { if (o.userData.rear) o.visible = !hideRear; });
    }
    s.flashT -= dt;
    this.flash.visible = s.flashT > 0;
  }
}
