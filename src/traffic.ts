/**
 * Moving traffic as hazards: Gothenburg trams (lines 5 & 6) on the REAL OSM
 * tram rails, buses on the arterial roads and cars on side streets. Routes are
 * chained polylines from world.ts (real geometry); vehicles ping-pong along
 * them, driving on the right like everywhere else in Sweden.
 *
 * The player must avoid them (damage + knockback), and they mow down zombies —
 * kills go through ZombieManager.damage, so kill credit and weapon drops work
 * exactly like gunfire kills.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AABB, Vec2, resolveCircleWorld } from './collision';
import { PLAYER, ZOMBIE, SCOOTER, WORLD } from './config';
import { RNG } from './rng';
import { sfx } from './audio';
import type { World, RideSurface } from './world';
import type { ZombieManager, Zombie, RideAnchor } from './zombie';

// --- path utilities (pure, unit-tested) --------------------------------------

export interface Path { pts: Vec2[]; cum: number[]; total: number }

export function makePath(pts: Vec2[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

/** Position + unit tangent at arc-length s (clamped to the path). */
export function samplePath(p: Path, s: number): { x: number; z: number; dx: number; dz: number } {
  const sc = Math.max(0, Math.min(p.total, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < sc) i++;
  const a = p.pts[i - 1], b = p.pts[i];
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const t = (sc - p.cum[i - 1]) / seg;
  return {
    x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    dx: (b.x - a.x) / seg, dz: (b.z - a.z) / seg,
  };
}

/** Distance from point (px,pz) to segment (ax,az)-(bx,bz). */
export function distPointSeg(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): number {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2)) : 0;
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

// --- vehicles -----------------------------------------------------------------

type Kind = 'tram' | 'bus' | 'car' | 'scooter';

/**
 * Scooter life cycle: a hooligan zombie rides it on its route ('route');
 * shoot the rider and it coasts to a stop, waiting to be hijacked
 * ('dropped'); hijack it and you drive ('ridden'); out of battery it becomes
 * a blinking husk ('dead') until it is towed away. Dropped ones are towed
 * away too — the streets always refill to a full fleet of new ones.
 */
export type VehicleState = 'route' | 'dropped' | 'ridden' | 'dead';

const SPEC: Record<Kind, {
  speed: number; halfLen: number; halfW: number; laneOff: number;
  playerDmg: number; zombieDmg: number; shake: number;
}> = {
  tram: { speed: 8.5, halfLen: 11.8, halfW: 1.35, laneOff: 0, playerDmg: 85, zombieDmg: 1000, shake: 0.9 },
  bus:  { speed: 7.0, halfLen: 6.2,  halfW: 1.3,  laneOff: 2.6, playerDmg: 45, zombieDmg: 150, shake: 0.6 },
  car:  { speed: 8.0, halfLen: 2.3,  halfW: 0.95, laneOff: 2.0, playerDmg: 28, zombieDmg: 70,  shake: 0.45 },
  // VOI e-scooters: everywhere in Gothenburg, weaving along the curb, ding-ing
  // at you. More irritating than dangerous.
  scooter: { speed: 5.2, halfLen: 0.7, halfW: 0.35, laneOff: 3.1, playerDmg: 8, zombieDmg: 20, shake: 0.18 },
};
// The miniature streets are half as wide, so the lanes shrink with them — but
// the vehicles themselves stay real size (you ride them, they run you over).
// Speeds stay in real m/s — traffic still feels fast.
for (const k of ['tram', 'bus', 'car', 'scooter'] as const) {
  SPEC[k].laneOff *= WORLD.scale;
}

interface Vehicle {
  kind: Kind; path: Path; group: THREE.Object3D;
  s: number; sMin: number; sMax: number;
  dir: number; speed: number; laneOff: number;
  hitCd: number; hornCd: number;
  shadowOn: boolean;
  /** scooter weave: elapsed time, per-vehicle phase, swerve amplitude &
   * frequency (hooligan driving crosses whole lanes, hence the big amp) */
  t: number; phase: number; swerveAmp: number; swerveF: number;
  // --- scooter hooliganism ---
  vstate: VehicleState;
  /** zombie riding this scooter (scooters only); null once the rider is dead */
  rider: Zombie | null;
  /** position/heading shared with the rider zombie each frame */
  anchor: RideAnchor;
  /** seconds of ride time left in the battery */
  battery: number;
  /** tow-away countdown while dropped/dead */
  despawnT: number;
  /** free-drive state while ridden (off-path) */
  heading: number; spd: number; freeX: number; freeZ: number;
  // --- trick riding while ridden ---
  /** height above ground: jumping, riding benches/car roofs */
  y: number; vy: number;
  /** airtime, visual spin, accumulated spin, tailwhips, whip flip timer */
  airT: number; spin: number; spinAccum: number; whips: number; whipT: number;
  jumpHeld: boolean;
  /** the airport coach that shuttles between Gothenburg and Shanghai */
  flygbuss?: boolean;
}

