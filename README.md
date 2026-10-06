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
npm run package    # build + junk-magnet-poki.zip (the file you upload to Poki)
npm run thumbnails # render promo thumbnails -> thumbnails/*.png (see below)
```

## Submitting to Poki
`npm run package` produces `junk-magnet-poki.zip` (≈162 KB) with `index.html`
at the zip root. Every path is relative (`base: './'`), so it runs from any
sub-path or iframe.

**Done in code (verified in tests):**
- The SDK loads automatically on any `*poki*` host. It is skipped if Poki has
  already injected `window.PokiSDK`.
- The SDK runs `init` → `gameLoadingFinished`, and `gameplayStart` fires on the
  first input. It never fires twice in a row, and no ad is ever requested while
  gameplay is running.
- Rewarded ads use the current `rewardedBreak({ size, onStart })` form (sizes are
  listed in the ad table below). A reward is granted only when the SDK resolves
  `true`.
- **On a Poki host where the SDK fails to load** (adblock or network), the game
  plays on with no ads: commercials are skipped and rewarded offers grant
  nothing. The local fake-ad mock **never** appears there.
- The game shows on its first frame and never waits on the ad SDK. A tap that
  arrives before the SDK is ready is queued as `gameplayStart`.
- Production builds print nothing to the console; analytics console logging is on
  only in dev or with `?debug=1`.
- Arrow keys and space never scroll the page, there are no external links, and
  no other ad networks are used.

**Still yours to do before/at upload:**
1. **Real-device check.** Play a few rounds on a mid-range Android phone and an
   iPhone with `?debug=1` and confirm ~60 fps (the sandbox had no GPU). Load the
   page with `?sdk=poki` to exercise the real SDK in its debug mode.
2. Review Poki's current [integration requirements](https://sdk.poki.com/new-requirements)
   (they change; I could not fetch that page from the build sandbox).
3. Create the game in Poki for Developers, upload `junk-magnet-poki.zip`, and run
   their Playtest/QA tooling.
4. Store art (title, description, thumbnails) is needed for public release, not
   for the Playtest stage. See the Phase 2 note on a rendered 512×512 thumbnail.
5. Optional: add a real analytics sink (e.g. a `fetch` beacon) in `main.ts` if you
   want event data beyond what Poki's dashboard shows.

### Useful URL params
| Param | Effect |
|---|---|
| `?debug=1` | Debug overlay (FPS, draw calls, growth stats, analytics counters and the live event log). Also exposes `window.__game`. |
| `?debug=1&cfg.round.length=30&cfg.magnet.baseRadius=4` | Override any numeric/boolean value in `src/config.ts` without touching code (also enabled by `?tune=1`). |
| `?bot=1` | Autopilot that plays rounds like a player: it only chases junk that is **on screen**, follows the off-screen arrow, and otherwise wanders. Used for balance and dead-time measurement and in automated tests. |
| `?debug=1&speed=N` | Simulate N× faster than real time (max 16), for quick bot measurements. |
| `?thumb=1&sizes=512,1080` | Thumbnail render mode (used by `npm run thumbnails`). |
| `?adfail=1` | Mock: every rewarded ad fails. Tests the "no reward" path. |
| `?adcooldown=N` | Mock: commercial-break frequency cap in seconds (default 45, mimicking Poki). |
| `?sdk=poki` | Force-load the real Poki SDK when not on a Poki domain (falls back to no-ads if it can't load). |
| `?analytics=off` | Remove the console sink in dev/debug (production has no console sink). |

## Final bundle size
| File | Raw | Gzip |
|---|---|---|
| `assets/index-*.js` (game + three.js) | 580 KB | 156 KB |
| `assets/thumbnail-*.js` (lazy, only loaded with `?thumb=1`) | 4.4 KB | 2.1 KB |
| `assets/index-*.css` | 10.1 KB | 3.0 KB |
| `index.html` | 1.6 KB | 0.8 KB |
| **Total `dist/`** | **≈ 596 KB** | **≈ 162 KB** (zip: 162 KB) |

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
src/core/sdk.ts        Poki SDK v2 wrapper + local mock + no-ads fallback (lifecycle guards, audio mute during ads)
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
src/game/assist.ts     anti-dead-time assists: sky drop, magnet pulse, off-screen arrow
src/game/thumbnail.ts  promo thumbnail staging + rendering (loaded only with ?thumb=1)
scripts/thumbnails.mjs npm run thumbnails: Vite + headless Chromium -> thumbnails/*.png
```

