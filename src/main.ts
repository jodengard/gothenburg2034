/** Application startup, main loop, and system wiring. */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PLAYER, WEAPONS, WORLD, SCOOTER, FATALITY, BUNNY } from './config';
import { state, resetState, saveHighScore } from './state';
import { buildWorld, World, ThrowableObject } from './world';
import { buildLandmarks } from './landmarks';
import { buildHighway } from './highway';
import { buildAtmosphere, Atmosphere } from './atmos';
import { buildHalloween } from './halloween';
import { Traffic } from './traffic';
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
import { rayAABB, invalidateColliderGrid } from './collision';
import { TouchControls, isTouchDevice } from './touch';
import { buildLisebergskanin } from './rabbit';
import { BunnyHelpers } from './bunny';
import { buildShanghaiWorld, SH_ISLAND } from './shanghai';
import { buildNoodleDrop } from './noodle';

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
// Mobile Chrome (especially with many tabs open) aggressively reclaims GPU
// memory, and a full-resolution 4×-MSAA canvas plus a 2048 shadow map is often
// enough to get the context discarded — that is the white screen and the
// "Error creating WebGL context" on reload. Phones get a lighter profile:
// no MSAA, capped pixel ratio, smaller shadow map (see also degradeQuality).
const isMobile =
  window.matchMedia('(pointer: coarse)').matches ||
  new URLSearchParams(location.search).has('low');

function createRenderer(): THREE.WebGLRenderer {
  let lastErr: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
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

// Full-screen tap-to-reload overlay for context loss and fatal frame errors.
function showOverlay(title: string, msg: string, btn: string, action: () => void): void {
  if (document.getElementById('fatal-overlay')) return;
  const d = document.createElement('div');
  d.id = 'fatal-overlay';
  d.style.cssText = 'position:fixed;inset:0;background:#000d;z-index:99;display:flex;' +
    'flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;' +
    'font-family:sans-serif;text-align:center;padding:28px;cursor:pointer';
  const t = document.createElement('div');
  t.style.cssText = 'font-size:22px;font-weight:bold';
  t.textContent = title;
  const m = document.createElement('div');
  m.style.cssText = 'opacity:.85;max-width:340px;line-height:1.5';
  m.textContent = msg;
  const b = document.createElement('div');
  b.style.cssText = 'padding:14px 30px;background:#c0392b;border-radius:8px;font-weight:bold';
  b.textContent = btn;
  d.append(t, m, b);
  d.addEventListener('click', action);
  document.body.appendChild(d);
}

// If Chrome reclaims our context mid-session the canvas goes white; detect it,
// pause the game and offer a one-tap reload instead of a silent white screen.
let contextLost = false;
function onContextLost(e?: Event): void {
  if (e) e.preventDefault(); // lets Chrome try to restore (we reload if it does)
  if (contextLost) return;
  contextLost = true;
  pauseGame(); // don't let the player die behind the overlay
  showOverlay('Graphics were interrupted',
    'Your browser reclaimed the 3D graphics — usually caused by having many tabs open. Close a few tabs, then tap the button.',
    'TAP TO RELOAD', () => location.reload());
}
renderer.domElement.addEventListener('webglcontextlost', onContextLost);
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());

// Returning from the back/forward cache (app switch on Android): the context
// usually survives, so resume seamlessly — only reload when it actually died.
// (Never force-lose the context on pagehide: that made every app switch look
// like a crash, since the forced loss triggered the "reclaimed" overlay.)
window.addEventListener('pageshow', (e) => {
  if ((e as PageTransitionEvent).persisted && renderer.getContext().isContextLost()) {
    location.reload();
  }
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 900);
scene.add(camera);
scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);

