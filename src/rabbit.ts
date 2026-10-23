/** The Lisebergskanin — the player's rabbit form while riding a scooter. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHITE = 0xf4f1ea;
const PINK = 0xefa7b8;
const DARK = 0x2a2118;
const NOSE = 0xd9758a;

function box(
  w: number, h: number, d: number, color: number,
  x: number, y: number, z: number, rx = 0, rz = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * Procedural Lisebergskanin in a riding crouch, facing +Z (the scooter's
 * heading direction): long ears swept back, paws on the handlebars, fluffy
 * tail, pink inner ears. One merged vertex-coloured mesh — one draw call.
 */
export function buildLisebergskanin(): THREE.Mesh {
  const parts = [
    // long rabbit feet planted on the deck, toes forward
    box(0.14, 0.10, 0.32, WHITE, -0.12, 0.05, 0.14),
    box(0.14, 0.10, 0.32, WHITE, 0.12, 0.05, 0.14),
    // legs
    box(0.13, 0.30, 0.15, WHITE, -0.12, 0.25, 0.02),
    box(0.13, 0.30, 0.15, WHITE, 0.12, 0.25, 0.02),
    // body, leaning slightly forward
    box(0.38, 0.48, 0.30, WHITE, 0, 0.63, -0.02),
    // arms stretched forward onto the handlebars
    box(0.10, 0.10, 0.36, WHITE, -0.17, 0.76, 0.20, 0.15),
    box(0.10, 0.10, 0.36, WHITE, 0.17, 0.76, 0.20, 0.15),
    // fluffy tail
    box(0.13, 0.13, 0.10, WHITE, 0, 0.55, -0.20),
    // head, muzzle, nose
    box(0.30, 0.28, 0.28, WHITE, 0, 1.00, 0.05),
    box(0.17, 0.13, 0.10, WHITE, 0, 0.94, 0.21),
    box(0.05, 0.04, 0.05, NOSE, 0, 0.98, 0.27),
    // eyes
    box(0.06, 0.08, 0.03, DARK, -0.09, 1.05, 0.20),
    box(0.06, 0.08, 0.03, DARK, 0.09, 1.05, 0.20),
    // long ears swept back and splayed outwards
    box(0.09, 0.46, 0.06, WHITE, -0.10, 1.34, -0.06, -0.30, 0.14),
    box(0.09, 0.46, 0.06, WHITE, 0.10, 1.34, -0.06, -0.30, -0.14),
    // pink inner ears (a hair thicker, so they show on the front face)
    box(0.05, 0.36, 0.062, PINK, -0.10, 1.33, -0.055, -0.30, 0.14),
    box(0.05, 0.36, 0.062, PINK, 0.10, 1.33, -0.055, -0.30, -0.14),
  ];
  const geo = mergeGeometries(parts);
  const mesh = new THREE.Mesh(
    geo ?? new THREE.BoxGeometry(0.4, 1.4, 0.4),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  );
  mesh.castShadow = false;
  return mesh;
}
