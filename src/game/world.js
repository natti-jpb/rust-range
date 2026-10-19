import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { grassTexture, dirtTexture, woodTexture, metalTexture, signTexture } from './textures.js';

// Range: linha de tiro em z≈0, alvos em -z (downrange). Dimensões em metros.
export const BOUNDS = { minX: -28, maxX: 28, minZ: -222, maxZ: 12 };

// Plano dentro do range, morros suaves fora dele.
function terrainHeight(x, z) {
  const out = Math.max(0, Math.abs(x) - 42) + Math.max(0, -z - 250) + Math.max(0, z - 40);
  const k = Math.min(1, out / 60);
  return k * (Math.sin(x * 0.013) * Math.cos(z * 0.011) + Math.sin(x * 0.031 + z * 0.023) * 0.5 + 0.7) * 22;
}

export function buildWorld(scene) {
  const hit = []; // meshes testadas pelos projéteis
  const solids = []; // caixas XZ para colisão do jogador: {minX,maxX,minZ,maxZ,top}

  const mats = {
    grass: new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }),
    dirt: new THREE.MeshStandardMaterial({ map: dirtTexture(), roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ map: metalTexture(), roughness: 0.75, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3b3833, roughness: 0.8, metalness: 0.2 }),
    sand: new THREE.MeshStandardMaterial({ color: 0x8b7a5a, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x7c7870, roughness: 0.95, flatShading: true }),
    bark: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }),
    pine: new THREE.MeshStandardMaterial({ color: 0x2f4a2c, roughness: 1, flatShading: true }),
  };

  // Céu + luz
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 7;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.cloudCoverage.value = 0.45;
  u.cloudDensity.value = 0.5;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 34), THREE.MathUtils.degToRad(35));
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xb9c3c6, 140, 900);

  scene.add(new THREE.HemisphereLight(0xc6d3dc, 0x5b4f3b, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.position.copy(sunDir).multiplyScalar(120).add(new THREE.Vector3(0, 0, -40));
  sun.target.position.set(0, 0, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 80, bottom: -80, near: 1, far: 400 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // Chão: plano na área do range, morros fora dele
  const ground = new THREE.PlaneGeometry(1800, 1800, 180, 180);
  ground.rotateX(-Math.PI / 2);
  const pos = ground.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, mats.grass);
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  const add = (geo, mat, x, y, z, { kind = 'wood', solid = false, shadow = true, list = hit } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.userData.kind = kind;
    scene.add(m);
    if (list) list.push(m);
    if (solid) {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      solids.push({ minX: x + b.min.x, maxX: x + b.max.x, minZ: z + b.min.z, maxZ: z + b.max.z, top: y + b.max.y });
    }
    return m;
  };
  const box = (w, h, d, mat, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z, o);

  // Bermas (trapézios extrudados) nas laterais e no fundo
  const berm = (len, h, base, top, mat) => {
    const s = new THREE.Shape();
    s.moveTo(-base / 2, 0); s.lineTo(base / 2, 0); s.lineTo(top / 2, h); s.lineTo(-top / 2, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    return g;
  };
  for (const side of [-1, 1]) {
    const m = add(berm(250, 4.5, 9, 3), mats.dirt, side * 33, 0, -105, { kind: 'dirt', shadow: false });
    m.receiveShadow = true;
  }
  const back = add(berm(90, 9, 16, 4), mats.dirt, 0, 0, -238, { kind: 'dirt', shadow: false });
  back.rotation.y = Math.PI / 2;

  // Linha de tiro: piso, abrigo com telhado de chapa, bancadas, sacos de areia
  box(22, 0.15, 6, mats.wood, 0, 0, 3, { solid: false, shadow: false });
  for (const x of [-7, 7]) {
    box(2.6, 0.08, 0.7, mats.wood, x, 0.95, 0.9, { solid: true });
    box(0.1, 0.8, 0.1, mats.wood, x - 1.1, 0.15, 0.9);
    box(0.1, 0.8, 0.1, mats.wood, x + 1.1, 0.15, 0.9);
  }
  for (let i = 0; i < 9; i++) {
    const x = -20 + i * 5 + (i > 4 ? 2 : -2);
    if (Math.abs(x) < 12) continue;
    box(1.6, 0.4, 0.6, mats.sand, x, 0, -0.5, { kind: 'dirt', solid: true });
    box(1.4, 0.38, 0.55, mats.sand, x + 0.1, 0.4, -0.5, { kind: 'dirt' });
  }

  // Barris e caixas espalhados
  const barrel = new THREE.CylinderGeometry(0.33, 0.33, 0.95, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6d3b24, roughness: 0.7, metalness: 0.4 });
  for (const [x, z] of [[-16, 6], [-15.2, 6.5], [15, 7], [-24, -60], [25, -35], [-22, -140], [23, -170]]) {
    add(barrel, barrelMat, x, 0.475, z, { kind: 'metal', solid: true });
  }
  for (const [x, z, s] of [[13, 6, 1], [-25, -15, 1.2], [26, -85, 1], [-26, -110, 1.3], [5, -185, 1.5]]) {
    box(s, s * 0.8, s, mats.wood, x, 0, z, { solid: true });
  }

  // Placas de distância
  for (let d = 25; d <= 200; d += 25) {
    for (const side of [-1, 1]) {
      const x = side * 27.5;
      box(0.12, 1.3, 0.12, mats.wood, x, 0, -d);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(`${d}m`), roughness: 0.9 }));
      sign.position.set(x, 1.55, -d + 0.07);
      sign.castShadow = true;
      scene.add(sign);
    }
  }

  // Árvores e pedras fora do range
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3, 6);
  const crown = new THREE.ConeGeometry(2.2, 7, 7);
  const trees = 260;
  const tT = new THREE.InstancedMesh(trunk, mats.bark, trees);
  const tC = new THREE.InstancedMesh(crown, mats.pine, trees);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < trees; i++) {
    let x, z;
    do { x = (r() - 0.5) * 700; z = 60 - r() * 520; } while (Math.abs(x) < 46 && z > -262 && z < 44);
    const s = 0.7 + r() * 0.8, y = terrainHeight(x, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    tT.setMatrixAt(i, mtx.compose(p.set(x, y + 1.5 * s, z), q, sc.set(s, s, s)));
    tC.setMatrixAt(i, mtx.compose(p.set(x, y + (3 + 3.2) * s, z), q, sc.set(s, s * (0.9 + r() * 0.4), s)));
  }
  tC.castShadow = true;
  scene.add(tT, tC);
  const rockG = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(rockG, mats.rock, 70);
  for (let i = 0; i < 70; i++) {
    let x, z;
    do { x = (r() - 0.5) * 300; z = 40 - r() * 330; } while (Math.abs(x) < 38 && z > -250 && z < 30);
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    const s = 0.6 + r() * 2.2;
    rocks.setMatrixAt(i, mtx.compose(p.set(x, terrainHeight(x, z) + s * 0.3, z), q, sc.set(s * 1.3, s, s)));
  }
  scene.add(rocks);

  // Tufos de grama no chão do range (só visual)
  const blade = new THREE.ConeGeometry(0.035, 0.3, 3);
  blade.translate(0, 0.15, 0);
  const tufts = new THREE.InstancedMesh(blade, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 9000);
  const col = new THREE.Color();
  for (let i = 0; i < 9000; i++) {
    const x = (r() - 0.5) * 60, z = 14 - r() * 236;
    if (z > -0.8 && z < 6.5 && Math.abs(x) < 11.5) { tufts.setMatrixAt(i, mtx.makeScale(0, 0, 0)); continue; }
    q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6.28, (r() - 0.5) * 0.5));
    const s = 0.6 + r() * 1.1;
    tufts.setMatrixAt(i, mtx.compose(p.set(x, 0, z), q, sc.set(s, s, s)));
    tufts.setColorAt(i, col.setHSL(0.18 + r() * 0.06, 0.32 + r() * 0.15, 0.16 + r() * 0.1));
  }
  scene.add(tufts);

  return { hit, solids, mats, sky };
}