const MAT = {
  tramBlue: new THREE.MeshStandardMaterial({ color: 0x0d5aa7, roughness: 0.45, metalness: 0.35 }),
  busBlue: new THREE.MeshStandardMaterial({ color: 0x0b3d6e, roughness: 0.5, metalness: 0.3 }),
  busNavy: new THREE.MeshStandardMaterial({ color: 0x16294d, roughness: 0.45, metalness: 0.35 }),
  white: new THREE.MeshLambertMaterial({ color: 0xe8ecf0 }),
  signAmber: new THREE.MeshBasicMaterial({ color: 0xffb000 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.15, metalness: 0.7 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xdfe2e4, roughness: 0.6, metalness: 0.2 }),
  door: new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.5, metalness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.8 }),
  headlight: new THREE.MeshBasicMaterial({ color: 0xfff0c0 }),
  taillight: new THREE.MeshBasicMaterial({ color: 0xff2a14 }),
};

const CAR_COLORS = [0x9aa0a6, 0xe6e6e2, 0x8c1f28, 0x1f3a5f, 0x24272b, 0x6b7a5e, 0x7d7a72, 0x3c5a46];

/** Line-number display board (canvas texture, Swedish transit style). */
function boardTex(num: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0f14'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#ffd400'; g.font = 'bold 44px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(num, 64, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function board(num: string): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.3, 0.55),
    new THREE.MeshBasicMaterial({ map: boardTex(num) }),
  );
}

/** Destination display for the Flygbussen coach (wide, amber, airport-bus style). */
export function signTex(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0f14'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#ffb000'; g.font = 'bold 34px Arial';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Flygbussarna coach: navy livery, white stripe, lit 'SHANGHAI' boards.
 * One of these on the Gothenburg streets is not a normal route 6 bus...
 */
export function buildFlygbuss(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.5, 3.0, 12, MAT.busNavy, 0, 1.6));
  g.add(box(2.56, 0.9, 11.0, MAT.glass, 0, 2.1));
  g.add(box(2.3, 0.12, 11.8, MAT.roof, 0, 3.12));
  g.add(box(2.52, 0.5, 12.0, MAT.dark, 0, 0.42)); // skirt/wheels
  g.add(box(2.54, 0.34, 11.4, MAT.white, 0, 1.28)); // side stripe
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.55),
    new THREE.MeshBasicMaterial({ map: signTex('SHANGHAI') }),
  );
  sign.position.set(0, 2.72, 6.02);
  g.add(sign);
  const signBack = sign.clone();
  signBack.rotation.y = Math.PI;
  signBack.position.z = -6.02;
  g.add(signBack);
  g.add(box(0.9, 0.22, 0.5, MAT.signAmber, 0, 3.28, 2.6)); // roof beacon
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, 0.85, 0.8, 6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, -0.85, 0.8, 6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, 0.85, 0.8, -6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, -0.85, 0.8, -6.0));
  return g;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Gothenburg M28-style tram: two blue cars, articulation at origin, front = +Z. */
function buildTram(line: number): THREE.Group {
  const g = new THREE.Group();
  for (const side of [1, -1]) {
    const car = new THREE.Group();
    car.position.z = side * 5.75;
    car.add(box(2.5, 2.9, 11.2, MAT.tramBlue, 0, 1.55));
    car.add(box(2.58, 0.85, 10.4, MAT.glass, 0, 2.05));
    car.add(box(2.3, 0.14, 11.0, MAT.roof, 0, 3.02));
    for (const dz of [-3.6, 0, 3.6]) {
      car.add(box(0.07, 2.1, 1.3, MAT.door, 1.27, 1.35, dz));
      car.add(box(0.07, 2.1, 1.3, MAT.door, -1.27, 1.35, dz));
    }
    car.add(box(2.1, 0.5, 2.0, MAT.dark, 0, 0.35, 3.8));
    car.add(box(2.1, 0.5, 2.0, MAT.dark, 0, 0.35, -3.8));
    g.add(car);
  }
  g.add(box(1.6, 0.4, 1.4, MAT.dark, 0, 3.3, -5.75)); // pantograph car
  const fb = board(String(line)); fb.position.set(0, 2.55, 11.42); g.add(fb);
  const rb = board(String(line)); rb.position.set(0, 2.55, -11.42); rb.rotation.y = Math.PI; g.add(rb);
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, 0.8, 0.75, 11.4));
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, -0.8, 0.75, 11.4));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, 0.8, 0.75, -11.4));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, -0.8, 0.75, -11.4));
  return g;
}

