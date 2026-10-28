/**
 * Zombie entities: FSM, steering, perception, pooling, hit detection.
 * Coordination (roles) is assigned externally by pack.ts.
 */
import * as THREE from 'three';
import { AABB, Vec2, SpatialHash, resolveCircleWorld, segmentBlocked } from './collision';
import { ZOMBIE, PERF, THROWABLE, PACK, FATALITY, FAT, THREAT, FLAME, CHARGER, PLAYER } from './config';
import { ThrowableObject } from './world';
import { attacksFromBehind } from './pack';

export type ZombieState =
  | 'idle' | 'search' | 'approach' | 'flank' | 'intercept'
  | 'grab' | 'windupThrow' | 'recoverThrow'
  | 'windupAttack' | 'strike' | 'recover'
  | 'windupCharge' | 'charging'
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
  /** Pack orders (Zombies 2.0): the crew's shared guess where the player is,
   * or null when the pack's knowledge went stale. Tactical roles steer on
   * this instead of the player's live position — no magic through walls. */
  order: Vec2 | null;
  orderFresh: boolean;
  /** True while the pack is assaulting (fresh knowledge + pressure): flankers
   * drop the stand-off and commit. */
  assault: boolean;
  /** Boomer class: gut-bloated, slow, detonates on player contact. */
  fat: boolean;
  /** Charger class: huge, black, telegraphed charge with brutal knockback. */
  charger: boolean;
  /** Collision radius — fat zombies are wider (raycast + world push). */
  radius: number;
  /** Non-null while this zombie rides a vehicle (scooter hooligan). */
  ride: RideAnchor | null;
  /** Traffic hit cooldown: a vehicle that just clipped this zombie cannot
   * re-hit it on the same pass (one car side-swipe = one blow, not 60/s). */
  trafficCd: number;
  /** true on the frame a riding zombie dies (ride already cleared) — carrot drops. */
  wasRiding: boolean;
  /** Damage attribution for the killing blow (fatalities only on player kills). */
  lastHitHead: boolean;
  lastHitByPlayer: boolean;
  /** Set by kill() when this death plays as an exploding fatality. */
  exploded: boolean;
  /** Flamethrower: seconds of burn left; the corpse chars while they tick. */
  burnT: number;
  burnTick: number;
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
  /** A charger bowled the player over: launch them away from (x, z) with the
   * given horizontal power and vertical lift (airborne = no speed clamp). */
  onChargerHit(x: number, z: number, power: number, lift: number): void;
  /** A charger began its windup bellow — the audible dodge warning. */
  onChargeWindup(z: Zombie): void;
  onThrow(pos: THREE.Vector3, vel: THREE.Vector3, obj: ThrowableObject): void;
  onKill(z: Zombie): void;
  onHurtSound(z: Zombie): void;
  /** A fat zombie detonated on player contact: blast + gas cloud at (x, z). */
  onFatExplosion(x: number, z: number): void;
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
// a flaming zombie wears the fire: orange emissive skin while the burn ticks
const BURNING = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xcc3300, roughness: 0.9 });
// the fat ones wear what's left of an elasticated waistband
const FAT_SUIT = new THREE.MeshStandardMaterial({ color: 0x4e5a2a, roughness: 0.95 });
// the charger: soot-black, faintly oily
const CHARGER_SUIT = new THREE.MeshStandardMaterial({ color: CHARGER.color, roughness: 0.6 });

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

  spawn(x: number, z: number, packId: number, threat: number, fat = false, charger = false): Zombie {
    let zom = this.pool.pop();
    if (!zom) {
      const parts = buildMesh();
      zom = {
        id: nextId++, pos: { x, z }, vel: { x: 0, z: 0 }, facing: 0,
        hp: 0, speed: 0, state: 'idle', role: 'pursuer', packId: 0,
        lastKnown: { x, z }, los: false, losTimer: 0, stateT: 0, attackCd: 0,
        staggerT: 0, stuckT: 0, stuckRef: { x, z }, unstickT: 0, unstickSide: 1,
        targetObj: null, carrying: null, order: null, orderFresh: false, assault: false, fat: false, charger: false, radius: ZOMBIE.radius, ride: null, trafficCd: 0, wasRiding: false, lastHitHead: false, lastHitByPlayer: false, exploded: false, burnT: 0, burnTick: 0, animT: 0, fallDir: 0, deadT: 0,
        aiAccum: 0, hitFlash: 0, lodLevel: 0, ...parts,
      };
    }
    const hpScale = 1 + ZOMBIE.healthPerThreat * (threat - 1);
    zom.pos.x = x;
    zom.pos.z = z;
    zom.vel.x = 0;
    zom.vel.z = 0;
    zom.hp = ZOMBIE.baseHealth * hpScale * (0.85 + Math.random() * 0.3);
    // speed scaling caps at endlessSpeedCapThreat: endless Shanghai keeps
    // growing the crowd, but a sprint always outruns the horde
    zom.speed = ZOMBIE.baseSpeed + ZOMBIE.speedPerThreat * (Math.min(threat, THREAT.endlessSpeedCapThreat) - 1) + (Math.random() - 0.5) * ZOMBIE.speedVariance;
    // boomer scaling: a tanky, slow, wide bastard in a strained green suit
    zom.fat = fat;
    zom.charger = charger;
    zom.radius = fat ? ZOMBIE.radius * FAT.radiusMult
      : charger ? ZOMBIE.radius * CHARGER.radiusMult
      : ZOMBIE.radius;
    if (fat) {
      zom.hp *= FAT.hpMult;
      zom.speed *= FAT.speedMult;
    } else if (charger) {
      zom.hp *= CHARGER.hpMult;
      zom.speed *= CHARGER.speedMult;
    }
    const suit = fat ? FAT_SUIT : charger ? CHARGER_SUIT : CLOTHES[zom.id % CLOTHES.length];
    zom.bodyMat = suit;
    zom.bodyMesh.material = suit;
    zom.legL.material = suit;
    zom.legR.material = suit;
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
    zom.order = null;
    zom.orderFresh = false;
    zom.assault = false;
    zom.ride = null;
    zom.trafficCd = 0;
    zom.wasRiding = false;
    zom.lastHitHead = false;
    zom.lastHitByPlayer = false;
    zom.exploded = false;
    zom.burnT = 0;
    zom.burnTick = 0;
    zom.deadT = 0;
    zom.hitFlash = 0;
    zom.mesh.visible = true;
    zom.head.visible = true;
    zom.armL.visible = zom.armR.visible = true;
    zom.legL.visible = zom.legR.visible = true;
    zom.lodLevel = 0;
    zom.mesh.position.set(x, 0, z);
    zom.mesh.rotation.set(0, 0, 0);
    zom.mesh.scale.set(
      fat ? 1.5 : charger ? CHARGER.meshScale[0] : 1,
      fat ? 1.22 : charger ? CHARGER.meshScale[1] : 1,
      fat ? 1.5 : charger ? CHARGER.meshScale[2] : 1,
    ); // bloated / huge-black / reset for pool reuse
    this.scene.add(zom.mesh);
    this.active.push(zom);
    return zom;
  }

  /** Apply damage; returns true if killed. `opts` attributes the hit (headshot/fatality). */
  /** Set a corpse alight (flamethrower): chars the skin, ticks burn damage.
   * Re-igniting refreshes the duration instead of stacking. */
  ignite(z: Zombie, seconds: number): void {
    if (z.state === 'dead') return;
    z.burnT = Math.max(z.burnT, seconds);
    z.burnTick = Math.min(z.burnTick, 0.15); // first tick lands fast
  }

  damage(
    z: Zombie,
    amount: number,
    knockX = 0,
    knockZ = 0,
    opts?: { headshot?: boolean; byPlayer?: boolean },
  ): boolean {
    if (z.state === 'dead') return false;
    z.hp -= amount;
    z.hitFlash = 0.12;
    z.bodyMat = FLASH;
    z.bodyMesh.material = FLASH;
    z.vel.x += knockX;
    z.vel.z += knockZ;
    if (opts) {
      if (opts.headshot) z.lastHitHead = true;
      if (opts.byPlayer) z.lastHitByPlayer = true;
    }
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

  /** Contact detonation: the gut lets go on belly contact. kill() notices
   * exploded=true and fires the detonation event (shared with death booms). */
  private fatBoom(z: Zombie): void {
    z.exploded = true;
    this.kill(z);
  }

  /** Area damage from a fat-zombie blast: the horde eats its own. */
  blast(x: number, z: number, radius: number, dmg: number): void {
    for (const q of this.active) {
      if (q.state === 'dead') continue;
      const d = Math.hypot(q.pos.x - x, q.pos.z - z);
      if (d < radius) this.damage(q, dmg * (1 - 0.6 * (d / radius)));
    }
  }

  private kill(z: Zombie): void {
    z.state = 'dead';
    z.deadT = 0;
    z.fallDir = Math.random() < 0.5 ? 1 : -1;
    // Boomer rule: killing it makes it detonate — blast + shit-cloud — UNLESS
    // the kill took its head off clean (headshot / melee to the skull is the
    // safe way to drop one). Contact detonations pre-set exploded=true.
    const fatDeath = z.fat && (z.exploded || !z.lastHitHead);
    // Fatality: a player kill detonates the corpse — headshots always, others sometimes.
    z.exploded = z.exploded || fatDeath || (z.lastHitByPlayer && (z.lastHitHead || Math.random() < FATALITY.chance));
    z.wasRiding = z.ride !== null; // carrot drops key off this before we clear ride
    if (z.ride) {
      z.ride = null; // tumble off the vehicle; traffic notices and drops it
      z.mesh.position.y = 0;
    }
    if (z.carrying) {
      // drop the carried object at the corpse: visible and pickable again
      const o = z.carrying;
      o.taken = false;
      o.pos.x = z.pos.x;
      o.pos.z = z.pos.z;
      o.mesh.position.set(z.pos.x, 0.08, z.pos.z);
      o.mesh.rotation.set(0, 0, 0);
      o.mesh.visible = true;
      z.carrying = null;
    }
    this.events.onKill(z);
    // the boom follows the kill: blast, gas, splash — after onKill hid the corpse
    if (fatDeath) this.events.onFatExplosion(z.pos.x, z.pos.z);
  }

  /** Hitscan against zombies. Returns nearest hit zombie, distance, and headshot flag. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { z: Zombie; dist: number; head: boolean } | null {
    const o: Vec2 = { x: origin.x, z: origin.z };
    const d2 = { x: dir.x, z: dir.z };
    const len = Math.hypot(d2.x, d2.z) || 1;
    d2.x /= len;
    d2.z /= len;
    const slope = dir.y / len;
    let best: { z: Zombie; dist: number } | null = null;
    for (const z of this.active) {
      if (z.state === 'dead') continue;
      const t = rayCircle2D(o, d2, z.pos, z.radius + 0.12);
      if (t === null || t > maxDist) continue;
      const y = origin.y + slope * t;
      if (y < 0 || y > ZOMBIE.height + 0.15) continue;
      if (!best || t < best.dist) best = { z, dist: t };
    }
    if (!best) return null;
    // Headshot: the ray passes within headRadius of the head's vertical axis and
    // crosses it inside the head's local height band (riders stand lifted on decks).
    const z = best.z;
    const ox = z.pos.x - o.x, oz = z.pos.z - o.z;
    const tClose = Math.max(0, ox * d2.x + oz * d2.z);
    const perp = Math.abs(ox * d2.z - oz * d2.x);
    const localY = origin.y + slope * tClose - z.mesh.position.y;
    const head = perp <= FATALITY.headRadius
      && localY >= FATALITY.headMinY && localY <= FATALITY.headMaxY;
    return { ...best, head };
  }

  /** All living zombies inside a melee cone. */
  meleeSweep(origin: THREE.Vector3, flatDir: Vec2, range: number, arcRad: number): Zombie[] {
    const out: Zombie[] = [];
    for (const z of this.active) {
      if (z.state === 'dead') continue;
      const dx = z.pos.x - origin.x;
      const dz = z.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + z.radius) continue;
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
      if (z.trafficCd > 0) z.trafficCd -= dt;

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
          z.bodyMat = z.fat ? FAT_SUIT : z.charger ? CHARGER_SUIT : CLOTHES[z.id % CLOTHES.length];
          z.bodyMesh.material = z.bodyMat;
        }
      }

      // burning (flamethrower): charred tint + periodic damage ticks. The
      // tick goes through damage(), so burn kills keep attribution — a
      // burning boomer still detonates on death like any other.
      if (z.burnT > 0 && z.state !== 'dead') {
        z.burnT -= adt;
        z.bodyMesh.material = BURNING;
        z.burnTick -= adt;
        if (z.burnTick <= 0) {
          z.burnTick = FLAME.burnTick;
          this.damage(z, FLAME.burnDps * FLAME.burnTick, 0, 0, { byPlayer: true });
        }
      } else if (z.burnT <= 0 && z.bodyMesh.material === BURNING) {
        z.burnT = 0;
        z.bodyMat = z.fat ? FAT_SUIT : z.charger ? CHARGER_SUIT : CLOTHES[z.id % CLOTHES.length];
        z.bodyMesh.material = z.bodyMat;
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

    // fat zombie: belly-to-player contact detonates the gut — no swing,
    // just a very large, very final hug (dodgeable: it waddles, and the
    // blast radius is smaller than its turn radius is embarrassing)
    if (z.fat && z.los && dist < FAT.touchDist) {
      this.fatBoom(z);
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
          const reach = ZOMBIE.meleeRange * (z.charger ? CHARGER.reachMult : 1) + 0.35;
          if (dist < reach && z.los) {
            if (z.charger) {
              // a charger's swat half-launches you: it never just taps you
              this.events.onChargerHit(z.pos.x, z.pos.z, CHARGER.knockPower * 0.6, CHARGER.knockLift * 0.6);
            } else {
              this.events.onPlayerDamage(ZOMBIE.meleeDamage, z.pos.x, z.pos.z);
            }
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
      case 'windupCharge': {
        // coil up and lock a heading — the bellow + crouch is the dodge window
        z.stateT -= adt;
        this.face(z, toPlayerX, toPlayerZ, adt, 5);
        if (z.stateT <= 0) {
          z.state = 'charging';
          z.stateT = CHARGER.dashTime;
          const d = Math.hypot(toPlayerX, toPlayerZ) || 1;
          z.vel.x = (toPlayerX / d) * CHARGER.dashSpeed;
          z.vel.z = (toPlayerZ / d) * CHARGER.dashSpeed;
        }
        this.integrate(z, adt, 0);
        return;
      }
      case 'charging': {
        // committed straight line: full speed, no steering, no decay
        z.stateT -= adt;
        z.pos.x += z.vel.x * adt;
        z.pos.z += z.vel.z * adt;
        resolveCircleWorld(this.colliders, z.pos, z.radius);
        z.mesh.position.set(z.pos.x, z.mesh.position.y, z.pos.z);
        z.mesh.rotation.y = z.facing;
        if (dist < z.radius + PLAYER.radius + 0.3 && z.los) {
          // it got you: damage + a launch into orbit (one atomic hit)
          this.events.onChargerHit(z.pos.x, z.pos.z, CHARGER.knockPower, CHARGER.knockLift);
          z.state = 'recover';
          z.stateT = 0.7;
          z.attackCd = CHARGER.cooldown;
          z.vel.x = 0;
          z.vel.z = 0;
          return;
        }
        if (z.stateT <= 0) {
          z.state = 'recover';
          z.stateT = 0.5;
          z.attackCd = CHARGER.cooldown;
          z.vel.x *= 0.2;
          z.vel.z *= 0.2;
        }
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
          obj.mesh.visible = false; // the projectile clone flies; this one lands later
          // lead a moving target a touch (capped), then scatter the aim:
          // throws land NEAR the lead point, never exactly on it — backing
          // off or breaking LOS late is a real dodge, not a coin flip
          let lx = player.vel.x * PACK.throwLeadTime;
          let lz = player.vel.z * PACK.throwLeadTime;
          const ll = Math.hypot(lx, lz);
          if (ll > PACK.throwLeadMax) {
            lx *= PACK.throwLeadMax / ll;
            lz *= PACK.throwLeadMax / ll;
          }
          const ax0 = toPlayerX + lx;
          const az0 = toPlayerZ + lz;
          const d0 = Math.hypot(ax0, az0) || 1;
          const spread = PACK.throwSpreadMin + d0 * PACK.throwSpreadFrac;
          const sa = Math.random() * Math.PI * 2;
          const sr = spread * Math.sqrt(Math.random()); // uniform across a disc
          const ax = ax0 + Math.cos(sa) * sr;
          const az = az0 + Math.sin(sa) * sr;
          const d = Math.hypot(ax, az) || 1;
          const speed = THROWABLE.speed;
          const vel = new THREE.Vector3(
            (ax / d) * speed,
            3.2 + d * 0.12, // lob compensation
            (az / d) * speed,
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

    // charger: a mid-range target in sight starts the show — bellow, coil,
    // then a committed straight-line dash (beat it and the cooldown is yours)
    if (z.charger && z.attackCd <= 0 && z.los && dist < CHARGER.range && dist > CHARGER.minRange) {
      z.state = 'windupCharge';
      z.stateT = CHARGER.windup;
      this.events.onChargeWindup(z);
      return;
    }

    // decide whether to attack — flankers and interceptors that actually
    // made it behind the player's back hit with extra reach: the observable
    // payoff of the pack's maneuver (turn around or eat the grab)
    const flank = (z.role === 'flanker' || z.role === 'interceptor') && attacksFromBehind(z, player);
    const reach = ZOMBIE.meleeRange * (z.charger ? CHARGER.reachMult : 1) + (flank ? PACK.flankBonusRange : 0);
    const canAttack = z.attackCd <= 0 && dist < reach && z.los;
    if (!z.fat && canAttack && (z.role === 'swarm' || z.role === 'pursuer' || z.role === 'interceptor' || flank || dist < 2.2)) {
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

    // what the crew knows: the live position only while someone in the pack
    // has eyes on you right now; otherwise the shared howled guess, then
    // this zombie's own memory — tactical roles never cheat through walls
    const kx = z.los ? player.pos.x : z.orderFresh && z.order ? z.order.x : knowsX;
    const kz = z.los ? player.pos.z : z.orderFresh && z.order ? z.order.z : knowsZ;

    // role-driven target
    let tx = knowsX;
    let tz = knowsZ;
    if (z.state === 'search') {
      // wander around last known
      const a = z.animT * 0.7 + z.id;
      tx = knowsX + Math.cos(a) * 4;
      tz = knowsZ + Math.sin(a) * 4;
    } else if (z.role === 'flanker') {
      let bx = z.pos.x - kx;
      let bz = z.pos.z - kz;
      const bd = Math.hypot(bx, bz) || 1;
      bx /= bd;
      bz /= bd;
      // rotate around the target toward their flank (behind their back)
      const backX = -Math.sin(player.yaw);
      const backZ = -Math.cos(player.yaw);
      const side = bx * backZ - bz * backX > 0 ? 1 : -1;
      const ang = PACK.flankAngle * side;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const rx = bx * cos - bz * sin;
      const rz = bx * sin + bz * cos;
      const stand = Math.max(3.5, Math.min(bd, PACK.flankDist));
      tx = kx + rx * stand;
      tz = kz + rz * stand;
      // commit to the hit up close — or the moment the pack assaults
      if (bd < 4.5 || (z.assault && bd < PACK.assaultCommit)) {
        tx = kx;
        tz = kz;
      }
    } else if (z.role === 'interceptor') {
      // velocity is only known while seen (by this zombie or the pack)
      const pv = player.vel;
      const seen = z.los || z.orderFresh;
      const lead = seen ? Math.min(22, PACK.interceptLeadTime * Math.hypot(pv.x, pv.z)) : 0;
      if (lead > 1.5) {
        tx = kx + pv.x * PACK.interceptLeadTime;
        tz = kz + pv.z * PACK.interceptLeadTime;
      } else {
        tx = kx;
        tz = kz;
      }
    } else if (z.role === 'swarm' || z.role === 'pursuer') {
      tx = z.los ? player.pos.x : z.orderFresh && z.order ? z.order.x : knowsX;
      tz = z.los ? player.pos.z : z.orderFresh && z.order ? z.order.z : knowsZ;
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
    resolveCircleWorld(this.colliders, z.pos, z.radius);
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

    // carried object rides the hands: held at the chest while finding a
    // throwing lane, hoisted overhead while winding up — the preparation is
    // readable from across the square (spec: visible preparation)
    if (z.carrying) {
      const o = z.carrying.mesh;
      o.visible = true;
      const raised = z.state === 'windupThrow';
      o.position.set(
        z.pos.x + Math.sin(z.facing) * 0.32,
        raised ? 2.05 : 1.35, // 2.05 = the raised hands' height (armPitch -2.6)
        z.pos.z + Math.cos(z.facing) * 0.32,
      );
      o.rotation.y = z.facing;
      if (raised) o.rotation.z = z.animT * 3; // wobbling overhead, about to hurl
    }
  }
}

function dx(z: Zombie, p: PlayerView): number {
  return z.pos.x - p.pos.x;
}

function dz(z: Zombie, p: PlayerView): number {
  return z.pos.z - p.pos.z;
}
