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
node tools/fetch-map.mjs          # re-pull OSM data (centered 57.69725, 11.98775, r=420 m)
node tools/fetch-map-shanghai.mjs # re-pull the Shanghai Expo OSM data
```

Click **START**, then play. Esc pauses (releases pointer lock), Enter/button restarts after death.
Board the **Flygbussen** (the navy airport coach among the blue buses) to teleport to the
small **Shanghai Expo** arena — a parked return coach sends you back to Göteborg.

## Current milestone: S (noodle stall + eating bunny + six stars in Shanghai) — verified

### Added — the noodle stall (`src/noodle.ts`, new)
- A red-canopied **牛肉麵 stall** on the west side of the Expo Axis plaza
  (local 26, 16): gold fascia, swaying lanterns, a big **麵** sign, an amber
  menu board (reuses `signTex` from traffic.ts), a steaming pot with looping
  steam puffs and a resident **Lisebergskanin** on a stool behind the counter.
- The bunny is always visible (landmark + hint): idle it twitches its ears
  and looks around; when you order it **dips its head three times, works the
  chopsticks and the noodle blob in the bowl shrinks to nothing**. The bowl
  sits to the bunny's side so the arm reads in profile from the bar instead
  of pointing at the camera.
- Stall body is one rotated-AABB collider pushed into the Shanghai collider
  set; `world.noodle` exposes `{ group, bar: {x,z,yaw}, colliders,
  setEating(p), update(time) }` (optional field on `World`, type-only import
  so there is no cycle).

### Added — eating to heal (`main.ts`)
- **E at the bar** (< 2.2 m, off cooldown, not riding): 2.6 s eating state —
  movement/fire locked, camera auto-turns to face the counter, immunity
  covers the whole bowl, one `sfx.slurp()` per head-dip, then **HP → 100**,
  gulp + bell, `🍜 BEEF NOODLES — HP RESTORED` popup, 12 s cooldown.
- Prompt order: dismount > slurping > noodles > shuttle > hijack. Eating
  resets on travel swap and restart.
- New audio: `sfx.slurp()` (bandpass-noise slurp + falling gulp tone) and
  `sfx.gulp()`.

### Changed — Shanghai always runs at six stars
- `state.threatLevel = inShanghai ? 6 : director.level(time)` — zombie HP and
  speed scale at level 6, HUD shows `★★★★★★` (☆ padding clamped so
  `repeat(-1)` can't throw), game-over screen prints six stars.
- Spawn pacing is pinned to max by feeding the director `time + 1e6` in
  Shanghai (its internal level() clamps at 5); drops still read the 5-level
  weight table (`rollDrop` index clamped). Measured: **52 zombies in 12 s**
  vs the slow Gothenburg ramp.

### Verified (browser sim, 0 console errors)
- Travel → stall exists, bar at (1227.55, 16) yaw π/2, player stands there
  un-shoved (first build had a `makeAABB` arg mix-up creating a 1.2 km
  collider — fixed to center+size).
- Eat at 40 HP: prompt `E — 牛肉麵 Beef noodles (restore HP)`, input lock
  (0 m moved holding W), yaw lerps to the counter, firing blocked, finish in
  157 steps → **HP 100**, cooldown 12 blocks re-order, expires → heal again.
- Threat 6 in Shanghai (`★★★★★★`), threat-6 zombie HP ≈ 1.45× level-1;
  return coach → home threat 1, `★☆☆☆☆`, no stall in Gothenburg.
- Screenshots: idle + mid-slurp close-ups and a plaza wide shot show canopy,
  sign, lanterns, steam, bunny + bowl. tsc clean, 32/32 tests, build ok.

## Previous milestone: R (Flygbussen → Shanghai Expo arena) — verified

### Added — the Flygbussen (`traffic.ts`)
- One of the two blue buses on the highway-bound route is now the **airport
  coach**: navy livery, white flank stripe, amber **SHANGHAI** sign boards and
  a roof beacon (`buildFlygbuss()`, exported for the return bus). Walk up to
  it and **E — Board the Flygbussen → SHANGHAI** appears; boarding blasts the
  horn, fades to black and teleports you.

### Added — Shanghai Expo arena (`src/shanghai.ts`, new)
- A second, **much smaller** arena island (160 m across vs Korsvägen's 260 m)
  living at x = 1200 in the *same* scene, far outside the Gothenburg fog.
  Built from real OSM data (`tools/fetch-map-shanghai.mjs` →
  `src/mapdata-shanghai.json`, © OpenStreetMap contributors, ODbL) around the
  **Expo Axis**: the Axis boulevard strip, three **Sun Valley glass cones**,
  the **China Pavilion** red four-tier crown just outside the NE wall (real
  bearing, landmark scale), the **Huangpu River** recessed behind the north
  quay (barges + a fog-free **Bund** silhouette on the far bank, same
  compression trick as the Gothenburg highway ribbon), neon-edged towers,
  trees, lamps and real clipped building footprints (中华艺术宫, 世博源…).
- **周家渡路** is the only real route through the arena → the Shanghai bus
  drives it; no trams ("Shanghai runs buses"), a small 4-scooter hooligan
  fleet, and a **parked return Flygbussen** on the plaza (E — back to
  Göteborg). Zombie spawns, trick surfaces logic and roadkill all work there.
- Geography reference: live map browsing was unavailable during this
  milestone, so bearings, footprints and the river come straight from the
  OSM extract (same pipeline as Gothenburg) plus the well-known Expo
  layout (Axis → pavilion, river to the north).

### Architecture — arena swap (`main.ts`)
- Player/zombies/projectiles/helpers share `world.colliders` **by reference**,
  so `setActiveArena()` splices that array in place and every system follows;
  `traffic` became a per-arena binding (`trafficG`/`trafficSh`, Shanghai +
  its atmosphere built **lazily on first travel**, only the active one steps).
- Travel is game-time driven (testable, no timers): 1.7 s trip, world swap at
  the blackout (clears zombies/projectiles/pickups/carrots/helpers, packs
  reset, 5 s traffic grace), fade back in, HUD arena label
  (`GÖTEBORG · KORSVÄGEN` ↔ `SHANGHAI · 世博园区`) + 🚌 popup.
  Restart always drops you back in Gothenburg.

### Verified (browser sim, 0 console errors)
- Board → fade 1 → swap after 103 steps → fade 0; player lands at the Expo
  playerStart (1252, 34); colliders swap 129 ↔ 27; label switches.
- Shanghai traffic: 1 bus + 4 scooters (4 riders), all on the island, no
  trams; after 15 s the horde holds **28 zombies, 0 stranded** outside;
  pistol **headshot kill** works; quay wall blocks the player at wall+radius.
- Return bus prompt → board → back in Gothenburg (colliders restored);
  restart from Shanghai → home; both directions re-boardable; 0 errors.
- Screenshots: the Expo Axis at dusk (pavilion tiers + glass cones + the
  parked SHANGHAI coach), the Huangpu with barge + Bund skyline, and the
  Flygbussen in Korsvägen traffic.

## Previous milestone: Q (carrot drops → AI bunny helper on a kickbike) — verified

### Added — carrots (`main.ts` + `zombie.ts` `wasRiding`)
- Zombies drop **carrots** on death: 5 % normally, **35 % for scooter-riding
  hooligans** (they carry the good stuff). `kill()` now records `wasRiding`
  before clearing `ride`, so `onKill` can weight the roll.
- Carrots are a glowing orange cone + greens that spin and bob; **walking over
  one** auto-picks it up (no E needed), plays the pickup chime and pops a gold
  **🥕 BUNNY HELPER!** banner.

### Added — the helper (`src/bunny.ts`, reuses `rabbit.ts` + `traffic.ts`)
- Each carrot spawns a **Lisebergskanin on a VOI kickbike** — the player's
  rabbit mesh (on the deck, y 0.18) parented to the exported `buildScooter()`
  mesh — one of up to **3** simultaneous champions (oldest recycled), each with
  **45 s** of carrot power (blinks out in the last 3 s).
- AI: charges the **nearest zombie** (steer-rate 2.6 rad/s, top speed 7.5 m/s,
  leans into turns, slides along world colliders), idles in reach and
  **chainsaws** it: 55 dps in 0.25 s ticks with a shove, `byPlayer` attribution
  (kills count, fatalities can pop), stuttering `sfx.chainsaw` buzz while
  cutting and a dying growl when done. With no action it patrols the player.
- Verified in browser sim (12 assertions): rider kill dropped a carrot (2
  kills); auto-pickup spawned the helper + emoji popup; helper charged 8.4 m
  and chainsaw-killed a zombie (kill credited); cap at 3 with oldest recycled;
  lifetime expiry despawns; restart clears helpers + carrots; 0 console errors.
- Screenshot: the kickbike kanin mid-chainsaw on a zombie, Gothia Towers and
  the Liseberg wheel behind.

## Previous milestone: P (scooter tricks on benches & parked cars) — verified

### Added — rideable surfaces (`world.ts` + `collision.ts`)
- `buildWorld` now exports `surfaces: RideSurface[]` — the rideable tops of **parked
  cars (1.55 m), park benches (0.5 m) and tram-stop barriers (0.9 m)**, each linked to
  its collider. `resolveCircleWorld` gained an optional `skip` predicate: a ridden
  scooter passes through a surface once the deck is above it (step-up 0.55 m, so
  benches can simply be **driven up onto**, car roofs need a jump).

### Added — jump & vertical physics (`traffic.ts` + `config.ts` + `main.ts`)
- The ridden scooter gained `y/vy` physics (gravity 18, jump impulse 7.6 → apex
  ~1.6 m, clears a car roof). **Space / touch-jump** hops; landing on a surface snaps
  the deck onto its top, riding off an edge drops you back to the asphalt.
- Chase cam and the Lisebergskanin follow the hops (rabbit `y = 0.18 + v.y`, cam
  height `2.15 + 0.85·v.y`); roadkill only triggers while low (`y < 0.55`), so
  airborne you fly over the horde.

### Added — trick scoring (`traffic.ts` → `state.ts` / `hud.ts` / `audio.ts`)
- **Steer mid-air to spin** (10 rad/s): a full revolution lands as **360 SPIN +100**
  (multi-revs: 720/1080…). **Jump again mid-air = TAILWHIP +50** (deck flips under
  the rabbit), **BIG AIR +50** (airtime > 0.62 s), **ROOF TOP +75** for landing on a
  car roof or barrier. Tricks stack (`360 SPIN + TAILWHIP + BIG AIR`), play a ding,
  and pop a gold **`#trickpop`** banner plus a **Tricks** counter in the HUD; points
  accumulate in `state.trickScore` for the run.
