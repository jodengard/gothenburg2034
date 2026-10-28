/**
 * Shanghai Expo arena — a compact riverside map around the Expo Axis (世博轴).
 * The China Pavilion crown rises just outside the north-east wall and the
 * Huangpu River is pulled in to the quay: real bearings from OSM, arcade
 * scale (same compression trick as the Gothenburg highway ribbon).
 * Map data: OpenStreetMap contributors, ODbL (tools/fetch-map-shanghai.mjs).
 */
import * as THREE from 'three';
import mapdataRaw from './mapdata-shanghai.json';
import { AABB, Vec2, makeAABB, segmentBlocked, pointInPoly } from './collision';
import { World } from './world';
import { buildFlygbuss } from './traffic';
import { buildNoodleStall } from './noodle';

interface Pt { x: number; z: number }
interface RoadWay { id: number; highway: string; name: string | null; pts: Pt[] }
interface BuildingWay {
  id: number; building: string; name: string | null;
  levels?: number; height?: number; pts: Pt[];
}
interface ParkWay { id: number; name: string | null; pts: Pt[] }

const raw = mapdataRaw as unknown as { roads: RoadWay[]; buildings: BuildingWay[]; parks?: ParkWay[] };

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
  grass: new THREE.MeshLambertMaterial({ color: 0x46653a }),
  grassPatch: new THREE.MeshLambertMaterial({ color: 0x4d6b3e }),
  leafInst: new THREE.MeshLambertMaterial({ color: 0xffffff }), // white: instance colors ARE the leaf color
  canopy: new THREE.MeshStandardMaterial({
    color: 0xeef2f5, roughness: 0.4, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
  }),
  lantern: new THREE.MeshBasicMaterial({ color: 0xe03a34 }),
  lanternGold: new THREE.MeshBasicMaterial({ color: 0xffc94d }),
  poleRed: new THREE.MeshLambertMaterial({ color: 0x7d2320 }),
  wood: new THREE.MeshLambertMaterial({ color: 0x6a4a2a }),
  bikeYellow: new THREE.MeshLambertMaterial({ color: 0xf2b705 }),
  bikeDark: new THREE.MeshLambertMaterial({ color: 0x22262b }),
  stone: new THREE.MeshLambertMaterial({ color: 0x8a8f96 }),
  bin: new THREE.MeshLambertMaterial({ color: 0x2f4a3a }),
};
const NEON = [0xff3d81, 0x31e0ff, 0x7dff4a, 0xffb13d, 0xc94dff].map(
  (c) => new THREE.MeshBasicMaterial({ color: c }),
);

/** Deterministic PRNG: the greening looks identical on every build. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lit shop sign drawn on a canvas — the browser's built-in CJK font renders
 * the characters, so the street reads as Shanghai without shipping any assets.
 */
