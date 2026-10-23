/** Application startup, main loop, and system wiring. */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PLAYER, WEAPONS, WORLD } from './config';
import { state, resetState, saveHighScore } from './state';
import { buildWorld, World, ThrowableObject } from './world';
import { Player } from './player';
import { WeaponState, rollDrop, RELOAD_TIME } from './weapons';
import { ViewModel } from './viewmodel';
import { ZombieManager, Zombie } from './zombie';
import { PackManager } from './pack';
import { Director } from './director';
import { ProjectileManager } from './projectiles';
import { Fx } from './fx';
import { Hud } from './hud';
import { initAudio, resumeAudio, sfx } from './audio';
import { rng } from './rng';
import { rayAABB } from './collision';
import { TouchControls, isTouchDevice } from './touch';

// --- Menu bootstrap ----------------------------------------------------------
// Registered before any heavy work so a click or keypress during world
// generation is never lost, and so startup crashes become visible instead of
// leaving the player stuck on the (static HTML) main menu.
const btnStart = document.getElementById('btn-start') as HTMLButtonElement;
btnStart.textContent = 'LOADING…';
let ready = false;
let userWantedStart = false;

function showFatal(msg: string): void {
  const fn = (window as unknown as Record<string, unknown>).__bootError as
    | ((m: string) => void)
    | undefined;
  if (fn) fn(msg);
  else console.error(msg);
}

function onMenuActivate(): void {
  if (ready) tryStart();
  else userWantedStart = true;
}
document.getElementById('menu')!.addEventListener('click', onMenuActivate);
document.addEventListener('keydown', (e) => {
  if (!ready && (e.code === 'Enter' || e.code === 'Space')) userWantedStart = true;
});

// --- Renderer / scene -------------------------------------------------------
// Android Chrome releases the previous page's WebGL context asynchronously on
// reload, and reclaims contexts from backgrounded tabs (very visible with many
// tabs open). Creation can therefore fail transiently — retry a few times.
function createRenderer(): THREE.WebGLRenderer {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return new THREE.WebGLRenderer({ antialias: true });
    } catch (e) {
      lastErr = e;
      const until = performance.now() + 400; // let the GPU process free contexts
      while (performance.now() < until) { /* short blocking wait, only on failure */ }
    }
  }
  throw lastErr;
}

let renderer: THREE.WebGLRenderer;
try {
  renderer = createRenderer();
} catch {
  showFatal('Could not start 3D graphics (WebGL). You likely have too many tabs open — close a few and reload.');
  throw new Error('WebGL unavailable');
}

// If Chrome reclaims our context mid-session the canvas goes white; detect it,
// stop rendering and offer a one-tap reload instead of a silent white screen.
let contextLost = false;
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  contextLost = true;
  const id = 'ctx-lost';
  if (!document.getElementById(id)) {
    const d = document.createElement('div');
    d.id = id;
    d.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:99;display:flex;' +
      'flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;' +
      'font-family:sans-serif;text-align:center;padding:28px;cursor:pointer';
    d.innerHTML = '<div style="font-size:22px;font-weight:bold">Graphics were interrupted</div>' +
      '<div style="opacity:.85;max-width:340px;line-height:1.5">Your browser reclaimed the 3D graphics ' +
      '— usually caused by having many tabs open. Close a few tabs, then tap the button.</div>' +
      '<div style="padding:14px 30px;background:#c0392b;border-radius:8px;font-weight:bold">TAP TO RELOAD</div>';
    d.addEventListener('click', () => location.reload());
    document.body.appendChild(d);
  }
});
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 900);
scene.add(camera);
scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);

// --- Sky, environment reflections, sun ---------------------------------------
const sky = new Sky();
sky.scale.setScalar(20000);
const sunDir = new THREE.Vector3();
{
  const elevation = 13, azimuth = 232; // low autumn afternoon sun over the SW
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sunDir.setFromSphericalCoords(1, phi, theta);
  const u = sky.material.uniforms;
  u['turbidity'].value = 7;
  u['rayleigh'].value = 2.2;
  u['mieCoefficient'].value = 0.005;
  u['mieDirectionalG'].value = 0.82;
  u['sunPosition'].value.copy(sunDir);
}
scene.add(sky);
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.add(sky);
  pmrem.dispose();
}

const sun = new THREE.DirectionalLight(0xffdcb0, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe0ee, 0x54604a, 0.35);
scene.add(hemi);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Systems ----------------------------------------------------------------
const world: World = buildWorld(scene);
const fx = new Fx(scene);
const hud = new Hud();
const player = new Player(camera, world.colliders);
const weapons = new WeaponState();
const viewModel = new ViewModel(camera);
const packs = new PackManager();
const director = new Director();

