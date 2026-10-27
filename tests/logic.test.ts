/** Unit tests for deterministic game logic (no DOM/WebGL required). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RNG } from '../src/rng';
import { makeAABB, resolveCircleAABB, rayAABB, segmentBlocked, resolveCircleWorld, SpatialHash, invalidateColliderGrid } from '../src/collision';
import { WeaponState, rollDrop } from '../src/weapons';
import { threatLevelFor, Director } from '../src/director';
import { computeRoles, PackManager, attacksFromBehind, Pack } from '../src/pack';
import { Zombie, PlayerView, Role } from '../src/zombie';
import { World } from '../src/world';
import { makePath, samplePath, distPointSeg } from '../src/traffic';
import { THREAT, PACK } from '../src/config';

// --- RNG ---------------------------------------------------------------------
describe('RNG', () => {
  it('is deterministic for a seed', () => {
    const a = new RNG(42);
    const b = new RNG(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('produces values in [0,1)', () => {
    const r = new RNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// --- Collision ----------------------------------------------------------------
describe('collision', () => {
  const wall = makeAABB(0, 0, 4, 4); // box from -2..2

  it('pushes a circle out of a box', () => {
    const p = resolveCircleAABB(wall, { x: 1.5, z: 0 }, 0.5);
    expect(p.x).toBeCloseTo(2.5);
    expect(p.z).toBeCloseTo(0);
  });
  it('leaves free circles alone', () => {
    const p = resolveCircleAABB(wall, { x: 5, z: 5 }, 0.5);
    expect(p.x).toBe(5);
    expect(p.z).toBe(5);
  });
  it('pushes out along smallest axis when centered inside', () => {
    const p = resolveCircleAABB(makeAABB(0, 0, 6, 2), { x: 0, z: 0 }, 0.3);
    expect(Math.abs(p.z)).toBeCloseTo(1.3);
  });
  it('ray hits a box ahead', () => {
    const t = rayAABB({ x: -10, z: 0 }, { x: 1, z: 0 }, 20, wall);
    expect(t).toBeCloseTo(8);
  });
  it('ray misses a box to the side', () => {
    expect(rayAABB({ x: -10, z: 10 }, { x: 1, z: 0 }, 20, wall)).toBeNull();
  });
  it('segment blocked detects occlusion', () => {
    expect(segmentBlocked({ x: -10, z: 0 }, { x: 1, z: 0 }, 20, [wall])).toBe(true);
    expect(segmentBlocked({ x: -10, z: 10 }, { x: 1, z: 0 }, 20, [wall])).toBe(false);
  });
  it('resolves against multiple boxes', () => {
    const p = { x: 0.5, z: 0.5 };
    resolveCircleWorld([wall, makeAABB(10, 10, 2, 2)], p, 0.5);
    expect(p.x).toBeGreaterThanOrEqual(2.5 - 1e-9);
  });
  it('spatial hash finds neighbors', () => {
    const h = new SpatialHash<{ pos: { x: number; z: number } }>(4);
    const a = { pos: { x: 0, z: 0 } };
    const b = { pos: { x: 2, z: 1 } };
    const far = { pos: { x: 100, z: 100 } };
    h.insert(a); h.insert(b); h.insert(far);
    const out: typeof a[] = [];
    h.query({ x: 0, z: 0 }, 3, out);
    expect(out).toContain(a);
    expect(out).toContain(b);
    expect(out).not.toContain(far);
  });
});

// --- ColliderGrid (segmentBlocked fast path) -----------------------------------
describe('collider grid', () => {
  // Build >96 colliders so segmentBlocked switches to the grid path.
  function bigSet(): ReturnType<typeof makeAABB>[] {
    const list = [makeAABB(0, 0, 4, 4)]; // the wall at the origin
    for (let i = 0; i < 120; i++) {
      const x = 40 + (i % 12) * 30, z = -200 + Math.floor(i / 12) * 30;
      list.push(makeAABB(x, z, 6, 6));
    }
    return list;
  }
  const linear = (
    o: { x: number; z: number }, d: { x: number; z: number }, m: number,
    cs: ReturnType<typeof makeAABB>[],
  ) => cs.some((c) => rayAABB(o, d, m, c) !== null);

  it('grid agrees with a linear scan across many rays', () => {
    const cs = bigSet();
    invalidateColliderGrid();
    for (let a = 0; a < 64; a++) {
      const ang = (a / 64) * Math.PI * 2;
      const dir = { x: Math.cos(ang), z: Math.sin(ang) };
      const o = { x: -10, z: -3 };
      expect(segmentBlocked(o, dir, 300, cs)).toBe(linear(o, dir, 300, cs));
    }
  });
  it('still detects the near wall through the grid', () => {
    const cs = bigSet();
    invalidateColliderGrid();
    expect(segmentBlocked({ x: -10, z: 0 }, { x: 1, z: 0 }, 20, cs)).toBe(true);
    expect(segmentBlocked({ x: -10, z: 10 }, { x: 1, z: 0 }, 20, cs)).toBe(false);
  });
  it('picks up in-place mutation after invalidateColliderGrid', () => {
    const cs = bigSet();
    invalidateColliderGrid();
    // clear path before the wall moves
    expect(segmentBlocked({ x: 20, z: 0 }, { x: 1, z: 0 }, 10, cs)).toBe(false);
    cs[0] = makeAABB(25, 0, 4, 4); // move the wall into the path
    invalidateColliderGrid();
    expect(segmentBlocked({ x: 20, z: 0 }, { x: 1, z: 0 }, 10, cs)).toBe(true);
  });
});

// --- Weapons -------------------------------------------------------------------
describe('weapons', () => {
  it('pistol: fires consume ammo, reload moves reserve to mag', () => {
    const w = new WeaponState();
    w.give('pistol');
    expect(w.ammo).toBe(12);
    expect(w.reserve).toBe(36);
    for (let i = 0; i < 12; i++) {
      w.cooldown = 0;
      expect(w.tryFire()).toBe(true);
    }
    expect(w.ammo).toBe(0);
    w.cooldown = 0;
    expect(w.tryFire()).toBe(false);
    w.startReload();
    expect(w.reloading).toBe(true);
    w.update(2.0);
    expect(w.reloading).toBe(false);
    expect(w.ammo).toBe(12);
    expect(w.reserve).toBe(24);
  });
  it('melee has no ammo and fires freely on cooldown', () => {
    const w = new WeaponState();
    w.give('bat');
    expect(w.ammo).toBe(-1);
    expect(w.tryFire()).toBe(true);
    expect(w.tryFire()).toBe(false); // on cooldown
    w.update(1.0);
    expect(w.tryFire()).toBe(true);
  });
  it('chainsaw burns fuel and stops when empty', () => {
    const w = new WeaponState();
    w.give('chainsaw');
    let shots = 0;
    for (let i = 0; i < 500; i++) {
      w.update(0.05);
      if (w.tryFire()) shots++;
    }
    expect(shots).toBeGreaterThan(0);
    expect(w.fuel).toBe(0);
    expect(w.canFire()).toBe(false);
  });
  it('rollDrop never yields bazooka at threat 1, can at threat 5', () => {
    const r1 = new RNG(1);
    const r5 = new RNG(1);
    for (let i = 0; i < 3000; i++) {
      expect(rollDrop(1, r1)).not.toBe('bazooka');
    }
    let sawBazooka = false;
    for (let i = 0; i < 5000; i++) {
      if (rollDrop(5, r5) === 'bazooka') sawBazooka = true;
    }
    expect(sawBazooka).toBe(true);
  });
});

// --- Threat director -------------------------------------------------------------
describe('director', () => {
  it('escalates at configured times', () => {
    expect(threatLevelFor(0)).toBe(1);
    expect(threatLevelFor(59)).toBe(1);
    expect(threatLevelFor(60)).toBe(2);
    expect(threatLevelFor(150)).toBe(3);
    expect(threatLevelFor(260)).toBe(4);
    expect(threatLevelFor(400)).toBe(5);
  });
  it('kill credit accelerates escalation', () => {
    const d = new Director();
    expect(d.level(50)).toBe(1);
    for (let i = 0; i < 12; i++) d.addKill(); // 12 * 0.9 = 10.8s credit
    expect(d.level(50)).toBe(2);
  });
  it('spawn points are valid and outside the view cone', () => {
    const d = new Director();
    const world: World = {
      colliders: [],
      surfaces: [],
      throwables: [],
      playerStart: { x: 0, z: 0, yaw: 0 },
      isSpawnValid: (x, z) => Math.hypot(x, z) < 120,
      tramRoutes: [], busRoutes: [], carRoutes: [], lamps: [],
    };
    const rng = new RNG(99);
    const player = { pos: { x: 0, z: 0 }, yaw: 0 }; // looking -Z
    for (let i = 0; i < 200; i++) {
      const p = d.pickSpawnPoint(player, world, rng);
      if (!p) continue;
      const dist = Math.hypot(p.x, p.z);
      expect(dist).toBeGreaterThanOrEqual(THREAT.spawnMinDist - 0.01);
      // view dir is (0,-1); reject cone means dot <= 0.82
      const dot = (-p.z) / dist;
      expect(dot).toBeLessThanOrEqual(THREAT.spawnViewDot + 1e-6);
    }
  });
  it('respects population cap', () => {
    const d = new Director();
    const world: World = { colliders: [], surfaces: [], throwables: [], playerStart: { x: 0, z: 0, yaw: 0 }, isSpawnValid: () => true, tramRoutes: [], busRoutes: [], carRoutes: [], lamps: [] };
    const rng = new RNG(5);
    let spawned = 0;
    for (let i = 0; i < 200; i++) {
      d.update(1, 0, spawned, { pos: { x: 0, z: 0 }, yaw: 0 }, world, rng, (size) => {
        spawned += size;
      });
    }
    expect(spawned).toBeLessThanOrEqual(THREAT.popCaps[0]);
  });
});

// --- Pack roles ---------------------------------------------------------------------
function fakeZombie(x: number, z: number, state = 'approach', role: Role = 'pursuer'): Zombie {
  return { pos: { x, z }, state, role, carrying: null, los: false } as unknown as Zombie;
}
function mkPack(members: Zombie[]): Pack {
  return { id: 1, members, reassignT: 0, known: { x: 0, z: 0 }, knownT: Infinity, assault: false, barkT: 0 };
}
const fakePlayer: PlayerView = {
  pos: { x: 0, z: 0 },
  vel: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  sprinting: false,
  eyeY: 1.7,
};

describe('pack roles', () => {
  it('assigns flankers and pursuers in a distant 6-member pack at threat 2', () => {
    const members = [
      fakeZombie(9, 0), fakeZombie(10, 2), fakeZombie(-9, 3),
      fakeZombie(12, -4), fakeZombie(-11, 5), fakeZombie(14, 8),
    ];
    const pack = mkPack(members);
    const roles = computeRoles(pack, { player: fakePlayer, threat: 2, throwablesAvailable: false });
    expect(roles.filter((r) => r === 'flanker').length).toBeGreaterThanOrEqual(1);
    expect(roles.filter((r) => r === 'pursuer').length).toBeGreaterThanOrEqual(1);
    expect(roles).not.toContain('swarm'); // no pressure yet
    expect(roles).not.toContain('thrower'); // threat < 3
  });
  it('close members switch to swarm when the pack gets pressure', () => {
    const members = [
      fakeZombie(4, 0), fakeZombie(6, 2), fakeZombie(-5, 3),
      fakeZombie(10, -4), fakeZombie(-10, 5), fakeZombie(12, 8),
    ];
    const pack = mkPack(members);
    const roles = computeRoles(pack, { player: fakePlayer, threat: 2, throwablesAvailable: false });
    expect(roles.filter((r) => r === 'swarm').length).toBeGreaterThanOrEqual(3);
    expect(roles.filter((r) => r === 'flanker').length).toBeGreaterThanOrEqual(1);
    expect(roles).not.toContain('thrower');
  });
  it('assigns a thrower at threat 3 when objects exist', () => {
    const members = [fakeZombie(8, 0), fakeZombie(10, 4), fakeZombie(-9, -6)];
    const pack = mkPack(members);
    const roles = computeRoles(pack, { player: fakePlayer, threat: 3, throwablesAvailable: true });
    expect(roles).toContain('thrower');
  });
  it('assigns an interceptor when the player is sprinting', () => {
    const members = [fakeZombie(9, 0), fakeZombie(11, 3), fakeZombie(-10, 2), fakeZombie(13, -5)];
    const pack = mkPack(members);
    const player: PlayerView = { ...fakePlayer, vel: new THREE.Vector3(8, 0, 0) };
    const roles = computeRoles(pack, { player, threat: 2, throwablesAvailable: false, onBark: () => {} });
    expect(roles).toContain('interceptor');
  });
});

// --- Pack knowledge (zombies 2.0) ----------------------------------------------------
describe('pack knowledge', () => {
  const barkCtx = (player: PlayerView, barks: { n: number }) => ({
    player, threat: 2, throwablesAvailable: false, onBark: () => { barks.n++; },
  });

  it('a sighting is shared with the pack as a fuzzed order, with a howl', () => {
    const m1 = fakeZombie(9, 0);
    m1.los = true;
    const m2 = fakeZombie(12, 4);
    const pm = new PackManager();
    const pack = pm.createPack([m1, m2]);
    const barks = { n: 0 };
    pm.update(0.7, barkCtx(fakePlayer, barks));
    expect(pack.knownT).toBe(0);
    expect(m2.orderFresh).toBe(true);
    expect(m2.order).not.toBeNull();
    // fuzzed, never a perfect hive mind
    expect(Math.hypot(m2.order!.x, m2.order!.z)).toBeLessThanOrEqual(PACK.orderNoise + 0.001);
    expect(barks.n).toBe(1); // the fresh sighting howls once
  });

  it('orders go stale when nobody has eyes on the player', () => {
    const m1 = fakeZombie(9, 0);
    m1.los = true;
    const pm = new PackManager();
    const pack = pm.createPack([m1]);
    const barks = { n: 0 };
    pm.update(0.7, barkCtx(fakePlayer, barks));
    expect(m1.orderFresh).toBe(true);
    m1.los = false;
    pm.update(PACK.knowledgeFresh + 0.1, barkCtx(fakePlayer, barks));
    expect(m1.orderFresh).toBe(false);
    expect(m1.order).toBeNull();
    expect(pack.assault).toBe(false);
  });

  it('assault engages with pressure + knowledge and barks once', () => {
    const m1 = fakeZombie(4, 0); // inside the pressure radius
    m1.los = true;
    const m2 = fakeZombie(12, 4);
    const pm = new PackManager();
    const pack = pm.createPack([m1, m2]);
    const barks = { n: 0 };
    pm.update(0.7, barkCtx(fakePlayer, barks));
    expect(pack.assault).toBe(true);
    expect(m2.assault).toBe(true);
    expect(barks.n).toBe(1); // sighting howl; assault howl is throttled behind it
  });

  it('a distant pack with no sighting never gets orders', () => {
    const m1 = fakeZombie(40, 0);
    const pm = new PackManager();
    pm.createPack([m1]);
    const barks = { n: 0 };
    pm.update(0.7, barkCtx(fakePlayer, barks));
    expect(m1.orderFresh).toBe(false);
    expect(m1.order).toBeNull();
    expect(barks.n).toBe(0);
  });

  it('attacksFromBehind detects the flank', () => {
    const player: PlayerView = { ...fakePlayer, yaw: 0 }; // facing -z
    expect(attacksFromBehind({ pos: { x: 0, z: 5 } }, player)).toBe(true); // at the back
    expect(attacksFromBehind({ pos: { x: 0, z: -5 } }, player)).toBe(false); // in front
    expect(attacksFromBehind({ pos: { x: 5, z: 0 } }, player)).toBe(false); // dead side
  });
});

// --- Traffic path math ---------------------------------------------------------
describe('traffic paths', () => {
  it('makePath computes cumulative length', () => {
    const p = makePath([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
    expect(p.total).toBeCloseTo(20);
  });
  it('samplePath interpolates position, tangent and clamps', () => {
    const p = makePath([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }]);
    const a = samplePath(p, 5);
    expect(a.x).toBeCloseTo(5); expect(a.z).toBeCloseTo(0);
    expect(a.dx).toBeCloseTo(1); expect(a.dz).toBeCloseTo(0);
    const b = samplePath(p, 15);
    expect(b.x).toBeCloseTo(10); expect(b.z).toBeCloseTo(5);
    expect(b.dx).toBeCloseTo(0); expect(b.dz).toBeCloseTo(1);
    const c = samplePath(p, 999); // clamped to the end
    expect(c.x).toBeCloseTo(10); expect(c.z).toBeCloseTo(10);
  });
  it('distPointSeg measures to the segment, not the infinite line', () => {
    expect(distPointSeg(5, 5, 0, 0, 10, 0)).toBeCloseTo(5);
    expect(distPointSeg(15, 3, 0, 0, 10, 0)).toBeCloseTo(Math.hypot(5, 3)); // past the end -> to endpoint
    expect(distPointSeg(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5); // before the start
  });
});
