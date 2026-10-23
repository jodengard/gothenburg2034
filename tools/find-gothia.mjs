const q = `
[out:json][timeout:30];
(
  nwr["name"~"Gothia",i](57.6,11.8,57.8,12.2);
  nwr["name"="Korsvägen"](57.6,11.8,57.8,12.2);
  nwr["name"~"Sångsvanen|Svanen|Mirror|Tower",i](57.65,11.9,57.75,12.05);
  node["public_transport"="station"](57.65,11.9,57.75,12.05);
  way["railway"="tram"](around:400,57.6953,11.9900);
);
out center;
`;
const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
let j = null;
for (const url of endpoints) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
    });
    if (!res.ok) { console.error(url, 'http', res.status); continue; }
    j = await res.json();
    break;
  } catch (e) { console.error(url, e.message); await new Promise(r => setTimeout(r, 3000)); }
}
if (!j) { console.error('all failed'); process.exit(1); }
for (const el of j.elements) {
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const t = el.tags || {};
  console.log(`${el.type}/${el.id} ${lat?.toFixed(5)},${lon?.toFixed(5)}  ${t.name ?? ''} ${t.building ?? ''} ${t.highway ?? ''} ${t.railway ?? ''} ${t['railway:electrified'] ?? ''} ${t.levels ?? ''} ${t.height ?? ''}`);
}
