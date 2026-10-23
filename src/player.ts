/** First-person player controller: movement, look, collision, health. */
import * as THREE from 'three';
import { AABB, Vec2, resolveCircleWorld } from './collision';
import { PLAYER } from './config';
import { state } from './state';

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  /** Optional analog axes from touch controls, -1..1 (y: up = negative). */
  moveX: number;
  moveY: number;
}

export class Player {
  pos: Vec2 = { x: state.playerX, z: state.playerZ };
  vel = new THREE.Vector3();
  yaw = state.playerYaw;
  pitch = 0;
  onGround = true;
  health = PLAYER.maxHealth;
  immunity = 0;
  damageFlash = 0; // 0..1 HUD feedback
  lastDamageDir = 0; // yaw angle of last hit source
  input: InputState = { forward: false, back: false, left: false, right: false, sprint: false, jump: false, moveX: 0, moveY: 0 };
  private recoilPitch = 0;

  constructor(private camera: THREE.PerspectiveCamera, private colliders: AABB[]) {}

  reset(): void {
    this.pos = { x: 0, z: 8 };
    this.vel.set(0, 0, 0);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.onGround = true;
    this.health = PLAYER.maxHealth;
    this.immunity = 0;
    this.damageFlash = 0;
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * PLAYER.mouseSensitivity;
    this.pitch -= dy * PLAYER.mouseSensitivity;
    const lim = PLAYER.pitchLimit;
    this.pitch = Math.min(lim, Math.max(-lim, this.pitch));
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  addRecoil(amount: number): void {
    this.recoilPitch += amount;
  }

  private y = PLAYER.eyeHeight;

  get position3(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.y, this.pos.z);
  }

  get dir(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * cp,
    );
  }

  get flatDir(): Vec2 {
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
  }

  damage(amount: number, fromX: number, fromZ: number): boolean {
    if (this.immunity > 0 || state.phase !== 'playing') return false;
    this.health -= amount;
    this.immunity = PLAYER.damageImmunityTime;
    this.damageFlash = 1;
    this.lastDamageDir = Math.atan2(fromX - this.pos.x, fromZ - this.pos.z);
    if (this.health <= 0) {
      this.health = 0;
      state.phase = 'dead';
    }
    return true;
  }

  update(dt: number): void {
    this.immunity = Math.max(0, this.immunity - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);

    // desired horizontal movement in camera space (keyboard digital + touch analog)
    let f = (this.input.forward ? 1 : 0) - (this.input.back ? 1 : 0);
    let s = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    if (this.input.moveX !== 0 || this.input.moveY !== 0) {
      f = Math.max(-1, Math.min(1, f - this.input.moveY));
      s = Math.max(-1, Math.min(1, s + this.input.moveX));
    }
    let wx = 0;
    let wz = 0;
    if (f !== 0 || s !== 0) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = -fz;
      const rz = fx;
      wx = fx * f + rx * s;
      wz = fz * f + rz * s;
      const len = Math.hypot(wx, wz);
      if (len > 1) {
        // analog magnitude is preserved, direction clamped to unit circle
        wx /= len;
        wz /= len;
      }
    }
    const forwardAmt = Math.max(0, f);
    state.sprinting = this.input.sprint && forwardAmt > 0.5;
    const speed = state.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    const accel = this.onGround ? PLAYER.accel : PLAYER.airAccel;
    if (wx !== 0 || wz !== 0) {
      this.vel.x += wx * accel * dt;
      this.vel.z += wz * accel * dt;
    }
    // friction / clamp horizontal speed
    if (this.onGround) {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > 0) {
        const drop = hs * Math.min(1, PLAYER.friction * dt);
        const keep = (hs - drop) / hs;
        this.vel.x *= keep;
        this.vel.z *= keep;
      }
      const hs2 = Math.hypot(this.vel.x, this.vel.z);
      if (hs2 > speed) {
        const k = speed / hs2;
        this.vel.x *= k;
        this.vel.z *= k;
      }
    }

    // jump & gravity
    if (this.input.jump && this.onGround) {
      this.vel.y = PLAYER.jumpSpeed;
      this.onGround = false;
    }
    this.vel.y -= PLAYER.gravity * dt;
    this.y += this.vel.y * dt;
    if (this.y <= PLAYER.eyeHeight) {
      this.y = PLAYER.eyeHeight;
      this.vel.y = 0;
      this.onGround = true;
    }

    // integrate + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    resolveCircleWorld(this.colliders, this.pos, PLAYER.radius);

    // recoil decay
    this.recoilPitch *= Math.max(0, 1 - dt * 8);

    // sync camera
    this.camera.position.set(this.pos.x, this.y, this.pos.z);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0, 'YXZ');

    // sync state
    state.time += dt;
    state.health = this.health;
    state.playerX = this.pos.x;
    state.playerZ = this.pos.z;
    state.playerYaw = this.yaw;
  }
}
