// ============================================================================
// Inventory data + the inventory / crafting table / furnace / creative screens.
//
// A stack is {id, count, dmg} (dmg = wear) or null.
// Slot layout:  0-8 hotbar, 9-35 main inventory,
//               36 helmet, 37 chestplate, 38 leggings, 39 boots, 40 off-hand.
//
// Mouse controls inside the screens (same as most block games):
//   left click   pick up / put down / swap / merge a whole stack
//   right click  pick up half / put down one
//   shift+click  move the stack to the other section (armor goes to its slot)
// ============================================================================
import { ITEMS, maxStack, ARMOR_PIECES } from '../../shared/items.js';
import { matchRecipe } from '../../shared/recipes.js';
import { BLOCKS } from '../../shared/blocks.js';
import { silhouetteURL } from '../rendering/textures.js';
import { drawPlayerPreview } from '../rendering/skin.js';

export const ARMOR_SLOT = 36;   // first armor slot
export const OFFHAND_SLOT = 40;
export const SLOT_COUNT = 41;

export class Inventory {
  constructor() {
    this.slots = new Array(SLOT_COUNT).fill(null);
    this.selected = 0;
    this.version = 0; // bumps on every change, so the HUD/server sync know to update
  }
  get held() { return this.slots[this.selected]; }
  get heldId() { return this.held ? this.held.id : 0; }
  touch() { this.version++; }

  /** Add a stack to the hotbar/main slots; returns how many items did NOT fit. */
  add(stack) {
    let left = stack.count;
    const max = maxStack(stack.id);
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === stack.id && s.count < max && max > 1) {
        const n = Math.min(left, max - s.count);
        s.count += n; left -= n;
      }
    }
    for (let i = 0; i < 36 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = { id: stack.id, count: n, dmg: stack.dmg || 0 };
        left -= n;
      }
    }
    this.touch();
    return left;
  }

  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.touch();
  }

  /** Wear down an item in a slot. Returns true if it broke. */
  damageSlot(index, amount = 1) {
    const s = this.slots[index];
    const def = s && ITEMS[s.id];
    if (!def || !def.durability) return false;
    s.dmg = (s.dmg || 0) + amount;
    this.touch();
    if (s.dmg >= def.durability) { this.slots[index] = null; return true; }
    return false;
  }
  damageHeld(amount = 1) { return this.damageSlot(this.selected, amount); }

  /** Total armor points from the 4 armor slots (20 = full diamond-ish). */
  armorPoints() {
    let p = 0;
    for (let i = 0; i < 4; i++) {
      const s = this.slots[ARMOR_SLOT + i];
      const it = s && ITEMS[s.id];
      if (it && it.armor) p += it.armor.points;
    }
    return p;
  }

  /** Put a held armor piece into its slot (right-click with armor). */
  equipHeld() {
    const s = this.held;
    const it = s && ITEMS[s.id];
    if (!it || !it.armor) return false;
    const slot = ARMOR_SLOT + it.armor.slot;
    const old = this.slots[slot];
    this.slots[slot] = s;
    this.slots[this.selected] = old;
    this.touch();
    return true;
  }

  load(arr) {
    this.slots = new Array(SLOT_COUNT).fill(null);
    if (Array.isArray(arr)) arr.slice(0, SLOT_COUNT).forEach((s, i) => { if (s && ITEMS[s.id]) this.slots[i] = { id: s.id, count: s.count, dmg: s.dmg || 0 }; });
    this.touch();
  }

  takeAll() {
    const all = this.slots.filter(Boolean);
    this.slots.fill(null);
    this.touch();
    return all;
  }
}

/** Fill a slot element with the icon/count/durability bar of a stack. */
export function renderSlot(el, stack, iconURL) {
  const key = stack ? `${stack.id}:${stack.count}:${stack.dmg || 0}` : '';
  if (el._key === key) return;
  el._key = key;
  el.innerHTML = '';
  el.title = '';
  el.classList.toggle('filled', !!stack);
  if (!stack) return;
  const def = ITEMS[stack.id];
  const img = document.createElement('img');
  img.src = iconURL(stack.id);
  img.draggable = false;
  el.appendChild(img);
  el.title = def ? def.displayName : '';
  if (stack.count > 1) {
    const c = document.createElement('span');
    c.className = 'count';
    c.textContent = stack.count;
    el.appendChild(c);
  }
  if (def && def.durability && stack.dmg > 0) {
    const frac = 1 - stack.dmg / def.durability;
    const bar = document.createElement('div');
    bar.className = 'durability';
    bar.innerHTML = `<div style="width:${Math.round(frac * 100)}%;background:hsl(${Math.round(frac * 120)},80%,45%)"></div>`;
    el.appendChild(bar);
  }
}

const clone = (s) => (s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null);

