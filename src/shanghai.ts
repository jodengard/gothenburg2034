/**
 * Shanghai Expo arena — a compact riverside map around the Expo Axis (世博轴).
 * The China Pavilion crown rises just outside the north-east wall and the
 * Huangpu River is pulled in to the quay: real bearings from OSM, arcade
 * scale (same compression trick as the Gothenburg highway ribbon).
 * Map data: OpenStreetMap contributors, ODbL (tools/fetch-map-shanghai.mjs).
 */
import * as THREE from 'three';
import mapdataRaw from './mapdata-shanghai.json';
import { AABB, Vec2, makeAABB, segmentBlocked } from './collision';
import { World } from './world';
import { buildFlygbuss } from './traffic';
import { buildNoodleStall } from './noodle';

interface Pt { x: number; z: number }
interface RoadWay { id: number; highway: string; name: string | null; pts: Pt[] }
interface BuildingWay {
  id: number; building: string; name: string | null;
  levels?: number; height?: number; pts: Pt[];
}

const raw = mapdataRaw as unknown as { roads: RoadWay[]; buildings: BuildingWay[] };

/** The arena lives far outside Korsvägen's fog — a second island in the same scene. */
export const SH_ISLAND = { x: 1200, z: 0 };
/** 1:2 miniature, same compression trick as the Gothenburg arena. */
export const SH_SCALE = 0.5;
/** Half-size of the arena: 80 m across — half of Korsvägen's miniature 130 m. */
export const SH_HALF = 40;

// Compress the OSM layer around the island centre so every downstream
// extent, clip and route works in miniature metres.
const data = {
  roads: raw.roads.map((r) => ({ ...r, pts: r.pts.map((p) => ({ x: p.x * SH_SCALE, z: p.z * SH_SCALE })) })),
  buildings: raw.buildings.map((b) => ({ ...b, pts: b.pts.map((p) => ({ x: p.x * SH_SCALE, z: p.z * SH_SCALE })) })),
};

const IX = SH_ISLAND.x;
const S = SH_SCALE;

// --- small helpers -----------------------------------------------------------

/** Local arena x (relative to the island centre) -> miniature world x. */
const X = (x: number): number => x * S + IX;
/** Already-miniature local x (scaled OSM data) -> world x. */
const Xw = (x: number): number => x + IX;

/** Box at WORLD x (callers place with X() for literals, Xw() for scaled data). */
function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x: number, y: number, z: number, rotY = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = rotY;
  return m;
}

/** Longest contiguous stretch of a polyline inside the box (endpoints clamped in). */
function longestInside(pts: Pt[], m: number): Vec2[] {
  let best: Pt[] = [];
  let cur: Pt[] = [];
  for (const p of pts) {
    if (Math.abs(p.x) <= m && Math.abs(p.z) <= m) cur.push(p);
    else { if (cur.length > best.length) best = cur; cur = []; }
  }
  if (cur.length > best.length) best = cur;
  return best.map((p) => ({
    x: Xw(Math.max(-m, Math.min(m, p.x))),
    z: Math.max(-m, Math.min(m, p.z)),
  }));
}

function pathLen(pts: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return s;
}

// --- materials ----------------------------------------------------------------

