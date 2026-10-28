/** Projectiles: bazooka rockets & zombie-thrown objects. Bounded pool. */
import * as THREE from 'three';
import { AABB, Vec2, rayAABB } from './collision';
import { THROWABLE, PERF, BFG } from './config';
import { ThrowableObject } from './world';
import { ZombieManager } from './zombie';
import { Fx } from './fx';
import { sfx } from './audio';

interface Projectile {
  alive: boolean;
  kind: 'rocket' | 'object' | 'bfg';
  meshKind: 'rocket' | 'object' | 'bfg'; // which body the mesh actually is
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  life: number;
  obj: ThrowableObject | null; // for thrown objects: return on land
}

export interface ProjectileEvents {
  /** big = BFG detonation: the arena eats a much bigger boom. */
  onExplosion(pos: THREE.Vector3, big: boolean): void;
  onPlayerHitByObject(damage: number, x: number, z: number): void;
}

export class ProjectileManager {
  private pool: Projectile[] = [];
  private geoRocket = new THREE.BoxGeometry(0.14, 0.14, 0.5);
  private matRocket = new THREE.MeshLambertMaterial({ color: 0x445522 });
  private geoBfg = new THREE.SphereGeometry(0.35, 10, 8);
  private matBfg = new THREE.MeshBasicMaterial({ color: 0x66ff77 });

  constructor(
    private scene: THREE.Scene,
    private colliders: AABB[],
    private zombies: ZombieManager,
    private fx: Fx,
    private events: ProjectileEvents,
  ) {}

