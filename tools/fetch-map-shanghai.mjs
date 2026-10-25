// Fetch real OpenStreetMap data around the Shanghai Expo area (Pudong):
// China Pavilion (中华艺术宫), the Expo Axis (世博轴) and the Huangpu River.
// Source: Overpass API (OpenStreetMap contributors, ODbL).
// Output: src/mapdata-shanghai.json (projected to local metres, x east, z south).
import { writeFileSync } from 'node:fs';

// Arena center: the China Pavilion crown plaza. The Huangpu runs past the
// east side; the Expo Axis plaza stretches to the southwest.
const CENTER = { lat: 31.18495, lon: 121.4877 };
const RADIUS = 320;
const WATER_RADIUS = 750; // the Huangpu bends past the north-east edge of the district

const query = `
[out:json][timeout:90];
(
  way["highway"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["building"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["natural"="water"](around:${WATER_RADIUS},${CENTER.lat},${CENTER.lon});
  way["waterway"="riverbank"](around:${WATER_RADIUS},${CENTER.lat},${CENTER.lon});
  way["man_made"="pier"](around:${WATER_RADIUS},${CENTER.lat},${CENTER.lon});
  way["leisure"="park"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  node["natural"="tree"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
);
out geom;
`;

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

let json = null;
for (const url of endpoints) {
  try {
    console.log('trying', url);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'vibes-zombie-game/0.1 (dev map fetch)' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) { console.log('  http', res.status); continue; }
    json = await res.json();
    console.log('  ok:', json.elements.length, 'elements');
    break;
  } catch (e) { console.log('  err', e.message); }
}
if (!json) { console.error('all endpoints failed'); process.exit(1); }

// --- project lon/lat -> local metres (equirectangular around CENTER) ---
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
const proj = (lat, lon) => ({ x: (lon - CENTER.lon) * M_LON, z: -(lat - CENTER.lat) * M_LAT });

const roads = [];
const buildings = [];
const waters = [];
const piers = [];
const parks = [];
const trees = [];

const num = (t, k) => { const v = t?.[k]; if (v === undefined) return undefined; const n = parseFloat(v); return Number.isFinite(n) ? n : undefined; };

for (const el of json.elements) {
  if (el.type === 'node' && el.tags?.natural === 'tree') {
    const p = proj(el.lat, el.lon);
    trees.push({ ...p, r: num(el.tags, 'diameter') ? num(el.tags, 'diameter') / 2 : 2.5 });
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  const isWater = el.tags?.natural === 'water' || el.tags?.waterway === 'riverbank' || el.tags?.man_made === 'pier';
  const LIM = (isWater ? WATER_RADIUS : RADIUS) + 50;
  const pts = el.geometry.map((g) => proj(g.lat, g.lon)).filter((p) => Math.abs(p.x) < LIM && Math.abs(p.z) < LIM);
  if (pts.length < 2) continue;
  const t = el.tags || {};
  if (t.highway) {
    if (t.highway === 'footway' || t.highway === 'path') {
      if (t.bicycle !== 'no' && t.footway === 'sidewalk') continue;
    }
    roads.push({
      id: el.id,
      highway: t.highway,
      name: t.name || null,
      lanes: num(t, 'lanes'),
      width: num(t, 'width'),
      cycleway: t.cycleway || null,
      pts,
    });
  } else if (t.building) {
    const closed = pts[0].x === pts.at(-1).x && pts[0].z === pts.at(-1).z;
    if (!closed) pts.push({ ...pts[0] });
    buildings.push({
      id: el.id,
      building: t.building,
      name: t.name || null,
      levels: num(t, 'building:levels'),
      height: num(t, 'height') || num(t, 'building:height'),
      minHeight: num(t, 'min_height'),
      material: t['building:material'] || null,
      color: t['building:colour'] || null,
      pts,
    });
  } else if (t.natural === 'water' || t.waterway === 'riverbank') {
    waters.push({ id: el.id, name: t.name || null, pts });
  } else if (t.man_made === 'pier') {
    piers.push({ id: el.id, pts });
  } else if (t.leisure === 'park') {
    parks.push({ id: el.id, name: t.name || null, pts });
  }
}

const out = { center: CENTER, radius: RADIUS, roads, buildings, waters, piers, parks, trees };
writeFileSync(new URL('../src/mapdata-shanghai.json', import.meta.url), JSON.stringify(out));
console.log(`roads=${roads.length} buildings=${buildings.length} waters=${waters.length} piers=${piers.length} parks=${parks.length} trees=${trees.length}`);
const named = new Set(roads.map((r) => r.name).filter(Boolean));
console.log('named streets:', [...named].join(', '));
const expo = buildings.filter((b) => /expo|pavilion|中华艺术|世博|arena|梅赛德斯|mercedes/i.test((b.name || '') + (b.building || '')));
console.log('expo-ish:', expo.map((b) => `${b.id}:${b.name || b.building}`).join(', '));
for (const w of waters) {
  const bb = w.pts.reduce((a, p) => ({ minX: Math.min(a.minX, p.x), maxX: Math.max(a.maxX, p.x), minZ: Math.min(a.minZ, p.z), maxZ: Math.max(a.maxZ, p.z) }), { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 });
  console.log(`water ${w.id} "${w.name || ''}" bbox x[${bb.minX.toFixed(0)},${bb.maxX.toFixed(0)}] z[${bb.minZ.toFixed(0)},${bb.maxZ.toFixed(0)}]`);
}