function signMesh(text: string, w: number, h: number, vertical: boolean, bg: string, fg: string): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = vertical ? 128 : 512;
  cv.height = vertical ? 512 : 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = fg;
  g.lineWidth = 7;
  g.strokeRect(6, 6, cv.width - 12, cv.height - 12);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${vertical ? 92 : 80}px sans-serif`;
  if (vertical) {
    for (let i = 0; i < text.length; i++) g.fillText(text[i], cv.width / 2, (cv.height * (i + 0.5)) / text.length);
  } else {
    g.fillText(text, cv.width / 2, cv.height / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

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

  // --- Shanghai greening & street life: make it feel like home -------------------
  // OSM carries no tree nodes here, so the greenery is procedural but anchored
  // to REAL geometry: plane-tree rows (the 梧桐 of the old concessions) along
  // 周家渡路 and the Expo Axis, 外星公园's actual polygon greened beyond the
  // south wall, azalea beds, red lantern strings and lit Chinese signage.
  const rng = mulberry32(0x51f00d);
  const blocked = (x: number, z: number, m: number): boolean => {
    for (const c of colliders) {
      if (x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m) return true;
    }
    return false;
  };
  const keepOut: [number, number, number][] = [
    [X(30), 52 * S, 7], // parked shuttle — you board it, keep the deck clear
    [X(47.4), -14.2 * S, 4.5], // noodle stall (relocated east of the Axis: clear of the shrub rows)
    [X(52), 34 * S, 4], // player start
  ];
  const clearOf = (x: number, z: number, m: number): boolean =>
    keepOut.every(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) > kr + m);

  // Trees: instanced trunks + canopies — the whole district costs 2 draw calls.
  const treeSpots: { x: number; z: number; s: number; collide: boolean }[] = [];
  const pushTree = (x: number, z: number, s = 1, collide = true): void => {
    if (collide && (Math.abs(x - IX) > H - 2 || Math.abs(z) > H - 2)) collide = false; // beyond the walls: scenery
    if (collide && (blocked(x, z, 1.1) || !clearOf(x, z, 1))) return;
    for (const t of treeSpots) if (Math.hypot(t.x - x, t.z - z) < 2.6) return;
    treeSpots.push({ x, z, s, collide });
    if (collide) colliders.push(makeAABB(x, z, 0.7, 0.7, 3));
  };

  // Walk a polyline at fixed spacing, yielding position + unit direction.
  const walkPolyline = (pts: Vec2[], spacing: number): { x: number; z: number; dx: number; dz: number }[] => {
    const out: { x: number; z: number; dx: number; dz: number }[] = [];
    let acc = spacing * 0.5;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x, az = pts[i - 1].z;
      const dx = pts[i].x - ax, dz = pts[i].z - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const ux = dx / len, uz = dz / len;
      for (let d = acc; d <= len; d += spacing) out.push({ x: ax + ux * d, z: az + uz * d, dx: ux, dz: uz });
      acc = (((acc - len) % spacing) + spacing) % spacing;
    }
    return out;
  };

  // 周家渡路: the real arterial through the arena becomes a plane-tree boulevard
  // (法国梧桐 rows on both sides, grass verge under them).
  const zjdWays = data.roads.filter((r) => r.name === '周家渡路');
  const zjdLine = zjdWays.length ? longestInside(zjdWays[0].pts, H - 5) : [];
  const grassPatchM: THREE.Matrix4[] = [];
  if (zjdLine.length > 1) {
    for (const s of walkPolyline(zjdLine, 5)) {
      const nx = -s.dz, nz = s.dx;
      pushTree(s.x + nx * 3.4, s.z + nz * 3.4);
      pushTree(s.x - nx * 3.4, s.z - nz * 3.4);
      const ang = Math.atan2(s.dx, s.dz);
      for (const side of [1, -1]) {
        grassPatchM.push(
          new THREE.Matrix4().makeRotationY(ang).setPosition(s.x + nx * side * 3.4, 0.014, s.z + nz * side * 3.4),
        );
      }
    }
  }

  // Expo Axis: tree rows flanking the boulevard, lantern poles just inside them.
  const C = { x: X(52), z: 0 };
  const perp = { x: -AXIS.z, z: AXIS.x };
  for (let t = -34; t <= 34.1; t += 6.4) {
    for (const side of [1, -1]) {
      pushTree(C.x + AXIS.x * t + perp.x * side * 8.8, C.z + AXIS.z * t + perp.z * side * 8.8);
    }
  }
  const polePts: { x: number; z: number }[] = [];
  const lanternM: THREE.Matrix4[] = [];
  const capM: THREE.Matrix4[] = [];
  const wireM: THREE.Matrix4[] = [];
  const lanternString = (a: { x: number; z: number }, b: { x: number; z: number }, n: number): void => {
    // the wire itself: a thin stretched box pole-top to pole-top, so the
    // lanterns hang from something instead of floating
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const wm = new THREE.Matrix4().makeRotationY(Math.atan2(b.x - a.x, b.z - a.z));
    wm.multiply(new THREE.Matrix4().makeScale(1, 1, len));
    wm.setPosition((a.x + b.x) / 2, 4.08, (a.z + b.z) / 2);
    wireM.push(wm);
    for (let i = 1; i <= n; i++) {
      const t = i / (n + 1);
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = 4.0 - Math.sin(Math.PI * t) * 0.5; // sag between the poles
      lanternM.push(new THREE.Matrix4().makeScale(1, 0.82, 1).setPosition(x, y, z));
      capM.push(new THREE.Matrix4().setPosition(x, y + 0.16, z));
    }
  };
  for (const side of [1, -1]) {
    const row: { x: number; z: number }[] = [];
    for (let t = -33; t <= 33.1; t += 11) {
      const p = { x: C.x + AXIS.x * t + perp.x * side * 7.2, z: C.z + AXIS.z * t + perp.z * side * 7.2 };
      if (blocked(p.x, p.z, 0.6) || !clearOf(p.x, p.z, 0.8)) continue;
      if (row.length) lanternString(row[row.length - 1], p, 6);
      row.push(p);
      polePts.push(p);
      lamps.push(p);
    }
  }

  // Park benches on the plaza, facing the Axis.
  for (const t of [-17, 0, 17]) {
    const bx = C.x + AXIS.x * t + perp.x * 5.4, bz = C.z + AXIS.z * t + perp.z * 5.4;
    if (blocked(bx, bz, 0.9) || !clearOf(bx, bz, 1)) continue;
    const ry = Math.atan2(AXIS.x, AXIS.z);
    add(box(1.7, 0.09, 0.55, M.wood, bx, 0.46, bz, ry));
    add(box(1.7, 0.5, 0.08, M.wood, bx - Math.sin(ry) * 0.26, 0.72, bz - Math.cos(ry) * 0.26, ry));
    colliders.push(makeAABB(bx, bz, 1.8, 0.75, 1));
  }

  // Azalea beds (杜鹃, the shrub of every Shanghai roundabout) between the
  // plaza trees and ringing the Sun Valley cones.
  const SHRUB = [0x4a7040, 0xc4587a, 0x8a5fb0, 0xc0392b, 0xd07aa0];
  const shrubM: { m: THREE.Matrix4; c: number }[] = [];
  const pushShrub = (x: number, z: number): void => {
    // clearOf also guards the plaza props whose colliders land AFTER this
    // section (the noodle stall was getting buried by the shrub rows)
    if (blocked(x, z, 0.4) || !clearOf(x, z, 0.8)) return;
    const s = 0.7 + rng() * 0.5;
    shrubM.push({
      m: new THREE.Matrix4().makeScale(s, s * (0.7 + rng() * 0.4), s).setPosition(x, 0.42 * s, z),
      c: SHRUB[Math.floor(rng() * SHRUB.length)],
    });
  };
  for (let t = -30.8; t <= 30.9; t += 6.4) {
    for (const side of [1, -1]) {
      pushShrub(C.x + AXIS.x * t + perp.x * side * 8.8, C.z + AXIS.z * t + perp.z * side * 8.8);
    }
  }
  for (const [cx, cz] of [[36, 45], [52, 0], [69, -45]] as const) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.6;
      pushShrub(X(cx) + Math.sin(a) * 3.1, cz * S + Math.cos(a) * 3.1);
    }
  }

  // 外星公园 ("Alien Park", the real OSM polygon south of the arena): grassed
  // with a dense copse. It lies beyond the invisible walls — pure scenery.
  const park = raw.parks?.[0];
  if (park && park.pts.length > 3) {
    const poly = park.pts.map((p) => ({ x: p.x * S, z: p.z * S }));
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const grass = new THREE.Mesh(geo, M.grass);
    grass.position.set(IX, 0.012, 0);
    add(grass);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    let placed = 0, guard = 0;
    while (placed < 30 && guard++ < 500) {
      const px = x0 + rng() * (x1 - x0), pz = z0 + rng() * (z1 - z0);
      if (!pointInPoly({ x: px, z: pz }, poly)) continue;
      pushTree(px + IX, pz, 0.9 + rng() * 0.8, false);
      placed++;
    }
    let shrubs = 0;
    guard = 0;
    while (shrubs < 12 && guard++ < 200) {
      const px = x0 + rng() * (x1 - x0), pz = z0 + rng() * (z1 - z0);
      if (!pointInPoly({ x: px, z: pz }, poly)) continue;
      pushShrub(px + IX, pz);
      shrubs++;
    }
  }

  // Bake the instanced greenery.
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 5);
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, treeSpots.length);
  const leaves = new THREE.InstancedMesh(leafGeo, M.leafInst, treeSpots.length);
  trunks.castShadow = leaves.castShadow = true;
  const mtx = new THREE.Matrix4();
  const col = new THREE.Color();
  const SH_LEAF = [0x4a7040, 0x3f6b3a, 0x5c7d3a, 0x6b8f4a, 0xc9a227, 0xb98f22]; // 梧桐 greens + ginkgo gold
  treeSpots.forEach((t, i) => {
    const s = t.s;
    mtx.makeScale(s, s * (0.85 + rng() * 0.3), s).setPosition(t.x, 1.6 * s, t.z);
    trunks.setMatrixAt(i, mtx);
    const c = s * (1.7 + rng() * 0.7);
    mtx.makeScale(c, c * (0.75 + rng() * 0.35), c).setPosition(t.x, (3.0 + c * 0.5) * s, t.z);
    leaves.setMatrixAt(i, mtx);
    col.setHex(SH_LEAF[Math.floor(rng() * SH_LEAF.length)]);
    leaves.setColorAt(i, col);
  });
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  add(trunks);
  add(leaves);

  if (grassPatchM.length) {
    const pg = new THREE.PlaneGeometry(2.6, 5.6);
    pg.rotateX(-Math.PI / 2);
    const patches = new THREE.InstancedMesh(pg, M.grassPatch, grassPatchM.length);
    grassPatchM.forEach((m, i) => patches.setMatrixAt(i, m));
    add(patches);
  }
  if (shrubM.length) {
    const shrubMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.55, 0), M.leafInst, shrubM.length);
    shrubM.forEach((s, i) => {
      shrubMesh.setMatrixAt(i, s.m);
      shrubMesh.setColorAt(i, col.setHex(s.c));
    });
    if (shrubMesh.instanceColor) shrubMesh.instanceColor.needsUpdate = true;
    add(shrubMesh);
  }
  if (polePts.length) {
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.1, 4.2, 6), M.poleRed, polePts.length);
    const knobs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 6), M.lanternGold, polePts.length);
    polePts.forEach((p, i) => {
      poles.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 2.1, p.z));
      knobs.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 4.25, p.z));
      colliders.push(makeAABB(p.x, p.z, 0.25, 0.25, 4));
    });
    add(poles);
    add(knobs);
  }
  if (lanternM.length) {
    const wires = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.025, 1), M.pole, wireM.length);
    wireM.forEach((m, i) => wires.setMatrixAt(i, m));
    add(wires);
    const bodies = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 8, 6), M.lantern, lanternM.length);
    lanternM.forEach((m, i) => bodies.setMatrixAt(i, m));
    const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.07, 6), M.lanternGold, capM.length);
    capM.forEach((m, i) => caps.setMatrixAt(i, m));
    add(bodies);
    add(caps);
  }

  // Lit Chinese signage on the neon towers, facing the plaza.
  const SIGN_TEXT = ['上海欢迎您', '世博轴', '中华艺术宫', '百货大楼', '世博源'];
  towers.forEach(([tx, tz, s, h], i) => {
    const cxp = X(tx), czp = tz * S, mh = h * S;
    const dx = C.x - cxp, dz = C.z - czp;
    const d = Math.hypot(dx, dz) || 1;
    const m = signMesh(SIGN_TEXT[i], 1.7, 5.8, true, '#a3232b', '#ffd75e');
    m.position.set(cxp + (dx / d) * (s * S / 2 + 0.12), mh * 0.55, czp + (dz / d) * (s * S / 2 + 0.12));
    m.rotation.y = Math.atan2(dx, dz);
    add(m);
  });

  // Green street-name plate (the real Shanghai design) at the 周家渡路 entrance.
  if (zjdLine.length > 1) {
    const p0 = zjdLine[0];
    const sx = p0.x + 2.6, sz = p0.z;
    if (!blocked(sx, sz, 0.5) && clearOf(sx, sz, 0.5)) {
      add(box(0.09, 2.9, 0.09, M.pole, sx, 1.45, sz));
      const plate = signMesh('周家渡路', 2.3, 0.58, false, '#1d5c48', '#f2f5f2');
      plate.position.set(sx, 2.75, sz);
      plate.rotation.y = Math.atan2(C.x - sx, C.z - sz);
      add(plate);
      colliders.push(makeAABB(sx, sz, 0.25, 0.25, 3));
    }
  }

  // A single 茶 lantern-board by the noodle stall — every old street has one.
  const tea = signMesh('茶', 0.85, 1.7, true, '#7a1f1f', '#ffe9b0');
  tea.position.set(X(53), 2.5, -14.2 * S); // hangs over the stall's new counter
  tea.rotation.y = Math.PI / 2 + 0.4;
  add(tea);

  // The Expo Axis canopy: the real OSM roof footprint (skipped as 'roof'
  // above) rebuilt as a floating translucent membrane on white columns —
  // the Sun Valley cones poke right through it, exactly like the real thing.
  {
    const cx0 = Math.max(21 * S, -H + 1), cx1 = Math.min(81 * S, H - 1);
    const cz0 = 39 * S, cz1 = Math.min(96 * S, H - 1);
    add(box(cx1 - cx0, 0.22, cz1 - cz0, M.canopy, (cx0 + cx1) / 2 + IX, 6.9, (cz0 + cz1) / 2));
    for (const [px, pz] of [
      [cx0 + 2.5, cz0 + 2.5], [cx1 - 2.5, cz0 + 2.5], [cx0 + 2.5, cz1 - 2.5], [cx1 - 2.5, cz1 - 2.5],
    ] as const) {
      const x = px + IX;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 6.9, 8), M.white);
      pillar.position.set(x, 3.45, pz);
      add(pillar);
      colliders.push(makeAABB(x, pz, 0.6, 0.6, 7));
    }
  }

  // --- the return Flygbussen, parked on the plaza --------------------------------
  const shuttlePos = { x: X(30), z: 52 * S };
  const bus = buildFlygbuss(); // real-size coach: you board it, so it stays player-scale
  bus.position.set(shuttlePos.x, 0, shuttlePos.z);
  bus.rotation.y = 2.4;
  scene.add(bus);

  // --- noodle stall on the Axis plaza: 牛肉麵 and a resident bunny ------------------
  // relocated east-south of the middle cone, clear of the shrub rows that clipped it
  const stallX = X(47.4), stallZ = -14.2 * S;
  const noodle = buildNoodleStall(stallX, stallZ, Math.PI / 2); // real size: you eat at it
  scene.add(noodle.group);
  colliders.push(...noodle.colliders);

  // --- street life: bus stop, shared bikes, chess tables, litter bins -------------
  const bikePts: { x: number; z: number; ry: number }[] = [];
  const pushBike = (x: number, z: number, ry: number): void => {
    if (blocked(x, z, 0.7) || !clearOf(x, z, 0.8)) return;
    for (const b of bikePts) if (Math.hypot(b.x - x, b.z - z) < 1.15) return;
    bikePts.push({ x, z, ry });
    colliders.push(ry === 0 ? makeAABB(x, z, 0.7, 1.9, 1) : makeAABB(x, z, 1.9, 0.7, 1));
  };

  // A bus stop on 周家渡路 — the 610/786 really stop here, so people wait here.
  if (zjdLine.length > 1) {
    const stops = walkPolyline(zjdLine, 22);
    const st = stops[Math.min(1, stops.length - 1)];
    if (st) {
      const ry = Math.atan2(st.dx, st.dz);
      const fx = Math.sin(ry), fz = Math.cos(ry); // along the road
      const px = Math.cos(ry), pz = -Math.sin(ry); // across the road (shelter's local x)
      for (const side of [1, -1]) {
        const nx = -st.dz * side, nz = st.dx * side; // shelter sits off the carriageway
        const sx = st.x + nx * 6.2, sz = st.z + nz * 6.2;
        if (blocked(sx, sz, 1.2) || !clearOf(sx, sz, 1.2)) continue;
        add(box(3.2, 0.14, 1.7, M.white, sx, 2.5, sz, ry)); // roof
        add(box(3.2, 1.7, 0.1, M.glassCone, sx + nx * 0.78, 1.55, sz + nz * 0.78, ry)); // back
        for (const s of [1, -1]) {
          add(box(0.1, 1.5, 1.7, M.glassCone, sx + px * s * 1.55, 1.5, sz + pz * s * 1.55, ry));
          add(box(0.09, 2.5, 0.09, M.pole, sx + px * s * 1.55 + fx * 0.75, 1.25, sz + pz * s * 1.55 + fz * 0.75));
          add(box(0.09, 2.5, 0.09, M.pole, sx + px * s * 1.55 - fx * 0.75, 1.25, sz + pz * s * 1.55 - fz * 0.75));
        }
        add(box(2.6, 0.09, 0.5, M.wood, sx + nx * 0.4, 0.46, sz + nz * 0.4, ry)); // waiting bench
        const plate = signMesh('周家渡路', 1.9, 0.5, false, '#1d5c48', '#f2f5f2');
        plate.position.set(sx - nx * 1.15, 2.95, sz - nz * 1.15);
        plate.rotation.y = Math.atan2(-nx, -nz); // faces the carriageway
        add(plate);
        // shared bikes parked at the kerb — how half of Shanghai does the last mile
        // (placed BEFORE the panel collider: its axis-aligned box on a skewed
        // road would swallow every parking spot in front of the shelter)
        for (let d = -2.4; d <= 2.4; d += 1.7) pushBike(sx - nx * 1.1 + px * d, sz - nz * 1.1 + pz * d, 0);
        colliders.push(makeAABB(sx + nx * 0.78, sz + nz * 0.78, 3.3, 0.5, 3));
        break;
      }
    }
  }

  // The shared-bike fleet: yellow rows along both sides of the Axis (instanced,
  // 3 draws). The east side dodges the tower fronts; the west side has the room.
  for (let t = -22; t <= 12; t += 4.6) {
    pushBike(C.x + AXIS.x * t + perp.x * 6.3, C.z + AXIS.z * t + perp.z * 6.3, 0);
  }
  for (const t of [-8, -2, 17, 23]) {
    pushBike(C.x + AXIS.x * t - perp.x * 6.3, C.z + AXIS.z * t - perp.z * 6.3, 0);
  }
  if (bikePts.length) {
    const frames = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 1.05), M.bikeYellow, bikePts.length);
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.06, 0.06), M.bikeDark, bikePts.length);
    const wheelG = new THREE.CylinderGeometry(0.33, 0.33, 0.07, 10);
    wheelG.rotateZ(Math.PI / 2); // axle across the bike
    const wheels = new THREE.InstancedMesh(wheelG, M.bikeDark, bikePts.length * 2);
    bikePts.forEach((b, i) => {
      mtx.makeRotationY(b.ry).setPosition(b.x, 0.52, b.z);
      frames.setMatrixAt(i, mtx);
      mtx.makeRotationY(b.ry).setPosition(b.x + Math.sin(b.ry) * 0.46, 0.9, b.z + Math.cos(b.ry) * 0.46);
      bars.setMatrixAt(i, mtx);
      for (let w = 0; w < 2; w++) {
        const off = (w ? 1 : -1) * 0.5;
        mtx.makeRotationY(b.ry).setPosition(b.x + Math.sin(b.ry) * off, 0.33, b.z + Math.cos(b.ry) * off);
        wheels.setMatrixAt(i * 2 + w, mtx);
      }
    });
    frames.castShadow = true;
    add(frames); add(bars); add(wheels);
  }

  // Stone chess tables under the plaza trees — retiree territory, always a crowd.
  // Inset to perp -3.2 so they clear the west bike row (perp -6.3) and the stall.
  const tablePts: { x: number; z: number }[] = [];
  for (const t of [-5.2, 18]) {
    const x = C.x + AXIS.x * t - perp.x * 3.2, z = C.z + AXIS.z * t - perp.z * 3.2;
    if (!blocked(x, z, 1.4) && clearOf(x, z, 1.5)) tablePts.push({ x, z });
  }
  if (tablePts.length) {
    const tables = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.5, 0.72, 10), M.stone, tablePts.length);
    const stools = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.42, 8), M.wood, tablePts.length * 4);
    tablePts.forEach((p, i) => {
      tables.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 0.36, p.z));
      colliders.push(makeAABB(p.x, p.z, 1.15, 1.15, 1));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.5;
        stools.setMatrixAt(i * 4 + k, new THREE.Matrix4().setPosition(p.x + Math.sin(a) * 1.05, 0.21, p.z + Math.cos(a) * 1.05));
      }
    });
    tables.castShadow = true;
    add(tables); add(stools);
  }

  // Litter bins beside every bench and the stall — otherwise the plaza is filthy.
  const binPts: { x: number; z: number }[] = [];
  for (const t of [-17, 0, 17]) {
    const x = C.x + AXIS.x * (t + 1.7) + perp.x * 5.4, z = C.z + AXIS.z * (t + 1.7) + perp.z * 5.4;
    if (!blocked(x, z, 0.5) && clearOf(x, z, 0.6)) binPts.push({ x, z });
  }
  {
    const x = stallX + 2, z = stallZ - 2.6;
    if (!blocked(x, z, 0.5)) binPts.push({ x, z });
  }
  if (binPts.length) {
    const bins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.24, 0.85, 8), M.bin, binPts.length);
    binPts.forEach((p, i) => {
      bins.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, 0.43, p.z));
      colliders.push(makeAABB(p.x, p.z, 0.55, 0.55, 1));
    });
    add(bins);
  }

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