- Verified in browser sim (20 assertions): jump apex 1.54 m & landing; BIG AIR,
  360 SPIN (+150 with BIG AIR), TAILWHIP (+100) and ROOF TOP (+75) all scored;
  drove a scooter **up onto a bench** (y snaps 0 → 0.5, mesh follows, rides off the
  far end); parked car **blocks** ground driving but not above the roof; landing on
  the roof scores; rabbit rides up with the deck; HUD popup text/opacity and counter
  (`Tricks: 375`) correct; roadkill still credited on the ground.
- Screenshots: rabbit parked on a red car roof, riding along a park bench, and
  frozen mid-air at apex with a 4.3 rad spin under the chase cam.

## Previous milestone: O (scooter: fixed steering, third-person cam, Lisebergskanin player) — verified

### Fixed — scooter steering was inverted
- Forward is `(sin h, cos h)`, so **increasing** heading turns LEFT — the old
  `heading += steer` made the right key steer left and vice versa. Now `heading -= steer`
  (and the lean sign flipped with it, so the scooter still leans into the turn).
  Verified: D → heading −1.2 rad, A → +1.2 rad, lean rotZ > 0 while turning right.

### Added — third-person riding as the Lisebergskanin (`rabbit.ts` + `main.ts`)
- While riding, the camera becomes a smoothed chase cam (3.4 m behind, 2.15 m up,
  look-ahead at the road), the weapon viewmodel hides, `player.yaw` snaps to the scooter
  heading (shots fly where you drive) and pitch is levelled.
