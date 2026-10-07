/**
 * Test-build-only tooling: ?bot=1 autopilot, ?debug=1 speed-up / fps / overlay stats, and the
 * per-round numbers the bot measurement harness reads. Every call site is guarded with
 * `if (!__STRIP__)`, so the Poki build (`vite build --mode poki`) drops this module entirely.
 */
import * as THREE from 'three';
import { Bot, BotSkill } from '../game/bot';
import type { Game } from '../game/game';
import type { Item } from '../game/junk';

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

export class DevTools {
  private params = new URLSearchParams(location.search);
  /** ?bot=1&skill=novice|average|skilled — autopilot for tuning / automated tests */
  bot = this.params.get('bot') === '1';
  private brain = new Bot((this.params.get('skill') as BotSkill) || 'average');
  /** ?debug=1&speed=N — simulate N× faster than real time (bot measurements) */
  simSpeed = this.params.get('debug') === '1' ? Math.max(1, Math.min(16, Number(this.params.get('speed')) || 1)) : 1;
  fps = 60;
  private frames = 0;
  private fpsT = 0;

  /** per-round numbers for the bot measurement harness and the ?debug=1 overlay (local only) */
  lastRoundStats: Record<string, unknown> | null = null;
  lastDeadTime: DeadTimeStats | null = null;
  pickupTimes: number[] = [];
  /** why droughts got long (written by Assist) */
  droughts: Record<string, unknown>[] = [];
  droughtLogged = false;
  /** last assist action, for drought logs */
  lastAction = '';
  bonks = 0;
  firstPickupT = -1;
  tierUnlockT: Record<number, number> = {};
  private steerLiftT = 0;
  private steerHeavyT = 0;
  private steerSampleT = 0;

  constructor(private g: Game) {}