// --- Sky, environment reflections, moon ---------------------------------------
const sky = new Sky();
sky.scale.setScalar(20000);
const sunDir = new THREE.Vector3();
{
  // Dusk: the afterglow and the harvest moon sit low over the SW. Compass
  // azimuth 232° maps to spherical theta = 180° - 232° = -52° in three.js
  // (theta runs from +Z=south toward +X=east), which lands the light out west.
  const elevation = 14, azimuth = 232;
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(180 - azimuth);
  sunDir.setFromSphericalCoords(1, phi, theta);
  const u = sky.material.uniforms;
  u['turbidity'].value = 8;
  u['rayleigh'].value = 2.0; // strong red-orange scattering band at the horizon
  u['mieCoefficient'].value = 0.006;
  u['mieDirectionalG'].value = 0.86;
  // Sun just ABOVE the horizon: the dome keeps a twilight blue wash with a
  // bright SW afterglow band (at -5° everything except the glow stays black).
  u['sunPosition'].value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 1), theta);
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

const sun = new THREE.DirectionalLight(0xffa268, 1.9); // warm dusk key from the SW
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 1024 : 2048, isMobile ? 1024 : 2048);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0x7688b4, 0x33291c, 1.05); // twilight fill
scene.add(hemi);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Systems ----------------------------------------------------------------
const world: World = buildWorld(scene);
const landmarks = buildLandmarks(scene);
const highway = buildHighway(scene);
const trafficG = new Traffic(scene, world);
let traffic = trafficG; // the Traffic of the arena you are currently in (see travel below)
const fx = new Fx(scene);
const hud = new Hud();
const player = new Player(camera, world.colliders);
const weapons = new WeaponState();
const viewModel = new ViewModel(camera);
// While riding a scooter the player is a Lisebergskanin seen from a chase cam.
const rabbit = buildLisebergskanin();
rabbit.visible = false;
scene.add(rabbit);
const chaseCam = new THREE.Vector3();
let wasRiding = false;
trafficG.onTrick = (label, pts) => {
  state.trickScore += pts;
  hud.trick(`${label} +${pts}`);
};
// carrot-powered AI bunny helpers on kickbikes (see bunny.ts)
const helpers = new BunnyHelpers(scene, world.colliders);
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
    if (z.exploded) {
      // Fatality: the body bursts apart — the corpse hides, gore chunks fly.
      z.mesh.visible = false;
      fx.gore(z.pos.x, 1.15, z.pos.z);
      sfx.gore();
    } else {
      sfx.zombieDie();
      fx.blood(z.pos.x, 1.1, z.pos.z);
    }
    const drop = rollDrop(state.threatLevel, rng);
    if (drop) spawnPickup(drop, z.pos.x, z.pos.z);
    // carrots: scooter-riding hooligans carry the good stuff — a carrot
    // summons a Lisebergskanin kickbike champion to fight at your side
    if (rng.chance(z.wasRiding ? BUNNY.riderDropChance : BUNNY.dropChance)) {
      spawnCarrot(z.pos.x, z.pos.z);
    }
  },
  onHurtSound() {
    sfx.zombieHurt();
  },
});

// Every street scooter gets a zombie hooligan riding it (kill the rider,
// hijack the scooter).
trafficG.attachZombies(zombies);

const atmos = buildAtmosphere(scene, world, sunDir);
const halloween = buildHalloween(scene, world, atmos.bonfirePos);

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
        if (zombies.damage(z, dmg, kx, kz, { byPlayer: true })) hud.hitMarker();
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

// --- Flygbussen: Gothenburg ↔ Shanghai Expo teleport --------------------------
// One of the blue buses is secretly the airport coach to Shanghai. Board it and
// the world swaps to a second arena island far outside the fog (src/shanghai.ts).
// player/zombies/projectiles/helpers all share world.colliders by reference,
// so swapping that array's contents in place re-wires collision everywhere.
const gothenburgColliders = [...world.colliders];
let worldSh: World | null = null;
let trafficSh: Traffic | null = null;
let atmosSh: Atmosphere | null = null;
let activeWorld: World = world;
let inShanghai = false;
const travel = { active: false, t: 0, toSh: true, swapped: false };
/** Seconds before the director may spawn again (Shanghai arrival calm). */
let spawnGrace = 0;

