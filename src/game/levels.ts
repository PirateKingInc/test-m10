/**
 * Level data + layout generators. A level = theme + static decor/solids + junk spawn list.
 * Phase 2 levels (Beach/trains, City/crusher, Scrap Planet/storms) add a LevelDef here
 * plus feature ids that the feature registry (features.ts) understands.
 */
import * as THREE from 'three';
import { CONFIG, TierId } from '../config';
import { Rng } from '../core/rng';
import { box, cyl, cone, dodeca, torus, Part } from './geo';
import { pickTypeInTier, JUNK_TYPES } from './junkTypes';

export interface Solid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  h: number;
  /** height rises linearly along axis toward dir (+1 / -1) */
  ramp?: { axis: 'x' | 'z'; dir: 1 | -1 };
  walkable?: boolean; // junk may spawn on top
}

export interface Theme {
  ground: number;
  groundEdge: number;
  sky: number;
  fog: number;
  fence: number;
  ring: number;
}

export interface Spawn {
  type: number;
  x: number;
  z: number;
  rot: number;
  paint: number;
}

export interface Layout {
  half: number;
  theme: Theme;
  solids: Solid[];
  decor: Part[];
  spawns: Spawn[];
  start: { x: number; z: number; heading: number };
}

export type ModeKind = 'level' | 'rush' | 'daily';

export interface DailyGoal {
  kind: 'pct' | 'tier';
  target: number; // fraction for pct, count for tier
  tier?: number;
  text: string;
}

export interface LevelDef {
  id: string;
  name: string;
  emoji: string;
  roundTime?: number; // defaults to CONFIG.round.length (read at round start so overrides apply)
  stars: [number, number, number]; // fraction cleaned for 1/2/3 stars
  junk: Record<TierId, number>;
  features: string[];
  unlock?: { level: string; stars: number };
  build(rng: Rng, L: LayoutBuilder): void;
}

export class LayoutBuilder {
  solids: Solid[] = [];
  decor: Part[] = [];
  spawns: Spawn[] = [];
  start = { x: 0, z: 0, heading: Math.PI };
  /** points the generator must keep clear (start lane) */
  keepClear: { x: number; z: number; r: number }[] = [];
  /** hand-placed cluster centres with preferred tiers (e.g. garage roofs) */
  hotspots: { x: number; z: number; r: number; tier: number; n: number }[] = [];
  constructor(public half: number, public theme: Theme) {}

  solid(cx: number, cz: number, w: number, d: number, h: number, extra: Partial<Solid> = {}) {
    this.solids.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h, ...extra });
  }
  heightAt(x: number, z: number) {
    return heightAt(this.solids, x, z);
  }
  /** blocked = inside a non-walkable solid or too close to the edge */
  blocked(x: number, z: number, margin = 0.6): boolean {
    const lim = this.half - 2.5;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return true;
    for (const s of this.solids) {
      if (s.walkable || s.ramp) continue;
      if (x > s.minX - margin && x < s.maxX + margin && z > s.minZ - margin && z < s.maxZ + margin) return true;
    }
    return false;
  }
}

export function heightAt(solids: Solid[], x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    let sh = s.h;
    if (s.ramp) {
      const t = s.ramp.axis === 'z' ? (s.ramp.dir > 0 ? (z - s.minZ) / (s.maxZ - s.minZ) : (s.maxZ - z) / (s.maxZ - s.minZ)) : s.ramp.dir > 0 ? (x - s.minX) / (s.maxX - s.minX) : (s.maxX - x) / (s.maxX - s.minX);
      sh = s.h * t;
    }
    if (sh > h) h = sh;
  }
  return h;
}

