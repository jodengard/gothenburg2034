/**
 * Threat director: continuous escalation + pack spawning (GTA-style pressure).
 * Pure logic where possible for testing.
 */
import { THREAT } from './config';
import { RNG } from './rng';
import { Vec2 } from './collision';
import { World } from './world';

export interface DirectorPlayerView {
  pos: Vec2;
  yaw: number;
}

export function threatLevelFor(elapsed: number): number {
  let lvl = 1;
  for (let i = 0; i < THREAT.levelTimes.length; i++) {
    if (elapsed >= THREAT.levelTimes[i]) lvl = i + 1;
  }
  return lvl;
}

export class Director {
  killCredit = 0;
  spawnTimer = 2.5; // small grace at start
  packCounter = 0;

  reset(): void {
    this.killCredit = 0;
    this.spawnTimer = 2.5;
    this.packCounter = 0;
  }

  addKill(): void {
    this.killCredit = Math.min(THREAT.killCreditCap, this.killCredit + THREAT.killCredit);
  }

  level(time: number): number {
    return threatLevelFor(time + this.killCredit);
  }

  /**
   * Pick a valid spawn point around the player: outside min distance,
   * not inside geometry, and either outside the view cone or behind cover.
   */
  pickSpawnPoint(
    player: DirectorPlayerView,
    world: World,
    rng: RNG,
  ): Vec2 | null {
    const viewX = -Math.sin(player.yaw);
    const viewZ = -Math.cos(player.yaw);
    for (let attempt = 0; attempt < 14; attempt++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(THREAT.spawnMinDist, THREAT.spawnMaxDist);
      const x = player.pos.x + Math.cos(a) * d;
      const z = player.pos.z + Math.sin(a) * d;
      if (!world.isSpawnValid(x, z, player.pos)) continue;
      const dx = x - player.pos.x;
      const dz = z - player.pos.z;
      const dd = Math.hypot(dx, dz);
      const dot = (dx / dd) * viewX + (dz / dd) * viewZ;
      // isSpawnValid already guarantees LOS from player; reject if in view cone
      if (dot > THREAT.spawnViewDot) continue;
      return { x, z };
    }
    return null;
  }

  /**
   * Advance spawning. Calls spawnPack(size, x, z) when a pack should appear.
   */
  update(
    dt: number,
    time: number,
    activeCount: number,
    player: DirectorPlayerView,
    world: World,
    rng: RNG,
    spawnPack: (size: number, x: number, z: number) => void,
  ): void {
    const level = this.level(time);
    const cap = THREAT.popCaps[level - 1];
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    if (activeCount >= cap) {
      this.spawnTimer = 0.5; // retry shortly
      return;
    }
    const pt = this.pickSpawnPoint(player, world, rng);
    if (!pt) {
      this.spawnTimer = 0.8;
      return;
    }
    const [minS, maxS] = THREAT.packSizes[level - 1];
    const size = Math.min(maxS, minS + rng.int(maxS - minS + 1));
    const room = cap - activeCount;
    spawnPack(Math.max(1, Math.min(size, room)), pt.x, pt.z);
    this.packCounter++;
    this.spawnTimer = THREAT.spawnIntervals[level - 1] * rng.range(0.8, 1.2);
  }
}
