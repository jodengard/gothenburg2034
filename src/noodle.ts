/**
 * The noodle stall by the Expo axis (Shanghai arena).
 * Red canopy, lanterns, a steaming pot — and a resident Lisebergskanin on a
 * stool behind the counter. Eat here and the bunny slurps a bowl of 牛肉麵
 * with you while your health comes back.
 */
import * as THREE from 'three';
import { AABB, makeAABB } from './collision';
import { signTex } from './traffic';

const WOOD = 0x8a5a2b;
const WOOD_DARK = 0x5d3a1a;
const RED = 0x9c2b21;
const RED_BRIGHT = 0xc0392b;
const GOLD = 0xd9a441;
const STEEL = 0x9aa0a6;
const WHITE = 0xf4f1ea;
const PINK = 0xefa7b8;
const NOSE = 0xd9758a;
const DARK = 0x2a2118;
const NOODLE = 0xe8c860;

function mat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}
function glow(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

function box(
  w: number, h: number, d: number, m: THREE.Material,
  x: number, y: number, z: number, rx = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  if (rx) mesh.rotation.x = rx;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 10), m);
  mesh.position.set(x, y, z);
  return mesh;
}

/** Square red-and-gold 麵 sign, Expo-street style. */
function mianSign(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a3231b'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#d9a441'; g.lineWidth = 7; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = '#ffd75e'; g.font = 'bold 92px serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('麵', 64, 72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface NoodleStall {
  group: THREE.Group;
  /** The spot the player stands on to eat, and the yaw that faces the counter. */
  bar: { x: number; z: number; yaw: number };
  colliders: AABB[];
  /** null = idle; 0..1 = eating progress (head dips, chopsticks, shrinking noodles). */
  setEating(p: number | null): void;
  /** Idle ambience (steam, lantern sway, ear twitch) + the eating pose. */
  update(time: number): void;
}

/**
 * Build the stall at (x, z), rotated so the counter faces rotY (local +Z).
 * The eating bunny sits behind the counter and is always visible.
 */
