import * as THREE from 'three';
import { BOUNDS } from './world.js';

const DEG = Math.PI / 180;
// Velocidades aproximadas do Rust (m/s)
const WALK = 2.8, SPRINT = 5.5, CROUCH = 1.7, JUMP = 4.8, G = 9.81, R = 0.3;

export class Player {
  constructor(camera, canvas, solids, settings) {
    this.camera = camera;
    this.canvas = canvas;
    this.solids = solids;
    this.settings = settings;
    this.aim = { body: { pitch: 0, yaw: 0 }, recoil: { pitch: 0, yaw: 0 } };
    this.pos = new THREE.Vector3(0, 0, 3);
    this.vel = new THREE.Vector3();
    this.ground = true;
    this.ducking = 0; // como modelState.ducking: ducked = ducking > 0.5
    this.keys = new Set();
    this.mouse = { left: false, right: false, leftPressed: false, rightPressed: false };
    this.dx = this.dy = 0;
    this.locked = false;
    this.wheel = 0;
    this.pressed = new Set();

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Rust: GetAxis × sensitivity × 3 × (cameraFOV/100); GetAxis ≈ 0,03 por count
      const k = 0.09 * this.settings.sens * (camera.fov / 100);
      this.aim.body.yaw += e.movementX * k;
      this.aim.body.pitch = Math.max(-89, Math.min(89, this.aim.body.pitch + e.movementY * k));
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (e.code !== 'Escape') e.preventDefault();
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  async lock() {
    try {
      await this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try { await this.canvas.requestPointerLock(); } catch { /* sem gesto do usuário */ }
    }
  }

  get ducked() { return this.ducking > 0.5; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get eye() { return this.pos.y + 1.5 - 0.5 * this.ducking; }

  // Lê e zera eventos de borda do frame.
  consume() {
    const r = { pressed: this.pressed, wheel: this.wheel, dx: this.dx, dy: this.dy,
      leftPressed: this.mouse.leftPressed, rightPressed: this.mouse.rightPressed };
    this.pressed = new Set();
    this.wheel = this.dx = this.dy = 0;
    this.mouse.leftPressed = this.mouse.rightPressed = false;
    return r;
  }

  update(dt, { aiming, canSprint, pressed }) {
    const k = this.keys;
    const crouch = k.has('KeyC') || k.has('ControlLeft');
    this.ducking += ((crouch ? 1 : 0) - this.ducking) * Math.min(1, dt * 9);
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    this.sprinting = canSprint && k.has('ShiftLeft') && fwd > 0 && !crouch && !aiming;
    const max = this.ducked ? CROUCH : this.sprinting ? SPRINT : WALK;
    const yaw = this.aim.body.yaw * DEG;
    const wish = new THREE.Vector3(Math.sin(yaw) * fwd + Math.cos(yaw) * side, 0, -Math.cos(yaw) * fwd + Math.sin(yaw) * side);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(max);
    const accel = this.ground ? 12 : 2;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, dt * accel);
    if (this.ground && pressed.has('Space')) { this.vel.y = JUMP; this.ground = false; }
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);

    // chão (piso da linha de tiro tem 15 cm) e caixas
    let floor = this.pos.z > 0 && this.pos.z < 6 && Math.abs(this.pos.x) < 11 ? 0.15 : 0;
    for (const s of this.solids) {
      if (this.pos.x > s.minX - R && this.pos.x < s.maxX + R && this.pos.z > s.minZ - R && this.pos.z < s.maxZ + R) {
        if (this.pos.y >= s.top - 0.35) { floor = Math.max(floor, s.top); continue; }
        const dl = this.pos.x - (s.minX - R), dr = s.maxX + R - this.pos.x, db = this.pos.z - (s.minZ - R), df = s.maxZ + R - this.pos.z;
        const m = Math.min(dl, dr, db, df);
        if (m === dl) this.pos.x = s.minX - R; else if (m === dr) this.pos.x = s.maxX + R;
        else if (m === db) this.pos.z = s.minZ - R; else this.pos.z = s.maxZ + R;
      }
    }
    if (this.pos.y <= floor) { this.pos.y = floor; this.vel.y = 0; this.ground = true; } else if (this.pos.y > floor + 0.05) this.ground = false;
    this.pos.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, this.pos.x));
    this.pos.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, this.pos.z));
  }

  // Câmera = bodyAngles + recoilAngles
  applyCamera() {
    const { body, recoil } = this.aim;
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    this.camera.rotation.set(-(body.pitch + recoil.pitch) * DEG, -(body.yaw + recoil.yaw) * DEG, 0, 'YXZ');
  }
}
