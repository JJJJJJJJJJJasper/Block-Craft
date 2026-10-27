// ============================================================================
// Crafting and smelting recipes, written as data.
//
// Shaped recipe:  { pattern: ['XX', 'XX'], key: { X: 'planks' }, result: ['crafting_table', 1] }
//   Patterns may be placed anywhere in the grid (they are trimmed to their
//   bounding box before matching) and are also matched mirrored left/right.
// Shapeless recipe: { shapeless: ['white_wool', 'red_flower'], result: ['red_wool', 1] }
//
// The 2x2 inventory grid can craft any recipe whose pattern fits in 2x2.
// The crafting table (3x3) can craft everything.
// ============================================================================
import { ITEM_BY_NAME, TOOL_TIERS } from './items.js';

const RAW_RECIPES = [
  { shapeless: ['log'], result: ['planks', 4] },
  { pattern: ['X', 'X'], key: { X: 'planks' }, result: ['stick', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'planks' }, result: ['crafting_table', 1] },
  { pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' }, result: ['torch', 4] },
  { pattern: ['XXX', 'X X', 'XXX'], key: { X: 'cobblestone' }, result: ['furnace', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'sand' }, result: ['sandstone', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'stone' }, result: ['bricks', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'snow' }, result: ['ice', 1] },
  // Placeholder: there are no sheep yet, so wool is woven from leaves.
  { pattern: ['XX', 'XX'], key: { X: 'leaves' }, result: ['white_wool', 1] },
  { shapeless: ['white_wool', 'red_flower'], result: ['red_wool', 1] },
  { shapeless: ['white_wool', 'yellow_flower'], result: ['yellow_wool', 1] },
  { shapeless: ['white_wool', 'red_flower', 'yellow_flower'], result: ['orange_wool', 1] },
  { shapeless: ['white_wool', 'cactus'], result: ['green_wool', 1] },
  { shapeless: ['white_wool', 'ice'], result: ['blue_wool', 1] },
  { shapeless: ['white_wool', 'red_flower', 'ice'], result: ['purple_wool', 1] },
  { shapeless: ['white_wool', 'coal'], result: ['black_wool', 1] },
];

// Tool recipes for every material tier.
const TOOL_MATERIAL = { wood: 'planks', stone: 'cobblestone', iron: 'iron_ingot', gold: 'gold_ingot', diamond: 'diamond' };
for (const tier of Object.keys(TOOL_TIERS)) {
  const X = TOOL_MATERIAL[tier];
  RAW_RECIPES.push(
    { pattern: ['XXX', ' S ', ' S '], key: { X, S: 'stick' }, result: [`${tier}_pickaxe`, 1] },
    { pattern: ['XX', 'XS', ' S'], key: { X, S: 'stick' }, result: [`${tier}_axe`, 1] },
    { pattern: ['X', 'S', 'S'], key: { X, S: 'stick' }, result: [`${tier}_shovel`, 1] },
    { pattern: ['X', 'X', 'S'], key: { X, S: 'stick' }, result: [`${tier}_sword`, 1] },
  );
}

// Furnace recipes: input item -> output item. Smelting one item takes SMELT_TIME seconds.
export const SMELT_TIME = 8;
const RAW_SMELTING = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  log: 'coal',             // charcoal, simplified to coal
  raw_porkchop: 'cooked_porkchop',
  cactus: 'green_wool',    // a "green dye" shortcut
};

// ---- Compile names to ids once at startup --------------------------------------
function id(name) {
  const it = ITEM_BY_NAME[name];
  if (!it) throw new Error(`Recipe references unknown item "${name}"`);
  return it.id;
}

export const RECIPES = RAW_RECIPES.map(r => {
  const out = { result: { id: id(r.result[0]), count: r.result[1] } };
  if (r.shapeless) {
    out.shapeless = r.shapeless.map(id).sort((a, b) => a - b);
  } else {
    out.w = Math.max(...r.pattern.map(row => row.length));
    out.h = r.pattern.length;
    out.cells = [];
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const ch = r.pattern[y][x] || ' ';
        out.cells.push(ch === ' ' ? 0 : id(r.key[ch]));
      }
    }
  }
  return out;
});

export const SMELTING = {};
for (const [from, to] of Object.entries(RAW_SMELTING)) SMELTING[id(from)] = id(to);

/**
 * Find the recipe result for a crafting grid.
 * @param {number[]} grid item ids (0 = empty), row-major
 * @param {number} size  grid width/height (2 or 3)
 * @returns {{id:number,count:number}|null}
 */
export function matchRecipe(grid, size) {
  // Trim the grid to the bounding box of non-empty cells.
  let minX = size, minY = size, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = grid[y * size + x];
      if (v) {
        items.push(v);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!items.length) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const trimmed = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) trimmed.push(grid[y * size + x]);
  const sortedItems = items.slice().sort((a, b) => a - b);

  for (const r of RECIPES) {
    if (r.shapeless) {
      if (r.shapeless.length === sortedItems.length && r.shapeless.every((v, i) => v === sortedItems[i])) {
        return { ...r.result };
      }
      continue;
    }
    if (r.w !== w || r.h !== h) continue;
    let ok = true, okMirror = true;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = trimmed[y * w + x];
        if (r.cells[y * w + x] !== v) ok = false;
        if (r.cells[y * w + (w - 1 - x)] !== v) okMirror = false;
      }
    }
    if (ok || okMirror) return { ...r.result };
  }
  return null;
}
