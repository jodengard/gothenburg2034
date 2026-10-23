/**
 * Pack-level coordination: groups of zombies get tactical roles that
 * are reassigned with hysteresis based on the situation.
 */
import { PACK, THREAT } from './config';
import { Role, Zombie, PlayerView } from './zombie';

export interface Pack {
  id: number;
  members: Zombie[];
  reassignT: number;
}

export interface PackContext {
  player: PlayerView;
  threat: number;
  throwablesAvailable: boolean;
}

/** Distance from pack member to player. */
function distTo(z: Zombie, p: PlayerView): number {
  return Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
}

/**
 * Compute desired roles for a pack. Pure & deterministic given inputs.
 * - Close members press in (swarm) once the pack has any body in range.
 * - Far members flank or intercept.
 * - One thrower when enabled and objects exist.
 */
export function computeRoles(pack: Pack, ctx: PackContext): Role[] {
  const { player, threat, throwablesAvailable } = ctx;
  const members = pack.members.filter((m) => m.state !== 'dead');
  const n = members.length;
  if (n === 0) return [];

  const dists = members.map((m) => distTo(m, player));
  const minDist = Math.min(...dists);
  const playerSpeed = Math.hypot(player.vel.x, player.vel.z);
  const playerDist = Math.min(...dists); // pack is near player if closest member is

  const roles: Role[] = new Array(n).fill('pursuer');
  const order = members.map((_, i) => i).sort((a, b) => dists[a] - dists[b]);

  let idx = 0;
  const take = (): number | undefined => (idx < order.length ? order[idx++] : undefined);

  // 1) swarm: everyone within pressure radius presses in
  const pressure = minDist < PACK.swarmRadius;
  for (const i of order) {
    if (dists[i] < PACK.swarmRadius) roles[i] = 'swarm';
  }

  // 2) thrower (threat >= 3): pick a mid/far member not already swarming
  if (threat >= THREAT.throwersEnabledFromLevel && throwablesAvailable && playerDist < PACK.throwRange * 1.6) {
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (roles[i] !== 'swarm') {
        roles[i] = 'thrower';
        break;
      }
    }
  }

  // 3) interceptor: one member when the player is moving fast
  if (playerSpeed > 3.2) {
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      if (roles[i] === 'pursuer') {
        roles[i] = 'interceptor';
        break;
      }
    }
  }

  // 4) flankers: up to 2 of the remaining far members
  const flankerCount = Math.min(2, Math.max(1, Math.floor(n / 3)));
  let placed = 0;
  for (let k = order.length - 1; k >= 0 && placed < flankerCount; k--) {
    const i = order[k];
    if (roles[i] === 'pursuer') {
      roles[i] = 'flanker';
      placed++;
    }
  }

  // 5) if pressure, remaining pursuers join the swarm
  if (pressure) {
    for (let k = 0; k < n; k++) {
      if (roles[k] === 'pursuer' && dists[k] < PACK.swarmRadius * 2.2) roles[k] = 'swarm';
    }
  }

  void take;
  return roles;
}

export class PackManager {
  packs: Pack[] = [];
  private nextPackId = 1;

  reset(): void {
    this.packs = [];
    this.nextPackId = 1;
  }

  createPack(members: Zombie[]): Pack {
    const p: Pack = { id: this.nextPackId++, members, reassignT: 0 };
    this.packs.push(p);
    return p;
  }

  update(dt: number, ctx: PackContext): void {
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const pack = this.packs[i];
      // drop dead members; remove empty packs
      pack.members = pack.members.filter((m) => m.state !== 'dead' || m.deadT < 0.01);
      pack.members = pack.members.filter((m) => m.state !== 'dead');
      if (pack.members.length === 0) {
        this.packs.splice(i, 1);
        continue;
      }
      pack.reassignT -= dt;
      if (pack.reassignT > 0) continue;
      pack.reassignT = PACK.reassignInterval;

      const roles = computeRoles(pack, ctx);
      pack.members.forEach((m, j) => {
        if (m.state === 'dead') return;
        // hysteresis: keep thrower engaged once committed
        if (m.role === 'thrower' && (m.state === 'grab' || m.state === 'windupThrow' || m.carrying)) return;
        m.role = roles[j] ?? 'pursuer';
        // sync FSM state for non-special states
        if (m.state === 'idle' || m.state === 'search' || m.state === 'approach' || m.state === 'flank' || m.state === 'intercept') {
          m.state = m.role === 'flanker' ? 'flank' : m.role === 'interceptor' ? 'intercept' : 'approach';
        }
      });
    }
  }
}
