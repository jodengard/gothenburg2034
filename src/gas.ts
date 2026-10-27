/**
 * Fat-zombie shit clouds: lingering area-denial zones left behind by a
 * boomer's contact detonation. Big translucent puffs swirl, rise and fade;
 * standing inside one chews through player health. The zombies don't mind —
 * they already smell like this.
 */
import * as THREE from 'three';
import { FAT } from './config';
import { Vec2 } from './collision';

interface Puff {
  mesh: THREE.Mesh;
  ang: number; // orbit angle around the cloud center
  rad: number; // orbit radius
  spd: number; // orbit speed (signed: swirl both ways)
  y0: number; // base height
  ph: number; // bob phase
  sc: number; // base scale
}

interface Cloud {
  alive: boolean;
  x: number;
  z: number;
  t: number; // age (s)
  tickT: number; // damage tick countdown
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial; // one per cloud so opacity fades together
  puffs: Puff[];
}

export class GasClouds {
  private clouds: Cloud[] = [];
  private geo = new THREE.SphereGeometry(1, 8, 6);

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < FAT.gas.maxClouds; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: 0x7d9a2e, // sickly swamp-green
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const puffs: Puff[] = [];
      for (let p = 0; p < FAT.gas.puffs; p++) {
        const mesh = new THREE.Mesh(this.geo, mat);
        group.add(mesh);
        puffs.push({ mesh, ang: 0, rad: 0, spd: 0, y0: 0, ph: 0, sc: 1 });
      }
      group.visible = false;
      scene.add(group);
      this.clouds.push({ alive: false, x: 0, z: 0, t: 0, tickT: 0, group, mat, puffs });
    }
  }

  clear(): void {
    for (const c of this.clouds) this.retire(c);
  }

  private retire(c: Cloud): void {
    c.alive = false;
    c.group.visible = false;
    c.mat.opacity = 0;
  }

  /** Drop a fresh cloud; when the sky is full, the oldest one gets replaced. */
  spawn(x: number, z: number): void {
    let c = this.clouds.find((q) => !q.alive);
    if (!c) c = this.clouds.reduce((a, b) => (a.t > b.t ? a : b));
    c.alive = true;
    c.x = x;
    c.z = z;
    c.t = 0;
    c.tickT = FAT.gas.tick; // first burn arrives a tick later
    c.group.position.set(x, 0, z);
    c.group.visible = true;
    for (const p of c.puffs) {
      p.ang = Math.random() * Math.PI * 2;
      p.rad = Math.random() * FAT.gas.radius * 0.72;
      p.spd = (0.12 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : -1);
      p.y0 = 0.5 + Math.random() * 1.7;
      p.ph = Math.random() * Math.PI * 2;
      p.sc = 1.1 + Math.random() * 1.3;
      p.mesh.scale.setScalar(p.sc);
    }
  }

  /** Animate the filth and poison the player. onDamage fires once per tick
   * per cloud the player is standing in. */
  update(dt: number, player: Vec2, onDamage: (dmg: number, x: number, z: number) => void): void {
    for (const c of this.clouds) {
      if (!c.alive) continue;
      c.t += dt;
      const k = c.t / FAT.gas.life;
      if (k >= 1) {
        this.retire(c);
        continue;
      }
      // fade in fast, fade out slow; the cloud spreads as it ages
      c.mat.opacity = 0.34 * (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88);
      c.group.scale.setScalar(1 + k * 0.4);
      for (const p of c.puffs) {
        p.ang += p.spd * dt;
        const rise = k * 1.1; // the filth slowly lifts off the ground
        p.mesh.position.set(
          Math.cos(p.ang) * p.rad,
          p.y0 + Math.sin(c.t * 1.4 + p.ph) * 0.18 + rise,
          Math.sin(p.ang) * p.rad,
        );
      }
      // damage tick
      c.tickT -= dt;
      if (c.tickT <= 0) {
        c.tickT = FAT.gas.tick;
        if (Math.hypot(player.x - c.x, player.z - c.z) < FAT.gas.radius) {
          onDamage(FAT.gas.dps * FAT.gas.tick, c.x, c.z);
        }
      }
    }
  }
}
