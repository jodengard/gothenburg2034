/**
 * Zombie entities: FSM, steering, perception, pooling, hit detection.
 * Coordination (roles) is assigned externally by pack.ts.
 */
import * as THREE from 'three';
import { AABB, Vec2, SpatialHash, resolveCircleWorld, segmentBlocked } from './collision';
import { ZOMBIE, PERF, THROWABLE, PACK } from './config';
import { ThrowableObject } from './world';

export type ZombieState =
  | 'idle' | 'search' | 'approach' | 'flank' | 'intercept'
  | 'grab' | 'windupThrow' | 'recoverThrow'
  | 'windupAttack' | 'strike' | 'recover'
  | 'stagger' | 'dead';

export type Role = 'pursuer' | 'flanker' | 'thrower' | 'interceptor' | 'swarm';

/**
 * Set while a zombie rides a vehicle (scooter hooligan): the vehicle owns the
 * zombie's position; its AI is suspended until it rides no more (rider death).
 */
export interface RideAnchor {
  x: number;
  z: number;
  heading: number;
}

export interface PlayerView {
  pos: Vec2;
  vel: THREE.Vector3;
  yaw: number;
  sprinting: boolean;
  eyeY: number;
}

export interface Zombie {
  id: number;
  pos: Vec2;
  vel: Vec2;
  facing: number;
  hp: number;
  speed: number;
  state: ZombieState;
  role: Role;
  packId: number;
  lastKnown: Vec2;
  los: boolean;
  losTimer: number;
  stateT: number;
  attackCd: number;
  staggerT: number;
  stuckT: number;
  stuckRef: Vec2;
  unstickT: number;
  unstickSide: number;
  targetObj: ThrowableObject | null;
  carrying: ThrowableObject | null;
  /** Non-null while this zombie rides a vehicle (scooter hooligan). */
  ride: RideAnchor | null;
  animT: number;
  fallDir: number;
  deadT: number;
  aiAccum: number;
  hitFlash: number;
  mesh: THREE.Group;
  bodyMesh: THREE.Mesh;
  head: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  /** Draw-call LOD bucket: 0 = full, 1 = no limbs, 2 = body only. */
  lodLevel: number;
}

export interface ZombieEvents {
  onPlayerDamage(amount: number, x: number, z: number): void;
  onThrow(pos: THREE.Vector3, vel: THREE.Vector3, obj: ThrowableObject): void;
  onKill(z: Zombie): void;
  onHurtSound(z: Zombie): void;
}

// Shared geometry & materials -----------------------------------------------

const G = {
  leg: new THREE.BoxGeometry(0.18, 0.8, 0.18),
  body: new THREE.BoxGeometry(0.55, 0.75, 0.3),
  head: new THREE.BoxGeometry(0.26, 0.26, 0.26),
  arm: new THREE.BoxGeometry(0.13, 0.6, 0.13),
};

const SKIN = new THREE.MeshStandardMaterial({ color: 0x7d9a5a, roughness: 0.9 });
const CLOTHES = [
  new THREE.MeshStandardMaterial({ color: 0x4a5a6a, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x6a4a4a, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x556655, roughness: 0.9 }),
  new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.9 }),
];
const FLASH = new THREE.MeshStandardMaterial({ color: 0xffdddd, emissive: 0x661111 });

let nextId = 1;

