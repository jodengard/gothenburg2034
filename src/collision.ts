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
  for (const c of colliders) {
    if (rayAABB(o, dir, maxDist, c) !== null) return true;
  }
  return false;
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