/** City bus (Älvsbuss blue), front = +Z. */
function buildBus(line: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(2.5, 3.0, 12, MAT.busBlue, 0, 1.6));
  g.add(box(2.56, 0.9, 11.0, MAT.glass, 0, 2.1));
  g.add(box(2.3, 0.12, 11.8, MAT.roof, 0, 3.12));
  g.add(box(2.52, 0.5, 12.0, MAT.dark, 0, 0.42)); // skirt/wheels
  const fb = board(String(line)); fb.position.set(0, 2.6, 6.02); g.add(fb);
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, 0.85, 0.8, 6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.headlight, -0.85, 0.8, 6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, 0.85, 0.8, -6.0));
  g.add(box(0.26, 0.18, 0.06, MAT.taillight, -0.85, 0.8, -6.0));
  return g;
}

/** Small car, front = +Z. */
function buildCar(rng: RNG): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({
    color: CAR_COLORS[Math.floor(rng.range(0, CAR_COLORS.length))],
    roughness: 0.35, metalness: 0.6,
  });
  g.add(box(1.8, 0.85, 4.4, body, 0, 0.62));
  g.add(box(1.6, 0.62, 2.2, MAT.glass, 0, 1.3, -0.2));
  g.add(box(0.3, 0.2, 0.06, MAT.headlight, 0.6, 0.6, 2.21));
  g.add(box(0.3, 0.2, 0.06, MAT.headlight, -0.6, 0.6, 2.21));
  g.add(box(0.3, 0.2, 0.06, MAT.taillight, 0.6, 0.65, -2.21));
  g.add(box(0.3, 0.2, 0.06, MAT.taillight, -0.6, 0.65, -2.21));
  return g;
}

/** Bake a flat colour into vertex colours so parts can merge into one mesh. */
function tinted(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * VOI e-scooter: yellow stem + deck accents, tiny wheels, front = +Z.
 * Merged into ONE vertex-coloured mesh — 12 of these swarm the streets and
 * separate parts would cost ~70 draw calls on mobile.
 */
export function buildScooter(): THREE.Mesh {
  const wheel = new THREE.CylinderGeometry(0.13, 0.13, 0.07, 10);
  wheel.rotateZ(Math.PI / 2);
  const parts: THREE.BufferGeometry[] = [];
  for (const z of [0.42, -0.42]) {
    const w = wheel.clone().translate(0, 0.13, z);
    parts.push(tinted(w, 0x101113));
  }
  parts.push(tinted(new THREE.BoxGeometry(0.2, 0.05, 0.72).translate(0, 0.2, -0.05), 0x1b1b1d)); // deck
  parts.push(tinted(new THREE.BoxGeometry(0.14, 0.03, 0.34).translate(0, 0.245, -0.05), 0xffcf00)); // grip pad
  const stem = new THREE.BoxGeometry(0.06, 1.02, 0.06);
  stem.rotateX(-0.14);
  stem.translate(0, 0.72, 0.4);
  parts.push(tinted(stem, 0xffcf00));
  parts.push(tinted(new THREE.BoxGeometry(0.46, 0.05, 0.05).translate(0, 1.2, 0.47), 0x1b1b1d)); // handlebar
  parts.push(tinted(new THREE.BoxGeometry(0.1, 0.06, 0.05).translate(0, 0.32, -0.47), 0xff5030)); // reflector
  const mesh = new THREE.Mesh(
    mergeGeometries(parts, false)!,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 }),
  );
  mesh.castShadow = false;
  return mesh;
}

// --- manager --------------------------------------------------------------------

export class Traffic {
  readonly vehicles: Vehicle[] = [];
  private root = new THREE.Group();
  private rng = new RNG(4242);
  private colliders: AABB[];
  private scooterFleet: number;
  private scooterRoutes: Vec2[][];
  private zm: ZombieManager | null = null;
  private riddenV: Vehicle | null = null;
  private respawnCd = 0;
  /** rideable tops for trick jumps (benches, parked cars, barriers) */
  private surfaces: RideSurface[];
  private rideTop = new Map<AABB, number>();
  /** called on a clean landing with a scored trick */
  onTrick: ((label: string, points: number) => void) | null = null;