function setActiveArena(toSh: boolean): void {
  inShanghai = toSh;
  activeWorld = toSh ? worldSh! : world;
  traffic = toSh ? trafficSh! : trafficG;
  const src = toSh ? worldSh!.colliders : gothenburgColliders;
  world.colliders.length = 0;
  world.colliders.push(...src);
  invalidateColliderGrid(); // the shared array was refilled in place
}

function startTravel(toSh: boolean): void {
  if (travel.active || state.phase !== 'playing') return;
  if (traffic.ridden) traffic.dismount();
  travel.active = true;
  travel.t = 1.7;
  travel.toSh = toSh;
  travel.swapped = false;
  sfx.horn('tram'); // the deepest horn the coach has
  hud.fade(true);
}

function doSwap(): void {
  if (travel.toSh && !worldSh) {
    // first visit: build the Expo arena and its little traffic fleet
    worldSh = buildShanghaiWorld(scene);
    trafficSh = new Traffic(scene, worldSh, { scooterFleet: 4 });
    trafficSh.attachZombies(zombies);
    trafficSh.onTrick = (label, pts) => {
      state.trickScore += pts;
      hud.trick(`${label} +${pts}`);
    };
    atmosSh = buildAtmosphere(scene, worldSh, sunDir);
  }
  setActiveArena(travel.toSh);
  noodle.cooking = false;
  noodle.cool = 0;
  clearNoodleDrop();
  worldSh?.noodle?.setCooking(null);
  if (travel.toSh) sfx.musicStart(); else sfx.musicStop(); // Expo street music
  zombies.clearAll();
  projectiles.clearAll();
  clearPickups();
  clearCarrots();
  helpers.clear(); // helpers would be stranded across town
  packs.reset();
  player.pos.x = activeWorld.playerStart.x;
  player.pos.z = activeWorld.playerStart.z;
  player.yaw = activeWorld.playerStart.yaw;
  player.pitch = 0;
  player.immunity = Math.max(player.immunity, 5); // grace: traffic spares you on arrival
  if (travel.toSh) spawnGrace = 10; // first ten seconds in Shanghai stay quiet
  hud.setArena(travel.toSh ? 'SHANGHAI · 世博园区' : 'GÖTEBORG · KORSVÄGEN');
  hud.trick(travel.toSh ? '\u{1F68C} SHANGHAI EXPO — 世博会' : '\u{1F68C} BACK TO KORSVÄGEN');
  sfx.pickup();
}

// --- Noodle stall: the bunny chef cooks 牛肉麵, grab the bowl to heal ---------
const COOK_TIME = 3;
const NOODLE_COOLDOWN = 12;
const noodle = { cooking: false, t: 0, cool: 0 };
let noodleDrop: { mesh: THREE.Group; x: number; z: number; t: number } | null = null;

function clearNoodleDrop(): void {
  if (noodleDrop) scene.remove(noodleDrop.mesh);
  noodleDrop = null;
}

function noodleNear(): boolean {
  const n = activeWorld.noodle;
  if (!n || state.phase !== 'playing' || travel.active || traffic.ridden) return false;
  if (noodle.cooking || noodleDrop || noodle.cool > 0) return false;
  return Math.hypot(n.bar.x - player.pos.x, n.bar.z - player.pos.z) < 2.2;
}

function startCooking(): void {
  const n = activeWorld.noodle!;
  noodle.cooking = true;
  noodle.t = 0;
  n.setCooking(0);
  sfx.bell(); // order up
  sfx.sizzle(); // wok hits hot oil
  hud.trick('\u{1F373} THE CHEF IS COOKING 牛肉麵…');
}

