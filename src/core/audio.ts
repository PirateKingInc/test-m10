/**
 * Everything synthesized at runtime with Web Audio. No audio files.
 * The context is created on the first user gesture (autoplay policy).
 */
const PENTA = [0, 2, 4, 7, 9]; // major pentatonic for combo chimes

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private muted = false;
  private adMuted = false;
  private lastWhoosh = 0;
  private musicOn = false;
  private step = 0;
  private nextStepTime = 0;
  private schedTimer: number | null = null;
  private musicIntensity = 0;

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }
  get isMuted() {
    return this.muted;
  }
  setAdMuted(m: boolean) {
    this.adMuted = m;
    this.applyVolume();
    if (this.ctx) {
      if (m) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    }
  }
  private applyVolume() {
    if (!this.ctx) return;
    const v = this.muted || this.adMuted ? 0 : 1;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Call from any user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.gain.value = 0.8;
      this.sfx.connect(this.master);
      this.musicFilter = ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 6000;
      this.music = ctx.createGain();
      this.music.gain.value = 0.22;
      this.music.connect(this.musicFilter).connect(this.master);
      const len = ctx.sampleRate * 1;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended' && !this.adMuted) this.ctx.resume().catch(() => {});
  }

  private get ok() {
    return !!this.ctx && !this.muted && !this.adMuted;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(type: OscillatorType, f0: number, f1: number, t: number, a: number, peak: number, d: number, dest: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    this.env(g, t, a, peak, d);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  private noiseHit(t: number, freq: number, q: number, peak: number, d: number, type: BiquadFilterType = 'bandpass', dest: AudioNode = this.sfx, f1?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + d);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.004, peak, d);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + d + 0.05);
  }

  /** The CLUNK. tier 0..4 (bigger = lower/heavier), pitchSteps raises pitch for combos. */
  clunk(tier: number, pitchSteps: number) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const p = Math.pow(2, pitchSteps / 12);
    const base = 190 / (1 + tier * 0.45);
    this.tone('sine', base * p * 1.6, base * p * 0.6, t, 0.003, 0.55 + tier * 0.08, 0.12 + tier * 0.05);
    this.tone('square', 520 * p / (1 + tier * 0.3), 300 * p, t, 0.002, 0.06, 0.06 + tier * 0.02);
    this.noiseHit(t, 2400 * p / (1 + tier * 0.4), 3, 0.35, 0.05 + tier * 0.03);
    if (tier >= 3) this.noiseHit(t, 180, 0.8, 0.5, 0.35, 'lowpass');
  }

  chime(comboCount: number) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const idx = Math.min(comboCount, 20);
    const semis = PENTA[idx % 5] + 12 * Math.floor(idx / 5);
    const f = 523.25 * Math.pow(2, semis / 12);
    this.tone('triangle', f, f, t, 0.005, 0.14, 0.22);
    this.tone('sine', f * 2, f * 2, t + 0.02, 0.005, 0.05, 0.15);
  }

  whoosh() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    if (t - this.lastWhoosh < 0.09) return;
    this.lastWhoosh = t;
    this.noiseHit(t, 500, 1.2, 0.08, 0.22, 'bandpass', this.sfx, 2200);
  }

  strain() {
    if (!this.ok || Math.random() > 0.05) return;
    const t = this.ctx!.currentTime;
    this.tone('sawtooth', 70, 60, t, 0.02, 0.025, 0.2);
  }

  /** magnet pulse: low "vwomm" sweep + shimmer */
  pulse() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('sawtooth', 90, 340, t, 0.01, 0.12, 0.35);
    this.tone('sine', 180, 720, t, 0.01, 0.2, 0.3);
    this.noiseHit(t, 600, 1.5, 0.12, 0.35, 'bandpass', this.sfx, 3000);
  }

  private lastThud = 0;
  /** quieter thud for junk landing from the sky (rate-limited) */
  dropThud() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    if (t - this.lastThud < 0.12) return;
    this.lastThud = t;
    this.tone('sine', 110, 45, t, 0.003, 0.35, 0.18);
    this.noiseHit(t, 400, 0.8, 0.18, 0.12, 'lowpass');
  }

  thud() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('sine', 120, 40, t, 0.003, 0.6, 0.25);
    this.noiseHit(t, 300, 0.7, 0.3, 0.2, 'lowpass');
  }

  jump() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('square', 220, 660, t, 0.01, 0.05, 0.18);
  }

  tick(urgent: boolean) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('square', urgent ? 1100 : 880, urgent ? 1100 : 880, t, 0.002, 0.07, 0.06);
  }

  timeUp() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [784, 659, 523].forEach((f, i) => this.tone('square', f, f, t + i * 0.09, 0.005, 0.1, 0.12));
    this.noiseHit(t, 1200, 1, 0.15, 0.4, 'highpass');
  }

  star(i: number) {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    const f = [659.25, 783.99, 1046.5][i] ?? 1046.5;
    this.tone('triangle', f, f, t, 0.005, 0.25, 0.35);
    this.tone('sine', f * 2, f * 2, t, 0.005, 0.08, 0.3);
  }

  coin() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('square', 988, 988, t, 0.002, 0.06, 0.05);
    this.tone('square', 1319, 1319, t + 0.06, 0.002, 0.06, 0.12);
  }

  click() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    this.tone('triangle', 660, 440, t, 0.002, 0.12, 0.06);
  }

  powerUp() {
    if (!this.ok) return;
    const t = this.ctx!.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, t + i * 0.07, 0.005, 0.16, 0.15));
  }

  /* ---------------- music: 16-step loop, 124 bpm ---------------- */
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.schedTimer = window.setInterval(() => this.schedule(), 25);
  }
  stopMusic() {
    this.musicOn = false;
    if (this.schedTimer != null) clearInterval(this.schedTimer);
    this.schedTimer = null;
  }
  /** 0 = menu (muffled), 1 = gameplay */
  setMusicIntensity(v: number) {
    this.musicIntensity = v;
    if (!this.ctx) return;
    this.musicFilter.frequency.setTargetAtTime(v > 0.5 ? 9000 : 900, this.ctx.currentTime, 0.2);
  }
  private schedule() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running') return;
    const spb = 60 / 124 / 4;
    while (this.nextStepTime < ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 64;
      this.nextStepTime += spb;
    }
  }
  private playStep(step: number, t: number) {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const m = this.music;
    // kick
    if (s % 4 === 0) {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      this.env(g, t, 0.002, 0.9, 0.14);
      o.connect(g).connect(m);
      o.start(t);
      o.stop(t + 0.2);
    }
    // snare clap on 4 / 12
    if (s === 4 || s === 12) this.noiseHit(t, 1800, 0.9, 0.35, 0.12, 'bandpass', m);
    // hats
    if (s % 2 === 1) this.noiseHit(t, 8000, 1, s % 4 === 3 ? 0.12 : 0.06, 0.03, 'highpass', m);
    // bass: I - vi - IV - V in C
    const roots = [48, 45, 41, 43];
    const root = roots[bar % 4];
    const bassPat = [0, -1, 12, -1, 0, 0, 12, -1, 0, -1, 12, 0, -1, 0, 12, 7];
    const b = bassPat[s];
    if (b >= 0) {
      const f = 440 * Math.pow(2, (root + b - 69) / 12);
      this.tone('square', f, f * 0.98, t, 0.004, 0.11, 0.1, m);
    }
    // lead arp only at gameplay intensity
    if (this.musicIntensity > 0.5 && (s === 0 || s === 3 || s === 6 || s === 10 || s === 13)) {
      const chord = [0, 4, 7, 12, 16];
      const n = root + 24 + chord[(s + bar) % chord.length];
      const f = 440 * Math.pow(2, (n - 69) / 12);
      this.tone('triangle', f, f, t, 0.005, 0.07, 0.16, m);
    }
  }
}

export const audio = new AudioEngine();
