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
  landed?: boolean; // DROP: already reported first touchdown
  bonkAt?: number; // round time of the last bump into it (too heavy)
  eager?: boolean; // STRAIN used as "liftable, leaning toward the truck"
  assisted?: boolean; // arrived via an assist (sky drop / magnet pulse)
  fast?: boolean; // pulse yank: short teeter + quick flight
  noBounce?: boolean; // assist drops settle on first touchdown (collectible sooner)
}

interface TypeInfo {
  mesh: THREE.InstancedMesh;
  outline: THREE.InstancedMesh; // liftable outline (inverted hull), shares the instance matrices
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

/**
 * Junk material with a liftability state. One program (shared cache key), three instances:
 * liftable (bright rim light in the magnet colour + slight lift), too heavy (desaturated + darker),
 * flash (liftable + a white pulse when a tier unlocks). Only instances with aGround = 1 (lying on
 * the ground) are affected, so the pile and junk in flight keep their normal colours.
 * Meaning is carried by brightness and outline, not hue, so it reads for colour-blind players.
 */
function makeStateMaterial(v: { uHeavy: number; uGlow: number; uLift: number; uFlash: number }) {
  const H = CONFIG.highlight;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const u = {
    uHeavy: { value: v.uHeavy },
    uGlow: { value: v.uGlow },
    uLift: { value: v.uLift },
    uFlash: { value: v.uFlash },
    uDesat: { value: H.heavyDesat },
    uDark: { value: H.heavyDark },
    uGlowColor: { value: new THREE.Color(0xff8a8a) },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nvarying float vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = aGround;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGround;\nuniform float uHeavy, uGlow, uLift, uFlash, uDesat, uDark;\nuniform vec3 uGlowColor;',
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          float g = vGround;
          float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
          vec3 heavy = mix(outgoingLight, vec3(lum), uDesat) * uDark;
          outgoingLight = mix(outgoingLight, heavy, g * uHeavy);
          float rim = pow(clamp(1.0 - abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 1.5);
          outgoingLight = outgoingLight * (1.0 + uLift * g) + uGlowColor * (rim * uGlow + uFlash) * g;
        }
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'junk-state';
  return m;
}

/** shared: outline thickness grows as the camera zooms out, so it stays ~constant on screen */
const OUTLINE_ZOOM = { value: 1 };

/** outline thickness (object units) per tier: bigger junk is seen from further away */
const OUTLINE_THICK = [0.045, 0.055, 0.07, 0.09, 0.12];

/**
 * Outline directions for an inverted-hull outline on flat-shaded geometry: average the face normals of
 * every vertex sharing a position (smooth normals) so the extruded hull has no gaps. Stored pre-scaled
 * by the thickness in attribute aOut.
 */
function addOutlineNormals(g: THREE.BufferGeometry, thick: number) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const sums = new Map<string, THREE.Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const v = sums.get(k) ?? new THREE.Vector3();
    v.x += nor.getX(i);
    v.y += nor.getY(i);
    v.z += nor.getZ(i);
    sums.set(k, v);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = sums.get(key(i))!.clone().normalize().multiplyScalar(thick);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }
  g.setAttribute('aOut', new THREE.BufferAttribute(out, 3));
}

