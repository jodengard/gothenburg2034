import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from './world.js';

/**
 * Night + Halloween atmosphere layer drawn on top of the base scene:
 *  - a huge low harvest moon and a star dome (fog-free, inside camera far),
 *  - three slow-drifting ground-mist sheets (classic alpha-plane trick),
 *  - warm embers/fireflies drifting over the arena,
 *  - a crackling bonfire with one flickering point light as the night camp.
 * All "volumetrics" are fake quads/points: ~8 draw calls, no shadow cost.
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

function moonTex(): THREE.CanvasTexture {
  return canvasTex(256, 256, (g) => {
    const cx = 128, cy = 128;
    // halo
    const halo = g.createRadialGradient(cx, cy, 55, cx, cy, 128);
    halo.addColorStop(0, 'rgba(255,150,60,0.55)');
    halo.addColorStop(0.55, 'rgba(255,110,40,0.18)');
    halo.addColorStop(1, 'rgba(255,90,30,0)');
    g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
    // disc
    const disc = g.createRadialGradient(cx - 18, cy - 22, 10, cx, cy, 72);
    disc.addColorStop(0, '#ffe9c0');
    disc.addColorStop(0.55, '#ffb45a');
    disc.addColorStop(1, '#f07a28');
    g.fillStyle = disc;
    g.beginPath(); g.arc(cx, cy, 68, 0, Math.PI * 2); g.fill();
    // craters
    g.fillStyle = 'rgba(150,70,20,0.28)';
    for (const [dx, dy, r] of [[-24, -12, 13], [18, 8, 17], [-6, 30, 9], [34, -26, 8], [-34, 22, 7]] as const) {
      g.beginPath(); g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); g.fill();
    }
  });
}

function mistTex(seed: number): THREE.CanvasTexture {
  const rng = mulberry32(seed);
  return canvasTex(256, 256, (g) => {
    for (let i = 0; i < 46; i++) {
      const x = rng() * 256, y = rng() * 256, r = 22 + rng() * 52;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.05 + rng() * 0.07})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

export interface Atmosphere {
  bonfirePos: { x: number; z: number };
  update(dt: number): void;
}

export function buildAtmosphere(scene: THREE.Scene, world: World, moonDir: THREE.Vector3): Atmosphere {
  const root = new THREE.Group();
  root.name = 'atmos';
  scene.add(root);
  const rng = mulberry32(1337);

  // --- harvest moon -----------------------------------------------------------
  // Sits inside the 900 m far plane so buildings depth-occlude it properly.
  const moon = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 150),
    new THREE.MeshBasicMaterial({
      map: moonTex(), transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  moon.position.copy(moonDir).multiplyScalar(760);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -10;
  root.add(moon);

  // --- star dome ----------------------------------------------------------------
  const starPos: number[] = [];
  for (let i = 0; i < 900; i++) {
    const v = new THREE.Vector3(rng() * 2 - 1, rng() * 0.95 + 0.05, rng() * 2 - 1).normalize().multiplyScalar(845);
    starPos.push(v.x, v.y, v.z);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    color: 0xc8d6ff, size: 2.4, sizeAttenuation: false,
    transparent: true, opacity: 0.22, depthWrite: false, fog: false,
  }));
  root.add(stars);

  // --- drifting ground mist -------------------------------------------------------
  const mist: { mesh: THREE.Mesh; speed: number; phase: number }[] = [];
  const mistGeo = new THREE.PlaneGeometry(560, 560);
  for (let i = 0; i < 3; i++) {
    const t = mistTex(900 + i * 77);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    const m = new THREE.Mesh(mistGeo, new THREE.MeshBasicMaterial({
      map: t, color: 0xb6a4b4, transparent: true, opacity: 0.15 - i * 0.035,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, 0.9 + i * 1.1, 0);
    m.renderOrder = 5 + i;
    root.add(m);
    mist.push({ mesh: m, speed: 0.014 + i * 0.006, phase: i * 2.1 });
  }

  // --- embers / fireflies -----------------------------------------------------------
  const EMB = 70;
  const ePos = new Float32Array(EMB * 3);
  const eSeed = new Float32Array(EMB);
  for (let i = 0; i < EMB; i++) {
    ePos[i * 3] = (rng() * 2 - 1) * 122;
    ePos[i * 3 + 1] = 0.4 + rng() * 7;
    ePos[i * 3 + 2] = (rng() * 2 - 1) * 122;
    eSeed[i] = rng() * Math.PI * 2;
  }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  const embers = new THREE.Points(eGeo, new THREE.PointsMaterial({
    color: 0xffa848, size: 0.16, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  root.add(embers);

  // --- bonfire: pick an open spot in front of the player spawn -----------------------
  const start = world.playerStart;
  const fwd = new THREE.Vector3(Math.sin(start.yaw), 0, Math.cos(start.yaw));
  let bx = start.x + 8, bz = start.z + 8; // fallback
  outer: for (let r = 13; r <= 24; r += 2.5) {
    for (let a = -0.6; a <= 0.6; a += 0.3) {
      const x = start.x + fwd.x * r - fwd.z * a * r;
      const z = start.z + fwd.z * r + fwd.x * a * r;
      if (!world.isSpawnValid(x, z, start)) continue;
      if (nearAnyRoute(world, x, z, 6)) continue;
      bx = x; bz = z;
      break outer;
    }
  }
  const fire = new THREE.Group();
  fire.position.set(bx, 0, bz);
  root.add(fire);

  const logGeos: THREE.BufferGeometry[] = [];
  // toNonIndexed: mergeGeometries refuses a mix of indexed/non-indexed inputs
  const logGeo = new THREE.CylinderGeometry(0.09, 0.11, 1.7, 6).toNonIndexed();
  for (let i = 0; i < 5; i++) {
    const g = logGeo.clone();
    g.rotateZ(Math.PI / 2 - 0.5);
    g.rotateY((i / 5) * Math.PI * 2);
    g.translate(0, 0.16, 0);
    logGeos.push(g);
  }
  const stoneGeo = new THREE.DodecahedronGeometry(0.2).toNonIndexed();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    logGeos.push(stoneGeo.clone().translate(Math.cos(a) * 1.15, 0.12, Math.sin(a) * 1.15));
  }
  fire.add(new THREE.Mesh(
    mergeGeometries(logGeos, false),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1, flatShading: true }),
  ));

  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flameMat2 = new THREE.MeshBasicMaterial({
    color: 0xffd888, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 7), flameMat);
  flame.position.y = 0.75;
  const flameCore = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 6), flameMat2);
  flameCore.position.y = 0.55;
  fire.add(flame, flameCore);

  const fireLight = new THREE.PointLight(0xff7a2a, 26, 34, 1.7);
  fireLight.position.y = 1.1;
  fire.add(fireLight);

  let t = 0;
  return {
    bonfirePos: { x: bx, z: bz },
    update(dt: number) {
      t += dt;
      for (const m of mist) {
        m.mesh.position.x = Math.sin(t * m.speed + m.phase) * 26;
        m.mesh.position.z = Math.cos(t * m.speed * 0.8 + m.phase) * 26;
        m.mesh.rotation.z += dt * 0.006 * (m.phase > 0 ? 1 : -1);
      }
      const p = eGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < EMB; i++) {
        let y = p.getY(i) + dt * (0.25 + (i % 5) * 0.06);
        if (y > 8) y = 0.3;
        p.setY(i, y);
        p.setX(i, p.getX(i) + Math.sin(t * 0.7 + eSeed[i]) * dt * 0.5);
      }
      p.needsUpdate = true;
      const fl = 0.85 + Math.sin(t * 11) * 0.1 + Math.sin(t * 23.7) * 0.07 + Math.sin(t * 5.3) * 0.05;
      flame.scale.set(1, fl, 1);
      flameCore.scale.set(1, 1.25 - fl * 0.35, 1);
      fireLight.intensity = 22 + fl * 10;
      stars.rotation.y = t * 0.002;
    },
  };
}

/** True when (x,z) sits within `d` metres of any traffic route (keep fire clear). */
function nearAnyRoute(world: World, x: number, z: number, d: number): boolean {
  for (const route of [...world.tramRoutes, ...world.busRoutes, ...world.carRoutes]) {
    for (const p of route) {
      if (Math.abs(p.x - x) < d && Math.abs(p.z - z) < d) {
        if (Math.hypot(p.x - x, p.z - z) < d) return true;
      }
    }
  }
  return false;
}
