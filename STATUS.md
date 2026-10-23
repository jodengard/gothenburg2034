# Göteborg Zombie Outbreak — Project Status

Arcade first-person zombie survival shooter set at a **map-accurate Korsvägen / Gothia Towers**,
Gothenburg. Stack: **Vite + TypeScript + three.js**. No paid assets: streets, tram lines, building
footprints and tree positions come from **OpenStreetMap** (© OpenStreetMap contributors, ODbL,
fetched via Overpass — see `tools/fetch-map.mjs` → `src/mapdata.json`); all other geometry
procedural, all audio WebAudio-generated.

## How to run

```
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle in dist/
npm test         # 29 unit tests (pure logic + headless zombie sim)
node tools/fetch-map.mjs   # re-pull OSM data (centered 57.69725, 11.98775, r=420 m)
```

Click **START**, then play. Esc pauses (releases pointer lock), Enter/button restarts after death.

## Current milestone: G (menu hardening, mobile controls, hot level 1, Pages-ready) — verified

### Fixed — "can't get past the main menu"
- **Pointer-lock trap removed**: the old `pointerlockchange` handler paused the game on *any*
  unlock, so browsers that grant-then-drop the lock (embedded views) bounced the player back to
  an overlay on every START click. Now auto-pause only fires if the lock was actually held
  >1.5 s; Esc pauses/resumes directly and works even when lock is unavailable.
- **Clicks during loading are never lost**: the menu listener registers before heavy init; the
  button shows `LOADING…` and a tap/Enter during world generation auto-starts once ready.
- **Startup failures are visible**: an inline boot guard in `index.html` (+ `__bootError`)
  renders module-load/runtime errors onto the menu instead of leaving a dead static page.
- Verified live: fresh load → tap → `playing`; Esc pause/resume without pointer lock;
  desktop mouse-look unchanged (100 px → 0.22 rad).

### Added — mobile touch controls (`src/touch.ts`)
- Left **virtual joystick** (analog, dynamic origin), right-half **drag-look**, thumb buttons:
  FIRE (hold), JUMP, RUN (hold), R reload, E grab, II pause. Shown only on coarse-pointer
  devices (`?forcetouch=1` forces them for testing); synthetic mouse events after taps are
  swallowed. `Player.input` gained analog `moveX/moveY` axes (keyboard path unchanged).
- Verified live with synthetic TouchEvents: stick moved player 4.45 m, drag-look Δyaw −0.31 rad,
  FIRE triggered weapon cooldown, sprint flag, pause→overlay→resume all correct.

### Balance — level 1 crowd ×3
- `popCaps` `[10,18,28,40,52]` → `[30,35,41,47,52]`; `spawnIntervals` → `[2.0,2.0,1.9,1.8,1.6]`;
  level-1 packs `[3,5]`. Later levels stay monotonic (never slower/sparser than level 1);
  max population 52 keeps the 60 fps budget.

### GitHub Pages
- `vite.config.ts` with `base: './'` (relative assets → works under any `/<repo>/` path;
  verified `dist/index.html` emits `./assets/...`).
- `.github/workflows/deploy.yml`: push to `main` → `npm ci && npm run build` → deploy `dist/`.
- `.gitignore` added. Everything is bundled (map JSON imported into the JS) — no server needed.

## Previous milestone: F (real map data + photorealistic pass) — verified

### Implemented
- **World (map-driven)**: 370×370 m arena built from real OSM data of the district:
  - **Gothia Towers**: all three real tower footprints (Tower 1 77 m, Tower 2 82 m, Tower 3 100 m)
    extruded with glass curtain-wall material + connecting Kongress podium + roof caps.
  - **Real streets**: Örgrytevägen, Korsvägen, Skånegatan, Södra Vägen, Mässans Gata, Lisebergsbron…
    as ribbon geometry with class-based widths, dashed centre lines on arterials, raised sidewalks.
  - **Tram network**: real tram ways as ballast bed + twin metal rails; tram-stop platforms +
    glass shelters placed where the lines converge by the crossing.
  - **843→210 real building footprints** extruded (heights from OSM levels/height tags, Swedish
    6-storey fallback), procedural facade textures, roof caps; footway/cycleway network as light
    pavement. Alleys between blocks give flanking/ambush routes.
  - **347 real tree positions** (instanced low-poly), streetlights along real streets, parked
    metallic cars, benches, bins, barriers, 60 throwable props on pavements.
- **Rendering (photorealistic pass)**: three.js `Sky` (low autumn sun) → PMREM environment map
  (reflections on glass/metal/rails), ACES filmic tone mapping, PCF soft shadows from a
  sun-follow directional light (2048 map, frustum tracks the player), PBR materials throughout
  (procedural asphalt/pavement/grass/facade/glass textures), horizon-matched fog.
- **Mouse look**: works **with or without pointer lock** — `movementX/Y` deltas drive yaw/pitch
  even when lock is blocked (embedded views); clicking the canvas retries the lock; lock-request
  rejections are caught. Verified quantitatively (0.0022 rad/px, pitch clamp ±1.5, yaw wrap).