// Creative tabs: [key, label, icon item name]
const CREATIVE_TABS = [
  ['building', 'Building Blocks', 'bricks'],
  ['decoration', 'Decoration Blocks', 'red_flower'],
  ['nature', 'Natural Blocks', 'grass'],
  ['tools', 'Tools, Weapons & Armor', 'iron_pickaxe'],
  ['food', 'Foodstuffs', 'apple'],
  ['materials', 'Materials', 'stick'],
  ['survival', 'Survival Inventory', 'crafting_table'],
];

export class InventoryUI {
  /**
   * @param {HTMLElement} root
   * @param {Inventory} inv
   * @param {object} cb callbacks: iconURL, isCreative(), playerName(), dropStack(stack),
   *                     furnacePut(slot, stack), furnaceTake(slot), onClose(), click()
   */
  constructor(root, inv, cb) {
    this.root = root;
    this.inv = inv;
    this.cb = cb;
    this.kind = null;
    this.cursor = null;          // stack held by the mouse
    this.grid = [];              // crafting grid contents
    this.gridSize = 2;
    this.furnaceState = null;
    this.creativeTab = 'building';
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'slot cursor-slot';
    document.body.appendChild(this.cursorEl);
    document.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX - 20 + 'px';
      this.cursorEl.style.top = e.clientY - 20 + 'px';
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Clicking outside the panel drops the cursor stack into the world.
    root.addEventListener('mousedown', (e) => {
      if (e.target === root && this.cursor) {
        const s = e.button === 2 ? { ...this.cursor, count: 1 } : this.cursor;
        this.cb.dropStack(s);
        this.cursor.count -= s.count;
        if (this.cursor.count <= 0 || s === this.cursor) this.cursor = null;
        this.render();
      }
    });
  }

  get isOpen() { return this.kind !== null; }

