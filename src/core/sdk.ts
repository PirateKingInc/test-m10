/**
 * Poki SDK v2 wrapper + local mock.
 *  - On a Poki host (or ?sdk=poki) the real SDK script is loaded.
 *  - Elsewhere a mock with visible fake ad overlays is used.
 *    ?adfail=1 makes every rewarded ad fail (tests the "no reward" path).
 * The wrapper guarantees: no duplicate gameplayStart/Stop, gameplay is stopped
 * before any ad, and game audio is muted for the whole ad.
 */
import { analytics } from './analytics';

interface PokiLike {
  init(): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(opts?: RewardedOpts): Promise<boolean>;
  setDebug?(v: boolean): void;
}

export type RewardSize = 'small' | 'medium' | 'large';
interface RewardedOpts {
  size?: RewardSize;
  onStart?: () => void;
}

declare global {
  interface Window {
    PokiSDK?: PokiLike;
  }
}

const POKI_SRC = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

function loadScript(src: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => resolve(false), timeoutMs);
    s.src = src;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    document.head.appendChild(s);
  });
}

/** Mock that behaves like Poki: frequency-capped commercials, rewarded with visible overlay. */
class MockPoki implements PokiLike {
  private lastCommercial = -Infinity;
  constructor(private failRewarded: boolean, private commercialCooldown = 45) {}
  async init() {}
  gameLoadingFinished() {
    console.info('[PokiSDK mock] gameLoadingFinished');
  }
  gameplayStart() {
    console.info('[PokiSDK mock] gameplayStart');
  }
  gameplayStop() {
    console.info('[PokiSDK mock] gameplayStop');
  }
  async commercialBreak(onStart?: () => void) {
    const now = performance.now() / 1000;
    if (now - this.lastCommercial < this.commercialCooldown) {
      console.info('[PokiSDK mock] commercialBreak -> skipped (frequency cap, Poki decides)');
      return;
    }
    this.lastCommercial = now;
    onStart?.();
    console.info('[PokiSDK mock] commercialBreak -> showing ad');
    await this.overlay('Commercial break (mock)', 1.2, false);
  }
  async rewardedBreak(opts?: RewardedOpts) {
    opts?.onStart?.();
    const ok = await this.overlay('Rewarded ad (mock)', 2.0, true);
    this.lastCommercial = performance.now() / 1000; // Poki resets the commercial timer after rewarded
    return ok && !this.failRewarded;
  }
  private overlay(label: string, seconds: number, skippable: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const el = document.createElement('div');
      el.className = 'mock-ad';
      el.innerHTML = `<div class="mock-ad-box"><div class="mock-ad-title">📺 ${label}</div>
        <div class="mock-ad-count"></div>${skippable ? '<button class="mock-ad-close">✕ close (no reward)</button>' : ''}</div>`;
      document.body.appendChild(el);
      const count = el.querySelector('.mock-ad-count') as HTMLElement;
      let left = seconds;
      const tick = () => {
        count.textContent = `${left.toFixed(1)}s`;
      };
      tick();
      const iv = setInterval(() => {
        left = Math.max(0, left - 0.1);
        tick();
        if (left <= 0) done(true);
      }, 100);
      const done = (ok: boolean) => {
        clearInterval(iv);
        el.remove();
        resolve(ok);
      };
      el.querySelector('.mock-ad-close')?.addEventListener('click', () => done(false));
    });
  }
}

/**
 * Used on a Poki host when the real SDK could not load (network/adblock). Never shows
 * fake ad UI there: commercials resolve instantly, rewarded ads report "no reward".
 */
class NoopPoki implements PokiLike {
  async init() {}
  gameLoadingFinished() {}
  gameplayStart() {}
  gameplayStop() {}
  async commercialBreak() {}
  async rewardedBreak() {
    return false;
  }
}

export class Ads {
  private sdk: PokiLike = new MockPoki(false);
  isMock = true;
  private inGameplay = false;
  private adRunning = false;
  /** hooks: mute / unmute game audio, pause rendering if wanted */
  onAdStart: () => void = () => {};
  onAdEnd: () => void = () => {};

  async init(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const onPoki = /poki/.test(location.hostname) || params.get('sdk') === 'poki';
    if (onPoki) {
      const ok = !!window.PokiSDK || (await loadScript(POKI_SRC, 6000));
      if (ok && window.PokiSDK) {
        this.sdk = window.PokiSDK;
        this.isMock = false;
      } else {
        console.warn('[ads] Poki SDK unavailable — running without ads');
        this.sdk = new NoopPoki();
        this.isMock = false;
      }
    } else {
      this.sdk = new MockPoki(params.get('adfail') === '1', Number(params.get('adcooldown') ?? 45));
    }
    try {
      await this.sdk.init();
    } catch {
      // ad blocker: Poki still lets the game run
      console.warn('[ads] init rejected (adblock?) — continuing');
    }
    if (params.get('debug') === '1') this.sdk.setDebug?.(true);
  }

  private loaded = false;
  private pendingStart = false;

  loadingFinished() {
    try {
      this.sdk.gameLoadingFinished();
    } catch {
      /* ignore */
    }
    this.loaded = true;
    if (this.pendingStart) {
      this.pendingStart = false;
      this.gameplayStart();
    }
  }

  gameplayStart() {
    if (!this.loaded) {
      this.pendingStart = true; // player tapped before the SDK finished loading
      return;
    }
    if (this.inGameplay || this.adRunning) return;
    this.inGameplay = true;
    try {
      this.sdk.gameplayStart();
    } catch {
      /* ignore */
    }
  }

  gameplayStop() {
    this.pendingStart = false;
    if (!this.inGameplay) return;
    this.inGameplay = false;
    try {
      this.sdk.gameplayStop();
    } catch {
      /* ignore */
    }
  }

  get busy() {
    return this.adRunning;
  }

  /** Natural break (before every gameplayStart after the first). Poki decides if an ad shows. */
  async commercialBreak(): Promise<void> {
    if (this.adRunning) return;
    this.gameplayStop();
    this.adRunning = true;
    this.onAdStart();
    analytics.track('commercial_break');
    try {
      await this.sdk.commercialBreak(() => {});
    } catch {
      /* ignore */
    } finally {
      this.adRunning = false;
      this.onAdEnd();
    }
  }

  /** Returns true ONLY if the SDK confirms the reward. */
  async rewardedBreak(placement: string, size: RewardSize = 'medium'): Promise<boolean> {
    if (this.adRunning) return false;
    const wasPlaying = this.inGameplay;
    this.gameplayStop();
    this.adRunning = true;
    this.onAdStart();
    analytics.track('rewarded_accepted', { placement });
    let ok = false;
    try {
      ok = (await this.sdk.rewardedBreak({ size, onStart: () => {} })) === true;
    } catch {
      ok = false;
    } finally {
      this.adRunning = false;
      this.onAdEnd();
    }
    analytics.track(ok ? 'rewarded_completed' : 'rewarded_failed', { placement });
    if (wasPlaying) this.gameplayStart();
    return ok;
  }
}

export const ads = new Ads();

/** Rewarded offer bookkeeping: call shown() when the button becomes visible. */
const shownThisScreen = new Set<string>();
export function rewardedOfferShown(placement: string) {
  if (shownThisScreen.has(placement)) return;
  shownThisScreen.add(placement);
  analytics.track('rewarded_offer_shown', { placement });
}
export function resetOfferScreen() {
  shownThisScreen.clear();
}
