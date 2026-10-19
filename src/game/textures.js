import * as THREE from 'three';

// Texturas geradas em canvas: nada de assets do jogo.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Value noise em grade periódica (tileable), várias oitavas.
function noise(size, cells, octaves, seed) {
  const r = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const grid = Array.from({ length: c * c }, r);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * c, y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * c, x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = grid[(y0 % c) * c + (x0 % c)], b = grid[(y0 % c) * c + ((x0 + 1) % c)];
        const d = grid[((y0 + 1) % c) * c + (x0 % c)], e = grid[((y0 + 1) % c) * c + ((x0 + 1) % c)];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (d + (e - d) * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

function paint(size, seed, fn) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const n1 = noise(size, 4, 5, seed), n2 = noise(size, 16, 3, seed + 7);
  for (let i = 0; i < size * size; i++) {
    const [r, gg, b] = fn(n1[i], n2[i], i % size, (i / size) | 0);
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

const mix = (a, b, t) => a + (b - a) * t;

export function grassTexture() {
  const [c] = paint(512, 11, (a, b) => {
    const dirt = Math.max(0, (a - 0.58) * 4);
    const k = 0.75 + b * 0.45;
    return [mix(96, 128, dirt) * k, mix(110, 104, dirt) * k, mix(58, 72, dirt) * k];
  });
  return tex(c, 90);
}

export function dirtTexture() {
  const [c] = paint(256, 23, (a, b) => {
    const k = 0.7 + a * 0.4 + b * 0.15;
    return [104 * k, 88 * k, 66 * k];
  });
  return tex(c, 12);
}

export function woodTexture() {
  const [c, g] = paint(256, 31, (a, b, x, y) => {
    const grain = Math.sin(y * 0.35 + a * 18) * 0.5 + 0.5;
    const k = 0.72 + grain * 0.2 + b * 0.12;
    return [138 * k, 102 * k, 66 * k];
  });
  g.fillStyle = 'rgba(40,25,12,0.55)';
  for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 2); // juntas das tábuas
  return tex(c);
}

export function metalTexture() {
  const [c] = paint(256, 47, (a, b, x) => {
    const rust = Math.max(0, (a - 0.5) * 2.4);
    const rib = Math.sin(x * 0.4) * 0.06;
    const k = 0.78 + b * 0.25 + rib;
    return [mix(118, 128, rust) * k, mix(116, 74, rust) * k, mix(110, 44, rust) * k];
  });
  return tex(c);
}

// Parede de spray: chapa com grade de 0,5 m e um X no centro (alvo a 1,5 m do chão).
export function sprayWallTexture(wm, hm) {
  const [c, g] = canvas(1024);
  c.height = Math.round((1024 * hm) / wm);
  const base = metalTexture().image;
  g.drawImage(base, 0, 0, c.width, c.height);
  const s = c.width / wm;
  g.strokeStyle = 'rgba(235,230,215,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= wm; x += 0.5) { g.beginPath(); g.moveTo(x * s, 0); g.lineTo(x * s, c.height); g.stroke(); }
  for (let y = 0; y <= hm; y += 0.5) { g.beginPath(); g.moveTo(0, c.height - y * s); g.lineTo(c.width, c.height - y * s); g.stroke(); }
  const cx = (wm / 2) * s, cy = c.height - 1.5 * s;
  g.strokeStyle = '#e2563d';
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(cx - 18, cy - 18); g.lineTo(cx + 18, cy + 18); g.moveTo(cx + 18, cy - 18); g.lineTo(cx - 18, cy + 18); g.stroke();
  g.beginPath(); g.arc(cx, cy, 0.25 * s, 0, Math.PI * 2); g.stroke();
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Alvo redondo: anéis vermelho/branco sobre madeira.
export function bullseyeTexture() {
  const [c, g] = canvas(256);
  g.fillStyle = '#8a6a45';
  g.fillRect(0, 0, 256, 256);
  const rings = ['#f1ece0', '#c63b2a', '#f1ece0', '#c63b2a', '#f1ece0', '#c63b2a'];
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(128, 128, 126 - i * 21, 0, Math.PI * 2);
    g.fill();
  });
  return tex(c);
}

export function signTexture(text) {
  const [c, g] = canvas(256);
  c.height = 128;
  g.drawImage(woodTexture().image, 0, 0, 256, 128);
  g.fillStyle = 'rgba(20,14,8,0.9)';
  g.font = 'bold 76px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const t = tex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function holeTexture() {
  const [c, g] = canvas(64);
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.25, 'rgba(10,8,6,0.95)');
  grd.addColorStop(0.45, 'rgba(60,50,40,0.6)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function flashTexture() {
  const [c, g] = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,250,220,1)');
  grd.addColorStop(0.2, 'rgba(255,200,90,0.9)');
  grd.addColorStop(0.5, 'rgba(255,120,30,0.35)');
  grd.addColorStop(1, 'rgba(255,80,0,0)');
  g.fillStyle = grd;
  g.translate(64, 64);
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, -6); g.lineTo(62, 0); g.lineTo(0, 6);
    g.fill();
  }
  g.beginPath(); g.arc(0, 0, 40, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
