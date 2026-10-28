/** Particle effects: blood, sparks, explosion flash, fatality gore chunks. Pooled, bounded. */
import * as THREE from 'three';
import { PERF, FATALITY, GORE } from './config';

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

/** Persistent ground blood pool: spreads on landing, dries red→black, then fades. */
interface Pool {
  alive: boolean;
  x: number; z: number;
  r: number; // final radius
  rot: number; // yaw, so the shared blob outline reads varied
  spread: number; // 0..1 grow-in progress
  life: number;
  maxLife: number;
}

/** Severed head: a big round gib that bounces, rolls and settles. */
interface Head {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; rz: number;
  wx: number; wz: number; // roll spin
  life: number;
  maxLife: number;
}

const CHUNK_COLORS = [0x8a1518, 0x5e0f12, 0x6f7a3a, 0x9a8f6a]; // blood, dark blood, flesh, bone
const MAX_CHUNKS = 90;
const MAX_POOLS = GORE.poolMax;
const MAX_HEADS = 24;

export class Fx {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private pool: Particle[] = [];
  shake = 0;
  private flashLight: THREE.PointLight;
  private chunks: THREE.InstancedMesh;
  private chunkPool: Chunk[] = [];
  private pools: THREE.InstancedMesh;
  private bloodPools: Pool[] = [];
  private heads: THREE.InstancedMesh;
  private headPool: Head[] = [];
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private c3 = new THREE.Color();
  private c3Dark = new THREE.Color(0x1c0203); // dried-blood target for pools

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

