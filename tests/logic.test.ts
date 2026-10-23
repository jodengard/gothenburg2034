/** Unit tests for deterministic game logic (no DOM/WebGL required). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RNG } from '../src/rng';
import { makeAABB, resolveCircleAABB, rayAABB, segmentBlocked, resolveCircleWorld, SpatialHash } from '../src/collision';
import { WeaponState, rollDrop } from '../src/weapons';
import { threatLevelFor, Director } from '../src/director';
import { computeRoles, Pack } from '../src/pack';
import { Zombie, PlayerView, Role } from '../src/zombie';
import { World } from '../src/world';
import { THREAT } from '../src/config';

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
      throwables: [],
      playerStart: { x: 0, z: 0, yaw: 0 },
      isSpawnValid: (x, z) => Math.hypot(x, z) < 120,
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
    const world: World = { colliders: [], throwables: [], playerStart: { x: 0, z: 0, yaw: 0 }, isSpawnValid: () => true };
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
  return { pos: { x, z }, state, role, carrying: null } as unknown as Zombie;
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
    const pack: Pack = { id: 1, members, reassignT: 0 };
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
    const pack: Pack = { id: 1, members, reassignT: 0 };
    const roles = computeRoles(pack, { player: fakePlayer, threat: 2, throwablesAvailable: false });
    expect(roles.filter((r) => r === 'swarm').length).toBeGreaterThanOrEqual(3);
    expect(roles.filter((r) => r === 'flanker').length).toBeGreaterThanOrEqual(1);
    expect(roles).not.toContain('thrower');
  });
  it('assigns a thrower at threat 3 when objects exist', () => {
    const members = [fakeZombie(8, 0), fakeZombie(10, 4), fakeZombie(-9, -6)];
    const pack: Pack = { id: 1, members, reassignT: 0 };
    const roles = computeRoles(pack, { player: fakePlayer, threat: 3, throwablesAvailable: true });
    expect(roles).toContain('thrower');
  });
  it('assigns an interceptor when the player is sprinting', () => {
    const members = [fakeZombie(9, 0), fakeZombie(11, 3), fakeZombie(-10, 2), fakeZombie(13, -5)];
    const pack: Pack = { id: 1, members, reassignT: 0 };
    const player: PlayerView = { ...fakePlayer, vel: new THREE.Vector3(8, 0, 0) };
    const roles = computeRoles(pack, { player, threat: 2, throwablesAvailable: false });
    expect(roles).toContain('interceptor');
  });
});
