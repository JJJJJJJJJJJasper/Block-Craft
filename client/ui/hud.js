// ============================================================================
// Heads-up display: hotbar, hearts, hunger, item name popup, debug overlay,
// damage flash, toasts and the player list.
// ============================================================================
import { renderSlot, itemName } from './inventory.js';
import { MAX_HEALTH, MAX_HUNGER } from '../../shared/config.js';

const $ = (id) => document.getElementById(id);

/** Draw a 9x9 pixel-art icon from rows of characters into a data URL. */
function pixelIcon(rows, palette) {
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (palette[ch]) { ctx.fillStyle = palette[ch]; ctx.fillRect(x, y, 1, 1); }
  }));
  return c.toDataURL();
}

const HEART = ['.kk...kk.', 'krrk.krrk', 'krwrrrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....', '.........'];
const DRUM = ['.....kkk.', '....kbbbk', '...kbbbbk', '..kbbbbbk', '.kbbbbk..', 'kwkbbk...', 'kwwkk....', '.kk......', '.........'];
function icons() {
  const full = { k: '#2a0000', r: '#e02020', w: '#ff9a9a' };
  const empty = { k: '#2a0000', r: '#3b1b1b', w: '#3b1b1b' };
  const half = (rows, a, b) => {
    // left half full colours, right half empty
    const c = document.createElement('canvas'); c.width = c.height = 9;
    const ctx = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const p = x < 4 ? a : b;
      if (p[ch]) { ctx.fillStyle = p[ch]; ctx.fillRect(x, y, 1, 1); }
    }));
    return c.toDataURL();
  };
  const dFull = { k: '#2a1600', b: '#b5652c', w: '#efe8d8' };
  const dEmpty = { k: '#2a1600', b: '#3a2a1a', w: '#4a4030' };
  return {
    heart: [pixelIcon(HEART, empty), half(HEART, full, empty), pixelIcon(HEART, full)],
    drum: [pixelIcon(DRUM, dEmpty), half(DRUM, dEmpty, dFull), pixelIcon(DRUM, dFull)],
  };
}

export class Hud {
  constructor(iconURL) {
    this.iconURL = iconURL;
    this.root = $('hud');
    this.hotbar = $('hotbar');
    this.slots = [];
    for (let i = 0; i < 9; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      this.hotbar.appendChild(el);
      this.slots.push(el);
    }
    this.icons = icons();
    this.heartImgs = this._row($('hearts'), 10);
    this.hungerImgs = this._row($('hunger'), 10);
    this.lastInvVersion = -1;
    this.lastSelected = -1;
    this.lastStats = '';
    this.itemNameTimer = 0;
    this.toastTimer = 0;
  }

  _row(parent, n) {
    const out = [];
    for (let i = 0; i < n; i++) { const img = document.createElement('img'); parent.appendChild(img); out.push(img); }
    return out;
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  update(dt, inv, player, mode) {
    if (inv.version !== this.lastInvVersion || inv.selected !== this.lastSelected) {
      for (let i = 0; i < 9; i++) {
        renderSlot(this.slots[i], inv.slots[i], this.iconURL);
        this.slots[i].classList.toggle('selected', i === inv.selected);
      }
      if (inv.selected !== this.lastSelected && inv.held) this.flashItemName(itemName(inv.held.id));
      this.lastInvVersion = inv.version;
      this.lastSelected = inv.selected;
    }
    const survival = mode === 'survival';
    $('stats').classList.toggle('hidden', !survival);
    if (survival) {
      const key = `${Math.ceil(player.health)}:${player.hunger}`;
      if (key !== this.lastStats) {
        this.lastStats = key;
        this._fill(this.heartImgs, Math.ceil(player.health), MAX_HEALTH, this.icons.heart);
        this._fill(this.hungerImgs, player.hunger, MAX_HUNGER, this.icons.drum);
      }
    }
    $('mode-badge').textContent = mode === 'creative' ? 'Creative' + (player.flying ? ' · flying' : '') : 'Survival';
    if (this.itemNameTimer > 0) { this.itemNameTimer -= dt; if (this.itemNameTimer <= 0) $('item-name').style.opacity = 0; }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) $('toast').style.opacity = 0; }
    $('damage-flash').style.opacity = player.hurtTime > 0 ? Math.min(1, player.hurtTime * 3) : 0;
  }

  // Each icon is worth 2 points: full, half, or empty.
  _fill(imgs, value, max, set) {
    for (let i = 0; i < imgs.length; i++) {
      const v = value - i * 2;
      const src = v >= 2 ? set[2] : v === 1 ? set[1] : set[0];
      if (imgs[i].src !== src) imgs[i].src = src;
    }
  }

  flashItemName(text) {
    const el = $('item-name');
    el.textContent = text;
    el.style.opacity = 1;
    this.itemNameTimer = 1.8;
  }

  toast(text, seconds = 2.5) {
    const el = $('toast');
    el.textContent = text;
    el.style.opacity = 1;
    this.toastTimer = seconds;
  }

  setDebug(visible, text) {
    const el = $('debug');
    el.classList.toggle('hidden', !visible);
    if (visible) el.textContent = text;
  }

  setNetBanner(visible) { $('net-banner').classList.toggle('hidden', !visible); }

  showPlayerList(visible, players, hostId, ping) {
    const el = $('player-list');
    el.classList.toggle('hidden', !visible);
    if (!visible) return;
    el.innerHTML = `<div><b>Players online (${players.length})</b> <span class="small">ping ${ping} ms</span></div>` +
      players.map(p => `<div class="p ${p.id === hostId ? 'host' : ''}">${p.id === hostId ? '★ ' : ''}${escapeHtml(p.name)}</div>`).join('');
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
