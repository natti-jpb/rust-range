import * as THREE from 'three';

// Modelos de caixa no formato do Minecraft: cada caixa tem tamanho (w,h,d) em pixels e offset (u,v) na
// skin, com o layout padrão [direita | frente | esquerda | trás] e topo/fundo em cima. 1 px = 1/16 m.
// Assim a versão local pode usar as skins reais (entity/<mob>.png) sem mudar a geometria.
const PX = 1 / 16;

function boxUV(geo, w, h, d, u, v, TW, TH, mirror) {
  // ordem das faces do BoxGeometry: +x, -x, +y, -y, +z, -z (o modelo olha para +z; a direita dele é -x)
  const R = {
    px: [u + d + w, v + d, d, h], // esquerda do modelo
    nx: [u, v + d, d, h], // direita do modelo
    py: [u + d, v, w, d],
    ny: [u + d + w, v, w, d],
    pz: [u + d, v + d, w, h], // frente
    nz: [u + 2 * d + w, v + d, w, h], // trás
  };
  if (mirror) [R.px, R.nx] = [R.nx, R.px];
  const uv = geo.attributes.uv;
  ['px', 'nx', 'py', 'ny', 'pz', 'nz'].forEach((k, f) => {
    const [rx, ry, rw, rh] = R[k];
    for (let i = 0; i < 4; i++) {
      let uu = uv.getX(f * 4 + i), vv = uv.getY(f * 4 + i);
      if (mirror) uu = 1 - uu;
      uv.setXY(f * 4 + i, (rx + uu * rw) / TW, 1 - (ry + (1 - vv) * rh) / TH);
    }
  });
  uv.needsUpdate = true;
}

// part: { name, size:[w,h,d], uv:[u,v], pivot:[x,y,z] (px, pés em y=0), offset:[x,y,z] do centro relativo ao pivô, mirror, rot }
export function buildModel(def, tex) {
  const root = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, toneMapped: false });
  const parts = {};
  for (const p of def.parts) {
    const [w, h, d] = p.size;
    const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
    boxUV(geo, w, h, d, p.uv[0], p.uv[1], def.tw, def.th, p.mirror);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...(p.offset || [0, 0, 0]).map((v) => v * PX));
    mesh.name = p.name;
    mesh.userData.zone = p.zone || 'body';
    const pivot = new THREE.Group();
    pivot.position.set(...p.pivot.map((v) => v * PX));
    if (p.rot) pivot.rotation.set(...p.rot);
    pivot.add(mesh);
    root.add(pivot);
    parts[p.name] = pivot;
  }
  root.scale.setScalar(def.scale || 1);
  return { root, parts, mat };
}

// Humanoide (zumbi/esqueleto): pernas 0–12 px, tronco 12–24, cabeça 24–32, ombros a 22 px.
const humanoid = (arm, leg, extra = {}) => [
  { name: 'head', size: [8, 8, 8], uv: [0, 0], pivot: [0, 24, 0], offset: [0, 4, 0], zone: 'head' },
  { name: 'body', size: [8, 12, 4], uv: [16, 16], pivot: [0, 24, 0], offset: [0, -6, 0] },
  { name: 'rarm', size: [arm, 12, arm], uv: [40, 16], pivot: [-6, 22, 0], offset: [0, -4, 0] },
  { name: 'larm', size: [arm, 12, arm], uv: extra.larm || [40, 16], mirror: !extra.larm, pivot: [6, 22, 0], offset: [0, -4, 0] },
  { name: 'rleg', size: [leg, 12, leg], uv: [0, 16], pivot: [-2, 12, 0], offset: [0, -6, 0], zone: 'legs' },
  { name: 'lleg', size: [leg, 12, leg], uv: extra.lleg || [0, 16], mirror: !extra.lleg, pivot: [2, 12, 0], offset: [0, -6, 0], zone: 'legs' },
];

