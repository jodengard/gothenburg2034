/** Zombie simulation tests using a bare three.js scene (no DOM). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ZombieManager, PlayerView, Zombie } from '../src/zombie';
import { makeAABB } from '../src/collision';
import { ThrowableObject } from '../src/world';

function makeManager() {
  const scene = new THREE.Scene();
  const events = {
    onPlayerDamage: () => undefined,
    onChargerHit: () => undefined,
    onChargeWindup: () => undefined,
    onThrow: () => undefined,
    onKill: () => undefined,
    onHurtSound: () => undefined,
    onFatExplosion: () => undefined,
  };
  const colliders = [makeAABB(20, 0, 6, 6, 5)]; // a wall to the +X side
  const mgr = new ZombieManager(scene, colliders, events);
  const player: PlayerView = {
    pos: { x: 0, z: 0 }, vel: new THREE.Vector3(), yaw: 0, sprinting: false, eyeY: 1.7,
  };
  return { mgr, player, scene, colliders };
}

const noThrowables: ThrowableObject[] = [];

describe('zombie simulation', () => {
  it('zombies move toward a reachable player', () => {
    const { mgr, player } = makeManager();
    const z = mgr.spawn(15, 3, 1, 1);
    const x0 = z.pos.x;
    for (let i = 0; i < 120; i++) mgr.update(1 / 60, player, 1, noThrowables);
    const d0 = Math.hypot(x0 - 0, 3 - 0);
    const d1 = Math.hypot(z.pos.x - 0, z.pos.z - 0);
    expect(d1).toBeLessThan(d0 - 1); // closed in by >1m in 2s
  });

  it('zombies do not pass through walls', () => {
    const { mgr, player } = makeManager();
    // zombie behind the wall must route around, never end up inside
    const z = mgr.spawn(26, 0, 1, 1);
    const wall = { minX: 17, maxX: 23, minZ: -3, maxZ: 3 };
    for (let i = 0; i < 600; i++) {
      mgr.update(1 / 60, player, 1, noThrowables);
      const qx = Math.min(Math.max(z.pos.x, wall.minX), wall.maxX);
      const qz = Math.min(Math.max(z.pos.z, wall.minZ), wall.maxZ);
      const d = Math.hypot(z.pos.x - qx, z.pos.z - qz);
      expect(d).toBeGreaterThanOrEqual(0.44); // never penetrate the collider
    }
  });

  it('separation prevents stacking', () => {
    const { mgr, player } = makeManager();
    const a = mgr.spawn(10, 0, 1, 1);
    const b = mgr.spawn(10.05, 0.05, 1, 1);
    for (let i = 0; i < 120; i++) mgr.update(1 / 60, player, 1, noThrowables);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
    expect(d).toBeGreaterThan(0.3);
  });

  it('zombies die and are eventually removed from the active list', () => {
    const { mgr, player } = makeManager();
    const z = mgr.spawn(12, 0, 1, 1);
    let killed = false;
    for (let i = 0; i < 50; i++) {
      if (mgr.damage(z, 1000)) killed = true;
    }
    expect(killed).toBe(true);
    expect(z.state).toBe('dead');
    for (let i = 0; i < 60 * 6; i++) mgr.update(1 / 60, player, 1, noThrowables);
    expect(mgr.active).not.toContain(z);
    expect(mgr.count).toBe(0);
  });

  it('melee sweep hits zombies in front but not behind', () => {
    const { mgr } = makeManager();
    const front = mgr.spawn(0, -2, 1, 1); // camera at origin looking -Z
    const behind = mgr.spawn(0, 3, 1, 1);
    const origin = new THREE.Vector3(0, 1.7, 0);
    const hits = mgr.meleeSweep(origin, { x: 0, z: -1 }, 2.7, (75 * Math.PI) / 180 / 2);
    expect(hits).toContain(front);
    expect(hits).not.toContain(behind);
  });

  it('raycast hits the nearest zombie and respects max distance', () => {
    const { mgr } = makeManager();
    const near = mgr.spawn(0, -5, 1, 1);
    const far = mgr.spawn(0, -10, 1, 1);
    const origin = new THREE.Vector3(0, 1.7, 0);
    const dir = new THREE.Vector3(0, 0, -1);
    const hit = mgr.raycast(origin, dir, 50);
    expect(hit?.z).toBe(near);
    const short = mgr.raycast(origin, dir, 3);
    expect(short).toBeNull();
    void far;
  });

  it('population does not grow unbounded when many spawn and die', () => {
    const { mgr, player } = makeManager();
    for (let round = 0; round < 5; round++) {
      const spawned: Zombie[] = [];
      for (let i = 0; i < 20; i++) spawned.push(mgr.spawn(10 + i, 0, 1, 1));
      for (const z of spawned) mgr.damage(z, 10000);
      for (let i = 0; i < 60 * 6; i++) mgr.update(1 / 60, player, 1, noThrowables);
      expect(mgr.count).toBe(0);
    }
  });
});
