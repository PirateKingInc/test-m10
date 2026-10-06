/**
 * Junk simulation + rendering.
 *  - One InstancedMesh per junk type (≈12 draw calls for ~1000 items).
 *  - Spatial hash grid: only items near the magnet are ever examined; everything
 *    else "sleeps" as a static instance with zero per-frame cost.
 *  - Pickup = scripted mini-physics state machine (deterministic, cheap, juicy):
 *      IDLE → STRAIN (too heavy, wobbles) / TEETER (tips & hops) → FLY (eased arc) → ATTACHED
 *  - Attached items live in pile-local space and follow the truck; oldest are
 *    "buried" (hidden + recycled) beyond a visible cap.
 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { JUNK_TYPES } from './junkTypes';
import { Spawn } from './levels';

export const enum JS {
  IDLE,
  STRAIN,
  TEETER,
  FLY,
  ATTACHED,
  BURIED,
  DROP,
  GONE,
}

export interface Item {
  id: number;
  type: number;
  tier: number;
  mass: number;
  value: number;
  radius: number; // bounding radius
  footR: number; // blocking footprint radius
  vol: number; // pile volume contribution
  x: number;
  y: number;
  z: number;
  baseY: number;
  rotY: number;
  state: JS;
  t: number;
  dur: number;
  strain: number;
  strainSeen: boolean;
  vy: number;
  inst: number;
  cell: number;
  paint: THREE.Color;
  start: THREE.Vector3;
  startQ: THREE.Quaternion;
  local: THREE.Vector3;
  localQ: THREE.Quaternion;
  attachAge: number;
  aScale: number; // scale once attached (compaction)
  airborne: boolean; // picked while truck airborne
}

interface TypeInfo {
  mesh: THREE.InstancedMesh;
  capacity: number;
  used: number;
  free: number[]; // recycled instance slots
  owners: (Item | null)[];
  radius: number;
  footR: number;
  dirty: boolean;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _axis = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface PickupEvent {
  item: Item;
}

export class JunkSystem {
  readonly group = new THREE.Group();
  items: Item[] = [];
  private types: TypeInfo[] = [];
  private material: THREE.MeshLambertMaterial;
  private geos: THREE.BufferGeometry[] = [];
  /** active list = anything that needs per-frame updates (strain, teeter, fly, drop) */
  private active: Item[] = [];
  attached: Item[] = [];
  private grid: Item[][] = [];
  private gridN = 0;
  private gridOrigin = 0;
  private cell = CONFIG.perf.gridCell;
  flying = 0;
  pileRadius = CONFIG.magnet.pileBase;
  private pileVolume = 0;
  totalValue = 0;
  collectedValue = 0;
  collectedMass = 0;
  attachedCount = 0;
  private time = 0;
  private mx = 0;
  private mz = 0;
  private slotIndex = 0;
  onAttach: (e: PickupEvent) => void = () => {};
  onLiftStart: (i: Item) => void = () => {};
  heightAt: (x: number, z: number) => number = () => 0;

  constructor() {
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const jt of JUNK_TYPES) {
      const g = jt.build();
      const k = CONFIG.tierModelScale[jt.tier] ?? 1;
      if (k !== 1) {
        g.scale(k, k, k);
        g.computeBoundingBox();
        g.computeBoundingSphere();
      }
      this.geos.push(g);
    }
  }

  /** (Re)build for a level. reserve = extra pooled instances per type (Rush waves). */
  setup(spawns: Spawn[], half: number, reserve = 0) {
    this.clear();
    const counts = new Array(JUNK_TYPES.length).fill(0);
    for (const s of spawns) counts[s.type]++;
    JUNK_TYPES.forEach((jt, ti) => {
      const g = this.geos[ti];
      const capacity = Math.max(1, counts[ti] + reserve);
      const mesh = new THREE.InstancedMesh(g, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      const bb = g.boundingBox!;
      const footR = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.42;
      this.types.push({ mesh, capacity, used: 0, free: [], owners: [], radius: g.boundingSphere!.radius, footR, dirty: true });
      this.group.add(mesh);
      void jt;
    });
    // grid
    this.gridOrigin = -(half + 12);
    this.gridN = Math.ceil(((half + 12) * 2) / this.cell);
    this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
    for (const s of spawns) this.spawn(s.type, s.x, s.z, s.rot, s.paint, false);
  }

  clear() {
    for (const t of this.types) {
      this.group.remove(t.mesh);
      t.mesh.dispose();
    }
    this.types = [];
    this.items = [];
    this.active = [];
    this.attached = [];
    this.flying = 0;
    this.pileRadius = CONFIG.magnet.pileBase;
    this.pileVolume = 0;
    this.totalValue = 0;
    this.collectedValue = 0;
    this.collectedMass = 0;
    this.attachedCount = 0;
    this.slotIndex = 0;
  }

  /** Spawn an item (from the free pool when possible). drop=true falls from the sky. */
  spawn(type: number, x: number, z: number, rot: number, paint: number, drop: boolean): Item | null {
    const ti = this.types[type];
    let inst: number;
    if (ti.free.length) inst = ti.free.pop()!;
    else if (ti.used < ti.capacity) inst = ti.used++;
    else return null;
    ti.mesh.count = Math.max(ti.mesh.count, ti.used);
    const jt = JUNK_TYPES[type];
    const tier = CONFIG.tiers[jt.tier];
    const old = ti.owners[inst];
    const it: Item = old ?? {
      id: this.items.length,
      start: new THREE.Vector3(),
      startQ: new THREE.Quaternion(),
      local: new THREE.Vector3(),
      localQ: new THREE.Quaternion(),
      paint: new THREE.Color(),
    } as Item;
    it.type = type;
    it.tier = jt.tier;
    it.mass = tier.mass;
    it.value = tier.value;
    it.radius = ti.radius;
    it.footR = ti.footR;
    it.aScale = CONFIG.attachScaleByTier[jt.tier] ?? 1;
    it.vol = Math.pow(ti.radius * 0.62 * it.aScale, 3);
    it.x = x;
    it.z = z;
    it.baseY = this.heightAt(x, z);
    it.rotY = rot;
    it.t = 0;
    it.dur = 0;
    it.strain = 0;
    it.strainSeen = false;
    it.inst = inst;
    it.cell = -1;
    it.attachAge = 0;
    it.airborne = false;
    it.paint.setHex(paint);
    if (!old) {
      this.items.push(it);
      ti.owners[inst] = it;
    }
    ti.mesh.setColorAt(inst, it.paint);
    if (ti.mesh.instanceColor) ti.mesh.instanceColor.needsUpdate = true;
    this.totalValue += it.value;
    if (drop) {
      it.state = JS.DROP;
      it.y = it.baseY + 18 + Math.random() * 10;
      it.vy = 0;
      this.active.push(it);
    } else {
      it.state = JS.IDLE;
      it.y = it.baseY;
      this.gridInsert(it);
    }
    this.writeStatic(it);
    return it;
  }

  /* ---------------- grid ---------------- */
  private cellOf(x: number, z: number) {
    const cx = Math.min(this.gridN - 1, Math.max(0, Math.floor((x - this.gridOrigin) / this.cell)));
    const cz = Math.min(this.gridN - 1, Math.max(0, Math.floor((z - this.gridOrigin) / this.cell)));
    return cz * this.gridN + cx;
  }
  private gridInsert(it: Item) {
    it.cell = this.cellOf(it.x, it.z);
    this.grid[it.cell].push(it);
  }
  private gridRemove(it: Item) {
    if (it.cell < 0) return;
    const arr = this.grid[it.cell];
    const i = arr.indexOf(it);
    if (i >= 0) {
      arr[i] = arr[arr.length - 1];
      arr.pop();
    }
    it.cell = -1;
  }
  /** visit grid items within radius r of (x, z) */
  forEachNear(x: number, z: number, r: number, fn: (it: Item) => void) {
    const pad = r + 4.5;
    const x0 = Math.max(0, Math.floor((x - pad - this.gridOrigin) / this.cell));
    const x1 = Math.min(this.gridN - 1, Math.floor((x + pad - this.gridOrigin) / this.cell));
    const z0 = Math.max(0, Math.floor((z - pad - this.gridOrigin) / this.cell));
    const z1 = Math.min(this.gridN - 1, Math.floor((z + pad - this.gridOrigin) / this.cell));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.grid[cz * this.gridN + cx];
        for (let i = arr.length - 1; i >= 0; i--) fn(arr[i]);
      }
  }

  /* ---------------- matrices ---------------- */
  private writeStatic(it: Item, tilt = 0, tiltAx = 0, tiltAz = 0, lift = 0, scale = 1) {
    _q.setFromAxisAngle(UP, it.rotY);
    if (tilt !== 0) {
      _axis.set(tiltAx, 0, tiltAz).normalize();
      _q2.setFromAxisAngle(_axis, tilt);
      _q.premultiply(_q2);
    }
    _v.set(it.x, it.y + lift, it.z);
    _s.set(scale, scale, scale);
    _m.compose(_v, _q, _s);
    const ti = this.types[it.type];
    ti.mesh.setMatrixAt(it.inst, _m);
    ti.dirty = true;
  }

  /* ---------------- per-frame ---------------- */
  /**
   * @param mx, mz magnet (truck) position; my truck height
   * @param radius pull radius; capacity max liftable mass
   * @param pile world matrix of pile centre (truck transform + offset + sway)
   */
  update(dt: number, mx: number, my: number, mz: number, radius: number, capacity: number, pile: THREE.Matrix4, canPull: boolean, airborne: boolean) {
    this.time += dt;
    this.mx = mx;
    this.mz = mz;
    const cfg = CONFIG.magnet;
    const maxFly = CONFIG.perf.maxFlying;

    // 1) scan neighbourhood
    if (canPull) {
      this.forEachNear(mx, mz, radius, (it) => {
        const dx = it.x - mx;
        const dz = it.z - mz;
        const d = Math.sqrt(dx * dx + dz * dz) - it.radius * 0.45;
        if (d > radius) return;
        if (Math.abs(it.y - my) > radius * 0.6 + 2.2) return; // other level (roof / ground)
        if (it.mass <= capacity) {
          if (this.flying >= maxFly) return;
          this.gridRemove(it);
          if (it.state !== JS.STRAIN) this.active.push(it);
          it.state = JS.TEETER;
          it.t = 0;
          it.dur = cfg.teeterTime + cfg.teeterPerTier * it.tier;
          it.airborne = airborne;
          this.flying++;
          this.onLiftStart(it);
        } else if (it.mass <= capacity * cfg.strainRatio) {
          if (it.state === JS.IDLE) {
            it.state = JS.STRAIN;
            it.strain = 0;
            this.active.push(it);
          }
          it.strainSeen = true;
        }
      });
    }

    // 2) active items
    for (let i = this.active.length - 1; i >= 0; i--) {
      const it = this.active[i];
      it.t += dt;
      let remove = false;
      switch (it.state) {
        case JS.STRAIN: {
          const target = it.strainSeen ? 1 : 0;
          it.strain += (target - it.strain) * Math.min(1, dt * 8);
          it.strainSeen = false;
          if (target === 0 && it.strain < 0.02) {
            it.state = JS.IDLE;
            this.writeStatic(it);
            remove = true;
            break;
          }
          const dx = mx - it.x;
          const dz = mz - it.z;
          const w = Math.sin(this.time * 30 + it.id) * 0.07 + 0.06;
          // tilt toward magnet: rotate about axis perpendicular to direction
          this.writeStatic(it, w * it.strain, -dz, dx, Math.abs(Math.sin(this.time * 16 + it.id)) * 0.05 * it.radius * it.strain);
          break;
        }
        case JS.TEETER: {
          const u = Math.min(1, it.t / it.dur);
          const dx = mx - it.x;
          const dz = mz - it.z;
          const wob = Math.sin(it.t * 48) * 0.28 * (1 - u * 0.4) + u * 0.35;
          const lift = u * u * (0.25 + it.radius * 0.2);
          const sq = 1 + Math.sin(u * Math.PI) * 0.12;
          this.writeStatic(it, wob, -dz, dx, lift, sq);
          if (u >= 1) {
            this.beginFly(it, lift);
          }
          break;
        }
        case JS.FLY: {
          const u = Math.min(1, it.t / it.dur);
          const e = u * u * (1.6 - 0.6 * u); // accelerate into the magnet
          _v.copy(it.local).applyMatrix4(pile);
          _v2.copy(it.start).lerp(_v, e);
          _v2.y += Math.sin(u * Math.PI) * (0.8 + it.radius * 0.3);
          _q.setFromRotationMatrix(_m2.extractRotation(pile)).multiply(it.localQ);
          _q2.copy(it.startQ).slerp(_q, e);
          const st = 1 + Math.sin(u * Math.PI) * 0.15;
          const sc = 1 + (it.aScale - 1) * e;
          _s.set(sc / Math.sqrt(st), sc * st, sc / Math.sqrt(st));
          _m.compose(_v2, _q2, _s);
          const ti = this.types[it.type];
          ti.mesh.setMatrixAt(it.inst, _m);
          ti.dirty = true;
          it.x = _v2.x;
          it.y = _v2.y;
          it.z = _v2.z;
          if (u >= 1) {
            it.state = JS.ATTACHED;
            it.attachAge = 0;
            this.flying--;
            this.attached.push(it);
            this.attachedCount++;
            this.collectedValue += it.value;
            this.collectedMass += it.mass;
            this.pileVolume += it.vol;
            this.pileRadius = cfg.pileBase + cfg.pileVolumeK * Math.cbrt(this.pileVolume);
            remove = true;
            this.onAttach({ item: it });
            this.buryExcess();
          }
          break;
        }
        case JS.DROP: {
          it.vy -= 40 * dt;
          it.y += it.vy * dt;
          if (it.y <= it.baseY) {
            it.y = it.baseY;
            if (it.vy < -8) {
              it.vy = -it.vy * 0.3; // one bounce
            } else {
              it.vy = 0;
              it.state = JS.IDLE;
              this.gridInsert(it);
              remove = true;
            }
          }
          this.writeStatic(it, it.vy * 0.01, 1, 0, 0, 1);
          break;
        }
        default:
          remove = true;
      }
      if (remove) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    // 3) attached pile follows the truck
    for (let i = 0; i < this.attached.length; i++) {
      const it = this.attached[i];
      it.attachAge += dt;
      const pop = (it.attachAge < 0.18 ? 1 + Math.sin((it.attachAge / 0.18) * Math.PI) * 0.25 : 1) * it.aScale;
      _s.set(pop, pop, pop);
      _m.compose(it.local, it.localQ, _s);
      _m.premultiply(pile);
      const ti = this.types[it.type];
      ti.mesh.setMatrixAt(it.inst, _m);
      ti.dirty = true;
    }

    for (const t of this.types) {
      if (t.dirty) {
        t.mesh.instanceMatrix.needsUpdate = true;
        t.dirty = false;
      }
    }
  }

  private beginFly(it: Item, lift: number) {
    const cfg = CONFIG.magnet;
    it.state = JS.FLY;
    it.t = 0;
    it.start.set(it.x, it.y + lift, it.z);
    // current world rotation as start
    this.types[it.type].mesh.getMatrixAt(it.inst, _m);
    _m.decompose(_v, it.startQ, _s);
    const dist = Math.hypot(it.x - this.mx, it.z - this.mz);
    it.dur = cfg.flyTime + cfg.flyPerTier * it.tier + dist * cfg.flyPerUnit;
    // pile slot: golden-angle spiral, biased away from the truck underneath
    const k = this.slotIndex++;
    const theta = k * 2.399963;
    const y = -0.35 + 1.35 * ((k * 0.618034) % 1);
    const r = Math.sqrt(1 - y * y);
    const out = this.pileRadius + it.radius * it.aScale * 0.3;
    let lz = Math.sin(theta) * r;
    if (lz > 0.5 && y < 0.6) lz = -lz; // keep the magnet face (front) clear
    it.local.set(Math.cos(theta) * r * out, y * out, lz * out);
    it.localQ.setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
  }

  private buryExcess() {
    const cap = CONFIG.perf.maxAttachedVisible;
    while (this.attached.length > cap) {
      const it = this.attached.shift()!;
      it.state = JS.BURIED;
      const ti = this.types[it.type];
      ti.mesh.setMatrixAt(it.inst, ZERO);
      ti.free.push(it.inst);
      ti.dirty = true;
    }
  }

  /** Items currently too heavy that should physically block the truck. */
  forEachBlocker(x: number, z: number, capacity: number, fn: (it: Item) => void) {
    this.forEachNear(x, z, 6, (it) => {
      if (!CONFIG.tiers[it.tier].blocks || it.mass <= capacity) return;
      fn(it);
    });
  }

  /** count of items still on the map (for waves) */
  remainingValue() {
    return this.totalValue - this.collectedValue;
  }

  /** nearest liftable/near-liftable item direction (for hints / attract) */
  nearestIdle(x: number, z: number, maxMass: number, range = 30): Item | null {
    let best: Item | null = null;
    let bd = Infinity;
    this.forEachNear(x, z, range, (it) => {
      if (it.mass > maxMass) return;
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    });
    return best;
  }

  /** Remove all attached items (used at round reset). */
  get activeCount() {
    return this.active.length;
  }
}
