/** All balancing parameters in one editable place. Units: meters, seconds, kg-free. */

export const PLAYER = {
  radius: 0.42,
  eyeHeight: 1.7,
  walkSpeed: 5.2,
  sprintSpeed: 8.4,
  accel: 42,
  airAccel: 6,
  friction: 11,
  jumpSpeed: 5.4,
  gravity: 17.5,
  maxHealth: 100,
  mouseSensitivity: 0.0022,
  pitchLimit: 1.5,
  damageImmunityTime: 0.35,
  pickupRange: 2.4,
};

export const ZOMBIE = {
  radius: 0.45,
  height: 1.8,
  baseHealth: 42,
  healthPerThreat: 0.12, // +12% per threat level above 1
  baseSpeed: 2.3,
  speedPerThreat: 0.28,
  speedVariance: 0.35,
  meleeDamage: 9,
  meleeRange: 1.75,
  windupTime: 0.55,
  attackCooldown: 1.15,
  staggerTime: 0.55,
  staggerChance: 0.35,
  hearRadius: 55,
  hearRadiusSprint: 85,
  sightRange: 38,
  losCheckInterval: 0.3,
  separationStrength: 6,
  stuckTimeLimit: 1.6,
  deathFallTime: 0.7,
  deathSinkDelay: 3.5,
  dropChanceBase: 0.12,
  dropChancePerThreat: 0.02,
};

export const THREAT = {
  // Time (seconds) at which each level (index 0 => level 1) begins.
  levelTimes: [0, 60, 150, 260, 400],
  // Kill pressure: seconds of "time credit" granted per kill (accelerates escalation).
  killCredit: 0.9,
  killCreditCap: 90,
  // Level 1 is intentionally hot: 3x the original crowd (cap 30) so the
  // square feels under siege from the first minute. Later caps stay above
  // it and rise to 52 (perf budget: stable 60 fps up to ~60 zombies).
  popCaps: [30, 35, 41, 47, 52],
  // Intervals must keep shrinking as threat rises (a later level may never
  // spawn slower than an earlier one), so level 1's 3x faster cadence
  // pulls the whole curve in.
  spawnIntervals: [2.0, 2.0, 1.9, 1.8, 1.6],
  packSizes: [
    [3, 5],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 8],
  ] as const,
  // Spawn ring distance from player (meters).
  spawnMinDist: 42,
  spawnMaxDist: 72,
  // A spawn is rejected if it is inside this view cone (dot product) AND has LOS.
  spawnViewDot: 0.82,
  throwersEnabledFromLevel: 3,
};

export const PACK = {
  reassignInterval: 0.6,
  flankAngle: 1.35, // radians offset from direct approach
  flankDist: 11, // desired stand-off distance for flankers while maneuvering
  interceptLeadTime: 1.6, // seconds of player velocity prediction
  swarmRadius: 7.5, // pack pressure radius (m) that triggers swarm attacks
  throwRange: 16, // thrower acts if player within this distance
  throwObjectSearchRadius: 14,
};

export interface WeaponDef {
  id: string;
  name: string;
  kind: 'melee' | 'gun' | 'chain' | 'projectile';
  damage: number;
  range: number;
  cooldown: number; // seconds between attacks
  arcDeg?: number; // melee cone
  magSize?: number;
  startReserve?: number;
  pickupReserve?: number;
  pellets?: number;
  spread?: number; // radians
  recoil?: number; // pitch kick radians
  auto?: boolean;
  splashRadius?: number;
  fuelUse?: number; // chainsaw fuel per second
  chainTick?: number; // chainsaw damage interval
  dropWeightByThreat: number[]; // weight per threat level 1..5; 0 = never drops
  color: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  bat: {
    id: 'bat', name: 'Baseball Bat', kind: 'melee', damage: 34, range: 2.7,
    cooldown: 0.55, arcDeg: 75, dropWeightByThreat: [0, 0, 0, 0, 0], color: 0x8a5a2b,
  },
  axe: {
    id: 'axe', name: 'Axe', kind: 'melee', damage: 72, range: 2.45,
    cooldown: 0.95, arcDeg: 85, dropWeightByThreat: [3, 3, 2, 2, 1], color: 0x9aa0a6,
  },
  sword: {
    id: 'sword', name: 'Sword', kind: 'melee', damage: 46, range: 3.05,
    cooldown: 0.45, arcDeg: 80, dropWeightByThreat: [1, 2, 3, 2, 2], color: 0xcfd8dc,
  },
  chainsaw: {
    id: 'chainsaw', name: 'Chainsaw', kind: 'chain', damage: 55, range: 2.3,
    cooldown: 0.12, fuelUse: 22, chainTick: 0.12,
    dropWeightByThreat: [0, 1, 2, 2, 2], color: 0xd84315,
  },
  pistol: {
    id: 'pistol', name: 'Pistol', kind: 'gun', damage: 27, range: 120,
    cooldown: 0.17, magSize: 12, startReserve: 0, pickupReserve: 36,
    spread: 0.011, recoil: 0.012, dropWeightByThreat: [4, 4, 3, 2, 2], color: 0x37474f,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', kind: 'gun', damage: 11, pellets: 8, range: 45,
    cooldown: 0.85, magSize: 6, startReserve: 0, pickupReserve: 24,
    spread: 0.062, recoil: 0.045, dropWeightByThreat: [1, 2, 3, 3, 3], color: 0x5d4037,
  },
  ak: {
    id: 'ak', name: 'AK-47', kind: 'gun', damage: 21, range: 150,
    cooldown: 0.1, magSize: 30, startReserve: 0, pickupReserve: 90,
    spread: 0.026, recoil: 0.016, auto: true,
    dropWeightByThreat: [0, 0, 1, 2, 3], color: 0x6d4c41,
  },
  bazooka: {
    id: 'bazooka', name: 'Bazooka', kind: 'projectile', damage: 130, range: 200,
    cooldown: 1.6, magSize: 1, startReserve: 0, pickupReserve: 4,
    splashRadius: 5.5, recoil: 0.05,
    dropWeightByThreat: [0, 0, 0, 1, 2], color: 0x33691e,
  },
};

export const CHAINSAW_START_FUEL = 100;

export const THROWABLE = {
  damage: 14,
  speed: 14,
  gravity: 14,
  playerHitRadius: 0.9,
};

export const WORLD = {
  halfSize: 185, // arena is 370x370 m, sized to the real Korsvägen district
  fogNear: 90,
  fogFar: 430,
  skyColor: 0x8fa8bf,
  fogColor: 0xc4ced8,
  groundColor: 0x5c6652,
};

export const PERF = {
  farAiDist: 45, // beyond this, AI updates at reduced rate
  farAiInterval: 0.25,
  maxProjectiles: 64,
  maxParticles: 600,
};