    // blood pools: flat translucent blobs that spread, dry and fade (1 draw call).
    // the outline is one jagged blob — per-instance yaw + oval squash varies the look.
    const blob: THREE.Vector2[] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = 0.7 + Math.random() * 0.5; // lumpy edge, like real splatter
      blob.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    const poolGeo = new THREE.ShapeGeometry(new THREE.Shape(blob));
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.pools = new THREE.InstancedMesh(poolGeo, poolMat, MAX_POOLS);
    this.pools.frustumCulled = false;
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_POOLS; i++) {
      this.bloodPools.push({ alive: false, x: 0, z: 0, r: 0, rot: 0, spread: 0, life: 0, maxLife: 1 });
      this.m4.makeScale(0, 0, 0);
      this.m4.setPosition(0, -10, 0);
      this.pools.setMatrixAt(i, this.m4);
    }
    this.pools.instanceMatrix.needsUpdate = true;
    this.pools.renderOrder = 2; // draw over the ground, under particles
    scene.add(this.pools);

    // severed heads: one InstancedMesh (1 draw call), skin-toned
    const headGeo = new THREE.IcosahedronGeometry(0.16, 1);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x7d9a5a, roughness: 0.9, metalness: 0 });
    this.heads = new THREE.InstancedMesh(headGeo, headMat, MAX_HEADS);
    this.heads.frustumCulled = false;
    this.heads.castShadow = false;
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_HEADS; i++) {
      this.headPool.push({ alive: false, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, rz: 0, wx: 0, wz: 0, life: 0, maxLife: 1 });
      this.m4.makeScale(0, 0, 0);
      this.m4.setPosition(0, -10, 0);
      this.heads.setMatrixAt(i, this.m4);
    }
    this.heads.instanceMatrix.needsUpdate = true;
    scene.add(this.heads);
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

  /** Chainsaw cut: heavy two-tone gore spray thrown down the blade line.
   * The saw shreds instead of slicing, so every tick sprays double the
   * blood of a knife hit — most of it flung FORWARD along the cut. Sized
   * so sustained cutting of a small crowd stays under the particle cap. */
  sawSpray(x: number, y: number, z: number, dirX = 0, dirZ = 0): void {
    const dark = new THREE.Color(0x8a1518);
    const bright = new THREE.Color(0xa8202a); // arterial mist
    for (let i = 0; i < 20; i++) {
      const fwd = 3.5 + Math.random() * 4.5;
      const spread = (Math.random() - 0.5) * 2.4; // fan across the blade line
      this.emit(
        x, y + (Math.random() - 0.5) * 0.7, z,
        dirX * fwd - dirZ * spread, 1.2 + Math.random() * 3, dirZ * fwd + dirX * spread,
        0.4 + Math.random() * 0.35, Math.random() < 0.35 ? bright : dark,
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

  /** Flamethrower stream: a burst of fire racing down the aim direction. */
  flameJet(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const c1 = new THREE.Color(0xff9933);
    const c2 = new THREE.Color(0xffdd55);
    for (let i = 0; i < 4; i++) {
      const sp = 13 + Math.random() * 5;
      this.emit(
        x, y, z,
        dx * sp + (Math.random() - 0.5) * 1.8,
        dy * sp + (Math.random() - 0.5) * 1.8 + 0.6,
        dz * sp + (Math.random() - 0.5) * 1.8,
        0.3 + Math.random() * 0.35, Math.random() < 0.5 ? c1 : c2,
        -2.2, // hot gas rises
      );
    }
  }

  /** A burning zombie: small orange licks peeling off the body. */
  burnFx(x: number, y: number, z: number): void {
    const c = new THREE.Color(Math.random() < 0.5 ? 0xff7722 : 0xffcc44);
    this.emit(
      x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.7, z + (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6,
      0.25 + Math.random() * 0.3, c,
      -2.5,
    );
  }

  /** BFG plasma ball trail: glowing green motes. */
  bfgTrail(x: number, y: number, z: number): void {
    const c = new THREE.Color(0x55ff77);
    for (let i = 0; i < 2; i++) {
      this.emit(
        x + (Math.random() - 0.5) * 0.2, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5,
        0.25 + Math.random() * 0.3, c,
        -0.5,
      );
    }
  }

  /** Rare weapon drop: cold blue sparkles rising off the crate. */
  shimmer(x: number, y: number, z: number): void {
    const c = new THREE.Color(Math.random() < 0.5 ? 0x55aaff : 0x99ddff);
    this.emit(
      x + (Math.random() - 0.5) * 0.7, y, z + (Math.random() - 0.5) * 0.7,
      (Math.random() - 0.5) * 0.3, 0.8 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3,
      0.4 + Math.random() * 0.4, c,
      -1.8, // drifts up like cold fireflies
    );
  }

  /** Fatality: burst the corpse into flying gore chunks + a blood cloud + pools. */
  gore(x: number, y: number, z: number): void {
    // blood cloud
    const bc = new THREE.Color(0x8a1518);
    for (let i = 0; i < 34; i++) {
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
    // the mess that stays: a central pool ringed by satellite splatters
    this.splat(x, z, GORE.fatalityPools);
    this.flashLight.position.set(x, y, z);
    this.flashLight.intensity = Math.max(this.flashLight.intensity, 4);
    this.shake = Math.min(1, this.shake + 0.5);
  }

  /** One blood pool; the oldest recycles when the field is full. */
  bloodPool(x: number, z: number, r = 0.45): void {
    let slot = -1;
    let oldest = Infinity;
    for (let i = 0; i < this.bloodPools.length; i++) {
      const p = this.bloodPools[i];
      if (!p.alive) { slot = i; break; }
      if (p.life < oldest) { oldest = p.life; slot = i; }
    }
    const p = this.bloodPools[slot];
    p.alive = true;
    p.x = x + (Math.random() - 0.5) * 0.3;
    p.z = z + (Math.random() - 0.5) * 0.3;
    p.r = r * (0.8 + Math.random() * 0.5);
    p.rot = Math.random() * Math.PI * 2;
    p.spread = 0;
    p.life = p.maxLife = GORE.poolLife * (0.8 + Math.random() * 0.4);
  }

  /** Fatality splatter: a big central pool plus satellites flung outward. */
  splat(x: number, z: number, satellites = GORE.fatalityPools): void {
    this.bloodPool(x, z, 0.85);
    for (let k = 0; k < satellites; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 0.7 + Math.random() * 1.9;
      this.bloodPool(x + Math.cos(a) * d, z + Math.sin(a) * d, 0.28 + Math.random() * 0.3);
    }
  }

  /** Arterial mist: slow dark-red motes that hang at the wound for a moment. */
  mist(x: number, y: number, z: number, dirX = 0, dirZ = 0): void {
    const dark = new THREE.Color(0x7a1014);
    const bright = new THREE.Color(0xb0252e);
    for (let i = 0; i < 6; i++) {
      this.emit(
        x, y + (Math.random() - 0.5) * 0.3, z,
        dirX * 1.3 + (Math.random() - 0.5) * 1.7,
        0.3 + Math.random() * 1.1,
        dirZ * 1.3 + (Math.random() - 0.5) * 1.7,
        0.5 + Math.random() * 0.4, Math.random() < 0.4 ? bright : dark,
        -0.6, // nearly buoyant: the mist lingers
      );
    }
  }

  /** Headshot: the head comes off, rockets down the bullet line, rolls, settles. */
  severedHead(x: number, y: number, z: number, dirX = 0, dirZ = 0): void {
    let slot = -1;
    let oldest = Infinity;
    for (let i = 0; i < this.headPool.length; i++) {
      const h = this.headPool[i];
      if (!h.alive) { slot = i; break; }
      if (h.life < oldest) { oldest = h.life; slot = i; }
    }
    const h = this.headPool[slot];
    h.alive = true;
    h.x = x; h.y = y; h.z = z;
    const spd = 5 + Math.random() * 3;
    h.vx = dirX * spd + (Math.random() - 0.5) * 1.5;
    h.vz = dirZ * spd + (Math.random() - 0.5) * 1.5;
    h.vy = 3.5 + Math.random() * 2.5;
    h.rx = Math.random() * 6; h.rz = Math.random() * 6;
    h.wx = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 8);
    h.wz = (Math.random() - 0.5) * 10;
    h.life = h.maxLife = GORE.headLife;
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

    // blood pools: grow in fast, dry red→black over life, shrink out at the end
    let poolDirty = false;
    for (let i = 0; i < this.bloodPools.length; i++) {
      const p = this.bloodPools[i];
      if (!p.alive) continue;
      poolDirty = true;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.m4.setPosition(0, -10, 0);
        this.pools.setMatrixAt(i, this.m4);
        continue;
      }
      if (p.spread < 1) p.spread = Math.min(1, p.spread + dt * 3.2);
      const age = 1 - p.life / p.maxLife; // 0 fresh → 1 dried
      const ease = 1 - Math.pow(1 - p.spread, 3); // fast spread, easing out
      const shrink = p.life < 1.5 ? p.life / 1.5 : 1;
      const r = p.r * ease * shrink;
      this.e.set(0, p.rot, 0);
      this.q.setFromEuler(this.e);
      this.v3.set(p.x, 0.02, p.z);
      this.s3.set(r, 1, r * (0.82 + 0.3 * ((i * 0.618) % 1))); // slightly oval
      this.m4.compose(this.v3, this.q, this.s3);
      this.pools.setMatrixAt(i, this.m4);
      // fresh arterial red → dried near-black
      this.c3.setHex(0x6e0d12).lerp(this.c3Dark, Math.min(1, age * 1.4));
      this.pools.setColorAt(i, this.c3);
    }
    if (poolDirty) {
      this.pools.instanceMatrix.needsUpdate = true;
      if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
    }

    // severed heads: fly, bounce, roll, soak in
    let headDirty = false;
    for (let i = 0; i < this.headPool.length; i++) {
      const h = this.headPool[i];
      if (!h.alive) continue;
      headDirty = true;
      h.life -= dt;
      if (h.life <= 0) {
        h.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.m4.setPosition(0, -10, 0);
        this.heads.setMatrixAt(i, this.m4);
        continue;
      }
      h.vy -= 14 * dt;
      h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt;
      if (h.y < 0.15) {
        h.y = 0.15;
        if (Math.abs(h.vy) > 1) {
          h.vy = Math.abs(h.vy) * 0.42; // round skull bounces good
          if (Math.random() < 0.5) this.blood(h.x, 0.25, h.z); // drip on the bounce
        } else {
          h.vy = 0;
          h.vx *= 0.94; h.vz *= 0.94; // rolling friction
          h.wx *= 0.96; h.wz *= 0.96;
        }
      }
      h.rx += h.wx * dt; h.rz += h.wz * dt;
      const shrink = h.life < 0.6 ? h.life / 0.6 : 1;
      this.e.set(h.rx, 0, h.rz);
      this.q.setFromEuler(this.e);
      this.v3.set(h.x, h.y, h.z);
      this.s3.setScalar(0.95 * shrink);
      this.m4.compose(this.v3, this.q, this.s3);
      this.heads.setMatrixAt(i, this.m4);
    }
    if (headDirty) this.heads.instanceMatrix.needsUpdate = true;
  }
}
