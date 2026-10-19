import * as THREE from 'three';
import { B, BLOCKS } from './blocks.js';
import { makeNoise, hash3 } from './noise.js';

// Mundo de blocos finito (1 bloco = 1 m). Chunks de 16×16 colunas com malha própria.
export const SX = 192, SY = 64, SZ = 192, CH = 16;
export const SEA = 17;

// Sombreamento por face no estilo do Minecraft (topo claro, laterais e fundo mais escuros)
const FACES = [
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], shade: 1.0, key: 'top' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, key: 'bottom' },
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], shade: 0.6, key: 'side' },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], shade: 0.6, key: 'side' },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], shade: 0.8, key: 'side' },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], shade: 0.8, key: 'side' },
];
// UV de cada canto: u ao longo da face, v para cima nas laterais
for (const f of FACES) {
  const ax = f.n.findIndex((v) => v !== 0);
  const [ua, va] = ax === 1 ? [0, 2] : ax === 0 ? [2, 1] : [0, 1];
  // linha 0 da textura é o topo da imagem: v invertido
  f.uv = f.c.map((c) => [ax === 0 && f.n[0] < 0 ? 1 - c[ua] : ax === 2 && f.n[2] < 0 ? 1 - c[ua] : c[ua], 1 - c[va]]);
  // garante winding anti-horário visto de fora
  const [a, b, c] = f.c.map((v) => new THREE.Vector3(...v));
  const cross = b.clone().sub(a).cross(c.clone().sub(a));
  if (cross.dot(new THREE.Vector3(...f.n)) < 0) { f.c.reverse(); f.uv.reverse(); }
  f.t = [0, 1, 2].filter((i) => i !== ax);
}
const AO = [0.42, 0.62, 0.82, 1.0];

const VERT = /* glsl */`
attribute vec3 uvl; attribute vec3 color;
varying vec3 vUvl; varying vec3 vColor; varying float vDepth;
void main() {
  vUvl = uvl; vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray atlas; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float light; uniform float alpha;
varying vec3 vUvl; varying vec3 vColor; varying float vDepth;
void main() {
  vec4 c = texture(atlas, vUvl);
  if (c.a < 0.5 && alpha >= 1.0) discard;
  c.rgb *= vColor * light;
  c.rgb = mix(c.rgb, fogColor, smoothstep(fogNear, fogFar, vDepth));
  gl_FragColor = vec4(c.rgb, alpha < 1.0 ? c.a * alpha : 1.0);
  #include <colorspace_fragment>
}`;

