/** Weapon view model attached to the camera: shapes, swing/recoil animation, muzzle flash. */
import * as THREE from 'three';
import { WEAPONS } from './config';

export class ViewModel {
  group = new THREE.Group();
  private weapon: THREE.Group | null = null;
  private muzzle: THREE.PointLight;
  private muzzleSprite: THREE.Mesh;
  private muzzleT = 0;
  private swingT = 0;
  private swingDur = 0.3;
  private reloadT = 0;
  private bobT = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.group.position.set(0.28, -0.26, -0.55);
    this.camera.add(this.group);
    this.muzzle = new THREE.PointLight(0xffcc66, 0, 12);
    this.muzzle.position.set(0.2, -0.15, -1.1);
    this.camera.add(this.muzzle);
    this.muzzleSprite = new THREE.Mesh(
      new THREE.PlaneGeometry(0.35, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.muzzleSprite.position.copy(this.muzzle.position);
    this.muzzleSprite.visible = false;
    this.camera.add(this.muzzleSprite);
  }

  setWeapon(id: string): void {
    if (this.weapon) this.group.remove(this.weapon);
    this.weapon = this.build(id);
    this.group.add(this.weapon);
  }

  private build(id: string): THREE.Group {
    const def = WEAPONS[id];
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const dark = new THREE.MeshLambertMaterial({ color: 0x22252a });
    const add = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
    };
    switch (id) {
      case 'bat':
        add(0.07, 0.07, 0.5, mat, 0, 0, -0.3);
        add(0.11, 0.11, 0.28, mat, 0, 0, -0.62);
        break;
      case 'axe':
        add(0.05, 0.05, 0.55, mat, 0, 0, -0.3);
        add(0.05, 0.22, 0.16, new THREE.MeshLambertMaterial({ color: 0xb0b6bc }), 0, 0.08, -0.6);
        break;
      case 'sword':
        add(0.04, 0.04, 0.7, mat, 0, 0.02, -0.45);
        add(0.14, 0.03, 0.05, dark, 0, 0, -0.12);
        break;
      case 'chainsaw':
        add(0.12, 0.14, 0.3, mat, 0, 0, -0.2);
        add(0.05, 0.06, 0.42, dark, 0, 0.02, -0.5);
        break;
      case 'pistol':
        add(0.06, 0.1, 0.12, dark, 0, -0.07, -0.02);
        add(0.05, 0.07, 0.24, mat, 0, 0.02, -0.14);
        break;
      case 'shotgun':
        add(0.06, 0.07, 0.7, mat, 0, 0.02, -0.35);
        add(0.05, 0.1, 0.14, dark, 0, -0.07, -0.02);
        break;
      case 'ak':
        add(0.06, 0.08, 0.62, mat, 0, 0.02, -0.3);
        add(0.05, 0.18, 0.1, dark, 0, -0.1, -0.18);
        add(0.05, 0.1, 0.14, dark, 0, -0.07, 0.02);
        break;
      case 'bazooka':
        add(0.12, 0.12, 0.9, mat, 0, 0, -0.35);
        add(0.16, 0.16, 0.14, dark, 0, 0, -0.8);
        break;
      default:
        add(0.06, 0.06, 0.5, mat, 0, 0, -0.3);
    }
    return g;
  }

  triggerSwing(dur = 0.3): void {
    this.swingT = dur;
    this.swingDur = dur;
  }

  triggerFire(): void {
    this.muzzleT = 0.06;
    this.muzzle.intensity = 3.2;
    this.muzzleSprite.visible = true;
    this.muzzleSprite.rotation.z = Math.random() * Math.PI;
  }

  triggerReload(dur: number): void {
    this.reloadT = dur;
  }

  update(dt: number, speed: number, firing: boolean): void {
    if (!this.weapon) return;
    this.bobT += dt * (4 + speed * 1.4);
    const bob = Math.sin(this.bobT) * 0.008 * Math.min(1, speed / 4);
    const bob2 = Math.cos(this.bobT * 0.5) * 0.006 * Math.min(1, speed / 4);

    let px = 0.28;
    let py = -0.26 + bob;
    let pz = -0.55;
    let rx = 0;
    let rz = 0;

    if (this.swingT > 0) {
      this.swingT -= dt;
      const t = 1 - Math.max(0, this.swingT) / this.swingDur; // 0..1
      const arc = Math.sin(t * Math.PI);
      rx = -arc * 1.6;
      rz = arc * 0.9;
      pz -= arc * 0.15;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      py -= 0.18;
      rx += 0.5;
    }
    if (firing) {
      pz += 0.05; // recoil kick back
      rx -= 0.08;
    }

    this.group.position.set(px, py + bob2 * 0.3, pz);
    this.group.rotation.set(rx, 0, rz);

    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) {
        this.muzzle.intensity = 0;
        this.muzzleSprite.visible = false;
      }
    }
  }

}
