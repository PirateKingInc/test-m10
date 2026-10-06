/**
 * Promotional thumbnails rendered from the real game scene (?thumb=1, see scripts/thumbnails.mjs).
 * Each variant stages a round: a huge pre-filled pile, junk frozen mid-flight, sparks and
 * a hand-placed camera, then renders supersampled and downscales to every requested size.
 * No UI, no text.
 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Game } from './game';
import { JS, Item } from './junk';
import { JUNK_TYPES } from './junkTypes';

type V3 = [number, number, number];

interface Flyer {
  type: string;
  at: V3; // truck-local start (x right, y up, z forward)
  frac: number; // 0 = just left the ground, 1 = on the pile
  spin?: number;
  paint?: number; // override colour for hero pieces
}

export interface ThumbVariant {
  id: string;
  level: string;
  truck: { x: number; z: number; heading: number; scale: number };
  pile: number[]; // items per tier on the pile
  flyers: Flyer[];
  ring?: number; // pulse ring radius (0 = none)
  mega?: boolean;
  camera: { at: V3; look: V3; fov: number };
  sky: [number, number]; // gradient top / horizon
}

const T = (n: number, type: string, ring: [number, number], h: [number, number], frac: [number, number], seed: number): Flyer[] => {
  const out: Flyer[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const d = ring[0] + ((i * 0.618) % 1) * (ring[1] - ring[0]);
    out.push({ type, at: [Math.sin(a) * d, h[0] + ((i * 0.37) % 1) * (h[1] - h[0]), Math.cos(a) * d], frac: frac[0] + ((i * 0.53) % 1) * (frac[1] - frac[0]), spin: i * 1.3 });
  }
  return out;
};

export const VARIANTS: ThumbVariant[] = [
  {
    // A: side profile — clean silhouette of truck + towering pile, junk streaming in from the front
    id: 'a-hero',
    level: 'junkyard',
    truck: { x: 0, z: 18, heading: Math.PI * 0.85, scale: 1.75 },
    pile: [70, 40, 22, 10, 4],
    flyers: [
      { type: 'car', at: [1.5, 0, 12], frac: 0.45, spin: 0.9, paint: 0xff3b3b },
      { type: 'fridge', at: [-1, 0, 8], frac: 0.55, spin: 2, paint: 0x9bf6ff },
      { type: 'bike', at: [2, 0, 7], frac: 0.5, spin: 1.2 },
      { type: 'drum', at: [0.5, 0, 10], frac: 0.35, spin: 0.4 },
      { type: 'washer', at: [-2, 0, 13], frac: 0.3, spin: 0.7 },
      ...T(16, 'can', [3, 9], [0, 0.4], [0.25, 0.8], 0.4).map((f) => ({ ...f, at: [f.at[0] * 0.5, f.at[1], Math.abs(f.at[2]) + 3] as V3 })),
      ...T(6, 'hubcap', [4, 8], [0, 0.3], [0.3, 0.7], 1.7).map((f) => ({ ...f, at: [f.at[0] * 0.5, f.at[1], Math.abs(f.at[2]) + 4] as V3 })),
    ],
    camera: { at: [-21, 5.5, 4], look: [0, 5.0, 1.5], fov: 40 },
    sky: [0x3fa9f5, 0xbdefff],
  },
  {
    // B: high angle chaos — junk streaming in from every direction, pulse shockwave
    id: 'b-chaos',
    level: 'suburb',
    truck: { x: 0, z: 37, heading: Math.PI * 0.92, scale: 1.7 },
    pile: [80, 45, 24, 12, 5],
    flyers: [
      ...T(18, 'can', [5, 11], [0, 0.5], [0.3, 0.8], 0),
      ...T(8, 'drum', [6, 12], [0, 0.3], [0.3, 0.7], 0.5),
      ...T(6, 'microwave', [7, 12], [0, 0.3], [0.3, 0.7], 1.1),
      ...T(5, 'washer', [8, 13], [0, 0.2], [0.25, 0.6], 2.3),
      ...T(3, 'pickup', [11, 14], [0, 0.1], [0.2, 0.45], 0.9),
    ],
    ring: 12,
    camera: { at: [4, 17, 10.5], look: [0, 2.5, 0.5], fov: 50 },
    sky: [0x48b7ff, 0xcaf0f8],
  },
  {
    // C: head-on — magnet facing the viewer, a bright container ripped off the ground beside it
    id: 'c-lift',
    level: 'junkyard',
    truck: { x: 6, z: 12, heading: Math.PI * 0.5, scale: 1.8 },
    pile: [60, 40, 24, 12, 5],
    flyers: [
      { type: 'container', at: [-6.5, 0, 9], frac: 0.32, spin: 0.5, paint: 0xff7b00 },
      { type: 'car', at: [6, 0, 10], frac: 0.4, spin: -0.8, paint: 0x3a86ff },
      ...T(14, 'can', [3, 8], [0, 0.4], [0.3, 0.8], 0.2).map((f) => ({ ...f, at: [f.at[0], f.at[1], Math.abs(f.at[2]) + 3] as V3 })),
      ...T(5, 'bike', [5, 8], [0, 0.2], [0.3, 0.6], 0.8).map((f) => ({ ...f, at: [f.at[0], f.at[1], Math.abs(f.at[2]) + 4] as V3 })),
      ...T(4, 'drum', [5, 8], [0, 0.2], [0.3, 0.6], 2.1).map((f) => ({ ...f, at: [f.at[0], f.at[1], Math.abs(f.at[2]) + 4] as V3 })),
    ],
    camera: { at: [4, 2.6, 19], look: [0, 3.8, 1], fov: 50 },
    sky: [0x2f9df2, 0xc8f1ff],
  },
];

function gradientTexture(top: number, bottom: number) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  grd.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function takeResting(g: Game, pred: (it: Item) => boolean, n: number, nearX: number, nearZ: number): Item[] {
  const list = g.junk.items.filter((it) => (it.state === JS.IDLE || it.state === JS.STRAIN) && pred(it));
  list.sort((a, b) => Math.hypot(b.x - nearX, b.z - nearZ) - Math.hypot(a.x - nearX, a.z - nearZ)); // far ones first
  return list.slice(0, n);
}

function stage(g: Game, v: ThumbVariant) {
  g.stageRound({ kind: 'level', levelId: v.level });
  const tr = g.truck;
  tr.reset(v.truck.x, v.truck.z, v.truck.heading, g.world.heightAt(v.truck.x, v.truck.z));
  tr.scale = 1;
  const fx = Math.sin(v.truck.heading);
  const fz = Math.cos(v.truck.heading);
  const local = (p: V3): V3 => [tr.x + fx * p[2] + fz * p[0], tr.y + p[1], tr.z + fz * p[2] - fx * p[0]];

  // clear heavy ground clutter around the truck (it would block the camera); it joins the pile
  for (const it of takeResting(g, (i) => i.tier >= 3 && Math.hypot(i.x - tr.x, i.z - tr.z) < 24, 99, tr.x, tr.z)) g.junk.attachNow(it);
  // pile: small stuff first, big pieces last so they poke out of the shell
  for (let tier = 0; tier < 5; tier++) for (const it of takeResting(g, (i) => i.tier === tier, v.pile[tier], tr.x, tr.z)) g.junk.attachNow(it);
  // size = power: the truck is as big as the junk its staged lift capacity can carry
  tr.scale = tr.targetScale = g.visualScaleFor(g.capacity) * (v.truck.scale / 1.75);
  g.junk.setTierStates(g.topTier());
  const pose = () => tr.updateVisual(0.016, g.junk.pileRadius, g.radius(), 0.9, !!v.mega, 1.3, g.world.heightAt);
  for (let i = 0; i < 30; i++) pose(); // settle springs

  // junk in flight
  for (const f of v.flyers) {
    const ti = JUNK_TYPES.findIndex((t) => t.id === f.type);
    const [it] = takeResting(g, (i) => i.type === ti, 1, tr.x, tr.z);
    if (!it) continue;
    const [x, y, z] = local(f.at);
    if (f.paint) g.junk.repaint(it, f.paint);
    g.junk.launchNow(it, x, g.world.heightAt(x, z) + y, z, f.frac, f.spin ?? 0);
  }
  // nothing resting right in front of the lens (the camera is pulled back for bigger trucks)
  {
    const k0 = Math.pow(tr.scale / v.truck.scale, 0.8);
    const [qx, , qz] = local([v.camera.at[0] * k0, 0, v.camera.at[2] * k0]);
    for (const it of takeResting(g, (i) => Math.hypot(i.x - qx, i.z - qz) < 11, 999, qx, qz)) g.junk.attachNow(it);
  }
  g.junk.update(0, tr.x, tr.y, tr.z, g.radius(), 1e9, tr.pileMatrix, false, false);

  // sparks around the magnet and the incoming junk
  const mp = tr.magnetWorld(new THREE.Vector3());
  g.particles.burst(mp.x, mp.y, mp.z, 60, [0xffe066, 0xffffff, 0xff3cac, 0x4cc9f0], 9, 0.28);
  g.particles.update(0.09);
  g.particles.burst(mp.x, mp.y, mp.z, 30, [0xffe066, 0xffffff], 5, 0.22);
  g.particles.update(0.03);

  tr.ring.visible = false;
  g.assist.showRing(v.ring ?? 0, tr.x, tr.y, tr.z);

  const scene = g.world.scene;
  scene.background = gradientTexture(v.sky[0], v.sky[1]);
  scene.fog = new THREE.Fog(v.sky[1], 120, 320);

  const cam = g.rig.camera;
  cam.fov = v.camera.fov;
  cam.aspect = 1;
  // compositions were framed for a 1.75x truck: pull the camera back as the (size = power) truck grows
  const k = Math.pow(tr.scale / v.truck.scale, 0.8);
  const [cx, cy, cz] = local([v.camera.at[0] * k, v.camera.at[1] * k, v.camera.at[2] * k]);
  const [lx, ly, lz] = local([v.camera.look[0] * k, v.camera.look[1] * k, v.camera.look[2] * k]);
  cam.position.set(cx, cy, cz);
  cam.lookAt(lx, ly, lz);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** Render every variant at every size. Returns { variantId: { size: pngDataUrl } }. */
export function renderThumbnails(g: Game, sizes: number[], only?: string[]) {
  const out: Record<string, Record<number, string>> = {};
  const r = g.world.renderer;
  const S = Math.min(2400, Math.round(Math.max(...sizes) * 1.5)); // supersample, then downscale
  r.setPixelRatio(1);
  r.setSize(S, S, false);
  for (const v of VARIANTS) {
    if (only && !only.includes(v.id)) continue;
    stage(g, v);
    r.render(g.world.scene, g.rig.camera);
    out[v.id] = {};
    for (const size of sizes) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(r.domElement, 0, 0, size, size);
      out[v.id][size] = c.toDataURL('image/png');
    }
  }
  void CONFIG;
  return out;
}