export const MODELS = {
  zombie: { tw: 64, th: 64, scale: 0.97, parts: humanoid(4, 4, { larm: [32, 48], lleg: [16, 48] }) },
  skeleton: { tw: 64, th: 32, scale: 0.97, parts: humanoid(2, 2) },
  creeper: {
    tw: 64, th: 32, scale: 1, parts: [
      { name: 'head', size: [8, 8, 8], uv: [0, 0], pivot: [0, 18, 0], offset: [0, 4, 0], zone: 'head' },
      { name: 'body', size: [8, 12, 4], uv: [16, 16], pivot: [0, 18, 0], offset: [0, -6, 0] },
      { name: 'leg1', size: [4, 6, 4], uv: [0, 16], pivot: [-2, 6, 4], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg2', size: [4, 6, 4], uv: [0, 16], pivot: [2, 6, 4], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg3', size: [4, 6, 4], uv: [0, 16], pivot: [-2, 6, -4], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg4', size: [4, 6, 4], uv: [0, 16], pivot: [2, 6, -4], offset: [0, -3, 0], zone: 'legs' },
    ],
  },
  pig: {
    tw: 64, th: 64, scale: 1, parts: [
      { name: 'head', size: [8, 8, 8], uv: [0, 0], pivot: [0, 12, 6], offset: [0, 0, 4], zone: 'head' },
      { name: 'snout', size: [4, 3, 1], uv: [16, 16], pivot: [0, 12, 6], offset: [0, -1, 8.5], zone: 'head' },
      { name: 'body', size: [10, 16, 8], uv: [28, 8], pivot: [0, 11, 0], offset: [0, 0, 0], rot: [Math.PI / 2, 0, 0] },
      { name: 'leg1', size: [4, 6, 4], uv: [0, 16], pivot: [-3, 6, 7], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg2', size: [4, 6, 4], uv: [0, 16], pivot: [3, 6, 7], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg3', size: [4, 6, 4], uv: [0, 16], pivot: [-3, 6, -5], offset: [0, -3, 0], zone: 'legs' },
      { name: 'leg4', size: [4, 6, 4], uv: [0, 16], pivot: [3, 6, -5], offset: [0, -3, 0], zone: 'legs' },
    ],
  },
};

// Baú (ChestModel): base 14×10×14 em texOffs(0,19), tampa 14×5×14 em (0,0) com dobradiça em y=9/z=1,
// trinco 2×4×1 em (0,0). Bloco-entidade não tem o flip das entidades (Rx(π) em relação ao boxUV), então
// cada caixa recebe o boxUV e depois gira π em X. Frente (trinco) em +z; tex 64×64 (entity/chest/normal.png).
export function buildChest(tex) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.1, toneMapped: false });
  const box = (w, h, d, u, v, x, y, z) => {
    const geo = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
    boxUV(geo, w, h, d, u, v, 64, 64, false);
    geo.rotateX(Math.PI);
    const m = new THREE.Mesh(geo, mat);
    m.position.set((x + w / 2) * PX, (y + h / 2) * PX, (z + d / 2) * PX);
    return m;
  };
  const root = new THREE.Group(), lid = new THREE.Group();
  root.add(box(14, 10, 14, 0, 19, 1, 0, 1));
  lid.position.set(0, 9 * PX, 1 * PX);
  lid.add(box(14, 5, 14, 0, 0, 1, 0, 0), box(2, 4, 1, 0, 0, 7, -2, 14));
  root.add(lid);
  return { root, lid };
}

// ---------- skins procedurais no layout do Minecraft ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function skin(w, h, seed, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const r = rng(seed);
  const box = (u, v, bw, bh, bd, col, k = 18) => {
    for (const [rx, ry, rw, rh] of [[u + bd, v, bw, bd], [u + bd + bw, v, bw, bd], [u, v + bd, bd, bh], [u + bd, v + bd, bw, bh], [u + bd + bw, v + bd, bd, bh], [u + 2 * bd + bw, v + bd, bw, bh]]) {
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
        const d = (r() - 0.5) * k;
        g.fillStyle = `rgb(${col[0] + d | 0},${col[1] + d | 0},${col[2] + d | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    }
  };
  const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
  draw({ box, px, g });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}

export const SKINS = {
  zombie: () => skin(64, 64, 11, ({ box, px }) => {
    const G = [92, 140, 70];
    box(0, 0, 8, 8, 8, G); box(16, 16, 8, 12, 4, [40, 150, 160]); box(40, 16, 4, 12, 4, G); box(32, 48, 4, 12, 4, G);
    box(0, 16, 4, 12, 4, [60, 60, 140]); box(16, 48, 4, 12, 4, [60, 60, 140]);
    for (const x of [9, 10, 13, 14]) px(x, 12, '#0d1f0d'); // olhos (frente da cabeça: 8..16, 8..16)
    for (let x = 10; x < 14; x++) px(x, 14, '#2e4a24');
  }),
  skeleton: () => skin(64, 32, 23, ({ box, px }) => {
    const W = [196, 196, 196];
    box(0, 0, 8, 8, 8, W); box(16, 16, 8, 12, 4, [170, 170, 170], 40); box(40, 16, 2, 12, 2, W); box(0, 16, 2, 12, 2, W);
    for (const [x, y] of [[9, 11], [10, 11], [13, 11], [14, 11], [11, 13], [12, 13]]) px(x, y, '#2a2a2a');
    for (let x = 9; x < 15; x++) px(x, 14, x % 2 ? '#2a2a2a' : '#9a9a9a');
  }),
  creeper: () => skin(64, 32, 37, ({ box, px }) => {
    const C = [80, 170, 70];
    box(0, 0, 8, 8, 8, C, 60); box(16, 16, 8, 12, 4, C, 60); box(0, 16, 4, 6, 4, C, 60);
    for (const [x, y] of [[9, 10], [10, 10], [13, 10], [14, 10], [9, 11], [10, 11], [13, 11], [14, 11], [11, 12], [12, 12], [10, 13], [11, 13], [12, 13], [13, 13], [10, 14], [13, 14]]) px(x, y, '#111');
  }),
  pig: () => skin(64, 64, 41, ({ box, px }) => {
    const P = [240, 160, 160];
    box(0, 0, 8, 8, 8, P, 12); box(16, 16, 4, 3, 1, [230, 130, 140], 8); box(28, 8, 10, 16, 8, P, 12); box(0, 16, 4, 6, 4, P, 12);
    px(9, 11, '#fff'); px(10, 11, '#222'); px(13, 11, '#222'); px(14, 11, '#fff');
  }),
};