const pickups: { weaponId: string; pos: THREE.Vector3; mesh: THREE.Group }[] = [];

const zombies = new ZombieManager(scene, world.colliders, {
  onPlayerDamage(amount, x, z) {
    if (player.damage(amount, x, z)) {
      sfx.playerHurt();
      fx.addShake(0.3);
    }
  },
  onThrow(pos, vel, obj) {
    projectiles.throwObject(pos, vel, obj);
    sfx.throwWhoosh();
  },
  onKill(z) {
    state.kills++;
    director.addKill();
    sfx.zombieDie();
    fx.blood(z.pos.x, 1.1, z.pos.z);
    const drop = rollDrop(state.threatLevel, rng);
    if (drop) spawnPickup(drop, z.pos.x, z.pos.z);
  },
  onHurtSound() {
    sfx.zombieHurt();
  },
});

const projectiles = new ProjectileManager(scene, world.colliders, zombies, fx, {
  onExplosion(pos) {
    const def = WEAPONS.bazooka;
    for (const z of zombies.active) {
      if (z.state === 'dead') continue;
      const d = Math.hypot(z.pos.x - pos.x, z.pos.z - pos.z);
      if (d < (def.splashRadius ?? 5)) {
        const dmg = def.damage * (1 - d / (def.splashRadius ?? 5));
        const kx = ((z.pos.x - pos.x) / (d || 1)) * 6;
        const kz = ((z.pos.z - pos.z) / (d || 1)) * 6;
        if (zombies.damage(z, dmg, kx, kz)) hud.hitMarker();
      }
    }
    // self-damage if player too close
    const pd = Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z);
    if (pd < (def.splashRadius ?? 5) * 0.8) {
      player.damage(30 * (1 - pd / ((def.splashRadius ?? 5) * 0.8)), pos.x, pos.z);
      sfx.playerHurt();
      fx.addShake(0.5);
    }
  },
  onPlayerHitByObject(damage, x, z) {
    if (player.damage(damage, x, z)) {
      sfx.playerHurt();
    }
  },
});

// --- Pickups ----------------------------------------------------------------
function spawnPickup(weaponId: string, x: number, z: number): void {
  const def = WEAPONS[weaponId];
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: def.color, emissive: 0x222211 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), mat);
  bar.position.y = 0.35;
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.03, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.5 }),
  );
  glow.position.y = 0.06;
  g.add(bar, glow);
  g.position.set(x, 0.3, z);
  scene.add(g);
  pickups.push({ weaponId, pos: new THREE.Vector3(x, 0.3, z), mesh: g });
}

function clearPickups(): void {
  for (const p of pickups) scene.remove(p.mesh);
  pickups.length = 0;
}

let nearestPickup: (typeof pickups)[number] | null = null;

function updatePickups(dt: number): void {
  nearestPickup = null;
  let bestD = PLAYER.pickupRange;
  for (const p of pickups) {
    p.mesh.rotation.y += dt * 1.6;
    p.mesh.position.y = 0.3 + Math.sin(state.time * 2 + p.pos.x) * 0.06;
    const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
    if (d < bestD) {
      bestD = d;
      nearestPickup = p;
    }
  }
  hud.showPrompt(
    nearestPickup ? `E — Pick up ${WEAPONS[nearestPickup.weaponId].name}` : '',
  );
}

function grabPickup(): void {
  if (!nearestPickup) return;
  const id = nearestPickup.weaponId;
  if (weapons.id === id && weapons.reserve > 0) {
    // same weapon: just take ammo
    weapons.reserve += WEAPONS[id].pickupReserve ?? 0;
  } else {
    weapons.give(id);
    viewModel.setWeapon(id);
  }
  scene.remove(nearestPickup.mesh);
  pickups.splice(pickups.indexOf(nearestPickup), 1);
  nearestPickup = null;
  sfx.pickup();
}

// --- Combat -----------------------------------------------------------------
let firing = false;
let ads = false;
let touchJump = false;

const touch = isTouchDevice()
  ? new TouchControls({
      look(dx, dy) {
        if (state.phase !== 'playing') return;
        const sens = ads ? PLAYER.mouseSensitivity * 0.55 : PLAYER.mouseSensitivity;
        player.yaw -= dx * sens * 1.4;
        player.pitch -= dy * sens * 1.4;
        const lim = PLAYER.pitchLimit;
        player.pitch = Math.min(lim, Math.max(-lim, player.pitch));
        if (player.yaw > Math.PI) player.yaw -= Math.PI * 2;
        if (player.yaw < -Math.PI) player.yaw += Math.PI * 2;
      },
      fire(on) {
        firing = on;
      },
      jump() {
        touchJump = true;
      },
      reload() {
        weapons.startReload();
        const t = RELOAD_TIME[weapons.def.id];
        if (t) {
          viewModel.triggerReload(t);
          sfx.reload();
        }
      },
      pickup() {
        grabPickup();
      },
      pause() {
        if (state.phase === 'playing') pauseGame();
        else if (state.phase === 'paused') resumeGame();
      },
    })
  : null;

