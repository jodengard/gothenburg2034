/** Gore-system invariants: bounded pools/heads, physics settle (headless, no WebGL). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fx } from '../src/fx';
import { GORE } from '../src/config';

describe('gore systems', () => {
  it('caps blood pools and recycles the oldest when full', () => {
    const fx = new Fx(new THREE.Scene());
    for (let i = 0; i < GORE.poolMax + 12; i++) fx.bloodPool(i, 0, 0.5);
    const alive = fx['bloodPools'].filter((p) => p.alive);
    expect(alive.length).toBe(GORE.poolMax);
    // the newest splats survive: slots beyond the cap must be in use
    expect(alive.some((p) => p.x > GORE.poolMax)).toBe(true);
  });

  it('pools spread to full radius and dry toward black, then expire', () => {
    const fx = new Fx(new THREE.Scene());
    fx.splat(1, 2, 3); // central pool + satellites
    const n0 = fx['bloodPools'].filter((p) => p.alive).length;
    expect(n0).toBe(4);
    for (let i = 0; i < 60; i++) fx.update(1 / 60); // 1 s: spread eases out
    expect(fx['bloodPools'].every((p) => !p.alive || p.spread === 1)).toBe(true);
    for (let i = 0; i < Math.ceil(GORE.poolLife * 1.4 * 60) + 120; i++) fx.update(1 / 60);
    expect(fx['bloodPools'].every((p) => !p.alive)).toBe(true);
  });

  it('severed head flies, bounces and settles on the ground within its lifetime', () => {
    const fx = new Fx(new THREE.Scene());
    fx.severedHead(0, 1.7, 0, 1, 0);
    for (let i = 0; i < Math.floor(GORE.headLife * 0.8 * 60); i++) fx.update(1 / 60);
    const heads = fx['headPool'].filter((h) => h.alive);
    expect(heads.length).toBe(1);
    expect(heads[0].y).toBeCloseTo(0.15, 2); // settled on the floor, still rolling
    expect(heads[0].x).toBeGreaterThan(2); // travelled down the bullet line
    for (let i = 0; i < 120; i++) fx.update(1 / 60); // past its life
    expect(fx['headPool'].every((h) => !h.alive)).toBe(true);
  });

  it('fatality gore stays bounded under repeated detonations', () => {
    const fx = new Fx(new THREE.Scene());
    for (let i = 0; i < 30; i++) fx.gore(i * 0.1, 1.1, 0);
    for (let i = 0; i < 30; i++) fx.update(1 / 60);
    const chunks = fx['chunkPool'].filter((c) => c.alive).length;
    expect(chunks).toBeLessThanOrEqual(90); // MAX_CHUNKS
    expect(fx['bloodPools'].filter((p) => p.alive).length).toBeLessThanOrEqual(GORE.poolMax);
  });
});
