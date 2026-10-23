/** Projectiles: bazooka rockets & zombie-thrown objects. Bounded pool. */
import * as THREE from 'three';
import { AABB, Vec2, rayAABB } from './collision';
import { THROWABLE, PERF } from './config';
import { ThrowableObject } from './world';
import { ZombieManager } from './zombie';
import { Fx } from './fx';
import { sfx } from './audio';

interface Projectile {
  alive: boolean;
  kind: 'rocket' | 'object';
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mesh: THREE.Object3D;
  life: number;
  obj: ThrowableObject | null; // for thrown objects: return on land
}

export interface ProjectileEvents {
  onExplosion(pos: THREE.Vector3): void;
  onPlayerHitByObject(damage: number, x: number, z: number): void;
}

export class ProjectileManager {
  private pool: Projectile[] = [];
  private geoRocket = new THREE.BoxGeometry(0.14, 0.14, 0.5);
  private matRocket = new THREE.MeshLambertMaterial({ color: 0x445522 });

  constructor(
    private scene: THREE.Scene,
    private colliders: AABB[],
    private zombies: ZombieManager,
    private fx: Fx,
    private events: ProjectileEvents,
  ) {}

  private acquire(kind: 'rocket' | 'object', obj: ThrowableObject | null): Projectile {
    for (const p of this.pool) {
      if (!p.alive) {
        p.alive = true;
        p.obj = null;
        return p;
      }
    }
    if (this.pool.length >= PERF.maxProjectiles) {
      // recycle oldest
      const p = this.pool[0];
      this.retire(p);
      return p;
    }
    const mesh = kind === 'rocket'
      ? new THREE.Mesh(this.geoRocket, this.matRocket)
      : (obj ? obj.mesh.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshLambertMaterial({ color: 0x888888 })));
    const p: Projectile = {
      alive: true, kind, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      mesh, life: 0, obj,
    };
    this.scene.add(mesh);
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
        if (p.kind === 'rocket') this.explode(p.pos);
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
          if (p.kind === 'rocket') {
            this.explode(p.pos);
            this.retire(p);
            continue;
          }
          sfx.objectHit();
          this.fx.sparks(p.pos.x, p.pos.y, p.pos.z);
          this.retire(p);
          continue;
        }
      }

      // zombie collision (rockets & heavy objects)
      if (p.kind === 'rocket') {
        const hitZ = this.zombies.raycast(p.pos, dir, Math.max(dist, 0.5));
        if (hitZ) {
          this.explode(p.pos);
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
        if (p.kind === 'rocket') {
          this.explode(p.pos);
        } else {
          sfx.objectHit();
        }
        this.retire(p);
        continue;
      }
      p.mesh.position.copy(p.pos);
      if (p.kind === 'rocket') {
        p.mesh.lookAt(p.pos.clone().add(p.vel));
      } else {
        p.mesh.rotation.x += dt * 7;
        p.mesh.rotation.z += dt * 5;
      }
    }
  }

  private explode(pos: THREE.Vector3): void {
    this.fx.explosion(pos.x, Math.max(0.3, pos.y), pos.z);
    sfx.explosion();
    this.events.onExplosion(pos);
  }
}
