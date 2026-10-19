import * as THREE from 'three';

// Blocos do mundo. Texturas com os nomes de arquivo do Minecraft (textures/block/<nome>.png): a versão
// local troca as procedurais pelas reais se existirem em mc-assets/; a pública usa as procedurais.
export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, GRAVEL: 6, LOG: 7, LEAVES: 8, PLANKS: 9,
  GLASS: 10, WATER: 11, BEDROCK: 12, COAL: 13, IRON: 14, WOOL: 15, HAY: 16, TARGET: 17, BRICKS: 18, TNT: 19,
};

// opaque: oculta faces vizinhas e conta no AO. solid: colide. cutout: alpha test. sound: grupo de som.
// tint: cor de bioma aplicada às texturas reais (que vêm em cinza no jogo).
const GREEN = [0.48, 0.74, 0.35], FOLIAGE = [0.38, 0.66, 0.22];
export const BLOCKS = [
  { name: 'air', solid: false, opaque: false },
  { name: 'grass', tex: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' }, sound: 'grass', tintTop: GREEN, hardness: 0.6 },
  { name: 'dirt', tex: 'dirt', sound: 'gravel', hardness: 0.5 },
  { name: 'stone', tex: 'stone', sound: 'stone', hardness: 1.5 },
  { name: 'cobblestone', tex: 'cobblestone', sound: 'stone', hardness: 2 },
  { name: 'sand', tex: 'sand', sound: 'sand', hardness: 0.5, gravity: true },
  { name: 'gravel', tex: 'gravel', sound: 'gravel', hardness: 0.6, gravity: true },
  { name: 'oak_log', tex: { top: 'oak_log_top', side: 'oak_log', bottom: 'oak_log_top' }, sound: 'wood', hardness: 2 },
  { name: 'oak_leaves', tex: 'oak_leaves', opaque: false, cutout: true, sound: 'grass', tint: FOLIAGE, hardness: 0.2 },
  { name: 'oak_planks', tex: 'oak_planks', sound: 'wood', hardness: 2 },
  { name: 'glass', tex: 'glass', opaque: false, cutout: true, sound: 'glass', hardness: 0.3, fragile: true },
  { name: 'water', tex: 'water_still', opaque: false, solid: false, liquid: true, sound: 'water' },
  { name: 'bedrock', tex: 'bedrock', sound: 'stone', hardness: Infinity },
  { name: 'coal_ore', tex: 'coal_ore', sound: 'stone', hardness: 3 },
  { name: 'iron_ore', tex: 'iron_ore', sound: 'stone', hardness: 3 },
  { name: 'white_wool', tex: 'white_wool', sound: 'cloth', hardness: 0.8 },
  { name: 'hay_block', tex: { top: 'hay_block_top', side: 'hay_block_side', bottom: 'hay_block_top' }, sound: 'grass', hardness: 0.5 },
  { name: 'target', tex: { top: 'target_top', side: 'target_side', bottom: 'target_top' }, sound: 'grass', hardness: 0.5 },
  { name: 'bricks', tex: 'bricks', sound: 'stone', hardness: 2 },
  { name: 'tnt', tex: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, sound: 'grass', hardness: 0, tnt: true },
].map((b) => ({ solid: true, opaque: true, ...b }));

// ---------- texturas procedurais 16×16 ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const clamp = (v) => Math.max(0, Math.min(255, v | 0));

function paint(seed, fn) {
  const r = rng(seed), px = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const [R, G, Bb, A = 255] = fn(x, y, r);
    const i = (y * 16 + x) * 4;
    px[i] = clamp(R); px[i + 1] = clamp(G); px[i + 2] = clamp(Bb); px[i + 3] = clamp(A);
  }
  return px;
}
const vary = (c, r, k) => { const d = (r() - 0.5) * k; return [c[0] + d, c[1] + d, c[2] + d]; };