function finishCooking(): void {
  const n = activeWorld.noodle!;
  noodle.cooking = false;
  n.setCooking(null);
  const g = buildNoodleDrop();
  g.position.set(n.bar.x, 0.95, n.bar.z); // sits on the counter
  scene.add(g);
  noodleDrop = { mesh: g, x: n.bar.x, z: n.bar.z, t: 0 };
  sfx.bell();
  hud.trick('\u{1F35C} 牛肉麵 READY — grab your bowl!');
}

/** The Flygbussen you could board right now (the moving coach at home, the parked one in Shanghai). */
function shuttleTargetPos(): { x: number; z: number } | null {
  if (inShanghai) return activeWorld.shuttle ?? null;
  const bus = trafficG.vehicles.find((v) => v.flygbuss);
  return bus ? { x: bus.group.position.x, z: bus.group.position.z } : null;
}

function shuttleNear(): boolean {
  if (state.phase !== 'playing' || travel.active || traffic.ridden) return false;
  const st = shuttleTargetPos();
  return !!st && Math.hypot(st.x - player.pos.x, st.z - player.pos.z) < 4.5;
}

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

// --- Carrots: dropped by zombies, walked over, summon a bunny helper --------
const carrots: { pos: THREE.Vector3; mesh: THREE.Group }[] = [];

function spawnCarrot(x: number, z: number): void {
  const g = new THREE.Group();
  const root = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.42, 8),
    new THREE.MeshLambertMaterial({ color: 0xff7f1f, emissive: 0x441500 }),
  );
  root.rotation.x = Math.PI; // tip down, shoulders up
  root.position.y = 0.21;
  const tops = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.2, 5),
    new THREE.MeshLambertMaterial({ color: 0x3fae2f }),
  );
  tops.position.y = 0.5;
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 16),
    new THREE.MeshBasicMaterial({ color: 0xffa64d, transparent: true, opacity: 0.4 }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  g.add(root, tops, glow);
  g.position.set(x, 0.1, z);
  scene.add(g);
  carrots.push({ pos: new THREE.Vector3(x, 0.1, z), mesh: g });
}

function clearCarrots(): void {
  for (const c of carrots) scene.remove(c.mesh);
  carrots.length = 0;
}

function updateCarrots(dt: number): void {
  for (let i = carrots.length - 1; i >= 0; i--) {
    const c = carrots[i];
    c.mesh.rotation.y += dt * 2.2;
    c.mesh.position.y = 0.1 + Math.sin(state.time * 2.4 + c.pos.x) * 0.05;
    if (Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) < BUNNY.pickupRange) {
      scene.remove(c.mesh);
      carrots.splice(i, 1);
      helpers.spawn(c.pos.x, c.pos.z);
      sfx.pickup();
      hud.trick('\u{1F955} BUNNY HELPER!');
    }
  }
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

// --- Scooter hijacking --------------------------------------------------------
// E does double duty: mount/dismount a scooter takes priority over pickups.