export class VoxelWorld {
  constructor(scene, atlas, { seed = 1337, mcTextures = false } = {}) {
    this.scene = scene;
    this.data = new Uint8Array(SX * SY * SZ);
    this.seed = seed;
    this.mcTextures = mcTextures;
    this.listeners = [];
    const uniforms = () => ({ atlas: { value: atlas }, fogColor: { value: new THREE.Color() }, fogNear: { value: 60 }, fogFar: { value: 180 }, light: { value: 1 }, alpha: { value: 1 } });
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms() });
    this.waterMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: uniforms(), transparent: true, depthWrite: false });
    this.waterMat.uniforms.alpha.value = 0.8;
    this.chunks = new Map();
    this.dirty = new Set();
    this.generate();
    for (let cx = 0; cx < SX / CH; cx++) for (let cz = 0; cz < SZ / CH; cz++) this.dirty.add(cx + ',' + cz);
    this.remesh(Infinity);
  }

  setFog(color, near, far) {
    for (const m of [this.mat, this.waterMat]) {
      m.uniforms.fogColor.value.copy(color);
      m.uniforms.fogNear.value = near;
      m.uniforms.fogFar.value = far;
    }
  }

  idx(x, y, z) { return (y * SZ + z) * SX + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ; }
  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (!this.inside(x, y, z)) return B.AIR;
    return this.data[this.idx(x, y, z)];
  }
  solid(x, y, z) { return BLOCKS[this.get(x, y, z)].solid; }
  opaque(x, y, z) { return BLOCKS[this.get(x, y, z)].opaque; }

  set(x, y, z, id) {
    if (!this.inside(x, y, z)) return;
    const i = this.idx(x, y, z);
    const old = this.data[i];
    if (old === id) return;
    this.data[i] = id;
    const cx = (x / CH) | 0, cz = (z / CH) | 0;
    this.dirty.add(cx + ',' + cz);
    if (x % CH === 0) this.dirty.add(cx - 1 + ',' + cz);
    if (x % CH === CH - 1) this.dirty.add(cx + 1 + ',' + cz);
    if (z % CH === 0) this.dirty.add(cx + ',' + (cz - 1));
    if (z % CH === CH - 1) this.dirty.add(cx + ',' + (cz + 1));
    for (const f of this.listeners) f(x, y, z, old, id);
  }

  // altura do bloco sólido mais alto (y do topo)
  top(x, z) {
    for (let y = SY - 1; y >= 0; y--) if (this.solid(x, y, z)) return y + 1;
    return 0;
  }

  // ---------- geração ----------
  generate() {
    const n = makeNoise(this.seed), n2 = makeNoise(this.seed + 99);
    const cx = SX / 2, cz = SZ / 2, flat = 26;
    const heights = new Int16Array(SX * SZ);
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      let h = 22 + n.fbm(x / 70, z / 70, 4) * 9 + n2.fbm(x / 22, z / 22, 2) * 2.5;
      const d = Math.hypot(x - cx, z - (cz - 20));
      const k = Math.min(1, Math.max(0, (d - 34) / 22)); // planalto do range perto do spawn
      h = 23 * (1 - k) + h * k;
      heights[z * SX + x] = Math.max(4, Math.min(SY - 12, Math.round(h)));
    }
    for (let z = 0; z < SZ; z++) for (let x = 0; x < SX; x++) {
      const h = heights[z * SX + x];
      const beach = h <= SEA + 1;
      for (let y = 0; y < Math.max(h, SEA + 1); y++) {
        let id;
        if (y === 0) id = B.BEDROCK;
        else if (y < h - 4) {
          const r = hash3(x, y, z, this.seed);
          id = r < 0.012 && y < 30 ? B.COAL : r < 0.018 && y < 18 ? B.IRON : B.STONE;
        } else if (y < h - 1) id = beach ? B.SAND : B.DIRT;
        else if (y === h - 1) id = beach ? (hash3(x, 0, z, 3) < 0.25 ? B.GRAVEL : B.SAND) : B.GRASS;
        else id = B.WATER;
        this.data[this.idx(x, y, z)] = id;
      }
    }
    // árvores fora do planalto
    for (let z = 3; z < SZ - 3; z++) for (let x = 3; x < SX - 3; x++) {
      const h = heights[z * SX + x];
      if (h <= SEA + 1 || this.data[this.idx(x, h - 1, z)] !== B.GRASS) continue;
      if (Math.hypot(x - cx, z - (cz - 20)) < 44) continue;
      if (hash3(x, 7, z, this.seed) > 0.012) continue;
      this.tree(x, h, z, 4 + ((hash3(x, 1, z) * 3) | 0));
    }
    this.buildRange(cx, flat - 3, cz);
  }

  tree(x, y, z, hgt) {
    for (let dy = hgt - 2; dy <= hgt + 1; dy++) {
      const r = dy >= hgt ? 1 : 2;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === hgt + 1 || hash3(x + dx, y + dy, z + dz) < 0.5)) continue;
        if (this.get(x + dx, y + dy, z + dz) === B.AIR) this.data[this.idx(x + dx, y + dy, z + dz)] = B.LEAVES;
      }
    }
    for (let dy = 0; dy < hgt; dy++) this.data[this.idx(x, y + dy, z)] = B.LOG;
  }

  // Range de tiro de blocos: linha de tiro de tábuas, parede de lã a 25 m, alvos e fardos de feno
  buildRange(cx, y, cz) {
    const put = (x, yy, z, id) => { if (this.inside(x, yy, z)) this.data[this.idx(x, yy, z)] = id; };
    for (let x = cx - 10; x <= cx + 10; x++) for (let z = cz; z <= cz + 5; z++) {
      put(x, y - 1, z, B.PLANKS);
      for (let yy = y; yy < y + 6; yy++) put(x, yy, z, B.AIR);
    }
    // mureta de pedregulho com abertura de 3 blocos no centro
    for (let x = cx - 10; x <= cx + 10; x++) {
      if (Math.abs(x - cx) <= 1) continue;
      put(x, y, cz, B.COBBLE);
      if ((x - cx) % 4 === 0) put(x, y + 1, cz, B.COBBLE);
    }
    const wall = (x0, z0, w, hgt, id) => { for (let x = x0; x < x0 + w; x++) for (let yy = y; yy < y + hgt; yy++) put(x, yy, z0, id); };
    wall(cx - 3, cz - 25, 6, 5, B.WOOL); // parede de spray: centro a 1,5 m de altura
    wall(cx - 13, cz - 10, 4, 3, B.WOOL);
    for (const [dx, dz] of [[8, -15], [12, -30], [16, -50], [10, -75], [18, -100]]) {
      put(cx + dx, y, cz + dz, B.HAY);
      put(cx + dx, y + 1, cz + dz, B.TARGET);
    }
    for (const [dx, dz] of [[-8, -40], [-16, -60], [4, -62], [-6, -90]]) {
      for (let i = 0; i < 3; i++) put(cx + dx + i, y, cz + dz, B.HAY);
      put(cx + dx + 1, y + 1, cz + dz, B.HAY);
    }
    for (let i = 0; i < 4; i++) put(cx - 20, y + i, cz - 30, B.GLASS);
    put(cx + 22, y, cz - 45, B.TNT); put(cx + 23, y, cz - 45, B.TNT); put(cx + 22, y + 1, cz - 45, B.TNT);
    this.spawn = new THREE.Vector3(cx + 0.5, y, cz + 3.5);
    this.rangeY = y;
  }

  // ---------- malha ----------
  remesh(budget = 2) {
    let n = 0;
    for (const key of this.dirty) {
      if (n++ >= budget) break;
      this.dirty.delete(key);
      const [cx, cz] = key.split(',').map(Number);
      if (cx < 0 || cz < 0 || cx >= SX / CH || cz >= SZ / CH) continue;
      this.buildChunk(cx, cz);
    }
  }

  buildChunk(cx, cz) {
    const out = { o: { p: [], u: [], c: [], i: [] }, w: { p: [], u: [], c: [], i: [] } };
    const tint = (b, key) => (this.mcTextures ? (key === 'top' && b.tintTop) || b.tint : null);
    for (let y = 0; y < SY; y++) for (let lz = 0; lz < CH; lz++) for (let lx = 0; lx < CH; lx++) {
      const x = cx * CH + lx, z = cz * CH + lz;
      const id = this.data[this.idx(x, y, z)];
      if (!id) continue;
      const b = BLOCKS[id];
      for (const f of FACES) {
        const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
        const nid = this.get(nx, ny, nz);
        if (nid !== B.AIR) {
          const nb = BLOCKS[nid];
          if (nb.opaque) continue;
          if (nid === id && !b.cutout) continue; // vidro/água contíguos: sem face interna
          if (b.liquid && nb.solid) continue;
          if (b.liquid && nid === id) continue;
        }
        if (b.liquid && f.n[1] === -1) continue;
        const g = b.liquid ? out.w : out.o;
        const base = g.p.length / 3;
        const L = b.faces[f.key];
        const tc = tint(b, f.key) ?? [1, 1, 1];
        const ao = [];
        for (let k = 0; k < 4; k++) {
          const c = f.c[k];
          let px = x + c[0], py = y + c[1], pz = z + c[2];
          if (b.liquid && f.n[1] === 1) py -= 0.12;
          g.p.push(px, py, pz);
          g.u.push(f.uv[k][0], f.uv[k][1], L);
          // AO: dois lados e a diagonal na camada à frente da face
          const [t1, t2] = f.t;
          const o1 = [0, 0, 0], o2 = [0, 0, 0];
          o1[t1] = c[t1] ? 1 : -1;
          o2[t2] = c[t2] ? 1 : -1;
          const bx = x + f.n[0], by = y + f.n[1], bz = z + f.n[2];
          const s1 = this.opaque(bx + o1[0], by + o1[1], bz + o1[2]) ? 1 : 0;
          const s2 = this.opaque(bx + o2[0], by + o2[1], bz + o2[2]) ? 1 : 0;
          const cc = this.opaque(bx + o1[0] + o2[0], by + o1[1] + o2[1], bz + o1[2] + o2[2]) ? 1 : 0;
          const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
          ao.push(a);
          const l = (b.liquid ? 1 : AO[a]) * f.shade;
          g.c.push(tc[0] * l, tc[1] * l, tc[2] * l);
        }
        if (ao[0] + ao[2] > ao[1] + ao[3]) g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else g.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
    const key = cx + ',' + cz;
    const old = this.chunks.get(key) || {};
    for (const [k, mat] of [['o', this.mat], ['w', this.waterMat]]) {
      if (old[k]) { this.scene.remove(old[k]); old[k].geometry.dispose(); old[k] = null; }
      const g = out[k];
      if (!g.i.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('uvl', new THREE.Float32BufferAttribute(g.u, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      geo.setIndex(g.i);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = k === 'w' ? 2 : 0;
      this.scene.add(m);
      old[k] = m;
    }
    this.chunks.set(key, old);
  }

  // ---------- raycast (DDA de Amanatides–Woo) ----------
  raycast(o, d, max, test = (id) => BLOCKS[id].solid) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tmx = sx ? (sx > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
    let tmy = sy ? (sy > 0 ? y + 1 - o.y : o.y - y) * tdy : Infinity;
    let tmz = sz ? (sz > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 512 && t <= max; i++) {
      const id = this.get(x, y, z);
      if (id && test(id)) {
        return { x, y, z, id, dist: t, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), normal: new THREE.Vector3(nx, ny, nz) };
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // ---------- colisão de caixa (AABB) com blocos, eixo a eixo ----------
  // pos = centro da base; half = meia largura; h = altura. Move por delta e devolve contatos.
  moveBox(pos, half, h, delta) {
    const hit = { x: false, y: false, z: false, ground: false };
    for (const ax of ['y', 'x', 'z']) {
      const d = delta[ax];
      if (!d) continue;
      pos[ax] += d;
      const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-6);
      const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + h - 1e-6);
      const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-6);
      // borda mais próxima entre todos os blocos sólidos sobrepostos no eixo do movimento
      let edge = d > 0 ? Infinity : -Infinity;
      for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
        if (!this.solid(x, y, z) && this.inside(x, 0, z)) continue;
        const c = ax === 'x' ? x : ax === 'y' ? y : z;
        edge = d > 0 ? Math.min(edge, c) : Math.max(edge, c + 1);
      }
      if (!Number.isFinite(edge)) continue;
      const ext = ax === 'y' ? (d > 0 ? h : 0) : half;
      pos[ax] = d > 0 ? edge - ext - 1e-7 : edge + (ax === 'y' ? 0 : ext) + 1e-7;
      hit[ax] = true;
      if (ax === 'y' && d < 0) hit.ground = true;
    }
    return hit;
  }

  boxFree(pos, half, h) {
    for (let y = Math.floor(pos.y); y <= Math.floor(pos.y + h - 1e-6); y++)
      for (let z = Math.floor(pos.z - half); z <= Math.floor(pos.z + half - 1e-6); z++)
        for (let x = Math.floor(pos.x - half); x <= Math.floor(pos.x + half - 1e-6); x++)
          if (this.solid(x, y, z) || !this.inside(x, 0, z)) return false;
    return true;
  }
}
