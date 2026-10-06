# Junk Magnet — Design + Tech Plan (Phase 1 MVP)

## Pitch
Drive a chunky truck with an oversized magnet. Junk snaps on with a CLUNK and
balls up around the magnet (Katamari-style). Every pickup grows pull radius and
lift capacity, so the "too heavy" fridge next to you becomes collectable a few
seconds later. 90-second rounds, 1–3 stars, instant retry.

## Core loop (first 10 seconds)
1. Page loads straight into Junkyard. Truck is already rolling toward a
   cluster of cans; a pulsing hand shows "drag to steer".
2. First CLUNK in ~1.5s, even with no input. The hint hides after the first pickup.
3. The timer starts on the first input, which is also when `gameplayStart()` fires.

## Systems
| System | Approach |
|---|---|
| Rendering | Three.js (r18x), flat-shaded `MeshLambertMaterial`, vertex colours, one `InstancedMesh` per junk type (12 types → 12 draw calls for ~900 items), blob shadows instanced too. No real-time shadows (mobile perf). |
| Physics | Custom kinematic: heightfield made of AABB "solids" (boxes, ramps, platforms) gives ground height, wall blocking (step height) and ramp launches. Junk uses a state machine (idle → strain → teeter → fly → attached) with eased flight, so it is deterministic and cheap. A spatial hash grid limits proximity queries, and only junk near the magnet is ever touched (everything else "sleeps" as static instances). There is a cap on simultaneously flying bodies. |
| Growth | capacity = base + k·mass collected; radius = base·upgrade + k·√mass. Pile radius ∝ ∛(attached volume); the camera distance is derived from the visible-world radius. |
| Input | One pointer (virtual joystick from the press point) + WASD/arrows. No buttons in gameplay. |
| UI | DOM overlay (crisp text, responsive CSS, big touch targets). CSS vars keep the top/bottom 90px clear in mobile portrait (banner ads). |
| Audio | Web Audio synth: clunk (thump + metallic noise), whoosh, combo chime on a rising pentatonic scale, landing thud, star/coin dings, a 16-step music loop. Master mute plus a separate "ad mute". |
| SDK | `sdk.ts` wraps Poki SDK v2 and falls back to a mock with on-screen fake ads (`?adfail=1` simulates a failed rewarded ad). It tracks gameplay state so start/stop calls never double-fire. |
| Analytics | `analytics.ts` event bus with pluggable sinks (console by default). The `?debug=1` overlay shows live stats + the event log. |
| Config | `src/config.ts` holds every tunable. `?debug=1&cfg.round.length=30` overrides values at runtime for fast playtest iteration. |
| Save | `save.ts` stores versioned JSON in localStorage, wrapped in try/catch, with defaults merged on load. |

## Why Three.js
3D low-poly with instancing is the look and feel the concept needs (physical
pile, zooming camera). Three is ~140KB gzipped once tree-shaken, needs no
assets, and is the most battle-tested WebGL layer for mobile. A physics
engine (cannon/rapier, +200KB–1MB) is unnecessary because pickups are
scripted for feel rather than simulated.

## Content (Phase 1)
- **Junkyard**: open yard, scrap mounds, tire walls. Teaches the loop.
- **Suburb**: blocks of houses (walls), garages with ramps onto flat roofs
  (high-value junk up top), street jump ramps (+25% air pull radius).
  Unlocks at 1★ in Junkyard.
- **Scrapyard Rush** (endless): 45s timer. Combos add time, and junk drops from
  the sky in waves scaled to your size. One "continue run" per run.
- **Daily**: map seeded by the date (alternating theme) with a fixed goal; first clear pays a coin bonus.
- **Skins**: Classic, Monster (coins, or try for one round via ad).
- **Upgrades**: Magnet radius, Truck speed, +Time (5 tiers each).

## Ads / flow
`init → loadingFinished → (first input) gameplayStart`. Every later round start
calls `gameplayStop → commercialBreak → gameplayStart`. Six rewarded placements
are buttons on the end screen and shop panels. Each is optional and grants only
when the promise resolves to `true`.

## Phase 2 readiness
- Levels are data (`levels.ts`) plus a generator. Per-level `features` hook into a
  registry (`features.ts`: setup/update/pullScale/onAttach). Rush waves already
  run on it, and trains, the crusher and magnetic storms plug in the same way.
- Junk types/tiers and skins are config arrays.
- The scene and camera are isolated from the UI, so a `?thumb=1` 512² render path can reuse them.

## Milestones
1. Scaffold (Vite+TS+three), config, save, analytics, SDK mock.
2. Core loop: truck, input, junk, pickups, growth, camera → browser test.
3. Juice + audio → browser test.
4. Round flow, end screen, levels, rush, daily → browser test.
5. Meta, shop, skins, rewarded ads, debug overlay → browser test.
6. Perf pass, build size, README.