function scooterInteract(): boolean {
  if (noodle.cooking) return false; // the chef needs quiet
  if (traffic.ridden) {
    traffic.dismount();
    sfx.bell();
    return true;
  }
  // the noodle stall: put in an order before considering the coach
  if (noodleNear()) {
    startCooking();
    return true;
  }
  // the airport coach outranks a scooter: if it is within reach, you board it
  if (shuttleNear()) {
    startTravel(!inShanghai);
    return true;
  }
  const v = traffic.findMount(player.pos.x, player.pos.z);
  if (v) {
    traffic.mount(v);
    sfx.bell();
    return true;
  }
  return false;
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
        if (!scooterInteract()) grabPickup();
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
      const killed = zombies.damage(z, def.damage, dir.x * 5, dir.z * 5, { byPlayer: true });
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
    // two-stroke exhaust drifting off the saw while it screams
    fx.smoke(eye.x + player.flatDir.x * 0.8, eye.y - 0.25, eye.z + player.flatDir.z * 0.8);
    const hits = zombies.meleeSweep(eye, player.flatDir, def.range, 0.5);
    for (const z of hits) {
      zombies.damage(z, def.damage * (def.chainTick ?? 0.12), dir.x * 2, dir.z * 2, { byPlayer: true });
      fx.sawSpray(z.pos.x, 1.15, z.pos.z, dir.x, dir.z); // heavy gore every tick
      if (Math.random() < 0.05) fx.gore(z.pos.x, 1.1, z.pos.z); // now and then it chews up chunks
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
      const dmg = def.damage * (hit.head ? FATALITY.headMult : 1);
      zombies.damage(hit.z, dmg, d.x * 3, d.z * 3, { headshot: hit.head, byPlayer: true });
      const hy = hit.head ? 1.7 : Math.min(1.6, eye.y);
      fx.blood(hit.z.pos.x, hy, hit.z.pos.z, d.x, d.z);
      hud.hitMarker(hit.head);
      if (hit.head) sfx.headshot(); else sfx.hitConfirm();
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
  if (e.code === 'KeyE') {
    if (!scooterInteract()) grabPickup();
  }
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
    // always restart back home in Gothenburg
    travel.active = false;
    hud.fade(false);
    if (inShanghai) setActiveArena(false);
    hud.setArena('GÖTEBORG · KORSVÄGEN');
    deathShown = false;
    wasFiring = false;
    firing = false;
    spawnGrace = 0;
    noodle.cooking = false;
    noodle.cool = 0;
    clearNoodleDrop();
    worldSh?.noodle?.setCooking(null);
    sfx.musicStop();
    player.reset();
    player.pos.x = world.playerStart.x;
    player.pos.z = world.playerStart.z;
    player.yaw = world.playerStart.yaw;
    weapons.reset();
    viewModel.setWeapon('bat');
    zombies.clearAll();
    traffic.reset(); // rebuild the scooter fleet + riders (old riders died in clearAll)
    projectiles.clearAll();
    packs.reset();
    director.reset();
    clearPickups();
    clearCarrots();
    helpers.clear();
    resetThrowables();
    player.immunity = Math.max(player.immunity, 5); // grace: traffic spares you for the first seconds
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
let errStreak = 0;
let broken = false;
let degraded = false;

/** One-shot quality drop for phones that still can't hold ~30 fps. */
function degradeQuality(): void {
  degraded = true;
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;
  scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((mm) => { mm.needsUpdate = true; });
    else if (mat) mat.needsUpdate = true;
  });
}

function frame(now: number): void {
  if (broken) return;
  requestAnimationFrame(frame);
  try {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05);
    fpsAvg += ((1 / Math.max(dt, 0.001)) - fpsAvg) * 0.05;

    if (state.phase === 'playing') {
      step(dt);
      // phones that still struggle on the light profile: shed pixels + shadows
      if (isMobile && !degraded && state.time > 6 && fpsAvg < 28) degradeQuality();
    } else if (state.phase === 'dead' && !deathShown) {
      deathShown = true;
      sfx.musicStop(); // the band stops for the dead
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
    landmarks.update(dt);
    highway?.update(dt);
    atmos.update(dt);
    atmosSh?.update(dt);
    halloween.update(dt, zombies.active, camera.position);
    hud.update(state, dt, fpsAvg, player.damageFlash, player.lastDamageDir, player.yaw,
      traffic.ridden ? traffic.ridden.battery / SCOOTER.batterySeconds : -1);
    // safety net: some context losses never fire the event — catch them here
    if (!contextLost && renderer.getContext().isContextLost()) onContextLost();
    if (!contextLost) renderer.render(scene, camera);
    errStreak = 0;
  } catch (e) {
    // A transient hiccup is survivable; a persistent one must never leave the
    // player staring at a white canvas with a live HUD (the old mobile bug).
    if (++errStreak < 20) return;
    broken = true;
    showOverlay('Something broke',
      `${String((e as Error | null)?.message ?? e)} — tap the button to reload.`,
      'TAP TO RELOAD', () => location.reload());
  }
}