/** Ramp wedge mesh (rises along axis toward dir). */
function wedge(w: number, h: number, d: number, color: number, cx: number, cz: number, axis: 'x' | 'z', dir: 1 | -1): Part {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const c = axis === 'z' ? p.getZ(i) : p.getX(i);
    const lowEnd = dir > 0 ? c < 0 : c > 0;
    if (y > 0 && lowEnd) p.setY(i, -h / 2 + 0.02);
  }
  g.computeVertexNormals();
  return finishWedge(g, color, cx, h / 2, cz);
}
function finishWedge(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number): Part {
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const c = new THREE.Color(color);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/* ------------------------------------------------------------------ */
/* Shared decor helpers                                                */
/* ------------------------------------------------------------------ */
function fence(L: LayoutBuilder, color: number) {
  const h = L.half;
  const post = 0x495057;
  for (let i = -h; i <= h; i += 6) {
    L.decor.push(box(0.3, 2.2, 0.3, post, i, 1.1, -h), box(0.3, 2.2, 0.3, post, i, 1.1, h), box(0.3, 2.2, 0.3, post, -h, 1.1, i), box(0.3, 2.2, 0.3, post, h, 1.1, i));
  }
  L.decor.push(box(h * 2, 1.4, 0.1, color, 0, 1.2, -h), box(h * 2, 1.4, 0.1, color, 0, 1.2, h), box(0.1, 1.4, h * 2, color, -h, 1.2, 0), box(0.1, 1.4, h * 2, color, h, 1.2, 0));
}

function tireWall(L: LayoutBuilder, cx: number, cz: number, n: number, alongX: boolean) {
  const cols = [0x2b2d42, 0x3d405b, 0x22223b];
  for (let i = 0; i < n; i++) {
    const x = alongX ? cx + (i - (n - 1) / 2) * 1.3 : cx;
    const z = alongX ? cz : cz + (i - (n - 1) / 2) * 1.3;
    for (let k = 0; k < 3; k++) L.decor.push(torus(0.48, 0.22, cols[(i + k) % 3], x, 0.22 + k * 0.42, z, Math.PI / 2, 0, 0, Math.PI * 2, 4, 8));
  }
  const len = n * 1.3;
  L.solid(cx, cz, alongX ? len : 1.3, alongX ? 1.3 : len, 1.3);
}

function mound(L: LayoutBuilder, rng: Rng, cx: number, cz: number, r: number) {
  const cols = [0xbc6c25, 0x9c6644, 0xdda15e, 0x8d99ae, 0x6c757d];
  L.decor.push(dodeca(r, 0xa0522d, cx, r * 0.25, cz, 1, 0.55, 1));
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, r * 0.7);
    L.decor.push(box(rng.range(0.6, 1.6), rng.range(0.4, 1.2), rng.range(0.6, 1.8), rng.pick(cols), cx + Math.cos(a) * d, r * 0.45 + rng.range(-0.3, 0.6), cz + Math.sin(a) * d, rng.range(-0.5, 0.5), rng.range(0, 3), rng.range(-0.5, 0.5)));
  }
  const s = r * 1.4;
  L.solid(cx, cz, s, s, 3);
}

function tree(L: LayoutBuilder, x: number, z: number, s = 1) {
  L.decor.push(cyl(0.22 * s, 0.3 * s, 1.6 * s, 0x8b5e34, 6, x, 0.8 * s, z), cone(1.5 * s, 2.6 * s, 0x2d9d4f, 6, x, 2.6 * s, z), cone(1.1 * s, 1.8 * s, 0x40c463, 6, x, 3.6 * s, z));
  L.solid(x, z, 0.9 * s, 0.9 * s, 4);
}

