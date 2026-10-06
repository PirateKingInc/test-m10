import './ui/styles.css';
import { applyConfigOverrides, CONFIG } from './config';
import { analytics, consoleSink } from './core/analytics';
import { audio } from './core/audio';
import { loadSave } from './core/save';
import { ads } from './core/sdk';
import { Game } from './game/game';
import { UI } from './ui/ui';
import { mountDebug } from './ui/debug';

async function boot() {
  const t0 = performance.now();
  const params = new URLSearchParams(location.search);
  const debug = params.get('debug') === '1';
  const overrides = debug || params.has('tune') ? applyConfigOverrides(location.search) : [];
  // console logging only in dev / ?debug=1 — production builds stay quiet (add a real sink for live data)
  if ((import.meta.env.DEV || debug) && params.get('analytics') !== 'off') analytics.addSink(consoleSink);

  // SDK first (mock is instant; real Poki SDK loads in parallel with our parse)
  const sdkReady = ads.init();
  ads.onAdStart = () => audio.setAdMuted(true);
  ads.onAdEnd = () => audio.setAdMuted(false);

  const save = loadSave();
  save.stats.sessions++;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const thumb = params.has('thumb');
  const game = new Game(canvas, save, { offline: thumb });
  game.ui = new UI(game);
  if (thumb) {
    // promo thumbnails: stage scenes, render, hand PNG data URLs to scripts/thumbnails.mjs
    document.getElementById('ui')!.style.display = 'none';
    document.getElementById('boot')?.remove();
    const { renderThumbnails } = await import('./game/thumbnail');
    const sizes = (params.get('sizes') || '512,1080').split(',').map(Number);
    const only = params.get('variants')?.split(',');
    (window as any).__thumbs = renderThumbnails(game, sizes, only);
    return;
  }
  game.boot();
  if (debug) {
    mountDebug(game, overrides);
    (window as any).__game = game;
    (window as any).__cfg = CONFIG;
  }

  // show the game on its first frame; never make the player wait on the ad SDK
  requestAnimationFrame(() => {
    const boot = document.getElementById('boot');
    if (boot) {
      boot.style.opacity = '0';
      setTimeout(() => boot.remove(), 260);
    }
  });

  await sdkReady;
  ads.loadingFinished(); // queued gameplayStart (if the player already tapped) fires here
  analytics.track('load_complete', { ms: Math.round(performance.now() - t0), sinceNav: Math.round(performance.now()), mock: ads.isMock, sessions: save.stats.sessions });

  // audio unlock on any gesture, anywhere
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });

  let sessionSent = false;
  window.addEventListener('pagehide', () => {
    if (sessionSent) return;
    sessionSent = true;
    analytics.track('session_length', { seconds: Math.round(analytics.now()), rounds: save.stats.rounds, reason: 'pagehide' });
  });
}

boot();
