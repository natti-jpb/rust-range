import * as THREE from 'three';

const DEG = Math.PI / 180;
// Movimento do Rust (PlayerWalkMovement / BasePlayer): BasePlayer.GetSpeed, gravidade ×2,5, pulo +9 m/s,
// altura 1,8 (agachado 1,1), olhos a 1,5 m (agachado −0,6). Largura de 0,6 para caber em 1 bloco.
const G = 9.81 * 2.5, JUMP = 9, HALF = 0.3, H_STAND = 1.8, H_DUCK = 1.1;
const lerp = (a, b, t) => a + (b - a) * t;
const speedOf = (running, ducking) => lerp(lerp(2.8, 5.5, running), 1.7, ducking);

export class Player {
  constructor(camera, canvas, world, settings) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = world;
    this.settings = settings;
    this.aim = { body: { pitch: 0, yaw: 0 }, recoil: { pitch: 0, yaw: 0 } };
    this.pos = world.spawn.clone();
    this.vel = new THREE.Vector3();
    this.ground = true;
    this.ducking = 0; // físico: 0 ou 1, como BaseMovement.Ducking
    this.duckView = 0; // suavizado para a câmera
    this.t = 0;
    this.jumpTime = this.landTime = -9;
    this.groundTime = 0;
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
      // com o inventário aberto (sem pointer lock) o jogador ainda anda, como no Rust
      if (!this.locked && !this.ui) return;
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
  get height() { return lerp(H_STAND, H_DUCK, this.ducking); }
  get eye() { return this.pos.y + 1.5 - 0.6 * this.duckView; }

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
    const k = this.keys, w = this.world;
    this.t += dt;
    const W = k.has('KeyW'), A = k.has('KeyA'), S = k.has('KeyS'), D = k.has('KeyD');
    // agachar é instantâneo; levantar só se couber em pé (GetForcedDuck)
    const wantDuck = k.has('KeyC') || k.has('ControlLeft');
    this.ducking = wantDuck || !w.boxFree(this.pos, HALF, H_STAND) ? 1 : 0;
    this.duckView += (this.ducking - this.duckView) * Math.min(1, dt * 10);
    // sprint só andando para frente, sem strafe (Movement_Walking)
    this.sprinting = canSprint && k.has('ShiftLeft') && W && !A && !S && !D && !this.ducked && !aiming;
    const fwd = (W ? 1 : 0) - (S ? 1 : 0), side = (D ? 1 : 0) - (A ? 1 : 0);
    const yaw = this.aim.body.yaw * DEG;
    const target = new THREE.Vector3(Math.sin(yaw) * fwd + Math.cos(yaw) * side, 0, -Math.cos(yaw) * fwd + Math.sin(yaw) * side);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speedOf(this.sprinting ? 1 : 0, this.ducking));

    if (this.ground) {
      // no chão a velocidade é o alvo, sem aceleração (UpdateVelocity: grounded)
      this.vel.x = target.x;
      this.vel.z = target.z;
      this.vel.y = Math.min(this.vel.y, 0);
      this.groundTime = this.t;
    } else {
      const c = Math.min(1, 3 * dt); // controle no ar
      this.vel.x += (target.x - this.vel.x) * c;
      this.vel.z += (target.z - this.vel.z) * c;
    }
    const canJump = this.t - this.jumpTime >= 0.5 && this.t - this.groundTime <= 0.1 && this.t - this.landTime >= 0.1;
    if (pressed.has('Space') && canJump) {
      this.vel.y += JUMP;
      this.jumpTime = this.t;
      this.ground = false;
      this.onJump?.();
    }
    if (!this.ground) this.vel.y -= G * dt;

    const vy = this.vel.y, wasGround = this.ground;
    const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.4));
    let landed = false;
    for (let i = 0; i < steps; i++) {
      const d = this.vel.clone().multiplyScalar(dt / steps);
      const hit = w.moveBox(this.pos, HALF, this.height, d);
      if (hit.x) this.vel.x = 0;
      if (hit.z) this.vel.z = 0;
      if (hit.y) { if (this.vel.y < 0) landed = true; this.vel.y = 0; }
    }
    // chão = há bloco sólido logo abaixo dos pés
    this.ground = !w.boxFree({ x: this.pos.x, y: this.pos.y - 0.05, z: this.pos.z }, HALF, 0.05);
    if (this.ground && !wasGround && (landed || vy < 0)) {
      this.landTime = this.t;
      // ApplyFallDamageFromVelocity: InverseLerp(-15, -100, v) × 500
      const f = Math.min(1, Math.max(0, (vy + 15) / -85));
      this.onLand?.(vy, f * 500);
    }
  }

  // Câmera = bodyAngles + recoilAngles
  applyCamera() {
    const { body, recoil } = this.aim;
    this.camera.position.set(this.pos.x, this.eye, this.pos.z);
    this.camera.rotation.set(-(body.pitch + recoil.pitch) * DEG, -(body.yaw + recoil.yaw) * DEG, 0, 'YXZ');
  }
}
