import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildAtlas, blockMaterial, BLOCKS, B } from './mc/blocks.js';
import { VoxelWorld } from './mc/world.js';
import { Entities } from './mc/entities.js';
import { Ballistics, falloff } from './game/ballistics.js';
import { Player } from './game/player.js';
import { ViewModel } from './game/viewmodel.js';
import { Audio } from './game/audio.js';
import { Hud } from './game/hud.js';
import { Menu } from './game/menu.js';
import { Weapons } from './game/weapons.js';
import { RustViewModel, RustSounds, loadManifest, BASE } from './game/rustvm.js';
import { RustHud } from './game/rusthud.js';
import { GUNS, settings } from './game/config.js';
import { t } from './game/i18n.js';
import { MODS, AMMO } from './data/weapons.js';
import { Inventory, Container } from './game/inventory.js';
import { InventoryUI } from './game/invui.js';
import { makeItem, kind, itemName, maxStack, weaponStats } from './game/items.js';

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.toneMapping = THREE.ACESFilmicToneMapping; // só o viewmodel PBR; blocos e mobs não usam tone mapping
renderer.toneMappingExposure = 0.62;
renderer.autoClear = false;

const scene = new THREE.Scene();
const SKY = new THREE.Color(0x8fb8ff), FOG = new THREE.Color(0xbfd6ff);
scene.background = SKY;
scene.fog = new THREE.Fog(FOG, 70, 175);
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 600);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8c8c, 2.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(0.4, 1, 0.3);
scene.add(sun);
const muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
scene.add(muzzleLight);

// Mundo de blocos (texturas procedurais; a versão local troca pelas do Minecraft em mc-assets/)
const atlas = await buildAtlas(null);
const world = new VoxelWorld(scene, atlas.tex, { mcTextures: atlas.real });
world.setFog(FOG, 70, 175);

// Reflexos dos metais do viewmodel: environment map de um céu físico (não aparece na cena)
const envScene = new THREE.Scene();
const sky = new Sky();
sky.scale.setScalar(10000);
sky.material.uniforms.sunPosition.value.set(0.4, 0.6, 0.3);
envScene.add(sky);
const env = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.04, 0.1, 20000).texture;

const audio = new Audio();
audio.setVolume(settings.vol);
const hud = new Hud(camera);
// Assets reais do Rust (só existem localmente, exportados do jogo instalado); sem eles, viewmodel procedural
const manifest = await loadManifest();
audio.manifest = manifest;
audio.rust = manifest && new RustSounds(audio);
const procVm = new ViewModel();
const rustVm = manifest && new RustViewModel(manifest, audio.rust);
for (const v of [procVm, rustVm]) if (v) { v.scene.environment = env; v.scene.environmentIntensity = 0.22; }
rustVm?.preload();
hud.rust = manifest?.hud ? new RustHud() : null;
const vm = {
  cur: procVm,
  show(w, item) { this.cur = w && rustVm?.has(w.id) ? rustVm : procVm; this.cur.show(w, item); },
  attach(item) { this.cur.attach?.(item); },
  shot(k) { this.cur.shot(k); },
  reloadStart() { return this.cur.reloadStart?.(); },
  dry() { return this.cur.dry?.(); },
  update(dt, st) { this.cur.update(dt, st); },
};

const player = new Player(camera, canvas, world, settings);
player.hp = 100;
player.alive = true;

// ---------- vida, dano, morte ----------
function hurtPlayer(dmg) {
  if (!player.alive || dmg <= 0) return;
  player.hp = Math.max(0, player.hp - dmg);
  hud.hurt(dmg);
  hud.health(player.hp);
  audio.hurt();
  if (player.hp <= 0) {
    player.alive = false;
    player.deadAt = now;
    hud.dead(true);
  }
}
function respawn() {
  player.pos.copy(world.spawn);
  player.vel.set(0, 0, 0);
  player.aim.body.pitch = player.aim.body.yaw = 0;
  player.hp = 100;
  player.alive = true;
  hud.health(100);
  hud.dead(false);
}
player.onLand = (vy, dmg) => {
  landSound();
  if (dmg > 0) hurtPlayer(dmg);
};

