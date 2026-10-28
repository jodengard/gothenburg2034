/** Weapon state & ammo logic (pure, unit-testable). Visuals live in viewmodel.ts. */
import { WEAPONS, WeaponDef, CHAINSAW_START_FUEL } from './config';
import { RNG } from './rng';
import { state } from './state';

export const RELOAD_TIME: Record<string, number> = {
  pistol: 1.2,
  shotgun: 2.2,
  ak: 1.8,
  bazooka: 2.0,
  flame: 2.6,
  bfg: 2.8,
};

export class WeaponState {
  id = 'bat';
  ammo = -1; // -1 = melee (no ammo)
  reserve = 0;
  cooldown = 0;
  reloadLeft = 0;
  fuel = CHAINSAW_START_FUEL;

  get def(): WeaponDef {
    return WEAPONS[this.id];
  }

  get reloading(): boolean {
    return this.reloadLeft > 0;
  }

  reset(): void {
    this.id = 'bat';
    this.ammo = -1;
    this.reserve = 0;
    this.cooldown = 0;
    this.reloadLeft = 0;
    this.fuel = CHAINSAW_START_FUEL;
  }

  /** Switch to a weapon (pickup). Grants pickup ammo. */
  give(id: string): void {
    const def = WEAPONS[id];
    if (!def) return;
    this.id = id;
    this.reloadLeft = 0;
    this.cooldown = 0;
    if (def.kind === 'gun' || def.kind === 'projectile') {
      this.ammo = def.magSize ?? 0;
      this.reserve = def.pickupReserve ?? 0;
    } else if (def.kind === 'chain') {
      this.ammo = -1;
      this.reserve = 0;
      this.fuel = CHAINSAW_START_FUEL;
    } else {
      this.ammo = -1;
      this.reserve = 0;
    }
    state.weaponId = this.id;
    state.ammo = this.ammo;
    state.reserve = this.reserve;
  }

  canFire(): boolean {
    const d = this.def;
    if (this.cooldown > 0 || this.reloading) return false;
    if (d.kind === 'chain') return this.fuel > 0;
    if (d.kind === 'gun' || d.kind === 'projectile') return this.ammo > 0;
    return true;
  }

  /** Consume the attack. Returns false if not possible. */
  tryFire(): boolean {
    if (!this.canFire()) return false;
    const d = this.def;
    this.cooldown = d.cooldown;
    if (d.kind === 'chain') {
      this.fuel = Math.max(0, this.fuel - (d.fuelUse ?? 0) * d.cooldown);
    } else if (d.kind === 'gun' || d.kind === 'projectile') {
      this.ammo--;
    }
    this.sync();
    return true;
  }

  startReload(): void {
    const d = this.def;
    if (d.kind !== 'gun' && d.kind !== 'projectile') return;
    if (this.reloading || this.ammo >= (d.magSize ?? 0) || this.reserve <= 0) return;
    this.reloadLeft = RELOAD_TIME[d.id] ?? 1.5;
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadLeft > 0) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) {
        this.reloadLeft = 0;
        const d = this.def;
        const need = (d.magSize ?? 0) - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
    this.sync();
  }

  private sync(): void {
    state.weaponId = this.id;
    state.ammo = this.ammo;
    state.reserve = this.reserve;
  }
}

/** Decide what a killed zombie drops. Returns weapon id or null. */
export function rollDrop(threatLevel: number, rng: RNG): string | null {
  const chance = 0.12 + 0.02 * (threatLevel - 1);
  if (!rng.chance(chance)) return null;
  const ids = Object.keys(WEAPONS);
  // Shanghai pins the threat display at 6 stars; drops still use the 5-level table
  const weights = ids.map((id) => WEAPONS[id].dropWeightByThreat[Math.min(threatLevel, 5) - 1] ?? 0);
  if (weights.every((w) => w === 0)) return null;
  return rng.weighted(ids, weights);
}
