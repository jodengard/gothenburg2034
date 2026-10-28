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
npm test         # 61 unit tests (pure logic + headless zombie sim + traffic path math)
node tools/fetch-map.mjs          # re-pull OSM data (centered 57.69725, 11.98775, r=420 m)
node tools/fetch-map-shanghai.mjs # re-pull the Shanghai Expo OSM data
```

Click **START**, then play. Esc pauses (releases pointer lock), Enter/button restarts after death.
Board the **Flygbussen** (the navy airport coach among the blue buses) to teleport to the
small **Shanghai Expo** arena — a parked return coach sends you back to Göteborg.

## Current milestone: Shanghai 2.6 — stall clipping fix + street life — verified

- **Boomer height normalised** (user tuning): the boomer mesh was scaled
  `(1.5, 1.22, 1.5)` — wider *and* taller than a normal zombie, which pushed its
  head above the fixed headshot band (1.48–1.95 m) and the raycast height cap, so
  its skull was effectively un‑shootable. Now `(1.5, 1, 1.5)`: **same height as a
  normal zombie, width kept** (collision radius still 1.7×, so the fat belly still
  sets off contact detonation) and the head realigns with the headshot band.

- **Noodle stall clipping fixed in place**: the plaza shrub rows were growing
  *through* the stall (their `pushShrub` guard only checked colliders, and the
  stall's colliders land after the greening pass). Rather than move the stall,
  it stays at its original spot west of the Axis and the area around it is kept
  clear: `pushShrub` now runs the same `clearOf` keep-out the trees/poles use,
  so the shrub row breaks around the stall's 4.5 m clearing. The chef bunny and
  the bowl drop follow `n.bar`, so nothing else had to move.
- **Street life** (all procedural, mostly instanced, seeded): a glass **bus
  stop** on the real 周家渡路 with a 周家渡路 route board + waiting bench; a
  yellow **shared-bike** fleet (共享单车 — frame/handlebar/wheel instanced, 3
  draws) parked along the Axis and at the kerb; two stone **chess tables** with
  stools under the plaza trees (retiree territory); **litter bins** beside the
  plaza benches (kept away from the stall). Placement dodges towers, the
  skewed-road tree row and each other. 61/61 unit tests; live bundle
  `index-yKVMCwh8.js`.

## Previous milestone: Shanghai 2.5 — greening & street life (make it feel like home) — verified

- **Plane-tree boulevard**: the real 周家渡路 arterial (OSM) lined with rows of
  instanced trees (法国梧桐 rows on both sides + grass verge patches) — the
  signature Shanghai concession avenue. Tree canopies carry a Shanghai palette:
  plane greens + ginkgo gold (`SH_LEAF`, per-instance colors).
- **外星公园 greened**: the actual OSM park polygon south of the arena gets a
  `ShapeGeometry` lawn + a dense procedural copse (point-in-poly sampling) +
  shrubs — a real green horizon landmark beyond the walls. New pure helper
  `pointInPoly` in `collision.ts` (unit-tested).
- **Expo Axis life**: tree rows flanking the plaza, **red lantern strings**
  (instanced lanterns + gold caps + sag, on red poles with visible wires) down
  the Axis, azalea beds (杜鹃) between the trees and ringing the Sun Valley
  cones, and park benches facing the plaza.
- **Lit Chinese signage** — canvas-texture signs (browser CJK font, zero
  assets): vertical red-and-gold boards on the neon towers (上海欢迎您 / 世博轴 /
  中华艺术宫 / 百货大楼 / 世博源), a real green 周家渡路 street plate, and a 茶
  board by the noodle stall.
- **Expo Axis canopy**: the OSM `roof` footprint (previously skipped) rebuilt
  as a floating translucent membrane on white columns — the Sun Valley cones
  poke through it exactly like the real structure.
- All greenery is **instanced** (trunks/canopies/shrubs/lanterns/poles/wires =
  7 draw calls for ~90 props) and seeded (`mulberry32`) — identical every
  build. Placement respects colliders, the shuttle deck, the stall and the
  player start. Live: 129 draw calls / 24k tris with 60 zombies; 14 packs
  spawned in 30 s (spawn validity intact). 61/61 unit tests.

## Previous milestone: Enemy — the Charger v2 (charger branch) — verified

- **Flamethrower nerf + broom mode** (user tuning): stream damage cut **75 %**
  (6→1.5/tick = 30 dps direct, burn 22→5.5 dps) and the stream gained **real
  knockback** (`FLAME.knockback: 2` m/s shove per tick, up from a token 0.5) —
  the weapon is no longer a blender but a broom: live, 1 s of stream costs a
  zombie 35 hp (was ~142) and drags it 1.5 m backward mid-charge.

- **The Charger**: a **completely black** (suit, head AND arms all 0x141414 — pool
  reuse hands the skin back to everyone else) quadrupedal freight train, mesh
  1.9×/2.0× (boomer 1.5×, normal 1×), radius 1.9×, **4× normal HP**.
- **Runs on all fours**: spawn re-rigs the limbs (spine horizontal via animate,
  head carried low & far ahead, hind legs back, forelegs under the chest) with a
  gallop gait that doubles cadence mid-dash — and it **rears up on its haunches**
  during the 0.7 s windup bellow (the telegraph got a lot more readable).
- **The charge**: sees you within 10 m → bellow + rear → committed straight-line
  dash 13 m/s for 0.9 s. Contact = 16 dmg + `player.knock()` launch (22 m/s
  horizontal + 6.5 lift — airborne = no speed clamp, ~16 m of flight).
- **Mows the horde**: anything caught in the dash lane gets bowled over —
  20 m/s launch + 10 dmg, guaranteed stagger, `mowCd` guards one hit per windup
  (a boomer killed mid-mow detonates: the horde eats its own).
- **Limits**: threat 2+, 1 per pack, **max 3 alive in the arena** (live: 14
  spawned in 3 min at threat 4, never more than 3 standing).
- **Balance pass** (user tuning): charger HP 3.5×→**4×**, boomer HP 5×→**2×**,
  headshot multiplier 2.5×→**3×** (the low quadruped head sits inside the
  headshot band — live raycast at eye height returns `head: true`).
- **Solid carcass**: a fallen charger **lies on the ground 12 s** (`corpseLife`)
  and **blocks the player** within 1.3 m (`blockers()` resolved in main.ts after
  `player.update`) — zombies trample it, you walk around it — then it sinks as
  usual. Live: minimum player distance pinned at exactly 1.72 m (1.3 + player
  radius) while solid, walked straight over the spot after it sank.
- **Verified live**: mow — 2 victims launched, peak 19.4 m/s; cap — maxAlive 3;
  headshot — 78 dmg from a 26-dmg pistol; corpse — blocked then passable.
  60/60 unit tests (new: full-black + quadruped rig + pool-reuse reset, mow
  launch/damage/once-per-windup, blocker lifetime).

## Previous milestone: Weapons — Flamethrower & BFG-9000 — verified

- **Flamethrower** (`flame`): auto weapon, ammo = fuel (100-unit tank, 20/s burn rate,
  one extra tank per pickup, 2.6 s reload). The stream is a 11 m / 14° half-angle cone
  that **stops at walls**
  (per-hit LOS check — no roasting through concrete): 120 dps direct + **ignition** —
  burning zombies tick 22 dps for 3 s (refresh, not stack). Burn goes through
  `damage()` with player attribution, so a burning boomer still detonates on death.
  Charred orange emissive suit while burning + fire-lick particles (`fx.burnFx`) +
  short roar per tick (`sfx.flame`) that stacks into a continuous belch.
- **BFG-9000** (`bfg`): Quake II's green sun. Slow (26 m/s) glowing plasma ball with a
  pulsing mesh + green mote trail (`fx.bfgTrail`); detonates on zombie/wall/ground for
  **320 damage in a 9 m radius** (bazooka: 130/5.5) with heavy knockback and a 55 self
  damage tax at point-blank. Drops only at five-star threat. Deep thunderclap fire
  sound (`sfx.gunshot('bfg')`).
- **Plumbing**: `ProjectileManager` gained a third kind (`bfg`) with per-slot mesh
  swapping (`meshKind`) and `onExplosion(pos, big)` so the handler picks the right
  blast def; `Zombie` gained `burnT/burnTick` + `ignite()`; view models are procedural
  (flamethrower: body/barrel/grip/tank/pilot-light; BFG: fat cannon + muzzle ring +
  glowing core) with themed muzzle flash colors (orange/green).
- **Unique drops + blue shimmer**: only ONE flamethrower/BFG may lie in the world at a
  time (`dropAllowed` in `weapons.ts` — a rare never drops while any rare pickup exists;
  normal weapons unaffected). The rare crates glow **cold blue** instead of gold, carry
  a pulsing blue point light and shed rising `fx.shimmer` sparkles so they spot
  themselves across the arena. Live: 300 kills at five stars → 45 drops, ~7 rares
  rolled, exactly 1 existed; light pulses, sparkles rise.
- **Clip economy** (user tuning): a flame/BFG pickup grants exactly **one extra clip**
  on top of the loaded one (flame 100/100, BFG 4/4 — was 100/150 and 4/12), and the
  **chainsaw now has infinite ammo** (`fuelUse: 0` — the tank never runs dry; live:
  10 s of continuous sawing leaves fuel at 100 and it still fires).
- **Verified live**: flame — 10 fuel burned in 0.67 s, `burnT` applied, 104 hp lost,
  burn finished a 30 hp zombie (`state='dead'`), 6 zombies ablaze in one sweep; BFG —
  ball mid-flight, boom on contact, **12 kills from one shot**; pickup flow (E over a
  crate) swaps both view models (5/4 meshes) and ammo pools. 54/54 unit tests
  (5 new: drop tables, burn ticks + attribution, burn kills, ignite refresh-not-stack,
  unique-drop rule).

## Previous milestone: Shanghai 2.0 (shanghai-2.0 branch — six stars forever, pressure without end) — verified

- **The HUD lies on purpose**: Shanghai's star row now stays pinned at 6 forever
  (`state.displayThreat`), while a hidden pressure level climbs +1 every 30 s and never
  stops. Game over also caps at six; the true level still feeds the high score internally.
  The only tell is the `⚠ THE EXPO SURGES!` banner every step.
- **Ramp turned up until it actually overwhelms**: cap +8/step (ceiling 96), spawn
  interval ×0.88/step (floor 0.5 s), pack size +1/step (cap 20). By pressure 12 (~4 min)
  packs of 12–14 land every ~0.6 s.
- **Verified live**: 5-min soak — stars 6 the whole way, pressure 6→15, population
  60→95+ pinned from minute 3, 0 NaN, 0 errors, 0.413 ms/step at ~95 zombies.
  49/49 unit tests.
- **Follow-up — no moving Flygbussen in Shanghai**: the airport coach only runs in
  Gothenburg now (`Traffic` opts `flygbuss: false` for `trafficSh`); its old route on
  the 周家渡路 arterial runs normal car traffic instead — two cars on tight half-ranges
  (the arena's only street is 37 units, so the standard 150 m split and 4 m margins
  rejected the spawns; margins trimmed to 2). The parked return coach on the plaza is
  untouched and still boards the trip home. Verified live: Gothenburg flyg=1,
  Shanghai flyg=0 / cars=2 both driving / shuttle intact.

## Previous milestone: Shanghai endless escalation (zombies-2.0 — the stars never stop) — verified

- **Shanghai threat is no longer pinned at 6**: arrival still runs the 10 s calm, then
  the rating climbs **+1 star every 30 s forever** (`shanghaiThreatFor`, counted from
  the first wave). Each step banners `★ N STARS — THE EXPO SURGES!` with a pack howl.
- **More and more**: past level 5 the spawn table extrapolates (`threatParams`) —
  pop cap +4/star (ceiling 72 for the 60 fps budget), spawn interval ×0.93/star
  (floor 0.7 s), pack size +1 every 2 stars (cap 14). Zombie HP keeps scaling linearly;
  speed scaling caps at threat 12 so a sprint always outruns the horde.
- **Fixed on the way**: boomers never spawned in Shanghai (`FAT.chance[5]` was
  undefined) — the chance table now clamps, and the soak confirms them.
- The director's `+1e6 time credit` hack is gone: `director.update` takes a live
  `levelOverride` instead. HUD star row simply grows past 6.
- **Verified live**: 150 s in Shanghai — threat 6→7→8→9→10 at exactly 30 s intervals,
  0 NaN, 0 errors. 48/48 unit tests (2 new).
- **Follow-up — the escalation was cosmetic, now it overwhelms**: the first cut never
  passed `state.threatLevel` into `director.update` (optional arg, tsc silent), so the
  director kept spawning at the time-based level (~41 cap) no matter the stars. Fixed,
  plus a wiring regression test (override 10 must spawn [8,10]-packs). Re-soak: pop
  56 on arrival, pinned at cap every star — 60→72 by star 13, packs of 7–11 landing
  ~every 1.2 s. 0.298 ms/step at 72 zombies. The Expo is now a wall of bodies; the bus
  home stops being optional. 49/49 tests.

## Previous milestone: Fat boomers (zombies-2.0 — contact-detonating boomers + shit-clouds) — verified

- **The boomer class** (`FAT` in `config.ts`, `fat` flag in `zombie.ts`): gut-bloated
  (mesh 1.5× wide, strained olive suit), 5× HP, half speed, wider hitbox. Joins packs
  from threat 3 (10–16 % per member, max 2 per pack, never scooter riders, never
  tactical roles — they just shamble at you).
- **Contact detonation**: belly-to-player contact (2.1 m, LOS required) blows the gut —
  up to 30 blast damage with falloff, screen shake, gore, the corpse consumed
  (`exploded`), and 15 blast damage to nearby zombies (the horde eats its own).
- **Death detonation**: a boomer now explodes on ANY death — bullet, chainsaw, traffic —
  with the full blast + gas treatment. The one safe kill is a clean head kill (headshot
  or melee to the skull): drop the brain and the guts stay put. Body-shotting one at
  melee range is therefore a trade; aim for the head or kill from distance.
- **Shit-clouds** (`src/gas.ts`): a 4.5 m, 7 s pool of 4 swirling translucent green
  clouds (14 puffs each, spread + rise + fade). Standing in one costs 6 hp/s in
  0.6 s ticks with a cough; zombies don't mind — they already smell like this.
- **Verified live**: 22.3 blast damage at exactly the predicted 2.1 m falloff point,
  18 gas damage over 3 s of breathing, 5-min threat-4 soak: 21 organic detonations,
  0 NaN, 0 errors. 46/46 unit tests (6 new).
- **Follow-up — carrots heal**: walking over a carrot now also restores 15 % of max HP
  (`BUNNY.healFraction`) on top of summoning the bunny helper; the trick banner shows the
  healed amount and it never overheals past max. Verified live: 50 → 65 HP, 100 → 100.
- **Follow-up — throwers nerfed**: throws now scatter around the lead point
  (`PACK.throwSpreadMin` 0.8 m + 12 % of throw distance, uniform disc) instead of nailing
  the prediction exactly — dodging by backing off or breaking LOS is now reliably worth it.

## Previous milestone: Zombies 2.0 (zombies-2.0 branch — pack knowledge, audible tactics, real preparation) — verified

Re-audited the AI against the original pack-intelligence spec and closed every gap:

### Shared pack knowledge (the big one — also fixes a spec violation)
- **Before:** flankers and interceptors steered at the player's *live* position even
  through solid walls (magic knowledge — a direct violation of "no magic through
  obstacles"). Only pursuers respected last-known.
- **Now:** `Pack.known` — any member with line of sight "howls" a **fuzzed** (±1.5 m)
  player position to the pack; the guess decays after `PACK.knowledgeFresh` (6 s) and
  every member steers on `z.order` (the shared guess) → own `lastKnown` as fallbacks.
  Live position/velocity is used only while the pack actually has eyes (`orderFresh`).
  The howl is the justification, and it is **audible**: `sfx.growl()` fires on a fresh
  sighting and on assault start (4 s throttle per pack — 34 howls heard in a 60 s soak).
- Pack **assault state**: fresh knowledge + a body inside the pressure radius →
  flankers drop the stand-off and commit (`PACK.assaultCommit`).

### Readable threats
- **Visible preparation:** the carried object now rides the zombie's raised hands
  (chest height while picking a lane, overhead at 2.05 m during the 0.85 s windup,
  wobbling) instead of invisibly vanishing; a carrier that dies drops it visibly at
  the corpse (was: freed but permanently invisible).
- **Opportunity attacks:** a flanker/interceptor that actually made it behind the
  player's back (`attacksFromBehind`, dot < −0.25) gets +1.1 m melee reach — the
  observable payoff of the pack's maneuver; verified: 2.6 m behind → strike, 2.6 m
  in front → nothing.
- **Throws lead the target:** aim point = player + velocity × 0.35 s (capped 2.5 m) —
  standing still is a guaranteed hit, sprinting sideways beats the throw; dodging is
  now a choice.

### Verified live
- Knowledge propagates (fuzz ≤ 1.5 m), goes stale without eyes (orders → null),
  assault engages with pressure, barks fire (barkT → 4 s after sighting).
- Blind + out-of-earshot pursuer heads its own memory, **not** the live player.
- 5-minute organic soak at threat 5: 194 grabs → 64 windups → 57 completed throws,
  0 NaN, 0 errors, 0.185 ms/step with 31 zombies / 7 packs.
- 40/40 unit tests (5 new: sighting fuzz, staleness, assault bark, no-sighting
  silence, flank detection); tsc clean.

## Previous milestone: U (optimizations branch — 1:2 maps + collider grid + chainsaw buff) — verified

### Changed — both arenas are now 1:2 miniatures (closer, denser, cheaper)
- `WORLD.scale = 0.5`, `halfSize` 130 → **65 m**: every OSM coordinate, road width,
  building, parked car, lamp, tram rail and landmark in Gothenburg is multiplied by
  `S` at build time (`src/world.ts`); `landmarks.ts` / `highway.ts` root-scale or
  shift with the same factor. Shanghai mirrors it: exported `SH_SCALE = 0.5`,
  `SH_HALF = 40`, OSM points scaled at load, hand-placed props through `X()`
  (original units) vs `Xw()` (already-scaled) so nothing double-scales (`src/shanghai.ts`).
- **Player-scale objects stay real size**: benches, barriers, throwables, scooters,
  pickups, trees, pole/shelter heights, the noodle stall bar and the bowl drop
  (`0.95 * SH_SCALE` counter height) — **and every vehicle**: trams, buses,
  cars, the Shanghai shuttle and parked cars keep real geometry, hitboxes and
  rideable roof height; only their lane offsets and positions follow the
  scaled streets (speeds and damage unchanged). The highway ribbon stays
  miniature (horizon scenery).
- Threat spawn ring tightened to 18–30 m; atmosphere embers now scatter over
  **each arena's own bounds** (derived from the boundary-wall colliders), so the
  Shanghai island finally gets its own fireflies (`src/atmos.ts`).

### Added — `ColliderGrid` for line-of-sight (`src/collision.ts`)
- 12 m uniform grid (Map of cells, Amanatides–Woo DDA walk, per-query
  generation-stamp dedupe). `segmentBlocked` uses it once a world has ≥ 96
  colliders, falls back to the linear scan below that; lazy rebuild on array
  identity change + `invalidateColliderGrid()` for the in-place arena swap
  (called from `setActiveArena`).
- This was the dominant CPU cost: 7 LOS probes × ~60 zombies × every collider
  per AI tick. **3 new unit tests** prove grid ≡ linear scan and that
  invalidate picks up in-place mutation (35/35 green).

### Changed — chainsaw (`src/config.ts`, `fx.ts`, `main.ts`)
- Damage **55 → 90 dps** (~1.6×; measured 86.4 dps live through cooldown phase).
- New `fx.smoke()`: buoyant gray puffs (negative gravity, 0.6–1.1 s life) — the
  saw now trails a plume from the bar while cutting (3 particles per chain tick).

### Added — 10 s arrival calm in Shanghai (`main.ts`)
- `spawnGrace = 10` set on the swap into Shanghai; the director's spawn-pack
  callback stays silent until it runs out (threat clock keeps ticking).
  Verified: **0 zombies after 10 s standing still**, then the threat-6 horde
  (41 zombies) arrives within the next 10 s.

### Perf evidence (same 50-zombie ring benchmark, 600 sim steps)
| build | step ms/frame | zombies alive | colliders |
|---|---|---|---|
| old live bundle | 0.418 | 39 | 129 |
| this branch | **0.313** | 50 | 119 |

≈ **40 % cheaper per zombie** (grid + tighter world). Renderer now requests
`powerPreference: 'high-performance'`.

### Verified (browser sim, 0 console errors)
- Gothenburg boots scaled: start (−24.7, 40.9), 120 colliders, 2 tram + 2 bus +
  6 car routes chained, 24 traffic vehicles all on-map and all at scale 1
  (real size); walking 3 s moves 9.1 m, stays in bounds.
- Shanghai swap lands on miniature coords: start (1226, 17), stall bar
  (1213.78, 8), return shuttle (1215, 26), spawn not inside any collider,
  bus + scooters present; cook → bowl drop at 0.475 m counter height,
  collect restores HP 50 → 100.
- Screenshots: miniature Korsvägen with looming Gothia Towers, dusk crossing
  with Carlanderska on its hill, Expo boulevard with cone + pavilion, the
  scaled stall with chef bunny, quay tower row, and the chainsaw smoke plume.
- tsc clean, 35/35 tests, build ok.

### Follow-up — vehicles back to real size (user feedback: "too small")
- First pass scaled trams/buses/cars/parked cars/shuttle ×0.5 with the streets;
  that made rideable, run-over-able gameplay objects look like toys. Reverted
  their geometry, colliders (`4.4 × 1.8 × 1.7` parked cars, `1.55` rideable
  roof) and the Shanghai shuttle to real size — only lane offsets, spawn
  positions and the two-car route threshold (`150 * WORLD.scale`) follow the
  miniature streets.
- **The noodle stall too**: no group scaling, real colliders and bar offset
  (`1214.55, 8`), bowl drop back at the real `0.95` counter height.
- Re-verified: all 24 Gothenburg + 5 Shanghai vehicles at scale 1, parked-car
  colliders real size, tram hit-and-kill still works (real-size hitbox),
  stall cook → drop at 0.95 m → HP 50 → 100, screenshots show full-size
  bus/shuttle/parked car/stall against the miniature district;
  tsc clean, 35/35 tests.

### Traffic — back to main-branch behavior (user decision: "give up bumping")
- Half-size streets + real-size vehicles made the old pass-through-crossings
  look like clipping, so this branch grew a full avoidance brain (priority
  yielding tram > bus > car > scooter, player yield, deadlock escalation +
  reversing, a no-progress re-place valve, and finally mass-weighted bump
  physics, tram 30 / bus 10 / car 1 / scooter 0.25). Every fix traded one
  failure mode for another: deep embeds became permanent side-by-side grinds,
  yielding became gridlock, and the fleet spent more time braking than
  driving.
- **Reverted `src/traffic.ts` to the main-branch version** (plus the
  milestone-U scaling adaptation: `laneOff *= WORLD.scale`, two-car route
  threshold `150 * WORLD.scale`): vehicles drive their own route ranges and
  never brake for each other — crossings pass through, exactly like the live
  game. Gone with it: the Flygbussen 5 s boarding dwell, player/scooter
  yielding, reversing and the bump physics.
- **Kept from the cleanup pass** (`world.ts`, `config.ts`): the Gothia podium
  box that swallowed the streets between the towers is gone (roof caps stay),
  parked cars are placed in a second pass and only kept where the full body
  clears every car/bus/tram corridor, and the scooter fleet is 12 → 8 so the
  narrow shared OSM streets stay readable.
- Verified: tsc clean, 35/35 tests; 30 s browser sim — fleet 2 tram + 2 bus +
  8 car + 8 scooter, Flygbussen live, ≥ 95 % of route vehicles moving in every
  1 s sample, no NaN poses, scene renders at 60 fps.

### Scooter hooligans: deranged driving + roadkill (`traffic.ts`, `zombie.ts`)
- Scooters now drive like maniacs: speed surges to 1.5× and crawls again,
  sudden brake-checks, and a whole-street swerve (amp 0.9–1.7 m at a
  per-hooligan frequency, plus handlebars jitter) that crosses the car, bus
  and tram lanes — repeatedly into oncoming traffic.
- **Rider traffic immunity removed**: traffic takes riders out. Balance so
  the fleet survives the mayhem: a rider absorbs only 30 % of traffic damage
  and at most one blow per 4 s — a car side-swipe staggers (24.5 < 42 HP) and
  the next one finishes, a bus (45) or tram (350) kills outright. The dead
  rider tumbles off, the scooter coasts to a stop and drops for hijacking or
  towing exactly like a shot rider.
- Fleet churn: `refillFleet` counts only ACTIVE scooters (a tow-waiting wreck
  no longer blocks the quota), and the wreck pile is capped at 8 — the oldest
  dropped ones get towed early so live scooter objects (and draw calls) stay
  bounded.
- Verified (80 s browser sim): avg 5.5 active riders (min 3, max 8), ~36
  traffic kills, wrecks capped at 8, no NaN, 144 fps; screenshot shows the
  yellow VOI decks + horde at Korsvägen; tsc clean, 35/35 tests.

### Follow-up — friendly coach, meaner saw (`traffic.ts`, `config.ts`, `audio.ts`)
- **The Flygbussen never hurts you**: it's the boarding bus, so the player
  contact check skips it entirely — no damage, no knockback, no crash sound
  (it still mows zombies; every other vehicle still runs you over).
- **Chainsaw huge buff**: 90 → **260 dps** (31.2 per 0.12 s tick, ~3×) — a
  base zombie dies in two ticks, max-threat in two as well.
- **Chainsaw LOUDER**: buzz gain 0.18 → 0.5, plus a detuned second sawtooth
  and a high noise rasp layered on the cut, and a beefier stop growl.
- Verified in browser: standing inside the Flygbussen for 2 s = 0 damage
  calls; inside a normal bus = one 45 hit (cooldown respected); served
  config reads `damage: 260` (31.2/tick); tsc clean, 35/35 tests.

### Extra chainsaw blood (`fx.ts`, `main.ts`)
- New `fx.sawSpray`: every chainsaw hit tick now throws a heavy two-tone
  gore spray (20 particles vs the knife's 10, dark + arterial red) flung
  mostly FORWARD down the blade line instead of a generic puff.
- Plus a 5 % chance per hit tick of a full `fx.gore` chunk burst — now and
  then the saw visibly chews up debris while cutting.
- Sized for the particle pool: measured with real aging (the debug `step`
  does not run `fx.update`, so the harness must call it manually) — peak
  320/600 particles and 39/90 chunks while grinding three zombies, and
  everything fades out cleanly afterwards; explosions and traffic-kill
  blood keep their headroom.
- Verified in browser: 69 sprays in 3 s = 3 zombies × 8.3 ticks/s, 3–6
  chunk bursts, pool drains to idle after firing; tsc clean, 35/35 tests.

## Previous milestone: T (chef bunny cooks the noodles + Shanghai MIDI music) — verified

### Changed — the bunny is a chef now (`src/noodle.ts`, `main.ts`)
- The stall bunny wears a **tall white chef's hat** (band + puff + crown,
  parented to the head pivot so it rides every dip, snug between the ears).
- **He cooks instead of eating with you**: a black **wok** sits in front of
  him; on order (`E` at the bar) the arm swings over, works the wok in six
  stir-circles, the head bobs over the steam, the pot steam doubles and the
  noodle blob in the wok shrinks as the dish comes together (3 s cook).
- **When it's done a noodle drop appears at the bar** (`buildNoodleDrop()`:
  bowl + noodles + chopsticks + gold glow disc): it spins, bobs, and after a
  0.5 s grace **walk-over pickup within 1.5 m restores HP to 100**
  (slurp + gulp, `🍜 BEEF NOODLES — HP RESTORED`, 12 s cooldown starts on
  collect). One bowl at a time; drop + cooking reset on swap and restart.
- The player is **no longer locked in place** — you can fight and fire freely
  while the chef works (old eat-lock, auto-face and immunity removed;
  `setEating` → `setCooking`). New `sfx.sizzle()` (hot-oil noise burst) on
  order; prompt order: dismount > cooking > grab bowl > order > shuttle > hijack.

### Added — Chinese street music in Shanghai (`src/audio.ts`)
- A tiny **MIDI-style step sequencer**: square lead + octave triangle
  shimmer + triangle bass (C3/A2/G2/A2), **C pentatonic** two-phrase melody,
  32 beats ≈ 9.6 s loop at ~100 BPM, lookahead-scheduled so timing survives
  frame hiccups. `sfx.musicStart()/musicStop()`.
- Starts on arrival at the Expo, stops on the ride home, on death and on
  restart.

### Verified (browser sim, 0 console errors)
- Travel → music scheduler started (probe: 1 start / 1 stop after return).
- Order at 40 HP: cooking starts, **player walks freely holding W mid-cook**
  (was frozen before), firing unblocked, drop at 3 s, 0.5 s grace honored,
  collect → **HP 100**, cooldown blocks then expires, re-order works.
- Prompts: `E — order 牛肉麵…` / `🍳 the chef is cooking 牛肉麵…` /
  `🍜 noodles ready — grab the bowl!` (only within 3 m of the drop).
- Screenshots: chef hat between ears, mid-stir pose with shrinking wok
  noodles, idle re-fill, and the glowing bowl drop at the bar.
- tsc clean, 32/32 tests, build ok.

## Previous milestone: S (noodle stall + eating bunny + six stars in Shanghai) — verified
(eating flow since replaced by the chef in T; six stars unchanged)

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
