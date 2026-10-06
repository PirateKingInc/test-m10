/** ?debug=1 overlay: live game stats (local only; nothing is recorded or sent). */
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
    el.textContent = `JUNK MAGNET debug\n${stats}\n— overrides: ${overrides.join(', ') || 'none'}`;
  };
  setInterval(render, 250);
  render();
}