const M = {
  concrete: new THREE.MeshLambertMaterial({ color: 0x5d6470 }),
  plaza: new THREE.MeshLambertMaterial({ color: 0x7d838c }),
  road: new THREE.MeshLambertMaterial({ color: 0x33373d }),
  quay: new THREE.MeshLambertMaterial({ color: 0x9a9ea6 }),
  water: new THREE.MeshBasicMaterial({ color: 0x2b4a66 }),
  shimmer: new THREE.MeshBasicMaterial({
    color: 0x7fa3c0, transparent: true, opacity: 0.35,
  }),
  pavilion: new THREE.MeshStandardMaterial({ color: 0xa33127, roughness: 0.55, emissive: 0x2c0503 }),
  glassCone: new THREE.MeshStandardMaterial({
    color: 0xd8e6f2, roughness: 0.2, metalness: 0.3, transparent: true,
    opacity: 0.45, side: THREE.DoubleSide,
  }),
  white: new THREE.MeshLambertMaterial({ color: 0xe8ecef }),
  tower: new THREE.MeshStandardMaterial({ color: 0x263341, roughness: 0.3, metalness: 0.55 }),
  osm: new THREE.MeshStandardMaterial({ color: 0x55636f, roughness: 0.6, metalness: 0.25 }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x5a4632 }),
  leaf: new THREE.MeshLambertMaterial({ color: 0x3f6b3a }),
  pole: new THREE.MeshLambertMaterial({ color: 0x3a3f46 }),
  lampHead: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  hull: new THREE.MeshLambertMaterial({ color: 0x2a2f36 }),
  bund: new THREE.MeshBasicMaterial({ color: 0x1a2233, fog: false }),
  bundLit: new THREE.MeshBasicMaterial({ color: 0xffd75e, fog: false, transparent: true, opacity: 0.55 }),
};
const NEON = [0xff3d81, 0x31e0ff, 0x7dff4a, 0xffb13d, 0xc94dff].map(
  (c) => new THREE.MeshBasicMaterial({ color: c }),
);

// --- the arena -----------------------------------------------------------------

