/** ?debug=1 overlay: live game stats (local only; nothing is recorded or sent). */
import type { Game } from '../game/game';

export function mountDebug(game: Game, overrides: string[]) {
  const style = document.createElement('style');
  style.textContent =
    '#debug{position:fixed;left:4px;bottom:4px;z-index:50;background:rgba(0,0,0,.72);color:#9fffb0;font:11px/1.35 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:6px;max-width:330px;pointer-events:none;white-space:pre}';
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'debug';
  document.body.appendChild(el);
  const render = () => {
    const s = game.dev!.stats();
    const stats = Object.entries(s)
      .map(([k, v]) => `${k.padEnd(9)}${v}`)
      .join('\n');
    el.textContent = `JUNK MAGNET debug\n${stats}\n— overrides: ${overrides.join(', ') || 'none'}`;
  };
  setInterval(render, 250);
  render();
}