- The player **is a Lisebergskanin**: a procedural white rabbit — long swept-back ears
  with pink insides, eyes, nose, paws on the handlebars, fluffy tail, long feet on the
  deck — one merged vertex-coloured mesh (1 draw call), visible only while riding,
  leaning with the scooter's turn tilt.
- Verified in browser sim (16 assertions): kill rider→drop→mount→ride; steering both
  ways + lean; camera behind & at height; rabbit on deck; viewmodel hidden; shots
  forward; roadkill still credited; dismount restores first person + viewmodel.
- Screenshots: chase-cam view of the rabbit driving past tram 57; front close-up of
  the rabbit on the deck.

## Previous milestone: N (fatalities, headshots, rider eye alignment) — verified

### Added — headshots (`zombie.ts` raycast + `main.ts` hitscan)
- `ZombieManager.raycast` now returns a `head` flag: the ray must pass within
  `FATALITY.headRadius` (0.24 m) of the head's vertical axis **and** cross it inside the
  head's local height band (1.48–1.95 m above the mesh origin — so a rider standing on a
  scooter deck at +0.18 m has the hitbox lifted with them).
- Head hits deal **2.5× damage** (`FATALITY.headMult`), play a bright metallic *tink*
  (`sfx.headshot`), spray blood at skull height and flash a **golden "✕ HEADSHOT"
  hitmarker** (plain red ✕ for body hits). Works per shotgun pellet.

