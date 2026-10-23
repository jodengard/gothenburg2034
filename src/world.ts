/**
 * Gothenburg arena built from REAL OpenStreetMap data of the Korsvägen /
 * Gothia Towers district (© OpenStreetMap contributors, ODbL).
 * Road & tram geometry, building footprints and tree positions come from
 * src/mapdata.json (see tools/fetch-map.mjs). No gameplay logic here.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AABB, Vec2, makeAABB, segmentBlocked } from './collision';
import { WORLD } from './config';
import { RNG } from './rng';
import mapdataRaw from './mapdata.json';

export interface ThrowableObject {
  id: number;
  kind: 'cone' | 'bottle' | 'brick' | 'stone';
  pos: Vec2;
  home: Vec2;
  mesh: THREE.Object3D;
  taken: boolean;
}

export interface World {
  colliders: AABB[];
  throwables: ThrowableObject[];
  /** Where the player starts: on Örgrytevägen, looking at the Gothia Towers. */
  playerStart: { x: number; z: number; yaw: number };
  /** Validate a spawn position: inside bounds and not inside/behind geometry. */
  isSpawnValid(x: number, z: number, from: Vec2): boolean;
}

// --- map data types ----------------------------------------------------------

interface Pt { x: number; z: number }
interface RoadWay { id: number; highway: string; name: string | null; lanes?: number; pts: Pt[] }
interface TramWay { id: number; pts: Pt[] }
interface BuildingWay {
  id: number; building: string; name: string | null;
  levels?: number; height?: number; pts: Pt[];
}
interface TreePt { x: number; z: number; r: number }
interface ParkWay { id: number; name: string | null; pts: Pt[] }
interface MapData {
  roads: RoadWay[]; trams: TramWay[]; buildings: BuildingWay[];
  trees: TreePt[]; parks: ParkWay[];
}
const mapdata = mapdataRaw as unknown as MapData;

// --- procedural textures -----------------------------------------------------

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Facade tile: 2x2 windows on a coloured wall, mapped at world scale. */
function facadeTex(wall: string, win: string, lit: number, seed: number): THREE.CanvasTexture {
  const rng = new RNG(seed);
  return canvasTex(64, 64, (g) => {
    g.fillStyle = wall; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = rng.chance(lit) ? '#ffe9b8' : win;
        g.fillRect(i * 32 + 7, j * 32 + 7, 18, 16);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(i * 32 + 7, j * 32 + 21, 18, 2); // sill shadow
      }
    }
  });
}

/** Glass curtain-wall tile: horizontal spandrel bands + vertical mullions. */
function glassTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#39596b'; g.fillRect(0, 0, 64, 64);
    for (let j = 0; j < 4; j++) {
      g.fillStyle = '#7fa8b8'; g.fillRect(0, j * 16 + 2, 64, 10); // vision glass
      g.fillStyle = '#22333d'; g.fillRect(0, j * 16 + 12, 64, 4); // spandrel
    }
    for (let i = 0; i <= 4; i++) { g.fillStyle = '#4a5c64'; g.fillRect(i * 16 - 1, 0, 2, 64); }
  });
}

function noiseTex(base: string, spec: string, n: number, seed: number): THREE.CanvasTexture {
  const rng = new RNG(seed);
  return canvasTex(128, 128, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < n; i++) {
      g.fillStyle = spec;
      g.globalAlpha = rng.range(0.03, 0.12);
      const s = rng.range(2, 14);
      g.fillRect(rng.range(0, 128), rng.range(0, 128), s, s);
    }
    g.globalAlpha = 1;
  });
}

// --- ribbon builder (roads, sidewalks, rails) --------------------------------

