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
npm test         # 32 unit tests (pure logic + headless zombie sim + traffic path math)
node tools/fetch-map.mjs   # re-pull OSM data (centered 57.69725, 11.98775, r=420 m)
```

Click **START**, then play. Esc pauses (releases pointer lock), Enter/button restarts after death.

## Current milestone: K (Halloween night: moon, mist, lit windows, jack-o'-lanterns, glowing eyes) — verified

### Added — night + Halloween atmosphere (`src/atmos.ts`, ~8 draw calls)
- **Harvest moon**: big low orange moon (canvas texture with halo + craters, additive,
  fog-free) at the old sun azimuth; **900-star dome** (Points, fog-free) inside the far plane.
- **Ground mist**: three large alpha-noise sheets at 0.9/2.0/3.1 m drifting and counter-
  rotating — the classic fog-plane trick, reads as rolling mist around the towers.
- **Embers/fireflies**: 70 additive Points rising and swaying over the arena.
- **Bonfire**: stone ring + logs + flickering additive flame cones + the scene's only
  dynamic PointLight (flicker via 3 summed sines). Placed 13–24 m in front of the player
  spawn, validated open (`isSpawnValid`) and clear of all traffic routes (>6 m).

### Added — Halloween dressing (`src/halloween.ts`, ~6 draw calls)
- **46 jack-o'-lanterns**: 3 InstancedMeshes (body/glowing face/stem) sharing one matrix
  per pumpkin; 10 ring the bonfire, the rest scattered on valid ground. Faces are a canvas
  texture (triangular eyes + jagged grin, warm glow) on an additive-friendly basic material.
- **Cobwebs**: corner-anchored web texture merged onto ~10 real streetlight poles
  (new `World.lamps` export feeds the positions).
- **Glowing zombie eyes**: ONE InstancedMesh (≤140) for the whole horde, matrices rebuilt
  each frame from head position/facing; skips dead + beyond 55 m. The night-horde shot.

### Changed — the night look
- Sky: sun position pushed **below the horizon** (Preetham dome goes night-blue/black);
  moonlight `0x93aedd` @0.95 replaces the sun, hemi `0x33456e/0x0c1008`, exposure 1.12.
- Fog: near 60→28, far 300→235, colour `0x161d2c` — the horizon dissolves; the Liseberg
  wheel ghosts in and out of the mist, Carlanderska stays fog-free on the skyline.
- **Lit windows now glow**: `facadeTex`/`glassTex` emit a second emissive-mask canvas
  (lit ratio 0.12→0.34 warm) wired as `emissiveMap` on facades + tower glass — the Gothia
  Towers read as occupied skyscrapers at night. Road markings dimmed (unlit basic mat).
- Streetlight **light pools**: one merged additive decal mesh with radial-falloff texture
  under every lamp (1 draw call). Menu/title get the 🎃 treatment.

### Verification
- 32/32 tests, tsc clean, build clean. A/B on the same view/moment: milestone J build
  212 draw calls (89 shadow) vs K build 228 — the whole night layer costs ~16 calls.
- Fixed at dev time: bonfire merge mixed indexed+non-indexed geometry (mergeGeometries
  → null → boot crash; `toNonIndexed()`); pumpkin instanced meshes need
  `frustumCulled=false` (origin-bound sphere would cull the whole arena's worth).
- Screenshots: spawn → lit towers + streetlight pools + pumpkins under stars; bonfire
  close-up with flame glow + ringed jack-o'-lanterns; horde at 21 m with glowing red
  eyes against the towers; Liseberg wheel + AtmosFear ghosting through the mist; the
  harvest moon over the western ridge.

## Previous milestone: J (draw-call optimization + real Liseberg & Carlanderska landmarks) — verified

### Added — landmarks outside the (invisible) boundary wall, at real OSM positions
- `src/landmarks.ts`: **Liseberg** south of the towers — Lisebergshjulet Ferris wheel at
  (74, 144) with slowly turning wheel + coloured gondolas, the 70 m AtmosFear drop tower,
  the red **LISEBERG** entrance gate facing the hotels, six ride pavilions at their real
  spots, Stora Scenen stage, ~90 park trees. **Carlanderska villan** on its hill at
  (-427, 266) — ochre villa + tower on a grass dome, west-southwest past Berzeliigatan.
- Positions verified against Overpass (probe scripts `tools/fetch-landmarks*.mjs`); the
  park sits SE of the arena, the villa ~330 m beyond the SW corner.
- Carlanderska renders **fog-free** (`fog: false`) so it reads as a permanent horizon
  landmark despite being past the 300 m fog line; Liseberg fogs naturally (the wheel is
  ~170 m from the hotel — clearly visible across the road, as in reality).
- All scenery merged into ~10 draw calls (one vertex-coloured paint mesh + steel + hill +
  2 instanced tree meshes + sign), no shadow casting.

### Changed — draw-call / shadow-map diet (the mobile bottleneck was calls, not triangles)
- Measured before: 266 draw calls, 195 shadow casters at 35 zombies (triangles only ~23 k).
- Zombie LOD (`zombie.ts`): 6 meshes each; beyond 25 m limbs go, beyond 55 m only the
  torso remains. Bucket switch only on level change; pooled resets restore parts.
- Traffic shadow LOD (`traffic.ts`): vehicles beyond 34 m stop casting into the shadow
  map (106 casters → ~12 near the player; a 1024 map can't show distant vehicle shadows).
- After: **129 draw calls** at 30 zombies (was 266 at 35), shadow pass ~12 vehicle
  casters + world. Landmarks add ~10 calls.

### Verification
- 32/32 tests, tsc clean, build clean. Browser: near zombie (12 m) keeps all parts
  (lod 0), mid bucket (10 zombies) limbless (lod 1); traffic shadow meshes 12/106.
- Screenshots: hotel plaza → Ferris wheel + LISEBERG gate across the field; south edge →
  wheel/gate/AtmosFear close-up; west edge → Carlanderska hill crisp on the horizon.

## Previous milestone: I (mobile GPU profile + context-loss self-infliction fix) — verified

### Changed — light graphics profile on phones (auto-detected via `pointer: coarse`, or `?low=1`)
- MSAA off, pixel ratio capped at 1.5 (was 2), shadow map 1024 (was 2048) — cuts GPU
  framebuffer memory ~5–8×, which is what stops Chrome reclaiming the context with many
  tabs open. Desktop profile unchanged (verified MSAA still on).
- Auto-degrade: if a phone still can't hold ~30 fps after 6 s of play, one-shot drop to
  pixel ratio 1 + shadows off (`degradeQuality`).
- Boot guard: no longer pops the menu over a running game on unrelated runtime errors;
  slow cold starts get 30 s instead of 20.

### Fixed — "Your browser reclaimed the 3D graphics" on every app switch
- Root cause was self-inflicted: the `pagehide(persisted)` handler called
  `renderer.forceContextLoss()` to free the GPU for bfcache — and the forced loss fired
  our own `webglcontextlost` handler, showing the "reclaimed" overlay. Android fires
  `pagehide(persisted)` on app switch / screen off, so the game declared itself crashed
  every time the user left the tab.
- Removed the forced loss. `pageshow(persisted)` now resumes seamlessly and only reloads
  if the context actually died (`isContextLost()`).
- Real context loss now also **pauses the game** (no dying behind the overlay) and the
  render loop polls `isContextLost()` as a safety net for losses that never fire the event.
- Persistent frame-loop exceptions show a "Something broke: <error> — TAP TO RELOAD"
  overlay instead of a white canvas with a live HUD.

### Verification
- 32/32 tests, tsc clean. Browser: `pagehide(persisted)` → context alive, no overlay,
  game keeps playing; `pageshow(persisted)` with live context → no reload; forced real
  loss → overlay + phase `paused`. Mobile profile confirmed (`antialias: false`), desktop
  unaffected (`antialias: true`).

## Previous milestone: H (mobile WebGL hardening, arena shrink, live traffic) — verified

### Fixed — mobile Chrome: reload error + white first play (Pixel 10 report)
- **Reload → "Error creating WebGL context"**: Android Chrome releases the previous page's GPU
  context asynchronously and reclaims contexts from background tabs (acute with many tabs open),
  so creation fails *transiently* right after a reload. Renderer creation now retries 4× with
  short waits, and the fatal message tells the player to close tabs if it still fails.
- **First play → white screen**: the game loop ran fine but Chrome had silently reclaimed the
  WebGL context (backgrounded/prerendered tab); the game rendered to a dead canvas. Added a
  `webglcontextlost` handler: preventDefault, stop rendering, show a *"Graphics were
  interrupted — close tabs, TAP TO RELOAD"* overlay; `webglcontextrestored` reloads.
- **Pointer-lock toast on mobile** ("To show your cursor…"): `requestPointerLock` is now skipped
  entirely on touch devices — drag-look doesn't need it.

### Changed — arena shrunk & re-centered (260×260 m, was 370)
- `WORLD.centerX/centerZ = (48, −8)`: re-centered on the district core between the Korsvägen
  crossing and Tower 3, so both stay inside the tighter map; all mapdata shifted at load.
- Fog tightened to 60/300; player start moved with the shift (−49, 82); tram-stop anchor
  updated to the re-centered crossing. Verified: 30-zombie level-1 cap still reached, no NaN.

### Added — moving traffic as hazards (`src/traffic.ts`)
- **Routes from real OSM geometry**: fragmented ways are chained endpoint-to-endpoint
  (`chainPolys` in world.ts) and trimmed to the arena (`longestInside`). Tram lines **5 & 6** run
  on the real rails (two chained routes, 277 m + 241 m); buses **3 & 57** on named arterials
  (Örgrytevägen/Skånegatan/…); **6 cars** on chained secondary→service streets. Car routes are
  geometrically deduped against bus routes so cars never drive through buses.
- **Vehicles**: two-car blue M28-style trams with lit "5"/"6" line boards + pantograph, Älvsbuss
  blue buses with "3"/"57" boards, sedans in 8 paint colors with head/tail lights. All
  ping-pong along their route, offset to the **right** of travel (Swedish right-hand traffic);
  trams stay on the rails (lane offset 0).
- **Hazards**: tram 85 dmg / bus 45 / car 28 to the player + sideways knockback + screen shake
  + crash sound, 1.4 s per-vehicle cooldown, 5 s spawn grace; trams & buses honk when you're in
  front of them (<16 m). Trams mow down zombies outright (1000 dmg), buses 150, cars 70 — kills
  route through `ZombieManager.damage`, so kill credit and weapon drops work as with gunfire.
- Verified headless: 10 vehicles, 0 boundary escapes over 30 s, tram dealt 85 dmg standing on
  the tracks, tram killed a spawned zombie (kill credited), worst step 1.4 ms @ 30 zombies.
- Visual: street-level shots of tram 5 at the tram stop, bus 3 on the arterial, cars in the
  right lane by the tower wall; bird's-eye shows both trams on the rails across the crossing.

### Tests
- 32/32 (new: `makePath` cumulative length, `samplePath` position/tangent/clamp,
  `distPointSeg` segment-vs-line). `tsc --noEmit` clean, `vite build` clean.

## Previous milestone: G (menu hardening, mobile controls, hot level 1, Pages-ready) — verified

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