function house(L: LayoutBuilder, rng: Rng, cx: number, cz: number, w: number, d: number) {
  const walls = [0xfff1e6, 0xfde2e4, 0xe2ece9, 0xdfe7fd, 0xfff3b0];
  const roofs = [0xe63946, 0x457b9d, 0xf4a261, 0x2a9d8f, 0x6d597a];
  const h = 3.6;
  const wall = rng.pick(walls);
  L.decor.push(box(w, h, d, wall, cx, h / 2, cz));
  // pyramid-ish roof
  const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4);
  roof.rotateY(Math.PI / 4);
  roof.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
  L.decor.push(finishWedge(roof.toNonIndexed(), rng.pick(roofs), cx, h + 1.2, cz));
  L.decor.push(box(1.0, 1.8, 0.1, 0x6d4c41, cx, 0.9, cz + d / 2 + 0.03), box(0.9, 0.9, 0.1, 0x9ad7ff, cx - w * 0.28, 2.2, cz + d / 2 + 0.03), box(0.9, 0.9, 0.1, 0x9ad7ff, cx + w * 0.28, 2.2, cz + d / 2 + 0.03));
  L.solid(cx, cz, w, d, 6);
}

/** Flat-roof garage you can drive onto via a ramp. Junk hotspot on top. */
function garageWithRamp(L: LayoutBuilder, cx: number, cz: number, rampSide: 'n' | 's' | 'e' | 'w') {
  const s = 7;
  const h = 2.4;
  L.decor.push(box(s, h, s, 0xced4da, cx, h / 2, cz), box(s + 0.2, 0.2, s + 0.2, 0x8d99ae, cx, h + 0.05, cz), box(s * 0.6, h * 0.8, 0.1, 0xadb5bd, cx, h * 0.4, cz + s / 2 + 0.03));
  L.solid(cx, cz, s, s, h, { walkable: true });
  const len = 7;
  const rw = 4;
  let rx = cx,
    rz = cz,
    axis: 'x' | 'z' = 'z',
    dir: 1 | -1 = 1;
  if (rampSide === 's') ((rz = cz + s / 2 + len / 2), (axis = 'z'), (dir = -1));
  if (rampSide === 'n') ((rz = cz - s / 2 - len / 2), (axis = 'z'), (dir = 1));
  if (rampSide === 'e') ((rx = cx + s / 2 + len / 2), (axis = 'x'), (dir = -1));
  if (rampSide === 'w') ((rx = cx - s / 2 - len / 2), (axis = 'x'), (dir = 1));
  const w = axis === 'z' ? rw : len;
  const d = axis === 'z' ? len : rw;
  L.decor.push(wedge(w, h, d, 0xffb703, rx, rz, axis, dir));
  L.solid(rx, rz, w, d, h, { ramp: { axis, dir } });
  L.hotspots.push({ x: cx, z: cz, r: 2.6, tier: 2, n: 5 });
}

/** Free-standing jump ramp in the street. */
function jumpRamp(L: LayoutBuilder, cx: number, cz: number, axis: 'x' | 'z', dir: 1 | -1) {
  const len = 5;
  const w = 4;
  const h = 1.5;
  const bw = axis === 'z' ? w : len;
  const bd = axis === 'z' ? len : w;
  L.decor.push(wedge(bw, h, bd, 0xff7b00, cx, cz, axis, dir));
  // stripes
  L.decor.push(box(axis === 'z' ? w + 0.05 : 0.3, h * 0.5, axis === 'z' ? 0.3 : w + 0.05, 0x111111, cx + (axis === 'x' ? (dir * len) / 2 - dir * 0.2 : 0), h * 0.75, cz + (axis === 'z' ? (dir * len) / 2 - dir * 0.2 : 0)));
  L.solid(cx, cz, bw, bd, h, { ramp: { axis, dir } });
}

/* ------------------------------------------------------------------ */
/* Level definitions                                                   */
/* ------------------------------------------------------------------ */
const JUNKYARD_THEME: Theme = { ground: 0xe9c46a, groundEdge: 0xd4a373, sky: 0x8ecae6, fog: 0xbde0fe, fence: 0x8d99ae, ring: 0xff3c38 };
const SUBURB_THEME: Theme = { ground: 0x95d86b, groundEdge: 0x6fbf4a, sky: 0x9be7ff, fog: 0xcaf0f8, fence: 0xffffff, ring: 0xff006e };

