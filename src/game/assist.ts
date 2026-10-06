/**
 * Anti-dead-time assists. Each one is behind a flag in CONFIG.assist:
 *  a) skyDrop – when the area around the truck runs dry, liftable junk from far away
 *     drops from the sky ahead of it (growing shadow telegraph + thud). Junk is
 *     relocated, never created, so level totals and % cleaned stay honest.
 *  b) pulse   – after a short pickup drought, a magnet shockwave yanks distant
 *     liftable junk in. It fires automatically: tap-and-hold already means "steer",
 *     and the one-input rule forbids a button.
 *  c) arrow   – when nothing liftable is on screen, an edge arrow points to the best
 *     nearby cluster.
 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { audio } from '../core/audio';
import type { Game } from './game';
import type { Item } from './junk';

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const SHADOWS = 48;

export interface AssistStats {
  drops: number;
  dropItems: number;
  pulses: number;
  pulseItems: number;
  arrowSec: number;
}

export class Assist {
  readonly group = new THREE.Group();
  private shadows: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private ringT = -1;
  private ringR = 10;
  /** world-space target the off-screen arrow points at (null = hidden) */
  arrowTarget: { x: number; z: number } | null = null;
  /** arrow screen placement for the UI (null = hidden) */
  arrowScreen: { x: number; y: number; angle: number } | null = null;
  stats: AssistStats = { drops: 0, dropItems: 0, pulses: 0, pulseItems: 0, arrowSec: 0 };
  private dropCd = 0;
  private pulseCd = 0;
  private scanT = 0;
  private noVisibleT = 0;
  private visibleCount = 0;
  private nearestVis: Item | null = null;

  constructor(private g: Game) {
    const sg = new THREE.CircleGeometry(1, 18);
    sg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sg, new THREE.MeshBasicMaterial({ color: 0x1b1b3a, transparent: true, opacity: 0.35, depthWrite: false }), SHADOWS);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    for (let i = 0; i < SHADOWS; i++) this.shadows.setMatrixAt(i, ZERO);
    const rg = new THREE.RingGeometry(0.86, 1, 64);
    rg.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(rg, this.ringMat);
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    this.group.add(this.shadows, this.ring);
  }

  reset() {
    this.stats = { drops: 0, dropItems: 0, pulses: 0, pulseItems: 0, arrowSec: 0 };
    this.dropCd = this.pulseCd = this.scanT = this.noVisibleT = 0;
    this.arrowTarget = null;
    this.arrowScreen = null;
    this.ringT = -1;
    this.ring.visible = false;
  }

  /** On-screen test using the live camera (what a player can actually see). */
  onScreen(x: number, y: number, z: number, margin = 0.92) {
    _v.set(x, y, z).project(this.g.rig.camera);
    return _v.z < 1 && Math.abs(_v.x) < margin && Math.abs(_v.y) < margin;
  }

  /** nearest liftable item that is visible on screen (also used by the bot) */
  get nearestVisible() {
    return this.nearestVis;
  }

  private scanVisible() {
    const g = this.g;
    const cap = g.capacity;
    this.g.rig.camera.updateMatrixWorld();
    let best: Item | null = null;
    let bd = Infinity;
    let count = 0;
    g.junk.forEachNear(g.truck.x, g.truck.z, 60, (it) => {
      if (it.mass > cap || Math.abs(it.baseY - g.truck.y) > 0.6) return;
      if (!this.onScreen(it.x, it.y, it.z)) return;
      count++;
      const d = (it.x - g.truck.x) ** 2 + (it.z - g.truck.z) ** 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    });
    this.visibleCount = count;
    this.nearestVis = best;
  }

  /** Gameplay logic: call only while the round is being played. */
  update(dt: number) {
    const g = this.g;
    const A = CONFIG.assist;
    this.dropCd -= dt;
    this.pulseCd -= dt;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.15;
      this.scanVisible();
    }
    const idle = g.sinceLastPickup();
    const cap = g.capacity;
    const radius = g.radius();

    // a) sky drop
    if (A.skyDrop.enabled && this.dropCd <= 0 && idle >= A.skyDrop.idleDelay) {
      const sense = A.skyDrop.senseRadius + radius;
      let near = 0;
      g.junk.forEachNear(g.truck.x, g.truck.z, sense, (it) => {
        if (it.mass <= cap && Math.hypot(it.x - g.truck.x, it.z - g.truck.z) < sense && Math.abs(it.y - g.truck.y) < 3) near++;
      });
      if (near < A.skyDrop.minNearby) this.skyDrop(sense, cap);
    }

    // b) pulse
    if (A.pulse.enabled && this.pulseCd <= 0 && idle >= A.pulse.idleDelay) this.pulse(radius, cap);

    // c) arrow
    let incoming = false;
    g.junk.forEachDropping(() => (incoming = true));
    if (this.visibleCount === 0 && !incoming) this.noVisibleT += dt;
    else this.noVisibleT = 0;
    if (A.arrow.enabled && this.noVisibleT >= A.arrow.idleDelay) {
      if (this.scanT >= 0.149 || !this.arrowTarget) this.arrowTarget = this.bestCluster(cap);
      this.stats.arrowSec += dt;
    } else this.arrowTarget = null;
  }

  private skyDrop(sense: number, cap: number) {
    const g = this.g;
    const A = CONFIG.assist.skyDrop;
    const far: Item[] = [];
    const teasers: Item[] = [];
    const tx = g.truck.x;
    const tz = g.truck.z;
    g.junk.forEachResting((it) => {
      const d = Math.hypot(it.x - tx, it.z - tz);
      if (d < sense + 10) return;
      if (it.mass <= cap) far.push(it);
      else if (it.mass <= cap * CONFIG.magnet.strainRatio && it.tier < 4) teasers.push(it);
    });
    if (!far.length) {
      this.dropCd = 1;
      return;
    }
    // take from the farthest corners first so the area around the player keeps its junk
    far.sort((a, b) => Math.hypot(b.x - tx, b.z - tz) - Math.hypot(a.x - tx, a.z - tz));
    const pick = far.slice(0, Math.min(far.length, A.count * 3));
    const chosen: Item[] = [];
    for (let i = 0; i < A.count && pick.length; i++) chosen.push(pick.splice(Math.floor(g.rng.next() * pick.length), 1)[0]);
    if (teasers.length && g.rng.next() < A.teaserChance) chosen.push(teasers[Math.floor(g.rng.next() * teasers.length)]);

    const fx = g.truck.forwardX;
    const fz = g.truck.forwardZ;
    const k = g.truck.scale;
    let dropped = 0;
    for (const it of chosen) {
      for (let tries = 0; tries < 8; tries++) {
        const d = g.rng.range(A.distMin, A.distMax) * k;
        const side = g.rng.range(-A.spread, A.spread) * k;
        const x = tx + fx * d - fz * side;
        const z = tz + fz * d + fx * side;
        if (Math.abs(g.world.heightAt(x, z) - g.truck.y) > 0.5) continue; // same level as the truck
        if (Math.abs(x) > g.half - 3 || Math.abs(z) > g.half - 3) continue;
        if (g.junk.dropAt(it, x, z, A.height + g.rng.range(0, 6))) {
          dropped++;
          break;
        }
      }
    }
    if (dropped) {
      this.stats.drops++;
      this.stats.dropItems += dropped;
      this.dropCd = A.cooldown;
      audio.whoosh();
    } else this.dropCd = 0.5;
  }

  private pulse(radius: number, cap: number) {
    const g = this.g;
    const P = CONFIG.assist.pulse;
    const range = radius * P.rangeMult + P.rangeAdd;
    const list: { it: Item; d: number }[] = [];
    g.junk.forEachNear(g.truck.x, g.truck.z, range, (it) => {
      if (it.mass > cap || Math.abs(it.y - g.truck.y) > 3) return;
      const d = Math.hypot(it.x - g.truck.x, it.z - g.truck.z);
      if (d <= range) list.push({ it, d });
    });
    this.pulseCd = list.length ? P.cooldown : 0.6;
    if (!list.length) return;
    list.sort((a, b) => a.d - b.d);
    const n = Math.min(P.maxItems, list.length);
    for (let i = 0; i < n; i++) g.junk.lift(list[i].it, g.truck.airborne);
    this.stats.pulses++;
    this.stats.pulseItems += n;
    this.ringT = 0;
    this.ringR = range;
    audio.pulse();
    g.rig.shake(0.12);
    g.truck.bump(0.12);
  }

  /** Centroid of the best liftable cluster (count / distance), on the truck's level. */
  private bestCluster(cap: number): { x: number; z: number } | null {
    const g = this.g;
    const cell = 10;
    const buckets = new Map<number, { n: number; x: number; z: number }>();
    g.junk.forEachResting((it) => {
      // same level only: never point at roof junk the truck can't drive to directly
      if (it.mass > cap || Math.abs(it.baseY - g.truck.y) > 0.6) return;
      const key = Math.floor(it.x / cell) * 1000 + Math.floor(it.z / cell);
      const b = buckets.get(key);
      if (b) {
        b.n++;
        b.x += it.x;
        b.z += it.z;
      } else buckets.set(key, { n: 1, x: it.x, z: it.z });
    });
    let best: { x: number; z: number } | null = null;
    let bs = 0;
    for (const b of buckets.values()) {
      const x = b.x / b.n;
      const z = b.z / b.n;
      const score = b.n / (Math.hypot(x - g.truck.x, z - g.truck.z) + 12);
      if (score > bs) {
        bs = score;
        best = { x, z };
      }
    }
    return best;
  }

  /** Show a static pulse ring (thumbnails). r = 0 hides it. */
  showRing(r: number, x: number, y: number, z: number) {
    this.ringT = -1;
    this.ring.visible = r > 0;
    this.ring.position.set(x, y + 0.15, z);
    this.ring.scale.set(r, 1, r);
    this.ringMat.opacity = 0.55;
  }

  /** Visuals (shadows, pulse ring, arrow placement): call every frame. */
  visual(dt: number, width: number, height: number, insetTop: number, insetBottom: number) {
    const g = this.g;
    // drop shadows grow as junk falls = the telegraph
    let i = 0;
    g.junk.forEachDropping((it) => {
      if (i >= SHADOWS) return;
      const h = Math.max(0, it.y - it.baseY);
      const k = Math.max(0.15, 1 - h / 26);
      const r = it.radius * (0.35 + 0.75 * k);
      _v.set(it.x, it.baseY + 0.05, it.z);
      _s.set(r, 1, r);
      _m.compose(_v, _q.identity(), _s);
      this.shadows.setMatrixAt(i++, _m);
    });
    for (let j = i; j < SHADOWS; j++) this.shadows.setMatrixAt(j, ZERO);
    this.shadows.instanceMatrix.needsUpdate = true;

    // pulse ring
    if (this.ringT >= 0) {
      this.ringT += dt;
      const u = this.ringT / 0.45;
      if (u >= 1) {
        this.ringT = -1;
        this.ring.visible = false;
      } else {
        const r = 2 + (this.ringR - 2) * (1 - (1 - u) * (1 - u));
        this.ring.visible = true;
        this.ring.position.set(g.truck.x, g.truck.y + 0.15, g.truck.z);
        this.ring.scale.set(r, 1, r);
        this.ringMat.opacity = 0.75 * (1 - u);
      }
    }

    // off-screen arrow
    this.arrowScreen = null;
    if (this.arrowTarget) {
      const t = this.arrowTarget;
      _v.set(t.x, g.truck.y, t.z).project(g.rig.camera);
      let nx = _v.x;
      let ny = _v.y;
      if (_v.z > 1) {
        nx = -nx;
        ny = -ny;
      }
      if (_v.z < 1 && Math.abs(nx) < 0.85 && Math.abs(ny) < 0.85) return; // on screen already
      const cx = width / 2;
      const cy = height / 2;
      let px = nx * cx;
      let py = -ny * cy;
      const lx = cx - 46;
      const ly = cy - 46 - Math.max(insetTop, insetBottom);
      const s = Math.max(Math.abs(px) / lx, Math.abs(py) / ly, 1e-6);
      px /= s;
      py /= s;
      this.arrowScreen = { x: cx + px, y: cy + py, angle: Math.atan2(py, px) };
    }
  }
}