  private makeMesh(kind: 'rocket' | 'object' | 'bfg', obj: ThrowableObject | null): THREE.Object3D {
    if (kind === 'rocket') return new THREE.Mesh(this.geoRocket, this.matRocket);
    if (kind === 'bfg') return new THREE.Mesh(this.geoBfg, this.matBfg);
    return obj
      ? obj.mesh.clone()
      : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x888888 }));
  }

  private acquire(kind: 'rocket' | 'object' | 'bfg', obj: ThrowableObject | null): Projectile {
    for (const p of this.pool) {
      if (!p.alive) {
        if (p.meshKind !== kind) {
          // the slot wears the wrong body: swap in the right one
          this.scene.remove(p.mesh);
          p.mesh = this.makeMesh(kind, obj);
          this.scene.add(p.mesh);
          p.meshKind = kind;
        }
        p.alive = true;
        p.obj = null;
        return p;
      }
    }
    if (this.pool.length >= PERF.maxProjectiles) {
      // recycle oldest
      const p = this.pool[0];
      this.retire(p);
      return this.acquire(kind, obj);
    }
    const p: Projectile = {
      alive: true, kind, meshKind: kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      mesh: this.makeMesh(kind, obj), life: 0, obj,
    };
    this.scene.add(p.mesh);
    this.pool.push(p);
    return p;
  }

  private retire(p: Projectile): void {
    if (p.obj) {
      // object lands: make it pickable again after a delay, at landing spot
      p.obj.pos.x = p.pos.x;
      p.obj.pos.z = p.pos.z;
      p.obj.taken = false;
      p.obj.mesh.visible = true;
      p.obj.mesh.position.set(p.pos.x, 0.08, p.pos.z);
      p.obj = null;
    }
    p.alive = false;
    p.mesh.visible = false;
  }

  fireRocket(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const p = this.acquire('rocket', null);
    p.kind = 'rocket';
    p.pos.copy(origin);
    p.vel.copy(dir).multiplyScalar(38);
    p.life = 5;
    p.obj = null;
    p.mesh.visible = true;
    p.mesh.position.copy(p.pos);
  }

  fireBfg(origin: THREE.Vector3, dir: THREE.Vector3): void {
    const p = this.acquire('bfg', null);
    p.kind = 'bfg';
    p.pos.copy(origin);
    p.vel.copy(dir).multiplyScalar(BFG.speed);
    p.life = 4;
    p.obj = null;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(1);
    p.mesh.position.copy(p.pos);
  }

  throwObject(origin: THREE.Vector3, vel: THREE.Vector3, obj: ThrowableObject): void {
    const p = this.acquire('object', obj);
    p.kind = 'object';
    p.pos.copy(origin);
    p.vel.copy(vel);
    p.life = 5;
    p.obj = obj;
    p.mesh.visible = true;
    p.mesh.position.copy(p.pos);
  }

  clearAll(): void {
    for (const p of this.pool) {
      if (p.alive) this.retire(p);
    }
  }

  update(dt: number, playerPos: Vec2, playerEyeY: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind !== 'object') this.explode(p.pos, p.kind === 'bfg');
        this.retire(p);
        continue;
      }

      if (p.kind === 'object') p.vel.y -= THROWABLE.gravity * dt;

      const step = p.vel.clone().multiplyScalar(dt);
      const dist = step.length();
      const dir = dist > 0 ? step.clone().normalize() : new THREE.Vector3(0, 0, 0);

      // world collision
      if (dist > 0.0001) {
        let hitDist = dist;
        let hit = false;
        for (const c of this.colliders) {
          if (p.pos.y > c.height + 0.3) continue;
          const t = rayAABB({ x: p.pos.x, z: p.pos.z }, { x: dir.x, z: dir.z }, hitDist, c);
          if (t !== null && t < hitDist) {
            hitDist = t;
            hit = true;
          }
        }
        if (hit) {
          p.pos.addScaledVector(dir, Math.max(0, hitDist - 0.05));
          if (p.kind !== 'object') {
            this.explode(p.pos, p.kind === 'bfg');
            this.retire(p);
            continue;
          }
          sfx.objectHit();
          this.fx.sparks(p.pos.x, p.pos.y, p.pos.z);
          this.retire(p);
          continue;
        }
      }

      // zombie collision (rockets, BFG & heavy objects)
      if (p.kind !== 'object') {
        const hitZ = this.zombies.raycast(p.pos, dir, Math.max(dist, 0.5));
        if (hitZ) {
          this.explode(p.pos, p.kind === 'bfg');
          this.retire(p);
          continue;
        }
      }

      // player collision (thrown objects)
      if (p.kind === 'object') {
        const dx = p.pos.x - playerPos.x;
        const dz = p.pos.z - playerPos.z;
        const dy = p.pos.y - (playerEyeY - 0.8);
        if (dx * dx + dz * dz < THROWABLE.playerHitRadius * THROWABLE.playerHitRadius && Math.abs(dy) < 1.2) {
          this.events.onPlayerHitByObject(THROWABLE.damage, p.pos.x, p.pos.z);
          sfx.objectHit();
          this.fx.addShake(0.35);
          this.retire(p);
          continue;
        }
      }

      p.pos.add(step);
      if (p.pos.y < 0.1) {
        if (p.kind !== 'object') {
          this.explode(p.pos, p.kind === 'bfg');
        } else {
          sfx.objectHit();
        }
        this.retire(p);
        continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.kind === 'rocket') {
        p.mesh.lookAt(p.pos.clone().add(p.vel));
      } else if (p.kind === 'bfg') {
        // the plasma ball breathes as it flies, shedding green motes
        p.mesh.scale.setScalar(1 + Math.sin(p.life * 22) * 0.18);
        this.fx.bfgTrail(p.pos.x, p.pos.y, p.pos.z);
      } else {
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.z += dt * 5;
      }
    }
  }

  private explode(pos: THREE.Vector3, big: boolean): void {
    this.fx.explosion(pos.x, Math.max(0.3, pos.y), pos.z);
    if (big) this.fx.addShake(0.5); // the BFG hits you in the chest before it hits them
    sfx.explosion();
    this.events.onExplosion(pos, big);
  }
}
