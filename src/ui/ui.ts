/**
 * DOM overlay: HUD (no buttons during gameplay), hint, toasts, end screen hub,
 * Garage (upgrades + skins) and Modes panels. Rewarded offers are buttons that
 * only grant after ads.rewardedBreak() resolves true.
 */
import { CONFIG, UPGRADE_IDS, UpgradeId } from '../config';
import { audio } from '../core/audio';
import { todayKey } from '../core/rng';
import { ads, resetOfferScreen, rewardedOfferShown, RewardSize } from '../core/sdk';
import type { Game, ModeSpec, Results } from '../game/game';
import { dailySetup, LEVELS } from '../game/levels';
import { hashString } from '../core/rng';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

type Screen = 'end' | 'garage' | 'modes';

/** Poki reward "size" per placement (bigger = more valuable, Poki may show longer ads). */
const REWARD_SIZE: Record<string, RewardSize> = {
  mega_magnet: 'medium',
  extra_time: 'medium',
  triple_coins: 'medium',
  upgrade_free: 'large',
  skin_try: 'small',
  continue_run: 'large',
};

export class UI {
  private root: HTMLElement;
  private hud: HTMLElement;
  private timeEl: HTMLElement;
  private fill: HTMLElement;
  private progress: HTMLElement;
  private rushEl: HTMLElement;
  private goalEl: HTMLElement;
  private megaEl: HTMLElement;
  private hint: HTMLElement;
  private toasts: HTMLElement;
  private comboEl: HTMLElement;
  private timeupEl: HTMLElement;
  private panel: HTMLElement;
  screen: Screen | null = null;
  private busy = false;
  private last = { time: '', pct: -1, score: -1, mega: '-', goal: '-', urgent: false };
  private comboTimer = 0;
  private arrow: HTMLElement;
  private arrowOn = false;
  /** banner-safe insets in px (read from CSS vars) */
  insetTop = 0;
  insetBottom = 0;

