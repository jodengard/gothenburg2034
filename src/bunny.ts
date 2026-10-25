/**
 * Carrot-powered Lisebergskanin helpers: pick up a carrot and an extra bunny
 * hops on a VOI kickbike and mows the horde with a chainsaw. Reuses the
 * player's rabbit mesh (`rabbit.ts`) and the traffic scooter mesh (`traffic.ts`).
 */
import * as THREE from 'three';
import { AABB, Vec2, resolveCircleWorld } from './collision';
import { BUNNY } from './config';
import { sfx } from './audio';
import { buildLisebergskanin } from './rabbit';
import { buildScooter } from './traffic';
import type { ZombieManager, Zombie } from './zombie';

export interface BunnyHelper {
  /** scooter + rabbit, facing +Z like every other vehicle */
  group: THREE.Group;
  pos: Vec2;
  heading: number;
  spd: number;
  /** seconds of carrot power left */
  life: number;
  /** chainsaw damage tick timer */
  sawT: number;
  cutting: boolean;
}

export class BunnyHelpers {
  helpers: BunnyHelper[] = [];
  private scene: THREE.Scene;
  private colliders: AABB[];
  private sawOn = false;
  private sawSfxT = 0;

  constructor(scene: THREE.Scene, colliders: AABB[]) {
    this.scene = scene;
    this.colliders = colliders;
  }

  /** A new carrot-powered champion hops onto a kickbike and joins the fight. */
  spawn(x: number, z: number): BunnyHelper {
    if (this.helpers.length >= BUNNY.maxHelpers) {
      const oldest = this.helpers.shift()!; // the freshest carrot wins
      this.scene.remove(oldest.group);
    }
    const group = new THREE.Group();
    const bunny = buildLisebergskanin();
    bunny.position.y = 0.18; // standing on the deck
    group.add(buildScooter(), bunny);
    group.position.set(x, 0, z);
    this.scene.add(group);
    const h: BunnyHelper = {
      group, pos: { x, z }, heading: 0, spd: 0,
      life: BUNNY.lifetime, sawT: 0, cutting: false,
    };
    this.helpers.push(h);
    return h;
  }

  clear(): void {
    for (const h of this.helpers) this.scene.remove(h.group);
    this.helpers.length = 0;
    this.sawOn = false;
  }

  /** Charge the nearest zombie and chainsaw whatever is in reach. */
  update(dt: number, player: { pos: Vec2 }, zombies: ZombieManager): void {
    let anyCutting = false;
    for (let i = this.helpers.length - 1; i >= 0; i--) {
      const h = this.helpers[i];
      h.life -= dt;
      if (h.life <= 0) {
        this.scene.remove(h.group);
        this.helpers.splice(i, 1);
        continue;
      }

      // target: the nearest living zombie; with no action, patrol the player
      let target: Zombie | null = null;
      let bestD = Infinity;
      for (const z of zombies.active) {
        if (z.state === 'dead') continue;
        const d = Math.hypot(z.pos.x - h.pos.x, z.pos.z - h.pos.z);
        if (d < bestD) { bestD = d; target = z; }
      }
      const tx = target ? target.pos.x : player.pos.x;
      const tz = target ? target.pos.z : player.pos.z;
      const dist = target
        ? Math.hypot(target.pos.x - h.pos.x, target.pos.z - h.pos.z)
        : Math.hypot(tx - h.pos.x, tz - h.pos.z);

      // steer toward the target (heading convention: forward = (sin h, cos h))
      const dA = wrapPi(Math.atan2(tx - h.pos.x, tz - h.pos.z) - h.heading);
      const steer = Math.max(-1, Math.min(1, dA * 3));
      h.heading += steer * BUNNY.steerRate * dt;

      // charge in, idle once the saw is in reach
      const inRange = target !== null && dist < BUNNY.range;
      const wantSpd = inRange ? 0.5 : BUNNY.speed;
      if (h.spd < wantSpd) h.spd = Math.min(wantSpd, h.spd + BUNNY.accel * dt);
      else h.spd = Math.max(wantSpd, h.spd - BUNNY.accel * 2 * dt);

      h.pos.x += Math.sin(h.heading) * h.spd * dt;
      h.pos.z += Math.cos(h.heading) * h.spd * dt;
      resolveCircleWorld(this.colliders, h.pos, 0.45);

      // chainsaw: ticks of damage with a shove in the direction of travel
      h.cutting = inRange;
      if (inRange && target) {
        anyCutting = true;
        h.sawT -= dt;
        if (h.sawT <= 0) {
          h.sawT = 0.25;
          zombies.damage(
            target, BUNNY.dps * 0.25,
            Math.sin(h.heading) * 2.5, Math.cos(h.heading) * 2.5,
            { byPlayer: true },
          );
        }
      }

      // visuals: ride, lean into the turn, blink out right before leaving
      h.group.position.set(h.pos.x, 0, h.pos.z);
      h.group.rotation.y = h.heading;
      h.group.rotation.z = -steer * Math.min(1, h.spd / BUNNY.speed) * 0.2;
      h.group.visible = h.life > 3 || (h.life * 2.5) % 1 < 0.55;
    }

    // chainsaw audio: a stuttering buzz while cutting, one dying growl after
    if (anyCutting) {
      this.sawSfxT -= dt;
      if (this.sawOn && this.sawSfxT > 0) { /* mid-buzz */ }
      else { this.sawOn = true; this.sawSfxT = 0.16; sfx.chainsaw(true); }
    } else if (this.sawOn) {
      this.sawOn = false;
      sfx.chainsaw(false);
    }
  }
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
