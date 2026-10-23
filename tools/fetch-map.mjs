// Fetch real OpenStreetMap data around Gothia Towers / Korsvägen, Gothenburg.
// Source: Overpass API (OpenStreetMap contributors, ODbL).
// Output: src/mapdata.json (projected to local metres, x east, z south).
import { writeFileSync } from 'node:fs';

// Arena center: midway between Korsvägen crossing (57.69702,11.98651) and
// Gothia Towers (57.69748,11.98905) so both sit inside the play area.
const CENTER = { lat: 57.69725, lon: 11.98775 };
const RADIUS = 420;

const query = `
[out:json][timeout:90];
(
  way["highway"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["railway"="tram"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["building"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
  way["natural"="wood"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
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
const trams = [];
const buildings = [];
const woods = [];
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
  const pts = el.geometry.map((g) => proj(g.lat, g.lon)).filter((p) => Math.abs(p.x) < RADIUS + 50 && Math.abs(p.z) < RADIUS + 50);
  if (pts.length < 2) continue;
  const t = el.tags || {};
  if (el.tags?.railway === 'tram') {
    trams.push({ id: el.id, pts });
  } else if (t.highway) {
    if (t.highway === 'footway' || t.highway === 'path') {
      // keep footways only in parks (Slottsskogen side) - skip dense sidewalk noise otherwise
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
  } else if (t.natural === 'wood') {
    woods.push({ id: el.id, pts });
  } else if (t.leisure === 'park') {
    parks.push({ id: el.id, name: t.name || null, pts });
  }
}

const out = { center: CENTER, radius: RADIUS, roads, trams, buildings, woods, parks, trees };
writeFileSync(new URL('../src/mapdata.json', import.meta.url), JSON.stringify(out));
console.log(`roads=${roads.length} trams=${trams.length} buildings=${buildings.length} woods=${woods.length} parks=${parks.length} trees=${trees.length}`);
const named = new Set(roads.map(r => r.name).filter(Boolean));
console.log('named streets:', [...named].join(', '));
const gothia = buildings.filter(b => /gothia|svanen|kongress|hotel/i.test((b.name||'') + (b.building||'')));
console.log('gothia-ish:', gothia.map(b => `${b.id}:${b.name||b.building}`).join(', '));