  constructor(scene: THREE.Scene, world: World, opts?: { scooterFleet?: number }) {
    scene.add(this.root);
    const rng = this.rng;
    this.scooterFleet = opts?.scooterFleet ?? SCOOTER.fleet;
    this.colliders = world.colliders;
    this.surfaces = world.surfaces;
    for (const s of world.surfaces) this.rideTop.set(s.col, s.top);
    if (world.tramRoutes.length === 1) {
      // The whole tram network chains into one long route: run line 5 on the
      // west half and line 6 on the east half so both lines exist and never
      // drive through each other.
      const pts = world.tramRoutes[0];
      const total = makePath(pts).total;
      const mid = total / 2;
      const h = SPEC.tram.halfLen;
      this.spawn('tram', pts, rng, 5, [h + 4, mid - h - 4]);
      this.spawn('tram', pts, rng, 6, [mid + h + 4, total - h - 4]);
    } else {
      world.tramRoutes.forEach((pts, i) => this.spawn('tram', pts, rng, [5, 6][i % 2]));
    }
    // The first bus line is the Flygbussen: the airport coach that (oddly)
    // terminates in Shanghai — board it to travel there.
    world.busRoutes.forEach((pts, i) => this.spawn('bus', pts, rng, [3, 57, 6][i % 3], undefined, i === 0));
    world.carRoutes.forEach((pts, i) => {
      const total = makePath(pts).total;
      const h = SPEC.car.halfLen;
      if (i < 2 && total > 150 * WORLD.scale) {
        // two cars per long route, each owning half so they never overlap
        const mid = total / 2;
        this.spawn('car', pts, rng, 0, [h + 4, mid - h - 4]);
        this.spawn('car', pts, rng, 0, [mid + h + 4, total - h - 4]);
      } else {
        this.spawn('car', pts, rng, 0);
      }
    });
    // VOI scooters: a couple on every car route (capped) — they are everywhere
    this.scooterRoutes = world.carRoutes.length ? world.carRoutes : world.busRoutes;
    for (let i = 0; this.scooterRoutes.length && i < this.scooterFleet; i++) {
      this.spawn('scooter', this.scooterRoutes[i % this.scooterRoutes.length], rng, 0);
    }
  }

  private spawn(kind: Kind, pts: Vec2[], rng: RNG, line: number, range?: [number, number], flygbuss = false): Vehicle | null {
    if (pts.length < 2) return null;
    const path = makePath(pts);
    const spec = SPEC[kind];
    if (path.total < spec.halfLen * 2 + 20) return null;
    const sMin = range ? range[0] : spec.halfLen + 4;
    const sMax = range ? range[1] : path.total - spec.halfLen - 4;
    if (sMax - sMin < 10) return null;
    const group = kind === 'tram' ? buildTram(line)
      : kind === 'bus' ? (flygbuss ? buildFlygbuss() : buildBus(line))
      : kind === 'scooter' ? buildScooter()
      : buildCar(rng);
    // vehicles are player-scale: real-size traffic on miniature streets
    const v: Vehicle = {
      kind, path, group, laneOff: spec.laneOff, flygbuss: flygbuss || undefined,
      speed: kind === 'car' || kind === 'scooter'
        ? (kind === 'car' ? rng.range(6.5, 9.5) : rng.range(3.8, 6.8))
        : spec.speed,
      s: rng.range(sMin, sMax), sMin, sMax,
      dir: rng.chance(0.5) ? 1 : -1, hitCd: 0, hornCd: 0, shadowOn: true,
      t: 0, phase: rng.range(0, Math.PI * 2),
      // hooligan weave: swerve amplitude reaches across the whole street
      // (into the car/bus/tram lanes), frequency varies per hooligan
      swerveAmp: kind === 'scooter' ? rng.range(0.9, 1.7) : 0,
      swerveF: kind === 'scooter' ? rng.range(0.5, 1.4) : 1,
      vstate: 'route', rider: null, anchor: { x: 0, z: 0, heading: 0 },
      battery: kind === 'scooter' ? rng.range(6, SCOOTER.batterySeconds) : 0,
      despawnT: 0, heading: 0, spd: 0, freeX: 0, freeZ: 0,
      y: 0, vy: 0, airT: 0, spin: 0, spinAccum: 0, whips: 0, whipT: 0, jumpHeld: false,
    };
    this.vehicles.push(v);
    this.root.add(group);
    return v;
  }

