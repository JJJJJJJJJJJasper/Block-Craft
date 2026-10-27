// ============================================================================
// Inventory data + the inventory / crafting table / furnace / creative screens.
//
// A stack is {id, count, dmg} (dmg = how worn a tool is) or null.
// Slots 0-8 are the hotbar, 9-35 the main inventory.
//
// Mouse controls inside the screens (same as most block games):
//   left click   pick up / put down / swap / merge a whole stack
//   right click  pick up half / put down one
//   shift+click  move the stack to the other section instantly
// ============================================================================
import { ITEMS, maxStack } from '../../shared/items.js';
import { matchRecipe } from '../../shared/recipes.js';
import { BLOCKS } from '../../shared/blocks.js';

export class Inventory {
  constructor() {
    this.slots = new Array(36).fill(null);
    this.selected = 0;
    this.version = 0; // bumps on every change, so the HUD/server sync know to update
  }
  get held() { return this.slots[this.selected]; }
  get heldId() { return this.held ? this.held.id : 0; }
  touch() { this.version++; }

  /** Add a stack; returns how many items did NOT fit. */
  add(stack) {
    let left = stack.count;
    const max = maxStack(stack.id);
    // first top up existing stacks of the same item
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === stack.id && s.count < max && max > 1) {
        const n = Math.min(left, max - s.count);
        s.count += n; left -= n;
      }
    }
    // then fill empty slots
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

  /** Remove `n` items from the selected slot. */
  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.touch();
  }

  /** Wear down the held tool. Returns true if it broke. */
  damageHeld(amount = 1) {
    const s = this.held;
    const def = s && ITEMS[s.id];
    if (!def || !def.durability) return false;
    s.dmg = (s.dmg || 0) + amount;
    this.touch();
    if (s.dmg >= def.durability) { this.slots[this.selected] = null; return true; }
    return false;
  }

  load(arr) {
    this.slots = new Array(36).fill(null);
    if (Array.isArray(arr)) arr.slice(0, 36).forEach((s, i) => { if (s && ITEMS[s.id]) this.slots[i] = { id: s.id, count: s.count, dmg: s.dmg || 0 }; });
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

export class InventoryUI {
  /**
   * @param {HTMLElement} root
   * @param {Inventory} inv
   * @param {object} cb callbacks: iconURL, isCreative(), dropStack(stack), furnacePut(slot, stack),
   *                     furnaceTake(slot), onClose(), click()
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
    this.creativeTab = this.creativeTab || 'blocks';
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
  _slot(container, handler) {
    const el = document.createElement('div');
    el.className = 'slot';
    el.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); handler(e.button === 2 ? 'right' : 'left', e.shiftKey); this.cb.click(); this.render(); });
    container.appendChild(el);
    return el;
  }

  _build() {
    const r = this.root;
    r.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'inv-panel';
    r.appendChild(panel);
    const creative = this.cb.isCreative();
    const title = document.createElement('div');
    title.className = 'inv-title';
    title.textContent = this.kind === 'crafting' ? 'Crafting Table' : this.kind === 'furnace' ? 'Furnace' : creative ? 'Creative Inventory' : 'Inventory';
    panel.appendChild(title);

    this.els = { inv: [], grid: [], out: null, furnace: [], palette: [] };
    const top = document.createElement('div');
    top.className = 'inv-top';
    panel.appendChild(top);

    if (this.kind === 'furnace') {
      const f = document.createElement('div');
      f.className = 'furnace-ui';
      const col = document.createElement('div'); col.className = 'furnace-col';
      this.els.furnace[0] = this._slot(col, (b) => this._furnaceClick(0, b));
      this.els.flame = document.createElement('div'); this.els.flame.className = 'flame'; this.els.flame.innerHTML = '<div></div>';
      col.appendChild(this.els.flame);
      this.els.furnace[1] = this._slot(col, (b) => this._furnaceClick(1, b));
      f.appendChild(col);
      this.els.arrow = document.createElement('div'); this.els.arrow.className = 'arrow'; this.els.arrow.innerHTML = '<div></div>';
      f.appendChild(this.els.arrow);
      this.els.furnace[2] = this._slot(f, (b) => this._furnaceClick(2, b));
      this.els.furnace[2].classList.add('big');
      top.appendChild(f);
      const hint = document.createElement('div'); hint.className = 'inv-hint';
      hint.textContent = 'Top: item to smelt (ore, sand, raw meat...). Bottom: fuel (coal, wood, planks, sticks).';
      panel.appendChild(hint);
    } else if (creative && this.kind === 'inventory') {
      // Creative palette with every item, split into tabs.
      const tabs = document.createElement('div'); tabs.className = 'tabs';
      for (const [k, label] of [['blocks', 'Blocks'], ['items', 'Tools & Items']]) {
        const b = document.createElement('button');
        b.textContent = label;
        if (this.creativeTab === k) b.className = 'active';
        b.onclick = () => { this.creativeTab = k; this._build(); this.render(); };
        tabs.appendChild(b);
      }
      top.appendChild(tabs);
      const pal = document.createElement('div'); pal.className = 'palette';
      const ids = ITEMS.filter(it => it && !it.hidden && (this.creativeTab === 'blocks' ? it.isBlock : !it.isBlock)).map(it => it.id);
      for (const id of ids) {
        const el = this._slot(pal, (b, shift) => this._paletteClick(id, b, shift));
        renderSlot(el, { id, count: 1 }, this.cb.iconURL);
      }
      top.appendChild(pal);
      const hint = document.createElement('div'); hint.className = 'inv-hint';
      hint.textContent = 'Click an item to pick up a stack. Click the palette while holding something to delete it.';
      panel.appendChild(hint);
    }

    if (this.kind !== 'furnace' && !(creative && this.kind === 'inventory')) {
      const craft = document.createElement('div'); craft.className = 'craft';
      const g = document.createElement('div'); g.className = `grid grid${this.gridSize}`;
      for (let i = 0; i < this.gridSize * this.gridSize; i++) this.els.grid[i] = this._slot(g, (b, sh) => this._localClick(this.grid, i, b, sh, 'grid'));
      craft.appendChild(g);
      const arrow = document.createElement('div'); arrow.className = 'arrow static'; arrow.textContent = '→';
      craft.appendChild(arrow);
      this.els.out = this._slot(craft, (b, sh) => this._outputClick(sh));
      this.els.out.classList.add('big');
      top.appendChild(craft);
    }

    const main = document.createElement('div'); main.className = 'inv-main';
    for (let i = 9; i < 36; i++) this.els.inv[i] = this._slot(main, (b, sh) => this._localClick(this.inv.slots, i, b, sh, 'inv'));
    panel.appendChild(main);
    const bar = document.createElement('div'); bar.className = 'inv-hotbar';
    for (let i = 0; i < 9; i++) this.els.inv[i] = this._slot(bar, (b, sh) => this._localClick(this.inv.slots, i, b, sh, 'inv'));
    panel.appendChild(bar);

    const foot = document.createElement('div'); foot.className = 'inv-hint';
    foot.textContent = 'Left click: move stack · Right click: split / place one · Shift+click: quick move · E or Esc: close';
    panel.appendChild(foot);
  }

  render() {
    if (!this.kind) return;
    const icon = this.cb.iconURL;
    for (let i = 0; i < 36; i++) if (this.els.inv[i]) renderSlot(this.els.inv[i], this.inv.slots[i], icon);
    for (let i = 0; i < this.els.grid.length; i++) renderSlot(this.els.grid[i], this.grid[i], icon);
    if (this.els.out) renderSlot(this.els.out, this._craftResult(), icon);
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
      // Quick-move: grid -> inventory, hotbar <-> main.
      if (section === 'grid') {
        const left = this.inv.add(slot);
        arr[i] = left > 0 ? { ...slot, count: left } : null;
      } else {
        const range = i < 9 ? [9, 36] : [0, 9];
        arr[i] = this._moveInto(slot, range[0], range[1]);
      }
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
        if (left > 0) { this.cb.dropStack({ ...res, count: left }); }
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
    if (this.cursor) { this.cursor = null; return; } // palette acts as a trash can
    const count = shift || button === 'left' ? maxStack(id) : 1;
    this.cursor = { id, count, dmg: 0 };
  }

  _furnaceClick(slot, button) {
    const st = this.furnaceState;
    const cur = st ? st.slots[slot] : null;
    if (this.cursor && slot < 2) {
      // Put the cursor stack (or one item with right click) into the furnace.
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
