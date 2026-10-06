# 🧲 Junk Magnet

A browser game built for Poki. You drive a chunky truck with an oversized
magnet, and junk snaps on with a CLUNK. Every pickup grows your pull, so the
fridge that was too heavy a minute ago is collectable now. Rounds last 90
seconds and award 1–3 stars, and retry is instant.

Stack: **TypeScript + Three.js r180 + Vite**. Physics is custom (no physics engine).
All art is procedural, all audio is synthesized with Web Audio, and the build
ships zero asset files. The design and tech plan is in [`PLAN.md`](PLAN.md).

## Run / build

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build -> dist/
npm run preview    # serve dist/ on http://localhost:4173
```

To upload to Poki, zip the contents of `dist/` (`base: './'` keeps every path relative).

### Useful URL params
| Param | Effect |
|---|---|
| `?debug=1` | Debug overlay (FPS, draw calls, growth stats, analytics counters and the live event log). Also exposes `window.__game`. |
| `?debug=1&cfg.round.length=30&cfg.magnet.baseRadius=4` | Override any numeric/boolean value in `src/config.ts` without touching code (also enabled by `?tune=1`). |
| `?bot=1` | Autopilot that plays rounds. Used for balance tuning and automated tests. |
| `?adfail=1` | Mock: every rewarded ad fails. Tests the "no reward" path. |
| `?adcooldown=N` | Mock: commercial-break frequency cap in seconds (default 45, mimicking Poki). |
| `?sdk=poki` | Force-load the real Poki SDK when not on a Poki domain. |
| `?analytics=off` | Remove the console sink. |

## Final bundle size
| File | Raw | Gzip |
|---|---|---|
| `assets/index-*.js` (game + three.js) | 566 KB | 151 KB |
| `assets/index-*.css` | 9.7 KB | 2.9 KB |
| `index.html` | 1.6 KB | 0.8 KB |
| **Total `dist/`** | **≈ 580 KB** | **≈ 155 KB** |

That is well under the 5 MB target, with no images, models or audio files.
Under 4× CPU throttling, a 4G-like network profile and software WebGL (headless
Chromium), the game was **playable after ~1.5 s** and the first combo landed
before any input.

## MVP scope shipped (Phase 1)
- **Core loop**: drag/hold steering (floating virtual joystick) plus WASD/arrows.
  A spatial-hash junk system with 12 junk types in 5 size tiers (cans → bikes/drums
  → fridges/washers → cars/pickups → containers/buses). Items that are slightly
  too heavy wobble and strain. Liftable ones teeter, hop, fly in an eased arc and
  snap onto a growing Katamari-style pile on the truck. Big pieces compact as they
  join so the pile stays readable.
- **Growth**: capacity, pull radius, pile size, truck size and magnet size all scale
  up, and the camera zooms out smoothly. A "NOW LIFTING CARS!" moment plays when
  each new tier unlocks.
- **Juice**: squash & stretch, hit-stop on large/huge pickups, trauma-based screen
  shake, instanced particles, combo pop-ups, clunk pitch rising with the combo,
  pentatonic combo chimes, a radius ring pulse and landing thuds.
- **Levels**: **Junkyard** (scrap mounds, tire walls, crane) and **Suburb** (houses,
  garages with ramps up to junk-loaded roofs, street jump ramps with ×1.25 air pull
  and ×2 air-grab score). Suburb unlocks with 1★ in Junkyard.
- **Scrapyard Rush** (endless): 45s clock that drains faster as the run goes on,
  combos add time (capped per chain), and junk drops from the sky in waves sized to
  your current strength. One "continue run" per run.
- **Daily challenge**: seeded by date (theme alternates) with a fixed goal ("Clean
  55% of the Junkyard" / "Lift 3 cars"). The first clear each day pays +200 coins.
- **Meta**: coins, 3 upgrades × 5 tiers (magnet radius, truck speed, +time), 2 skins
  (Classic; Monster costs 450 coins or can be tried for one round via an ad).
- **Saves**: versioned localStorage (stars, coins, upgrades, free-upgrade usage,
  skins, best scores/% per mode, daily status, mute, stats). Every access is wrapped
  in try/catch and merged with defaults.
- **Poki SDK + mock**, **analytics** with pluggable sinks, **debug overlay**, and a
  **single config file** (`src/config.ts`).

### Code map
```
src/config.ts          every tunable (round length, density, tiers, costs, ad rewards, combo, juice, camera, perf caps)
src/core/sdk.ts        Poki SDK v2 wrapper + mock (lifecycle guards, audio mute during ads)
src/core/analytics.ts  event bus with pluggable sinks
src/core/audio.ts      Web Audio synth: sfx + 16-step music loop
src/core/input.ts      one-input steering
src/core/save.ts       localStorage persistence
src/game/game.ts       round lifecycle, scoring, growth, rewarded grants
src/game/junk.ts       instanced junk, spatial grid, pickup state machine, pile
src/game/junkTypes.ts  procedural junk catalog
src/game/levels.ts     level defs, heightfield solids, layout generation, daily
src/game/features.ts   per-level feature registry (Rush waves; Phase 2 hooks)
src/game/truck.ts      truck model/skins, driving over the heightfield, ramps
src/game/effects.ts    particles + camera rig (zoom, shake)
src/ui/ui.ts           HUD, end screen hub, Garage, Modes
src/ui/debug.ts        ?debug=1 overlay
```

## Poki SDK integration and every ad placement

Lifecycle: `PokiSDK.init()` → (first frame rendered) `gameLoadingFinished()` →
the player's **first input** triggers `gameplayStart()`. If the player taps
before the SDK has loaded, the call waits until it has. `gameplayStop()` fires at
time-up, before every ad, and when the tab is hidden; `gameplayStart()` fires on
resume. All game audio is muted (the AudioContext is suspended) for the entire
duration of every ad.

| # | Placement (`placement` id) | Type | Where / when it fires | Reward (only if SDK returns `true`) | Limit |
|---|---|---|---|---|---|
| – | `commercialBreak()` | Interstitial | Before **every** round start after the boot round: Play Again, Next Level, mode select, Play from the Garage, and the start following any rewarded offer (Poki decides whether an ad actually shows) | – | Poki-controlled |
| 1 | `mega_magnet` | Rewarded | End-screen button "Next round with MEGA MAGNET" (the round-start decision) | ×2 pull radius + lift a tier early, for 20s | Every round |
| 2 | `extra_time` | Rewarded | End screen of level/daily rounds, "+20 seconds" | Resumes the same round with 20s | Once per round |
| 3 | `triple_coins` | Rewarded | End screen, "x3 coins" | +2× the round's coins | Once per round |
| 4 | `upgrade_free` | Rewarded | Garage, "Free" under each upgrade | That upgrade tier for free | Once per upgrade tier |
| 5 | `skin_try` | Rewarded | Garage, "Try 1 round" on locked skins | Next round starts with that truck, then it reverts | Every time |
| 6 | `continue_run` | Rewarded | End screen of Scrapyard Rush, "Continue run (+25s)" | Resumes the run with 25s | Once per run |

Every rewarded button is optional, and **Play** is always the largest button.
A failed or closed ad shows a friendly toast and grants nothing (verified with
`?adfail=1` and the mock's close button). Analytics logs each offer as
`rewarded_offer_shown` → `rewarded_accepted` → `rewarded_completed` /
`rewarded_failed`.

In portrait on mobile, `--safe-top` / `--safe-bottom` = 90px keep the HUD,
hint and all panels out of the banner zones.

## Analytics
The default sink is console (`[analytics] name {…}`). Add your own with
`analytics.addSink((name, data, t) => …)`.

| Event | Data |
|---|---|
| `load_complete` | ms to ready, mock flag, session count |
| `first_input` / `first_pickup` | seconds since load |
| `round_start` | mode, level, build ms, mega, tried skin |
| `round_end` | mode, level, score, % cleaned, duration, stars, coins, max combo, pieces lifted, continued |
| `rewarded_offer_shown` / `_accepted` / `_completed` / `_failed` | placement |
| `commercial_break` | – |
| `upgrade_purchase` | id, level, cost, via (`coins`/`rewarded`) |
| `skin_purchase` | id, cost |
| `session_length` | seconds, rounds, reason (`hidden`/`pagehide`) |

## Testing done
I drove the game in headless Chromium (Playwright, software WebGL) at every stage:
- Desktop 1280×720 and phone portrait 390×844 (touch drag), checked with screenshots.
- Full flow script, all passing: SDK call order, `gameplayStart` on first input,
  `gameplayStop` at time-up, each of the 6 rewarded placements granting
  correctly and respecting its limit, the failed-ad path, coins/free upgrades,
  skin try reverting after one round, Suburb unlock, ramp launches (airborne,
  y≈1.7), Rush continue, Daily round, visibility pause/resume, and save
  persistence across reload. There were zero console errors.
- **Balance runs with `?bot=1`** (the bot plays far better than a new human):
  - Junkyard, no upgrades: smalls liftable by ~10s, fridges ~15s, cars ~20s, containers ~50s.
  - Junkyard result: 89% cleaned, ~207 coins.
  - Rush: a strong run lasts ~65–90s and scores ~43k.

## Self-review against the design rules

| Rule | Status | Notes / shortfall → fix |
|---|---|---|
| 1. Fun within 10s, no title wall, no tutorial text | ✅ | The page loads straight into Junkyard. An autopilot "attract" drives the truck into a can cluster (first CLUNK ~1s after load). The animated hand plus "Drag to steer" hides after the first pickup and returns if there is still no input 2.5s later. *Shortfall:* a ~0.3–1.5s loader bar shows during JS parse. *Fix:* inline a tiny CSS truck animation into the loader so even that moment is on-brand. |
| 2. One input, no buttons in gameplay | ✅ | Drag/hold (floating joystick) or WASD/arrows. The HUD has no buttons, and the mute toggle lives on the end/modes screens. *Shortfall:* there is no manual pause; it pauses automatically when the tab is hidden, which Poki allows. |
| 3. Constant reward drip, "just too big" always nearby | ✅ (mostly) | Dense opening lane. Clusters always mix in the next tier up, food is scattered around big items, and a uniform scatter fills the remaining area. Too-heavy items within 3× capacity wobble. *Shortfall:* after ~70s a strong player can clear an area and face a short drive to the remaining junk. *Fix:* add a late-round tiny-junk trickle respawn in levels plus an edge-of-screen arrow to the nearest liftable cluster. |
| 4. Visible growth, no number needed | ✅ | The pile grows physically, the magnet and truck scale up, and the camera zooms out. Tier unlocks get a callout. The level HUD shows only the timer and a star bar. *Shortfall:* at very large sizes the pile can partially bury the magnet. *Fix:* mount the magnet on a boom that extends with pile radius. |
| 5. Satisfying physics and juice | ✅ | Teeter/hop/tumble before snapping on, squash & stretch on truck and items, hit-stop on large/huge pickups, screen shake scaled by tier, particles, combo pitch rising for pickups ≤0.5s apart, chimes. *Shortfall:* pickups are scripted rather than simulated, so nothing falls off the pile. *Fix:* when the pile grows, occasionally shed a few small items that bounce off. It reads as physical without a physics engine. |
| 6. Short rounds, instant retry, end screen < 1s | ✅ | "TIME!" slam, then the end screen at 0.6s with stars, % cleaned, score, best (with NEW BEST), coins, and "next goal" lines (next star threshold and the coins still needed for the cheapest upgrade). One tap on PLAY AGAIN starts the next round. |
| 7. Light meta, ~1 upgrade per round | ⚠️ Partially | First-tier upgrades (50–70 coins) are affordable after a typical round (~60–200 coins plus star bonuses). Tiers 4–5 (300–550) take 2–4 rounds; the "Free" rewarded offer per tier fills the gap. *Fix:* if playtests show stalling, flatten `upgrades.*.costs` in `config.ts`. |
| Portrait-first, responsive | ✅ | Camera framing adapts to aspect ratio (it keeps visible width in portrait) and updates live on resize/orientation change. Touch targets are ≥48px, and the 90px banner-safe zones are enforced in portrait. |
| 60fps on mid-range phones | ⚠️ Not measured on a device | About 24 draw calls and ~67k triangles regardless of junk count (instancing per type, static decor merged into 1 mesh), pooled particles and junk, max 36 flying bodies, junk outside the magnet's grid cells never touched (sleeping), DPR capped at 1.5 on mobile, no real-time shadows. The sandbox had no GPU, so FPS numbers there are meaningless. **Check on a real phone with `?debug=1`.** |
| Build < 5MB, playable < 3s | ✅ | ~580KB total. ~1.5s to playable under throttled conditions. |

## Next 5 changes most likely to raise average playtime and rewarded opt-in (ranked)
1. **Late-round junk trickle plus "nearest junk" edge arrow** (playtime). The biggest risk to the 5+ minute target is dead driving time late in a round, and fixing it keeps the combo chain alive. Low effort: the `features.ts` hook plus one HUD element.
2. **First Mega Magnet free, then "Mega Magnet" as a pre-round card** (rewarded opt-in). Giving the first one free teaches its value. Players who have felt the 2× radius opt in at much higher rates, and the pre-round card is the highest-intent moment.
3. **More skins with ad-progress unlocks** ("watch 3 ads → unlock Golden Truck", with progress pips) (opt-in + retention). Cosmetic goals give players a reason to choose ads every session. The architecture is ready: skins are a config array.
4. **Level 3 (Beach, moving trains to grab) and a simple level path with star gates** (playtime). New content is the main lever for sessions beyond 7 minutes. The level and feature registry already support it (`trains` = a kinematic junk group in a feature's `update`).
5. **Rush "double-or-nothing" mid-run offer plus daily streak bonus** (opt-in + return rate). Offer a rewarded "2× score for 20s" at the wave-5 milestone, and add a streak counter on the Daily card that multiplies its reward.

## Phase 2 readiness (not built)
- **Levels 3–5**: add a `LevelDef` in `levels.ts` (theme + builder + junk budget) and feature ids:
  - `trains`: a feature `update()` moves a group of spawned items along a track.
  - `crusher`: steals items near it by setting them to `GONE` and recycling their pool slots.
  - `storm`: `pullScale()` returns a negative value to briefly reverse the pull.

  The core loop needs no changes for any of these.
- **More skins**: append to `CONFIG.skins`. Garage and save already handle N skins.
- **512×512 thumbnail**: the scene, truck and camera rig are UI-independent. A
  `?thumb=1` path can build a round, attach a scripted pile (`junk.spawn` +
  forced attach), set a 1:1 camera at a dramatic angle, render once to a 512²
  canvas and call `toDataURL()`.
