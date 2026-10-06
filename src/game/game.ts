/**
 * Game controller: round lifecycle, scoring, growth, juice, modes and meta glue.
 * Rendering/simulation live in World / JunkSystem / Truck; DOM lives in UI.
 */
import * as THREE from 'three';
import { CONFIG, UPGRADE_IDS, UpgradeId } from '../config';
import { audio } from '../core/audio';
import { Input } from '../core/input';
import { Rng, hashString, todayKey } from '../core/rng';
import { SaveData, writeSave } from '../core/save';
import { ads } from '../core/sdk';
import { CameraRig, Particles } from './effects';
import { createFeatures, Feature, FeatureHost } from './features';
import { Item, JunkSystem } from './junk';
import { JUNK_TYPES } from './junkTypes';
import { DailyGoal, generateLayout, Layout, LEVELS, levelById, LevelDef, ModeKind, dailySetup } from './levels';
import { Truck } from './truck';
import { Assist } from './assist';
import { Bot, BotSkill } from './bot';
import { World } from './world';
import type { UI } from '../ui/ui';

export interface ModeSpec {
  kind: ModeKind;
  levelId: string;
}

export interface RoundOpts {
  mega?: boolean;
  trySkin?: string;
}

export interface Results {
  mode: ModeSpec;
  title: string;
  score: number;
  pct: number; // 0..1 (levels/daily)
  stars: number;
  prevStars: number;
  best: number; // best score (rush) or best pct (levels)
  newBest: boolean;
  coinsEarned: number;
  coinsTotal: number;
  goals: string[];
  dailyDone?: boolean;
  dailyJustDone?: boolean;
  unlocked?: string;
  canExtraTime: boolean;
  canTriple: boolean;
  nextMode: ModeSpec;
  maxCombo: number;
  bestComboRecord: number;
  newBestCombo: boolean;
  bestScore: number;
  outOfReach: boolean;
  lifted: number;
}

export interface DeadTimeStats {
  window: number; // seconds measured (final 30s of play)
  pickups: number; // pickups in the window
  maxGap: number; // longest stretch without a pickup
  meanGap: number;
  gapsOver3: number; // droughts longer than 3s
  secOver3: number; // total seconds spent beyond 3s in droughts
}

/** Gaps between pickups in the last `window` seconds of play. */
export function deadTime(times: number[], end: number, window = 30): DeadTimeStats {
  const start = Math.max(0, end - window);
  const pts = [start, ...times.filter((t) => t >= start && t <= end), end];
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i++) gaps.push(pts[i] - pts[i - 1]);
  const over = gaps.filter((g) => g > 3);
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    window: r(end - start),
    pickups: pts.length - 2,
    maxGap: r(Math.max(...gaps)),
    meanGap: r((end - start) / Math.max(1, pts.length - 1)),
    gapsOver3: over.length,
    secOver3: r(over.reduce((a, g) => a + g - 3, 0)),
  };
}

/** number of pickup droughts longer than `limit` seconds over the whole round */
export function deadTimeOver(times: number[], end: number, limit: number) {
  const pts = [0, ...times.filter((t) => t <= end), end];
  let n = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i] - pts[i - 1] > limit) n++;
  return n;
}

type State = 'boot' | 'attract' | 'playing' | 'timeup' | 'end' | 'loading';

const TIER_NAMES = ['CANS', 'BIKES & DRUMS', 'FRIDGES', 'CARS', 'CONTAINERS'];
const SPARK = [0xffe066, 0xffffff, 0xffb703];
const _v = new THREE.Vector3();

export class Game implements FeatureHost {
  world: World;
  junk = new JunkSystem();
  truck: Truck;
  particles = new Particles();
  assist: Assist;
  /** roundTime of every pickup this round (dead-time metrics) */
  pickupTimes: number[] = [];
  lastDeadTime: DeadTimeStats | null = null;
  rig = new CameraRig();
  input: Input;
  ui!: UI;
  rng = new Rng(Date.now() & 0xffffffff);

  state: State = 'boot';
  mode: ModeSpec = { kind: 'level', levelId: 'junkyard' };
  level: LevelDef = LEVELS[0];
  layout!: Layout;
  features: Feature[] = [];
  dailyGoal: DailyGoal | null = null;

  timeLeft = 0;
  roundLength = 0;
  roundTime = 0; // elapsed playing seconds
  timerRunning = false;
  score = 0;
  combo = 0;
  maxCombo = 0;
  private lastPickupT = 0; // any pickup (assist idle timers)
  private lastComboT = -10; // player pickups only (combo chain)
  private playerPickupTimes: number[] = [];
  /** junk value collected, weighted by combo multiplier and assist factor -> coins */
  private coinValue = 0;
  /** current combo multiplier (x1 / x2 / x3) */
  comboMult = 1;
  private chainTime = 0;
  megaLeft = 0;
  private hitStop = 0;
  private trySkin: string | null = null;
  private liftTier = 0;
  /** next tier to unlock and progress toward it (capacity / its weight); null at the top tier */
  nextGoal(): { tier: number; p: number } | null {
    const next = this.liftTier + 1;
    if (next >= CONFIG.tiers.length) return null;
    return { tier: next, p: Math.min(1, this.capacity / CONFIG.tiers[next].mass) };
  }
  private lastTick = 0;
  tierLifted = [0, 0, 0, 0, 0];

  private firstInput = false;
  private firstPickup = false;
  private hintTimer = 0;
  extraTimeUsed = false;
  continueUsed = false;
  tripleUsed = false;
  private coinsGranted = 0;
  private roundCounted = false;
  lastResults: Results | null = null;
  private wasAirborne = false;

