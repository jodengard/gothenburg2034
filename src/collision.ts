/** Pure 2D collision utilities. No three.js / DOM dependencies (unit-testable). */

export interface Vec2 {
  x: number;
  z: number;
}

export interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Visual/LOS height in meters. 0 = blocks movement only at ground level (still blocks bullets). */
  height: number;
}

export function makeAABB(cx: number, cz: number, sx: number, sz: number, height = 4): AABB {
  return { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2, height };
}

/** Closest point on AABB to p. */
export function closestPointOnAABB(a: AABB, p: Vec2): Vec2 {
  return {
    x: Math.min(Math.max(p.x, a.minX), a.maxX),
    z: Math.min(Math.max(p.z, a.minZ), a.maxZ),
  };
}

/** Ray-casting point-in-polygon test (2D, any winding, open or closed ring). */
export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Push a circle (center p, radius r) out of an AABB. Returns new center. */
export function resolveCircleAABB(a: AABB, p: Vec2, r: number): Vec2 {
  const qx = closestPointOnAABB(a, p);
  const dx = p.x - qx.x;
  const dz = p.z - qx.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > r * r) return p;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { x: qx.x + (dx / d) * r, z: qx.z + (dz / d) * r };
  }
  // Center inside box: push out along smallest penetration axis.
  const penL = p.x - a.minX + r;
  const penR = a.maxX - p.x + r;
  const penB = p.z - a.minZ + r;
  const penT = a.maxZ - p.z + r;
  const min = Math.min(penL, penR, penB, penT);
  if (min === penL) return { x: a.minX - r, z: p.z };
  if (min === penR) return { x: a.maxX + r, z: p.z };
  if (min === penB) return { x: p.x, z: a.minZ - r };
  return { x: p.x, z: a.maxZ + r };
}

/**
 * Uniform grid index over a static collider set, so a segment only tests the
 * boxes in the cells it actually crosses (Amanatides & Woo DDA). Rebuilt
 * lazily when the collider array identity changes; call
 * invalidateColliderGrid() after mutating the array in place (arena swap).
 */
class ColliderGrid {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array;
  private gen = 0;
  private static SIZE = 12;

  constructor(private readonly colliders: readonly AABB[]) {
    this.stamp = new Int32Array(colliders.length);
    const S = ColliderGrid.SIZE;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const x0 = Math.floor(c.minX / S), x1 = Math.floor(c.maxX / S);
      const z0 = Math.floor(c.minZ / S), z1 = Math.floor(c.maxZ / S);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const k = ColliderGrid.key(cx, cz);
          let arr = this.cells.get(k);
          if (!arr) { arr = []; this.cells.set(k, arr); }
          arr.push(i);
        }
      }
    }
  }

  private static key(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  blocked(o: Vec2, dir: Vec2, maxDist: number): boolean {
    const S = ColliderGrid.SIZE;
    this.gen++;
    const g = this.gen;
    let cx = Math.floor(o.x / S), cz = Math.floor(o.z / S);
    const dx = dir.x * maxDist, dz = dir.z * maxDist; // full segment vector
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDeltaX = adx === 0 ? Infinity : S / adx;
    const tDeltaZ = adz === 0 ? Infinity : S / adz;
    let tMaxX = adx === 0 ? Infinity
      : (dx > 0 ? (cx + 1) * S - o.x : o.x - cx * S) / adx;
    let tMaxZ = adz === 0 ? Infinity
      : (dz > 0 ? (cz + 1) * S - o.z : o.z - cz * S) / adz;
    for (let guard = 0; guard < 4096; guard++) {
      const arr = this.cells.get(ColliderGrid.key(cx, cz));
      if (arr) {
        for (let n = 0; n < arr.length; n++) {
          const i = arr[n];
          if (this.stamp[i] === g) continue;
          this.stamp[i] = g;
          if (rayAABB(o, dir, maxDist, this.colliders[i]) !== null) return true;
        }
      }
      if (tMaxX < tMaxZ) {
        if (tMaxX > 1) break;
        tMaxX += tDeltaX; cx += stepX;
      } else {
        if (tMaxZ > 1) break;
        tMaxZ += tDeltaZ; cz += stepZ;
      }
    }
    return false;
  }
}

let segGrid: ColliderGrid | null = null;
let segGridSrc: readonly AABB[] | null = null;

/** Drop the cached segment grid (colliders were mutated in place). */
export function invalidateColliderGrid(): void {
  segGrid = null;
  segGridSrc = null;
}

/**
 * Segment vs AABB (2D slab method). Returns distance along segment (0..1 scaled to length)
 * of the entry point, or null if no hit within the segment.
 */
export function rayAABB(o: Vec2, dir: Vec2, maxDist: number, a: AABB): number | null {
  let tmin = 0;
  let tmax = maxDist;
  // X slab
  if (Math.abs(dir.x) < 1e-9) {
    if (o.x < a.minX || o.x > a.maxX) return null;
  } else {
    const inv = 1 / dir.x;
    let t1 = (a.minX - o.x) * inv;
    let t2 = (a.maxX - o.x) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  // Z slab
  if (Math.abs(dir.z) < 1e-9) {
    if (o.z < a.minZ || o.z > a.maxZ) return null;
  } else {
    const inv = 1 / dir.z;
    let t1 = (a.minZ - o.z) * inv;
    let t2 = (a.maxZ - o.z) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** True if segment o->o+dir*maxDist is blocked by any collider (line of sight = false). */
export function segmentBlocked(o: Vec2, dir: Vec2, maxDist: number, colliders: readonly AABB[]): boolean {
  // Small sets (unit tests, mini-arenas) are faster to scan linearly.
  if (colliders.length < 96) {
    for (const c of colliders) {
      if (rayAABB(o, dir, maxDist, c) !== null) return true;
    }
    return false;
  }
  if (!segGrid || segGridSrc !== colliders) {
    segGrid = new ColliderGrid(colliders);
    segGridSrc = colliders;
  }
  return segGrid.blocked(o, dir, maxDist);
}

/**
 * Resolve a circle against a list of AABBs (mutates and returns p).
 * Optional `skip` predicate lets callers ignore colliders — e.g. a ridden
 * scooter passes through rideable surfaces (benches, car roofs) it is above.
 */
export function resolveCircleWorld(
  colliders: readonly AABB[], p: Vec2, r: number,
  skip?: (a: AABB) => boolean,
): Vec2 {
  for (const c of colliders) {
    if (skip && skip(c)) continue;
    const np = resolveCircleAABB(c, p, r);
    p.x = np.x;
    p.z = np.z;
  }
  return p;
}

/** Uniform spatial hash for neighbor queries (zombies). */
export class SpatialHash<T extends { pos: Vec2 }> {
  private cells = new Map<string, T[]>();
  constructor(private cellSize = 8) {}

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(item: T): void {
    const k = this.key(item.pos.x, item.pos.z);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }

  /** Items in cells overlapping the query circle. */
  query(p: Vec2, radius: number, out: T[]): T[] {
    out.length = 0;
    const minX = Math.floor((p.x - radius) / this.cellSize);
    const maxX = Math.floor((p.x + radius) / this.cellSize);
    const minZ = Math.floor((p.z - radius) / this.cellSize);
    const maxZ = Math.floor((p.z + radius) / this.cellSize);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const arr = this.cells.get(`${cx},${cz}`);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }
}