function buildJunkyard(rng: Rng, L: LayoutBuilder) {
  const h = L.half;
  fence(L, L.theme.fence);
  L.start = { x: 0, z: h - 14, heading: Math.PI };
  L.keepClear.push({ x: 0, z: h - 14, r: 4 });
  // dirt patches (flat decor)
  for (let i = 0; i < 18; i++) {
    const g = new THREE.CircleGeometry(rng.range(3, 8), 7);
    g.rotateX(-Math.PI / 2);
    L.decor.push(finishWedge(g.toNonIndexed(), rng.chance(0.5) ? 0xd4a373 : 0xf2cc8f, rng.range(-h, h), 0.02, rng.range(-h, h)));
  }
  // scrap mounds (obstacles)
  const mounds = [
    [-30, -25, 5],
    [28, -30, 6],
    [-34, 18, 4.5],
    [32, 20, 5],
    [0, -6, 4],
    [-12, -40, 4],
    [14, 38, 3.5],
  ];
  for (const [x, z, r] of mounds) mound(L, rng, x + rng.range(-3, 3), z + rng.range(-3, 3), r);
  // tire walls
  tireWall(L, -18, 4, 7, true);
  tireWall(L, 20, -6, 6, false);
  tireWall(L, -6, -24, 5, true);
  tireWall(L, 40, -8, 6, true);
  // shack
  L.decor.push(box(7, 3.4, 5, 0x6c757d, -40, 1.7, -42), box(7.6, 0.4, 5.6, 0xe76f51, -40, 3.5, -42));
  L.solid(-40, -42, 7, 5, 4);
  // crane
  L.decor.push(box(2.5, 1, 2.5, 0x343a40, 42, 0.5, 42), box(0.8, 14, 0.8, 0xffb703, 42, 8, 42), box(16, 0.8, 0.8, 0xffb703, 36, 14.5, 42), box(0.1, 6, 0.1, 0x222222, 30, 11.2, 42), cyl(1.2, 1.2, 0.5, 0xe63946, 10, 30, 8, 42));
  L.solid(42, 42, 2.5, 2.5, 6);
}

function buildSuburb(rng: Rng, L: LayoutBuilder) {
  const h = L.half;
  fence(L, L.theme.fence);
  const roads = [-40, 0, 40];
  const rw = 9;
  for (const r of roads) {
    L.decor.push(box(rw, 0.04, h * 2, 0x5c677d, r, 0.02, 0), box(h * 2, 0.04, rw, 0x5c677d, 0, 0.025, r));
    for (let i = -h + 2; i < h; i += 6) L.decor.push(box(0.3, 0.05, 2.4, 0xffffff, r, 0.05, i), box(2.4, 0.05, 0.3, 0xffffff, i, 0.055, r));
  }
  L.start = { x: 0, z: h - 12, heading: Math.PI };
  L.keepClear.push({ x: 0, z: h - 12, r: 4 });
  // blocks between roads
  const centers = [-20, 20];
  const outer = [-52, 52];
  const sides: ('n' | 's' | 'e' | 'w')[] = ['s', 'e', 'w', 'n'];
  let gi = 0;
  for (const bx of [...centers, ...outer]) {
    for (const bz of [...centers, ...outer]) {
      const isOuter = Math.abs(bx) > 45 || Math.abs(bz) > 45;
      if (isOuter) {
        if (rng.chance(0.45)) tree(L, bx + rng.range(-3, 3), bz + rng.range(-3, 3), rng.range(0.9, 1.3));
        continue;
      }
      // two houses + a garage with ramp + trees
      house(L, rng, bx - 8, bz - 8, rng.range(7, 9), rng.range(6, 8));
      house(L, rng, bx + 9, bz + 9, rng.range(6, 8), rng.range(6, 8));
      garageWithRamp(L, bx + 8, bz - 9, sides[gi++ % 4]);
      tree(L, bx - 10, bz + 9, 1.1);
      tree(L, bx - 3, bz + 12, 0.9);
    }
  }
  // street jump ramps
  jumpRamp(L, 0, 18, 'z', -1);
  jumpRamp(L, 0, -22, 'z', -1);
  jumpRamp(L, -22, 0, 'x', -1);
  jumpRamp(L, 22, 0, 'x', 1);
  jumpRamp(L, -40, 22, 'z', 1);
  jumpRamp(L, 40, -22, 'z', -1);
  jumpRamp(L, 24, 40, 'x', 1);
  jumpRamp(L, -24, -40, 'x', -1);
}

