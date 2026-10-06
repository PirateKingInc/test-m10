/** Juice: pooled instanced particles + camera shake / hit-stop state. */
import * as THREE from 'three';
import { CONFIG } from '../config';

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  spin: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private next = 0;
  private n: number;

  constructor() {
    this.n = CONFIG.perf.particles;
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(g, m, this.n);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.n; i++) {
      this.ps.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, spin: 0 });
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setColorAt(i, _c.setHex(0xffffff));
    }
  }

  burst(x: number, y: number, z: number, count: number, colors: number[], speed = 6, size = 0.18) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const p = this.ps[i];
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * speed * (0.4 + Math.random() * 0.6);
      p.vz = Math.sin(a) * speed * (0.4 + Math.random() * 0.6);
      p.vy = speed * (0.5 + up * 0.9);
      p.max = p.life = 0.35 + Math.random() * 0.35;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.spin = Math.random() * 10;
      this.mesh.setColorAt(i, _c.setHex(colors[k % colors.length]));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** dust ring on ground (landing / huge pickups) */
  ring(x: number, y: number, z: number, count: number, color: number, radius: number) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.n;
      const p = this.ps[i];
      const a = (k / count) * Math.PI * 2;
      p.x = x + Math.cos(a) * radius * 0.5;
      p.y = y + 0.2;
      p.z = z + Math.sin(a) * radius * 0.5;
      p.vx = Math.cos(a) * 7;
      p.vz = Math.sin(a) * 7;
      p.vy = 1.5;
      p.max = p.life = 0.45;
      p.size = 0.45;
      p.spin = 0;
      this.mesh.setColorAt(i, _c.setHex(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      const p = this.ps[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      p.vy -= 22 * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      const k = p.life / p.max;
      const s = p.size * (0.3 + k * 0.7);
      _e.set(p.spin * k, p.spin * 0.7 * k, 0);
      _q.setFromEuler(_e);
      _v.set(p.x, p.y, p.z);
      _s.set(s, s, s);
      _m.compose(_v, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.n; i++) {
      this.ps[i].life = 0;
      this.mesh.setMatrixAt(i, ZERO);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Camera rig: follows truck with smoothed zoom + trauma-based shake. */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private tx = 0;
  private tz = 0;
  private ty = 0;
  private dist = 20;
  private trauma = 0;
  private t = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.5, 600);
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** distance needed to keep `view` world-units radius visible at this aspect */
  private distanceFor(view: number) {
    const c = CONFIG.camera;
    const vfov = (c.fov * Math.PI) / 180;
    const aspect = this.camera.aspect;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const byHeight = view / Math.tan(vfov / 2);
    const byWidth = (view * c.minPortraitWidth) / Math.tan(hfov / 2);
    return Math.max(byHeight, byWidth);
  }

  snap(x: number, y: number, z: number, view: number) {
    this.tx = x;
    this.ty = y;
    this.tz = z;
    this.dist = this.distanceFor(view);
    this.apply(0);
  }

  update(dt: number, x: number, y: number, z: number, vx: number, vz: number, view: number) {
    const c = CONFIG.camera;
    this.t += dt;
    const lx = x + vx * c.lead;
    const lz = z + vz * c.lead;
    const k = 1 - Math.exp(-c.follow * dt);
    this.tx += (lx - this.tx) * k;
    this.tz += (lz - this.tz) * k;
    this.ty += (y * 0.5 - this.ty) * k;
    const want = this.distanceFor(view);
    this.dist += (want - this.dist) * (1 - Math.exp(-c.zoomLerp * dt));
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.apply(dt);
  }

  private apply(_dt: number) {
    const c = CONFIG.camera;
    const pitch = (c.pitchDeg * Math.PI) / 180;
    const s = this.trauma * this.trauma;
    const sx = (Math.sin(this.t * 53) + Math.sin(this.t * 31)) * 0.5 * s * 1.2;
    const sy = (Math.sin(this.t * 47 + 1) + Math.sin(this.t * 29)) * 0.5 * s * 1.2;
    this.camera.position.set(this.tx + sx, this.ty + Math.sin(pitch) * this.dist + sy, this.tz + Math.cos(pitch) * this.dist);
    this.camera.lookAt(this.tx + sx * 0.5, this.ty, this.tz);
  }

  get distance() {
    return this.dist;
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
