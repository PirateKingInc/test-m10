/**
 * Pluggable analytics bus. Default sink = console. Add sinks with addSink()
 * (e.g. a fetch() beacon, GameAnalytics, Poki's own measure call).
 */
export type AnalyticsSink = (name: string, data: Record<string, unknown>, t: number) => void;

export interface LoggedEvent {
  name: string;
  data: Record<string, unknown>;
  t: number;
}

class Analytics {
  private sinks: AnalyticsSink[] = [];
  readonly history: LoggedEvent[] = [];
  readonly counts: Record<string, number> = {};
  readonly start = performance.now();
  private listeners: ((e: LoggedEvent) => void)[] = [];

  addSink(s: AnalyticsSink) {
    this.sinks.push(s);
  }
  onEvent(fn: (e: LoggedEvent) => void) {
    this.listeners.push(fn);
  }
  /** seconds since page start */
  now(): number {
    return (performance.now() - this.start) / 1000;
  }
  track(name: string, data: Record<string, unknown> = {}) {
    const t = Math.round(this.now() * 100) / 100;
    const e = { name, data, t };
    this.history.push(e);
    if (this.history.length > 200) this.history.shift();
    this.counts[name] = (this.counts[name] || 0) + 1;
    for (const s of this.sinks) {
      try {
        s(name, data, t);
      } catch {
        /* a broken sink must never break the game */
      }
    }
    for (const l of this.listeners) l(e);
  }
}

export const analytics = new Analytics();

export const consoleSink: AnalyticsSink = (name, data, t) => {
  // eslint-disable-next-line no-console
  console.log(`%c[analytics] %c${name}`, 'color:#888', 'color:#2a9d8f;font-weight:bold', { t, ...data });
};
