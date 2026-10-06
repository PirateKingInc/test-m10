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
    radiusPerSqrtMass: 0.15, // + k * sqrt(collected mass)
    maxRadius: 12,
    baseCapacity: 1.6, // max liftable mass at start (tiny = 1)
    capacityPerMass: 0.12, // + k * collectedMass ^ capacityExponent
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

  /** visual scale per tier (tiny stuff must read on a phone) */
  tierModelScale: [1.4, 1.15, 1, 1, 1],
  /** pile compaction: big pieces shrink as they join the pile so it stays readable */
  attachScaleByTier: [1, 1, 0.85, 0.62, 0.48],

  combo: {
    window: 0.5, // seconds between pickups to keep the combo
    multPerStep: 0.1, // score multiplier per combo step
    maxMult: 3,
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
    baseView: 11, // world radius kept visible at start
    viewPerRadius: 1.55, // + per unit of magnet radius
    viewPerPile: 1.2,
    minPortraitWidth: 0.62, // half-width kept visible = view * k (matters in portrait)
    follow: 7, // position follow stiffness
    zoomLerp: 1.6,
    lead: 0.25, // look-ahead in seconds of travel
  },

  economy: {
    coinsPerPoint: 0.0035, // ~25k pts typical round -> ~90 coins + star bonus
    starCoins: [0, 10, 25, 50], // bonus by stars earned this round
    dailyReward: 200,
    startCoins: 0,
  },

  upgrades: {
    magnet: { name: 'Magnet Radius', icon: '🧲', maxLevel: 5, costs: [60, 130, 220, 340, 500], perLevel: 0.18 }, // +18% base radius per level
    speed: { name: 'Truck Speed', icon: '⚡', maxLevel: 5, costs: [50, 110, 190, 300, 450], perLevel: 0.08 }, // +8% speed per level
    time: { name: 'More Time', icon: '⏱️', maxLevel: 5, costs: [70, 150, 250, 380, 550], perLevel: 5 }, // +5 s per level
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
