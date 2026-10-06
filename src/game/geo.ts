/** Tiny procedural-modeling kit: primitives with baked vertex colours, merged into one geometry. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Part = THREE.BufferGeometry;

const tmpColor = new THREE.Color();
const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
const mat = new THREE.Matrix4();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3(1, 1, 1);

function finish(g: THREE.BufferGeometry, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Part {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  euler.set(rx, ry, rz);
  quat.setFromEuler(euler);
  pos.set(x, y, z);
  mat.compose(pos, quat, scl);
  geo.applyMatrix4(mat);
  const n = geo.attributes.position.count;
  const cols = new Float32Array(n * 3);
  tmpColor.setHex(color);
  // light per-face shade variation for a hand-made look
  for (let i = 0; i < n; i++) {
    cols[i * 3] = tmpColor.r;
    cols[i * 3 + 1] = tmpColor.g;
    cols[i * 3 + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Part {
  return finish(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
}
export function cyl(rt: number, rb: number, h: number, color: number, seg = 8, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Part {
  return finish(new THREE.CylinderGeometry(rt, rb, h, seg), color, x, y, z, rx, ry, rz);
}
export function torus(r: number, tube: number, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2, rseg = 5, tseg = 10): Part {
  return finish(new THREE.TorusGeometry(r, tube, rseg, tseg, arc), color, x, y, z, rx, ry, rz);
}
export function cone(r: number, h: number, color: number, seg = 4, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Part {
  return finish(new THREE.ConeGeometry(r, h, seg), color, x, y, z, rx, ry, rz);
}
export function ico(r: number, color: number, detail = 0, x = 0, y = 0, z = 0): Part {
  return finish(new THREE.IcosahedronGeometry(r, detail), color, x, y, z);
}
export function dodeca(r: number, color: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1): Part {
  const g = new THREE.DodecahedronGeometry(r, 0);
  g.scale(sx, sy, sz);
  return finish(g, color, x, y, z);
}

export function merge(parts: Part[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Wheel lying on its side along X axis (for vehicles). */
export function wheel(r: number, w: number, x: number, y: number, z: number, tire = 0x23232b, hub = 0xbfc4cc): Part[] {
  return [cyl(r, r, w, tire, 10, x, y, z, 0, 0, Math.PI / 2), cyl(r * 0.5, r * 0.5, w * 1.05, hub, 6, x, y, z, 0, 0, Math.PI / 2)];
}