/** True briefly after a touch, so synthetic mouse events from taps are ignored. */
function touchedRecently(): boolean {
  return touch !== null && Date.now() - touch.lastTouch < 700;
}

function fireWeapon(): void {
  const def = weapons.def;
  if (!weapons.tryFire()) {
    if ((def.kind === 'gun' || def.kind === 'projectile') && weapons.ammo <= 0 && !weapons.reloading) {
      sfx.empty();
      weapons.startReload();
      viewModel.triggerReload(RELOAD_TIME[def.id] ?? 1.5);
      sfx.reload();
    }
    return;
  }
  const eye = player.position3;
  const dir = player.dir;

  if (def.kind === 'melee') {
    sfx.swing();
    viewModel.triggerSwing(def.cooldown * 0.7);
    const hits = zombies.meleeSweep(eye, player.flatDir, def.range, ((def.arcDeg ?? 70) * Math.PI) / 180 / 2);
    for (const z of hits) {
      const killed = zombies.damage(z, def.damage, dir.x * 5, dir.z * 5);
      fx.blood(z.pos.x, 1.2, z.pos.z, dir.x, dir.z);
      hud.hitMarker();
      sfx.hitFlesh();
      if (killed) fx.addShake(0.12);
    }
    return;
  }

  if (def.kind === 'chain') {
    viewModel.triggerSwing(0.1);
    if (Math.random() < 0.4) sfx.chainsaw(true);
    const hits = zombies.meleeSweep(eye, player.flatDir, def.range, 0.5);
    for (const z of hits) {
      zombies.damage(z, def.damage * (def.chainTick ?? 0.12), dir.x * 2, dir.z * 2);
      fx.blood(z.pos.x, 1.1, z.pos.z, dir.x, dir.z);
      hud.hitMarker();
    }
    return;
  }

  if (def.kind === 'projectile') {
    sfx.gunshot('bazooka');
    viewModel.triggerFire();
    player.addRecoil(def.recoil ?? 0.04);
    fx.addShake(0.25);
    projectiles.fireRocket(eye.clone().addScaledVector(dir, 0.6), dir.clone());
    return;
  }

  // hitscan gun
  sfx.gunshot(def.id);
  viewModel.triggerFire();
  player.addRecoil(def.recoil ?? 0.01);
  fx.addShake(def.id === 'shotgun' ? 0.3 : 0.08);
  const pellets = def.pellets ?? 1;
  const spread = ads ? (def.spread ?? 0) * 0.4 : def.spread ?? 0;
  for (let i = 0; i < pellets; i++) {
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * spread * 2;
    d.y += (Math.random() - 0.5) * spread * 2;
    d.z += (Math.random() - 0.5) * spread * 2;
    d.normalize();
    // world hit distance
    let worldDist = def.range;
    for (const c of world.colliders) {
      const t = rayAABB({ x: eye.x, z: eye.z }, { x: d.x, z: d.z }, worldDist, c);
      if (t !== null && t < worldDist) worldDist = t;
    }
    const hit = zombies.raycast(eye, d, worldDist);
    if (hit) {
      zombies.damage(hit.z, def.damage, d.x * 3, d.z * 3);
      fx.blood(hit.z.pos.x, Math.min(1.6, eye.y), hit.z.pos.z, d.x, d.z);
      hud.hitMarker();
      sfx.hitConfirm();
    } else if (worldDist < def.range) {
      fx.sparks(eye.x + d.x * worldDist, eye.y + d.y * worldDist, eye.z + d.z * worldDist);
    }
  }
}

// --- Input ------------------------------------------------------------------
const keys = new Set<string>();
let pointerLocked = false;

document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    // When locked, the browser consumes Esc to drop the lock and the
    // pointerlockchange handler pauses; when not locked we must handle it here.
    if (state.phase === 'playing') pauseGame();
    else if (state.phase === 'paused') resumeGame();
    return;
  }
  keys.add(e.code);
  if (state.phase !== 'playing') {
    if (state.phase === 'menu' && (e.code === 'Enter' || e.code === 'Space')) tryStart();
    if (state.phase === 'dead' && e.code === 'Enter') restart();
    return;
  }
  if (e.code === 'KeyE') grabPickup();
  if (e.code === 'KeyR') {
    weapons.startReload();
    const t = RELOAD_TIME[weapons.def.id];
    if (t) {
      viewModel.triggerReload(t);
      sfx.reload();
    }
  }
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