### Added — fatalities: zombies sometimes explode (`zombie.ts` + `fx.ts` gore chunks)
- `damage()` takes an attribution `opts { headshot, byPlayer }`; `kill()` rolls the
  fatality: **headshot kills always detonate**, other player kills 15 % of the time
  (`FATALITY.chance`). Traffic/ambient deaths never do (no attribution → no roll).
- A fatality hides the corpse (`mesh.visible = false`, pool-safe — `spawn()` restores it)
  and bursts it: 26-particle blood cloud + **10 flying gore chunks** (blood/flesh/bone
  colored) from a pooled 90-slot `InstancedMesh` in `Fx` — one draw call, gravity, ground
  bounce, spin, shrink-out after ~1.5–2 s. Plus a red flash, `sfx.gore` wet detonation and
  camera shake.
- Player attribution wired at every player damage site: hitscan, melee, chainsaw,
  explosion splash and scooter roadkill.

### Fixed — glowing eyes floated off scooter riders
- `halloween.ts` placed every zombie's eye instances at a fixed y = 1.6, but a rider's
  mesh is lifted 0.18 m onto the deck — the eyes sat in the rider's chest. Eye height is
  now `1.6 + z.mesh.position.y`, so riders' eyes ride along (verified: instances at both
  1.6 and 1.78 with 12 riders out).

### Verification
- tsc clean, 32/32 tests, build clean. Browser sim (20 assertions): head/torso/legs/chin
  raycast bands incl. lifted rider band; real `fireWeapon` path — headshot 67.5 = 27×2.5,
  body 27, gold HEADSHOT marker in DOM then back to plain red; headshot kill → `exploded`,
  corpse hidden, kill credited, 10 gore chunks alive in the instanced pool; 3/40 body kills
  detonated (≈15 %), 0/20 unattributed kills; rider headshot kill releases its scooter.
- Screenshots: fatality mid-burst (chunks + blood spray, corpse gone); rider head-on with
  glowing eyes correctly on the head.

## Previous milestone: M (zombie scooter riders — hijack, roadkill, battery, despawn) — verified

### Added — hooligans on scooters (`zombie.ts` + `traffic.ts`)
- Every street scooter now carries a **zombie rider**: a real pooled zombie linked to its
  vehicle via a shared `RideAnchor` (pos + heading). While linked its AI is suspended —
  the scooter drives, the zombie poses on the deck (welded to the deck every frame, so
  no LOD-throttle lag on the mesh). It can still be shot/melee'd like any zombie.
- Riders are **traffic-immune** (`z.ride` skipped in the vehicle-mow loop): without this,
  cars on shared routes mowed the whole fleet within seconds of spawn (70 dmg vs 42 hp)
  and the feature ate itself. Only gunfire, melee, explosions and player roadkill drop them.
- **LOD keeps rider legs** at level 1: a legless torso hovering over a scooter read as a
  bug in screenshots, not as a hooligan.

### Added — hijack & drive (the "equip a scooter" flow)
- **Kill the rider → the scooter drops**: coasts to a stop along its route, tilts onto its
  kickstand, bell chirp, waits 30 s to be "towed away" (blinks the last 3 s).
- **E (or the touch pickup button) near a dropped scooter = mount** — same key-press feel
  as equipping a weapon; prompt "E — Hijack the scooter" overrides pickup prompts.
- **Riding**: W throttle / S brake+reverse / A–D steer (touch stick: push = throttle,
  strafe = steer). Top speed 9.5 m/s, lean into turns, camera rises 0.15 m onto the deck.
  `Player.riding` hands horizontal movement to `Traffic.updateRidden` (which reuses the
  world collision resolver with a 0.5 m radius); you keep aiming/shooting while driving.
- **Roadkill**: above 2.5 m/s the deck mows zombies (60 dmg + knockback) through the
  normal damage path — kill credit, blood fx, drops all work. `hitFlash` guards re-hits.
- **Battery** (20 s full-throttle capacity, random 6–20 s when found): drains with speed,
  HUD battery bar (yellow → red under 25%) while riding. At zero the deck dies under you
  (crash sfx), you're stranded beside it and the husk is towed after 5 s.
