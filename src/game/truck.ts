import * as THREE from 'three';
import { CONFIG } from '../config';
import { box, cyl, torus, merge, Part } from './geo';

export type Skin = (typeof CONFIG.skins)[number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();

function buildBody(skin: Skin): THREE.BufferGeometry {
  const parts: Part[] = [
    box(1.9, 0.55, 3.3, skin.accent, 0, 0.75, 0), // chassis
    box(1.95, 0.7, 1.25, skin.cab, 0, 1.35, 0.95), // cab
    box(1.7, 0.45, 1.0, 0x9ad7ff, 0, 1.55, 1.12), // windshield block
    box(1.98, 0.18, 1.3, skin.body, 0, 1.78, 0.95), // cab roof
    box(1.95, 0.55, 1.9, skin.body, 0, 1.2, -0.65), // bed
    box(2.0, 0.25, 0.25, 0xdfe6ee, 0, 0.6, 1.72), // bumper
    box(0.35, 0.22, 0.08, 0xfff3b0, 0.6, 1.0, 1.66), // lights
    box(0.35, 0.22, 0.08, 0xfff3b0, -0.6, 1.0, 1.66),
    box(0.3, 1.3, 0.3, skin.accent, 0, 2.0, -0.5), // mast
  ];
  return merge(parts);
}

function buildWheel(skin: Skin): THREE.BufferGeometry {
  const r = skin.bigWheels ? 0.62 : 0.45;
  return merge([cyl(r, r, 0.42, skin.wheel, 10, 0, 0, 0, 0, 0, Math.PI / 2), cyl(r * 0.5, r * 0.5, 0.45, 0xdfe6ee, 6, 0, 0, 0, 0, 0, Math.PI / 2), box(0.46, r * 1.6, 0.18, skin.wheel, 0, 0, 0)]);
}

function buildMagnet(skin: Skin): THREE.BufferGeometry {
  // horseshoe facing forward (+z): arc + silver pole tips
  return merge([
    torus(0.7, 0.28, skin.magnet, 0, 0, 0, Math.PI / 2, 0, Math.PI, Math.PI, 5, 9),
    box(0.58, 0.58, 0.5, 0xe9ecef, 0.7, 0, 0.25),
    box(0.58, 0.58, 0.5, 0xe9ecef, -0.7, 0, 0.25),
    box(0.25, 0.25, 0.9, skin.accent, 0, 0, -0.9),
  ]);
}

export class Truck {
  readonly root = new THREE.Group(); // position + heading
  private body = new THREE.Group(); // squash / tilt
  private bodyMesh!: THREE.Mesh;
  private wheels: THREE.Mesh[] = [];
  readonly magnet = new THREE.Group();
  private magnetMesh!: THREE.Mesh;
  readonly ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  readonly shadow: THREE.Mesh;
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  private glowMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.35, depthWrite: false });
  private glow: THREE.Mesh;

  x = 0;
  y = 0;
  z = 0;
  vy = 0;
  heading = Math.PI;
  speed = 0;
  scale = 1;
  airborne = false;
  airTime = 0;
  private squash = 0;
  private squashV = 0;
  private roll = 0;
  private pitch = 0;
  private turnVel = 0;
  private ringPulse = 0;
  pileMatrix = new THREE.Matrix4();
  private sway = new THREE.Vector2();
  private swayV = new THREE.Vector2();
  skinId = '';

  constructor(theme: { ring: number }) {
    this.root.add(this.body);
    this.ringMat = new THREE.MeshBasicMaterial({ color: theme.ring, transparent: true, opacity: 0.22, depthWrite: false });
    const ringGeo = new THREE.RingGeometry(0.93, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 1;
    const sh = new THREE.CircleGeometry(1, 20);
    sh.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sh, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    this.shadow.renderOrder = 1;
    this.glow = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), this.glowMat);
    this.glow.visible = false;
  }

  private ringColor = 0xffffff;
  setTheme(ring: number) {
    this.ringColor = ring;
    this.ringMat.color.setHex(ring);
  }

  setSkin(skin: Skin) {
    if (skin.id === this.skinId) return;
    this.skinId = skin.id;
    this.body.clear();
    this.magnet.clear();
    this.wheels = [];
    const bodyGeo = buildBody(skin);
    this.length = bodyGeo.boundingBox!.max.z - bodyGeo.boundingBox!.min.z;
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.mat);
    this.body.add(this.bodyMesh);
    const wg = buildWheel(skin);
    const r = skin.bigWheels ? 0.62 : 0.45;
    const wy = r;
    const lift = skin.bigWheels ? 0.25 : 0;
    this.bodyMesh.position.y = lift;
    for (const [x, z] of [
      [1.0, 1.05],
      [-1.0, 1.05],
      [1.0, -1.05],
      [-1.0, -1.05],
    ]) {
      const w = new THREE.Mesh(wg, this.mat);
      w.position.set(x * (skin.bigWheels ? 1.1 : 1), wy, z);
      this.body.add(w);
      this.wheels.push(w);
    }
    this.magnetMesh = new THREE.Mesh(buildMagnet(skin), this.mat);
    this.magnet.add(this.magnetMesh, this.glow);
  }

  reset(x: number, z: number, heading: number, groundY: number) {
    this.x = x;
    this.z = z;
    this.y = groundY;
    this.vy = 0;
    this.heading = heading;
    this.speed = 0;
    this.airborne = false;
    this.squash = this.squashV = 0;
    this.sway.set(0, 0);
    this.swayV.set(0, 0);
    this.scaleV = 0;
  }

  /** collision size: follows the visual size, capped by the game (big trucks must still reach Suburb yards) */
  collisionScale = 1;
  /** body length at scale 1 (world units) */
  length = 3.45;
  /** visual size target (set from lift capacity every frame) */
  targetScale = 1;
  private scaleV = 0;

  /** Size = power: spring the visual scale toward its target (overshoot = pop). */
  stepScale(dt: number) {
    const S = CONFIG.sizing;
    this.scaleV += ((this.targetScale - this.scale) * S.spring - this.scaleV * S.damping) * dt;
    this.scale = Math.max(S.minScale * 0.8, this.scale + this.scaleV * dt);
  }

  /** "Power up" pop when a new tier unlocks: kick the spring and squash. */
  pop() {
    this.scaleV += this.targetScale * 4;
    this.bump(0.35);
  }

  /** Physical squash impulse (pickups, landings). */
  bump(amount: number) {
    this.squashV -= amount * 14;
    this.ringPulse = Math.min(1, this.ringPulse + amount * 3 + 0.2);
  }

  /**
   * Drive. Returns landing impact (>0) when touching down this frame.
   * blockFn pushes the truck out of heavy junk; heightFn = ground height.
   */
  drive(
    dt: number,
    wantX: number,
    wantZ: number,
    hasInput: boolean,
    targetSpeed: number,
    heightFn: (x: number, z: number) => number,
    half: number,
    blockFn: (x: number, z: number, r: number) => [number, number],
  ): number {
    const T = CONFIG.truck;
    // steering
    const prevHeading = this.heading;
    if (hasInput) {
      const desired = Math.atan2(wantX, wantZ);
      let diff = desired - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = T.turnRate * dt * (this.airborne ? 0.4 : 1);
      this.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
    }
    this.turnVel += ((this.heading - prevHeading) / Math.max(dt, 1e-4) - this.turnVel) * Math.min(1, dt * 10);
    // speed
    const ds = targetSpeed - this.speed;
    this.speed += Math.sign(ds) * Math.min(Math.abs(ds), T.accel * dt);

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const step = T.stepHeight;
    const r = T.collisionRadius * this.collisionScale;
    const canStand = (x: number, z: number) => {
      // walk 3 lines (centre + both front corners) from the truck to its bumper: each sample may rise at
      // most one step above the previous one, so slopes are climbable at any truck size but walls block
      const sx = Math.cos(this.heading);
      const sz = -Math.sin(this.heading);
      const fr = 1.4 * this.collisionScale;
      const sd = 0.8 * this.collisionScale;
      if (heightFn(x, z) > this.y + step) return false;
      const n = Math.max(2, Math.ceil(fr / 0.9));
      for (const side of [0, sd, -sd]) {
        let prev = this.y;
        for (let i = 1; i <= n; i++) {
          const d = (fr * i) / n;
          const h = heightFn(x + fx * d + sx * side, z + fz * d + sz * side);
          if (h > prev + step) return false;
          prev = h;
        }
      }
      return true;
    };
    let nx = this.x + fx * this.speed * dt;
    let nz = this.z + fz * this.speed * dt;
    if (!canStand(nx, nz)) {
      if (canStand(nx, this.z)) nz = this.z;
      else if (canStand(this.x, nz)) nx = this.x;
      else {
        nx = this.x;
        nz = this.z;
        this.speed *= 0.6;
      }
    }
    // heavy junk pushes back
    const [px, pz] = blockFn(nx, nz, r);
    nx = px;
    nz = pz;
    const lim = half - 1.8;
    nx = Math.max(-lim, Math.min(lim, nx));
    nz = Math.max(-lim, Math.min(lim, nz));
    this.x = nx;
    this.z = nz;

    // vertical
    let impact = 0;
    const g = heightFn(this.x, this.z);
    if (!this.airborne) {
      if (g >= this.y - 0.05) {
        // slope-following vertical speed; clamped so a tiny sub-step can never turn a ramp into a catapult
        const newVy = Math.max(-12, Math.min(12, (g - this.y) / Math.max(dt, 1 / 120)));
        this.vy = this.vy * 0.5 + newVy * 0.5;
        this.y = g;
      } else if (this.y - g > 0.05 && this.vy > 1.0) {
        // ground falls away while still climbing (ramp lip or hump crest): launch
        this.airborne = true; // launched off a ramp lip
        this.vy *= 1.9;
        this.airTime = 0;
      } else if (this.y - g > 0.6) {
        this.airborne = true; // drove off a ledge
        this.vy = 0;
        this.airTime = 0;
      } else {
        this.y = g;
        this.vy = 0;
      }
    }
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= T.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        impact = Math.min(1.5, -this.vy / 12);
        this.y = g;
        this.vy = 0;
        this.airborne = false;
        this.bump(0.12 + impact * 0.15);
      }
    }
    return impact;
  }

  /** Visual update + pile matrix. pileRadius from JunkSystem; radius = pull radius. */
  updateVisual(dt: number, pileRadius: number, radius: number, magnetGrow: number, mega: boolean, time: number, heightFn: (x: number, z: number) => number) {
    // squash spring
    this.squashV += (-this.squash * 220 - this.squashV * 16) * dt;
    this.squash += this.squashV * dt;
    const sq = Math.max(-0.35, Math.min(0.35, this.squash));
    // tilt: pitch from slope, roll from turning
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const hf = heightFn(this.x + fx * 1.4 * this.scale, this.z + fz * 1.4 * this.scale);
    const hb = heightFn(this.x - fx * 1.4 * this.scale, this.z - fz * 1.4 * this.scale);
    const targetPitch = this.airborne ? -this.vy * 0.025 : -Math.atan2(hf - hb, 2.8 * this.scale);
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 10);
    const targetRoll = Math.max(-0.25, Math.min(0.25, -this.turnVel * 0.05 * (this.speed / 10)));
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 8);

    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.set(0, this.heading, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    this.body.scale.set(this.scale * (1 - sq * 0.5), this.scale * (1 + sq), this.scale * (1 - sq * 0.5));
    for (const w of this.wheels) w.rotation.x += (this.speed * dt) / 0.45;

    // pile sway spring (lags behind turns/accel)
    this.swayV.x += (-this.sway.x * 60 - this.swayV.x * 7 + this.turnVel * 0.6) * dt;
    this.swayV.y += (-this.sway.y * 60 - this.swayV.y * 7 + this.squashV * 0.5) * dt;
    this.sway.x += this.swayV.x * dt;
    this.sway.y += this.swayV.y * dt;

    // pile centre sits above the bed, rising with the pile
    const top = 2.5 * this.scale;
    const cy = top + pileRadius * 0.72;
    const cz = -0.4 * this.scale;
    _v.set(0, cy, cz);
    this.root.updateMatrix();
    _q.setFromEuler(_e.set(this.pitch + this.sway.y * 0.1, 0, this.roll + this.sway.x * 0.12));
    _m.compose(_v, _q, _s);
    this.pileMatrix.copy(this.root.matrix).multiply(_m);

    // magnet: mounted at the front of the pile, facing forward
    // magnet stays oversized relative to the truck, and grows a little with the pull radius
    const ms = this.scale * (0.9 + magnetGrow * 0.3) * (1 + Math.max(0, -sq) * 0.6);
    this.magnet.position.set(this.x, 0, this.z);
    this.magnet.matrixAutoUpdate = false;
    _v.set(0, 0, pileRadius * 0.82);
    _v.applyMatrix4(this.pileMatrix);
    _q.setFromRotationMatrix(this.pileMatrix);
    _s.set(ms, ms, ms);
    this.magnet.matrix.compose(_v, _q, _s);
    _s.set(1, 1, 1);
    this.glow.visible = mega;
    if (mega) {
      const p = 1.4 + Math.sin(time * 12) * 0.15;
      this.glow.scale.set(p, p, p);
    }

    // ground ring + shadow
    this.ringPulse = Math.max(0, this.ringPulse - dt * 3);
    const g = heightFn(this.x, this.z);
    const rr = radius * (1 + this.ringPulse * 0.06);
    this.ring.position.set(this.x, g + 0.06, this.z);
    this.ring.scale.set(rr, 1, rr);
    // reach ring: faint at rest, brief brighter pulse on each pickup
    this.ringMat.opacity = (mega ? 0.34 : 0.15) + this.ringPulse * 0.32;
    if (mega) this.ringMat.color.setHSL((time * 0.6) % 1, 0.9, 0.6);
    else this.ringMat.color.setHex(this.ringColor);
    const shr = Math.max(1.9 * this.scale, pileRadius * 1.05);
    this.shadow.position.set(this.x, g + 0.04, this.z);
    this.shadow.scale.set(shr, 1, shr * 1.15);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = this.airborne ? 0.12 : 0.22;
  }

  /** world position of the magnet (for particles) */
  magnetWorld(out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.magnet.matrix);
  }
  get forwardX() {
    return Math.sin(this.heading);
  }
  get forwardZ() {
    return Math.cos(this.heading);
  }
}
void UP;