/** Back-face hull pushed out along aOut: a solid bright outline. Hidden for junk not on the ground. */
function makeOutlineMaterial() {
  const m = new THREE.MeshBasicMaterial({ color: 0xffb3b3, side: THREE.BackSide });
  const u = { uThick: { value: 1 }, uZoom: OUTLINE_ZOOM };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGround;\nattribute vec3 aOut;\nuniform float uThick, uZoom;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aOut * uThick * uZoom;\nif (aGround < 0.5) transformed = vec3(0.0);');
  };
  m.customProgramCacheKey = () => 'junk-outline';
  return m;
}

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
  onLand: (i: Item) => void = () => {};
  heightAt: (x: number, z: number) => number = () => 0;

  constructor() {
    const H = CONFIG.highlight;
    this.material = makeStateMaterial({ uHeavy: 0, uGlow: H.glow, uLift: H.lift, uFlash: 0 });
    this.heavyMat = makeStateMaterial({ uHeavy: 1, uGlow: 0, uLift: 0, uFlash: 0 });
    this.flashMat = makeStateMaterial({ uHeavy: 0, uGlow: H.glow, uLift: H.lift, uFlash: 0 });
    this.outlineMat = makeOutlineMaterial();
    this.outlineFlashMat = makeOutlineMaterial();
    for (const jt of JUNK_TYPES) {
      const g = jt.build();
      const k = CONFIG.tierModelScale[jt.tier] ?? 1;
      if (k !== 1) {
        g.scale(k, k, k);
        g.computeBoundingBox();
        g.computeBoundingSphere();
      }
      addOutlineNormals(g, OUTLINE_THICK[jt.tier] ?? 0.08);
      this.geos.push(g);
      const bb = g.boundingBox!;
      this.tierSize[jt.tier] = Math.max(this.tierSize[jt.tier], bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    }
    for (let t = 1; t < this.tierSize.length; t++) this.tierSize[t] = Math.max(this.tierSize[t], this.tierSize[t - 1] * 1.15);
  }

  /** longest footprint (x/z) of any item in each tier — what the truck's size is compared to */
  readonly tierSize = [0, 0, 0, 0, 0];
  private heavyMat: THREE.MeshLambertMaterial;
  private flashMat: THREE.MeshLambertMaterial;
  private flashT = 0;
  private outlineMat: THREE.MeshBasicMaterial;
  private outlineFlashMat: THREE.MeshBasicMaterial;
  private liftTop = -1;

  /** keep outlines a similar on-screen width at any zoom (cameraDistance in world units) */
  setOutlineZoom(cameraDistance: number) {
    OUTLINE_ZOOM.value = Math.max(1, cameraDistance / 16);
  }

  setGlowColor(hex: number) {
    const c = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), CONFIG.highlight.glowMix);
    for (const m of [this.material, this.heavyMat, this.flashMat]) (m.userData.u.uGlowColor.value as THREE.Color).copy(c);
    const oc = new THREE.Color(hex).lerp(new THREE.Color(0xffffff), CONFIG.highlight.outlineMix);
    for (const m of [this.outlineMat, this.outlineFlashMat]) m.color.copy(oc);
  }

  /**
   * Liftability is per tier (all items of a tier weigh the same), so each type mesh just
   * switches between the shared materials. flashTier = a tier that just unlocked.
   */
  setTierStates(top: number, flashTier = -1) {
    this.liftTop = top;
    if (flashTier >= 0) this.flashT = CONFIG.highlight.flashTime;
    this.types.forEach((t, i) => {
      const tier = JUNK_TYPES[i].tier;
      t.mesh.material = tier > top ? this.heavyMat : tier === flashTier ? this.flashMat : this.material;
      t.outline.visible = tier <= top;
      t.outline.material = tier === flashTier ? this.outlineFlashMat : this.outlineMat;
    });
  }

  /** (Re)build for a level. reserve = extra pooled instances per type (Rush waves). */
  setup(spawns: Spawn[], half: number, reserve = 0) {
    this.clear();
    const counts = new Array(JUNK_TYPES.length).fill(0);
    for (const s of spawns) counts[s.type]++;
    JUNK_TYPES.forEach((jt, ti) => {
      const g = this.geos[ti];
      const capacity = Math.max(1, counts[ti] + reserve);
      // per-instance "lying on the ground" flag: highlight only applies to junk you can still pick up
      g.setAttribute('aGround', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      const mesh = new THREE.InstancedMesh(g, this.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      const bb = g.boundingBox!;
      const footR = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.42;
      const outline = new THREE.InstancedMesh(g, this.outlineMat, capacity);
      outline.instanceMatrix = mesh.instanceMatrix; // same matrices, no extra uploads
      outline.frustumCulled = false;
      outline.count = 0;
      outline.renderOrder = -1;
      // gameplay radius (pickup reach, pile volume) uses the scale the game was balanced with
      const balance = ((CONFIG.tierBalanceScale[jt.tier] ?? 1) / (CONFIG.tierModelScale[jt.tier] ?? 1)) * (jt.reachMul ?? 1);
      this.types.push({ mesh, outline, capacity, used: 0, free: [], owners: [], radius: g.boundingSphere!.radius * balance, footR, dirty: true });
      this.group.add(outline, mesh);
      void jt;
    });
    this.liftTop = -1;
    // grid
    this.gridOrigin = -(half + 12);
    this.gridN = Math.ceil(((half + 12) * 2) / this.cell);
    this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
    for (const s of spawns) this.spawn(s.type, s.x, s.z, s.rot, s.paint, false);
  }

  clear() {
    for (const t of this.types) {
      this.group.remove(t.mesh, t.outline);
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
    ti.outline.count = ti.mesh.count;
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
    it.assisted = false;
    it.paint.setHex(paint);
    if (!old) {
      this.items.push(it);
      ti.owners[inst] = it;
    }
    ti.mesh.setColorAt(inst, it.paint);
    if (ti.mesh.instanceColor) ti.mesh.instanceColor.needsUpdate = true;
    this.setGround(it, 1);
    this.totalValue += it.value;
    if (drop) {
      it.state = JS.DROP;
      it.landed = false;
      it.noBounce = false;
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

  private setGround(it: Item, v: number) {
    const a = this.types[it.type].mesh.geometry.getAttribute('aGround') as THREE.InstancedBufferAttribute;
    a.setX(it.inst, v);
    a.needsUpdate = true;
  }

  /** Truck drove into something too heavy: big strain wobble. */
  bonk(it: Item) {
    if (it.state === JS.IDLE) {
      it.state = JS.STRAIN;
      this.active.push(it);
    }
    if (it.state !== JS.STRAIN) return;
    it.eager = false;
    it.strain = 1.9;
  }

  /** Start the pickup sequence for an IDLE/STRAIN item (magnet range or a pulse). */
  lift(it: Item, airborne = false) {
    const cfg = CONFIG.magnet;
    this.gridRemove(it);
    if (it.state !== JS.STRAIN) this.active.push(it);
    it.state = JS.TEETER;
    it.t = 0;
    it.dur = it.fast ? 0.06 : cfg.teeterTime + cfg.teeterPerTier * it.tier;
    it.airborne = airborne;
    this.flying++;
    this.onLiftStart(it);
  }

  /** Move a resting item to (x, z) and drop it from the sky (keeps level totals unchanged). */
  dropAt(it: Item, x: number, z: number, height = 22) {
    if (it.state !== JS.IDLE) return false;
    this.gridRemove(it);
    it.x = x;
    it.z = z;
    it.baseY = this.heightAt(x, z);
    it.y = it.baseY + height;
    it.vy = 0;
    it.landed = false;
    it.assisted = true;
    it.noBounce = true;
    it.state = JS.DROP;
    this.active.push(it);
    return true;
  }

  /** Visit every resting (IDLE/STRAIN) item. */
  forEachResting(fn: (it: Item) => void) {
    for (const cell of this.grid) for (let i = cell.length - 1; i >= 0; i--) fn(cell[i]);
  }

  /** Anything left that this capacity can lift (resting, falling or in flight)? */
  anyLiftable(capacity: number): boolean {
    if (this.flying > 0) return true;
    for (const it of this.active) if (it.state === JS.DROP && it.mass <= capacity) return true;
    for (const cell of this.grid) for (const it of cell) if (it.mass <= capacity) return true;
    return false;
  }

  /** Items currently falling (for drop shadows). */
  forEachDropping(fn: (it: Item) => void) {
    for (const it of this.active) if (it.state === JS.DROP) fn(it);
  }

  /* ---------------- per-frame ---------------- */
  /**
   * @param mx, mz magnet (truck) position; my truck height
   * @param radius pull radius; capacity max liftable mass
   * @param pile world matrix of pile centre (truck transform + offset + sway)
   */
  update(dt: number, mx: number, my: number, mz: number, radius: number, capacity: number, pile: THREE.Matrix4, canPull: boolean, airborne: boolean) {
    this.time += dt;
    if (this.flashT > 0) {
      this.flashT -= dt;
      const u = Math.max(0, this.flashT / CONFIG.highlight.flashTime);
      this.flashMat.userData.u.uFlash.value = Math.sin(u * Math.PI) * 0.9;
      this.outlineFlashMat.userData.u.uThick.value = 1 + Math.sin(u * Math.PI) * 1.6;
      this.outlineFlashMat.color.lerp(new THREE.Color(0xffffff), Math.sin(u * Math.PI) * 0.5);
      if (this.flashT <= 0) {
        this.outlineFlashMat.color.copy(this.outlineMat.color);
        this.setTierStates(this.liftTop);
      }
    }
    this.mx = mx;
    this.mz = mz;
    const cfg = CONFIG.magnet;
    const maxFly = CONFIG.perf.maxFlying;

    // 1) scan neighbourhood
    if (canPull) {
      const eagerR = radius * CONFIG.highlight.eagerMult;
      this.forEachNear(mx, mz, eagerR, (it) => {
        const dx = it.x - mx;
        const dz = it.z - mz;
        const d = Math.sqrt(dx * dx + dz * dz) - it.radius * 0.45;
        if (d > eagerR) return;
        if (Math.abs(it.y - my) > radius * 0.6 + 2.2) return; // other level (roof / ground)
        const liftable = it.mass <= capacity;
        if (liftable && d <= radius) {
          if (this.flying >= maxFly) return;
          this.lift(it, airborne);
        } else if (liftable || (d <= radius && it.mass <= capacity * cfg.strainRatio)) {
          // liftable just outside reach: lean in eagerly; too heavy inside reach: strain
          if (it.state === JS.IDLE) {
            it.state = JS.STRAIN;
            it.strain = 0;
            this.active.push(it);
          }
          it.eager = liftable;
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
          // eager (liftable, just out of reach): quick jiggle + lean toward the truck; heavy: slow strain
          const w = it.eager ? Math.sin(this.time * 38 + it.id) * 0.05 + 0.1 : Math.sin(this.time * 30 + it.id) * 0.07 + 0.06;
          const hop = it.eager ? 0.03 : 0.05;
          this.writeStatic(it, w * it.strain, -dz, dx, Math.abs(Math.sin(this.time * 16 + it.id)) * hop * it.radius * Math.min(1, it.strain));
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
            if (it.vy < -8 && !it.noBounce) {
              it.vy = -it.vy * 0.3; // one bounce
            } else {
              it.vy = 0;
              it.state = JS.IDLE;
              this.gridInsert(it);
              remove = true;
            }
            if (!it.landed) this.onLand(it);
            it.landed = true;
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
    this.setGround(it, 0);
    it.start.set(it.x, it.y + lift, it.z);
    // current world rotation as start
    this.types[it.type].mesh.getMatrixAt(it.inst, _m);
    _m.decompose(_v, it.startQ, _s);
    const dist = Math.hypot(it.x - this.mx, it.z - this.mz);
    it.dur = it.fast ? 0.3 + dist * 0.006 : cfg.flyTime + cfg.flyPerTier * it.tier + dist * cfg.flyPerUnit;
    it.fast = false;
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

  /* ---------------- staging (thumbnails / Phase 2 scripted moments) ---------------- */
  /** Snap a resting item straight onto the pile (no animation, no events). */
  attachNow(it: Item) {
    if (it.state !== JS.IDLE && it.state !== JS.STRAIN) return;
    this.gridRemove(it);
    this.beginFly(it, 0);
    it.state = JS.ATTACHED;
    it.attachAge = 1;
    this.attached.push(it);
    this.attachedCount++;
    this.collectedValue += it.value;
    this.collectedMass += it.mass;
    this.pileVolume += it.vol;
    this.pileRadius = CONFIG.magnet.pileBase + CONFIG.magnet.pileVolumeK * Math.cbrt(this.pileVolume);
  }

  /** Put a resting item mid-flight from (x, y, z) toward the pile, frozen at progress `frac`. */
  launchNow(it: Item, x: number, y: number, z: number, frac: number, spin = 0) {
    if (it.state !== JS.IDLE && it.state !== JS.STRAIN) return;
    this.gridRemove(it);
    it.x = x;
    it.y = y;
    it.z = z;
    it.rotY += spin;
    this.writeStatic(it, spin * 0.3, 1, 0.5);
    this.active.push(it);
    this.beginFly(it, 0);
    it.t = it.dur * frac;
    this.flying++;
  }

  /** Change an item's paint (instance colour). */
  repaint(it: Item, hex: number) {
    it.paint.setHex(hex);
    const ti = this.types[it.type];
    ti.mesh.setColorAt(it.inst, it.paint);
    if (ti.mesh.instanceColor) ti.mesh.instanceColor.needsUpdate = true;
  }

  /** Freeze a resting item in its teeter (tipping toward the magnet) at progress `frac`. */
  teeterNow(it: Item, frac: number) {
    if (it.state !== JS.IDLE) return;
    this.gridRemove(it);
    this.active.push(it);
    it.state = JS.TEETER;
    it.dur = 1;
    it.t = frac;
    this.flying++;
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
