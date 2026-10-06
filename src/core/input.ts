/**
 * One-input steering: press anywhere and drag (virtual joystick anchored at the
 * press point), or WASD / arrow keys. Produces a desired world direction on the
 * XZ plane (camera yaw is fixed: screen-up = world -Z).
 */
export class Input {
  /** desired direction (x, z), length 0..1 */
  dirX = 0;
  dirZ = 0;
  active = false; // any steering input currently held
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private px = 0;
  private py = 0;
  private keys = new Set<string>();
  private lastPointerDir: [number, number] | null = null;
  /** fires once per gesture, used for first-input + audio unlock */
  onAnyInput: () => void = () => {};
  enabled = true;
  /** joystick visual */
  private stick: HTMLElement;
  private knob: HTMLElement;

  constructor(el: HTMLElement) {
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.stick.appendChild(this.knob);
    document.body.appendChild(this.stick);

    el.addEventListener('pointerdown', (e) => this.down(e), { passive: false });
    window.addEventListener('pointermove', (e) => this.move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });
  }

  private down(e: PointerEvent) {
    this.onAnyInput();
    if (!this.enabled || this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.ox = this.px = e.clientX;
    this.oy = this.py = e.clientY;
    this.lastPointerDir = null;
    this.stick.style.left = `${this.ox}px`;
    this.stick.style.top = `${this.oy}px`;
    this.stick.classList.add('on');
    this.knob.style.transform = 'translate(-50%,-50%)';
  }
  private move(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.px = e.clientX;
    this.py = e.clientY;
    const max = 50;
    let dx = this.px - this.ox;
    let dy = this.py - this.oy;
    const len = Math.hypot(dx, dy);
    // floating joystick: drag the origin along so direction changes stay snappy
    if (len > max * 1.6) {
      const k = (len - max * 1.6) / len;
      this.ox += dx * k;
      this.oy += dy * k;
      this.stick.style.left = `${this.ox}px`;
      this.stick.style.top = `${this.oy}px`;
      dx = this.px - this.ox;
      dy = this.py - this.oy;
    }
    const l2 = Math.hypot(dx, dy);
    const kx = l2 > max ? (dx / l2) * max : dx;
    const ky = l2 > max ? (dy / l2) * max : dy;
    this.knob.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    if (l2 > 8) this.lastPointerDir = [dx / l2, dy / l2];
  }
  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return;
    this.release();
  }
  private release() {
    this.pointerId = null;
    this.stick.classList.remove('on');
  }
  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.toLowerCase();
    const steer = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
    if (steer.includes(k) || k === ' ') e.preventDefault(); // Poki: never scroll the page
    if (!steer.includes(k)) return;
    if (down) {
      this.onAnyInput();
      this.keys.add(k);
    } else this.keys.delete(k);
  }

  update() {
    let x = 0;
    let z = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) z -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) z += 1;
    if ((x || z) && this.enabled) {
      const l = Math.hypot(x, z);
      this.dirX = x / l;
      this.dirZ = z / l;
      this.active = true;
      return;
    }
    if (this.pointerId !== null && this.lastPointerDir && this.enabled) {
      this.dirX = this.lastPointerDir[0];
      this.dirZ = this.lastPointerDir[1];
      this.active = true;
      return;
    }
    this.active = false;
  }

  reset() {
    this.keys.clear();
    this.release();
    this.active = false;
  }
}
