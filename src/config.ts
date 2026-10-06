/**
 * ALL tunable values live here. Tweak, save, refresh.
 * Runtime overrides (debug builds / playtests):  ?cfg.round.length=30&cfg.magnet.baseRadius=5
 */

export type TierId = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export interface TierDef {
  id: TierId;
  mass: number; // lift requirement: liftable when mass <= capacity
  value: number; // score + % cleaned weight
  size: number; // rough world size (units)
  blocks: boolean; // blocks the truck while it is too heavy to lift
}

export const CONFIG = {
  round: {
    length: 90, // seconds, standard level rounds
    endScreenDelay: 0.6, // "TIME!" slam before end screen (must be < 1s)
    warnAt: 5, // ticking beeps for the last N seconds
    endWhenCleared: true, // nothing liftable left AND 3★ earned -> end early with "CLEARED!" + time bonus
    clearBonusPerSecond: 400, // score per second left when CLEARED!
    clearBonusCoinsPerSecond: 2, // coins per second left when CLEARED!
    endWhenStuck: true, // nothing liftable left but < 3★ -> end early, no bonus (never strand the player)
  },

  truck: {
    baseSpeed: 10.5, // units / second
    accel: 22,
    turnRate: 5.0, // radians / second max heading change
    collisionRadius: 1.1,
    stepHeight: 0.7, // max height the truck can climb in one step (walls are taller)
    gravity: 38,
    maxScale: 1.9, // visual truck growth cap
    scalePerCapacityLog: 0.12, // truck scale = 1 + k * log2(capacity / baseCapacity)
    autoDriveSpeed: 0.75, // fraction of speed while no input has happened yet (attract mode)
  },

  magnet: {
    baseRadius: 3.0, // pull radius at start of round
    radiusPerSqrtMass: 0.1, // + k * sqrt(collected mass)
    maxRadius: 9,
    baseCapacity: 1.6, // max liftable mass at start (tiny = 1)
    capacityPerMass: 0.07, // + k * collectedMass ^ capacityExponent
    capacityExponent: 1.0, // >1 = stronger snowball
    strainRatio: 3.0, // items up to capacity*ratio wobble when in range
    teeterTime: 0.12, // seconds items wobble before snapping (+ per tier)
    teeterPerTier: 0.06,
    flyTime: 0.22, // base flight seconds (+ per tier, + per distance)
    flyPerTier: 0.05,
    flyPerUnit: 0.012,
    airRadiusMult: 1.25, // bonus radius while airborne (Suburb ramps)
    pileBase: 0.9, // pile radius at 0 junk
    pileVolumeK: 0.62, // pile radius += k * cbrt(attached volume)
  },

  tiers: [
    { id: 'tiny', mass: 1, value: 1, size: 0.55, blocks: false },
    { id: 'small', mass: 5, value: 3, size: 1.1, blocks: false },
    { id: 'medium', mass: 20, value: 8, size: 1.9, blocks: false },
    { id: 'large', mass: 70, value: 20, size: 3.6, blocks: true },
    { id: 'huge', mass: 260, value: 50, size: 7.5, blocks: true },
  ] as TierDef[],

  /**
   * Size = power (Hole.io rule: if it's smaller than you, you can take it). The truck's visual
   * length tracks lift capacity from every source (growth, Magnet Power, Mega Magnet):
   * just after a tier unlocks the truck is `overTier` x that tier's item length; it then grows
   * toward `underNext` x the next tier's length, and pops past it when that tier unlocks.
   * Purely visual + collision: speed and assist distances keep their original (balance) scale.
   */
  sizing: {
    overTier: 1.3,
    underNext: 0.95,
    hugeGrowth: 0.3, // past the top tier: up to +30% more as capacity reaches 4x the top-tier mass
    minScale: 0.35,
    maxScale: 3.0, // ~10 units long: still fits every Suburb road (9 wide) — see README
    collisionCap: 1.25, // collision size = min(visual size, this x the original growth curve), so yards stay reachable
    spring: 60, // scale spring; the overshoot on a tier unlock is the "power up" pop
    damping: 8,
  },

  /** Liftable vs too-heavy readability (one shared shader, 3 material states, per-instance ground flag) */
  highlight: {
    outlineMix: 0.25, // liftable outline = magnet colour mixed toward white (bright = readable without hue)
    glowMix: 0.5, // inner rim tint colour (same idea)
    glow: 0.35, // subtle inner rim light on liftable junk (the outline does the heavy lifting)
    lift: 0, // brightness lift on liftable junk (0 = keep the junk's own colours)
    heavyDesat: 0.8, // too heavy: desaturate...
    heavyDark: 0.6, // ...and darken
    flashTime: 0.9, // newly unlocked tier flashes this long
    eagerMult: 1.45, // liftable junk within pull radius x this leans toward the truck
    bonkCooldown: 1.5, // per item: seconds before the same item can "bonk" again
    bonkGap: 0.4, // global minimum seconds between bonk pops / clanks
  },

  /** visual scale per tier (tiny stuff must read on a phone) */
  tierModelScale: [1.4, 1.15, 1.25, 1, 1], // medium x1.25 so every tier is visibly bigger than the last (size = power)
  /** scales the pickup math was balanced with: reach / pile volume use these, so the visual bump above changes nothing */
  tierBalanceScale: [1.4, 1.15, 1, 1, 1],
  /** pile compaction: big pieces shrink as they join the pile so it stays readable */
  attachScaleByTier: [1, 1, 0.85, 0.62, 0.48],

  combo: {
    window: 0.4, // seconds between (player) pickups to keep the combo
    // score + coin multiplier by chain length: x1 -> x2 -> x3
    steps: [
      { at: 15, mult: 2 },
      { at: 40, mult: 3 },
    ],
    pitchSemitonesPerStep: 1, // rising clunk pitch
    maxPitchSteps: 18,
    popupMin: 3, // show combo popup from this count
  },

  juice: {
    hitStopLarge: 0.06, // seconds
    hitStopHuge: 0.14,
    shakeByTier: [0.0, 0.04, 0.12, 0.3, 0.6],
    landShake: 0.25,
    squashByTier: [0.05, 0.08, 0.14, 0.22, 0.32],
    particlesByTier: [4, 7, 12, 22, 40],
  },

  camera: {
    fov: 42,
    pitchDeg: 56,
    // world radius kept visible = (baseView + (pull radius - base) * viewPerRadius + pile * viewPerPile) * closeUp
    baseView: 11,
    viewPerRadius: 1.55,
    viewPerPile: 0.72,
    // closeUp = clamp(closeBase + closePerTruck * truck length, closeMin, 1): tighter framing while the truck is tiny
    closeBase: 0.62,
    closePerTruck: 0.115,
    closeMin: 0.75,
    minPortraitWidth: 0.62, // half-width kept visible = view * k (matters in portrait)
    follow: 7, // position follow stiffness
    zoomLerp: 1.6,
    lead: 0.25, // look-ahead in seconds of travel
  },

  economy: {
    coinsPerValue: 0.06, // coins per junk value point (x combo multiplier)
    assistedCoinFactor: 0.25, // pickups from a sky drop / pulse earn this share of coins...
    assistedScoreFactor: 0.5, // ...and of score, and never extend the combo
    starCoins: [0, 10, 25, 50], // bonus by stars earned this round
    dailyReward: 200,
    startCoins: 0,
  },

  upgrades: {
    magnet: { name: 'Magnet Power', icon: '🧲', maxLevel: 5, costs: [90, 150, 220, 300, 390], perLevel: 0.3, liftPerLevel: 0.35 }, // +30% pull radius & +35% lift capacity per level
    speed: { name: 'Truck Speed', icon: '⚡', maxLevel: 5, costs: [100, 160, 230, 310, 400], perLevel: 0.12 }, // +12% speed per level
    time: { name: 'More Time', icon: '⏱️', maxLevel: 5, costs: [110, 170, 240, 320, 410], perLevel: 8 }, // +8 s per level
  },

  rewarded: {
    megaMagnetMult: 2, // radius multiplier
    megaMagnetDuration: 20, // seconds
    megaCapacityBonus: 4, // + capacity during mega, so it also lifts a tier up early
    extraTime: 20, // "+20 seconds" on time's up (once per round)
    tripleCoins: 3,
    continueRunTime: 25, // Rush "continue run" (once per run)
  },

  rush: {
    startTime: 45,
    comboTimeMin: 3, // combo count from which each pickup adds time
    comboTimeAdd: 0.3, // seconds added per combo pickup
    comboTimeCapPerChain: 3, // max seconds one combo chain can add
    drainPerMinute: 0.6, // clock runs (1 + minutes * k)x faster as the run goes on
    maxTime: 45,
    waveInterval: 9, // seconds between waves
    waveRemainingTrigger: 0.5, // or when remaining value drops below this fraction
    waveItems: 26, // items per wave (scaled up a little with size)
    waveGrowth: 0.08, // +8% per wave
    waveRingMin: 10,
    waveRingMax: 34,
    initial: { tiny: 220, small: 90, medium: 40, large: 14, huge: 5 },
    stars: [10000, 25000, 50000], // score thresholds
  },

  daily: {
    roundLength: 90,
  },

  /**
   * Anti-dead-time assists. Adaptive: they wait longer for players who are picking things
   * up steadily and step in sooner for struggling ones. Toggle: ?debug=1&cfg.assist.pulse.enabled=false
   */
  assist: {
    // "struggling" = few PLAYER pickups (not assisted ones) over the last `window` seconds
    adaptive: {
      window: 15,
      rateHigh: 6.0, // pickups/s at or above this: assists use their base (slow) delay
      rateLow: 2.0, // pickups/s at or below this: assists use their min (fast) delay
    },
    // a) far-away junk drops from the sky ahead of the player when the area runs dry
    skyDrop: {
      enabled: true,
      baseDelay: 1.6, // seconds without any pickup before a drop (healthy pickup rate)...
      minDelay: 1.0, // ...shrinking to this for struggling players
      minNearby: 4, // only when fewer liftable items than this are around the truck...
      senseRadius: 5, // ...within pull radius * 2 + this (≈ pulse reach: if the pulse can't help, a drop does)
      cooldown: 1.2,
      count: 7, // items per drop
      teaserShare: 0.45, // share of the drop that is one tier ABOVE what you can lift (a goal, not a gift)
      distMin: 4, // landing zone ahead of the truck
      distMax: 10,
      spread: 6,
      height: 10, // fall height (fall ≈ 0.7s; the growing shadow is the telegraph)
    },
    // b) magnet pulse: a shockwave that yanks distant liftable junk in
    pulse: {
      enabled: true,
      baseDelay: 2.5, // seconds without any pickup before it fires (healthy pickup rate)...
      minDelay: 1.5, // ...shrinking to this for struggling players
      cooldown: 2.5,
      rangeMult: 2.0, // range = pull radius * mult * (1 + perMagnetTier * magnet upgrade tier) + add
      rangeAdd: 5, // (= skyDrop.senseRadius, so pulse reach and drop trigger meet)
      perMagnetTier: 0.15, // magnet upgrades make the pulse reach further
      maxItems: 6,
    },
    // c) off-screen arrow toward the best nearby cluster of liftable junk
    arrow: {
      enabled: true,
      idleDelay: 2.0, // show after this long with nothing liftable on screen
    },
  },

  perf: {
    maxFlying: 36, // simultaneous active physics bodies
    maxAttachedVisible: 170, // older pile items are hidden (buried) beyond this
    gridCell: 8,
    pixelRatioDesktop: 2,
    pixelRatioMobile: 1.5,
    particles: 260,
  },

  ui: {
    safeTopMobile: 90, // banner-safe zones (portrait mobile)
    safeBottomMobile: 90,
  },

  skins: [
    { id: 'classic', name: 'Classic', cost: 0, body: 0xff4d3d, cab: 0xffd23f, accent: 0x2b2d42, magnet: 0xe63946, wheel: 0x2b2d42, bigWheels: false },
    { id: 'monster', name: 'Monster', cost: 450, body: 0x7b2ff7, cab: 0x2ee59d, accent: 0x14142b, magnet: 0xff3cac, wheel: 0x1a1a1a, bigWheels: true },
  ],
};

export type Config = typeof CONFIG;
export type UpgradeId = keyof typeof CONFIG.upgrades;
export const UPGRADE_IDS: UpgradeId[] = ['magnet', 'speed', 'time'];

/** Apply ?cfg.a.b=value overrides (numbers / booleans only). */
export function applyConfigOverrides(search: string): string[] {
  const applied: string[] = [];
  const params = new URLSearchParams(search);
  params.forEach((raw, key) => {
    if (!key.startsWith('cfg.')) return;
    const path = key.slice(4).split('.');
    let obj: any = CONFIG;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj?.[path[i]];
      if (obj == null) return;
    }
    const last = path[path.length - 1];
    if (!(last in obj)) return;
    const val = raw === 'true' ? true : raw === 'false' ? false : Number(raw);
    if (typeof val === 'number' && isNaN(val)) return;
    obj[last] = val;
    applied.push(`${key.slice(4)}=${raw}`);
  });
  return applied;
}
