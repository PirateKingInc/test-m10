/**
 * Level feature registry. A level lists feature ids; each feature gets lifecycle hooks.
 * Phase 1: 'ramps' (handled by heightfield solids, no runtime code) and 'waves' (Rush).
 * Phase 2 plugs in here without touching the core loop:
 *   'trains'  – update() moves a kinematic group of junk along a track (spawn with JunkSystem.spawn, move via item.x/z)
 *   'crusher' – update() + onAttach(): a crusher entity steals items near it (state GONE)
 *   'storm'   – pullScale() returns negative during storms to briefly reverse the pull
 */
import { CONFIG } from '../config';
import { Rng } from '../core/rng';
import { JUNK_TYPES, pickTypeInTier } from './junkTypes';
import type { Item, JunkSystem } from './junk';

export interface FeatureHost {
  junk: JunkSystem;
  truckX: number;
  truckZ: number;
  capacity: number;
  half: number;
  roundTime: number; // elapsed seconds
  rng: Rng;
  blocked(x: number, z: number): boolean;
  toast(text: string): void;
}

export interface Feature {
  setup?(h: FeatureHost): void;
  update?(h: FeatureHost, dt: number): void;
  onAttach?(h: FeatureHost, it: Item): void;
  /** multiplier on pull radius (Phase 2 storms may return < 0 to repel) */
  pullScale?(h: FeatureHost): number;
}

type FeatureFactory = () => Feature;

/** Rush: junk rains down in waves sized to the player's current strength. */
const waves: FeatureFactory = () => {
  let timer = 0;
  let wave = 0;
  return {
    update(h, dt) {
      const R = CONFIG.rush;
      timer += dt;
      const frac = h.junk.remainingValue() / Math.max(1, h.junk.totalValue);
      if (timer < R.waveInterval && !(frac < R.waveRemainingTrigger && timer > 3)) return;
      timer = 0;
      wave++;
      // highest tier currently liftable
      let top = 0;
      CONFIG.tiers.forEach((t, i) => {
        if (t.mass <= h.capacity) top = i;
      });
      const n = Math.round(R.waveItems * (1 + R.waveGrowth * wave));
      let spawned = 0;
      let hugeLeft = 3;
      for (let k = 0; k < n * 3 && spawned < n; k++) {
        const roll = h.rng.next();
        let tier = roll < 0.5 ? top : roll < 0.8 ? Math.max(0, top - 1) : roll < 0.93 ? Math.max(0, top - 2) : top + 1;
        tier = Math.min(4, tier);
        if (tier === 4 && hugeLeft-- <= 0) tier = 3; // a few showpieces per wave, not a wall of buses
        const a = h.rng.range(0, Math.PI * 2);
        const d = h.rng.range(R.waveRingMin, R.waveRingMax) + CONFIG.tiers[tier].size;
        const x = h.truckX + Math.cos(a) * d;
        const z = h.truckZ + Math.sin(a) * d;
        if (h.blocked(x, z)) continue;
        const type = pickTypeInTier(tier, () => h.rng.next());
        if (h.junk.spawn(type, x, z, h.rng.range(0, 6.28), h.rng.pick(JUNK_TYPES[type].paints), true)) spawned++;
      }
      if (spawned) h.toast(`WAVE ${wave}!`);
    },
  };
};

const REGISTRY: Record<string, FeatureFactory> = {
  ramps: () => ({}),
  waves,
};

export function createFeatures(ids: string[]): Feature[] {
  return ids.filter((id) => REGISTRY[id]).map((id) => REGISTRY[id]());
}
