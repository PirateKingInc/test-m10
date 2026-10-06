/**
 * Game controller: round lifecycle, scoring, growth, juice, modes and meta glue.
 * Rendering/simulation live in World / JunkSystem / Truck; DOM lives in UI.
 */
import * as THREE from 'three';
import { CONFIG, UPGRADE_IDS, UpgradeId } from '../config';
import { analytics } from '../core/analytics';
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
  lifted: number;
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
  private lastPickupT = -10;
  private chainTime = 0;
  megaLeft = 0;
  private hitStop = 0;
  private trySkin: string | null = null;
  private liftTier = 0;
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

  /** ?bot=1 — autopilot for tuning / automated tests */
  bot = new URLSearchParams(location.search).get('bot') === '1';
  fps = 60;
  private frames = 0;
  private fpsT = 0;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement, public save: SaveData) {
    this.world = new World(canvas);
    this.truck = new Truck({ ring: 0xff3c38 });
    this.world.scene.add(this.junk.group, this.truck.root, this.truck.magnet, this.truck.ring, this.truck.shadow, this.particles.mesh);
    this.junk.heightAt = this.world.heightAt;
    this.junk.onAttach = (e) => this.onAttach(e.item);
    this.junk.onLiftStart = () => audio.whoosh();
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
    return m.baseCapacity + m.capacityPerMass * Math.pow(this.junk.collectedMass, m.capacityExponent);
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
    return CONFIG.truck.baseSpeed * (1 + this.save.upgrades.speed * CONFIG.upgrades.speed.perLevel) * (1 + (this.truck.scale - 1) * 0.35);
  }
  private truckScale() {
    const T = CONFIG.truck;
    const c = this.baseCapacity();
    return Math.min(T.maxScale, 1 + T.scalePerCapacityLog * Math.log2(c / CONFIG.magnet.baseCapacity));
  }
  private viewRadius() {
    const c = CONFIG.camera;
    const m = CONFIG.magnet;
    const r = Math.min(m.maxRadius, this.baseRadius() + m.radiusPerSqrtMass * Math.sqrt(this.junk.collectedMass));
    return c.baseView + (r - m.baseRadius) * c.viewPerRadius + this.junk.pileRadius * c.viewPerPile * 0.6 + (this.megaLeft > 0 ? 3 : 0);
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
    analytics.track('first_input', { t: analytics.now() });
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

  private buildRound(mode: ModeSpec, opts: RoundOpts) {
    const t0 = performance.now();
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
    this.truck.reset(layout.start.x, layout.start.z, layout.start.heading, this.world.heightAt(layout.start.x, layout.start.z));
    this.particles.clear();
    this.features = createFeatures(this.level.features);
    for (const f of this.features) f.setup?.(this);

    this.timeLeft = this.roundLength;
    this.roundTime = 0;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastPickupT = -10;
    this.megaLeft = opts.mega ? CONFIG.rewarded.megaMagnetDuration : 0;
    this.hitStop = 0;
    this.liftTier = 0;
    this.tierLifted = [0, 0, 0, 0, 0];
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
    analytics.track('round_start', { mode: mode.kind, level: this.level.id, buildMs: Math.round(performance.now() - t0), mega: !!opts.mega, trySkin: opts.trySkin ?? null });
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
    let left = dt;
    do {
      const step = Math.min(left, 1 / 30);
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
        const auto = this.bot && !this.input.active ? this.botSteer(dt) : null;
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
      this.truck.scale += (this.truckScale() - this.truck.scale) * Math.min(1, dt * 3);
      const cap = this.capacity;
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

      if (s === 'playing') {
        for (const f of this.features) f.update?.(this, dt);
        this.roundTime += dt;
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
      if (this.roundTime - this.lastPickupT > CONFIG.combo.window && this.combo > 0) this.combo = 0;

      const growth = (Math.min(CONFIG.magnet.maxRadius, this.baseRadius() + CONFIG.magnet.radiusPerSqrtMass * Math.sqrt(this.junk.collectedMass)) / CONFIG.magnet.baseRadius - 1) * 0.35;
      this.truck.updateVisual(dt, this.junk.pileRadius, radius, growth, this.megaLeft > 0, this.roundTime, this.world.heightAt);
      this.particles.update(dt);
    }
    this.rig.update(realDt, this.truck.x, this.truck.y, this.truck.z, this.truck.forwardX * this.truck.speed, this.truck.forwardZ * this.truck.speed, this.viewRadius());
    this.ui?.updateHud(this);
  }

  private botT = 0;
  private botPos = [0, 0];
  private botEscape = 0;
  private botEscDir: [number, number] = [1, 0];
  /** Tuning bot: chase nearest liftable junk, back off at random when stuck on walls. */
  private botSteer(dt: number): [number, number] | null {
    this.botT += dt;
    if (this.botEscape > 0) {
      this.botEscape -= dt;
      return this.botEscDir;
    }
    if (this.botT > 1) {
      const moved = Math.hypot(this.truck.x - this.botPos[0], this.truck.z - this.botPos[1]);
      this.botPos = [this.truck.x, this.truck.z];
      this.botT = 0;
      if (moved < 4) {
        const a = Math.random() * Math.PI * 2;
        this.botEscDir = [Math.cos(a), Math.sin(a)];
        this.botEscape = 1.5;
        return this.botEscDir;
      }
    }
    const n = this.junk.nearestIdle(this.truck.x, this.truck.z, this.capacity, 45);
    return n ? [n.x - this.truck.x, n.z - this.truck.z] : null;
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
      analytics.track('first_pickup', { t: analytics.now(), afterInput: this.firstInput });
    }
    if (this.roundTime - this.lastPickupT <= C.window) this.combo++;
    else this.combo = 1;
    this.lastPickupT = this.roundTime;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = Math.min(C.maxMult, 1 + (this.combo - 1) * C.multPerStep);
    const air = it.airborne ? 2 : 1;
    this.score += Math.round(it.value * 10 * mult * air);
    this.tierLifted[it.tier]++;

    audio.clunk(it.tier, Math.min(this.combo - 1, C.maxPitchSteps) * C.pitchSemitonesPerStep);
    if (this.combo >= 2) audio.chime(this.combo);
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
    // tier unlock feedback = visible growth moment
    let top = 0;
    CONFIG.tiers.forEach((t, i) => {
      if (t.mass <= this.capacity) top = i;
    });
    if (top > this.liftTier) {
      this.liftTier = top;
      this.toast(`NOW LIFTING ${TIER_NAMES[top]}!`);
      audio.powerUp();
      this.truck.magnetWorld(_v);
      this.particles.burst(_v.x, _v.y, _v.z, 30, [0xffe066, 0xff3cac, 0x4cc9f0], 9, 0.25);
    }
    for (const f of this.features) f.onAttach?.(this, it);
  }

  /* ------------------------------------------------------------ */
  /* Round end                                                     */
  /* ------------------------------------------------------------ */
  private timeUp() {
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
    const earned = Math.floor(this.score * CONFIG.economy.coinsPerPoint) + CONFIG.economy.starCoins[stars] + bonus;
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
    analytics.track('round_end', {
      mode: mode.kind,
      level: this.level.id,
      score: this.score,
      pct: Math.round(pct * 1000) / 10,
      duration: Math.round(this.roundTime * 10) / 10,
      stars,
      coins: total,
      maxCombo: this.maxCombo,
      lifted: this.junk.attachedCount,
      continued: this.extraTimeUsed || this.continueUsed,
    });
    return {
      mode,
      title: mode.kind === 'rush' ? 'RUN OVER!' : "TIME'S UP!",
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
      canExtraTime: mode.kind === 'rush' ? !this.continueUsed : !this.extraTimeUsed,
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
    analytics.track('upgrade_purchase', { id, level: lvl + 1, cost: viaAd ? 0 : cost, via: viaAd ? 'rewarded' : 'coins' });
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
    analytics.track('skin_purchase', { id, cost: skin.cost });
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
      analytics.track('session_length', { seconds: Math.round(analytics.now()), rounds: this.save.stats.rounds, reason: 'hidden' });
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
      coins: this.save.coins,
      calls: this.world.renderer.info.render.calls,
      tris: this.world.renderer.info.render.triangles,
    };
  }
}