export const LEVELS: LevelDef[] = [
  {
    id: 'junkyard',
    name: 'Junkyard',
    emoji: '🏗️',
    stars: [0.35, 0.6, 0.9],
    junk: { tiny: 340, small: 130, medium: 60, large: 22, huge: 7 },
    features: [],
    build: buildJunkyard,
  },
  {
    id: 'suburb',
    name: 'Suburb',
    emoji: '🏡',
    stars: [0.35, 0.6, 0.9],
    junk: { tiny: 330, small: 130, medium: 65, large: 24, huge: 6 },
    features: ['ramps'],
    unlock: { level: 'junkyard', stars: 1 },
    build: buildSuburb,
  },
];

export const THEMES = { junkyard: JUNKYARD_THEME, suburb: SUBURB_THEME };

export function levelById(id: string): LevelDef {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

/* ------------------------------------------------------------------ */
/* Junk placement                                                      */
/* ------------------------------------------------------------------ */
const TIER_IDS: TierId[] = ['tiny', 'small', 'medium', 'large', 'huge'];

export function generateLayout(def: LevelDef, seed: number, junk = def.junk, half = 55): Layout {
  const rng = new Rng(seed);
  const theme = def.id === 'suburb' ? SUBURB_THEME : JUNKYARD_THEME;
  const L = new LayoutBuilder(def.id === 'suburb' ? 60 : half, theme);
  def.build(rng, L);
  const budget = TIER_IDS.map((t) => junk[t] ?? 0);
  const bigSpots: { x: number; z: number; r: number }[] = [];
  const r = () => rng.next();

  const tryPlace = (tier: number, x: number, z: number): boolean => {
    if (budget[tier] <= 0) return false;
    const size = CONFIG.tiers[tier].size;
    if (L.blocked(x, z, size * 0.5)) return false;
    // a ramp is a bad home for junk
    for (const s of L.solids) if (s.ramp && x > s.minX - 1 && x < s.maxX + 1 && z > s.minZ - 1 && z < s.maxZ + 1) return false;
    for (const k of L.keepClear) if (Math.hypot(x - k.x, z - k.z) < k.r + size * 0.5) return false;
    // big stuff stays out of the opening lane so the first seconds are pure can-crunching
    if (tier >= 3 && Math.hypot(x - L.start.x, z - L.start.z) < 22 + size) return false;
    if (tier >= 2) {
      for (const b of bigSpots) if (Math.hypot(x - b.x, z - b.z) < b.r + size * 0.6) return false;
    }
    const type = pickTypeInTier(tier, r);
    const jt = JUNK_TYPES[type];
    L.spawns.push({ type, x, z, rot: rng.range(0, Math.PI * 2), paint: rng.pick(jt.paints) });
    budget[tier]--;
    if (tier >= 2) bigSpots.push({ x, z, r: size * 0.6 });
    return true;
  };

  const cluster = (tier: number, cx: number, cz: number, n: number, spread: number) => {
    let placed = 0;
    for (let a = 0; a < n * 4 && placed < n; a++) {
      const ang = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * spread;
      if (tryPlace(tier, cx + Math.cos(ang) * d, cz + Math.sin(ang) * d)) placed++;
    }
  };

  // 1) Opening: a can cluster right in front of the truck + a teaser of the next tiers
  const fx = Math.sin(L.start.heading);
  const fz = Math.cos(L.start.heading);
  const at = (d: number, side = 0) => [L.start.x + fx * d - fz * side, L.start.z + fz * d + fx * side];
  for (let i = 0; i < 16; i++) {
    const [x, z] = at(4.5 + i * 0.55, Math.sin(i * 1.7) * 1.4);
    tryPlace(0, x, z);
  }
  {
    const [x, z] = at(15, 3.5);
    cluster(1, x, z, 3, 1.5);
    const [x2, z2] = at(14, -4);
    cluster(0, x2, z2, 8, 2);
    const [x3, z3] = at(22, -1);
    tryPlace(2, x3, z3);
    const [x4, z4] = at(20, 5);
    cluster(0, x4, z4, 8, 2.2);
  }

  // 2) Hand-placed hotspots (garage roofs etc.)
  for (const hs of L.hotspots) {
    for (let i = 0; i < hs.n; i++) {
      const tier = i === 0 ? Math.min(3, hs.tier + 1) : i < 3 ? hs.tier : hs.tier - 1;
      const ang = rng.range(0, Math.PI * 2);
      const d = rng.range(0, hs.r);
      const x = hs.x + Math.cos(ang) * d;
      const z = hs.z + Math.sin(ang) * d;
      if (budget[tier] > 0 && tier < 3) {
        const type = pickTypeInTier(tier, r);
        L.spawns.push({ type, x, z, rot: rng.range(0, 6.28), paint: rng.pick(JUNK_TYPES[type].paints) });
        budget[tier]--;
      }
    }
  }

  // 3) Clusters: tier grows with distance from start, always mixed with the next tier up
  const maxD = L.half * 1.6;
  const clusterCount = 46;
  for (let c = 0; c < clusterCount; c++) {
    const cx = rng.range(-L.half + 5, L.half - 5);
    const cz = rng.range(-L.half + 5, L.half - 5);
    const d = Math.hypot(cx - L.start.x, cz - L.start.z) / maxD; // 0..1
    const tier = Math.min(4, Math.max(0, Math.floor(d * 3.2 + rng.range(-0.8, 1.0))));
    const n = [10, 6, 3, 2, 1][tier];
    cluster(tier, cx, cz, n, 1.8 + CONFIG.tiers[tier].size * 0.9);
    if (tier < 4) cluster(tier + 1, cx + rng.range(-4, 4), cz + rng.range(-4, 4), tier === 0 ? 2 : 1, 3);
    if (tier > 0) cluster(Math.max(0, tier - 1), cx, cz, 5, 4 + tier); // food around the big stuff
  }

  // 4) Scatter the rest so there is always something within reach in any direction
  for (let tier = 4; tier >= 0; tier--) {
    let guard = 0;
    while (budget[tier] > 0 && guard++ < 4000) tryPlace(tier, rng.range(-L.half, L.half), rng.range(-L.half, L.half));
  }

  return { half: L.half, theme, solids: L.solids, decor: L.decor, spawns: L.spawns, start: L.start };
}

/* ------------------------------------------------------------------ */
/* Daily challenge                                                     */
/* ------------------------------------------------------------------ */
export function dailySetup(dateKey: string, seed: number): { level: LevelDef; goal: DailyGoal; seed: number } {
  const rng = new Rng(seed);
  const level = LEVELS[seed % LEVELS.length];
  let goal: DailyGoal;
  if (rng.chance(0.5)) {
    const target = [0.45, 0.5, 0.55, 0.6][rng.int(0, 3)];
    goal = { kind: 'pct', target, text: `Clean ${Math.round(target * 100)}% of the ${level.name}` };
  } else {
    const tier = rng.chance(0.6) ? 3 : 2;
    const count = tier === 3 ? rng.int(2, 4) : rng.int(8, 12);
    goal = { kind: 'tier', tier, target: count, text: `Lift ${count} ${tier === 3 ? 'cars' : 'appliances'}` };
  }
  void dateKey;
  return { level, goal, seed };
}