  constructor(private game: Game) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="hud-top">
          <div class="timer"><span class="t-ico">⏱</span><span id="time">90</span></div>
          <div class="progress" id="progress"><div class="fill" id="fill"></div></div>
          <div class="rush" id="rush"></div>
          <div class="goal" id="goal"></div>
        </div>
        <div class="mega" id="mega"></div>
      </div>
      <div id="hint" class="hidden"><div class="hint-track"><div class="hand">👆</div></div><div class="hint-text">Drag to steer</div></div>
      <div id="arrow" class="hidden"><div class="arrow-in">➤</div></div>
      <div id="toasts"></div>
      <div id="combo"></div>
      <div id="timeup">TIME!</div>
      <div id="panel" class="hidden"></div>`;
    this.hud = $('#hud');
    this.timeEl = $('#time');
    this.fill = $('#fill');
    this.progress = $('#progress');
    this.rushEl = $('#rush');
    this.goalEl = $('#goal');
    this.megaEl = $('#mega');
    this.hint = $('#hint');
    this.toasts = $('#toasts');
    this.comboEl = $('#combo');
    this.timeupEl = $('#timeup');
    this.panel = $('#panel');
    this.arrow = $('#arrow');
    const readInsets = () => {
      const cs = getComputedStyle(document.documentElement);
      this.insetTop = parseFloat(cs.getPropertyValue('--safe-top')) || 0;
      this.insetBottom = parseFloat(cs.getPropertyValue('--safe-bottom')) || 0;
    };
    readInsets();
    window.addEventListener('resize', readInsets);
    this.panel.addEventListener('click', (e) => this.onClick(e));
    // block canvas steering through panels
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /* ---------------- HUD ---------------- */
  showHud(v: boolean) {
    this.hud.classList.toggle('hidden', !v);
  }
  showHint(v: boolean) {
    this.hint.classList.toggle('hidden', !v);
  }

  roundStarted() {
    const g = this.game;
    const isRush = g.mode.kind === 'rush';
    this.progress.style.display = isRush ? 'none' : '';
    this.rushEl.style.display = isRush ? '' : 'none';
    this.progress.querySelectorAll('.tick').forEach((t) => t.remove());
    if (!isRush) {
      g.level.stars.forEach((s, i) => {
        const t = document.createElement('i');
        t.className = 'tick';
        t.style.left = `${s * 100}%`;
        t.textContent = '★';
        t.dataset.i = String(i);
        this.progress.appendChild(t);
      });
    }
    this.last = { time: '', pct: -1, score: -1, mega: '-', goal: '-', urgent: false };
    this.timeupEl.classList.remove('on');
  }

  updateHud(g: Game) {
    const t = Math.ceil(g.timeLeft).toString();
    if (t !== this.last.time) {
      this.last.time = t;
      this.timeEl.textContent = t;
    }
    const urgent = g.timerRunning && g.timeLeft <= CONFIG.round.warnAt;
    if (urgent !== this.last.urgent) {
      this.last.urgent = urgent;
      this.hud.classList.toggle('urgent', urgent);
    }
    if (g.mode.kind === 'rush') {
      if (g.score !== this.last.score) {
        this.last.score = g.score;
        const best = g.save.bestScore.rush ?? 0;
        this.rushEl.innerHTML = `<b>${g.score.toLocaleString()}</b><small>BEST ${Math.max(best, 0).toLocaleString()}</small>`;
        this.rushEl.classList.toggle('beat', best > 0 && g.score > best);
      }
    } else {
      const p = Math.round(g.pct() * 1000) / 10;
      if (p !== this.last.pct) {
        this.last.pct = p;
        this.fill.style.width = `${Math.min(100, p)}%`;
        this.progress.querySelectorAll<HTMLElement>('.tick').forEach((tk) => {
          tk.classList.toggle('got', g.pct() >= g.level.stars[Number(tk.dataset.i)]);
        });
      }
    }
    let goal = '';
    if (g.dailyGoal) {
      const d = g.dailyGoal;
      goal = d.kind === 'pct' ? `DAILY: ${d.text}` : `DAILY: ${d.text} (${Math.min(d.target, g.tierLifted[d.tier!])}/${d.target})`;
    }
    if (goal !== this.last.goal) {
      this.last.goal = goal;
      this.goalEl.textContent = goal;
      this.goalEl.style.display = goal ? '' : 'none';
    }
    const a = g.assist.arrowScreen;
    if (!!a !== this.arrowOn) {
      this.arrowOn = !!a;
      this.arrow.classList.toggle('hidden', !a);
    }
    if (a) this.arrow.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) rotate(${a.angle}rad)`;
    const mega = g.megaLeft > 0 ? `🧲 MEGA ${Math.ceil(g.megaLeft)}` : '';
    if (mega !== this.last.mega) {
      this.last.mega = mega;
      this.megaEl.textContent = mega;
      this.megaEl.style.display = mega ? '' : 'none';
    }
  }

  private lastToast = { text: '', t: 0 };
  toast(text: string) {
    const now = performance.now();
    if (text === this.lastToast.text && now - this.lastToast.t < 1200) return;
    this.lastToast = { text, t: now };
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => el.remove(), 1400);
  }

  combo(n: number) {
    this.comboEl.textContent = `x${n} COMBO!`;
    this.comboEl.classList.remove('pop');
    void this.comboEl.offsetWidth; // restart animation
    this.comboEl.classList.add('pop');
    this.comboEl.style.setProperty('--hue', String((n * 23) % 360));
    clearTimeout(this.comboTimer);
    this.comboTimer = window.setTimeout(() => this.comboEl.classList.remove('pop'), 700);
  }

  timeBonus() {
    this.timeEl.parentElement!.classList.remove('bonus');
    void this.timeEl.offsetWidth;
    this.timeEl.parentElement!.classList.add('bonus');
  }

  timeUp() {
    this.timeupEl.textContent = this.game.mode.kind === 'rush' ? 'RUN OVER!' : this.game.clearedEarly ? 'CLEARED!' : 'TIME!';
    this.timeupEl.classList.add('on');
    this.showHint(false);
  }

  hidePanels() {
    this.panel.classList.add('hidden');
    this.panel.innerHTML = '';
    this.screen = null;
    this.timeupEl.classList.remove('on');
  }

  /* ---------------- End screen ---------------- */
  showEnd(r: Results) {
    this.timeupEl.classList.remove('on');
    this.showHud(false);
    this.screen = 'end';
    resetOfferScreen();
    this.renderEnd(r, true);
  }

  private stars(n: number, animate: boolean) {
    return `<div class="stars">${[0, 1, 2].map((i) => `<span class="star ${i < n ? 'on' : ''} ${animate && i < n ? 'anim' : ''}" style="animation-delay:${0.15 + i * 0.22}s">★</span>`).join('')}</div>`;
  }

  private renderEnd(r: Results, animate: boolean) {
    const g = this.game;
    const isRush = r.mode.kind === 'rush';
    const nextDef = LEVELS.find((l) => l.id === r.nextMode.levelId);
    const playLabel = r.unlocked ? `▶ PLAY ${nextDef?.name.toUpperCase()}` : '▶ PLAY AGAIN';
    const main = isRush
      ? `<div class="big">${r.score.toLocaleString()}<small>score</small></div>`
      : `<div class="big">${Math.round(r.pct * 100)}%<small>cleaned</small></div>`;
    const bestLine = isRush || r.mode.kind === 'daily' ? `Best ${r.best.toLocaleString()}` : `Score ${r.score.toLocaleString()} · Best ${Math.round(r.best * 100)}%`;
    const extraLabel = isRush ? `🎬 Continue run (+${CONFIG.rewarded.continueRunTime}s)` : `🎬 +${CONFIG.rewarded.extraTime} seconds`;
    this.panel.innerHTML = `
      <div class="card end">
        <div class="card-head"><div class="title">${r.title}</div>${this.muteBtn()}</div>
        ${this.stars(r.stars, animate)}
        ${main}
        <div class="sub">${bestLine}${r.newBest ? ' <span class="newbest">NEW BEST!</span>' : ''}</div>
        <div class="sub small">${r.lifted} pieces lifted · best combo x${r.maxCombo}</div>
        ${r.dailyJustDone ? `<div class="banner">🎉 DAILY COMPLETE +${CONFIG.economy.dailyReward} 🪙</div>` : ''}
        ${r.unlocked ? `<div class="banner">🔓 NEW LEVEL: ${nextDef?.name}!</div>` : ''}
        <div class="coins">+${r.coinsEarned} 🪙 <span>${r.coinsTotal}</span></div>
        <div class="goals">${r.goals.map((t) => `<div class="goal-line">${t}</div>`).join('')}</div>
        <button class="btn play" data-a="play">${playLabel}</button>
        <div class="row">
          ${r.canExtraTime ? `<button class="btn ad" data-ad="${isRush ? 'continue_run' : 'extra_time'}">${extraLabel}</button>` : ''}
          ${r.canTriple ? `<button class="btn ad" data-ad="triple_coins">🎬 x${CONFIG.rewarded.tripleCoins} coins</button>` : ''}
        </div>
        <button class="btn ad wide mega-offer" data-ad="mega_magnet">🎬 Next round with MEGA MAGNET 🧲</button>
        <div class="row nav">
          <button class="btn nav-btn" data-a="garage">🛠️ Garage${this.affordable() ? '<i class="dot"></i>' : ''}</button>
          <button class="btn nav-btn" data-a="modes">🗺️ Modes${!g.save.daily.completed || g.save.daily.date !== todayKey() ? '<i class="dot"></i>' : ''}</button>
        </div>
      </div>`;
    this.panel.classList.remove('hidden');
    this.markOffers();
    if (animate) {
      for (let i = 0; i < r.stars; i++) setTimeout(() => audio.star(i), 150 + i * 220);
      setTimeout(() => audio.coin(), 200 + r.stars * 220);
    }
  }

  private affordable() {
    const s = this.game.save;
    return UPGRADE_IDS.some((id) => s.upgrades[id] < CONFIG.upgrades[id].maxLevel && s.coins >= CONFIG.upgrades[id].costs[s.upgrades[id]]);
  }

  private muteBtn() {
    return `<button class="icon-btn" data-a="mute" aria-label="mute">${this.game.save.muted ? '🔇' : '🔊'}</button>`;
  }

  private markOffers() {
    this.panel.querySelectorAll<HTMLElement>('[data-ad]').forEach((b) => rewardedOfferShown(b.dataset.ad!));
  }

  /* ---------------- Garage ---------------- */
  private renderGarage() {
    const s = this.game.save;
    const ups = UPGRADE_IDS.map((id) => {
      const u = CONFIG.upgrades[id];
      const lvl = s.upgrades[id];
      const max = lvl >= u.maxLevel;
      const cost = max ? 0 : u.costs[lvl];
      const freeUsed = s.freeUpgradeUsed[`${id}:${lvl}`];
      const pips = Array.from({ length: u.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `<div class="up">
        <div class="up-icon">${u.icon}</div>
        <div class="up-info"><div class="up-name">${u.name}</div><div class="pips">${pips}</div><div class="up-desc">${this.upDesc(id, lvl)}</div></div>
        <div class="up-btns">${
          max
            ? '<span class="maxed">MAX</span>'
            : `<button class="btn buy ${s.coins >= cost ? '' : 'disabled'}" data-a="buy:${id}">🪙 ${cost}</button>${freeUsed ? '' : `<button class="btn ad small" data-ad="upgrade_free" data-id="${id}">🎬 Free</button>`}`
        }</div>
      </div>`;
    }).join('');
    const skins = CONFIG.skins.map((sk) => {
      const owned = s.ownedSkins.includes(sk.id);
      const sel = s.skin === sk.id;
      const sw = `<div class="swatch" style="--a:#${sk.body.toString(16).padStart(6, '0')};--b:#${sk.cab.toString(16).padStart(6, '0')};--c:#${sk.magnet.toString(16).padStart(6, '0')}"></div>`;
      let btns = '';
      if (sel) btns = '<span class="maxed">USING</span>';
      else if (owned) btns = `<button class="btn buy" data-a="skin:${sk.id}">Use</button>`;
      else btns = `<button class="btn buy ${s.coins >= sk.cost ? '' : 'disabled'}" data-a="skinbuy:${sk.id}">🪙 ${sk.cost}</button><button class="btn ad small" data-ad="skin_try" data-id="${sk.id}">🎬 Try 1 round</button>`;
      return `<div class="up">${sw}<div class="up-info"><div class="up-name">${sk.name}</div><div class="up-desc">${sk.bigWheels ? 'Big wheels, bigger attitude' : 'The trusty original'}</div></div><div class="up-btns">${btns}</div></div>`;
    }).join('');
    this.panel.innerHTML = `
      <div class="card garage">
        <div class="card-head"><button class="icon-btn" data-a="back">←</button><div class="title">GARAGE</div><div class="wallet">🪙 ${s.coins}</div></div>
        <div class="section">Upgrades</div>${ups}
        <div class="section">Trucks</div>${skins}
        <button class="btn play" data-a="play">▶ PLAY</button>
      </div>`;
    this.panel.classList.remove('hidden');
    this.markOffers();
  }

  private upDesc(id: UpgradeId, lvl: number) {
    const u = CONFIG.upgrades[id];
    if (id === 'time') return `+${lvl * u.perLevel}s per round`;
    return `+${Math.round(lvl * u.perLevel * 100)}% ${id === 'magnet' ? 'pull radius' : 'speed'}`;
  }

  /* ---------------- Modes ---------------- */
  private renderModes() {
    const g = this.game;
    const s = g.save;
    const lv = LEVELS.map((l) => {
      const unlocked = g.isUnlocked(l.id);
      const st = s.stars[l.id] ?? 0;
      return `<button class="mode ${unlocked ? '' : 'locked'}" data-a="${unlocked ? 'mode:level:' + l.id : 'locked'}">
        <span class="m-emoji">${l.emoji}</span><span class="m-name">${l.name}<small>${unlocked ? `${'★'.repeat(st)}${'☆'.repeat(3 - st)} · best ${Math.round((s.bestPct[l.id] ?? 0) * 100)}%` : `🔒 Get ★ in ${LEVELS.find((x) => x.id === l.unlock?.level)?.name}`}</small></span></button>`;
    }).join('');
    const today = todayKey();
    const daily = dailySetup(today, hashString('daily-' + today));
    const dDone = s.daily.date === today && s.daily.completed;
    this.panel.innerHTML = `
      <div class="card modes">
        <div class="card-head"><button class="icon-btn" data-a="back">←</button><div class="title">MODES</div>${this.muteBtn()}</div>
        ${lv}
        <button class="mode rushm" data-a="mode:rush:junkyard"><span class="m-emoji">⚡</span><span class="m-name">Scrapyard Rush<small>Endless · combos add time · best ${(s.bestScore.rush ?? 0).toLocaleString()}</small></span></button>
        <button class="mode dailym" data-a="mode:daily:${daily.level.id}"><span class="m-emoji">📅</span><span class="m-name">Daily Challenge<small>${dDone ? '✅ Done today!' : `${daily.goal.text} · +${CONFIG.economy.dailyReward} 🪙`}</small></span></button>
      </div>`;
    this.panel.classList.remove('hidden');
  }

  /* ---------------- Actions ---------------- */
  private async onClick(e: Event) {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn || this.busy) return;
    audio.unlock();
    audio.click();
    const g = this.game;
    const r = g.lastResults;
    const next: ModeSpec = r?.nextMode ?? g.mode;
    const ad = btn.dataset.ad;
    if (ad) {
      if (ads.busy) return;
      this.busy = true;
      this.panel.classList.add('busy');
      const ok = await ads.rewardedBreak(ad, REWARD_SIZE[ad] ?? 'medium');
      this.busy = false;
      this.panel.classList.remove('busy');
      if (!ok) {
        this.toast('No reward this time — try again later');
        return;
      }
      this.grant(ad, btn.dataset.id, next);
      return;
    }
    const a = btn.dataset.a ?? '';
    if (a === 'play') g.startRound(next);
    else if (a === 'garage') {
      this.screen = 'garage';
      this.renderGarage();
    } else if (a === 'modes') {
      this.screen = 'modes';
      this.renderModes();
    } else if (a === 'back') {
      this.screen = 'end';
      if (r) this.renderEnd(r, false);
    } else if (a === 'mute') {
      g.setMuted(!g.save.muted);
      btn.textContent = g.save.muted ? '🔇' : '🔊';
    } else if (a.startsWith('buy:')) {
      if (g.buyUpgrade(a.slice(4) as UpgradeId, false)) this.refreshGarage();
      else this.toast('Not enough coins yet');
    } else if (a.startsWith('skinbuy:')) {
      if (g.buySkin(a.slice(8))) this.refreshGarage();
      else this.toast('Not enough coins yet');
    } else if (a.startsWith('skin:')) {
      g.selectSkin(a.slice(5));
      this.refreshGarage();
    } else if (a.startsWith('mode:')) {
      const [, kind, levelId] = a.split(':');
      g.startRound({ kind: kind as ModeSpec['kind'], levelId });
    } else if (a === 'locked') this.toast('Earn a star in the Junkyard to unlock!');
  }

  private refreshGarage() {
    if (this.game.lastResults) this.game.lastResults.coinsTotal = this.game.save.coins;
    this.renderGarage();
  }

  private grant(placement: string, id: string | undefined, next: ModeSpec) {
    const g = this.game;
    const r = g.lastResults;
    switch (placement) {
      case 'extra_time':
      case 'continue_run':
        g.grantExtraTime();
        break;
      case 'triple_coins': {
        const extra = g.grantTriple();
        if (r) {
          r.coinsEarned += extra;
          r.coinsTotal = g.save.coins;
          r.canTriple = false;
          this.renderEnd(r, false);
        }
        this.toast(`+${extra} 🪙`);
        break;
      }
      case 'mega_magnet':
        g.startRound(next, { mega: true });
        break;
      case 'upgrade_free':
        if (id && g.buyUpgrade(id as UpgradeId, true)) this.toast('Upgrade unlocked!');
        this.refreshGarage();
        break;
      case 'skin_try':
        if (id) g.startRound(next, { trySkin: id });
        break;
    }
  }
}
