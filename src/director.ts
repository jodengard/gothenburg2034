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

/** Shanghai endless mode: 6 stars on arrival, +1 per step once the first
 * wave has landed (caller passes time counted from the end of the arrival
 * grace, so negative values just mean "still calm"). */
export function shanghaiThreatFor(sinceFirstWave: number): number {
  return 6 + Math.floor(Math.max(0, sinceFirstWave) / THREAT.shanghaiStepTime);
}

/** Spawn pressure for any threat level, extrapolating past the level-5 table
 * for Shanghai's endless escalation (with perf/sanity ceilings). */
export function threatParams(level: number): {
  cap: number; interval: number; packMin: number; packMax: number;
} {
  const i = Math.min(level, 5) - 1;
  const k = Math.max(0, level - 5); // endless steps beyond the table
  const cap = Math.min(THREAT.endlessCapMax, THREAT.popCaps[i] + THREAT.endlessCapStep * k);
  const interval = Math.max(
    THREAT.endlessIntervalMin,
    THREAT.spawnIntervals[i] * Math.pow(THREAT.endlessIntervalDecay, k),
  );
  const bump = Math.floor(k / THREAT.endlessPackStepLevels);
  return {
    cap,
    interval,
    packMin: Math.min(THREAT.endlessPackMax - 2, THREAT.packSizes[i][0] + bump),
    packMax: Math.min(THREAT.endlessPackMax, THREAT.packSizes[i][1] + bump),
  };
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
   * levelOverride pins the pressure level (Shanghai's endless escalation);
   * otherwise it follows the time-based director curve.
   */
  update(
    dt: number,
    time: number,
    activeCount: number,
    player: DirectorPlayerView,
    world: World,
    rng: RNG,
    spawnPack: (size: number, x: number, z: number) => void,
    levelOverride?: number,
  ): void {
    const level = levelOverride ?? this.level(time);
    const p = threatParams(level);
    const cap = p.cap;
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
    const size = Math.min(p.packMax, p.packMin + rng.int(p.packMax - p.packMin + 1));
    const room = cap - activeCount;
    spawnPack(Math.max(1, Math.min(size, room)), pt.x, pt.z);
    this.packCounter++;
    this.spawnTimer = p.interval * rng.range(0.8, 1.2);
  }
}
