/** Particle effects: blood, sparks, explosion flash. Pooled, bounded. */
import * as THREE from 'three';
import { PERF } from './config';

interface Particle {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

export class Fx {
  private points: THREE.Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private pool: Particle[] = [];
  shake = 0;
  private flashLight: THREE.PointLight;

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
      this.pool.push({ alive: false, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, color: new THREE.Color() });
      this.positions[i * 3 + 1] = -10;
    }
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 25);
    scene.add(this.flashLight);
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, color: THREE.Color): void {
    for (const p of this.pool) {
      if (!p.alive) {
        p.alive = true;
        p.x = x; p.y = y; p.z = z;
        p.vx = vx; p.vy = vy; p.vz = vz;
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
      p.vy -= 9.5 * dt;
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
  }
}