// ---------- entidades do Minecraft ----------
const entities = new Entities(scene, world, {
  hurtPlayer: (dmg) => hurtPlayer(dmg),
  sound: (name, pos) => audio.mc(name, pos ? pos.distanceTo(player.pos) : 0),
  fx: (kind, pos) => {
    if (kind === 'explosion') ballistics.fx.explosion(pos);
    if (kind === 'explosion_small') ballistics.fx.burst(pos, new THREE.Vector3(0, 1, 0), 'smoke');
  },
  blockMaterial: (id, flash) => blockMaterial(atlas.tex, id, flash),
  // loot dos mobs hostis: munição do Rust (e às vezes um attachment) como item no chão do Minecraft
  drop: (m) => {
    if (!m.t.hostile) return;
    const ammo = Object.keys(AMMO), mods = Object.keys(MODS);
    dropWorld(makeItem(ammo[(Math.random() * ammo.length) | 0], 8 + ((Math.random() * 25) | 0)), m.pos);
    if (Math.random() < 0.15) dropWorld(makeItem(mods[(Math.random() * mods.length) | 0]), m.pos);
  },
  pickup: () => false, // no Rust se pega com E (ver interact)
});

// som e partícula de impacto por grupo de som do bloco
const IMPACT = { grass: 'dirt', gravel: 'dirt', stone: 'stone', sand: 'sand', wood: 'wood', glass: 'glass', cloth: 'cloth', water: 'dirt' };
const ZONE = { head: 2, body: 1, legs: 0.75 };
const _hp = new THREE.Vector3();

const ballistics = new Ballistics(scene, world, entities, (hit, w) => {
  // explosiva: ItemModProjectileRadialDamage (1,5 m) — aqui uma explosão pequena do Minecraft
  if (w.radius) entities.explode(_hp.copy(hit.point).addScaledVector(hit.normal, -0.3), 0.8, player, true);
  const dmg0 = falloff(w, hit.dist) + (w.heat ?? 0); // incendiária: +dano de calor
  const m = `${hit.dist.toFixed(0)} m`;
  if (hit.mob) {
    const dir = new THREE.Vector3().subVectors(hit.point, camera.position);
    const head = hit.part === 'head';
    const res = entities.damage(hit.mob, dmg0 * ZONE[hit.part], player, dir);
    ballistics.fx.burst(hit.point, hit.normal, 'flesh');
    audio.impact('flesh', hit.dist, head);
    if (!res.dmg) return;
    hud.hitmarker(head);
    audio.hitmarker();
    hud.damage(hit.point, res.dmg, head);
    hud.info(`${m} · ${Math.round(res.dmg)}${head ? ' · ' + t('head') : ''}${res.kill ? ' · ' + t('kill') : ''}`);
    return;
  }
  const b = hit.block, def = BLOCKS[b.id];
  const kind = IMPACT[def.sound] || 'dirt';
  ballistics.fx.burst(hit.point, hit.normal, kind);
  audio.impact(kind, hit.dist);
  if (def.fragile) { world.set(b.x, b.y, b.z, B.AIR); audio.mc('glass_break', hit.dist); return; }
  if (def.tnt) { entities.primeTnt(b.x, b.y, b.z); return; }
  if (!def.cutout) ballistics.fx.hole(hit, b.id === B.WOOL);
});
world.listeners.push((x, y, z, old, id) => { if (id === B.AIR) ballistics.fx.clearBlock(`${x},${y},${z}`); });

// ---------- inventário do Rust ----------
const inv = new Inventory();
// belt com seis armas carregadas; attachments e munição no inventário principal
['rifle.ak', 'rifle.lr300', 'smg.mp5', 'smg.thompson', 'rifle.semiauto', 'pistol.python'].forEach((id, i) => {
  const it = makeItem(id);
  it.ammo = weaponStats(it, settings.mode).capacity;
  inv.belt.slots[i] = it;
});
for (const id of Object.keys(MODS)) inv.give(makeItem(id));
for (const a of Object.keys(AMMO)) inv.give(makeItem(a, AMMO[a].stack));
inv.active = Math.max(0, inv.belt.slots.findIndex((it) => it?.id === settings.weapon));

