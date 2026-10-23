import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync(new URL('../src/mapdata.json', import.meta.url), 'utf8'));
const inBox = (pts, m) => pts.some(p => Math.abs(p.x) <= m && Math.abs(p.z) <= m);
const ctr = pts => [pts.reduce((s, p) => s + p.x, 0) / pts.length, pts.reduce((s, p) => s + p.z, 0) / pts.length];

console.log('=== THE THREE TOWERS + tall buildings in 200m ===');
const h = b => b.height ?? (b.levels ? b.levels * 3.2 : 8);
for (const b of d.buildings.filter(b => inBox(b.pts, 200)).sort((a, b2) => h(b2) - h(a)).slice(0, 18)) {
  const [cx, cz] = ctr(b.pts);
  const xs = b.pts.map(p => p.x), zs = b.pts.map(p => p.z);
  console.log(`${String(h(b)).padStart(5)}m lv=${b.levels ?? '-'} ${String(b.building).padEnd(12)} ${String(b.name ?? '').padEnd(16)} c=(${cx.toFixed(0)},${cz.toFixed(0)}) span=${(Math.max(...xs)-Math.min(...xs)).toFixed(0)}x${(Math.max(...zs)-Math.min(...zs)).toFixed(0)}m pts=${b.pts.length}`);
}

console.log('\n=== roads in 170m by class ===');
for (const r of d.roads.filter(r => inBox(r.pts, 170) && ['primary','secondary','tertiary','residential','unclassified','pedestrian','service'].includes(r.highway))) {
  const [cx, cz] = ctr(r.pts);
  if (Math.abs(cx) > 170 || Math.abs(cz) > 170) continue;
  console.log(`${r.highway.padEnd(12)} ${String(r.name ?? '').padEnd(20)} c=(${cx.toFixed(0)},${cz.toFixed(0)}) lanes=${r.lanes ?? '-'} n=${r.pts.length}`);
}

console.log('\n=== tram ways in 170m ===');
for (const t of d.trams.filter(t => inBox(t.pts, 170))) {
  const a = t.pts[0], b = t.pts.at(-1);
  console.log(`  (${a.x.toFixed(0)},${a.z.toFixed(0)}) -> (${b.x.toFixed(0)},${b.z.toFixed(0)}) n=${t.pts.length}`);
}

console.log('\n=== parks / trees ===');
for (const p of d.parks) { const [cx, cz] = ctr(p.pts); console.log(`  park "${p.name}" c=(${cx.toFixed(0)},${cz.toFixed(0)}) pts=${p.pts.length}`); }
console.log('  trees:', d.trees.length);

console.log('\n=== building stats in 150m ===');
const bs = d.buildings.filter(b => inBox(b.pts, 150));
const byType = {};
for (const b of bs) byType[b.building] = (byType[b.building] ?? 0) + 1;
console.log(byType);
