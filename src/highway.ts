import * as THREE from 'three';
import mapdataRaw from './mapdata.json';
import { WORLD } from './config';

/**
 * The E6 / Lundbyleden motorway that runs past Gårdsmotet, east of Korsvägen.
 * It sits ~230 m outside the arena boundary (the wall is invisible but solid,
 * so the player never reaches it) — pure horizon scenery, exactly like the
 * Carlanderska villa.
 *
 * Rendered fog-free because it lies beyond the fog line: a dark asphalt ribbon
 * plus two counter-flowing streams of head/tail-lights (one additive Points
 * draw call) so it reads as a live motorway on the dusk horizon. ~2 draw calls.
 * Geometry comes from the real OSM motorway/motorway_link polylines, clipped
 * to a radius around the arena so nothing floats past the ground plane edge.
 */

interface Pt { x: number; z: number }
interface MotorwayWay { id: number; highway: string; name: string | null; pts: Pt[] }
interface Raw { motorways?: MotorwayWay[] }
const raw = mapdataRaw as unknown as Raw;
const shift = (p: Pt): Pt => ({ x: p.x - WORLD.centerX, z: p.z - WORLD.centerZ });

/** Keep only the part of each polyline that is near enough to see. */
const VIEW_R = 520;
function clipNear(pts: Pt[]): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of pts) {
    if (Math.hypot(p.x, p.z) <= VIEW_R) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2);
}

const ways: { highway: string; pts: Pt[] }[] = (raw.motorways ?? []).flatMap((w) =>
  clipNear(w.pts.map(shift)).map((pts) => ({ highway: w.highway, pts })),
);

const WIDTH: Record<string, number> = { motorway: 16, trunk: 13, motorway_link: 7, trunk_link: 6 };

/** Cumulative arc-length table for a polyline. */
function cum(pts: Pt[]): { c: number[]; total: number } {
  const c = [0];
  for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { c, total: c[c.length - 1] || 0 };
}

/** Position + perpendicular at arc-length s along a polyline. */
function sample(pts: Pt[], c: number[], s: number): { x: number; z: number; nx: number; nz: number } {
  const sc = Math.max(0, Math.min(c[c.length - 1], s));
  let i = 1;
  while (i < c.length - 1 && c[i] < sc) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = c[i] - c[i - 1] || 1;
  const t = (sc - c[i - 1]) / seg;
  let dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
  return { x: a.x + dx * seg * t, z: a.z + dz * seg * t, nx: -dz, nz: dx };
}

export interface Highway {
  update(dt: number): void;
}

export function buildHighway(scene: THREE.Scene): Highway | null {
  if (ways.length === 0) return null;
  const root = new THREE.Group();
  root.name = 'highway';

  // --- asphalt ribbon: one merged position+index mesh, fog-free --------------
  const pos: number[] = [];
  const indices: number[] = [];
  let vbase = 0;
  for (const w of ways) {
    const pts = w.pts;
    const hw = (WIDTH[w.highway] ?? 12) / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
      const nx = -dz * hw, nz = dx * hw;
      pos.push(pts[i].x + nx, 0.06, pts[i].z + nz);
      pos.push(pts[i].x - nx, 0.06, pts[i].z - nz);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const o = vbase + i * 2;
      indices.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    vbase += pts.length * 2;
  }
  if (vbase === 0) return null;
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setIndex(indices);
  roadGeo.computeVertexNormals();
  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x39404f, roughness: 1, metalness: 0, fog: false, // tinted toward the dusk haze
  });
  root.add(new THREE.Mesh(roadGeo, asphalt));

  // --- flowing head/tail-lights along the through-motorway lanes -------------
  const tables = ways
    .filter((w) => w.highway === 'motorway' || w.highway === 'trunk')
    .map((w) => ({ w, ...cum(w.pts) }))
    .filter((t) => t.total > 40);
  const N = 64;
  const lpos = new Float32Array(N * 3);
  const lcol = new Float32Array(N * 3);
  const state: { t: number; s: number; dir: number; speed: number; lane: number }[] = [];
  const white = new THREE.Color(0xfff2d0), red = new THREE.Color(0xff3a1e);
  for (let i = 0; i < N; i++) {
    const t = tables.length ? i % tables.length : 0;
    const dir = i % 2 === 0 ? 1 : -1;
    const total = tables.length ? tables[t].total : 0;
    state.push({ t, s: Math.random() * total, dir, speed: 22 + Math.random() * 14, lane: dir > 0 ? 3.5 : -3.5 });
    const c = dir > 0 ? white : red;
    lcol[i * 3] = c.r; lcol[i * 3 + 1] = c.g; lcol[i * 3 + 2] = c.b;
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
  lgeo.setAttribute('color', new THREE.BufferAttribute(lcol, 3));
  const lights = new THREE.Points(lgeo, new THREE.PointsMaterial({
    size: 4.2, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.95, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  }));
  lights.frustumCulled = false;
  if (tables.length) root.add(lights);
  scene.add(root);

  return {
    update(dt: number) {
      if (!tables.length) return;
      for (let i = 0; i < N; i++) {
        const st = state[i];
        const tab = tables[st.t];
        st.s += st.dir * st.speed * dt;
        if (st.s > tab.total) st.s = 0;
        else if (st.s < 0) st.s = tab.total;
        const p = sample(tab.w.pts, tab.c, st.s);
        lpos[i * 3] = p.x + p.nx * st.lane;
        lpos[i * 3 + 1] = 0.7;
        lpos[i * 3 + 2] = p.z + p.nz * st.lane;
      }
      (lgeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
  };
}
