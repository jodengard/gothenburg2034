// Fetch motorway/trunk ways near Korsvägen (the E6/Lundbyleden through Gårda —
// "Gårdsmotet") and append them to src/mapdata.json as `motorways`.
// Source: Overpass API (OpenStreetMap contributors, ODbL).
import { readFileSync, writeFileSync } from 'node:fs';

const CENTER = { lat: 57.69725, lon: 11.98775 };
const RADIUS = 1600; // highway sits outside the 420 m arena pull

const query = `
[out:json][timeout:60];
(
  way["highway"~"^(motorway|trunk|motorway_link|trunk_link)$"](around:${RADIUS},${CENTER.lat},${CENTER.lon});
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

const M_LAT = 111320;
const M_LON = 111320 * Math.cos((CENTER.lat * Math.PI) / 180);
const proj = (lat, lon) => ({ x: (lon - CENTER.lon) * M_LON, z: -(lat - CENTER.lat) * M_LAT });

const motorways = [];
for (const el of json.elements) {
  if (el.type !== 'way' || !el.geometry) continue;
  const pts = el.geometry.map((g) => proj(g.lat, g.lon));
  // keep only ways that actually pass near the arena (within 900 m) so the
  // distant E6 branches don't bloat the file
  const near = pts.some((p) => Math.hypot(p.x - 48, p.z + 8) < 900);
  if (!near) continue;
  const t = el.tags || {};
  motorways.push({ id: el.id, highway: t.highway, name: t.name || null, pts });
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  console.log(t.highway, (t.name || '').padEnd(22), 'x', Math.min(...xs).toFixed(0), Math.max(...xs).toFixed(0),
    'z', Math.min(...zs).toFixed(0), Math.max(...zs).toFixed(0), 'pts', pts.length);
}

const path = new URL('../src/mapdata.json', import.meta.url);
const data = JSON.parse(readFileSync(path, 'utf8'));
data.motorways = motorways;
writeFileSync(path, JSON.stringify(data));
console.log('motorways stored:', motorways.length);