function buildMesh(): { mesh: THREE.Group; bodyMesh: THREE.Mesh; head: THREE.Mesh; armL: THREE.Group; armR: THREE.Group; legL: THREE.Mesh; legR: THREE.Mesh; bodyMat: THREE.MeshStandardMaterial } {
  const mesh = new THREE.Group();
  const bodyMat = CLOTHES[nextId % CLOTHES.length];
  const body = new THREE.Mesh(G.body, bodyMat);
  body.position.y = 1.175;
  const head = new THREE.Mesh(G.head, SKIN);
  head.position.y = 1.68;
  const legL = new THREE.Mesh(G.leg, bodyMat);
  legL.position.set(-0.14, 0.4, 0);
  const legR = new THREE.Mesh(G.leg, bodyMat);
  legR.position.set(0.14, 0.4, 0);
  const mkArm = (side: number): { g: THREE.Group } => {
    const g = new THREE.Group();
    g.position.set(side * 0.34, 1.45, 0);
    const m = new THREE.Mesh(G.arm, SKIN);
    m.position.y = -0.3;
    g.add(m);
    return { g };
  };
  const aL = mkArm(-1);
  const aR = mkArm(1);
  mesh.add(body, head, legL, legR, aL.g, aR.g);
  return { mesh, bodyMesh: body, head, armL: aL.g, armR: aR.g, legL, legR, bodyMat };
}

// Math helpers ----------------------------------------------------------------

function rayCircle2D(o: Vec2, d: Vec2, c: Vec2, r: number): number | null {
  const ox = o.x - c.x;
  const oz = o.z - c.z;
  const b = ox * d.x + oz * d.z;
  const cc = ox * ox + oz * oz - r * r;
  if (cc <= 0) return 0; // origin already inside
  const disc = b * b - cc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s;
  return t >= 0 ? t : null;
}

const SEP_QUERY: { pos: Vec2 }[] = [];

// Manager ---------------------------------------------------------------------

export class ZombieManager {
  active: Zombie[] = [];
  private pool: Zombie[] = [];
  private hash = new SpatialHash<Zombie>(6);
  private colliders: AABB[];

  constructor(
    private scene: THREE.Scene,
    colliders: AABB[],
    private events: ZombieEvents,
  ) {
    this.colliders = colliders;
  }

  get count(): number {
    return this.active.length;
  }

  clearAll(): void {
    for (const z of this.active) {
      this.scene.remove(z.mesh);
      this.pool.push(z);
    }
    this.active = [];
  }

  spawn(x: number, z: number, packId: number, threat: number): Zombie {
    let zom = this.pool.pop();
    if (!zom) {
      const parts = buildMesh();
      zom = {
        id: nextId++, pos: { x, z }, vel: { x: 0, z: 0 }, facing: 0,
        hp: 0, speed: 0, state: 'idle', role: 'pursuer', packId: 0,
        lastKnown: { x, z }, los: false, losTimer: 0, stateT: 0, attackCd: 0,
        staggerT: 0, stuckT: 0, stuckRef: { x, z }, unstickT: 0, unstickSide: 1,
        targetObj: null, carrying: null, ride: null, animT: 0, fallDir: 0, deadT: 0,
        aiAccum: 0, hitFlash: 0, lodLevel: 0, ...parts,
      };
    }
    const hpScale = 1 + ZOMBIE.healthPerThreat * (threat - 1);
    zom.pos.x = x;
    zom.pos.z = z;
    zom.vel.x = 0;
    zom.vel.z = 0;
    zom.hp = ZOMBIE.baseHealth * hpScale * (0.85 + Math.random() * 0.3);
    zom.speed = ZOMBIE.baseSpeed + ZOMBIE.speedPerThreat * (threat - 1) + (Math.random() - 0.5) * ZOMBIE.speedVariance;
    zom.state = 'approach';
    zom.role = 'pursuer';
    zom.packId = packId;
    zom.lastKnown.x = x;
    zom.lastKnown.z = z;
    zom.los = false;
    zom.losTimer = 0;
    zom.stateT = 0;
    zom.attackCd = 0;
    zom.staggerT = 0;
    zom.stuckT = 0;
    zom.unstickT = 0;
    zom.targetObj = null;
    zom.carrying = null;
    zom.ride = null;
    zom.deadT = 0;
    zom.hitFlash = 0;
    zom.mesh.visible = true;
    zom.head.visible = true;
    zom.armL.visible = zom.armR.visible = true;
    zom.legL.visible = zom.legR.visible = true;
    zom.lodLevel = 0;
    zom.mesh.position.set(x, 0, z);
    zom.mesh.rotation.set(0, 0, 0);
    zom.mesh.scale.setScalar(1);
    this.scene.add(zom.mesh);
    this.active.push(zom);
    return zom;
  }