// baús do arsenal: completam armas, mods e duas pilhas de cada munição sempre que abertos
const chests = {};
function arsenal(key) {
  const c = (chests[key] ??= new Container('loot', 48));
  const want = [...GUNS.map((g) => [g.id, 1]), ...Object.keys(MODS).map((id) => [id, 1]), ...Object.keys(AMMO).map((a) => [a, AMMO[a].stack * 2])];
  for (const [id, n] of want) {
    let have = c.slots.reduce((s, it) => s + (it?.id === id ? it.amount : 0), 0);
    while (have < n) {
      const i = c.slots.indexOf(null);
      if (i < 0) return c;
      const k = Math.min(maxStack(id), n - have);
      c.slots[i] = makeItem(id, k);
      have += k;
    }
  }
  return c;
}

// item solto no mundo (física de item do Minecraft); ícone do Rust quando exportado
const iconTex = {}, planeGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), boxGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25).translate(0, 0.125, 0);
function itemMesh(it) {
  const k = kind(it.id);
  if (!manifest) return new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: k === 'weapon' ? 0x4a4a4a : k === 'mod' ? 0x6d8fb3 : 0xc9a341 }));
  const tex = (iconTex[it.id] ??= new THREE.TextureLoader().load(`${BASE}items/${it.id}.png`, (x) => { x.colorSpace = THREE.SRGBColorSpace; }));
  const m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
  m.scale.setScalar(k === 'weapon' ? 0.7 : 0.4);
  return m;
}
const _fw = new THREE.Vector3();
function dropWorld(it, at = null) {
  if (it === weapons?.item) weapons.hold(null);
  _fw.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const pos = at ? at.clone().add(new THREE.Vector3(0, 0.5, 0)) : camera.position.clone().addScaledVector(_fw, 0.5).add(new THREE.Vector3(0, -0.4, 0));
  const vel = at ? null : _fw.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.1, 0));
  entities.dropItem(pos, it, itemMesh(it), vel);
}

const weapons = new Weapons({ player, ballistics, vm, audio, hud, camera, light: muzzleLight, inv });
weapons.onOverflow = (it) => dropWorld(it);
const invui = new InventoryUI(inv, {
  base: manifest ? BASE : null, items: manifest?.items,
  onDrop: (it) => dropWorld(it),
  onAmmo: (it, a) => weapons.switchAmmo(it, a),
  onUnload: (it) => weapons.unload(it),
});
// arma na mão = slot ativo do belt; mexer no item (mods, munição) atualiza stats e viewmodel
inv.listeners.push(() => (inv.held !== weapons.item ? weapons.hold(inv.held) : weapons.changed()));
weapons.hold(inv.held);
hud.health(player.hp);

function openInv(loot = null) {
  if (invui.open || !player.alive) return;
  invui.show(true, loot);
  player.ui = true;
  hud.prompt(null);
  document.exitPointerLock();
}
function closeInv(relock = true) {
  if (!invui.open) return;
  invui.show(false);
  player.ui = false;
  if (relock) player.lock();
  else { menu.show(true); hud.show(false); invui.hud(false); }
}
function selectSlot(i) {
  inv.active = inv.active === i ? -1 : i; // mesmo número de novo guarda o item
  inv.changed();
}
function cycleSlot(dir) {
  const used = inv.belt.slots.map((it, i) => (it ? i : -1)).filter((i) => i >= 0);
  if (!used.length) return;
  const at = used.indexOf(inv.active);
  inv.active = used[(at + dir + used.length) % used.length];
  inv.changed();
}

