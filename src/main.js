import * as THREE from 'three';
import { buildWorld } from './game/world.js';
import { Targets } from './game/targets.js';
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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 3000);
camera.rotation.order = 'YXZ';
const muzzleLight = new THREE.PointLight(0xffb060, 0, 12, 2);
scene.add(muzzleLight);

const world = buildWorld(scene);
const targets = new Targets(scene, world.hit, world.mats);
// Reflexos dos metais: environment map gerado a partir do céu
const envScene = new THREE.Scene();
envScene.add(world.sky.clone());
const env = new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.04, 0.1, 20000).texture;
scene.environment = env;
scene.environmentIntensity = 0.12;
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
const player = new Player(camera, canvas, world.solids, settings);

const ballistics = new Ballistics(scene, world.hit, (hit, w) => {
  const kind = hit.object?.userData.kind ?? 'dirt';
  const target = hit.object?.userData.target;
  ballistics.fx.hole(hit, target?.type === 'wall');
  ballistics.fx.burst(hit.point, hit.normal, kind);
  const res = hit.object ? targets.onHit(hit.object, hit.point, falloff(w, hit.dist)) : null;
  audio.impact(kind, hit.dist, res?.head);
  if (!res || res.wall) return;
  hud.hitmarker(res.head);
  audio.hitmarker();
  const m = `${hit.dist.toFixed(0)} m`;
  if (res.ring != null) hud.info(`${m} · ${res.ring}/6`);
  else if (res.gong) hud.info(m);
  else {
    hud.damage(hit.point, res.dmg, res.head);
    hud.info(`${m} · ${Math.round(res.dmg)}${res.head ? ' · ' + t('head') : ''}${res.kill ? ' · ' + t('kill') : ''}`);
  }
});

hud.states = {};
const weapons = new Weapons({ player, ballistics, vm, audio, hud, camera, light: muzzleLight });
hud.states = weapons.state;
hud.weapon(weapons.w, weapons.g);

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
  },
});
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

// Passos e aterrissagem com os sons do jogo (só quando exportados): madeira na plataforma, grama no resto.
let stepDist = 0;
function footsteps(dt, vyBefore, wasGround) {
  if (!audio.rust || !player.ground) return;
  const surface = player.pos.z > 0 && player.pos.z < 6 && Math.abs(player.pos.x) < 11 ? 'wood' : 'grass';
  if (!wasGround && vyBefore < -3) audio.rust.env(`land_${surface}`, 0.6);
  stepDist += player.speed * dt;
  const stride = player.sprinting ? 2.1 : player.ducked ? 1.1 : 1.5;
  if (player.speed > 0.5 && stepDist > stride) {
    stepDist = 0;
    audio.rust.env(`step_${surface}_${player.sprinting ? 'run' : 'walk'}`, player.ducked ? 0.25 : 0.5);
  }
}

let now = 0, last = 0;
function frame(ts) {
  const dt = last ? Math.min(Math.max((ts - last) / 1000, 0), 0.05) : 0;
  last = ts;
  now += dt;
  const inp = player.consume();
  if (player.locked) {
    if (inp.pressed.has('KeyT')) { weapons.setMode(settings.mode === 'legacy' ? 'current' : 'legacy'); menu.refresh(); }
    if (inp.pressed.has('KeyX')) ballistics.fx.clearWall();
    if (inp.pressed.has('KeyP')) { settings.showTrainer = !settings.showTrainer; hud.trainerVisible(settings.showTrainer); }
    if (inp.pressed.has('KeyQ')) weapons.cycle(-1);
    if (inp.wheel) weapons.cycle(inp.wheel);
    GUNS.forEach((g, i) => { if (i < 10 && inp.pressed.has(`Digit${(i + 1) % 10}`)) weapons.select(g.id); });
  }
  const vyBefore = player.vel.y, wasGround = player.ground;
  player.update(dt, { aiming: weapons.aiming, canSprint: !weapons.reload, pressed: inp.pressed });
  footsteps(dt, vyBefore, wasGround);
  weapons.update(dt, now, inp);
  player.applyCamera();

  const fov = settings.fov / (weapons.aiming ? weapons.w.zoom : 1);
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();

  targets.update(dt, now);
  ballistics.update(dt);
  vm.update(dt, {
    aiming: weapons.aiming, sprint: player.sprinting, speed: player.speed, dx: inp.dx, dy: inp.dy,
    reload: weapons.reload ? weapons.reload.t / weapons.reload.dur : null,
    deploy: Math.min(1, weapons.deployT / weapons.w.deployDelay),
  });

  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  renderer.render(vm.cur.scene, vm.cur.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Ganchos para depuração/testes no console
window.__range = { player, weapons, targets, ballistics, settings, camera, renderer, scene, vm, hud, frame };