class Ribbon {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];

  /** Add a strip along a polyline between lateral offsets w0..w1 (metres). */
  add(pts: Pt[], w0: number, w1: number, y: number): void {
    if (pts.length < 2) return;
    const nrm: Pt[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      nrm.push({ x: dz, z: -dx });
    }
    const off = (p: Pt, n: Pt, w: number): Pt => {
      let ox = p.x + n.x * w, oz = p.z + n.z * w;
      const d = Math.hypot(ox - p.x, oz - p.z);
      const max = Math.abs(w) * 3 + 0.5; // clamp miter spikes at hairpins
      if (d > max) { ox = p.x + (ox - p.x) * (max / d); oz = p.z + (oz - p.z) * (max / d); }
      return { x: ox, z: oz };
    };
    let dist = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const L0 = off(pts[i], nrm[i], w0), R0 = off(pts[i], nrm[i], w1);
      const L1 = off(pts[i + 1], nrm[i + 1], w0), R1 = off(pts[i + 1], nrm[i + 1], w1);
      dist += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
      const u = dist;
      this.pos.push(L0.x, y, L0.z, R0.x, y, R0.z, L1.x, y, L1.z);
      this.pos.push(R0.x, y, R0.z, R1.x, y, R1.z, L1.x, y, L1.z);
      for (let k = 0; k < 6; k++) { this.nor.push(0, 1, 0); this.uv.push(u, 0); }
    }
  }

  build(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

// --- helpers ------------------------------------------------------------------

const ROAD_W: Record<string, number> = {
  secondary: 13, tertiary: 11, unclassified: 9, residential: 7.5,
  service: 5, pedestrian: 4, footway: 2.6, cycleway: 2.2, path: 2, steps: 2.4,
};

function polyInBox(pts: Pt[], m: number): boolean {
  return pts.some((p) => Math.abs(p.x) <= m && Math.abs(p.z) <= m);
}

function clampPts(pts: Pt[], m: number): Pt[] {
  return pts.map((p) => ({ x: Math.max(-m, Math.min(m, p.x)), z: Math.max(-m, Math.min(m, p.z)) }));
}

function bbox(pts: Pt[]) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

function extrudeFootprint(pts: Pt[], h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].z);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, -pts[i].z);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, steps: 1, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // footprint in XZ, height along +Y, world-metre UVs kept
  return g;
}

function footprintCap(pts: Pt[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0].x, -pts[0].z);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, -pts[i].z);
  shape.closePath();
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

/** Walk a polyline yielding {pos, dir} every `step` metres. */
function* walk(pts: Pt[], step: number): Generator<{ x: number; z: number; dx: number; dz: number }> {
  let acc = step * 0.5;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = Math.hypot(b.x - a.x, b.z - a.z);
    if (seg < 1e-6) continue;
    const dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
    acc += seg;
    while (acc >= step) {
      const t = 1 - (acc - step) / seg;
      yield { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dx, dz };
      acc -= step;
    }
  }
}

// --- builder ------------------------------------------------------------------