  /** Vehicles beyond this distance stop casting shadows (biggest mobile cost). */
  private setShadow(v: Vehicle, on: boolean): void {
    if (v.shadowOn === on) return;
    v.shadowOn = on;
    v.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = on; });
  }

  // --- scooter hooligans & hijacking ------------------------------------------

  /** Give every street scooter a zombie rider. Called once after boot. */
  attachZombies(zm: ZombieManager): void {
    this.zm = zm;
    for (const v of this.vehicles) {
      if (v.kind === 'scooter') this.attachRider(v);
    }
  }

  private attachRider(v: Vehicle): void {
    if (!this.zm) return;
    const c = samplePath(v.path, v.s);
    const hx = c.dx * v.dir, hz = c.dz * v.dir;
    const rx = -hz, rz = hx;
    const x = c.x + rx * v.laneOff, z = c.z + rz * v.laneOff;
    const zom = this.zm.spawn(x, z, 0, 1);
    zom.ride = v.anchor;
    zom.mesh.position.y = 0.18; // standing on the deck
    v.rider = zom;
  }

  /** Nearest hijackable (dropped, charged) scooter within reach, if any. */
  findMount(px: number, pz: number): Vehicle | null {
    let best: Vehicle | null = null;
    let bd = SCOOTER.mountRange;
    for (const v of this.vehicles) {
      if (v.kind !== 'scooter' || v.vstate !== 'dropped' || v.battery <= 0.2) continue;
      const d = Math.hypot(v.group.position.x - px, v.group.position.z - pz);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  get ridden(): Vehicle | null {
    return this.riddenV;
  }

  mount(v: Vehicle): void {
    v.vstate = 'ridden';
    v.heading = v.group.rotation.y;
    v.freeX = v.group.position.x;
    v.freeZ = v.group.position.z;
    v.spd = 0;
    v.y = 0; v.vy = 0; v.airT = 0; v.spin = 0; v.spinAccum = 0;
    v.whips = 0; v.whipT = 0; v.jumpHeld = false;
    v.group.rotation.z = 0;
    const mat = (v.group as THREE.Mesh).material as THREE.MeshStandardMaterial;
    mat.transparent = false; // cancel any tow-away blink
    mat.opacity = 1;
    this.setShadow(v, true);
    this.riddenV = v;
  }

  dismount(): void {
    const v = this.riddenV;
    if (!v) return;
    this.riddenV = null;
    v.vstate = 'dropped';
    v.despawnT = SCOOTER.dismountDespawn;
    v.y = 0; v.vy = 0; v.group.position.y = 0; // hop off: the scooter drops to the street
    v.group.rotation.x = 0;
    v.group.rotation.z = 0.16; // kicked over onto its side a bit
  }

  /**
   * Drive the hijacked scooter: throttle/brake/steer, battery drain, world
   * collision, and roadkill. Writes position/velocity into `player` (which
   * must skip its own horizontal movement while riding). Returns nothing;
   * `ridden` becomes null when the battery dies and strands the rider.
   */
  updateRidden(
    dt: number,
    input: { fwd: boolean; back: boolean; left: boolean; right: boolean; jump: boolean },
    player: { pos: Vec2; vel: THREE.Vector3 },
    zombies: ZombieManager,
  ): void {
    const v = this.riddenV;
    if (!v) return;
    const throttle = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
    const powered = v.battery > 0;
    if (powered && throttle > 0) v.spd += SCOOTER.accel * dt;
    else if (powered && throttle < 0) v.spd -= SCOOTER.accel * 1.3 * dt;
    else v.spd *= Math.max(0, 1 - dt * 1.6); // coast / dead battery
    v.spd = Math.max(-SCOOTER.reverseSpeed, Math.min(SCOOTER.maxSpeed, v.spd));

    if (powered && throttle !== 0 && Math.abs(v.spd) > 0.2) {
      v.battery -= dt * (0.35 + 0.65 * (Math.abs(v.spd) / SCOOTER.maxSpeed));
      if (v.battery <= 0) {
        v.battery = 0;
        sfx.crash(); // the deck dies under you
      }
    }

    // steering needs some speed to bite; reversed when driving backwards.
    // forward is (sin h, cos h), so INCREASING heading turns LEFT — right key
    // must decrease it.
    const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    v.heading -= steer * SCOOTER.steerRate * dt * Math.max(-1, Math.min(1, v.spd / 3));
    const hx = Math.sin(v.heading), hz = Math.cos(v.heading);
    v.freeX += hx * v.spd * dt;
    v.freeZ += hz * v.spd * dt;
    // rideable tops only block while the deck is below them — above, you roll over
    const p: Vec2 = { x: v.freeX, z: v.freeZ };
    resolveCircleWorld(this.colliders, p, SCOOTER.radius, (a) => {
      const top = this.rideTop.get(a);
      return top !== undefined && top <= v.y + SCOOTER.stepUp;
    });
    v.freeX = p.x;
    v.freeZ = p.z;

    // --- vertical: jump, benches, parked-car roofs -------------------------------
    const support = this.supportY(v.freeX, v.freeZ, v.y);
    if (input.jump && powered && v.y <= support + 0.001 && v.vy <= 0) {
      v.vy = SCOOTER.jumpVel; // full charge clears a car roof
      sfx.jump();
    }
    v.vy -= SCOOTER.gravity * dt;
    v.y += v.vy * dt;
    let landed = false;
    if (v.y <= support) {
      if (v.vy < -7 && v.airT > 0.1) sfx.thud(); // slappy landings
      v.y = support;
      v.vy = 0;
      landed = v.airT > 0.05;
    }
    const airborne = v.y > support + 0.001;

    // --- tricks: steer to spin, jump again to tailwhip, score on the landing -----
    if (airborne) {
      v.airT += dt;
      if (input.jump && !v.jumpHeld && v.airT > 0.1) {
        v.whips++;
        v.whipT = SCOOTER.whipDur;
        sfx.swing();
      }
      v.spin += steer * SCOOTER.spinRate * dt;
      v.spinAccum += steer * SCOOTER.spinRate * dt;
    } else if (landed) {
      const tricks: string[] = [];
      let pts = 0;
      const spins = Math.floor(Math.abs(v.spinAccum) / (Math.PI * 2));
      if (spins > 0) { tricks.push(spins > 1 ? `${spins * 360} SPIN` : '360 SPIN'); pts += spins * 100; }
      if (v.whips > 0) { tricks.push(v.whips > 1 ? `${v.whips}× TAILWHIP` : 'TAILWHIP'); pts += v.whips * 50; }
      if (v.airT > SCOOTER.bigAirT) { tricks.push('BIG AIR'); pts += 50; }
      if (support > 0.8) { tricks.push('ROOF TOP'); pts += 75; }
      if (pts > 0) {
        sfx.trick();
        this.onTrick?.(tricks.join(' + '), pts);
      }
      v.airT = 0; v.spin = 0; v.spinAccum = 0; v.whips = 0;
    }
    v.jumpHeld = input.jump;
    if (v.whipT > 0) v.whipT = Math.max(0, v.whipT - dt);

    v.group.position.set(v.freeX, v.y, v.freeZ);
    v.group.rotation.y = v.heading + v.spin;
    v.group.rotation.x = v.whipT > 0
      ? Math.sin(((SCOOTER.whipDur - v.whipT) / SCOOTER.whipDur) * Math.PI) * 0.85 // tailwhip flip
      : 0;
    v.group.rotation.z = steer * Math.max(0, Math.min(1, v.spd / SCOOTER.maxSpeed)) * 0.22;

    // the player rides along
    player.pos.x = v.freeX;
    player.pos.z = v.freeZ;
    player.vel.x = hx * v.spd;
    player.vel.z = hz * v.spd;

    // roadkill: mow down the horde (kills route through the manager)
    if (Math.abs(v.spd) > SCOOTER.roadkillMinSpeed && v.y < 0.55) {
      for (const z of zombies.active) {
        if (z.state === 'dead' || z.hitFlash > 0) continue; // per-zombie re-hit guard
        if (Math.hypot(z.pos.x - v.freeX, z.pos.z - v.freeZ) < SCOOTER.radius + ZOMBIE.radius + 0.25) {
          zombies.damage(z, SCOOTER.roadkillDmg, hx * 7, hz * 7, { byPlayer: true });
          v.spd *= 0.9;
        }
      }
    }

    // out of battery: strand the rider, the husk is towed away
    if (!powered && Math.abs(v.spd) < 0.4) {
      this.riddenV = null;
      v.vstate = 'dead';
      v.despawnT = SCOOTER.deadDespawn;
      v.y = 0; v.vy = 0; v.group.position.y = 0; // settle onto the street
      v.group.rotation.x = 0;
      v.group.rotation.z = 0.16;
    }
  }

  /**
   * Highest rideable top (bench seat, car roof, barrier) under (x, z) that the
   * deck can rest on from height `fromY` — step-up limited so you can drive up
   * a bench but need a jump for a car roof. 0 = asphalt.
   */
  private supportY(x: number, z: number, fromY: number): number {
    let best = 0;
    for (const s of this.surfaces) {
      if (s.top <= best || s.top > fromY + SCOOTER.stepUp) continue;
      if (x >= s.minX - 0.15 && x <= s.maxX + 0.15 && z >= s.minZ - 0.15 && z <= s.maxZ + 0.15) best = s.top;
    }
    return best;
  }

  /** Rider shot dead: the scooter coasts to a stop and waits to be hijacked. */
  private dropScooter(v: Vehicle): void {
    v.rider = null;
    v.vstate = 'dropped';
    v.despawnT = SCOOTER.dropDespawn;
    v.spd = v.speed * 0.6;
    v.group.rotation.z = 0.16;
    sfx.bell(); // abandoned scooter chirps on the asphalt
  }

  /** Dropped/dead scooter: coast to a stop, blink near tow-away, remove. */
  private updateIdleScooter(v: Vehicle, dt: number, index: number, player: { pos: Vec2 }): void {
    if (v.vstate === 'ridden') return; // driven by updateRidden
    if (v.vstate === 'dropped' && v.spd > 0.05) {
      v.spd = Math.max(0, v.spd - dt * 3.2);
      v.s += v.dir * v.spd * dt;
      if (v.s > v.sMax) v.s = v.sMax;
      else if (v.s < v.sMin) v.s = v.sMin;
      const c = samplePath(v.path, v.s);
      const hx = c.dx * v.dir, hz = c.dz * v.dir;
      const rx = -hz, rz = hx;
      v.group.position.set(c.x + rx * v.laneOff, 0, c.z + rz * v.laneOff);
      v.group.rotation.y = Math.atan2(hx, hz);
    }
    this.setShadow(v, Math.hypot(v.group.position.x - player.pos.x, v.group.position.z - player.pos.z) < 34);
    v.despawnT -= dt;
    if (v.despawnT < 3) {
      const mat = (v.group as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = Math.sin(v.t * 16) > 0 ? 0.9 : 0.25; // blink: tow truck coming
    }
    if (v.despawnT <= 0) this.removeVehicle(index);
  }

  private removeVehicle(i: number): void {
    const v = this.vehicles[i];
    this.root.remove(v.group);
    const m = v.group as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
    this.vehicles.splice(i, 1);
  }

  /** Keep the streets at a full fleet: towed scooters are replaced, with riders. */
  private refillFleet(dt: number): void {
    if (!this.zm || !this.scooterRoutes.length) return;
    // keep the wreck pile finite: traffic takes riders out fast, so the
    // tow truck "collects" the oldest dropped scooters once the curbs are
    // full (caps live scooter objects and their draw calls)
    const wrecks: { i: number; v: Vehicle }[] = [];
    this.vehicles.forEach((v, i) => {
      if (v.kind === 'scooter' && v.vstate === 'dropped') wrecks.push({ i, v });
    });
    const excess = wrecks.length - 8;
    if (excess > 0) {
      const doomed = wrecks.sort((a, b) => a.v.despawnT - b.v.despawnT).slice(0, excess)
        .sort((a, b) => b.i - a.i); // remove back-to-front so indices stay valid
      for (const w of doomed) this.removeVehicle(w.i);
    }
    let n = 0;
    // only ACTIVE scooters count toward the fleet: a rider killed by traffic
    // becomes a tow-waiting wreck, and the streets must keep buzzing with a
    // fresh hooligan rather than staying empty until the tow truck arrives
    for (const v of this.vehicles) if (v.kind === 'scooter' && v.vstate === 'route') n++;
    if (n >= this.scooterFleet) return;
    this.respawnCd -= dt;
    if (this.respawnCd > 0) return;
    this.respawnCd = SCOOTER.respawnCd;
    // catch up quickly: up to 3 new scooters per tick
    for (let k = 0; k < 3 && n + k < this.scooterFleet; k++) {
      const route = this.scooterRoutes[Math.floor(Math.random() * this.scooterRoutes.length)];
      const v = this.spawn('scooter', route, this.rng, 0);
      if (v) this.attachRider(v);
    }
  }

  /** Restart: clear all scooters (riders die with zombies.clearAll) and rebuild the fleet. */
  reset(): void {
    this.riddenV = null;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      if (this.vehicles[i].kind === 'scooter') this.removeVehicle(i);
    }
    this.respawnCd = 0;
    if (this.zm && this.scooterRoutes.length) {
      for (let i = 0; i < this.scooterFleet; i++) {
        const route = this.scooterRoutes[Math.floor(Math.random() * this.scooterRoutes.length)];
        const v = this.spawn('scooter', route, this.rng, 0);
        if (v) this.attachRider(v);
      }
    }
  }

  /**
   * Move traffic and resolve collisions. `onPlayerHit` returns true if the
   * damage actually landed (immunity/pause can veto it) — knockback and the
   * crash sound only play on a landed hit.
   */
  update(
    dt: number,
    player: { pos: Vec2; vel: THREE.Vector3 },
    zombies: ZombieManager,
    onPlayerHit: (dmg: number, x: number, z: number, shake: number) => boolean,
  ): void {
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      const spec = SPEC[v.kind];
      v.t += dt;
      v.hitCd = Math.max(0, v.hitCd - dt);
      v.hornCd = Math.max(0, v.hornCd - dt);

      if (v.kind === 'scooter' && v.vstate !== 'route') {
        this.updateIdleScooter(v, dt, i, player);
        continue;
      }

      // hooligan e-scooter riding: wild speed surges, sudden brake-checks
      // and swerving that crosses every lane — straight into traffic, which
      // takes them out (see the mow loop below). They never learned lane
      // discipline and they never will.
      let speed = v.speed;
      let lane = v.laneOff;
      if (v.kind === 'scooter') {
        speed *= 0.35 + 1.15 * Math.abs(Math.sin(v.t * 1.3 + v.phase)); // surge to 1.5×, crawl, surge
        if (Math.sin(v.t * 0.6 + v.phase) > 0.9) speed = 0; // sudden brake-check
        lane += Math.sin(v.t * v.swerveF + v.phase) * v.swerveAmp // whole-lane swerve
          + Math.sin(v.t * 6.1 + v.phase * 3) * 0.35; // handlebars jitter
      }
      v.s += v.dir * speed * dt;
      if (v.s > v.sMax) { v.s = v.sMax; v.dir = -1; }
      else if (v.s < v.sMin) { v.s = v.sMin; v.dir = 1; }

      // pose: centre on the path, offset to the RIGHT of travel direction
      const c = samplePath(v.path, v.s);
      const hx = c.dx * v.dir, hz = c.dz * v.dir;
      const rx = -hz, rz = hx;
      v.group.position.set(c.x + rx * lane, 0, c.z + rz * lane);
      v.group.rotation.y = Math.atan2(hx, hz);

      // zombie rider: welded to the deck, hooligan-grade traffic behaviour
      if (v.kind === 'scooter') {
        if (v.rider && v.rider.state === 'dead') {
          this.dropScooter(v);
          continue;
        }
        if (v.rider) {
          v.anchor.x = v.group.position.x;
          v.anchor.z = v.group.position.z;
          v.anchor.heading = v.group.rotation.y;
          v.rider.mesh.position.set(v.anchor.x, 0.18, v.anchor.z);
          v.rider.mesh.rotation.y = v.anchor.heading;
        }
      }

      // shadow LOD: only vehicles near the player render into the shadow map
      this.setShadow(v, Math.hypot(v.group.position.x - player.pos.x, v.group.position.z - player.pos.z) < 34);

      // collision segment tail -> head (in world space, lane offset applied)
      const t0 = samplePath(v.path, v.s - spec.halfLen);
      const t1 = samplePath(v.path, v.s + spec.halfLen);
      const ax = t0.x + rx * lane, az = t0.z + rz * lane;
      const bx = t1.x + rx * lane, bz = t1.z + rz * lane;

      // the player has to avoid the traffic — except the Flygbussen: the
      // airport coach is a friend, it never hurts or shoves you (E boards it)
      if (!v.flygbuss && v.hitCd <= 0 &&
        distPointSeg(player.pos.x, player.pos.z, ax, az, bx, bz) < spec.halfW + PLAYER.radius + 0.25) {
        v.hitCd = 1.4;
        if (onPlayerHit(spec.playerDmg, c.x, c.z, spec.shake)) {
          const side = Math.sign((player.pos.x - c.x) * rx + (player.pos.z - c.z) * rz) || 1;
          const kick = v.kind === 'scooter' ? 3 : 9;
          player.vel.x += rx * kick * side;
          player.vel.z += rz * kick * side;
          if (v.kind === 'scooter') sfx.bell(); else sfx.crash();
        }
      }

      // trams and buses honk before they reach you; scooters ding annoyingly
      if (v.kind !== 'car' && v.hornCd <= 0) {
        const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const ahead = (dx / d) * hx + (dz / d) * hz;
        if (v.kind === 'scooter') {
          if (d < 9 && d > 0.1) { v.hornCd = 2.2; sfx.bell(); }
        } else if (d < 16 && d > 0.1 && ahead > 0.88) {
          v.hornCd = 3;
          sfx.horn(v.kind === 'tram' ? 'tram' : 'car');
        }
      }

      // traffic mows down zombies — scooter riders included: a hooligan
      // swerving into the bus lane gets taken out, rider and all (kills
      // route through the manager: credit + drops; the dead rider makes
      // the scooter coast away and drop for hijacking). A scooter never
      // mows its OWN rider — everyone else's, yes. Riders cling on through a
      // car's glance (helmet: less damage, one blow per pass), but a bus or
      // tram takes them out outright.
      for (const z of zombies.active) {
        if (z.state === 'dead' || z === v.rider || z.trafficCd > 0) continue;
        if (distPointSeg(z.pos.x, z.pos.z, ax, az, bx, bz) < spec.halfW + ZOMBIE.radius + 0.2) {
          z.trafficCd = 4;
          zombies.damage(z, z.ride ? spec.zombieDmg * 0.3 : spec.zombieDmg,
            rx * 7 + hx * 2, rz * 7 + hz * 2);
        }
      }
    }
    this.refillFleet(dt);
  }
}
