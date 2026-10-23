// One-off Overpass probe: locate Liseberg, Carlanderska and Berzeliigatan
// around the map centre, print projected arena-relative coordinates.
// Projection (same as fetch-map.mjs): x=(lon-lon0)*M_LON, z=-(lat-lat0)*M_LAT
const LAT0 = 57.69725, LON0 = 11.98775;
const M_LAT = 111320, M_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const proj = (lat, lon) => ({ x: +((lon - LON0) * M_LON).toFixed(1), z: +(-(lat - LAT0) * M_LAT).toFixed(1) });

const Q = `
[out:json][timeout:90];
(
  way["leisure"="theme_park"](around:900,${LAT0},${LON0});
  relation["leisure"="theme_park"](around:900,${LAT0},${LON0});
  nwr["tourism"="theme_park"](around:900,${LAT0},${LON0});
  nwr["name"~"Liseberg",i](around:900,${LAT0},${LON0});
  nwr["name"~"arlanderska|carland",i](around:1600,${LAT0},${LON0});
  nwr["amenity"~"school|college|university|preschool"](around:700,57.69849,11.98207);
  way["name"~"Berzelii",i](around:1600,${LAT0},${LON0});
);
out tags center;
`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'gothenburg2034/1.0 (arcade game dev; contact: jodengard)',
  },
  body: 'data=' + encodeURIComponent(Q),
});
if (!res.ok) { console.error('overpass', res.status, await res.text()); process.exit(1); }
const j = await res.json();
const seen = new Set();
for (const el of j.elements) {
  const t = el.tags || {};
  const key = `${el.type}/${el.id}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const c = el.center ? proj(el.center.lat, el.center.lon)
    : el.bbox ? { x: +(((el.bbox.minlon + el.bbox.maxlon) / 2 - LON0) * M_LON).toFixed(1), z: +(-((el.bbox.minlat + el.bbox.maxlat) / 2 - LAT0) * M_LAT).toFixed(1) }
    : el.lat ? proj(el.lat, el.lon) : null;
  const bb = el.bbox ? ` bbox x[${((el.bbox.minlon - LON0) * M_LON).toFixed(0)}..${((el.bbox.maxlon - LON0) * M_LON).toFixed(0)}] z[${(-(el.bbox.maxlat - LAT0) * M_LAT).toFixed(0)}..${(-(el.bbox.minlat - LAT0) * M_LAT).toFixed(0)}]` : '';
  console.log(`${key} | ${t.name || ''} | ${Object.entries(t).filter(([k]) => /leisure|amenity|tourism|landuse|highway|building/.test(k)).map(([k, v]) => k + '=' + v).join(',')} | center ${c ? c.x + ',' + c.z : '?'}${bb}`);
}
console.log('total', j.elements.length);
