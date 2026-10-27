/**
 * Pack-level coordination: groups of zombies get tactical roles that
 * are reassigned with hysteresis based on the situation, and they share
 * what they see: a member with line of sight "howls" the player's (fuzzed)
 * position to the pack, and the whole crew hunts that guess until it goes
 * stale. This is what makes flanking and interception work WITHOUT any
 * zombie magically knowing the player's live position through walls —
 * the howl is the justification, and it is audible in gameplay.
 */
import { Vec2 } from './collision';
import { PACK, THREAT, ZOMBIE } from './config';
import { Role, Zombie, PlayerView } from './zombie';

export interface Pack {
  id: number;
  members: Zombie[];
  reassignT: number;
  /** Shared target: where the pack believes the player is (fuzzed sighting
   * relayed by whichever member last had eyes on them). */
  known: Vec2;
  /** Seconds since the pack last had a fresh sighting; stale = guess lost. */
  knownT: number;
  /** True while the pack has fresh knowledge AND a body inside the pressure
   * radius: the coordinated push (flankers commit, the pack howls once). */
  assault: boolean;
  /** Bark throttle so a pack doesn't scream every tick. */
  barkT: number;
}

export interface PackContext {
  player: PlayerView;
  threat: number;
  throwablesAvailable: boolean;
  /** The pack vocalises: fresh sighting or assault start. Audible tactics.
   * Optional so pure role-computation tests need no stub. */
  onBark?(): void;
}

/** Distance from pack member to player. */
function distTo(z: Zombie, p: PlayerView): number {
  return Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
}

/**
 * True when this zombie stands behind the player's view cone. Attacks from
 * there are flanks: the player must turn to answer them, and the attacker
 * gets a reach bonus (PACK.flankBonusRange) — the observable payoff of the
 * whole flanking maneuver.
 */
export function attacksFromBehind(z: { pos: Vec2 }, player: PlayerView): boolean {
  const bx = z.pos.x - player.pos.x;
  const bz = z.pos.z - player.pos.z;
  const d = Math.hypot(bx, bz);
  if (d < 0.001) return false;
  const fx = -Math.sin(player.yaw); // player facing (matches PlayerView.yaw)
  const fz = -Math.cos(player.yaw);
  return (bx / d) * fx + (bz / d) * fz < PACK.behindDot;
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
  const playerDist = minDist; // pack is near player if closest member is

  const roles: Role[] = new Array(n).fill('pursuer');
  const order = members.map((_, i) => i).sort((a, b) => dists[a] - dists[b]);

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
    let cx = 0;
    let cz = 0;
    for (const m of members) {
      cx += m.pos.x;
      cz += m.pos.z;
    }
    const n = Math.max(1, members.length);
    const p: Pack = {
      id: this.nextPackId++, members, reassignT: 0,
      known: { x: cx / n, z: cz / n }, knownT: Infinity, assault: false, barkT: 0,
    };
    this.packs.push(p);
    return p;
  }

  update(dt: number, ctx: PackContext): void {
    for (let i = this.packs.length - 1; i >= 0; i--) {
      const pack = this.packs[i];
      // drop dead members; remove empty packs
      pack.members = pack.members.filter((m) => m.state !== 'dead');
      if (pack.members.length === 0) {
        this.packs.splice(i, 1);
        continue;
      }
      pack.barkT = Math.max(0, pack.barkT - dt);
      pack.knownT += dt;

      // --- shared knowledge: a member with eyes howls the player's fuzzed
      // position to the pack. Only members close enough to actually see
      // (throttled far-AI can hold a stale los flag) may relay it.
      let saw = false;
      for (const m of pack.members) {
        if (m.los && distTo(m, ctx.player) < ZOMBIE.sightRange) {
          saw = true;
          break;
        }
      }
      const wasFresh = pack.knownT < PACK.knowledgeFresh;
      if (saw) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * PACK.orderNoise;
        pack.known.x = ctx.player.pos.x + Math.cos(a) * r;
        pack.known.z = ctx.player.pos.z + Math.sin(a) * r;
        pack.knownT = 0;
      }
      const fresh = pack.knownT < PACK.knowledgeFresh;
      if (fresh && !wasFresh && pack.barkT <= 0) {
        pack.barkT = PACK.barkCooldown;
        ctx.onBark?.(); // the pack spots you and howls — you hear the hunt
      }

      // --- assault: fresh knowledge + a body inside the pressure radius
      let minDist = Infinity;
      for (const m of pack.members) {
        const d = distTo(m, ctx.player);
        if (d < minDist) minDist = d;
      }
      const wasAssault = pack.assault;
      pack.assault = fresh && minDist < PACK.swarmRadius;
      if (pack.assault && !wasAssault && pack.barkT <= 0) {
        pack.barkT = PACK.barkCooldown;
        ctx.onBark?.(); // the push begins
      }

      // propagate orders every frame — steering reads them cheaply
      for (const m of pack.members) {
        m.order = fresh ? pack.known : null;
        m.orderFresh = fresh;
        m.assault = pack.assault;
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