  frame(dt: number) {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = this.frames / this.fpsT;
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  resetRound() {
    this.brain = new Bot(this.brain.skill);
    this.pickupTimes = [];
    this.droughts = [];
    this.droughtLogged = false;
    this.lastAction = '';
    this.bonks = 0;
    this.firstPickupT = -1;
    this.tierUnlockT = {};
    this.steerLiftT = 0;
    this.steerHeavyT = 0;
    this.steerSampleT = 0;
  }

  /** autopilot steering while playing (null = no bot or the player has the controls) */
  steer(dt: number): [number, number] | null {
    return this.bot && !this.g.input.active ? this.brain.steer(this.g, dt) : null;
  }

  onPickup() {
    const g = this.g;
    this.pickupTimes.push(g.roundTime);
    if (this.firstPickupT < 0 && g.state === 'playing') this.firstPickupT = g.roundTime;
  }

  onTierUnlock(top: number) {
    if (this.g.state === 'playing' && this.tierUnlockT[top] === undefined) this.tierUnlockT[top] = Math.round(this.g.roundTime * 10) / 10;
  }

  onTimeUp() {
    this.lastDeadTime = deadTime(this.pickupTimes, this.g.roundTime);
  }

  /** Is the player steering toward something liftable? (nearest resting junk in a 25° cone, 30 units) */
  sampleSteering(dt: number, hasInput: boolean, wx: number, wz: number, cap: number) {
    const g = this.g;
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
    g.junk.forEachNear(g.truck.x, g.truck.z, 30, (it) => {
      const ox = it.x - g.truck.x;
      const oz = it.z - g.truck.z;
      const d = Math.hypot(ox, oz);
      if (d < 0.5 || d >= bd || (ox * dx + oz * dz) / d < cos) return;
      bd = d;
      best = it;
    });
    if (!best) return;
    if ((best as Item).mass <= cap) this.steerLiftT += step;
    else this.steerHeavyT += step;
  }

  readabilityStats() {
    const mins = Math.max(this.g.roundTime, 1) / 60;
    const steer = this.steerLiftT + this.steerHeavyT;
    return {
      bonks: this.bonks,
      bonkRate: Math.round((this.bonks / mins) * 10) / 10,
      firstPickupT: this.firstPickupT < 0 ? null : Math.round(this.firstPickupT * 10) / 10,
      tierUnlockT: { ...this.tierUnlockT },
      steerLiftPct: steer ? Math.round((this.steerLiftT / steer) * 1000) / 10 : null,
    };
  }

  roundEnd(r: { mode: string; pct: number; stars: number; coins: number }) {
    const g = this.g;
    const whole = deadTime(this.pickupTimes, g.roundTime, g.roundTime);
    this.lastRoundStats = {
      mode: r.mode,
      level: g.level.id,
      score: g.score,
      pct: Math.round(r.pct * 1000) / 10,
      stars: r.stars,
      coins: r.coins,
      maxGap: whole.maxGap,
      maxGap30: this.lastDeadTime?.maxGap ?? 0,
      gapsOver35: deadTimeOver(this.pickupTimes, g.roundTime, 3.5),
      assistedShare: g.pickups ? Math.round((g.assistedPickups / g.pickups) * 1000) / 10 : 0,
      bestCombo: g.maxCombo,
      roundTime: Math.round(g.roundTime * 10) / 10,
      earlyEnd: g.earlyEnd,
      secondsLost: Math.round(g.secondsLost * 10) / 10,
      droughts: this.droughts.slice(0, 5),
      ...this.readabilityStats(),
    };
  }

  /** debug/screenshot helper: pretend `mass` was collected and park the truck at (x, z). */
  pose(x: number, z: number, heading: number, mass: number) {
    const g = this.g;
    g.junk.collectedMass = mass;
    g.truck.x = x;
    g.truck.z = z;
    g.truck.heading = heading;
    g.truck.speed = 0;
    g.truck.y = g.world.heightAt(x, z);
    g.checkTier(g.capacity);
    g.truck.targetScale = g.truck.scale = g.visualScaleFor(g.capacity);
    g.truck.updateVisual(0, g.junk.pileRadius, g.radius(), 0.3, false, 0, g.world.heightAt);
    g.rig.snap(x, g.truck.y, z, g.viewRadius());
  }

  /** ?debug=1 overlay rows */
  stats() {
    const g = this.g;
    const rs = this.readabilityStats();
    const info = (g.world.renderer as THREE.WebGLRenderer).info.render;
    return {
      state: g.state,
      fps: this.fps.toFixed(0),
      mode: g.modeKey(),
      time: g.timeLeft.toFixed(1),
      score: g.score,
      pct: (g.pct() * 100).toFixed(1) + '%',
      capacity: g.capacity.toFixed(1),
      radius: g.radius().toFixed(2),
      pile: g.junk.pileRadius.toFixed(2),
      items: g.junk.items.length,
      attached: g.junk.attachedCount,
      active: g.junk.activeCount,
      flying: g.junk.flying,
      combo: g.combo,
      mega: g.megaLeft > 0 ? g.megaLeft.toFixed(1) : '-',
      mult: 'x' + g.comboMult,
      assistDly: `drop ${g.assist.dropDelay.toFixed(1)} pulse ${g.assist.pulseDelay.toFixed(1)}`,
      assisted: `${g.assistedPickups}/${g.pickups}`,
      size: `x${g.truck.scale.toFixed(2)} (${(g.truck.length * g.truck.scale).toFixed(1)}u) tier ${g.topTier()}`,
      bonks: `${rs.bonks} (${rs.bonkRate}/min)`,
      '1stPick': this.firstPickupT < 0 ? '-' : this.firstPickupT.toFixed(1) + 's',
      unlocks: Object.entries(this.tierUnlockT).map(([t, v]) => `T${t}@${v}s`).join(' ') || '-',
      steerLift: (rs.steerLiftPct ?? '-') + '%',
      coins: g.save.coins,
      calls: info.calls,
      tris: info.triangles,
    };
  }
}
