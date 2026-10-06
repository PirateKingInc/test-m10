import './ui/styles.css';
import { applyConfigOverrides } from './config';
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
  if (params.get('analytics') !== 'off') analytics.addSink(consoleSink);

  // SDK first (mock is instant; real Poki SDK loads in parallel with our parse)
  const sdkReady = ads.init();
  ads.onAdStart = () => audio.setAdMuted(true);
  ads.onAdEnd = () => audio.setAdMuted(false);

  const save = loadSave();
  save.stats.sessions++;
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const game = new Game(canvas, save);
  game.ui = new UI(game);
  game.boot();
  if (debug) {
    mountDebug(game, overrides);
    (window as any).__game = game;
  }

  await sdkReady;
  ads.loadingFinished();
  const boot = document.getElementById('boot');
  if (boot) {
    boot.style.opacity = '0';
    setTimeout(() => boot.remove(), 260);
  }
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