document.addEventListener('mousemove', (e) => {
  if (state.phase !== 'playing' || touchedRecently()) return;
  // Works with pointer lock (uncapped deltas) and without it (fallback:
  // movementX/Y still reports deltas in all modern browsers, so looking
  // around works even where pointer lock is blocked, e.g. embedded views).
  const sens = ads ? PLAYER.mouseSensitivity * 0.55 : PLAYER.mouseSensitivity;
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  const lim = PLAYER.pitchLimit;
  player.pitch = Math.min(lim, Math.max(-lim, player.pitch));
  if (player.yaw > Math.PI) player.yaw -= Math.PI * 2;
  if (player.yaw < -Math.PI) player.yaw += Math.PI * 2;
});

document.addEventListener('mousedown', (e) => {
  if (state.phase !== 'playing' || touchedRecently()) return;
  // retry acquiring the lock occasionally, but don't hammer it every click
  if (!pointerLocked && e.button === 0 && performance.now() - lastLockRetry > 3000) {
    lastLockRetry = performance.now();
    lockPointer();
  }
  if (e.button === 0) firing = true;
  if (e.button === 2) ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
  if (e.button === 2) ads = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    pointerLocked = true;
    lockHeldSince = performance.now();
  } else {
    pointerLocked = false;
    // Only auto-pause when the lock was actually held for a while. Some
    // embedded browsers drop the lock the instant they grant it (or refuse it
    // outright); without this guard every START click would bounce the
    // player straight back into an overlay — the classic "can't get past the
    // main menu" trap. Mouse-look works without the lock, so just play on.
    if (state.phase === 'playing' && performance.now() - lockHeldSince > 1500) pauseGame();
  }
});

function pauseGame(): void {
  if (state.phase !== 'playing') return;
  state.phase = 'paused';
  hud.showPause();
  touch?.setVisible(false);
  if (document.pointerLockElement) document.exitPointerLock();
}

function resumeGame(): void {
  if (state.phase !== 'paused') return;
  state.phase = 'playing';
  hud.hideOverlays();
  touch?.setVisible(true);
  lockPointer();
}

let lockHeldSince = 0;
let lastLockRetry = 0;

function lockPointer(): void {
  resumeAudio();
  if (touch) return; // touch uses drag-look; pointer lock on mobile only shows a Chrome error toast
  try {
    const p = renderer.domElement.requestPointerLock() as unknown;
    if (p instanceof Promise) p.catch(() => { /* fallback mouse-look still active */ });
  } catch { /* fallback mouse-look still active */ }
}

function tryStart(): void {
  if (!ready) { userWantedStart = true; return; }
  if (state.phase !== 'menu') return;
  initAudio();
  startGame();
}

document.getElementById('btn-resume')!.addEventListener('click', () => resumeGame());
document.getElementById('btn-restart')!.addEventListener('click', () => restart());

function startGame(): void {
  try {
    resetState();
    deathShown = false;
    wasFiring = false;
    firing = false;
    player.reset();
    player.pos.x = world.playerStart.x;
    player.pos.z = world.playerStart.z;
    player.yaw = world.playerStart.yaw;
    weapons.reset();
    viewModel.setWeapon('bat');
    zombies.clearAll();
    projectiles.clearAll();
    packs.reset();
    director.reset();
    clearPickups();
    resetThrowables();
    hud.hideOverlays();
    touch?.setVisible(true);
    lockPointer();
  } catch (e) {
    state.phase = 'menu';
    hud.showMenu();
    showFatal(String((e as Error)?.message ?? e));
  }
}

function restart(): void {
  startGame();
}

function resetThrowables(): void {
  for (const o of world.throwables) {
    o.taken = false;
    o.pos.x = o.home.x;
    o.pos.z = o.home.z;
    o.mesh.visible = true;
    o.mesh.position.set(o.home.x, o.kind === 'cone' ? 0.28 : 0.08, o.home.z);
    o.mesh.rotation.set(0, 0, 0);
  }
}

// --- Growl ambience -----------------------------------------------------------
let growlTimer = 3;

// --- Main loop ----------------------------------------------------------------
let last = performance.now();
let fpsAvg = 60;
let deathShown = false;

