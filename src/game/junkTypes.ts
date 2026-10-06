/** Junk catalog: procedural low-poly models, grouped by size tier. Add types here (Phase 2: train cars, etc). */
import * as THREE from 'three';
import { box, cyl, torus, merge, wheel, Part } from './geo';

export interface JunkType {
  id: string;
  tier: number; // index into CONFIG.tiers
  weight: number; // relative spawn frequency inside its tier
  /** instance colours to pick from (multiplied with vertex colours; white body parts take the paint) */
  paints: number[];
  build(): THREE.BufferGeometry;
}

const W = 0xffffff;
const DARK = 0x2b2d42;
const STEEL = 0xb8c0cc;
const GLASS = 0x9ad7ff;

export const JUNK_TYPES: JunkType[] = [
  // ---------- tiny ----------
  {
    id: 'can',
    tier: 0,
    weight: 3,
    paints: [0xff3b3b, 0x3b82ff, 0x22c55e, 0xffb703, 0xff5dc8],
    build: () => merge([cyl(0.2, 0.2, 0.5, W, 8, 0, 0.25, 0), cyl(0.17, 0.2, 0.06, STEEL, 8, 0, 0.53, 0), cyl(0.14, 0.14, 0.2, 0xffffff, 8, 0, 0.25, 0.08)]),
  },
  {
    id: 'hubcap',
    tier: 0,
    weight: 2,
    paints: [0xdfe6ee, 0xffd166],
    build: () => merge([cyl(0.34, 0.38, 0.1, W, 8, 0, 0.05, 0), cyl(0.14, 0.18, 0.08, 0x8d99ae, 6, 0, 0.13, 0)]),
  },
  {
    id: 'pipe',
    tier: 0,
    weight: 2,
    paints: [0x9aa5b1, 0xe76f51, 0x2a9d8f],
    build: () => merge([cyl(0.12, 0.12, 0.8, W, 6, 0, 0.12, 0, 0, 0, Math.PI / 2), cyl(0.16, 0.16, 0.1, STEEL, 6, 0.38, 0.12, 0, 0, 0, Math.PI / 2)]),
  },
  // ---------- small ----------
  {
    id: 'bike',
    tier: 1,
    weight: 2,
    paints: [0xff006e, 0x3a86ff, 0xffbe0b, 0x06d6a0],
    build: () => {
      const r = 0.36;
      const parts: Part[] = [
        torus(r, 0.06, DARK, 0, r + 0.02, -0.5, 0, Math.PI / 2, 0),
        torus(r, 0.06, DARK, 0, r + 0.02, 0.5, 0, Math.PI / 2, 0),
        box(0.08, 0.08, 1.0, W, 0, 0.62, 0),
        box(0.08, 0.55, 0.08, W, 0, 0.55, -0.25, 0.4, 0, 0),
        box(0.08, 0.6, 0.08, W, 0, 0.6, 0.38, -0.3, 0, 0),
        box(0.12, 0.06, 0.28, DARK, 0, 0.92, -0.32),
        box(0.5, 0.06, 0.06, STEEL, 0, 0.95, 0.5),
      ];
      return merge(parts);
    },
  },
  {
    id: 'microwave',
    tier: 1,
    weight: 2,
    paints: [0xf1f1f1, 0xffadad, 0xbde0fe],
    build: () => merge([box(1.0, 0.6, 0.7, W, 0, 0.3, 0), box(0.6, 0.42, 0.04, 0x1d3557, -0.1, 0.32, 0.36), box(0.18, 0.42, 0.04, STEEL, 0.36, 0.32, 0.36)]),
  },
  {
    id: 'drum',
    tier: 1,
    weight: 2,
    paints: [0x2a9d8f, 0xe63946, 0xf4a261, 0x457b9d],
    build: () => merge([cyl(0.42, 0.42, 1.0, W, 10, 0, 0.5, 0), cyl(0.44, 0.44, 0.06, DARK, 10, 0, 0.3, 0), cyl(0.44, 0.44, 0.06, DARK, 10, 0, 0.72, 0), cyl(0.38, 0.38, 0.04, STEEL, 10, 0, 1.0, 0)]),
  },
  // ---------- medium ----------
  {
    id: 'fridge',
    tier: 2,
    weight: 2,
    paints: [0xf8f9fa, 0x9bf6ff, 0xfdffb6, 0xffc6ff],
    build: () =>
      merge([box(1.0, 2.0, 0.9, W, 0, 1.0, 0), box(0.96, 0.04, 0.04, 0x8d99ae, 0, 1.35, 0.46), box(0.06, 0.5, 0.08, STEEL, 0.38, 1.65, 0.48), box(0.06, 0.6, 0.08, STEEL, 0.38, 0.8, 0.48)]),
  },
  {
    id: 'washer',
    tier: 2,
    weight: 2,
    paints: [0xf8f9fa, 0xa0c4ff, 0xcaffbf],
    build: () =>
      merge([
        box(1.3, 1.3, 1.2, W, 0, 0.65, 0),
        cyl(0.42, 0.42, 0.08, 0x1d3557, 12, 0, 0.6, 0.6, Math.PI / 2, 0, 0),
        cyl(0.3, 0.3, 0.1, GLASS, 12, 0, 0.6, 0.62, Math.PI / 2, 0, 0),
        box(1.2, 0.2, 0.1, 0x8d99ae, 0, 1.15, 0.58),
      ]),
  },
  // ---------- large ----------
  {
    id: 'car',
    tier: 3,
    weight: 3,
    paints: [0xff595e, 0x1982c4, 0x8ac926, 0xffca3a, 0x6a4c93, 0xff924c],
    build: () =>
      merge([
        box(1.8, 0.7, 3.6, W, 0, 0.75, 0),
        box(1.6, 0.6, 1.8, W, 0, 1.4, -0.2),
        box(1.62, 0.44, 1.5, GLASS, 0, 1.42, -0.2),
        box(1.9, 0.25, 0.2, STEEL, 0, 0.55, 1.85),
        box(1.9, 0.25, 0.2, STEEL, 0, 0.55, -1.85),
        ...wheel(0.42, 0.3, 0.9, 0.42, 1.15),
        ...wheel(0.42, 0.3, -0.9, 0.42, 1.15),
        ...wheel(0.42, 0.3, 0.9, 0.42, -1.15),
        ...wheel(0.42, 0.3, -0.9, 0.42, -1.15),
      ]),
  },
  {
    id: 'pickup',
    tier: 3,
    weight: 2,
    paints: [0x00b4d8, 0xef476f, 0x06d6a0, 0xffd166],
    build: () =>
      merge([
        box(2.0, 0.8, 4.0, W, 0, 0.9, 0),
        box(1.9, 0.75, 1.4, W, 0, 1.65, 0.7),
        box(1.92, 0.5, 1.2, GLASS, 0, 1.7, 0.72),
        box(1.9, 0.1, 1.9, DARK, 0, 1.31, -1.0),
        ...wheel(0.5, 0.35, 1.0, 0.5, 1.3),
        ...wheel(0.5, 0.35, -1.0, 0.5, 1.3),
        ...wheel(0.5, 0.35, 1.0, 0.5, -1.3),
        ...wheel(0.5, 0.35, -1.0, 0.5, -1.3),
      ]),
  },
  // ---------- huge ----------
  {
    id: 'container',
    tier: 4,
    weight: 3,
    paints: [0xe63946, 0x1d71b8, 0xf77f00, 0x2a9d8f, 0x9b5de5],
    build: () => {
      const parts: Part[] = [box(2.6, 2.7, 7.4, W, 0, 1.35, 0)];
      for (let i = -3; i <= 3; i++) {
        parts.push(box(2.72, 2.5, 0.14, W, 0, 1.35, i * 1.0));
      }
      parts.push(box(2.66, 0.12, 7.5, 0x22223b, 0, 2.72, 0));
      return merge(parts);
    },
  },
  {
    id: 'bus',
    tier: 4,
    weight: 2,
    paints: [0xffc300, 0xff9f1c],
    build: () => {
      const parts: Part[] = [box(2.5, 2.3, 7.8, W, 0, 1.55, 0), box(2.52, 0.7, 7.0, GLASS, 0, 2.0, -0.2), box(2.55, 0.15, 7.85, DARK, 0, 1.1, 0)];
      parts.push(...wheel(0.6, 0.4, 1.15, 0.6, 2.6), ...wheel(0.6, 0.4, -1.15, 0.6, 2.6), ...wheel(0.6, 0.4, 1.15, 0.6, -2.4), ...wheel(0.6, 0.4, -1.15, 0.6, -2.4));
      return merge(parts);
    },
  },
];

export const TYPES_BY_TIER: number[][] = [[], [], [], [], []];
JUNK_TYPES.forEach((t, i) => TYPES_BY_TIER[t.tier].push(i));

export function pickTypeInTier(tier: number, r: () => number): number {
  const list = TYPES_BY_TIER[tier];
  let total = 0;
  for (const i of list) total += JUNK_TYPES[i].weight;
  let x = r() * total;
  for (const i of list) {
    x -= JUNK_TYPES[i].weight;
    if (x <= 0) return i;
  }
  return list[list.length - 1];
}