// o que está na mira a até 3 m: item no chão ou baú
const _lv = new THREE.Vector3();
function lookTarget() {
  _fw.set(0, 0, -1).applyQuaternion(camera.quaternion);
  let best = null, bd = 3;
  for (const it of entities.items) {
    _lv.subVectors(it.mesh.position, camera.position);
    const d = _lv.length();
    if (d < bd && _lv.dot(_fw) / d > 0.96) { best = { drop: it }; bd = d; }
  }
  const b = world.raycast(camera.position, _fw, 3);
  if (b && BLOCKS[b.id].container && b.dist < bd) return { chest: `${b.x},${b.y},${b.z}` };
  return best;
}
function interact(inp) {
  const tgt = lookTarget();
  hud.prompt(!tgt ? null : tgt.chest ? `[E] ${t('open')}` : `[E] ${t('pickup')} ${itemName(tgt.drop.item.id)}${tgt.drop.item.amount > 1 ? ` ×${tgt.drop.item.amount}` : ''}`);
  if (!tgt || !inp.pressed.has('KeyE')) return;
  if (tgt.chest) { openInv(arsenal(tgt.chest)); return; }
  if (inv.give(tgt.drop.item)) {
    scene.remove(tgt.drop.mesh);
    entities.items.splice(entities.items.indexOf(tgt.drop), 1);
    audio.click?.();
  }
}

// laser (ponto onde o feixe do effectBone bate) e lanterna (spot no shader do mundo)
const _lo = new THREE.Vector3(), _ld = new THREE.Vector3();
function lights() {
  const it = weapons.item, on = !!it?.lightOn && player.alive;
  world.spot.spotOn.value = 0;
  hud.laser(null);
  if (!on) return;
  const mods = it.mods.filter(Boolean).map((m) => MODS[m.id]);
  const ray = (which) => {
    if (vm.cur === rustVm && rustVm.effectRay(which, _lo, _ld)) {
      _lo.applyQuaternion(camera.quaternion).add(camera.position);
      _ld.applyQuaternion(camera.quaternion);
    } else {
      _lo.copy(camera.position);
      _ld.set(0, 0, -1).applyQuaternion(camera.quaternion);
    }
  };
  if (mods.some((m) => m.isLight && !m.needsOn)) {
    ray('flashlight');
    world.spot.spotPos.value.copy(_lo);
    world.spot.spotDir.value.copy(_ld);
    world.spot.spotOn.value = 1;
  }
  if (mods.some((m) => m.isLight && m.needsOn)) {
    ray('laser');
    const b = world.raycast(_lo, _ld, 150), e = entities.raycast(_lo, _ld, 150, player);
    const d = Math.min(b?.dist ?? Infinity, e?.dist ?? Infinity);
    if (d < Infinity) {
      _lv.copy(_lo).addScaledVector(_ld, d).project(camera);
      if (_lv.z < 1) hud.laser({ x: (_lv.x * 0.5 + 0.5) * innerWidth, y: (-_lv.y * 0.5 + 0.5) * innerHeight });
    }
  }
}

const menu = new Menu({
  onPlay: async () => {
    audio.start();
    if (manifest) {
      for (const info of Object.values(manifest.weapons)) audio.rust.preload(info.sounds);
      audio.rust.preload(manifest.env);
    }
    menu.markStarted();
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      // Em tela cheia, segura atalhos tipo Ctrl+W (agachar + andar)
      await navigator.keyboard?.lock?.(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyT', 'KeyQ', 'Space', 'ControlLeft', 'ShiftLeft']);
    } catch { /* sem tela cheia: segue */ }
    player.lock();
  },
  onMode: (m) => weapons.setMode(m),
  onWeapon: (id) => inv.equip(id),
  onSettings: (k) => {
    if (k === 'vol') audio.setVolume(settings.vol);
    if (k === 'showTrainer') hud.trainerVisible(settings.showTrainer);
    if (k === 'lang') { hud.texts(); invui.texts(); }
    if (k === 'mobs') entities.enabled = settings.mobs;
  },
});
entities.enabled = settings.mobs !== false;
menu.local = !!manifest;
menu.texts();
hud.texts();

