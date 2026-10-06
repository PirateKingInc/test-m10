import { CONFIG, UpgradeId } from '../config';

const KEY = 'junkmagnet.save.v1';

export interface SaveData {
  v: 1;
  coins: number;
  upgrades: Record<UpgradeId, number>;
  /** rewarded "get this upgrade free" used, keyed `${upgrade}:${tier}` */
  freeUpgradeUsed: Record<string, boolean>;
  ownedSkins: string[];
  skin: string;
  stars: Record<string, number>; // levelId -> best stars
  bestScore: Record<string, number>; // modeKey -> best score
  bestPct: Record<string, number>; // levelId -> best % cleaned
  bestCombo: Record<string, number>; // modeKey -> longest combo chain
  daily: { date: string; completed: boolean; best: number };
  muted: boolean;
  stats: { rounds: number; playSeconds: number; sessions: number };
}

function defaults(): SaveData {
  return {
    v: 1,
    coins: CONFIG.economy.startCoins,
    upgrades: { magnet: 0, speed: 0, time: 0 },
    freeUpgradeUsed: {},
    ownedSkins: ['classic'],
    skin: 'classic',
    stars: {},
    bestScore: {},
    bestPct: {},
    bestCombo: {},
    daily: { date: '', completed: false, best: 0 },
    muted: false,
    stats: { rounds: 0, playSeconds: 0, sessions: 0 },
  };
}

function merge(base: any, over: any): any {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out: any = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    const b = base?.[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, over[k]) : over[k];
  }
  return out;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return defaults(); // future: migrations go here
    return merge(defaults(), parsed);
  } catch {
    return defaults();
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full / disabled (private mode, iframe policy) — play on without saving */
  }
}

export function resetSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