- **Player**: WASD + accel/friction + sprint + jump, circle-vs-AABB collision, health, damage
  vignette + direction indicator, recoil. Starts on the real street by the crossing, facing the
  towers (`world.playerStart`).
- **Weapons** (shared `WeaponDef` + `WeaponState`): bat (start), axe, sword, chainsaw (fuel),
  pistol, shotgun, AK-47 (auto), bazooka (splash rockets). Drops weighted by threat level;
  unimplemented-behavior weapons never drop. E to pick up, R to reload, RMB aim (ADS spread cut).
- **Zombies**: FSM (approach/search/flank/intercept/grab/windup/strike/recover/stagger/dead),
  sight+hearing perception with LOS checks (no wall-hacks), steering with obstacle fan-avoidance,
  stuck-unstick, neighbor separation via spatial hash, far-AI throttling, pooling, fall+sink death.
- **Packs**: spawned as groups; roles recomputed every 0.6 s with hysteresis:
  pursuer / flanker / interceptor / thrower (threat ≥ 3) / swarm (pressure).
- **Throwers**: pick nearby object → walk → grab → visible windup → lobbed projectile → damage.
- **Director**: 5 threat levels by time (+kill credit), pop caps 10→52, pack-size & interval scaling,
  spawns outside view cone / behind cover, never on the player.
- **Combat feedback**: muzzle flash + light, blood/spark/explosion particles, hit markers,
  hit flash, screen shake, generated gun/melee/zombie/explosion SFX.
- **HUD**: health, time, kills, threat stars, weapon+ammo, pickup prompts, fps,
  game-over stats, localStorage best time.

### Verification status
- **Static/unit**: `tsc --noEmit` clean, `vite build` clean (~1.0 MB bundle incl. map data),
  29/29 vitest tests pass (RNG, collision, weapons, director escalation/spawn rules/pop cap,
  pack roles, zombie sim: pursuit, wall respect, separation, death/removal, melee/raycast,
  no unbounded growth).
- **Headless gameplay on the real map** (driven via `window.__game.step()`):
  - 400 s godmode run: threat levels 1→5 first hit at 0/52/138/230/331 s; population capped at
    exactly 52; 111 kills; 0 NaN positions; max stuckT 0.32 s (unstick works, no permanent sticking).
  - Throwers at threat ≥ 5: full grab → windupThrow → recoverThrow cycle observed; thrown objects
    alive in the projectile pool (pool bounded, reused).
  - 60 s run: 10 zombies (level-1 cap), 4 packs with pursuer/flanker/swarm roles; player start
    (-1.5, 73.8) on the real street, no out-of-bounds.
  - Perf: ~0.065 ms/step avg @ 10 zombies; worst single step 7.1 ms @ ~50 zombies (spawn burst).
- **Mouse look** (synthetic `mousemove` events, no pointer lock available in the embedded view):
  100 px → 0.22 rad yaw, 40 px → 0.088 rad pitch, pitch clamps at ±1.5 rad, yaw wraps ±π. Works
  through the no-lock fallback path exactly as a real user would when lock is denied.
- **Visual** (gl.readPixels → JPEG capture, reviewed): three glass Gothia Towers + podium from
  the street; real Korsvägen intersection with curved ramps, dashed markings, sidewalks; tram
  platforms + glass shelters with rails alongside; apartment blocks with window textures; parked
  cars; streetlights; trees; footway network as light pavement; bird's-eye shows the authentic
  street/tram layout. Sky + reflections + shadows read as an overcast-bright autumn afternoon.

### Known defects / open items
- Pointer lock still silently fails in the automated/hidden tab (no user gesture) — now harmless:
  the movementX/Y fallback gives full mouse look everywhere, and lock is retried on canvas click.
- No health regeneration: an idle player dies within ~60 s at threat 1 (intended pressure).
- Ground outside the 420 m OSM fetch radius is flat grass fading into fog; fine for the arena,
  could get distant silhouette filler later.
- Bundle is a single ~1.0 MB chunk (three.js + 0.4 MB map JSON); fine for this scope, could be
  code-split / the JSON minified later.
- `src/zombie.ts` was rewritten after a newline-stripping accident (content preserved verbatim,
  verified by the full test suite + headless sim re-runs).
- Not yet a git repo; nothing committed.

### Key decisions
- Real geography from OSM (ODbL) instead of generic blocks; arena re-centered midway between the
  Korsvägen crossing and Gothia Towers and grown to 370 m so all three towers sit inside the map.
- Building collision = footprint bounding boxes (alleys stay open); trees/props get small AABBs.
- 2D (x,z) collision + AABB world; y only matters for bullets/throws. Keeps AI cheap and robust.
- No navmesh: steering + fan avoidance + unstick; validated by wall test.
- Zombie hearing is the justified "wallhack": they hear the player within ~55 m (85 m sprinting).
- Threat = f(time + kill credit); continuous spawning, no waves.
- Photorealistic direction within the no-paid-assets rule: real sky + IBL reflections + shadows +
  PBR + ACES, procedural textures only.