export function buildShanghaiWorld(scene: THREE.Scene): World {
  const colliders: AABB[] = [];
  const lamps: Vec2[] = [];
  const root = new THREE.Group();
  scene.add(root);
  const add = (o: THREE.Object3D): void => { root.add(o); };
  const H = SH_HALF;

  // --- ground + Expo Axis plaza ------------------------------------------------
  // The ground stops at the quay line (z = -82); the recessed river fills the rest.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(380 * S, 272 * S), M.concrete);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(IX, 0, 54 * S); // spans z -82..190 (miniature)
  ground.receiveShadow = true;
  add(ground);

  // The Axis boulevard runs SSW → NNE towards the pavilion (real bearing).
  const AXIS = { x: 0.325, z: -0.946 };
  const plazaGeo = new THREE.PlaneGeometry(26 * S, 215 * S);
  plazaGeo.rotateX(-Math.PI / 2); // bake flat, so rotation.y spins it on the ground
  const plaza = new THREE.Mesh(plazaGeo, M.plaza);
  plaza.rotation.y = Math.atan2(AXIS.x, AXIS.z);
  plaza.position.set(X(52), 0.02, 0);
  plaza.receiveShadow = true;
  add(plaza);

  // Sun Valley glass cones — the Expo Axis's signature inverted cones.
  for (const [cx, cz] of [[36, 45], [52, 0], [69, -45]] as const) {
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(9 * S, 2.2 * S, 11 * S, 12, 1, true), M.glassCone);
    cone.position.set(X(cx), 6.2 * S, cz * S);
    add(cone);
    add(box(3.2 * S, 1.2 * S, 3.2 * S, M.white, X(cx), 0.6 * S, cz * S));
    colliders.push(makeAABB(X(cx), cz * S, 3.4 * S, 3.4 * S, 5 * S));
  }

  // --- China Pavilion: the red crown just outside the north-east wall ----------
  // Real relative position (OSM way 206382288), scaled to landmark size.
  const pav = new THREE.Group();
  let py = 0;
  for (const [w, h] of [[64, 13], [88, 13], [112, 13], [136, 13]] as const) {
    const mw = w * S, mh = h * S;
    py += mh / 2;
    const tier = new THREE.Mesh(new THREE.BoxGeometry(mw, mh, mw), M.pavilion);
    tier.position.y = py;
    pav.add(tier);
    py += mh / 2;
  }
  pav.position.set(X(117), 0, -94 * S);
  add(pav);

  // --- Huangpu River at the north edge + quay wall (the arena boundary) --------
  // The water sits in a recessed channel behind the quay: from eye height you
  // look over the wall onto a broad sheet of river instead of a thin sliver.
  const river = new THREE.Mesh(new THREE.PlaneGeometry(760 * S, 292 * S), M.water);
  river.rotation.x = -Math.PI / 2;
  river.position.set(IX, -1.2 * S, (-82 - 146) * S);
  add(river);
  add(box(172 * S, 0.9, 1.6 * S, M.quay, X(0), 0.45, -81.2 * S)); // low quay curb — the water sheet reads over it
  colliders.push(makeAABB(IX, -82.5 * S, 172 * S, 2.5 * S, 20));
  // dusk light on the Huangpu: horizontal shimmer bands across the water
  for (const sz of [-112, -168, -244]) {
    add(box(760 * S, 0.02, 2.6 * S, M.shimmer, X(0), -1.15 * S, sz * S));
  }
  for (const [x, z, w, d] of [
    [0, H + 1, H * 2 + 4, 2], [-H - 1, 0, 2, H * 2 + 4], [H + 1, 0, 2, H * 2 + 4],
  ] as const) {
    colliders.push(makeAABB(Xw(x), z, w, d, 20)); // H is already miniature metres
  }

  // Barges moored on the Huangpu, floating on the recessed waterline.
  for (const [bx, bz, ry] of [[-120, -160, 0.2], [240, -205, -0.35]] as const) {
    add(box(7 * S, 2.4 * S, 20 * S, M.hull, X(bx), -0.3 * S, bz * S, ry));
    add(box(4 * S, 2.2 * S, 4 * S, M.pavilion, X(bx - 1), 1.9 * S, (bz - 7) * S, ry));
    add(box(4.5 * S, 1.6 * S, 8 * S, M.hull, X(bx), 1.7 * S, (bz + 3) * S, ry));
  }

  // The Bund on the far bank: fog-free silhouette with lit strips.
  const bundX = [-260, -185, -110, -30, 55, 140, 225, 310];
  const bundH = [45, 70, 55, 90, 60, 75, 50, 85];
  for (let i = 0; i < bundX.length; i++) {
    const h = bundH[i] * S;
    const t = new THREE.Mesh(new THREE.BoxGeometry(26 * S, h, 26 * S), M.bund);
    t.position.set(X(bundX[i]), h / 2 - 1.2, (-310 - (i % 3) * 22) * S);
    add(t);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7 * S, h * 0.72, 0.7 * S), M.bundLit);
    strip.position.set(X(bundX[i]) + 8 * S, h * 0.45 - 1.2, t.position.z + 13.2 * S);
    add(strip);
  }

  // --- OSM buildings (real footprints, clipped to the arena) -------------------
  for (const b of data.buildings) {
    if (b.building === 'roof') continue; // canopies — the Sun Valley cones stand in
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of b.pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    x0 = Math.max(x0, -H); x1 = Math.min(x1, H);
    z0 = Math.max(z0, -H); z1 = Math.min(z1, H);
    const w = x1 - x0, d = z1 - z0;
    if (w < 3 || d < 3) continue;
    const h = Math.max(8, Math.min(45, (b.levels ? b.levels * 3.2 : b.height) || 14)) * S;
    add(box(w, h, d, M.osm, Xw((x0 + x1) / 2), h / 2, (z0 + z1) / 2));
    colliders.push(makeAABB(Xw((x0 + x1) / 2), (z0 + z1) / 2, w, d, h));
  }

  // --- neon towers along the south/east edges (Shanghai after dusk) ------------
  const towers: [number, number, number, number][] = [
    [-30, 62, 14, 34], [10, 66, 16, 50], [48, 58, 13, 28], [62, 28, 15, 44], [66, -14, 13, 36],
  ];
  towers.forEach(([tx, tz, s, h], i) => {
    const ms = s * S, mh = h * S;
    add(box(ms, mh, ms, M.tower, X(tx), mh / 2, tz * S));
    add(box(0.5 * S, mh * 0.8, 0.5 * S, NEON[i % NEON.length], X(tx - s / 2 - 0.1), mh * 0.5, tz * S));
    add(box(ms + 0.4 * S, 0.8 * S, 0.8 * S, NEON[(i + 2) % NEON.length], X(tx), mh + 0.4 * S, tz * S));
    colliders.push(makeAABB(X(tx), tz * S, ms, ms, mh));
  });

  // --- roads (real OSM ribbons) -------------------------------------------------
  const roadW: Record<string, number> = { secondary: 9, residential: 7, tertiary: 8, service: 5 };
  for (const k in roadW) roadW[k] *= S;
  for (const r of data.roads) {
    const w = roadW[r.highway] ?? 6 * S;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (Math.max(Math.abs(a.x), Math.abs(b.x), Math.abs(a.z), Math.abs(b.z)) > 175 * S) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1) continue;
      add(box(w, 0.05, len, M.road, Xw((a.x + b.x) / 2), 0.025, (a.z + b.z) / 2, Math.atan2(dx, dz)));
    }
  }

  // --- trees + streetlights ------------------------------------------------------
  const treeAt = (x: number, z: number): void => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 3, 6), M.trunk);
    trunk.position.set(X(x), 1.5, z);
    add(trunk);
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(1.7, 0), M.leaf);
    leaf.position.set(X(x), 4, z);
    add(leaf);
    colliders.push(makeAABB(X(x), z, 0.7, 0.7, 3));
  };
  for (const [x, z] of [[-17, 20], [-30, -30], [-43, -80], [-8, 70], [24, -74], [-58, -72], [58, -72], [8, -74]] as const) treeAt(x, z * S);

  for (const [x, z] of [[-24, 16], [-37, -57], [40, 62], [70, -32], [-60, -70], [60, -70]] as const) {
    add(box(0.25, 6, 0.25, M.pole, X(x), 3, z * S));
    add(box(0.5, 0.3, 0.9, M.lampHead, X(x), 6.05, z * S));
    colliders.push(makeAABB(X(x), z * S, 0.3, 0.3, 6));
    lamps.push({ x: X(x), z: z * S });
  }

  // --- the return Flygbussen, parked on the plaza --------------------------------
  const shuttlePos = { x: X(30), z: 52 * S };
  const bus = buildFlygbuss(); // real-size coach: you board it, so it stays player-scale
  bus.position.set(shuttlePos.x, 0, shuttlePos.z);
  bus.rotation.y = 2.4;
  scene.add(bus);

  // --- noodle stall west of the Expo Axis: 牛肉麵 and a resident bunny ----------------
  const stallX = X(26), stallZ = 16 * S;
  const noodle = buildNoodleStall(stallX, stallZ, Math.PI / 2); // real size: you eat at it
  scene.add(noodle.group);
  colliders.push(...noodle.colliders);

  // --- routes: the real 周家渡路 arterial through the arena ----------------------
  const IN = H - 8;
  const zjd = data.roads.filter((r) => r.name === '周家渡路').map((r) => longestInside(r.pts, IN));
  const busRoutes = zjd.filter((p) => pathLen(p) >= 40 * S);
  const carRoutes: Vec2[][] = []; // the service roads sit outside this small arena

  const playerStart = { x: X(52), z: 34 * S, yaw: Math.atan2(-(117 - 52), -(-94 - 34)) };

  const isSpawnValid = (x: number, z: number, from: Vec2): boolean => {
    if (Math.abs(x - IX) > H - 4 || Math.abs(z) > H - 4) return false;
    for (const c of colliders) {
      if (x > c.minX - 1 && x < c.maxX + 1 && z > c.minZ - 1 && z < c.maxZ + 1) return false;
    }
    const dx = x - from.x;
    const dz = z - from.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1) return false;
    const dir = { x: dx / dist, z: dz / dist };
    return !segmentBlocked(from, dir, dist - 1.5, colliders);
  };

  return {
    colliders,
    surfaces: [],
    throwables: [],
    playerStart,
    isSpawnValid,
    tramRoutes: [], // Shanghai runs buses, not trams
    busRoutes,
    carRoutes,
    lamps,
    shuttle: shuttlePos,
    noodle,
  };
}