  open(kind, data = {}) {
    this.kind = kind;
    this.furnacePos = data.pos || null;
    this.furnaceState = null;
    this.gridSize = kind === 'crafting' ? 3 : 2;
    this.grid = new Array(this.gridSize * this.gridSize).fill(null);
    this._build();
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.kind) return;
    // Return crafting grid items and the cursor stack to the inventory.
    for (const s of [...this.grid, this.cursor]) {
      if (!s) continue;
      const left = this.inv.add(s);
      if (left > 0) this.cb.dropStack({ ...s, count: left });
    }
    this.grid = [];
    this.cursor = null;
    this.kind = null;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.cursorEl.innerHTML = '';
    this.cursorEl._key = null;
    this.cb.onClose();
  }

  setFurnaceState(st) {
    this.furnaceState = st;
    if (this.kind === 'furnace') this.render();
  }

  // ---- Building the DOM ------------------------------------------------------
  _el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  _slot(container, handler, extraClass = '') {
    const el = this._el('div', 'slot ' + extraClass, container);
    el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); handler(e.button === 2 ? 'right' : 'left', e.shiftKey); this.cb.click(); this.render(); });
    return el;
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    this.els = { inv: [], grid: [], out: null, furnace: [], preview: null };
    const creative = this.cb.isCreative();
    const panel = this._el('div', 'inv-panel', r);
    if (this.kind === 'inventory' && creative) {
      this._buildCreativeTabs(panel);
      if (this.creativeTab !== 'survival') { this._buildPalette(panel); this._buildHotbarOnly(panel); return; }
    }
    if (this.kind === 'inventory') this._buildPlayerTop(panel);
    else if (this.kind === 'crafting') this._buildCraftingTop(panel);
    else if (this.kind === 'furnace') this._buildFurnaceTop(panel);
    if (this.kind !== 'inventory') this._el('div', 'inv-label', panel, 'Inventory');
    this._buildMain(panel);
  }

  /** The survival inventory top: armor, paper-doll preview, off-hand, 2x2 crafting. */
  _buildPlayerTop(panel) {
    const top = this._el('div', 'mc-top', panel);
    const armor = this._el('div', 'armor-col', top);
    ARMOR_PIECES.forEach((piece, i) => {
      const el = this._slot(armor, (b, sh) => this._armorClick(i, b, sh), 'armor');
      el.style.backgroundImage = `url(${silhouetteURL(piece)})`;
      this.els.inv[ARMOR_SLOT + i] = el;
    });
    const doll = this._el('div', 'doll', top);
    const canvas = this._el('canvas', '', doll);
    canvas.width = 104; canvas.height = 172;
    this.els.preview = canvas;
    const off = this._slot(top, (b, sh) => this._localClick(this.inv.slots, OFFHAND_SLOT, b, sh, 'inv'), 'armor offhand');
    off.style.backgroundImage = `url(${silhouetteURL('shield')})`;
    off.title = 'Off-hand';
    this.els.inv[OFFHAND_SLOT] = off;
    const craft = this._el('div', 'craft-area', top);
    this._el('div', 'inv-label', craft, 'Crafting');
    this._buildGrid(craft);
  }

  _buildCraftingTop(panel) {
    this._el('div', 'inv-label', panel, 'Crafting');
    const wrap = this._el('div', 'table-top', panel);
    this._buildGrid(wrap);
  }

  _buildGrid(parent) {
    const craft = this._el('div', 'craft', parent);
    const g = this._el('div', `grid grid${this.gridSize}`, craft);
    for (let i = 0; i < this.gridSize * this.gridSize; i++) this.els.grid[i] = this._slot(g, (b, sh) => this._localClick(this.grid, i, b, sh, 'grid'));
    this._el('div', 'craft-arrow', craft);
    this.els.out = this._slot(craft, (b, sh) => this._outputClick(sh), 'big');
  }

  _buildFurnaceTop(panel) {
    this._el('div', 'inv-label', panel, 'Furnace');
    const f = this._el('div', 'furnace-ui', panel);
    const col = this._el('div', 'furnace-col', f);
    this.els.furnace[0] = this._slot(col, (b) => this._furnaceClick(0, b));
    this.els.flame = this._el('div', 'flame', col); this._el('div', '', this.els.flame);
    this.els.furnace[1] = this._slot(col, (b) => this._furnaceClick(1, b));
    this.els.arrow = this._el('div', 'progress-arrow', f); this._el('div', '', this.els.arrow);
    this.els.furnace[2] = this._slot(f, (b) => this._furnaceClick(2, b), 'big');
  }

  _buildMain(panel) {
    const main = this._el('div', 'inv-main', panel);
    for (let i = 9; i < 36; i++) this.els.inv[i] = this._slot(main, (b, sh) => this._localClick(this.inv.slots, i, b, sh, 'inv'));
    this._buildHotbarOnly(panel);
  }

  _buildHotbarOnly(panel) {
    const bar = this._el('div', 'inv-hotbar', panel);
    for (let i = 0; i < 9; i++) this.els.inv[i] = this._slot(bar, (b, sh) => this._localClick(this.inv.slots, i, b, sh, 'inv'));
  }

  _buildCreativeTabs(panel) {
    const tabs = this._el('div', 'ctabs', panel);
    for (const [key, label, icon] of CREATIVE_TABS) {
      const t = this._el('div', 'ctab' + (key === this.creativeTab ? ' active' : ''), tabs);
      t.title = label;
      const img = this._el('img', '', t);
      img.src = this.cb.iconURL(ITEMS.find(it => it && it.name === icon).id);
      t.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); this.creativeTab = key; this.cb.click(); this._build(); this.render(); };
    }
    this._el('div', 'inv-label', panel, CREATIVE_TABS.find(t => t[0] === this.creativeTab)[1]);
  }

  _buildPalette(panel) {
    const pal = this._el('div', 'palette', panel);
    const ids = ITEMS.filter(it => it && !it.hidden && it.cat === this.creativeTab).map(it => it.id);
    for (const id of ids) {
      const el = this._slot(pal, (b, shift) => this._paletteClick(id, b, shift));
      renderSlot(el, { id, count: 1 }, this.cb.iconURL);
    }
    this._el('div', 'inv-hint', panel, 'Click an item to take a stack. Click the item grid while holding something to delete it.');
  }

  render() {
    if (!this.kind) return;
    const icon = this.cb.iconURL;
    for (let i = 0; i < this.els.inv.length; i++) if (this.els.inv[i]) renderSlot(this.els.inv[i], this.inv.slots[i], icon);
    for (let i = 0; i < this.els.grid.length; i++) renderSlot(this.els.grid[i], this.grid[i], icon);
    if (this.els.out) renderSlot(this.els.out, this._craftResult(), icon);
    if (this.els.preview) drawPlayerPreview(this.els.preview, this.cb.playerName(), this.inv.slots);
    if (this.kind === 'furnace') {
      const st = this.furnaceState;
      for (let i = 0; i < 3; i++) renderSlot(this.els.furnace[i], st ? st.slots[i] : null, icon);
      this.els.arrow.firstChild.style.width = `${Math.round((st ? st.progress : 0) * 100)}%`;
      this.els.flame.firstChild.style.height = `${st && st.burnMax ? Math.round((st.burn / st.burnMax) * 100) : 0}%`;
    }
    renderSlot(this.cursorEl, this.cursor, icon);
    this.cursorEl.style.display = this.cursor ? 'block' : 'none';
    this.inv.touch();
  }

  // ---- Click logic -------------------------------------------------------------
  _localClick(arr, i, button, shift, section) {
    const slot = arr[i];
    if (shift && slot) {
      if (section === 'grid' || i >= ARMOR_SLOT) {
        const left = this.inv.add(slot);
        arr[i] = left > 0 ? { ...slot, count: left } : null;
        return;
      }
      // Armor goes straight to its empty armor slot.
      const def = ITEMS[slot.id];
      if (def && def.armor && !this.inv.slots[ARMOR_SLOT + def.armor.slot]) {
        this.inv.slots[ARMOR_SLOT + def.armor.slot] = slot;
        arr[i] = null;
        return;
      }
      const range = i < 9 ? [9, 36] : [0, 9];
      arr[i] = this._moveInto(slot, range[0], range[1]);
      return;
    }
    const c = this.cursor;
    if (button === 'left') {
      if (!c) { this.cursor = slot; arr[i] = null; }
      else if (!slot) { arr[i] = c; this.cursor = null; }
      else if (slot.id === c.id && maxStack(c.id) > 1) {
        const n = Math.min(c.count, maxStack(c.id) - slot.count);
        slot.count += n; c.count -= n;
        if (c.count <= 0) this.cursor = null;
      } else { arr[i] = c; this.cursor = slot; }
    } else {
      if (!c && slot) {
        const half = Math.ceil(slot.count / 2);
        this.cursor = { ...slot, count: half };
        slot.count -= half;
        if (slot.count <= 0) arr[i] = null;
      } else if (c && !slot) {
        arr[i] = { ...c, count: 1 };
        c.count--; if (c.count <= 0) this.cursor = null;
      } else if (c && slot && slot.id === c.id && slot.count < maxStack(c.id)) {
        slot.count++; c.count--; if (c.count <= 0) this.cursor = null;
      }
    }
  }

  /** Armor slots only accept the matching piece (helmet in the head slot, etc.). */
  _armorClick(piece, button, shift) {
    const idx = ARMOR_SLOT + piece;
    const c = this.cursor;
    if (c) {
      const def = ITEMS[c.id];
      if (!def || !def.armor || def.armor.slot !== piece) return;
    }
    this._localClick(this.inv.slots, idx, 'left', shift, 'inv');
  }

  /** Move a stack into inventory slots [from, to); returns the leftover or null. */
  _moveInto(stack, from, to) {
    const s = clone(stack);
    const max = maxStack(s.id);
    for (let i = from; i < to && s.count > 0; i++) {
      const t = this.inv.slots[i];
      if (t && t.id === s.id && t.count < max && max > 1) { const n = Math.min(s.count, max - t.count); t.count += n; s.count -= n; }
    }
    for (let i = from; i < to && s.count > 0; i++) {
      if (!this.inv.slots[i]) { this.inv.slots[i] = clone(s); s.count = 0; }
    }
    return s.count > 0 ? s : null;
  }

  _craftResult() {
    return matchRecipe(this.grid.map(s => (s ? s.id : 0)), this.gridSize);
  }

  _consumeGrid() {
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i]) { this.grid[i].count--; if (this.grid[i].count <= 0) this.grid[i] = null; }
    }
  }

  _outputClick(shift) {
    if (shift) {
      // Craft as many as possible straight into the inventory.
      for (let n = 0; n < 64; n++) {
        const res = this._craftResult();
        if (!res) break;
        const left = this.inv.add({ ...res, dmg: 0 });
        if (left > 0) this.cb.dropStack({ ...res, count: left });
        this._consumeGrid();
      }
      return;
    }
    const res = this._craftResult();
    if (!res) return;
    const c = this.cursor;
    if (!c) this.cursor = { ...res, dmg: 0 };
    else if (c.id === res.id && c.count + res.count <= maxStack(c.id)) c.count += res.count;
    else return;
    this._consumeGrid();
  }

  _paletteClick(id, button, shift) {
    if (this.cursor) { this.cursor = null; return; } // the palette doubles as a trash can
    const count = shift || button === 'left' ? maxStack(id) : 1;
    this.cursor = { id, count, dmg: 0 };
  }

  _furnaceClick(slot, button) {
    const st = this.furnaceState;
    const cur = st ? st.slots[slot] : null;
    if (this.cursor && slot < 2) {
      if (slot === 1 && !ITEMS[this.cursor.id].fuel) return;
      const n = button === 'right' ? 1 : this.cursor.count;
      this.cb.furnacePut(slot, { ...this.cursor, count: n });
      this.cursor.count -= n;
      if (this.cursor.count <= 0) this.cursor = null;
    } else if (cur && !this.cursor) {
      this.cb.furnaceTake(slot); // the server sends the items back as a pickup
    }
  }
}

/** Human-readable name for an item id. */
export function itemName(id) {
  const it = ITEMS[id];
  return it ? it.displayName : '';
}

export function isPlaceable(id) {
  const b = BLOCKS[id];
  return !!(b && id !== 0 && !b.hidden);
}