const DIRT = [134, 96, 67], STONE = [125, 125, 125], PLANK = [162, 130, 78], GRASS_C = [104, 166, 60];
const PAINTERS = {
  grass_block_top: (x, y, r) => vary(GRASS_C, r, 34),
  grass_block_side: (x, y, r) => {
    const edge = 3 + ((Math.sin(x * 2.1) * 1.3 + r() * 1.4) | 0);
    return y < edge ? vary(GRASS_C, r, 30) : vary(DIRT, r, 30);
  },
  dirt: (x, y, r) => (r() < 0.12 ? vary([105, 74, 50], r, 12) : vary(DIRT, r, 26)),
  stone: (x, y, r) => (r() < 0.15 ? vary([104, 104, 104], r, 10) : vary(STONE, r, 22)),
  cobblestone: (x, y, r) => {
    const cx = (x + (((y / 4) | 0) % 2) * 2) % 5, cy = y % 4;
    const seam = cx === 0 || cy === 0;
    return seam ? vary([82, 82, 82], r, 12) : vary([132, 132, 132], r, 34);
  },
  sand: (x, y, r) => vary([219, 207, 160], r, 18),
  gravel: (x, y, r) => { const k = r(); return k < 0.33 ? vary([110, 104, 100], r, 20) : k < 0.66 ? vary([150, 140, 135], r, 20) : vary([126, 112, 98], r, 20); },
  oak_log: (x, y, r) => vary(x % 4 === 0 ? [86, 66, 39] : [109, 85, 50], r, 18),
  oak_log_top: (x, y, r) => {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (d > 7) return vary([102, 80, 48], r, 14);
    return vary(((d | 0) % 3 === 0) ? [150, 118, 72] : [182, 146, 92], r, 14);
  },
  oak_leaves: (x, y, r) => (r() < 0.22 ? [0, 0, 0, 0] : vary([64, 120, 34], r, 40)),
  oak_planks: (x, y, r) => {
    const board = y % 4 === 3 || (x === ((((y / 4) | 0) * 7) % 16) && y % 4 !== 3);
    return board ? vary([112, 88, 52], r, 10) : vary(PLANK, r, 20);
  },
  glass: (x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    const streak = (x === y + 3 || x === y + 4) && x > 4 && x < 10;
    return edge ? [200, 225, 230, 255] : streak ? [235, 245, 250, 200] : [0, 0, 0, 0];
  },
  water_still: (x, y, r) => [...vary([52, 104, 206], r, 20), 170],
  bedrock: (x, y, r) => vary(r() < 0.5 ? [60, 60, 60] : [100, 100, 100], r, 30),
  coal_ore: (x, y, r) => (((x * 7 + y * 3) % 11 < 2 && r() < 0.8) ? vary([30, 30, 30], r, 10) : vary(STONE, r, 22)),
  iron_ore: (x, y, r) => (((x * 5 + y * 7) % 13 < 2 && r() < 0.8) ? vary([216, 175, 147], r, 16) : vary(STONE, r, 22)),
  white_wool: (x, y, r) => vary([233, 236, 236], r, 14),
  hay_block_side: (x, y, r) => vary(y % 4 === 0 ? [140, 104, 14] : [198, 160, 32], r, 20),
  hay_block_top: (x, y, r) => vary(Math.hypot(x - 7.5, y - 7.5) % 3 < 1 ? [150, 110, 20] : [204, 166, 40], r, 16),
  target_side: (x, y) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return d > 6.5 || (d > 3 && d < 5) || d < 1.6 ? [210, 40, 40] : [236, 226, 210]; },
  target_top: (x, y) => { const d = Math.hypot(x - 7.5, y - 7.5); return d > 6.8 || (d > 3.2 && d < 4.8) || d < 1.6 ? [210, 40, 40] : [236, 226, 210]; },
  bricks: (x, y, r) => {
    const off = (((y / 4) | 0) % 2) * 4;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    return mortar ? vary([168, 160, 150], r, 10) : vary([150, 74, 56], r, 26);
  },
  tnt_side: (x, y, r) => (y >= 5 && y <= 10 ? (((x >= 2 && x <= 13) && (y === 6 || y === 9 || x % 4 === 2)) ? [30, 30, 30] : [230, 230, 230]) : vary([200, 50, 40], r, 20)),
  tnt_top: (x, y, r) => (Math.hypot(x - 7.5, y - 7.5) < 3 ? [40, 40, 40] : vary([200, 60, 45], r, 16)),
  tnt_bottom: (x, y, r) => vary([190, 52, 40], r, 16),
};

export const TEXTURES = Object.keys(PAINTERS);
export const layer = Object.fromEntries(TEXTURES.map((n, i) => [n, i]));

for (const b of BLOCKS) {
  if (!b.tex) continue;
  const t = typeof b.tex === 'string' ? { top: b.tex, side: b.tex, bottom: b.tex } : b.tex;
  b.faces = { top: layer[t.top], side: layer[t.side], bottom: layer[t.bottom] };
}

async function loadPng(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, 16, 16, 0, 0, 16, 16); // água/lava animadas: primeiro quadro
  return g.getImageData(0, 0, 16, 16).data;
}

// Texture array (uma camada por textura): sem vazamento entre blocos e com mipmaps.
// mcBase: pasta com as texturas reais (só na versão local); faltando alguma, usa a procedural.
export async function buildAtlas(mcBase) {
  const data = new Uint8Array(16 * 16 * 4 * TEXTURES.length);
  let real = 0;
  for (let i = 0; i < TEXTURES.length; i++) {
    let px = null;
    if (mcBase) {
      try { px = await loadPng(`${mcBase}${TEXTURES[i]}.png`); real++; } catch { px = null; }
    }
    data.set(px ?? paint(i * 7919 + 13, PAINTERS[TEXTURES[i]]), i * 1024);
  }
  const tex = new THREE.DataArrayTexture(data, 16, 16, TEXTURES.length);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return { tex, real: real > 0 };
}

// Textura de uma camada do atlas (para blocos soltos: caindo, TNT acesa). Linhas invertidas:
// DataTexture lê a linha 0 como base da imagem.
const faceCache = {};
export function faceTexture(atlas, name) {
  if (faceCache[name]) return faceCache[name];
  const L = layer[name], src = atlas.image.data, d = new Uint8Array(1024);
  for (let y = 0; y < 16; y++) d.set(src.subarray(L * 1024 + (15 - y) * 64, L * 1024 + (16 - y) * 64), y * 64);
  const t = new THREE.DataTexture(d, 16, 16);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return (faceCache[name] = t);
}

// Material de bloco solto: faces na ordem do BoxGeometry (+x, -x, +y, -y, +z, -z)
const matCache = {};
export function blockMaterial(atlas, id, flash = false) {
  const key = id + (flash ? 'f' : '');
  if (matCache[key]) return matCache[key];
  const b = BLOCKS[id];
  const t = typeof b.tex === 'string' ? { top: b.tex, side: b.tex, bottom: b.tex } : b.tex;
  const m = (n) => new THREE.MeshLambertMaterial({ map: faceTexture(atlas, n), emissive: flash ? 0xffffff : 0, emissiveIntensity: flash ? 0.6 : 0, toneMapped: false });
  const side = m(t.side), top = m(t.top), bottom = m(t.bottom);
  return (matCache[key] = [side, side, top, bottom, side, side]);
}