- **Despawn & refill**: dismounted scooters are towed after 12 s; the streets always refill
  to the full fleet of 12 (up to 3 new rider-equipped scooters every 6 s). `traffic.reset()`
  rebuilds the whole fleet + riders on restart (old riders die with `zombies.clearAll`).

### Verification
- 32/32 tests, tsc clean, build clean; 148 draw calls at spawn (riders reuse the zombie
  LOD system; riders near the player are full meshes, distant ones collapse).
- Browser lifecycle sim (hidden-tab `step()` driving): 12/12 riders anchored and stable
  over 60 s (no traffic attrition after the immunity fix); kill→drop→prompt→mount→
  throttle to 9.5 m/s→roadkill credited (+1 kill)→battery zero→stranded + `dead` state→
  towed away→fleet refilled to 12/12; restart rebuilds 12 scooters with riders.
- Screenshots: rider standing on the yellow deck (full LOD, from behind); first-person
  riding view (deck at feet, road ahead); battery bar confirmed in DOM (`display:block`,
  width tracks `battery/20`).

## Previous milestone: L (dusk rebalance, moon-direction fix, autumn trees, Gårdsmotet highway, VOI scooters) — verified

### Fixed — the moon/sun was in the wrong direction
- Compass azimuth 232° (SW) was fed straight into `setFromSphericalCoords`, but three.js theta
  runs from +Z(=south) toward +X(=east): the correct mapping is `theta = 180° - azimuth`.
  The night build's "SW" moon actually rose in the **NW**. Fixed in `main.ts`; the moon,
  the key light and the sky afterglow now all sit over the SW — behind Carlanderska's hill.

### Changed — night → dusk (it was too dark)
- Sky: sun at **+1° elevation** SW (just above the horizon), rayleigh 2.0, turbidity 8 —
  twilight-blue dome with a bright orange afterglow band instead of a black night dome.
- Key light `0xffa268` @1.9 (was cold moonlight 0.95), hemi `0x7688b4/0x33291c` @1.05,
  exposure 1.12→1.32. Fog: `0x4d5573`, near 32, far 255; grass `0x2f3322`.
- Stars fade to opacity 0.22 (dusk washes them out); mist tinted warm mauve; window
  emissives dialled down (1.4→0.95, 1.1→0.8) since ambient light is back.

### Added — autumn foliage
- Liseberg park trees + arena trees now use per-instance `setColorAt` from an autumn
  palette (orange/red/yellow/brown/olive) over a white leaf material — late-October
  Gothenburg. No extra draw calls.

### Added — the E6 at Gårdsmotet (`src/highway.ts` + `tools/fetch-highway.mjs`, 2 draw calls)
- New Overpass pull (r=1600 m, motorway/trunk/links) stored as `mapdata.motorways`: the
  E6/Lundbyleden mainline + Gårdsmotet ramp cluster sit ~230 m **east** of the arena —
  outside the solid boundary, so it's horizon scenery like Carlanderska.
- Fog-free asphalt ribbon (clipped to a 520 m radius so nothing floats past the ground
  plane) + **64 flowing head/tail-lights** (one additive Points draw call, white one way,
  red the other) — the motorway reads as a live stream of light on the dusk horizon.

### Added — VOI e-scooters (`traffic.ts` + `sfx.bell`)
- New vehicle kind `scooter`: 12 VOI-yellow scooters on the car routes — they **weave**
  (±0.5–1 m lateral sine), **stop and go** randomly, ding an annoying bell within 9 m,
  bump the player for 8 dmg (tiny knockback) and still mow zombies (20 dmg).
- Each scooter is ONE merged vertex-coloured mesh (12 draw calls instead of ~70).

### Verification
- 32/32 tests, tsc clean, build clean. Draw calls 176 at spawn with 12 scooters + highway
  (scooters as separate-part groups measured 301 — the merge saved ~125).
- Screenshots: NE spawn under a lit tower with twilight sky; SW afterglow with the moon
  behind Carlanderska + bonfire/pumpkins; E horizon with the Gårdsmotet light-stream;
  Liseberg wheel + AtmosFear framed by autumn trees; VOI scooter close-up (yellow stem,
  deck, handlebar); star zoom confirming no sprite artifacts.

## Previous milestone: K (Halloween night: moon, mist, lit windows, jack-o'-lanterns, glowing eyes) — verified

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