## Poki SDK integration and every ad placement

Lifecycle: `PokiSDK.init()` → (first frame rendered) `gameLoadingFinished()` →
the player's **first input** triggers `gameplayStart()`. If the player taps
before the SDK has loaded, the call waits until it has. `gameplayStop()` fires at
time-up, before every ad, and when the tab is hidden; `gameplayStart()` fires on
resume. All game audio is muted (the AudioContext is suspended) for the entire
duration of every ad.

| # | Placement (`placement` id) | Type | Where / when it fires | Reward (only if SDK returns `true`) | Limit | Poki `size` |
|---|---|---|---|---|---|---|
| – | `commercialBreak()` | Interstitial | Before **every** round start after the boot round: Play Again, Next Level, mode select, Play from the Garage, and the start following any rewarded offer (Poki decides whether an ad actually shows) | – | Poki-controlled | – |
| 1 | `mega_magnet` | Rewarded | End-screen button "Next round with MEGA MAGNET" (the round-start decision) | ×2 pull radius + lift a tier early, for 20s | Every round | medium |
| 2 | `extra_time` | Rewarded | End screen of level/daily rounds, "+20 seconds" | Resumes the same round with 20s | Once per round | medium |
| 3 | `triple_coins` | Rewarded | End screen, "x3 coins" | +2× the round's coins | Once per round | medium |
| 4 | `upgrade_free` | Rewarded | Garage, "Free" under each upgrade | That upgrade tier for free | Once per upgrade tier | large |
| 5 | `skin_try` | Rewarded | Garage, "Try 1 round" on locked skins | Next round starts with that truck, then it reverts | Every time | small |
| 6 | `continue_run` | Rewarded | End screen of Scrapyard Rush, "Continue run (+25s)" | Resumes the run with 25s | Once per run | large |

Sizes live in `REWARD_SIZE` in `src/ui/ui.ts`.