function frame(now: number): void {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  fpsAvg += ((1 / Math.max(dt, 0.001)) - fpsAvg) * 0.05;

  if (state.phase === 'playing') {
    step(dt);
  } else if (state.phase === 'dead' && !deathShown) {
    deathShown = true;
    const best = saveHighScore({ time: state.time, kills: state.kills, threat: state.highestThreat });
    const bm = Math.floor(best.time / 60);
    const bs = Math.floor(best.time % 60);
    hud.showGameOver(state.time, state.kills, state.highestThreat, `${bm}:${bs.toString().padStart(2, '0')}`);
    touch?.setVisible(false);
    document.exitPointerLock();
  }

  // keep the shadow frustum centred on the player
  sun.position.set(
    player.pos.x + sunDir.x * 180,
    sunDir.y * 180,
    player.pos.z + sunDir.z * 180,
  );
  sun.target.position.set(player.pos.x, 0, player.pos.z);

  // camera shake
  if (fx.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * fx.shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * fx.shake * 0.12;
    camera.rotation.z += (Math.random() - 0.5) * fx.shake * 0.05;
  }

  fx.update(dt);
  hud.update(state, dt, fpsAvg, player.damageFlash, player.lastDamageDir, player.yaw);
  if (!contextLost) renderer.render(scene, camera);
}

function step(dt: number): void {
  // input -> player
  player.input.forward = keys.has('KeyW');
  player.input.back = keys.has('KeyS');
  player.input.left = keys.has('KeyA');
  player.input.right = keys.has('KeyD');
  player.input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || (touch?.sprint ?? false);
  player.input.jump = keys.has('Space') || touchJump;
  touchJump = false;
  player.input.moveX = touch?.moveX ?? 0;
  player.input.moveY = touch?.moveY ?? 0;
  player.update(dt);

  // threat
  state.threatLevel = director.level(state.time);
  state.highestThreat = Math.max(state.highestThreat, state.threatLevel);

  // weapons
  weapons.update(dt);
  const def = weapons.def;
  if (firing) {
    if (def.auto || def.kind === 'chain') fireWeapon();
    else if (!wasFiring) fireWeapon();
  }
  wasFiring = firing;

  // ADS fov
  const wantFov = ads && (def.kind === 'gun' || def.kind === 'projectile') ? 45 : 75;
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();

  viewModel.update(dt, Math.hypot(player.vel.x, player.vel.z), weapons.cooldown > def.cooldown * 0.6 && (def.kind === 'gun'));

  // director & packs
  const playerView = {
    pos: player.pos,
    vel: player.vel,
    yaw: player.yaw,
    sprinting: state.sprinting,
    eyeY: PLAYER.eyeHeight,
  };
  director.update(dt, state.time, zombies.count, { pos: player.pos, yaw: player.yaw }, world, rng, (size, x, z) => {
    const members: Zombie[] = [];
    for (let i = 0; i < size; i++) {
      const ox = x + (Math.random() - 0.5) * 4;
      const oz = z + (Math.random() - 0.5) * 4;
      members.push(zombies.spawn(ox, oz, director.packCounter, state.threatLevel));
    }
    packs.createPack(members);
  });

  const throwablesAvailable =
    state.threatLevel >= 3 && world.throwables.some((o: ThrowableObject) => !o.taken);
  packs.update(dt, { player: playerView, threat: state.threatLevel, throwablesAvailable });
  zombies.update(dt, playerView, state.threatLevel, world.throwables);

  projectiles.update(dt, player.pos, PLAYER.eyeHeight);
  updatePickups(dt);

  // growls
  growlTimer -= dt;
  if (growlTimer <= 0) {
    growlTimer = 2 + Math.random() * 3;
    for (const z of zombies.active) {
      if (z.los && Math.hypot(z.pos.x - player.pos.x, z.pos.z - player.pos.z) < 22) {
        sfx.growl();
        break;
      }
    }
  }
}

let wasFiring = false;

// --- Ready -------------------------------------------------------------------
// Heavy init is done: the menu button goes live, and a click/keypress that
// happened during loading starts the game immediately.
ready = true;
btnStart.textContent = isTouchDevice() ? 'TAP TO START' : 'CLICK TO START';
if (userWantedStart) tryStart();

hud.showMenu();
requestAnimationFrame(frame);

// expose for debugging/tests
(window as unknown as Record<string, unknown>).__game = {
  state, player, weapons, zombies, packs, director, world, pickups, projectiles,
  renderer, camera, scene, hud, touch,
  step, fireWeapon, restart,
  setFiring: (v: boolean) => { firing = v; },
  setKeys: (codes: string[]) => { keys.clear(); for (const c of codes) keys.add(c); },
};
