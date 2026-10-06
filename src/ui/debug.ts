/** ?debug=1 overlay: live game stats, analytics counters and the latest events. */
import { analytics } from '../core/analytics';
import type { Game } from '../game/game';

export function mountDebug(game: Game, overrides: string[]) {
  const el = document.createElement('div');
  el.id = 'debug';
  document.body.appendChild(el);
  const render = () => {
    const s = game.debugStats();
    const stats = Object.entries(s)
      .map(([k, v]) => `${k.padEnd(9)}${v}`)
      .join('\n');
    const counts = Object.entries(analytics.counts)
      .map(([k, v]) => `${k}:${v}`)
      .join('  ');
    const recent = analytics.history
      .slice(-8)
      .map((e) => `${e.t.toFixed(1).padStart(6)} ${e.name} ${shortData(e.data)}`)
      .join('\n');
    el.textContent = `JUNK MAGNET debug\n${stats}\n— overrides: ${overrides.join(', ') || 'none'}\n— counts\n${wrap(counts)}\n— events\n${recent}`;
  };
  setInterval(render, 250);
  render();
}

function shortData(d: Record<string, unknown>) {
  const s = JSON.stringify(d);
  return s.length > 60 ? s.slice(0, 57) + '…' : s === '{}' ? '' : s;
}
function wrap(s: string) {
  return s.replace(/(.{1,48})(\s|$)/g, '$1\n').trim();
}