export function buildNoodleStall(x: number, z: number, rotY: number): NoodleStall {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;

  // --- stall shell: counter, canopy, back board -----------------------------
  group.add(box(3.2, 1.0, 1.2, mat(WOOD_DARK), 0, 0.5, 0));            // counter body
  group.add(box(3.5, 0.08, 1.5, mat(WOOD), 0, 1.04, 0));               // counter top
  group.add(box(3.4, 2.0, 0.14, mat(RED), 0, 1.95, -0.7));             // back board
  group.add(box(4.0, 0.14, 2.3, mat(RED_BRIGHT), 0, 2.95, 0));         // canopy
  group.add(box(4.15, 0.1, 0.24, mat(GOLD), 0, 3.02, 1.08));           // gold fascia
  group.add(box(0.12, 2.9, 0.12, mat(WOOD_DARK), -1.85, 1.45, 0.95));  // poles
  group.add(box(0.12, 2.9, 0.12, mat(WOOD_DARK), 1.85, 1.45, 0.95));

  // menu board + big 麵 sign
  const menu = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshBasicMaterial({ map: signTex('牛肉麵 BEEF NOODLES') }),
  );
  menu.position.set(0, 2.42, -0.61);
  group.add(menu);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.05),
    new THREE.MeshBasicMaterial({ map: mianSign() }),
  );
  sign.position.set(-1.15, 2.5, 0.98);
  group.add(sign);

  // hanging lanterns (sway pivots)
  const lanterns: THREE.Group[] = [];
  for (const lx of [-1.45, 1.45]) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, 2.86, 0.72);
    pivot.add(box(0.02, 0.22, 0.02, mat(DARK), 0, -0.11, 0));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), glow(0xff4136));
    head.position.y = -0.42;
    head.scale.y = 1.2;
    pivot.add(head);
    pivot.add(box(0.12, 0.05, 0.12, mat(GOLD), 0, -0.24, 0));
    pivot.add(box(0.1, 0.06, 0.1, mat(GOLD), 0, -0.66, 0));
    group.add(pivot);
    lanterns.push(pivot);
  }

  // --- pot + steam -----------------------------------------------------------
  group.add(cyl(0.34, 0.36, 0.4, mat(STEEL), -1.05, 1.28, 0.05));
  group.add(cyl(0.36, 0.34, 0.05, mat(WOOD_DARK), -1.05, 1.5, 0.05)); // lid rim
  const steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false });
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), steamMat.clone());
    group.add(puff);
    steam.push(puff);
  }

  // --- the bowl (shrinks as the bunny eats) ----------------------------------
  // offset to the bunny's right (world -Z at the shipped rotY) so the arm
  // reads in profile from the player's side instead of pointing at the camera
  const bowlGroup = new THREE.Group();
  bowlGroup.position.set(-0.05, 1.08, -0.27);
  bowlGroup.add(cyl(0.15, 0.11, 0.13, mat(0xe8e4da), 0, 0.065, 0));
  const noodles = cyl(0.125, 0.125, 0.06, mat(NOODLE), 0, 0.13, 0);
  bowlGroup.add(noodles);
  group.add(bowlGroup);

  // --- the eating Lisebergskanin (always resident, animates while eating) ----
  const bunny = new THREE.Group();
  bunny.position.set(0.35, 0, -0.42);
  bunny.add(cyl(0.19, 0.16, 0.42, mat(WOOD_DARK), 0, 0.21, 0)); // stool
  bunny.add(box(0.34, 0.46, 0.28, mat(WHITE), 0, 0.65, 0));     // body
  bunny.add(box(0.13, 0.13, 0.1, mat(WHITE), 0, 0.62, -0.18));  // tail

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.95, 0);
  headPivot.add(box(0.28, 0.26, 0.26, mat(WHITE), 0, 0.13, 0));
  headPivot.add(box(0.15, 0.1, 0.09, mat(WHITE), 0, 0.08, 0.15)); // muzzle
  headPivot.add(box(0.05, 0.04, 0.03, mat(NOSE), 0, 0.12, 0.2));  // nose
  headPivot.add(box(0.045, 0.05, 0.02, mat(DARK), -0.09, 0.18, 0.14));
  headPivot.add(box(0.045, 0.05, 0.02, mat(DARK), 0.09, 0.18, 0.14));
  const earL = new THREE.Group();
  earL.position.set(-0.07, 0.26, 0);
  earL.add(box(0.07, 0.34, 0.05, mat(WHITE), 0, 0.17, 0));
  earL.add(box(0.035, 0.24, 0.012, mat(PINK), 0, 0.16, 0.028));
  const earR = earL.clone();
  earR.position.x = 0.07;
  headPivot.add(earL, earR);
  bunny.add(headPivot);

  // left paw rests on the counter rim; right paw reaches forward with the
  // chopsticks into the bowl (limbs extend +Z, rotation.x lifts/dips them)
  bunny.add(box(0.08, 0.24, 0.08, mat(WHITE), -0.17, 1.12, 0.14, -1.1));
  const armR = new THREE.Group();
  armR.position.set(0.15, 1.18, 0.02); // shoulder above the counter top
  armR.rotation.y = -1.2; // reach across to the bowl on the right
  armR.add(box(0.08, 0.08, 0.24, mat(WHITE), 0, 0, 0.12)); // forearm, forward
  const sticks = new THREE.Group();
  sticks.position.set(-0.05, 0.01, 0.24);
  sticks.rotation.x = 0.15; // tips hover just over the noodles
  sticks.add(box(0.02, 0.02, 0.3, mat(0xd8b48a), -0.025, 0, 0.15));
  sticks.add(box(0.02, 0.02, 0.3, mat(0xc8a47a), 0.025, 0, 0.15));
  armR.add(sticks);
  bunny.add(armR);
  group.add(bunny);

  // --- colliders: the stall body blocks movement (rotated to world frame) ----
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const hw = 1.8, hd = 0.85; // half-extents: along counter / depth
  const ex = Math.abs(cos) * hw + Math.abs(sin) * hd;
  const ez = Math.abs(sin) * hw + Math.abs(cos) * hd;
  const colliders = [makeAABB(x, z, 2 * ex, 2 * ez)];

  // eating spot: in front of the counter (local +Z), facing back (-Z local)
  const bx = x + sin * 1.55;
  const bz = z + cos * 1.55;
  const bar = { x: bx, z: bz, yaw: Math.atan2(sin, cos) };

  let eating: number | null = null;

  return {
    group,
    bar,
    colliders,
    setEating(p) { eating = p; },
    update(time) {
      // steam: three puffs rising on a loop, fading as they climb
      for (let i = 0; i < steam.length; i++) {
        const f = (time * 0.35 + i / steam.length) % 1;
        const p = steam[i];
        p.position.set(-1.05 + Math.sin(time * 2 + i * 2.1) * 0.06, 1.62 + f * 0.75, 0.05);
        p.scale.setScalar(0.7 + f * 1.3);
        (p.material as THREE.MeshBasicMaterial).opacity = 0.24 * (1 - f);
      }
      // lanterns sway
      lanterns[0].rotation.z = Math.sin(time * 1.4) * 0.07;
      lanterns[1].rotation.z = Math.sin(time * 1.4 + 1.7) * 0.07;

      if (eating === null) {
        // idle: ears twitch now and then, bunny looks around a little
        const twitch = Math.max(0, Math.sin(time * 0.9) - 0.92) * 9;
        earL.rotation.z = 0.12 + Math.sin(time * 7) * 0.35 * twitch;
        earR.rotation.z = -0.1 - Math.sin(time * 7.6) * 0.3 * twitch;
        headPivot.rotation.x = Math.sin(time * 0.7) * 0.05;
        headPivot.rotation.y = Math.sin(time * 0.45) * 0.25;
        armR.rotation.x = -0.25;
        noodles.scale.setScalar(1);
      } else {
        // eating: three head-dips per bowl, chopsticks bob, noodles shrink
        const dip = 0.5 * (1 - Math.cos(eating * Math.PI * 6));
        headPivot.rotation.x = dip * 0.62;
        headPivot.rotation.y = -0.35; // nose over the bowl
        earL.rotation.z = 0.1 + dip * 0.35;
        earR.rotation.z = -0.1 - dip * 0.3;
        armR.rotation.x = -0.25 + dip * 0.45; // chopsticks dive with each slurp
        noodles.scale.setScalar(Math.max(0.02, 1 - eating));
      }
    },
  };
}
