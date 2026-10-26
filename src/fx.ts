/** Particle effects: blood, sparks, explosion flash, fatality gore chunks. Pooled, bounded. */
import * as THREE from 'three';
import { PERF, FATALITY } from './config';

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** downward acceleration (m/s²); negative = buoyant (smoke rises) */
  grav: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

interface Chunk {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;
  wx: number; wy: number; wz: number; // spin rates
  size: number;
  life: number;
  maxLife: number;
}

const CHUNK_COLORS = [0x8a1518, 0x5e0f12, 0x6f7a3a, 0x9a8f6a]; // blood, dark blood, flesh, bone
const MAX_CHUNKS = 90;

export class Fx {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private pool: Particle[] = [];
  shake = 0;
  private flashLight: THREE.PointLight;
  private chunks: THREE.InstancedMesh;
  private chunkPool: Chunk[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private c3 = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const n = PERF.maxParticles;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    const mat = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95 });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < n; i++) {
      this.pool.push({ alive: false, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, grav: 9.5, life: 0, maxLife: 1, color: new THREE.Color() });
      this.positions[i * 3 + 1] = -10;
    }
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 25);
    scene.add(this.flashLight);

    // gore chunks: one InstancedMesh for all fatality debris (1 draw call)
    const chunkGeo = new THREE.BoxGeometry(1, 1, 1);
    const chunkMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    this.chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, MAX_CHUNKS);
    this.chunks.frustumCulled = false;
    this.chunks.castShadow = false;
    this.chunks.receiveShadow = false;
    this.chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_CHUNKS; i++) {
      this.chunkPool.push({ alive: false, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, size: 0.1, life: 0, maxLife: 1 });
      this.m4.makeScale(0, 0, 0);
      this.m4.setPosition(0, -10, 0);
      this.chunks.setMatrixAt(i, this.m4);
      this.chunks.setColorAt(i, this.c3.setHex(CHUNK_COLORS[0]));
    }
    this.chunks.instanceMatrix.needsUpdate = true;
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;
    scene.add(this.chunks);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color, grav = 9.5): void {
    for (const p of this.pool) {
      if (!p.alive) {
        p.alive = true;
        p.x = x; p.y = y; p.z = z;
        p.vx = vx; p.vy = vy; p.vz = vz;
        p.grav = grav;
        p.life = life; p.maxLife = life;
        p.color.copy(color);
        return;
      }
    }
  }

  blood(x: number, y: number, z: number, dirX = 0, dirZ = 0): void {
    const c = new THREE.Color(0x8a1518);
    for (let i = 0; i < 10; i++) {
      this.emit(
        x, y, z,
        dirX * 2 + (Math.random() - 0.5) * 3,
        1.5 + Math.random() * 2.5,
        dirZ * 2 + (Math.random() - 0.5) * 3,
        0.5 + Math.random() * 0.4, c,
      );
    }
  }

  sparks(x: number, y: number, z: number): void {
    const c = new THREE.Color(0xffcc55);
    for (let i = 0; i < 8; i++) {
      this.emit(
        x, y, z,
        (Math.random() - 0.5) * 5, 1 + Math.random() * 3, (Math.random() - 0.5) * 5,
        0.3 + Math.random() * 0.25, c,
      );
    }
  }

  /** Two-stroke exhaust puff from the chainsaw: buoyant grey motes. */
  smoke(x: number, y: number, z: number): void {
    const c = new THREE.Color(0x9aa0a6);
    for (let i = 0; i < 3; i++) {
      this.emit(
        x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.5, 0.7 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5,
        0.6 + Math.random() * 0.5, c,
        -1.4, // buoyant: the puff keeps rising instead of falling
      );
    }
  }

  explosion(x: number, y: number, z: number): void {
    const c1 = new THREE.Color(0xff8833);
    const c2 = new THREE.Color(0x332211);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 9;
      this.emit(
        x, y, z,
        Math.cos(a) * sp, 2 + Math.random() * 7, Math.sin(a) * sp,
        0.5 + Math.random() * 0.6, Math.random() < 0.6 ? c1 : c2,
      );
    }
    this.flashLight.position.set(x, y + 1, z);
    this.flashLight.intensity = 8;
    this.shake = Math.min(1, this.shake + 0.7);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Fatality: burst the corpse into flying gore chunks + a blood cloud. */
  gore(x: number, y: number, z: number): void {
    // blood cloud
    const bc = new THREE.Color(0x8a1518);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 6;
      this.emit(x, y, z, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp,
        0.5 + Math.random() * 0.5, bc);
    }
    // solid chunks
    let placed = 0;
    for (let i = 0; i < this.chunkPool.length && placed < FATALITY.chunks; i++) {
      const c = this.chunkPool[i];
      if (c.alive) continue;
      c.alive = true;
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 7;
      c.x = x; c.y = y + (Math.random() - 0.5) * 0.6; c.z = z;
      c.vx = Math.cos(a) * sp; c.vy = 3 + Math.random() * 6; c.vz = Math.sin(a) * sp;
      c.rx = Math.random() * 6; c.ry = Math.random() * 6; c.rz = Math.random() * 6;
      c.wx = (Math.random() - 0.5) * 22; c.wy = (Math.random() - 0.5) * 22; c.wz = (Math.random() - 0.5) * 22;
      c.size = 0.08 + Math.random() * 0.16;
      c.life = c.maxLife = 1.4 + Math.random() * 0.8;
      this.chunks.setColorAt(i, this.c3.setHex(CHUNK_COLORS[(Math.random() * CHUNK_COLORS.length) | 0]));
      placed++;
    }
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;
    this.flashLight.position.set(x, y, z);
    this.flashLight.intensity = Math.max(this.flashLight.intensity, 4);
    this.shake = Math.min(1, this.shake + 0.5);
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 30);
    let anyAlive = false;
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.alive) continue;
      anyAlive = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.positions[i * 3 + 1] = -10;
        continue;
      }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy = 0;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      const fade = p.life / p.maxLife;
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.colors[i * 3] = p.color.r * fade;
      this.colors[i * 3 + 1] = p.color.g * fade;
      this.colors[i * 3 + 2] = p.color.b * fade;
    }
    if (anyAlive) {
      (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    }

    // gore chunks: gravity, ground bounce, spin, shrink-out
    let chunkDirty = false;
    for (let i = 0; i < this.chunkPool.length; i++) {
      const c = this.chunkPool[i];
      if (!c.alive) continue;
      chunkDirty = true;
      c.life -= dt;
      if (c.life <= 0) {
        c.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.m4.setPosition(0, -10, 0);
        this.chunks.setMatrixAt(i, this.m4);
        continue;
      }
      c.vy -= 16 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < c.size * 0.5) {
        c.y = c.size * 0.5;
        c.vy = Math.abs(c.vy) * 0.32;
        c.vx *= 0.62; c.vz *= 0.62;
        c.wx *= 0.6; c.wy *= 0.6; c.wz *= 0.6;
      }
      c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
      const shrink = c.life < 0.35 ? c.life / 0.35 : 1;
      const s = c.size * shrink;
      this.e.set(c.rx, c.ry, c.rz);
      this.q.setFromEuler(this.e);
      this.v3.set(c.x, c.y, c.z);
      this.s3.set(s, s, s);
      this.m4.compose(this.v3, this.q, this.s3);
      this.chunks.setMatrixAt(i, this.m4);
    }
    if (chunkDirty) this.chunks.instanceMatrix.needsUpdate = true;
  }
}
