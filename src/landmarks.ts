import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD } from './config';

/**
 * Real landmarks that sit just outside the arena boundary (the boundary wall
 * is invisible, so these are visible across it):
 *  - Liseberg, south of the Gothia Towers: the Ferris wheel (Lisebergshjulet),
 *    the AtmosFear drop tower, the red entrance gate, ride pavilions and the
 *    big stage — all at their real OSM positions.
 *  - Carlanderska villan on its hill, west-southwest of Berzeliigatan.
 * Pure scenery: merged geometry, no shadows, ~10 draw calls total.
 * Coordinates are the real OSM points projected into the arena frame.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bake a flat colour into a vertex-colour attribute so many parts can merge. */
function tinted(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function hipRoof(rx: number, rz: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(rx, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, rz / rx);
  g.translate(x, y, z);
  return g;
}

export interface Landmarks {
  update(dt: number): void;
}

export function buildLandmarks(scene: THREE.Scene): Landmarks {
  const root = new THREE.Group();
  root.name = 'landmarks';
  const rnd = mulberry32(17);

  const matSteel = new THREE.MeshStandardMaterial({ color: 0xb9bfc6, metalness: 0.55, roughness: 0.4 });
  const matPaint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 });
  // Carlanderska sits ~330 m past the boundary — beyond the fog line. It is
  // rendered fog-free so it reads as a permanent landmark on the horizon,
  // the way a hilltop villa actually dominates the skyline.
  const matFar = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, fog: false });
  const matGrass = new THREE.MeshStandardMaterial({ color: 0x55743f, roughness: 1, fog: false });
  const matTrunk = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1, flatShading: true });
  // Autumn foliage: white base so per-instance setColorAt provides the palette.
  const matLeaf = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });
  const AUTUMN = [0xd97a2b, 0xc0392b, 0xe0b53c, 0x9a5a1f, 0x6b7a3a, 0xb4622a];

  const paint: THREE.BufferGeometry[] = []; // merged into ONE vertex-coloured mesh
  const far: THREE.BufferGeometry[] = [];   // fog-free Carlanderska, merged
  const steel: THREE.BufferGeometry[] = [];

  // --- Lisebergshjulet: the Ferris wheel at (74, 144), looming over the
  //     south edge of the arena, straight across the road from the towers ---
  const WX = 74, WZ = 144, HUB = 26, R = 21;
  for (const side of [-1.8, 1.8]) steel.push(box(0.9, HUB + 1, 0.9, WX, (HUB + 1) / 2, WZ + side));
  {
    const hub = new THREE.CylinderGeometry(1.1, 1.1, 4, 10);
    hub.rotateX(Math.PI / 2);
    hub.translate(WX, HUB, WZ);
    steel.push(hub);
  }
  const wheel = new THREE.Group();
  {
    const parts: THREE.BufferGeometry[] = [
      new THREE.TorusGeometry(R, 0.45, 6, 40),
      new THREE.TorusGeometry(R * 0.62, 0.3, 5, 28),
    ];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.CylinderGeometry(0.16, 0.16, R * 2, 5);
      s.rotateZ((i * Math.PI) / 12);
      parts.push(s);
    }
    const rimMesh = new THREE.Mesh(mergeGeometries(parts, false)!, matSteel);
    const gond: THREE.BufferGeometry[] = [];
    const cols = [0xe67e22, 0xc0392b, 0x2980b9, 0xf1c40f];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      gond.push(tinted(box(1.7, 1.3, 1.7, Math.cos(a) * R, Math.sin(a) * R, 0), cols[i % 4]));
    }
    const gondMesh = new THREE.Mesh(mergeGeometries(gond, false)!, matPaint);
    wheel.add(rimMesh, gondMesh);
    wheel.position.set(WX, HUB, WZ);
  }
  root.add(wheel);

  // --- AtmosFear drop tower at (132, 220): 70 m of red, the park skyline ----
  paint.push(tinted(box(11, 4, 11, 132, 2, 220), 0x9aa0a6));
  paint.push(tinted(box(3.2, 70, 3.2, 132, 35, 220), 0xb03024));
  paint.push(tinted(box(7.5, 4, 7.5, 132, 69, 220), 0x8b241c));

  // --- The red entrance gate, facing north toward the hotels ----------------
  paint.push(tinted(box(1.3, 9, 1.3, WX - 7, 4.5, 134), 0xa8281e));
  paint.push(tinted(box(1.3, 9, 1.3, WX + 7, 4.5, 134), 0xa8281e));
  paint.push(tinted(box(16.5, 2.6, 1.1, WX, 9.6, 134), 0xa8281e));
  {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    const g = c.getContext('2d')!;
    g.fillStyle = '#a8281e'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#ffffff'; g.font = 'bold 70px Arial';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('LISEBERG', 256, 52);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.4), new THREE.MeshBasicMaterial({ map: t }));
    sign.position.set(WX, 9.6, 133.3);
    sign.rotation.y = Math.PI; // face north (-z), toward the towers
    root.add(sign);
  }

  // --- Ride pavilions at their real spots (tinted tents) --------------------
  const rides: [number, number, number][] = [
    [295, 142, 0x2980b9], [300, 187, 0xf1c40f], [297, 225, 0x27ae60],
    [334, 219, 0xe67e22], [170, 323, 0x8e44ad], [217, 299, 0xc0392b],
  ];
  for (const [x, z, col] of rides) {
    paint.push(tinted(box(9, 4.5, 9, x, 2.25, z), 0xcfc9bd));
    paint.push(tinted(hipRoof(7.6, 7.6, 3.4, x, 6.2, z), col));
  }
  // Stora Scenen — the big stage east of the park
  paint.push(tinted(box(30, 10, 18, 317, 5, 97), 0xd8d3c8));
  paint.push(tinted(box(33, 1.4, 21, 317, 10.7, 97), 0x4a5560));

  // --- Carlanderska villan on its hill at (-427, 266) -----------------------
  const CXc = -427, CZc = 266;
  const hill = new THREE.SphereGeometry(78, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);
  hill.scale(1, 0.38, 1);
  const hillMesh = new THREE.Mesh(hill, matGrass);
  hillMesh.position.set(CXc, -1, CZc);
  root.add(hillMesh);
  far.push(tinted(box(22, 10, 14, CXc, 33, CZc), 0xd9bc53));       // ochre body
  far.push(tinted(hipRoof(16.5, 12.5, 5, CXc, 40.5, CZc), 0x38604a)); // green roof
  far.push(tinted(box(5, 16, 5, CXc + 8, 36, CZc), 0xd9bc53));     // corner tower
  far.push(tinted(hipRoof(4.4, 4.4, 3.4, CXc + 8, 45.7, CZc), 0x38604a));

  if (paint.length) root.add(new THREE.Mesh(mergeGeometries(paint, false)!, matPaint));
  if (far.length) root.add(new THREE.Mesh(mergeGeometries(far, false)!, matFar));
  if (steel.length) root.add(new THREE.Mesh(mergeGeometries(steel, false)!, matSteel));

  // --- Park trees: dense filler inside Liseberg + a ring around the hill ----
  const treePts: [number, number][] = [];
  for (let i = 0; i < 90; i++) {
    const x = -30 + rnd() * 400, z = 135 + rnd() * 250;
    if (Math.hypot(x - WX, z - WZ) < 27) continue;
    if (Math.hypot(x - 132, z - 220) < 12) continue;
    if (rides.some(([rx, rz]) => Math.hypot(x - rx, z - rz) < 11)) continue;
    treePts.push([x, z]);
  }
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2, r = 88 + rnd() * 34;
    treePts.push([CXc + Math.cos(a) * r, CZc + Math.sin(a) * r]);
  }
  {
    const trunkG = new THREE.CylinderGeometry(0.22, 0.3, 3.2, 5);
    trunkG.translate(0, 1.6, 0);
    const leafG = new THREE.ConeGeometry(2.1, 5.4, 6);
    leafG.translate(0, 5.4, 0);
    const trunks = new THREE.InstancedMesh(trunkG, matTrunk, treePts.length);
    const leaves = new THREE.InstancedMesh(leafG, matLeaf, treePts.length);
    const m = new THREE.Matrix4();
    const lc = new THREE.Color();
    treePts.forEach(([x, z], i) => {
      const s = 0.8 + rnd() * 0.7;
      m.makeScale(s, s, s).setPosition(x, 0, z);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      lc.setHex(AUTUMN[Math.floor(rnd() * AUTUMN.length)]);
      leaves.setColorAt(i, lc);
    });
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    root.add(trunks, leaves);
  }

  // 1:2 miniature — the whole park sits closer, consistent with the scaled arena.
  root.scale.setScalar(WORLD.scale);
  scene.add(root);
  return {
    update(dt: number): void {
      wheel.rotation.z += dt * 0.12; // the park never quite closes
    },
  };
}
