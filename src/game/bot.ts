/**
 * Autopilot for balance measurement (?bot=1&skill=novice|average|skilled). Debug/testing only.
 * All skills only "see" junk that is on screen (Assist.visible) — like a player.
 *  - novice:  ~400ms reactions, sloppy aim, follows the arrow only half the time,
 *             gets distracted and wanders more, picks targets haphazardly
 *  - average: chases the nearest visible junk, follows the arrow, else wanders
 *  - skilled: instant reactions, chains combos (stays inside the combo window),
 *             routes toward dense / valuable clusters, remembers where junk is
 */
import type { Game } from './game';
import type { Item } from './junk';

export type BotSkill = 'novice' | 'average' | 'skilled';

export class Bot {
  private t = 0;
  private pos: [number, number] = [0, 0];
  private escape = 0;
  private escDir: [number, number] = [1, 0];
  private wander = 0;
  private wanderT = 0;
  private react = 0;
  private dir: [number, number] | null = null;
  private noise = 0;
  private distract = 0;
  private followArrow = true;
  private arrowWasOn = false;
  private giveUp = 0;

  constructor(public skill: BotSkill) {}

  steer(g: Game, dt: number): [number, number] | null {
    // unstick: if we barely moved for a second, back off in a random direction
    this.t += dt;
    if (this.escape > 0) {
      this.escape -= dt;
      return this.escDir;
    }
    if (this.t > 1) {
      const moved = Math.hypot(g.truck.x - this.pos[0], g.truck.z - this.pos[1]);
      this.pos = [g.truck.x, g.truck.z];
      this.t = 0;
      if (moved < 4) {
        this.giveUp = 3; // that route is blocked (house, mound): stop chasing remembered/arrow targets for a bit
        const a = Math.random() * Math.PI * 2;
        this.escDir = [Math.cos(a), Math.sin(a)];
        this.escape = this.skill === 'skilled' ? 0.8 : 1.5;
        return this.escDir;
      }
    }
    this.giveUp -= dt;
    if (this.skill === 'novice') return this.novice(g, dt);
    if (this.skill === 'skilled') return this.skilled(g, dt);
    return this.average(g, dt);
  }

  private toward(g: Game, x: number, z: number): [number, number] {
    return [x - g.truck.x, z - g.truck.z];
  }

  private doWander(g: Game, dt: number, turn: number, every: number): [number, number] {
    this.wanderT -= dt;
    const edge = g.world.half - 12;
    if (Math.abs(g.truck.x) > edge || Math.abs(g.truck.z) > edge) {
      this.wander = Math.atan2(-g.truck.x, -g.truck.z) + (Math.random() - 0.5);
      this.wanderT = 2;
    } else if (this.wanderT <= 0) {
      this.wander = g.truck.heading + (Math.random() - 0.5) * turn;
      this.wanderT = every;
    }
    return [Math.sin(this.wander), Math.cos(this.wander)];
  }

  private average(g: Game, dt: number): [number, number] | null {
    const n = g.assist.nearestVisible;
    if (n && n.state <= 1) return this.toward(g, n.x, n.z);
    const a = g.assist.arrowTarget;
    if (a && this.giveUp <= 0) return this.toward(g, a.x, a.z);
    return this.doWander(g, dt, 2.2, 2.5);
  }

  private novice(g: Game, dt: number): [number, number] | null {
    // decide only every ~400ms; between decisions keep the old (stale) direction
    this.react -= dt;
    const arrowOn = !!g.assist.arrowTarget;
    if (arrowOn && !this.arrowWasOn) this.followArrow = Math.random() < 0.5; // ignores the arrow half the time
    this.arrowWasOn = arrowOn;
    if (this.react > 0 && this.dir) return this.dir;
    this.react = 0.35 + Math.random() * 0.15;
    this.noise += (Math.random() - 0.5) * 0.5;
    this.noise *= 0.8; // drifting aim error
    let d: [number, number] | null = null;
    this.distract -= this.react;
    if (this.distract <= 0 && Math.random() < 0.12) this.distract = 1.2; // looks around / gets distracted
    if (this.distract <= 0) {
      const vis = g.assist.visible.filter((it) => it.state <= 1);
      if (vis.length) {
        // haphazard: often not the nearest one
        const it = Math.random() < 0.6 ? g.assist.nearestVisible ?? vis[0] : vis[Math.floor(Math.random() * vis.length)];
        if (it && it.state <= 1) d = this.toward(g, it.x, it.z);
      } else if (arrowOn && this.followArrow) d = this.toward(g, g.assist.arrowTarget!.x, g.assist.arrowTarget!.z);
    }
    if (!d) d = this.doWander(g, this.react, 3.2, 1.6);
    const ang = Math.atan2(d[0], d[1]) + this.noise + (Math.random() - 0.5) * 0.5;
    this.dir = [Math.sin(ang), Math.cos(ang)];
    return this.dir;
  }

  private skilled(g: Game, dt: number): [number, number] | null {
    this.react -= dt;
    if (this.react > 0 && this.dir) return this.dir;
    this.react = 0.05;
    const tx = g.truck.x;
    const tz = g.truck.z;
    const vis = g.assist.visible.filter((it) => it.state <= 1);
    let best: Item | null = null;
    // keep a running combo alive: grab the closest thing reachable inside the window
    if (g.combo > 0 && vis.length) {
      const reach = g.speed() * Math.max(0.15, g.comboTimeLeft()) + g.radius();
      let bd = Infinity;
      for (const it of vis) {
        const d = Math.hypot(it.x - tx, it.z - tz);
        if (d < reach && d < bd) {
          bd = d;
          best = it;
        }
      }
    }
    // otherwise route toward the densest, most valuable visible cluster
    if (!best && vis.length) {
      let bs = -1;
      for (const it of vis) {
        let near = 0;
        for (const o of vis) if (o !== it && Math.abs(o.x - it.x) < 6 && Math.abs(o.z - it.z) < 6) near += o.value;
        const s = (it.value + near) / (Math.hypot(it.x - tx, it.z - tz) + 4);
        if (s > bs) {
          bs = s;
          best = it;
        }
      }
    }
    if (best) {
      this.dir = this.toward(g, best.x, best.z);
      return this.dir;
    }
    // nothing on screen: a skilled player remembers where the junk is
    const c = this.giveUp > 0 ? null : g.assist.arrowTarget ?? g.assist.findCluster();
    this.dir = c ? this.toward(g, c.x, c.z) : this.doWander(g, dt, 1.5, 2);
    return this.dir;
  }
}