function step(dt: number): void {
  // Flygbussen teleport: fade out, swap arenas at the blackout, fade back in
  if (travel.active) {
    travel.t -= dt;
    if (!travel.swapped && travel.t <= 0.85) {
      doSwap();
      travel.swapped = true;
      hud.fade(false);
    }
    if (travel.t <= 0) travel.active = false;
  }
  // input -> player
  player.input.forward = keys.has('KeyW');
  player.input.back = keys.has('KeyS');
  player.input.left = keys.has('KeyA');
  player.input.right = keys.has('KeyD');
  player.input.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || (touch?.sprint ?? false);
  const jumpPressed = keys.has('Space') || touchJump;
  player.input.jump = jumpPressed;
  touchJump = false;
  player.input.moveX = touch?.moveX ?? 0;
  player.input.moveY = touch?.moveY ?? 0;

  // the bunny chef cooks your order; when it's done a bowl lands at the bar
  if (noodle.cool > 0) noodle.cool -= dt;
  const stall = activeWorld.noodle;
  if (noodle.cooking && stall) {
    noodle.t += dt;
    stall.setCooking(Math.min(1, noodle.t / COOK_TIME));
    if (noodle.t >= COOK_TIME) finishCooking();
  }
  stall?.update(state.time);
  if (noodleDrop) {
    noodleDrop.t += dt;
    noodleDrop.mesh.rotation.y += dt * 1.6;
    noodleDrop.mesh.position.y = 0.95 + Math.sin(state.time * 3) * 0.05;
    if (noodleDrop.t > 0.5 && Math.hypot(noodleDrop.x - player.pos.x, noodleDrop.z - player.pos.z) < 1.5) {
      clearNoodleDrop(); // slurped on the spot
      player.health = PLAYER.maxHealth;
      noodle.cool = NOODLE_COOLDOWN;
      sfx.slurp();
      sfx.gulp();
      hud.trick('\u{1F35C} BEEF NOODLES — HP RESTORED');
    }
  }

  // a hijacked scooter owns horizontal movement: W throttle, S brake/reverse,
  // A/D steer (touch stick: push forward/back to throttle, strafe to steer)
  player.riding = traffic.ridden !== null;
  if (traffic.ridden) {
    const tx = touch;
    traffic.updateRidden(dt, {
      fwd: keys.has('KeyW') || (tx ? tx.moveY < -0.25 : false),
      back: keys.has('KeyS') || (tx ? tx.moveY > 0.45 : false),
      left: keys.has('KeyA') || (tx ? tx.moveX < -0.3 : false),
      right: keys.has('KeyD') || (tx ? tx.moveX > 0.3 : false),
      jump: jumpPressed, // Space / touch jump: hop, or tailwhip mid-air
    }, player, zombies);
    // battery may have died mid-frame, stranding the rider
    player.riding = traffic.ridden !== null;
  }
  player.update(dt);

  // Riding: third-person chase cam — the player is a Lisebergskanin on the deck.
  if (player.riding && traffic.ridden) {
    const v = traffic.ridden;
    const hx = Math.sin(v.heading), hz = Math.cos(v.heading);
    player.yaw = v.heading + Math.PI; // shots fly where the scooter points
    player.pitch = 0;
    rabbit.visible = true;
    rabbit.position.set(v.freeX, 0.18 + v.y, v.freeZ);
    rabbit.rotation.copy(v.group.rotation); // lean, spin and tailwhip with the scooter
    const camY = 2.15 + v.y * 0.85; // chase cam follows the hops a little
    const tx = v.freeX - hx * 3.4, tz = v.freeZ - hz * 3.4;
    if (!wasRiding) {
      chaseCam.set(tx, camY, tz);
      wasRiding = true;
    }
    const k = Math.min(1, dt * 7);
    chaseCam.x += (tx - chaseCam.x) * k;
    chaseCam.y += (camY - chaseCam.y) * k;
    chaseCam.z += (tz - chaseCam.z) * k;
    camera.position.set(chaseCam.x, chaseCam.y, chaseCam.z);
    camera.lookAt(v.freeX + hx * 1.8, 1.05 + v.y, v.freeZ + hz * 1.8);
  } else if (wasRiding || rabbit.visible) {
    rabbit.visible = false;
    wasRiding = false;
  }
  viewModel.group.visible = !player.riding;

  // threat — Shanghai runs at a permanent six stars
  state.threatLevel = inShanghai ? 6 : director.level(state.time);
  state.highestThreat = Math.max(state.highestThreat, state.threatLevel);

  // weapons
  weapons.update(dt);
  const def = weapons.def;
  if (firing) { // the chef works best with an audience that keeps shooting
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
  // in Shanghai the director spawns at max level from second one (+1e6 time credit)
  if (spawnGrace > 0) spawnGrace = Math.max(0, spawnGrace - dt);
  director.update(dt, inShanghai ? state.time + 1e6 : state.time, zombies.count, { pos: player.pos, yaw: player.yaw }, activeWorld, rng, (size, x, z) => {
    if (spawnGrace > 0) return; // arrival calm: the first packs simply don't show
    const members: Zombie[] = [];
    for (let i = 0; i < size; i++) {
      const ox = x + (Math.random() - 0.5) * 4;
      const oz = z + (Math.random() - 0.5) * 4;
      members.push(zombies.spawn(ox, oz, director.packCounter, state.threatLevel));
    }
    packs.createPack(members);
  });

  const throwablesAvailable =
    state.threatLevel >= 3 && activeWorld.throwables.some((o: ThrowableObject) => !o.taken);
  packs.update(dt, { player: playerView, threat: state.threatLevel, throwablesAvailable });
  zombies.update(dt, playerView, state.threatLevel, activeWorld.throwables);

  projectiles.update(dt, player.pos, PLAYER.eyeHeight);
  updatePickups(dt);
  updateCarrots(dt);
  helpers.update(dt, player, zombies);

  // scooter prompt overrides the weapon prompt (hijacking > pickups)
  if (traffic.ridden) hud.showPrompt('E — Dismount');
  else if (noodle.cooking) hud.showPrompt('\u{1F373} the chef is cooking 牛肉麵…');
  else if (noodleDrop && Math.hypot(noodleDrop.x - player.pos.x, noodleDrop.z - player.pos.z) < 3)
    hud.showPrompt('\u{1F35C} noodles ready — grab the bowl!');
  else if (noodleNear()) hud.showPrompt('E — order 牛肉麵 Beef noodles (chef bunny cooks)');
  else if (shuttleNear()) {
    hud.showPrompt(inShanghai ? 'E — Flygbussen → GÖTEBORG' : 'E — Board the Flygbussen → SHANGHAI');
  } else if (traffic.findMount(player.pos.x, player.pos.z)) hud.showPrompt('E — Hijack the scooter');

  // traffic: trams/buses/cars on real streets — hazards for the player, reapers for the horde
  traffic.update(dt, player, zombies, (dmg, x, z, shake) => {
    if (!player.damage(dmg, x, z)) return false;
    sfx.playerHurt();
    fx.addShake(shake);
    return true;
  });

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
  get traffic() { return traffic; }, // follows the active arena
  helpers, carrots,
  renderer, camera, scene, hud, touch, fx, halloween, rabbit,
  step, fireWeapon, restart, scooterInteract,
  travel, island: SH_ISLAND, noodle,
  get noodleDrop() { return noodleDrop; },
  inShanghai: () => inShanghai,
  activeWorld: () => activeWorld,
  travelTo: (toSh: boolean) => startTravel(toSh),
  setFiring: (v: boolean) => { firing = v; },
  setKeys: (codes: string[]) => { keys.clear(); for (const c of codes) keys.add(c); },
};