  /** ?bot=1&skill=novice|average|skilled — autopilot for tuning / automated tests */
  bot = new URLSearchParams(location.search).get('bot') === '1';
  private brain = new Bot((new URLSearchParams(location.search).get('skill') as BotSkill) || 'average');
  /** per-round numbers for the bot measurement harness and the ?debug=1 overlay (stays local, never sent) */
  lastRoundStats: Record<string, unknown> | null = null;
  pickups = 0;
  assistedPickups = 0;
  earlyEnd: '' | 'cleared' | 'stuck' = '';
  secondsLost = 0;
  /** ?debug=1&speed=N — simulate N× faster than real time (bot measurements) */
  simSpeed = (() => {
    const p = new URLSearchParams(location.search);
    return p.get('debug') === '1' ? Math.max(1, Math.min(16, Number(p.get('speed')) || 1)) : 1;
  })();
  fps = 60;
  private frames = 0;
  private fpsT = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement, public save: SaveData, opts: { offline?: boolean } = {}) {
    this.world = new World(canvas, opts);
    this.truck = new Truck({ ring: 0xff3c38 });
    this.world.scene.add(this.junk.group, this.truck.root, this.truck.magnet, this.truck.ring, this.truck.shadow, this.particles.mesh);
    this.junk.heightAt = this.world.heightAt;
    this.junk.onAttach = (e) => this.onAttach(e.item);
    this.junk.onLiftStart = () => audio.whoosh();
    this.junk.onLand = (it) => this.onJunkLand(it);
    this.assist = new Assist(this);
    this.world.scene.add(this.assist.group);
    this.input = new Input(canvas);
    this.input.onAnyInput = () => this.onFirstInput();
    audio.setMuted(save.muted);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  /* ------------------------------------------------------------ */
  /* FeatureHost                                                   */
  /* ------------------------------------------------------------ */
  get truckX() {
    return this.truck.x;
  }
  get truckZ() {
    return this.truck.z;
  }
  get half() {
    return this.world.half;
  }
  get capacity() {
    return this.baseCapacity() + (this.megaLeft > 0 ? CONFIG.rewarded.megaCapacityBonus : 0);
  }
  private baseCapacity() {
    const m = CONFIG.magnet;
    const lift = 1 + this.save.upgrades.magnet * CONFIG.upgrades.magnet.liftPerLevel;
    return (m.baseCapacity + m.capacityPerMass * Math.pow(this.junk.collectedMass, m.capacityExponent)) * lift;
  }
  blocked(x: number, z: number) {
    const lim = this.world.half - 3;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return true;
    return this.world.heightAt(x, z) > 0.3;
  }
  toast(text: string) {
    this.ui?.toast(text);
  }

  /* ------------------------------------------------------------ */
  /* Derived stats                                                 */
  /* ------------------------------------------------------------ */
  baseRadius() {
    return CONFIG.magnet.baseRadius * (1 + this.save.upgrades.magnet * CONFIG.upgrades.magnet.perLevel);
  }
  radius() {
    const m = CONFIG.magnet;
    let r = Math.min(m.maxRadius, this.baseRadius() + m.radiusPerSqrtMass * Math.sqrt(this.junk.collectedMass));
    if (this.megaLeft > 0) r *= CONFIG.rewarded.megaMagnetMult;
    if (this.truck.airborne) r *= m.airRadiusMult;
    return r;
  }
  speed() {
    return CONFIG.truck.baseSpeed * (1 + this.save.upgrades.speed * CONFIG.upgrades.speed.perLevel) * (1 + (this.balanceScale() - 1) * 0.35);
  }
  /**
   * The ORIGINAL growth curve. Gameplay that was balanced on it (truck speed, sky-drop distance)
   * keeps using it, so the visual size change below doesn't move any balance numbers.
   */
  balanceScale() {
    const T = CONFIG.truck;
    const c = this.baseCapacity();
    return Math.min(T.maxScale, 1 + T.scalePerCapacityLog * Math.log2(c / CONFIG.magnet.baseCapacity));
  }
  /** highest tier the magnet can lift at this capacity */
  topTier(cap = this.capacity) {
    let top = 0;
    CONFIG.tiers.forEach((t, i) => {
      if (t.mass <= cap) top = i;
    });
    return top;
  }
  /**
   * Size = power: truck visual scale for a lift capacity. Just after tier T unlocks the truck is
   * overTier x the longest T item; it grows (log-capacity) toward underNext x the next tier's
   * length and pops past it on unlock. Liftable junk is always smaller; the next tier is ~same size or bigger.
   */
  visualScaleFor(cap: number) {
    const S = CONFIG.sizing;
    const sizes = this.junk.tierSize;
    const T = CONFIG.tiers;
    const top = this.topTier(cap);
    const lo = sizes[top] * S.overTier;
    let len: number;
    if (top < T.length - 1) {
      const hi = Math.max(lo * 1.06, sizes[top + 1] * S.underNext);
      const f = Math.max(0, Math.min(1, Math.log(cap / T[top].mass) / Math.log(T[top + 1].mass / T[top].mass)));
      len = lo + (hi - lo) * f;
    } else {
      const f = Math.max(0, Math.min(1, Math.log(cap / T[top].mass) / Math.log(4)));
      len = lo * (1 + S.hugeGrowth * f);
    }
    return Math.max(S.minScale, Math.min(S.maxScale, len / this.truck.length));
  }
  private viewRadius() {
    const c = CONFIG.camera;
    const m = CONFIG.magnet;
    const r = Math.min(m.maxRadius, this.baseRadius() + m.radiusPerSqrtMass * Math.sqrt(this.junk.collectedMass));
    const truckLen = this.truck.length * this.truck.targetScale;
    const close = Math.max(c.closeMin, Math.min(1, c.closeBase + c.closePerTruck * truckLen));
    return (c.baseView + (r - m.baseRadius) * c.viewPerRadius + this.junk.pileRadius * c.viewPerPile + (this.megaLeft > 0 ? 3 : 0)) * close;
  }
  pct() {
    return this.junk.totalValue ? this.junk.collectedValue / this.junk.totalValue : 0;
  }

  /* ------------------------------------------------------------ */
  /* Lifecycle                                                     */
  /* ------------------------------------------------------------ */
  boot() {
    this.buildRound({ kind: 'level', levelId: 'junkyard' }, {});
    this.state = 'attract';
    this.timerRunning = false;
    this.ui.showHint(true);
    this.ui.showHud(true);
    requestAnimationFrame((t) => this.frame(t));
  }

  private onFirstInput() {
    audio.unlock();
    if (this.state !== 'attract' || this.firstInput) return;
    this.firstInput = true;
    this.state = 'playing';
    this.timerRunning = true;
    ads.gameplayStart();
    audio.startMusic();
    audio.setMusicIntensity(1);
  }

  modeKey(m: ModeSpec = this.mode) {
    return m.kind === 'level' ? m.levelId : m.kind;
  }

  isUnlocked(levelId: string) {
    const def = levelById(levelId);
    if (!def.unlock) return true;
    return (this.save.stars[def.unlock.level] ?? 0) >= def.unlock.stars;
  }

  /** Public entry: start (or restart) a round. Commercial break before every round after the first. */
  async startRound(mode: ModeSpec, opts: RoundOpts = {}) {
    if (this.state === 'loading') return;
    this.state = 'loading';
    this.ui.hidePanels();
    audio.unlock();
    await ads.commercialBreak(); // every round start after the first (boot) round
    this.buildRound(mode, opts);
    this.state = 'playing';
    this.firstInput = true;
    this.timerRunning = true;
    this.ui.showHud(true);
    ads.gameplayStart();
    audio.startMusic();
    audio.setMusicIntensity(1);
    if (opts.mega) {
      audio.powerUp();
      this.toast('MEGA MAGNET!');
    }
  }

  /** Build a round without starting play (thumbnail staging / tools). */
  stageRound(mode: ModeSpec) {
    this.buildRound(mode, {});
  }

  private buildRound(mode: ModeSpec, opts: RoundOpts) {
    this.mode = mode;
    this.dailyGoal = null;
    let layout: Layout;
    let reserve = 0;
    const timeBonus = this.save.upgrades.time * CONFIG.upgrades.time.perLevel;
    if (mode.kind === 'rush') {
      this.level = { ...LEVELS[0], id: 'junkyard', features: ['waves'] };
      layout = generateLayout(this.level, (Math.random() * 1e9) | 0, CONFIG.rush.initial);
      reserve = 160;
      this.roundLength = CONFIG.rush.startTime + timeBonus;
    } else if (mode.kind === 'daily') {
      const d = dailySetup(todayKey(), hashString('daily-' + todayKey()));
      this.level = d.level;
      this.dailyGoal = d.goal;
      layout = generateLayout(d.level, d.seed);
      this.roundLength = CONFIG.daily.roundLength + timeBonus;
    } else {
      this.level = levelById(mode.levelId);
      layout = generateLayout(this.level, hashString(this.level.id));
      this.roundLength = (this.level.roundTime ?? CONFIG.round.length) + timeBonus;
    }
    this.layout = layout;
    this.world.build(layout);
    this.junk.setup(layout.spawns, layout.half, reserve);
    this.truck.setTheme(layout.theme.ring);
    this.trySkin = opts.trySkin ?? null;
    const skin = CONFIG.skins.find((s) => s.id === (this.trySkin ?? this.save.skin)) ?? CONFIG.skins[0];
    this.truck.setSkin(skin);
    this.junk.setGlowColor(skin.magnet);
    this.truck.reset(layout.start.x, layout.start.z, layout.start.heading, this.world.heightAt(layout.start.x, layout.start.z));
    this.particles.clear();
    this.features = createFeatures(this.level.features);
    for (const f of this.features) f.setup?.(this);

    this.timeLeft = this.roundLength;
    this.roundTime = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastPickupT = 0;
    this.lastComboT = -10;
    this.playerPickupTimes = [];
    this.coinValue = 0;
    this.comboMult = 1;
    this.pickupTimes = [];
    this.pickups = 0;
    this.assistedPickups = 0;
    this.earlyEnd = '';
    this.secondsLost = 0;
    this.brain = new Bot(this.brain.skill);
    this.clearedEarly = false;
    this.clearCoins = 0;
    this.assist.reset();
    this.megaLeft = opts.mega ? CONFIG.rewarded.megaMagnetDuration : 0;
    this.hitStop = 0;
    this.liftTier = this.topTier();
    this.junk.setTierStates(this.liftTier);
    this.truck.targetScale = this.truck.scale = this.visualScaleFor(this.capacity);
    this.tierLifted = [0, 0, 0, 0, 0];
    this.bonks = 0;
    this.bonkT = 0;
    this.firstPickupT = -1;
    this.tierUnlockT = {};
    this.steerLiftT = 0;
    this.steerHeavyT = 0;
    this.steerSampleT = 0;
    this.extraTimeUsed = false;
    this.continueUsed = false;
    this.tripleUsed = false;
    this.coinsGranted = 0;
    this.roundCounted = false;
    this.lastTick = 0;
    this.input.reset();
    this.truck.updateVisual(0, this.junk.pileRadius, this.radius(), 0, this.megaLeft > 0, 0, this.world.heightAt);
    this.rig.snap(this.truck.x, this.truck.y, this.truck.z, this.viewRadius());
    this.ui?.roundStarted();
  }

  /* ------------------------------------------------------------ */
  /* Loop                                                          */
  /* ------------------------------------------------------------ */
  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1; // tab switch / hitch guard
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
    }
    if (ads.busy || document.hidden) {
      this.world.renderer.render(this.world.scene, this.rig.camera);
      return;
    }
    this.input.update();
    // fixed-size sub-steps keep physics stable and real-time on slow devices
    // equal sub-steps (never a tiny remainder step: those caused ramp-launch spikes)
    const total = dt * this.simSpeed;
    const n = Math.max(1, Math.ceil(total / (1 / 30) - 1e-6));
    let left = total;
    do {
      const step = total / n;
      left -= step;
      let simDt = step;
      if (this.hitStop > 0) {
        this.hitStop -= step;
        simDt = 0;
      }
      this.update(simDt, step);
    } while (left > 1e-4);
    this.world.renderer.render(this.world.scene, this.rig.camera);
  }

  private update(dt: number, realDt: number) {
    const s = this.state;
    const sim = s === 'attract' || s === 'playing' || s === 'timeup' || s === 'end';
    if (sim) {
      // steering
      let wantX = 0;
      let wantZ = 0;
      let hasInput = false;
      let target = 0;
      if (s === 'attract') {
        // demo autopilot toward the nearest liftable junk until the player touches
        const n = this.junk.nearestIdle(this.truck.x, this.truck.z, this.capacity, 26);
        if (n) {
          wantX = n.x - this.truck.x;
          wantZ = n.z - this.truck.z;
          hasInput = true;
        }
        target = this.speed() * CONFIG.truck.autoDriveSpeed;
        if (this.bot && this.roundTime === 0 && this.hintTimer > 1) this.onFirstInput();
        this.hintTimer += dt;
        if (this.firstPickup && this.hintTimer > 2.5) this.ui.showHint(true);
      } else if (s === 'playing') {
        const auto = this.bot && !this.input.active ? this.brain.steer(this, dt) : null;
        if (auto) {
          [wantX, wantZ] = auto;
          hasInput = true;
        } else if (this.input.active) {
          wantX = this.input.dirX;
          wantZ = this.input.dirZ;
          hasInput = true;
        }
        target = this.speed();
      }
      const cap = this.capacity;
      this.checkTier(cap);
      this.truck.targetScale = this.visualScaleFor(cap);
      this.truck.stepScale(dt);
      this.truck.collisionScale = Math.min(this.truck.scale, this.balanceScale() * CONFIG.sizing.collisionCap);
      if (s === 'playing' && dt > 0) {
        this.checkBonks(dt, cap);
        this.sampleSteering(dt, hasInput, wantX, wantZ, cap);
      }
      const impact = this.truck.drive(dt, wantX, wantZ, hasInput, target, this.world.heightAt, this.world.half, (x, z, r) => this.pushOut(x, z, r, cap));
      if (this.truck.airborne && !this.wasAirborne && this.truck.vy > 3) audio.jump();
      this.wasAirborne = this.truck.airborne;
      if (impact > 0.15) {
        audio.thud();
        this.rig.shake(CONFIG.juice.landShake * impact);
        this.particles.ring(this.truck.x, this.truck.y, this.truck.z, 14, 0xf1e3c8, 2 * this.truck.scale);
      }
      const radius = this.radius();
      this.junk.update(dt, this.truck.x, this.truck.y, this.truck.z, radius, cap, this.truck.pileMatrix, s === 'attract' || s === 'playing', this.truck.airborne);
      if (s === 'playing' && this.timerRunning) this.assist.update(dt);
      else this.assist.arrowTarget = null;
      this.assist.visual(dt, window.innerWidth, window.innerHeight, this.ui?.insetTop ?? 0, this.ui?.insetBottom ?? 0);

      if (s === 'playing') {
        for (const f of this.features) f.update?.(this, dt);
        this.roundTime += dt;
        this.clearCheckT -= dt;
        if (CONFIG.round.endWhenCleared && this.clearCheckT <= 0 && this.timerRunning && this.mode.kind !== 'rush') {
          this.clearCheckT = 0.5;
          if (!this.junk.anyLiftable(this.capacity)) {
            if (this.pct() >= this.level.stars[2]) this.levelCleared();
            else if (CONFIG.round.endWhenStuck) this.outOfReach();
          }
        }
        if (this.timerRunning) {
          const drain = this.mode.kind === 'rush' ? 1 + (this.roundTime / 60) * CONFIG.rush.drainPerMinute : 1;
          this.timeLeft -= dt * drain;
          const sec = Math.ceil(this.timeLeft);
          if (sec <= CONFIG.round.warnAt && sec > 0 && sec !== this.lastTick) {
            this.lastTick = sec;
            audio.tick(sec <= 3);
          }
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.timeUp();
          }
        }
        if (this.megaLeft > 0) {
          this.megaLeft -= dt;
          if (this.megaLeft <= 0) this.toast('Mega Magnet ended');
        }
      }
      if (this.roundTime - this.lastComboT > CONFIG.combo.window && this.combo > 0) {
        this.combo = 0;
        this.comboMult = 1;
      }

      const growth = (Math.min(CONFIG.magnet.maxRadius, this.baseRadius() + CONFIG.magnet.radiusPerSqrtMass * Math.sqrt(this.junk.collectedMass)) / CONFIG.magnet.baseRadius - 1) * 0.35;
      this.truck.updateVisual(dt, this.junk.pileRadius, radius, growth, this.megaLeft > 0, this.roundTime, this.world.heightAt);
      this.particles.update(dt);
    }
    this.junk.setOutlineZoom(this.rig.distance);
    this.rig.update(realDt, this.truck.x, this.truck.y, this.truck.z, this.truck.forwardX * this.truck.speed, this.truck.forwardZ * this.truck.speed, this.viewRadius());
    this.ui?.updateHud(this);
  }


  /** seconds left before the running combo breaks (0 if none) */
  comboTimeLeft() {
    return this.combo > 0 ? Math.max(0, CONFIG.combo.window - (this.roundTime - this.lastComboT)) : 0;
  }

  /** player (non-assisted) pickups since round time t */
  playerPickupsSince(t: number) {
    let n = 0;
    for (let i = this.playerPickupTimes.length - 1; i >= 0 && this.playerPickupTimes[i] >= t; i--) n++;
    return n;
  }

  sinceLastPickup() {
    return this.roundTime - this.lastPickupT;
  }

  private onJunkLand(it: Item) {
    if (this.state !== 'playing' && this.state !== 'attract') return;
    audio.dropThud();
    this.particles.ring(it.x, it.baseY, it.z, 8, 0xf1e3c8, it.radius * 1.4);
    const d = Math.hypot(it.x - this.truck.x, it.z - this.truck.z);
    if (d < 25) this.rig.shake(0.04 + it.tier * 0.03);
  }

  /* ---------------- readability: tiers, bonks, steering ---------------- */
  bonks = 0;
  private bonkT = 0;
  firstPickupT = -1;
  tierUnlockT: Record<number, number> = {};
  private steerLiftT = 0;
  private steerHeavyT = 0;
  private steerSampleT = 0;

  /** Tier crossings from ANY source (pickups, pulses, Mega Magnet on/off). Unlocks get the power-up moment. */
  private checkTier(cap: number) {
    const top = this.topTier(cap);
    if (top === this.liftTier) return;
    const up = top > this.liftTier;
    this.liftTier = top;
    this.junk.setTierStates(top, up ? top : -1);
    if (!up) return;
    if (this.state === 'playing' && this.tierUnlockT[top] === undefined) this.tierUnlockT[top] = Math.round(this.roundTime * 10) / 10;
    this.toast(`NOW LIFTING ${TIER_NAMES[top]}!`);
    audio.powerUp();
    this.truck.pop();
    this.rig.shake(0.15);
    this.truck.magnetWorld(_v);
    this.particles.burst(_v.x, _v.y, _v.z, 30, [0xffe066, 0xff3cac, 0x4cc9f0], 9, 0.25);
    this.particles.ring(this.truck.x, this.truck.y, this.truck.z, 20, 0xffffff, this.truck.length * this.truck.scale * 0.6);
  }

  /** Driving into junk that is too heavy: wobble + clank + "TOO HEAVY" pop with progress. */
  private checkBonks(dt: number, cap: number) {
    const H = CONFIG.highlight;
    this.bonkT -= dt;
    const r = CONFIG.truck.collisionRadius * this.truck.collisionScale;
    const now = this.roundTime;
    this.junk.forEachNear(this.truck.x, this.truck.z, r + 5, (it) => {
      if (it.mass <= cap || Math.abs(it.baseY - this.truck.y) > 1) return;
      if (Math.hypot(it.x - this.truck.x, it.z - this.truck.z) > r + it.footR * 0.85) return;
      if (now - (it.bonkAt ?? -99) < H.bonkCooldown) return;
      it.bonkAt = now;
      this.junk.bonk(it);
      this.bonks++;
      if (this.bonkT > 0) return;
      this.bonkT = H.bonkGap;
      audio.clank(it.tier);
      this.rig.shake(0.08 + it.tier * 0.03);
      this.truck.bump(0.1);
      _v.set(it.x, it.y + it.radius * 1.2, it.z).project(this.rig.camera);
      this.ui?.tooHeavy((_v.x * 0.5 + 0.5) * window.innerWidth, (-_v.y * 0.5 + 0.5) * window.innerHeight, Math.min(1, cap / it.mass), it.tier);
    });
  }

  /** Is the player steering toward something liftable? (nearest resting junk in a 25° cone, 30 units) */
  private sampleSteering(dt: number, hasInput: boolean, wx: number, wz: number, cap: number) {
    this.steerSampleT -= dt;
    if (this.steerSampleT > 0) return;
    const step = 0.1;
    this.steerSampleT = step;
    const l = Math.hypot(wx, wz);
    if (!hasInput || l < 1e-3) return;
    const dx = wx / l;
    const dz = wz / l;
    let best: Item | null = null;
    let bd = 30;
    const cos = Math.cos((25 * Math.PI) / 180);
    this.junk.forEachNear(this.truck.x, this.truck.z, 30, (it) => {
      const ox = it.x - this.truck.x;
      const oz = it.z - this.truck.z;
      const d = Math.hypot(ox, oz);
      if (d < 0.5 || d >= bd || (ox * dx + oz * dz) / d < cos) return;
      bd = d;
      best = it;
    });
    if (!best) return;
    if ((best as Item).mass <= cap) this.steerLiftT += step;
    else this.steerHeavyT += step;
  }

  /** debug/screenshot helper: pretend `mass` was collected and park the truck at (x, z). */
  debugPose(x: number, z: number, heading: number, mass: number) {
    this.junk.collectedMass = mass;
    this.truck.x = x;
    this.truck.z = z;
    this.truck.heading = heading;
    this.truck.speed = 0;
    this.truck.y = this.world.heightAt(x, z);
    this.checkTier(this.capacity);
    this.truck.targetScale = this.truck.scale = this.visualScaleFor(this.capacity);
    this.truck.updateVisual(0, this.junk.pileRadius, this.radius(), 0.3, false, 0, this.world.heightAt);
    this.rig.snap(x, this.truck.y, z, this.viewRadius());
  }

  /** readability metrics for the overlay / round_end */
  readabilityStats() {
    const mins = Math.max(this.roundTime, 1) / 60;
    const steer = this.steerLiftT + this.steerHeavyT;
    return {
      bonks: this.bonks,
      bonkRate: Math.round((this.bonks / mins) * 10) / 10,
      firstPickupT: this.firstPickupT < 0 ? null : Math.round(this.firstPickupT * 10) / 10,
      tierUnlockT: { ...this.tierUnlockT },
      steerLiftPct: steer ? Math.round((this.steerLiftT / steer) * 1000) / 10 : null,
    };
  }

  /** Push the truck out of junk that is too heavy to lift. */
  private pushOut(x: number, z: number, r: number, cap: number): [number, number] {
    let px = x;
    let pz = z;
    this.junk.forEachBlocker(x, z, cap, (it) => {
      if (Math.abs(it.y - this.truck.y) > 2) return;
      const dx = px - it.x;
      const dz = pz - it.z;
      const d = Math.hypot(dx, dz);
      const min = r + it.footR;
      if (d < min && d > 1e-4) {
        px = it.x + (dx / d) * min;
        pz = it.z + (dz / d) * min;
      }
    });
    return [px, pz];
  }

  /* ------------------------------------------------------------ */
  /* Pickups                                                       */
  /* ------------------------------------------------------------ */
  private onAttach(it: Item) {
    const C = CONFIG.combo;
    const J = CONFIG.juice;
    if (!this.firstPickup) {
      this.firstPickup = true;
      this.hintTimer = 0;
      this.ui.showHint(false);
    }
    const E = CONFIG.economy;
    const assisted = !!it.assisted;
    // assisted pickups (sky drop / pulse) never extend the combo; they don't break it either
    if (!assisted) {
      if (this.roundTime - this.lastComboT <= C.window) this.combo++;
      else this.combo = 1;
      this.lastComboT = this.roundTime;
      this.playerPickupTimes.push(this.roundTime);
    }
    this.lastPickupT = this.roundTime;
    if (this.state === 'playing') {
      this.pickupTimes.push(this.roundTime);
      this.pickups++;
      if (assisted) this.assistedPickups++;
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    let mult = 1;
    for (const st of C.steps) if (this.combo >= st.at) mult = st.mult;
    if (mult > this.comboMult && !assisted) {
      this.ui.multiplier(mult);
      audio.comboTier(mult);
    }
    this.comboMult = mult;
    const m = assisted ? 1 : mult;
    const air = it.airborne ? 2 : 1;
    this.score += Math.round(it.value * 10 * m * air * (assisted ? E.assistedScoreFactor : 1));
    this.coinValue += it.value * m * (assisted ? E.assistedCoinFactor : 1);
    this.tierLifted[it.tier]++;

    audio.clunk(it.tier, assisted ? 0 : Math.min(this.combo - 1, C.maxPitchSteps) * C.pitchSemitonesPerStep);
    if (this.combo >= 2 && !assisted) audio.chime(this.combo);
    this.truck.bump(J.squashByTier[it.tier]);
    this.rig.shake(J.shakeByTier[it.tier]);
    const paint = JUNK_TYPES[it.type].paints[0];
    this.particles.burst(it.x, it.y, it.z, J.particlesByTier[it.tier], [...SPARK, paint], 4 + it.tier * 1.5, 0.12 + it.tier * 0.06);
    if (it.tier >= 3) {
      this.hitStop = it.tier >= 4 ? J.hitStopHuge : J.hitStopLarge;
      this.particles.ring(this.truck.x, this.truck.y, this.truck.z, 18, 0xffffff, 3);
      this.toast(it.tier >= 4 ? 'MASSIVE!' : 'HEAVY!');
    }
    if (this.combo >= C.popupMin) this.ui.combo(this.combo);
    if (air > 1 && Math.random() < 0.3) this.toast('AIR GRAB x2!');

    if (this.combo === 1) this.chainTime = 0;
    if (this.mode.kind === 'rush' && this.combo >= CONFIG.rush.comboTimeMin && this.state === 'playing' && this.chainTime < CONFIG.rush.comboTimeCapPerChain) {
      const add = Math.min(CONFIG.rush.comboTimeAdd, CONFIG.rush.comboTimeCapPerChain - this.chainTime);
      this.chainTime += add;
      this.timeLeft = Math.min(CONFIG.rush.maxTime, this.timeLeft + add);
      this.ui.timeBonus();
    }
    if (this.firstPickupT < 0 && this.state === 'playing') this.firstPickupT = this.roundTime;
    for (const f of this.features) f.onAttach?.(this, it);
  }

  /* ------------------------------------------------------------ */
  /* Round end                                                     */
  /* ------------------------------------------------------------ */
  private clearCheckT = 0;
  /** Nothing liftable left: end early and pay out the remaining time. */
  private levelCleared() {
    const secs = Math.ceil(this.timeLeft);
    this.earlyEnd = 'cleared';
    this.secondsLost = this.timeLeft;
    this.clearedEarly = true;
    this.score += secs * CONFIG.round.clearBonusPerSecond;
    this.clearCoins = secs * CONFIG.round.clearBonusCoinsPerSecond;
    this.toast(`LEVEL CLEARED! +${(secs * CONFIG.round.clearBonusPerSecond).toLocaleString()}`);
    audio.powerUp();
    this.timeLeft = 0;
    this.timeUp();
  }
  clearedEarly = false;
  private clearCoins = 0;

  /** Nothing left this magnet can lift, but no 3★ yet: end now (no bonus) instead of stranding the player. */
  private outOfReach() {
    this.earlyEnd = 'stuck';
    this.secondsLost = this.timeLeft;
    this.toast('NOTHING LEFT YOU CAN LIFT!');
    this.timeLeft = 0;
    this.timeUp();
  }

  private timeUp() {
    this.lastDeadTime = deadTime(this.pickupTimes, this.roundTime);
    this.state = 'timeup';
    this.timerRunning = false;
    ads.gameplayStop();
    audio.timeUp();
    audio.setMusicIntensity(0);
    this.ui.timeUp();
    setTimeout(() => this.finishRound(), CONFIG.round.endScreenDelay * 1000);
  }

  private finishRound() {
    if (this.state !== 'timeup') return;
    this.state = 'end';
    const r = this.computeResults();
    this.lastResults = r;
    this.ui.showEnd(r);
  }

  private computeResults(): Results {
    const save = this.save;
    const mode = this.mode;
    const key = this.modeKey();
    const pct = this.pct();
    let stars = 0;
    if (mode.kind === 'rush') CONFIG.rush.stars.forEach((t) => this.score >= t && stars++);
    else this.level.stars.forEach((t) => pct >= t && stars++);
    const prevStars = save.stars[key] ?? 0;
    save.stars[key] = Math.max(prevStars, stars);

    let dailyDone: boolean | undefined;
    let dailyJustDone = false;
    let bonus = 0;
    if (mode.kind === 'daily' && this.dailyGoal) {
      const g = this.dailyGoal;
      dailyDone = g.kind === 'pct' ? pct >= g.target : this.tierLifted[g.tier!] >= g.target;
      const today = todayKey();
      if (save.daily.date !== today) save.daily = { date: today, completed: false, best: 0 };
      save.daily.best = Math.max(save.daily.best, this.score);
      if (dailyDone && !save.daily.completed) {
        save.daily.completed = true;
        dailyJustDone = true;
        bonus += CONFIG.economy.dailyReward;
      }
    }

    // best
    let newBest = false;
    let best: number;
    if (mode.kind === 'rush' || mode.kind === 'daily') {
      const prev = save.bestScore[key] ?? 0;
      newBest = this.score > prev && prev > 0;
      save.bestScore[key] = Math.max(prev, this.score);
      best = save.bestScore[key];
    } else {
      const prev = save.bestPct[key] ?? 0;
      newBest = pct > prev + 1e-6 && prev > 0;
      save.bestPct[key] = Math.max(prev, pct);
      save.bestScore[key] = Math.max(save.bestScore[key] ?? 0, this.score);
      best = save.bestPct[key];
    }

    // coins (delta vs anything already granted this round, so +time continues are fair)
    const earned = Math.floor(this.coinValue * CONFIG.economy.coinsPerValue) + CONFIG.economy.starCoins[stars] + bonus + this.clearCoins;
    const prevCombo = save.bestCombo[key] ?? 0;
    save.bestCombo[key] = Math.max(prevCombo, this.maxCombo);
    const total = Math.max(earned, this.coinsGranted);
    save.coins += total - this.coinsGranted;
    this.coinsGranted = total;

    if (!this.roundCounted) {
      save.stats.rounds++;
      this.roundCounted = true;
    }
    save.stats.playSeconds += Math.round(this.roundTime);
    writeSave(save);

    // unlocks
    let unlocked: string | undefined;
    for (const l of LEVELS) {
      if (l.unlock && l.unlock.level === key && prevStars < l.unlock.stars && stars >= l.unlock.stars) unlocked = l.id;
    }

    const goals = this.nextGoals(mode, stars, pct);
    const nextMode: ModeSpec = unlocked ? { kind: 'level', levelId: unlocked } : mode;
    const whole = deadTime(this.pickupTimes, this.roundTime, this.roundTime);
    this.lastRoundStats = {
      mode: mode.kind,
      level: this.level.id,
      score: this.score,
      pct: Math.round(pct * 1000) / 10,
      stars,
      coins: total,
      maxGap: whole.maxGap,
      maxGap30: this.lastDeadTime?.maxGap ?? 0,
      gapsOver35: deadTimeOver(this.pickupTimes, this.roundTime, 3.5),
      assistedShare: this.pickups ? Math.round((this.assistedPickups / this.pickups) * 1000) / 10 : 0,
      bestCombo: this.maxCombo,
      roundTime: Math.round(this.roundTime * 10) / 10,
      earlyEnd: this.earlyEnd,
      secondsLost: Math.round(this.secondsLost * 10) / 10,
      droughts: this.assist.droughts.slice(0, 5),
      ...this.readabilityStats(),
    };
    return {
      mode,
      title: mode.kind === 'rush' ? 'RUN OVER!' : this.clearedEarly ? 'CLEARED!' : this.earlyEnd === 'stuck' ? 'OUT OF REACH!' : "TIME'S UP!",
      bestComboRecord: save.bestCombo[key],
      newBestCombo: this.maxCombo > prevCombo && prevCombo > 0,
      bestScore: save.bestScore[key] ?? this.score,
      outOfReach: this.earlyEnd === 'stuck',
      score: this.score,
      pct,
      stars,
      prevStars,
      best,
      newBest,
      coinsEarned: total,
      coinsTotal: save.coins,
      goals,
      dailyDone,
      dailyJustDone,
      unlocked,
      canExtraTime: mode.kind === 'rush' ? !this.continueUsed : !this.extraTimeUsed && !this.earlyEnd,
      canTriple: !this.tripleUsed && total > 0,
      nextMode,
      maxCombo: this.maxCombo,
      lifted: this.junk.attachedCount,
    };
  }

  private nextGoals(mode: ModeSpec, stars: number, pct: number): string[] {
    const out: string[] = [];
    if (mode.kind === 'rush') {
      const best = this.save.bestScore.rush ?? 0;
      const nextStar = CONFIG.rush.stars.find((t) => t > this.score);
      out.push(nextStar ? `🎯 Score ${nextStar.toLocaleString()} for ${'★'.repeat(CONFIG.rush.stars.indexOf(nextStar) + 1)}` : `🎯 Best to beat: ${best.toLocaleString()}`);
    } else if (mode.kind === 'daily' && this.dailyGoal) {
      out.push(this.save.daily.completed ? '✅ Daily done — come back tomorrow!' : `🎯 Daily: ${this.dailyGoal.text}`);
    } else {
      const th = this.level.stars;
      const best = Math.max(stars, this.save.stars[this.level.id] ?? 0);
      if (best < 3) out.push(`🎯 Clean ${Math.round(th[best] * 100)}% for ${'★'.repeat(best + 1)}`);
      else out.push(`🎯 Beat your best: ${Math.round((this.save.bestPct[this.level.id] ?? pct) * 100)}%`);
    }
    // cheapest next upgrade
    let bestUp: { id: UpgradeId; cost: number } | null = null;
    for (const id of UPGRADE_IDS) {
      const lvl = this.save.upgrades[id];
      const u = CONFIG.upgrades[id];
      if (lvl >= u.maxLevel) continue;
      const cost = u.costs[lvl];
      if (!bestUp || cost < bestUp.cost) bestUp = { id, cost };
    }
    if (bestUp) {
      const u = CONFIG.upgrades[bestUp.id];
      const need = bestUp.cost - this.save.coins;
      out.push(need > 0 ? `${u.icon} ${u.name} Lv${this.save.upgrades[bestUp.id] + 1}: ${need} more coins` : `${u.icon} ${u.name} Lv${this.save.upgrades[bestUp.id] + 1} ready — open the Garage!`);
    }
    return out;
  }

  /* ------------------------------------------------------------ */
  /* Rewarded grants (called by UI only after SDK success)         */
  /* ------------------------------------------------------------ */
  grantExtraTime() {
    const rush = this.mode.kind === 'rush';
    if (rush) this.continueUsed = true;
    else this.extraTimeUsed = true;
    this.timeLeft = rush ? CONFIG.rewarded.continueRunTime : CONFIG.rewarded.extraTime;
    this.lastTick = 0;
    this.state = 'playing';
    this.timerRunning = true;
    this.ui.hidePanels();
    this.ui.showHud(true);
    ads.gameplayStart();
    audio.setMusicIntensity(1);
    audio.powerUp();
    this.toast(rush ? 'KEEP GOING!' : `+${CONFIG.rewarded.extraTime} SECONDS!`);
  }

  grantTriple(): number {
    if (this.tripleUsed) return 0;
    this.tripleUsed = true;
    const extra = this.coinsGranted * (CONFIG.rewarded.tripleCoins - 1);
    this.save.coins += extra;
    this.coinsGranted += extra;
    writeSave(this.save);
    audio.coin();
    return extra;
  }

  buyUpgrade(id: UpgradeId, viaAd: boolean): boolean {
    const u = CONFIG.upgrades[id];
    const lvl = this.save.upgrades[id];
    if (lvl >= u.maxLevel) return false;
    const cost = u.costs[lvl];
    if (viaAd) {
      const k = `${id}:${lvl}`;
      if (this.save.freeUpgradeUsed[k]) return false;
      this.save.freeUpgradeUsed[k] = true;
    } else {
      if (this.save.coins < cost) return false;
      this.save.coins -= cost;
    }
    this.save.upgrades[id] = lvl + 1;
    writeSave(this.save);
    audio.powerUp();
    return true;
  }

  buySkin(id: string): boolean {
    const skin = CONFIG.skins.find((s) => s.id === id);
    if (!skin || this.save.ownedSkins.includes(id) || this.save.coins < skin.cost) return false;
    this.save.coins -= skin.cost;
    this.save.ownedSkins.push(id);
    this.save.skin = id;
    writeSave(this.save);
    this.truck.setSkin(skin);
    audio.powerUp();
    return true;
  }

  selectSkin(id: string) {
    if (!this.save.ownedSkins.includes(id)) return;
    this.save.skin = id;
    writeSave(this.save);
    const skin = CONFIG.skins.find((s) => s.id === id)!;
    this.truck.setSkin(skin);
  }

  setMuted(m: boolean) {
    this.save.muted = m;
    audio.setMuted(m);
    writeSave(this.save);
  }

  /* ------------------------------------------------------------ */
  /* Misc                                                          */
  /* ------------------------------------------------------------ */
  private onVisibility() {
    if (document.hidden) {
      ads.gameplayStop();
      audio.setAdMuted(true);
      writeSave(this.save);
    } else {
      if (!ads.busy) audio.setAdMuted(false);
      if (this.state === 'playing') ads.gameplayStart();
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.world.resize(w, h);
    this.rig.resize(w, h);
    document.documentElement.classList.toggle('portrait', h > w);
  }

  debugStats() {
    return {
      state: this.state,
      fps: this.fps.toFixed(0),
      mode: this.modeKey(),
      time: this.timeLeft.toFixed(1),
      score: this.score,
      pct: (this.pct() * 100).toFixed(1) + '%',
      capacity: this.capacity.toFixed(1),
      radius: this.radius().toFixed(2),
      pile: this.junk.pileRadius.toFixed(2),
      items: this.junk.items.length,
      attached: this.junk.attachedCount,
      active: this.junk.activeCount,
      flying: this.junk.flying,
      combo: this.combo,
      mega: this.megaLeft > 0 ? this.megaLeft.toFixed(1) : '-',
      mult: 'x' + this.comboMult,
      assistDly: `drop ${this.assist.dropDelay.toFixed(1)} pulse ${this.assist.pulseDelay.toFixed(1)}`,
      assisted: `${this.assistedPickups}/${this.pickups}`,
      size: `x${this.truck.scale.toFixed(2)} (${(this.truck.length * this.truck.scale).toFixed(1)}u) tier ${this.liftTier}`,
      bonks: `${this.readabilityStats().bonks} (${this.readabilityStats().bonkRate}/min)`,
      '1stPick': this.firstPickupT < 0 ? '-' : this.firstPickupT.toFixed(1) + 's',
      unlocks: Object.entries(this.tierUnlockT).map(([t, v]) => `T${t}@${v}s`).join(' ') || '-',
      steerLift: (this.readabilityStats().steerLiftPct ?? '-') + '%',
      coins: this.save.coins,
      calls: this.world.renderer.info.render.calls,
      tris: this.world.renderer.info.render.triangles,
    };
  }
}
