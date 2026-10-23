import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from './world.js';
import type { Zombie } from './zombie.js';

/**
 * Halloween set dressing:
 *  - jack-o'-lanterns (instanced body + glowing face + stem) scattered over
 *    the arena and ringed around the bonfire,
 *  - cobwebs strung between real streetlight poles,
 *  - glowing zombie eyes: ONE instanced mesh for the whole horde, driven from
 *    head position/facing each frame — the classic night-horde silhouette.
 * ~5 draw calls total; eyes cost one matrix write per eye.
 */

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function faceTex(): THREE.CanvasTexture {
  return canvasTex(128, 104, (g) => {
    g.clearRect(0, 0, 128, 104);
    g.shadowColor = '#ff9a20';
    g.shadowBlur = 14;
    g.fillStyle = '#ffe2a8';
    // eyes
    for (const ex of [30, 98]) {
      g.beginPath();
      g.moveTo(ex, 18); g.lineTo(ex + 22, 44); g.lineTo(ex - 14, 46);
      g.closePath(); g.fill();
    }
    // nose
    g.beginPath(); g.moveTo(64, 46); g.lineTo(74, 62); g.lineTo(54, 62); g.closePath(); g.fill();
    // jagged grin
    g.beginPath();
    g.moveTo(24, 68);
    const teeth = [38, 60, 82, 104];
    for (const tx of teeth) { g.lineTo(tx - 8, 78); g.lineTo(tx, 68); }
    g.lineTo(108, 68); g.lineTo(100, 92); g.lineTo(28, 92);
    g.closePath(); g.fill();
  });
}

function webTex(): THREE.CanvasTexture {
  return canvasTex(128, 128, (g) => {
    g.strokeStyle = 'rgba(225,232,245,0.9)';
    g.lineWidth = 1.6;
    const cx = 4, cy = 4; // corner-anchored web (stretched between pole & wall)
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      g.beginPath(); g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 124, cy + Math.sin(a) * 124);
      g.stroke();
    }
    for (let r = 22; r <= 118; r += 24) {
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * (Math.PI / 2);
        const wob = r * (0.88 + 0.12 * Math.cos(i * 2.1));
        const x = cx + Math.cos(a) * wob, y = cy + Math.sin(a) * wob;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

export interface Halloween {
  update(dt: number, zombies: Zombie[], camPos: THREE.Vector3): void;
}

export function buildHalloween(scene: THREE.Scene, world: World, bonfirePos: { x: number; z: number }): Halloween {
  const root = new THREE.Group();
  root.name = 'halloween';
  scene.add(root);
  const rng = mulberry32(2034);
  const start = world.playerStart;

  // --- jack-o'-lanterns ------------------------------------------------------------
  const spots: { x: number; z: number }[] = [];
  // ring the bonfire — the gathering point
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4;
    const r = 5.5 + rng() * 3;
    const x = bonfirePos.x + Math.cos(a) * r, z = bonfirePos.z + Math.sin(a) * r;
    if (world.isSpawnValid(x, z, start)) spots.push({ x, z });
  }
  // scatter across the district
  let guard = 0;
  while (spots.length < 46 && guard++ < 900) {
    const x = (rng() * 2 - 1) * 118, z = (rng() * 2 - 1) * 118;
    if (!world.isSpawnValid(x, z, start)) continue;
    if (Math.hypot(x - bonfirePos.x, z - bonfirePos.z) < 4) continue;
    spots.push({ x, z });
  }

  const N = spots.length;
  const bodyGeo = new THREE.SphereGeometry(0.34, 12, 9);
  bodyGeo.scale(1, 0.78, 1);
  const faceGeo = new THREE.PlaneGeometry(0.42, 0.34).translate(0, 0.015, 0.315);
  const stemGeo = new THREE.CylinderGeometry(0.045, 0.075, 0.2, 5).translate(0, 0.31, 0);

  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({
    color: 0xd96a12, roughness: 0.55, emissive: 0x421400, emissiveIntensity: 0.85,
  }), N);
  const faces = new THREE.InstancedMesh(faceGeo, new THREE.MeshBasicMaterial({
    map: faceTex(), transparent: true, color: 0xffb45a, depthWrite: false,
  }), N);
  const stems = new THREE.InstancedMesh(stemGeo, new THREE.MeshStandardMaterial({
    color: 0x3f5a26, roughness: 1,
  }), N);
  // instances span the whole arena — the geometry's origin-bound sphere would
  // cull them wrongly; three always-drawn meshes is cheaper than fixing bounds
  bodies.frustumCulled = faces.frustumCulled = stems.frustumCulled = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  spots.forEach((sp, i) => {
    const ry = rng() * Math.PI * 2;
    const sc = 0.8 + rng() * 0.5;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    p.set(sp.x, 0.26 * sc, sp.z);
    s.set(sc, sc, sc);
    m.compose(p, q, s);
    bodies.setMatrixAt(i, m);
    faces.setMatrixAt(i, m);
    stems.setMatrixAt(i, m);
  });
  root.add(bodies, faces, stems);

  // --- cobwebs on streetlight poles ---------------------------------------------------
  const lampPts = world.lamps;
  if (lampPts.length) {
    const webGeos: THREE.BufferGeometry[] = [];
    const webGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const step = Math.max(1, Math.floor(lampPts.length / 10));
    for (let i = 0; i < lampPts.length; i += step) {
      const lp = lampPts[i];
      const g = webGeo.clone();
      const ry = rng() * Math.PI * 2;
      g.rotateY(ry);
      g.translate(lp.x + Math.sin(ry) * 0.7, 4.15 + rng() * 0.5, lp.z + Math.cos(ry) * 0.7);
      webGeos.push(g);
    }
    const merged = webGeos.length ? mergeGeometries(webGeos, false) : null;
    if (merged) {
      root.add(new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
        map: webTex(), transparent: true, opacity: 0.4, color: 0xbfc8dd,
        depthWrite: false, side: THREE.DoubleSide,
      })));
    }
  }

  // --- glowing zombie eyes ---------------------------------------------------------------
  const MAX_EYES = 140;
  const eyes = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xff2d0a }),
    MAX_EYES,
  );
  eyes.frustumCulled = false;
  eyes.count = 0;
  root.add(eyes);

  return {
    update(_dt: number, zombies: Zombie[], camPos: THREE.Vector3) {
      let n = 0;
      for (const z of zombies) {
        if (n >= MAX_EYES - 1) break;
        if (z.state === 'dead') continue;
        const dx = z.pos.x - camPos.x, dz = z.pos.z - camPos.z;
        if (dx * dx + dz * dz > 55 * 55) continue;
        const fx = Math.sin(z.facing), fz = Math.cos(z.facing);
        const rx = Math.cos(z.facing), rz = -Math.sin(z.facing);
        const hx = z.pos.x + fx * 0.16, hz = z.pos.z + fz * 0.16;
        for (const side of [1, -1]) {
          m.makeTranslation(hx + rx * 0.11 * side, 1.6, hz + rz * 0.11 * side);
          eyes.setMatrixAt(n++, m);
        }
      }
      eyes.count = n;
      if (n) eyes.instanceMatrix.needsUpdate = true;
    },
  };
}