player.onLockChange = (locked) => {
  invui.hud(locked || invui.open);
  if (!locked && invui.open) return; // inventário aberto: cursor livre, jogo segue
  menu.show(!locked);
  hud.show(locked);
};

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const v of [procVm, rustVm]) if (v) { v.camera.aspect = w / h; v.camera.updateProjectionMatrix(); }
}
addEventListener('resize', resize);
resize();

// ---------- passos (sons do Rust quando exportados) pela superfície do bloco sob os pés ----------
const STEP = { grass: 'grass', cloth: 'grass', gravel: 'gravel', stone: 'stones', sand: 'sand', wood: 'wood', glass: 'stones' };
const surface = () => STEP[BLOCKS[world.get(Math.floor(player.pos.x), Math.floor(player.pos.y - 0.1), Math.floor(player.pos.z))]?.sound] || 'grass';
function landSound() { audio.rust?.env(`land_${surface()}`, 0.6) || audio.rust?.env('land_grass', 0.6); }
let stepDist = 0;
function footsteps(dt) {
  if (!audio.rust || !player.ground || !player.alive) return;
  stepDist += player.speed * dt;
  const stride = player.sprinting ? 2.1 : player.ducked ? 1.1 : 1.5;
  if (player.speed > 0.5 && stepDist > stride) {
    stepDist = 0;
    const s = surface(), gait = player.sprinting ? 'run' : 'walk';
    audio.rust.env(`step_${s}_${gait}`, player.ducked ? 0.25 : 0.5) || audio.rust.env(`step_grass_${gait}`, 0.5);
  }
}

let now = 0, last = 0;
function frame(ts) {
  const dt = last ? Math.min(Math.max((ts - last) / 1000, 0), 0.05) : 0;
  last = ts;
  now += dt;
  const inp = player.consume();
  if (invui.open) {
    if (inp.pressed.has('Tab')) closeInv();
    else if (inp.pressed.has('Escape') || !player.alive) closeInv(false);
  } else if (player.locked && player.alive) {
    if (inp.pressed.has('Tab')) openInv();
    if (inp.pressed.has('KeyT')) { weapons.setMode(settings.mode === 'legacy' ? 'current' : 'legacy'); menu.refresh(); }
    if (inp.pressed.has('KeyX')) ballistics.fx.clearWall();
    if (inp.pressed.has('KeyP')) { settings.showTrainer = !settings.showTrainer; hud.trainerVisible(settings.showTrainer); }
    if (inp.pressed.has('KeyF')) weapons.toggleLight();
    if (inp.wheel && !weapons.zoomWheel(inp.wheel)) cycleSlot(inp.wheel);
    for (let i = 0; i < 6; i++) if (inp.pressed.has(`Digit${i + 1}`)) selectSlot(i);
    interact(inp);
  }
  if (!player.alive && now - player.deadAt > 1.5 && (inp.leftPressed || inp.pressed.has('Space'))) respawn();
  if (player.alive) {
    player.update(dt, { aiming: weapons.aiming, canSprint: !weapons.reload, pressed: inp.pressed });
    footsteps(dt);
    weapons.update(dt, now, inp);
  }
  player.applyCamera();

  const fov = settings.fov / (weapons.aiming ? weapons.w.zoom : 1);
  lights();
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();

  // mundo pausado com o menu aberto (jogo single player)
  if (menu.el.hidden) {
    entities.update(dt, player);
    ballistics.update(dt);
  }
  world.remesh(2);
  if (weapons.w) {
    vm.update(dt, {
      aiming: weapons.aiming, sprint: player.sprinting, speed: player.speed, dx: inp.dx, dy: inp.dy,
      reload: weapons.reload ? weapons.reload.t / weapons.reload.dur : null,
      deploy: Math.min(1, weapons.deployT / weapons.w.deployDelay),
    });
  }
  hud.scope(weapons.w && vm.cur === rustVm && player.alive ? rustVm.scope : null);

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (player.alive && weapons.w) renderer.render(vm.cur.scene, vm.cur.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Ganchos para depuração/testes no console
window.__range = { player, weapons, world, entities, ballistics, settings, camera, renderer, scene, vm, hud, frame, respawn, inv, invui, openInv, closeInv, arsenal };
