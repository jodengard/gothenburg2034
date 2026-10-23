const q = encodeURIComponent('Gothia Towers, Göteborg');
const urls = [
  `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=3`,
  `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent('Korsvägen, Göteborg')}&format=json&limit=5`,
];
for (const u of urls) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'vibes-zombie-dev/0.1 (personal project)' } });
      if (!res.ok) { console.error(u, res.status); await new Promise(r => setTimeout(r, 2500)); continue; }
      const j = await res.json();
      for (const r of j) console.log(`${r.lat},${r.lon}  [${r.type}] ${r.display_name.slice(0, 90)}`);
      break;
    } catch (e) { console.error(e.message); await new Promise(r => setTimeout(r, 2500)); }
  }
  await new Promise(r => setTimeout(r, 1500));
}