  /** Apply damage; returns true if killed. */
  damage(z: Zombie, amount: number, knockX = 0, knockZ = 0): boolean {
    if (z.state === 'dead') return false;
    z.hp -= amount;
    z.hitFlash = 0.12;
    z.bodyMat = FLASH;
    z.bodyMesh.material = FLASH;
    z.vel.x += knockX;
    z.vel.z += knockZ;
    if (z.hp <= 0) {
      this.kill(z);
      return true;
    }
    if (Math.random() < ZOMBIE.staggerChance) {
      z.state = 'stagger';
      z.staggerT = ZOMBIE.staggerTime;
    }
    this.events.onHurtSound(z);
    return false;
  }

  private kill(z: Zombie): void {
    z.state = 'dead';
    z.deadT = 0;
    z.fallDir = Math.random() < 0.5 ? 1 : -1;
    if (z.ride) {
      z.ride = null; // tumble off the vehicle; traffic notices and drops it
      z.mesh.position.y = 0;
    }
    if (z.carrying) {
      z.carrying.taken = false; // drop the object where it died
      z.carrying = null;
    }
    this.events.onKill(z);
  }

  /** Hitscan against zombies. Returns nearest hit zombie and distance. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { z: Zombie; dist: number } | null {
    const o: Vec2 = { x: origin.x, z: origin.z };
    const d2 = { x: dir.x, z: dir.z };
    const len = Math.hypot(d2.x, d2.z) || 1;
    d2.x /= len;
    d2.z /= len;
    const slope = dir.y / len;
    let best: { z: Zombie; dist: number } | null = null;
    for (const z of this.active) {
      if (z.state === 'dead') continue;
      const t = rayCircle2D(o, d2, z.pos, ZOMBIE.radius + 0.12);
      if (t === null || t > maxDist) continue;
      const y = origin.y + slope * t;
      if (y < 0 || y > ZOMBIE.height + 0.15) continue;
      if (!best || t < best.dist) best = { z, dist: t };
    }
    return best;
  }

  /** All living zombies inside a melee cone. */
  meleeSweep(origin: THREE.Vector3, flatDir: Vec2, range: number, arcRad: number): Zombie[] {
    const out: Zombie[] = [];
    for (const z of this.active) {
      if (z.state === 'dead') continue;
      const dx = z.pos.x - origin.x;
      const dz = z.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + ZOMBIE.radius) continue;
      if (d > 0.001) {
        const dot = (dx / d) * flatDir.x + (dz / d) * flatDir.z;
        if (dot < Math.cos(arcRad)) continue;
      }
      out.push(z);
    }
    return out;
  }

  update(dt: number, player: PlayerView, _threat: number, throwables: ThrowableObject[]): void {
    // spatial hash rebuild
    this.hash.clear();
    for (const z of this.active) this.hash.insert(z);

    let i = 0;
    while (i < this.active.length) {
      const z = this.active[i];
      const dx = z.pos.x - player.pos.x;
      const dz = z.pos.z - player.pos.z;
      const dist = Math.hypot(dx, dz);

      // draw-call LOD: distant zombies render as fewer meshes
      this.lod(z, dist);

      // riders stay welded to their vehicle every frame (AI is suspended,
      // but the scooter keeps moving — no throttled lag on the mesh)
      if (z.ride && z.state !== 'dead') {
        z.pos.x = z.ride.x;
        z.pos.z = z.ride.z;
        z.facing = z.ride.heading;
        z.mesh.position.set(z.pos.x, 0.18, z.pos.z);
        z.mesh.rotation.set(0, z.facing, 0);
      }

      // far-AI throttling
      const far = dist > PERF.farAiDist;
      z.aiAccum += dt;
      if (far && z.aiAccum < PERF.farAiInterval && z.state !== 'dead') {
        i++;
        continue;
      }
      const adt = far ? z.aiAccum : dt;
      z.aiAccum = 0;

      // hit flash restore
      if (z.hitFlash > 0) {
        z.hitFlash -= dt;
        if (z.hitFlash <= 0) {
          z.hitFlash = 0;
          z.bodyMat = CLOTHES[z.id % CLOTHES.length];
          z.bodyMesh.material = z.bodyMat;
        }
      }

      this.updateZombie(z, adt, dt, dist, player, throwables);

      // remove fully dead
      if (z.state === 'dead' && z.deadT > ZOMBIE.deathSinkDelay + 1.2) {
        this.scene.remove(z.mesh);
        this.active.splice(i, 1);
        this.pool.push(z);
        continue;
      }
      i++;
    }
  }

  private updateZombie(
    z: Zombie, adt: number, frameDt: number, dist: number,
    player: PlayerView, throwables: ThrowableObject[],
  ): void {
    z.attackCd = Math.max(0, z.attackCd - adt);

    // --- animation (every frame, cheap) ---
    z.animT += frameDt;
    this.animate(z, frameDt);

    // --- dead: fall & sink ---
    if (z.state === 'dead') {
      z.deadT += frameDt;
      const fall = Math.min(1, z.deadT / ZOMBIE.deathFallTime);
      const ang = (Math.PI / 2) * fall * z.fallDir;
      z.mesh.rotation.z = ang;
      if (z.deadT > ZOMBIE.deathSinkDelay) {
        z.mesh.position.y = -(z.deadT - ZOMBIE.deathSinkDelay) * 1.4;
      }
      return;
    }

    // --- riding a vehicle: it drives, this zombie just poses on it ---
    if (z.ride) {
      z.vel.x = 0;
      z.vel.z = 0;
      return;
    }

    // --- perception (throttled) ---
    z.losTimer -= adt;
    if (z.losTimer <= 0) {
      z.losTimer = ZOMBIE.losCheckInterval;
      const hear = player.sprinting ? ZOMBIE.hearRadiusSprint : ZOMBIE.hearRadius;
      if (dist < ZOMBIE.sightRange) {
        const dir = { x: -dx(z, player), z: -dz(z, player) };
        const dd = Math.hypot(dir.x, dir.z) || 1;
        dir.x /= dd;
        dir.z /= dd;
        z.los = !segmentBlocked(z.pos, dir, dd, this.colliders);
      } else {
        z.los = false;
      }
      if (z.los || dist < hear) {
        z.lastKnown.x = player.pos.x;
        z.lastKnown.z = player.pos.z;
      }
    }

    // --- stagger ---
    if (z.state === 'stagger') {
      z.staggerT -= adt;
      if (z.staggerT <= 0) z.state = 'approach';
      this.integrate(z, adt, 0.3);
      return;
    }

    // --- FSM by role & state ---
    const toPlayerX = player.pos.x - z.pos.x;
    const toPlayerZ = player.pos.z - z.pos.z;

    switch (z.state) {
      case 'windupAttack': {
        z.stateT -= adt;
        this.face(z, toPlayerX, toPlayerZ, adt, 6);
        if (z.stateT <= 0) {
          z.state = 'strike';
          z.stateT = 0.12;
          if (dist < ZOMBIE.meleeRange + 0.35 && z.los) {
            this.events.onPlayerDamage(ZOMBIE.meleeDamage, z.pos.x, z.pos.z);
          }
        }
        this.integrate(z, adt, 0);
        return;
      }
      case 'strike': {
        z.stateT -= adt;
        if (z.stateT <= 0) {
          z.state = 'recover';
          z.stateT = 0.35;
          z.attackCd = ZOMBIE.attackCooldown;
        }
        this.integrate(z, adt, 0);
        return;
      }
      case 'recover': {
        z.stateT -= adt;
        this.face(z, toPlayerX, toPlayerZ, adt, 3);
        if (z.stateT <= 0) z.state = 'approach';
        this.integrate(z, adt, 0.2);
        return;
      }
      case 'grab': {
        const o = z.targetObj;
        if (!o || o.taken) {
          z.targetObj = null;
          z.role = 'pursuer';
          z.state = 'approach';
          return;
        }
        const odx = o.pos.x - z.pos.x;
        const odz = o.pos.z - z.pos.z;
        const od = Math.hypot(odx, odz);
        if (od < 0.9) {
          o.taken = true;
          o.mesh.visible = false;
          z.carrying = o;
          z.state = 'windupThrow';
          z.stateT = 0.85;
        } else {
          this.seek(z, o.pos.x, o.pos.z, adt, player);
        }
        return;
      }
      case 'windupThrow': {
        z.stateT -= adt;
        this.face(z, toPlayerX, toPlayerZ, adt, 5);
        if (z.stateT <= 0 && z.carrying) {
          const obj = z.carrying;
          z.carrying = null;
          const d = Math.hypot(toPlayerX, toPlayerZ) || 1;
          const speed = THROWABLE.speed;
          const vel = new THREE.Vector3(
            (toPlayerX / d) * speed,
            3.2 + d * 0.12, // lob compensation
            (toPlayerZ / d) * speed,
          );
          this.events.onThrow(
            new THREE.Vector3(z.pos.x, 1.7, z.pos.z),
            vel,
            obj,
          );
          z.role = 'swarm';
          z.state = 'recoverThrow';
          z.stateT = 0.6;
        }
        this.integrate(z, adt, 0);
        return;
      }
      case 'recoverThrow': {
        z.stateT -= adt;
        if (z.stateT <= 0) z.state = 'approach';
        this.integrate(z, adt, 0.2);
        return;
      }
      default:
        break;
    }

    // --- active states: idle / search / approach / flank / intercept / grab-pick ---

    // decide whether to attack
    const canAttack = z.attackCd <= 0 && dist < ZOMBIE.meleeRange && z.los;
    if (canAttack && (z.role === 'swarm' || z.role === 'pursuer' || z.role === 'interceptor' || dist < 2.2)) {
      z.state = 'windupAttack';
      z.stateT = ZOMBIE.windupTime;
      return;
    }

    // thrower: look for object
    if (z.role === 'thrower' && !z.carrying) {
      if (dist < PACK.throwRange) {
        let best: ThrowableObject | null = null;
        let bestD = PACK.throwObjectSearchRadius;
        for (const o of throwables) {
          if (o.taken) continue;
          const od = Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z);
          if (od < bestD) {
            bestD = od;
            best = o;
          }
        }
        if (best) {
          z.targetObj = best;
          z.state = 'grab';
          return;
        }
      }
    }

    // perception state
    const knowsX = z.lastKnown.x;
    const knowsZ = z.lastKnown.z;
    const dKnown = Math.hypot(knowsX - z.pos.x, knowsZ - z.pos.z);
    if (z.los) {
      if (z.state === 'search' || z.state === 'idle') z.state = 'approach';
    } else if (dKnown < 1.2) {
      z.state = 'search';
    } else if (z.state === 'idle') {
      z.state = 'approach';
    }

    // role-driven target
    let tx = knowsX;
    let tz = knowsZ;
    if (z.state === 'search') {
      // wander around last known
      const a = z.animT * 0.7 + z.id;
      tx = knowsX + Math.cos(a) * 4;
      tz = knowsZ + Math.sin(a) * 4;
    } else if (z.role === 'flanker') {
      const px = player.pos.x;
      const pz = player.pos.z;
      let bx = z.pos.x - px;
      let bz = z.pos.z - pz;
      const bd = Math.hypot(bx, bz) || 1;
      bx /= bd;
      bz /= bd;
      // rotate around player toward their flank (behind their back)
      const backX = -Math.sin(player.yaw);
      const backZ = -Math.cos(player.yaw);
      const side = bx * backZ - bz * backX > 0 ? 1 : -1;
      const ang = PACK.flankAngle * side;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const rx = bx * cos - bz * sin;
      const rz = bx * sin + bz * cos;
      const stand = Math.max(3.5, Math.min(bd, PACK.flankDist));
      tx = px + rx * stand;
      tz = pz + rz * stand;
      if (bd < 4.5) {
        tx = px;
        tz = pz;
      }
    } else if (z.role === 'interceptor') {
      const pv = player.vel;
      const lead = Math.min(22, PACK.interceptLeadTime * Math.hypot(pv.x, pv.z));
      if (lead > 1.5) {
        tx = player.pos.x + pv.x * PACK.interceptLeadTime;
        tz = player.pos.z + pv.z * PACK.interceptLeadTime;
      } else {
        tx = knowsX;
        tz = knowsZ;
      }
    } else if (z.role === 'swarm' || z.role === 'pursuer') {
      tx = z.los ? player.pos.x : knowsX;
      tz = z.los ? player.pos.z : knowsZ;
    }
    this.seek(z, tx, tz, adt, player);
  }

  private face(z: Zombie, dx: number, dz: number, dt: number, rate: number): void {
    const want = Math.atan2(dx, dz);
    let diff = want - z.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    z.facing += diff * Math.min(1, rate * dt);
  }

  private seek(z: Zombie, tx: number, tz: number, dt: number, player: PlayerView): void {
    let dx = tx - z.pos.x;
    let dz = tz - z.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) {
      this.integrate(z, dt, 0);
      return;
    }
    dx /= d;
    dz /= d;

    // obstacle avoidance: try straight, then fan out
    const probe = 3.2;
    if (segmentBlocked(z.pos, { x: dx, z: dz }, probe, this.colliders)) {
      const angles = [0.6, -0.6, 1.2, -1.2, 1.9, -1.9];
      let found = false;
      for (const a of angles) {
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const ax = dx * cos - dz * sin;
        const az = dx * sin + dz * cos;
        if (!segmentBlocked(z.pos, { x: ax, z: az }, probe, this.colliders)) {
          dx = ax;
          dz = az;
          found = true;
          break;
        }
      }
      if (!found) {
        // fully boxed: strafe away from wall
        dx = -dx;
        dz = -dz;
      }
    }

    // stuck detection
    const movedFromRef = Math.hypot(z.pos.x - z.stuckRef.x, z.pos.z - z.stuckRef.z);
    z.stuckT += dt;
    if (z.stuckT >= 0.5) {
      if (movedFromRef < 0.25) {
        z.unstickT = 1.0;
        z.unstickSide = z.id % 2 === 0 ? 1 : -1;
      }
      z.stuckT = 0;
      z.stuckRef.x = z.pos.x;
      z.stuckRef.z = z.pos.z;
    }
    if (z.unstickT > 0) {
      z.unstickT -= dt;
      const cos = Math.cos(1.5 * z.unstickSide);
      const sin = Math.sin(1.5 * z.unstickSide);
      const ax = dx * cos - dz * sin;
      const az = dx * sin + dz * cos;
      dx = ax;
      dz = az;
    }

    // separation from neighbors
    const neighbors = this.hash.query(z.pos, 1.3, SEP_QUERY as Zombie[]);
    let sx = 0;
    let sz = 0;
    for (const n of neighbors) {
      if (n === z || n.state === 'dead') continue;
      const ox = z.pos.x - n.pos.x;
      const oz = z.pos.z - n.pos.z;
      const od = Math.hypot(ox, oz);
      if (od < 1.1 && od > 0.001) {
        const w = (1.1 - od) / 1.1;
        sx += (ox / od) * w;
        sz += (oz / od) * w;
      }
    }
    dx += sx * ZOMBIE.separationStrength * 0.25;
    dz += sz * ZOMBIE.separationStrength * 0.25;
    const nl = Math.hypot(dx, dz) || 1;
    dx /= nl;
    dz /= nl;

    // smooth velocity
    const tvx = dx * z.speed;
    const tvz = dz * z.speed;
    z.vel.x += (tvx - z.vel.x) * Math.min(1, 8 * dt);
    z.vel.z += (tvz - z.vel.z) * Math.min(1, 8 * dt);

    this.face(z, tx - z.pos.x, tz - z.pos.z, dt, 5);
    this.integrate(z, dt, 1);
    void player;
  }

  private integrate(z: Zombie, dt: number, moveScale: number): void {
    z.pos.x += z.vel.x * dt * moveScale;
    z.pos.z += z.vel.z * dt * moveScale;
    z.vel.x *= Math.max(0, 1 - dt * 4);
    z.vel.z *= Math.max(0, 1 - dt * 4);
    resolveCircleWorld(this.colliders, z.pos, ZOMBIE.radius);
    z.mesh.position.set(z.pos.x, z.mesh.position.y, z.pos.z);
    z.mesh.rotation.y = z.facing;
  }

  /**
   * Draw-call LOD: a zombie is 6 meshes; at crowd counts that dominates the
   * frame on phones. Beyond 25 m the limbs go, beyond 55 m only the torso
   * remains — at that range they are a few pixels behind fog anyway.
   */
  private lod(z: Zombie, dist: number): void {
    const level = dist < 25 ? 0 : dist < 55 ? 1 : 2;
    if (z.lodLevel === level) return;
    z.lodLevel = level;
    if (level === 0) {
      z.head.visible = true;
      z.armL.visible = z.armR.visible = true;
      z.legL.visible = z.legR.visible = true;
    } else if (level === 1) {
      z.head.visible = true;
      z.armL.visible = z.armR.visible = false;
      // riders keep their legs: a legless torso hovering over a scooter reads
      // as a bug, not as a hooligan, even from 40 m
      z.legL.visible = z.legR.visible = z.ride === null ? false : true;
    } else {
      z.head.visible = false;
      z.armL.visible = z.armR.visible = false;
      z.legL.visible = z.legR.visible = false;
    }
  }

  private animate(z: Zombie, dt: number): void {
    void dt;
    const moving = Math.hypot(z.vel.x, z.vel.z) > 0.4 && z.state !== 'dead';
    const swing = moving ? Math.sin(z.animT * 7) * 0.5 : 0;
    z.legL.rotation.x = swing;
    z.legR.rotation.x = -swing;
    let armPitch = -0.9; // default: arms reaching forward
    if (z.state === 'windupAttack') armPitch = -2.3;
    else if (z.state === 'strike') armPitch = 0.7;
    else if (z.state === 'windupThrow') armPitch = -2.6;
    else if (z.state === 'recover' || z.state === 'recoverThrow') armPitch = -0.4;
    else if (z.state === 'stagger') armPitch = -0.2;
    else if (!moving) armPitch = -0.5 + Math.sin(z.animT * 2) * 0.08;
    z.armL.rotation.x = armPitch + (moving ? Math.sin(z.animT * 7 + 1) * 0.15 : 0);
    z.armR.rotation.x = armPitch - (moving ? Math.sin(z.animT * 7 + 1) * 0.15 : 0);
  }
}

function dx(z: Zombie, p: PlayerView): number {
  return z.pos.x - p.pos.x;
}

function dz(z: Zombie, p: PlayerView): number {
  return z.pos.z - p.pos.z;
}