Every rewarded button is optional, and **Play** is always the largest button.
A failed or closed ad shows a friendly toast and grants nothing (verified with
`?adfail=1` and the mock's close button). Analytics logs each offer as
`rewarded_offer_shown` → `rewarded_accepted` → `rewarded_completed` /
`rewarded_failed`.

In portrait on mobile, `--safe-top` / `--safe-bottom` = 90px keep the HUD,
hint and all panels out of the banner zones.

## Analytics
In dev and with `?debug=1` the sink is the console (`[analytics] name {…}`).
Production has no sink until you add one with
`analytics.addSink((name, data, t) => …)`.

| Event | Data |
|---|---|
| `load_complete` | ms to ready, mock flag, session count |
| `first_input` / `first_pickup` | seconds since load |
| `round_start` | mode, level, build ms, mega, tried skin |
| `round_end` | mode, level, score, % cleaned, duration, stars, coins, max combo, pieces lifted, continued, `clearedEarly`, `deadTime` (final-30s pickup gaps: max, mean, count > 3s, seconds beyond 3s), `assist` (drops, pulses, arrow seconds) |
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
- Poki launch checks, all passing:
  - **SDK stub:** a stand-in for the real SDK recorded the exact call sequence
    (`init | gameLoadingFinished | gameplayStart | gameplayStop |
    rewardedBreak:{"size":"medium","onStart":fn} | … | commercialBreak |
    gameplayStart`). There were no double starts and no ad calls during gameplay.
  - **SDK blocked on a Poki host:** the game was visible in ~1.1s, no fake ad UI
    appeared, and rewarded offers granted nothing.
  - **Production build:** silent console.
- **Balance runs with `?bot=1`**, before the assists, with an earlier omniscient bot that plays far better than a new human:
  - Junkyard, no upgrades: smalls liftable by ~10s, fridges ~15s, cars ~20s, containers ~50s.
  - Junkyard result: 89% cleaned, ~207 coins.
  - Rush: a strong run lasts ~65–90s and scores ~43k.

## Late-round dead time: assists and measurements

**Goal:** once the local area is cleared, a player should never drive more than
~3s without a pickup opportunity.

### The three mechanics
Each mechanic lives in `src/game/assist.ts` and is behind a flag in `CONFIG.assist`.

| | Mechanic | How it works |
|---|---|---|
| **A** | **Sky drop** (`assist.skyDrop`) | Triggers when fewer than 6 liftable items are within 14 units + pull radius, and nothing has been picked up for 0.4s. 9 liftable items from the **far corners** of the map (plus sometimes one "just too heavy" teaser) fall from the sky into the area ahead of the truck. A growing shadow telegraphs each drop for about 1s, then it lands with a thud, a dust ring and a light shake. Junk is **relocated, never created**, so % cleaned stays honest. 2s cooldown. |
| **B** | **Magnet pulse** (`assist.pulse`) | After 1.0s without a pickup, a white shockwave ring fires and yanks up to 8 liftable items within (2.6 × pull radius + 6) into the pile. 3s cooldown. It **auto-triggers** instead of using tap-and-hold, because hold already means "steer" and the one-input rule forbids a button. |
| **C** | **Off-screen arrow** (`assist.arrow`) | After 0.8s with nothing liftable on screen and no drops incoming, a pulsing yellow arrow at the screen edge (inside the banner-safe zones) points to the densest reachable cluster of liftable junk. It only counts clusters **on the truck's level**: an early version pointed at roof junk and steered players into walls. |
| + | **Early clear** (`round.endWhenCleared`) | When nothing liftable is left anywhere, the round ends at once with **CLEARED!** and +150 points per second left. A player who has cleaned the whole level never drives around an empty map. Not used in Rush, where waves refill the map. |

### How it was measured
- `?bot=1` plays each round. The bot is **vision-limited**: it sees only on-screen
  junk, follows the arrow when that flag is on, and otherwise wanders. An
  omniscient bot would make the arrow pointless to measure.
- Each run is a fresh save (no upgrades) at `speed=6`.
- **Metrics** (also sent in `round_end`): pickups in the final 30s, mean and max
  gap between pickups, the number of gaps over 3s, and total seconds spent beyond
  3s, plus % cleaned.
- **Scenarios:** Junkyard on desktop landscape (720×405), and Suburb in phone
  portrait (390×844). Suburb is the hard case: houses, roofs and a narrower view.

**Round 1: every combination, first-pass tuning** (Junkyard, 3 runs each)

| Config | % cleaned | Average longest drought | Worst run | Seconds stuck past 3s |
|---|---|---|---|---|
| baseline | 85.0 | 4.99s | 6.9s | 2.9 |
| A | 84.5 | 4.81s | 6.9s | 2.3 |
| B | 90.9 | 5.47s | 7.0s | 4.0 |
| C | 90.8 | 4.96s | 6.0s | 3.4 |
| AB | 94.7 | 3.43s | 3.9s | 0.7 |
| AC | 88.4 | 4.30s | 6.3s | 2.5 |
| BC | 97.9 | 7.22s | 11.0s | 4.8 |
| **ABC** | 91.3 | **2.87s** | **3.5s** | **0.2** |

**Round 2: Suburb portrait, after fixing the arrow's level check** (4 runs each)

| Config | % cleaned | Average longest drought | Worst run | Seconds stuck past 3s |
|---|---|---|---|---|
| baseline | 63.6 | 4.59s | 7.0s | 3.3 |
| B | **80.4** | 3.38s | 4.6s | 1.4 |
| C | 55.1 | 3.95s | 6.7s | 1.8 |
| AB | 74.3 | 3.72s | 3.8s | 0.9 |
| BC | 69.2 | 3.86s | 5.9s | 2.2 |
| **ABC** | 78.2 | **3.34s** | **3.7s** | **0.6** |

**What the data says:**
- **ABC** gave the best worst-case result in both scenarios.
- No single mechanic is enough on its own:
  - The arrow alone just points at junk that may still be far away.
  - The pulse alone fires into empty space when the area is truly dry.
  - The drop alone is too slow on its own because of its fall time.
- **Then tuned:** quicker triggers (drop at 0.4s idle and fewer than 6 nearby, pulse at 1.0s / 3s cooldown).
  This took Suburb to a worst run of 2.9s. Junkyard still showed 5s gaps; the logs
  showed the bot had **cleaned ~98% of the map**, so nothing was left to drop or
  pull. That led to the **early clear** rule.

### Before / after (shipped defaults, 5 runs each)

| Scenario | Version | % cleaned | Pickups in final 30s | Average longest drought | Worst run | Gaps over 3s | Seconds stuck past 3s |
|---|---|---|---|---|---|---|---|
| Junkyard, desktop | before (all off) | 86.8 | 119.6 | 6.73s | 12.2s | 1.8 | 4.2 |
| Junkyard, desktop | **after** | **99.9** | **161.0** | **2.37s** | **2.8s** | **0** | **0** |
| Suburb, phone portrait | before (all off) | 40.0 | 93.6 | 9.97s | 20.6s | 1.6 | 7.8 |
| Suburb, phone portrait | **after** | **77.8** | **146.2** | **2.82s** | **2.9s** | **0** | **0** |

Every measured run now stays under the ~3s target.

**Caveats to check in the Player Fit Test:**
- The bot reacts instantly and steers perfectly, so a real player will be slower.
- With assists on, the bot clears Junkyard (99.9%) and gets 3★ on a first run
  without upgrades. Real players will score lower, but watch the star
  distribution in the playtest data. If 3★ comes too easily, raise `stars` in
  `levels.ts` or soften the assists, which are all in `config.ts`.
- To reproduce: `?debug=1&bot=1&speed=6&cfg.assist.pulse.enabled=false`, and so on.

## Promotional thumbnails
`npm run thumbnails` renders three compositions **from the real game scene**:
- a staged round with a huge pre-filled pile,
- junk frozen mid-flight, plus sparks,
- a hand-placed camera,
- 1.5× supersampling, then downscaling,
- no UI, no text.

| File | Composition |
|---|---|
| `thumbnails/a-hero_*.png` | Side profile: a crisp truck silhouette under a towering junk ball against blue sky, a red car tumbling in |
| `thumbnails/b-chaos_*.png` | High angle over the Suburb: junk streaming in from every side, pulse shockwave ring |
| `thumbnails/c-lift_*.png` | Head-on: magnet facing the viewer, a bright orange container and a blue car ripped off the ground |

- **Sizes:** each variant is rendered at **512×512** (requested) and **1080×1080**
  (the square size Poki's docs give for thumbnails; a high-res master).
- **Options:** `npm run thumbnails -- --sizes 512,1080,2048 --variants a-hero`.
  Compositions are data in `VARIANTS` in `src/game/thumbnail.ts`.
- **Browser:** the script uses Playwright's Chromium (`npx playwright install
  chromium`), `$CHROME_PATH`, or a local Chrome. Rendering is forced onto
  SwiftShader so the output is identical on every machine.
- **Not done:** Poki also supports an **animated thumbnail** (1080×1080 MP4,
  4–6s). That would mean rendering frames from this same staging code, and it
  isn't built.

## Self-review against the design rules

| Rule | Status | Notes / shortfall → fix |
|---|---|---|
| 1. Fun within 10s, no title wall, no tutorial text | ✅ | The page loads straight into Junkyard. An autopilot "attract" drives the truck into a can cluster (first CLUNK ~1s after load). The animated hand plus "Drag to steer" hides after the first pickup and returns if there is still no input 2.5s later. *Shortfall:* a ~0.3–1.5s loader bar shows during JS parse. *Fix:* inline a tiny CSS truck animation into the loader so even that moment is on-brand. |
| 2. One input, no buttons in gameplay | ✅ | Drag/hold (floating joystick) or WASD/arrows. The HUD has no buttons, and the mute toggle lives on the end/modes screens. *Shortfall:* there is no manual pause; it pauses automatically when the tab is hidden, which Poki allows. |
| 3. Constant reward drip, "just too big" always nearby | ✅ | Dense opening lane. Clusters always mix in the next tier up, food is scattered around big items, and a uniform scatter fills the remaining area. Too-heavy items within 3× capacity wobble. Late-round dead time is handled by the sky drop, magnet pulse, off-screen arrow and early clear. The longest drought in the final 30s fell from 6.7–10.0s to **2.4–2.8s**, and no run went past 3s (see *Late-round dead time*). *Caveat:* the measurements come from a bot; confirm them with Player Fit Test data (`round_end.deadTime`). |
| 4. Visible growth, no number needed | ✅ | The pile grows physically, the magnet and truck scale up, and the camera zooms out. Tier unlocks get a callout. The level HUD shows only the timer and a star bar. *Shortfall:* at very large sizes the pile can partially bury the magnet. *Fix:* mount the magnet on a boom that extends with pile radius. |
| 5. Satisfying physics and juice | ✅ | Teeter/hop/tumble before snapping on, squash & stretch on truck and items, hit-stop on large/huge pickups, screen shake scaled by tier, particles, combo pitch rising for pickups ≤0.5s apart, chimes. *Shortfall:* pickups are scripted rather than simulated, so nothing falls off the pile. *Fix:* when the pile grows, occasionally shed a few small items that bounce off. It reads as physical without a physics engine. |
| 6. Short rounds, instant retry, end screen < 1s | ✅ | "TIME!" slam, then the end screen at 0.6s with stars, % cleaned, score, best (with NEW BEST), coins, and "next goal" lines (next star threshold and the coins still needed for the cheapest upgrade). One tap on PLAY AGAIN starts the next round. |
| 7. Light meta, ~1 upgrade per round | ⚠️ Partially | First-tier upgrades (50–70 coins) are affordable after a typical round (~60–200 coins plus star bonuses). Tiers 4–5 (300–550) take 2–4 rounds; the "Free" rewarded offer per tier fills the gap. *Fix:* if playtests show stalling, flatten `upgrades.*.costs` in `config.ts`. |
| Portrait-first, responsive | ✅ | Camera framing adapts to aspect ratio (it keeps visible width in portrait) and updates live on resize/orientation change. Touch targets are ≥48px, and the 90px banner-safe zones are enforced in portrait. |
| 60fps on mid-range phones | ⚠️ Not measured on a device | About 24 draw calls and ~67k triangles regardless of junk count (instancing per type, static decor merged into 1 mesh), pooled particles and junk, max 36 flying bodies, junk outside the magnet's grid cells never touched (sleeping), DPR capped at 1.5 on mobile, no real-time shadows. The sandbox had no GPU, so FPS numbers there are meaningless. **Check on a real phone with `?debug=1`.** |
| Build < 5MB, playable < 3s | ✅ | ~580KB total. ~1.5s to playable under throttled conditions. |

## Next 5 changes most likely to raise average playtime and rewarded opt-in (ranked)
*(The previous #1, late-round dead time, has shipped; see above.)*
1. **Calibrate stars and economy from Player Fit Test data** (playtime). The assists made clearing much easier, so star thresholds and upgrade costs should be re-fit to real players' `round_end` data. Stars that are too easy kill replay, and stars that are too hard kill session two.
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
- **Thumbnails**: shipped (see *Promotional thumbnails*). New levels can get their own variant by adding an entry to `VARIANTS`.
