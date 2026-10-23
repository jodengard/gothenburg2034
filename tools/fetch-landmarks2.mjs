// Probe 2: raw lat/lon ground truth for Gothia Towers + Liseberg attractions,
// plus arena-frame positions (arena = raw - (48, -8)).
const LAT0 = 57.69725, LON0 = 11.98775;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const CX = 48, CZ = -8; // WORLD.centerX/centerZ shift
const proj = (lat, lon) => ({
  raw: [ +((lon - LON0) * M_LON).toFixed(0), +(-(lat - LAT0) * M_LAT).toFixed(0) ],
  arena: [ +((lon - LON0) * M_LON - CX).toFixed(0), +(-(lat - LAT0) * M_LAT - CZ).toFixed(0) ],
});

const Q = `
[out:json][timeout:90];
(
  nwr["tourism"="hotel"](around:600,${LAT0},${LON0});
  nwr["tourism"="attraction"](around:700,${LAT0},${LON0});
  nwr["leisure"="amusement_arcade"](around:700,${LAT0},${LON0});
  way["name"="Lisebergs hjulet"](around:700,${LAT0},${LON0});
  nwr["name"~"Balder|Valkyrian|Atmosfear|Thundercoaster|Lisebergssalen|Stora Scenen|Florydorsalen|Parisen|Himlen",i](around:900,${LAT0},${LON0});
  nwr["name"="Carlanderska villan"](around:1600,${LAT0},${LON0});
  way["name"~"Södravägen|Mölndalsvägen|Lisebergallén|Södra Allén",i](around:900,${LAT0},${LON0});
);
out tags center;
`;

let res = null;
for (let i = 0; i < 5; i++) {
  res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gothenburg2034/1.0 (game dev)' },
    body: 'data=' + encodeURIComponent(Q),
  });
  if (res.ok) break;
  const wait = 5000 * 2 ** i;
  console.error(`attempt ${i + 1} -> ${res.status}, retrying in ${wait / 1000}s`);
  await new Promise((r) => setTimeout(r, wait));
}
if (!res || !res.ok) { console.error('overpass failed', res?.status, (await res?.text())?.slice(0, 300)); process.exit(1); }
const j = await res.json();
for (const el of j.elements) {
  const t = el.tags || {};
  const lat = el.center?.lat ?? el.lat ?? (el.bbox ? (el.bbox.minlat + el.bbox.maxlat) / 2 : null);
  const lon = el.center?.lon ?? el.lon ?? (el.bbox ? (el.bbox.minlon + el.bbox.maxlon) / 2 : null);
  if (lat == null) continue;
  const p = proj(lat, lon);
  const kind = t.tourism || t.leisure || t.name || t.highway || '?';
  console.log(`${el.type}/${el.id} | ${t.name || ''} | ${kind}${t.building ? ' bldg' : ''} | raw ${p.raw} | arena ${p.arena}`);
}
console.log('total', j.elements.length);