export function buildWorld(scene: THREE.Scene): World {
  const rng = new RNG(20261023);
  const colliders: AABB[] = [];
  const throwables: ThrowableObject[] = [];
  let tid = 0;

  const H = WORLD.halfSize;
  const root = new THREE.Group();
  scene.add(root);

  const addMesh = (g: THREE.BufferGeometry | null, mat: THREE.Material, cast = false, receive = true): void => {
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    root.add(m);
  };

  // --- materials ---------------------------------------------------------------
  const roadTex = noiseTex('#4a4d52', '#2e3134', 900, 11); roadTex.repeat.set(1 / 24, 1 / 24);
  const walkTex = noiseTex('#9a9892', '#6e6c68', 700, 12); walkTex.repeat.set(1 / 12, 1 / 12);
  const grassTex = noiseTex('#5d7a4e', '#46613b', 800, 13); grassTex.repeat.set(1 / 18, 1 / 18);

  const M = {
    asphalt: new THREE.MeshStandardMaterial({ map: roadTex, color: 0xb8bcc2, roughness: 0.96 }),
    walk: new THREE.MeshStandardMaterial({ map: walkTex, color: 0xc2c0bc, roughness: 0.92 }),
    grass: new THREE.MeshStandardMaterial({ map: grassTex, color: 0xa8b8a0, roughness: 1 }),
    park: new THREE.MeshStandardMaterial({ map: grassTex, color: 0x8aa878, roughness: 1 }),
    marking: new THREE.MeshBasicMaterial({ color: 0xd9d9cc }),
    tramBed: new THREE.MeshStandardMaterial({ color: 0x54585e, roughness: 0.85 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8b9298, metalness: 0.75, roughness: 0.45 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.3 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xffeec0 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6a3b, roughness: 0.85 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa7a49c, roughness: 0.95 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fc0cc, roughness: 0.22, metalness: 0.35, transparent: true, opacity: 0.85 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4c6b3a, roughness: 1, flatShading: true }),
  };

  const facadeDefs: [string, string][] = [
    ['#c9a76a', '#39434c'], ['#d6cbb8', '#3c444c'], ['#a05a4c', '#33393f'],
    ['#6b4f47', '#2f353b'], ['#8a9484', '#373f45'],
  ];
  const facadeMats = facadeDefs.map(([wall, win], i) => {
    const t = facadeTex(wall, win, 0.12, 20 + i);
    t.repeat.set(1 / 7, 1 / 7);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
  });
  const gTex = glassTex(); gTex.repeat.set(1 / 3.6, 1 / 3.6);
  const towerMat = new THREE.MeshStandardMaterial({
    map: gTex, color: 0xbcd4dc, metalness: 0.85, roughness: 0.16, envMapIntensity: 1.5,
  });

  // --- ground + parks ------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  for (const p of mapdata.parks) {
    if (!polyInBox(p.pts, H + 30)) continue;
    addMesh(footprintCap(clampPts(p.pts, H + 40), 0.012), M.park);
  }

  // --- roads, sidewalks, markings --------------------------------------------------
  const roads = mapdata.roads.filter((r) => ROAD_W[r.highway] && polyInBox(r.pts, H + 10));
  const asphalt = new Ribbon();
  const walkRibbon = new Ribbon();
  const markings = new Ribbon();
  const tramBed = new Ribbon();
  const railsL = new Ribbon();
  const railsR = new Ribbon();

  for (const r of roads) {
    const pts = clampPts(r.pts, H + 10);
    const w = ROAD_W[r.highway] ?? 7;
    const hw = w / 2;
    const footway = ['footway', 'cycleway', 'path', 'steps'].includes(r.highway);
    if (footway) {
      walkRibbon.add(pts, hw, -hw, 0.05); // light pavement, not asphalt
    } else {
      asphalt.add(pts, hw, -hw, 0.02);
    }
    if (w >= 7) {
      walkRibbon.add(pts, hw + 2.6, hw, 0.13);
      walkRibbon.add(pts, -hw, -hw - 2.6, 0.13);
    }
    if (r.highway === 'secondary' || r.highway === 'tertiary') {
      // dashed centre line
      for (const s of walk(pts, 9)) {
        const a = 2.6;
        markings.add(
          [{ x: s.x - s.dx * a, z: s.z - s.dz * a }, { x: s.x + s.dx * a, z: s.z + s.dz * a }],
          0.16, -0.16, 0.03,
        );
      }
    }
  }
  addMesh(asphalt.build(), M.asphalt);
  addMesh(walkRibbon.build(), M.walk);
  addMesh(markings.build(), M.marking);

  // --- tram tracks -----------------------------------------------------------------
  const trams = mapdata.trams.filter((t) => polyInBox(t.pts, H + 10));
  for (const t of trams) {
    const pts = clampPts(t.pts, H + 10);
    tramBed.add(pts, 2.1, -2.1, 0.035);
    railsL.add(pts, 0.79, 0.71, 0.09);
    railsR.add(pts, -0.71, -0.79, 0.09);
  }
  addMesh(tramBed.build(), M.tramBed);
  addMesh(railsL.build(), M.rail);
  addMesh(railsR.build(), M.rail);

  // tram stop: platforms + glass shelters where the lines cluster near the crossing
  let stop: { x: number; z: number } | null = null;
  let stopD = { x: 1, z: 0 };
  let best = 1e9;
  for (const t of trams) {
    for (let i = 0; i < t.pts.length - 1; i++) {
      const p = t.pts[i];
      const d = Math.hypot(p.x + 18, p.z - 44); // near the Korsvägen crossing
      if (d < best) {
        best = d; stop = { x: p.x, z: p.z };
        const q = t.pts[i + 1];
        const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        stopD = { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
      }
    }
  }
  if (stop) {
    const nx = -stopD.z, nz = stopD.x;
    for (const s of [-1, 1]) {
      const px = stop.x + nx * s * 4.6, pz = stop.z + nz * s * 4.6;
      const plat = new THREE.Mesh(new THREE.BoxGeometry(11, 0.28, 3), M.walk);
      plat.position.set(px, 0.14, pz);
      plat.rotation.y = Math.atan2(stopD.x, stopD.z);
      plat.receiveShadow = true; plat.castShadow = true;
      root.add(plat);
      colliders.push(makeAABB(px, pz, 11, 3, 0.28));
      const gx = px + nx * s * 0.9, gz = pz + nz * s * 0.9;
      const sh = new THREE.Mesh(new THREE.BoxGeometry(6, 2.3, 1.6), M.glass);
      sh.position.set(gx, 1.29, gz);
      sh.rotation.y = plat.rotation.y;
      sh.castShadow = true;
      root.add(sh);
      colliders.push(makeAABB(gx, gz, 6, 1.6, 2.4));
    }
  }

  // --- buildings (real footprints) ---------------------------------------------------
  const buildings = mapdata.buildings.filter((b) => polyInBox(b.pts, H) && b.pts.length >= 4);
  const facadeGeos: THREE.BufferGeometry[][] = facadeMats.map(() => []);
  const glassGeos: THREE.BufferGeometry[] = [];
  const roofGeos: THREE.BufferGeometry[] = [];
  const towerNames = new Set(['Tower 1', 'Tower 2', 'Tower 3']);

  for (const b of buildings) {
    const pts = clampPts(b.pts, H + 2);
    const bb = bbox(pts);
    const span = Math.max(bb.maxX - bb.minX, bb.maxZ - bb.minZ);
    const isTower = b.name != null && towerNames.has(b.name);
    let h = b.height ?? (b.levels ? b.levels * 3.1 : undefined);
    if (h === undefined) h = span < 9 ? 4 : 14; // small huts vs 6-storey blocks
    h = Math.min(100, Math.max(3, h));
    const g = extrudeFootprint(pts, h);
    if (isTower) glassGeos.push(g);
    else facadeGeos[b.id % facadeMats.length].push(g);
    roofGeos.push(footprintCap(pts, h + 0.06));
    colliders.push(makeAABB(bb.cx, bb.cz, bb.maxX - bb.minX, bb.maxZ - bb.minZ, h));
  }

  // Gothia podium: low glass/concrete base connecting the three towers
  const towers = buildings.filter((b) => b.name && towerNames.has(b.name));
  if (towers.length) {
    const all = towers.flatMap((t) => t.pts);
    const bb = bbox(all);
    const pw = bb.maxX - bb.minX + 14, pd = bb.maxZ - bb.minZ + 26;
    const px = bb.cx + 4, pz = bb.cz + 8;
    const pod = new THREE.Mesh(new THREE.BoxGeometry(pw, 13, pd), towerMat);
    pod.position.set(px, 6.5, pz);
    pod.castShadow = true; pod.receiveShadow = true;
    root.add(pod);
    colliders.push(makeAABB(px, pz, pw, pd, 13));
    // roof mechanical caps on the towers
    for (const t of towers) {
      const tb = bbox(t.pts);
      const th = Math.min(100, Math.max(3, t.height ?? (t.levels ? t.levels * 3.1 : 80)));
      const cap = new THREE.Mesh(new THREE.BoxGeometry(10, 3, 8), M.metal);
      cap.position.set(tb.cx, th + 1.5, tb.cz);
      cap.castShadow = true;
      root.add(cap);
    }
  }

  facadeGeos.forEach((geos, i) => addMesh(mergeGeometries(geos, false), facadeMats[i], true));
  addMesh(mergeGeometries(glassGeos, false), towerMat, true);
  addMesh(mergeGeometries(roofGeos, false), M.roof);

  // --- trees (real positions) ---------------------------------------------------------
  const nearRoad = (x: number, z: number, m: number): boolean => {
    for (const r of roads) {
      const w = (ROAD_W[r.highway] ?? 7) / 2 + m;
      for (const p of r.pts) {
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < w * w) return true;
      }
    }
    return false;
  };
  const inBuilding = (x: number, z: number): boolean => {
    for (const b of buildings) {
      const bb = bbox(b.pts);
      if (x > bb.minX - 1 && x < bb.maxX + 1 && z > bb.minZ - 1 && z < bb.maxZ + 1) return true;
    }
    return false;
  };
  const treePts = mapdata.trees.filter((t) => Math.abs(t.x) < H - 3 && Math.abs(t.z) < H - 3
    && !inBuilding(t.x, t.z) && !nearRoad(t.x, t.z, 1.2));
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 3.4, 5);
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, M.trunk, treePts.length);
  const leaves = new THREE.InstancedMesh(leafGeo, M.leaf, treePts.length);
  trunks.castShadow = leaves.castShadow = true;
  const mtx = new THREE.Matrix4();
  treePts.forEach((t, i) => {
    const s = rng.range(1.7, 2.9);
    mtx.makeScale(1, rng.range(0.8, 1.2), 1).setPosition(t.x, 1.7, t.z);
    trunks.setMatrixAt(i, mtx);
    mtx.makeScale(s, s * rng.range(0.75, 1.1), s).setPosition(t.x, 3.4 + s * 0.45, t.z);
    leaves.setMatrixAt(i, mtx);
    colliders.push(makeAABB(t.x, t.z, 0.7, 0.7, 3));
  });
  root.add(trunks, leaves);

  // --- streetlights along real streets -------------------------------------------------
  const poleGeos: THREE.BufferGeometry[] = [];
  const lampGeos: THREE.BufferGeometry[] = [];
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.2, 6);
  const armGeo = new THREE.BoxGeometry(0.09, 0.09, 1.6);
  const lampGeo = new THREE.SphereGeometry(0.24, 6, 6);
  const lampSide = new THREE.Matrix4();
  for (const r of roads) {
    if (!['secondary', 'tertiary', 'residential'].includes(r.highway)) continue;
    const hw = (ROAD_W[r.highway] ?? 7) / 2;
    let k = 0;
    for (const s of walk(clampPts(r.pts, H - 2), 27)) {
      k++;
      const side = k % 2 === 0 ? 1 : -1;
      const nx = -s.dz * side, nz = s.dx * side;
      const x = s.x + nx * (hw + 1.7), z = s.z + nz * (hw + 1.7);
      if (Math.abs(x) > H - 2 || Math.abs(z) > H - 2 || inBuilding(x, z)) continue;
      const ry = Math.atan2(s.dx, s.dz);
      poleGeos.push(poleGeo.clone().translate(x, 3.1, z));
      lampSide.makeRotationY(ry);
      lampSide.setPosition(x - nx * 0.8, 6.15, z - nz * 0.8);
      poleGeos.push(armGeo.clone().applyMatrix4(lampSide));
      lampGeos.push(lampGeo.clone().translate(x - nx * 1.5, 6.05, z - nz * 1.5));
      colliders.push(makeAABB(x, z, 0.3, 0.3, 6.2));
    }
  }
  addMesh(mergeGeometries(poleGeos, false), M.metal, true);
  addMesh(mergeGeometries(lampGeos, false), M.lamp, false, false);

  // --- parked cars along the streets -----------------------------------------------------
  const carColors = [0x8a2f2f, 0x2f4a8a, 0x9aa0a6, 0x2f6a4a, 0xd8c860, 0x33363b, 0xc8c8c8];
  const carBodyGeos = carColors.map(() => [] as THREE.BufferGeometry[]);
  const carDarkGeos: THREE.BufferGeometry[] = [];
  const bodyGeo = new THREE.BoxGeometry(4.4, 1.0, 1.8);
  const cabGeo = new THREE.BoxGeometry(2.3, 0.62, 1.66);
  const wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8);
  wheelGeo.rotateX(Math.PI / 2);
  let carIdx = 0;
  for (const r of roads) {
    if (!['secondary', 'tertiary', 'residential', 'service'].includes(r.highway)) continue;
    const hw = (ROAD_W[r.highway] ?? 7) / 2;
    if (hw < 2.4) continue;
    let k = 0;
    for (const s of walk(clampPts(r.pts, H - 4), 31)) {
      k++;
      if (k % 2) continue;
      const side = k % 4 === 1 ? 1 : -1;
      const nx = -s.dz * side, nz = s.dx * side;
      const x = s.x + nx * (hw - 1.05), z = s.z + nz * (hw - 1.05);
      if (Math.abs(x) > H - 4 || Math.abs(z) > H - 4 || inBuilding(x, z) || nearRoad(x, z, -1.2)) continue;
      const ry = Math.atan2(s.dx, s.dz) + (k % 8 < 4 ? 0 : Math.PI);
      const rot = new THREE.Matrix4().makeRotationY(ry);
      const place = (g: THREE.BufferGeometry, ox: number, oy: number, oz: number) => {
        const m = rot.clone();
        m.setPosition(x + ox * Math.cos(ry) + oz * Math.sin(ry), oy, z - ox * Math.sin(ry) + oz * Math.cos(ry));
        return g.clone().applyMatrix4(m);
      };
      carBodyGeos[carIdx % carColors.length].push(place(bodyGeo, 0, 0.72, 0));
      carDarkGeos.push(place(cabGeo, -0.15, 1.5, 0));
      for (const [wx, wz] of [[1.45, 0.82], [1.45, -0.82], [-1.45, 0.82], [-1.45, -0.82]] as const) {
        carDarkGeos.push(place(wheelGeo, wx, 0.33, wz));
      }
      const c = Math.abs(Math.cos(ry)) * 4.4 + Math.abs(Math.sin(ry)) * 1.8;
      const sn = Math.abs(Math.sin(ry)) * 4.4 + Math.abs(Math.cos(ry)) * 1.8;
      colliders.push(makeAABB(x, z, c, sn, 1.7));
      carIdx++;
    }
  }
  carBodyGeos.forEach((geos, i) => {
    if (!geos.length) return;
    addMesh(mergeGeometries(geos, false),
      new THREE.MeshStandardMaterial({ color: carColors[i], metalness: 0.55, roughness: 0.35 }), true);
  });
  addMesh(mergeGeometries(carDarkGeos, false), M.dark, true);

  // --- benches, bins, barriers -------------------------------------------------------------
  const benchGeos: THREE.BufferGeometry[] = [];
  const seatGeo = new THREE.BoxGeometry(1.9, 0.09, 0.55);
  const backGeo = new THREE.BoxGeometry(1.9, 0.5, 0.08);
  const binGeos: THREE.BufferGeometry[] = [];
  const binGeo = new THREE.CylinderGeometry(0.32, 0.28, 0.85, 8);
  const bigRoads = roads.filter((r) => ['secondary', 'tertiary'].includes(r.highway));
  for (let i = 0; i < 16; i++) {
    const r = rng.pick(bigRoads.length ? bigRoads : roads);
    const pts = clampPts(r.pts, H - 4);
    const p = pts[Math.floor(rng.range(0, pts.length - 1))];
    const q = pts[Math.floor(rng.range(0, pts.length - 1))];
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const dx = (q.x - p.x) / l, dz = (q.z - p.z) / l;
    const side = rng.chance(0.5) ? 1 : -1;
    const hw = (ROAD_W[r.highway] ?? 7) / 2;
    const x = p.x - dz * side * (hw + 1.5), z = p.z + dx * side * (hw + 1.5);
    if (Math.abs(x) > H - 4 || Math.abs(z) > H - 4 || inBuilding(x, z)) continue;
    const ry = Math.atan2(dx, dz);
    const rot = new THREE.Matrix4().makeRotationY(ry);
    const place = (g: THREE.BufferGeometry, oy: number, oz: number) => {
      const m = rot.clone();
      m.setPosition(x + oz * Math.sin(ry), oy, z + oz * Math.cos(ry));
      return g.clone().applyMatrix4(m);
    };
    if (rng.chance(0.6)) {
      benchGeos.push(place(seatGeo, 0.45, 0), place(backGeo, 0.75, -0.26));
      colliders.push(makeAABB(x, z, 1.9, 0.7, 1));
    } else {
      binGeos.push(binGeo.clone().translate(x, 0.43, z));
      colliders.push(makeAABB(x, z, 0.65, 0.65, 0.85));
    }
  }
  addMesh(mergeGeometries(benchGeos, false), M.wood, true);
  addMesh(mergeGeometries(binGeos, false), M.metal, true);
  // concrete barriers near the tram stop
  if (stop) {
    for (const s of [1, -1]) {
      const x = stop.x + -stopD.z * s * 8, z = stop.z + stopD.x * s * 8;
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), M.concrete);
      b.position.set(x, 0.45, z);
      b.rotation.y = Math.atan2(stopD.x, stopD.z);
      b.castShadow = true;
      root.add(b);
      colliders.push(makeAABB(x, z, 2.4, 0.5, 0.9));
    }
  }

  // --- throwable objects on the pavements ----------------------------------------------------
  const coneGeo = new THREE.ConeGeometry(0.22, 0.55, 8);
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xe0642a, roughness: 0.8 });
  const bottleGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6);
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0x4a8a5a, roughness: 0.4 });
  const brickGeo = new THREE.BoxGeometry(0.24, 0.12, 0.12);
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x9c5a4a, roughness: 0.9 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.14);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x7a7d80, roughness: 0.95 });

  const addThrowable = (kind: ThrowableObject['kind'], x: number, z: number) => {
    let mesh: THREE.Object3D;
    if (kind === 'cone') mesh = new THREE.Mesh(coneGeo, coneMat);
    else if (kind === 'bottle') mesh = new THREE.Mesh(bottleGeo, bottleMat);
    else if (kind === 'brick') mesh = new THREE.Mesh(brickGeo, brickMat);
    else mesh = new THREE.Mesh(stoneGeo, stoneMat);
    mesh.position.set(x, kind === 'cone' ? 0.42 : 0.22, z);
    mesh.castShadow = true;
    root.add(mesh);
    throwables.push({ id: tid++, kind, pos: { x, z }, home: { x, z }, mesh, taken: false });
  };

  const longRoads = roads.filter((r) => r.pts.length > 3 && polyInBox(r.pts, H - 20));
  let guard = 0;
  while (throwables.length < 60 && guard++ < 600 && longRoads.length) {
    const r = rng.pick(longRoads);
    const hw = (ROAD_W[r.highway] ?? 7) / 2;
    const i = Math.floor(rng.range(0, r.pts.length - 1));
    const p = r.pts[i], q = r.pts[i + 1];
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const nx = -(q.z - p.z) / l, nz = (q.x - p.x) / l;
    const side = rng.chance(0.5) ? 1 : -1;
    const x = p.x + nx * side * (hw + 1.3), z = p.z + nz * side * (hw + 1.3);
    if (Math.abs(x) > H - 5 || Math.abs(z) > H - 5 || inBuilding(x, z)) continue;
    addThrowable(rng.weighted(['cone', 'bottle', 'brick', 'stone'] as const, [3, 3, 2, 2]), x, z);
  }

  // --- arena boundary walls (invisible) -------------------------------------------------------
  for (const [x, z, w, d] of [
    [0, -H - 1, H * 2 + 4, 2], [0, H + 1, H * 2 + 4, 2],
    [-H - 1, 0, 2, H * 2 + 4], [H + 1, 0, 2, H * 2 + 4],
  ] as const) {
    colliders.push(makeAABB(x, z, w, d, 20));
  }

  // --- player start: on the street by the crossing, facing the towers -------------------------
  let start = { x: 0, z: 60 };
  let sd = 1e9;
  for (const r of roads.filter((r) => r.name === 'Örgrytevägen' || r.name === 'Korsvägen')) {
    for (const p of r.pts) {
      const d = Math.hypot(p.x - 0, p.z - 70);
      if (d < sd) { sd = d; start = { x: p.x, z: p.z }; }
    }
  }
  const anchor = towers[1] ?? towers[0];
  const ab = anchor ? bbox(anchor.pts) : { cx: 100, cz: -25 };
  const yaw = Math.atan2(-(ab.cx - start.x), -(ab.cz - start.z));

  const isSpawnValid = (x: number, z: number, from: Vec2): boolean => {
    if (Math.abs(x) > H - 4 || Math.abs(z) > H - 4) return false;
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

  return { colliders, throwables, playerStart: { x: start.x, z: start.z, yaw }, isSpawnValid };
}
