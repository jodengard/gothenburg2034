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

/** Hijackable VOI scooters: zombie hooligans ride them; kill the rider, take it. */
export const SCOOTER = {
  batterySeconds: 20, // full-throttle ride time on a full charge
  maxSpeed: 9.5,
  reverseSpeed: 2.6,
  accel: 7.5,
  steerRate: 1.8, // rad/s at full speed
  radius: 0.5, // collision radius while riding
  eyeLift: 0.15, // camera rise standing on the deck
  mountRange: 2.4,
  roadkillDmg: 60,
  roadkillMinSpeed: 2.5,
  dropDespawn: 30, // seconds a riderless scooter waits before being "towd away"
  dismountDespawn: 12,
  deadDespawn: 5, // battery-dead husk removal
  fleet: 8, // scooters kept on the streets (shared OSM streets gridlock beyond this)
  respawnCd: 6,
  // --- trick riding: jump onto benches/car roofs and spin in the air ---
  jumpVel: 7.6, // m/s — apex ~1.6 m, clears a car roof
  gravity: 18,
  stepUp: 0.55, // benches can be driven onto; car roofs need a jump
  spinRate: 10, // rad/s visual spin while steering in the air
  bigAirT: 0.62, // airtime (s) that counts as BIG AIR
  whipDur: 0.34, // tailwhip flip duration (s)
};

/** Carrot drops: pick one up and an extra Lisebergskanin joins the fight. */
export const BUNNY = {
  dropChance: 0.05, // chance a zombie kill drops a carrot
  riderDropChance: 0.35, // scooter-riding hooligans carry the good stuff
  pickupRange: 1.6, // carrots auto-pick-up when you walk over them
  healFraction: 0.15, // eating a carrot also restores this share of max HP
  maxHelpers: 3, // bunny champions on the field at once
  lifetime: 45, // seconds of carrot power per helper
  speed: 7.5, // kickbike top speed (m/s)
  accel: 6,
  steerRate: 2.6, // rad/s steering toward the target
  dps: 55, // chainsaw damage per second
  range: 1.9, // chainsaw reach (m)
};

/** Fatalities & headshots: aim for the skull, watch them pop. */
export const FATALITY = {
  headMult: 2.5, // headshot damage multiplier
  headRadius: 0.24, // horizontal tolerance around the head axis (m)
  headMinY: 1.48, // head hitbox in zombie-local space (mesh y + this)
  headMaxY: 1.95,
  chance: 0.15, // chance a player kill detonates the corpse (headshot kills always do)
  chunks: 10, // gore chunks per detonation
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
  // Spawn ring distance from player (meters). Sized for the 130 m arena so
  // spawns stay inside the bounds even when the player hugs an edge.
  spawnMinDist: 18,
  spawnMaxDist: 30,
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
  // --- Zombies 2.0: shared pack knowledge & opportunity ---
  // A member with line of sight "howls" the player's position to the pack.
  // The shared guess is fuzzed and decays, so the pack is a hunting crew,
  // not a hive mind — and the howl is audible, which is the justification
  // for tactics that use it (spec: no magic knowledge through walls).
  knowledgeFresh: 6, // seconds the pack's shared sighting stays trusted
  orderNoise: 1.5, // m of fuzz on the shared position
  barkCooldown: 4, // s between a pack's coordination howls
  throwLeadTime: 0.35, // s the thrower leads a moving target
  throwLeadMax: 2.5, // m cap on that lead — sprinting sideways beats the throw
  throwSpreadMin: 0.8, // m: aim scatter even at point-blank — no throw is exact
  throwSpreadFrac: 0.12, // + this fraction of throw distance: far throws are wild
  flankBonusRange: 1.1, // m extra melee reach when attacking from behind
  behindDot: -0.25, // dot(attack bearing, player facing) below which a hit is a flank
  assaultCommit: 7, // m: flankers abandon the stand-off once the pack assaults
};

// The boomer class: a gut-bloated zombie that waddles at you and detonates on
// belly contact — blast damage up close, plus a lingering shit-cloud that
// poisons anyone dumb enough to stand in it. Zombies don't mind the gas.
export const FAT = {
  chance: [0, 0, 0.1, 0.12, 0.16] as const, // per threat level (1..5)
  maxPerPack: 2, // two boomers per pack is already a war crime
  hpMult: 5,
  speedMult: 0.5,
  radiusMult: 1.7,
  touchDist: 2.1, // belly-to-player distance that sets it off (m)
  blastRadius: 4.5, // blast damage falloff radius (m)
  blastDamage: 30, // point-blank; falls off linearly to 45 % at the edge
  gas: {
    radius: 4.5, // player inside this radius breathes the filth
    life: 7, // seconds the cloud hangs in the air
    dps: 6, // player damage per second inside the cloud
    tick: 0.6, // damage tick period (s)
    maxClouds: 4, // simultaneous clouds (pool cap)
    puffs: 14, // meshes per cloud
  },
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
    id: 'chainsaw', name: 'Chainsaw', kind: 'chain', damage: 260, range: 2.3,
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
  // Arena re-centred on the real district core: the strip between the
  // Korsvägen crossing (west) and the Gothia Towers (east).
  // (centerX/centerZ = offset of the arena centre from the OSM projection centre)
  centerX: 48,
  centerZ: -8,
  // 1:2 miniature: every OSM coordinate, road width, building and prop is
  // multiplied by this, so the whole district sits in a 130x130 m box — the
  // same real geography, twice as dense. Landmarks and traffic scale with it.
  scale: 0.5,
  halfSize: 65,
  // Dusk: a lighter mauve-twilight haze so the horizon reads as fading daylight
  // instead of pitch black; the Liseberg wheel still looms out of it and
  // Carlanderska stays fog-free.
  fogNear: 32,
  fogFar: 255,
  skyColor: 0x4a5578,
  fogColor: 0x4d5573,
  groundColor: 0x2f3322,
};

export const PERF = {
  farAiDist: 45, // beyond this, AI updates at reduced rate
  farAiInterval: 0.25,
  maxProjectiles: 64,
  maxParticles: 600,
};
