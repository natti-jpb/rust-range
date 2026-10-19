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
import { RustViewModel, RustSounds, loadManifest } from './game/rustvm.js';
import { RustHud } from './game/rusthud.js';
import { GUNS, settings } from './game/config.js';
import { t } from './game/i18n.js';

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
  show(w) { this.cur = rustVm?.has(w.id) ? rustVm : procVm; this.cur.show(w); },
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
  fx: (kind, pos) => { if (kind === 'explosion') ballistics.fx.explosion(pos); },
  blockMaterial: (id, flash) => blockMaterial(atlas.tex, id, flash),
  drop: () => {},
  pickup: () => false,
});

// som e partícula de impacto por grupo de som do bloco
const IMPACT = { grass: 'dirt', gravel: 'dirt', stone: 'stone', sand: 'sand', wood: 'wood', glass: 'glass', cloth: 'cloth', water: 'dirt' };
const ZONE = { head: 2, body: 1, legs: 0.75 };

const ballistics = new Ballistics(scene, world, entities, (hit, w) => {
  const dmg0 = falloff(w, hit.dist);
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

hud.states = {};
const weapons = new Weapons({ player, ballistics, vm, audio, hud, camera, light: muzzleLight });
hud.states = weapons.state;
hud.weapon(weapons.w, weapons.g);
hud.health(player.hp);

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
  onWeapon: (id) => weapons.select(id),
  onSettings: (k) => {
    if (k === 'vol') audio.setVolume(settings.vol);
    if (k === 'showTrainer') hud.trainerVisible(settings.showTrainer);
    if (k === 'lang') hud.texts();
    if (k === 'mobs') entities.enabled = settings.mobs;
  },
});
entities.enabled = settings.mobs !== false;
menu.local = !!manifest;
menu.texts();
hud.texts();

player.onLockChange = (locked) => {
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
  if (player.locked && player.alive) {
    if (inp.pressed.has('KeyT')) { weapons.setMode(settings.mode === 'legacy' ? 'current' : 'legacy'); menu.refresh(); }
    if (inp.pressed.has('KeyX')) ballistics.fx.clearWall();
    if (inp.pressed.has('KeyP')) { settings.showTrainer = !settings.showTrainer; hud.trainerVisible(settings.showTrainer); }
    if (inp.pressed.has('KeyQ')) weapons.cycle(-1);
    if (inp.wheel) weapons.cycle(inp.wheel);
    GUNS.forEach((g, i) => { if (i < 10 && inp.pressed.has(`Digit${(i + 1) % 10}`)) weapons.select(g.id); });
  }
  if (!player.alive && now - player.deadAt > 1.5 && (inp.leftPressed || inp.pressed.has('Space'))) respawn();
  if (player.alive) {
    player.update(dt, { aiming: weapons.aiming, canSprint: !weapons.reload, pressed: inp.pressed });
    footsteps(dt);
    weapons.update(dt, now, inp);
  }
  player.applyCamera();

  const fov = settings.fov / (weapons.aiming ? weapons.w.zoom : 1);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();

  // mundo pausado com o menu aberto (jogo single player)
  if (menu.el.hidden) {
    entities.update(dt, player);
    ballistics.update(dt);
  }
  world.remesh(2);
  vm.update(dt, {
    aiming: weapons.aiming, sprint: player.sprinting, speed: player.speed, dx: inp.dx, dy: inp.dy,
    reload: weapons.reload ? weapons.reload.t / weapons.reload.dur : null,
    deploy: Math.min(1, weapons.deployT / weapons.w.deployDelay),
  });

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  if (player.alive) renderer.render(vm.cur.scene, vm.cur.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Ganchos para depuração/testes no console
window.__range = { player, weapons, world, entities, ballistics, settings, camera, renderer, scene, vm, hud, frame, respawn };
