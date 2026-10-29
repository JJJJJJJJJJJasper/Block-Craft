// ============================================================================
// Crafting and smelting recipes, written as data.
//
// Shaped recipe:  { pattern: ['XX', 'XX'], key: { X: 'planks' }, result: ['crafting_table', 1] }
//   Patterns may be placed anywhere in the grid (they are trimmed to their
//   bounding box before matching) and are also matched mirrored left/right.
// Shapeless recipe: { shapeless: ['white_wool', 'red_dye'], result: ['red_wool', 1] }
//
// A key starting with # is a TAG: any item in that group matches, e.g.
// '#planks' accepts oak, spruce, birch... planks.
//
// The 2x2 inventory grid can craft any recipe whose pattern fits in 2x2.
// The crafting table (3x3) can craft everything.
// ============================================================================
import { ITEM_BY_NAME, TOOL_TIERS, ARMOR_TIERS } from './items.js';
import { COLORS } from './blocks.js';

const WOODS = ['', 'spruce_', 'birch_', 'jungle_', 'acacia_', 'dark_oak_'];
const logName = (w) => (w ? `${w}log` : 'log');
const planksName = (w) => (w ? `${w}planks` : 'planks');

export const TAGS = {
  planks: WOODS.map(planksName),
  logs: WOODS.map(logName),
  coals: ['coal'],
  stone_like: ['cobblestone', 'mossy_cobblestone'],
};

const RAW_RECIPES = [
  { pattern: ['X', 'X'], key: { X: '#planks' }, result: ['stick', 4] },
  { pattern: ['XX', 'XX'], key: { X: '#planks' }, result: ['crafting_table', 1] },
  { pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' }, result: ['torch', 4] },
  { pattern: ['XXX', 'X X', 'XXX'], key: { X: '#stone_like' }, result: ['furnace', 1] },
  { pattern: ['PPP', 'LLL', 'PPP'], key: { P: '#planks', L: 'leather' }, result: ['bookshelf', 1] },

  // Stone and sand building blocks
  { pattern: ['XX', 'XX'], key: { X: 'stone' }, result: ['stone_bricks', 4] },
  { shapeless: ['stone_bricks', 'leaves'], result: ['mossy_stone_bricks', 1] },
  { shapeless: ['cobblestone', 'leaves'], result: ['mossy_cobblestone', 1] },
  { pattern: ['X', 'X'], key: { X: 'stone_bricks' }, result: ['chiseled_stone_bricks', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'granite' }, result: ['polished_granite', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'diorite' }, result: ['polished_diorite', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'andesite' }, result: ['polished_andesite', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'sand' }, result: ['sandstone', 1] },
  { pattern: ['X', 'X'], key: { X: 'sandstone' }, result: ['chiseled_sandstone', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'sandstone' }, result: ['smooth_sandstone', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'red_sand' }, result: ['red_sandstone', 1] },
  { pattern: ['X', 'X'], key: { X: 'red_sandstone' }, result: ['chiseled_red_sandstone', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'red_sandstone' }, result: ['smooth_red_sandstone', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'clay_ball' }, result: ['clay', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'brick' }, result: ['bricks', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'snow' }, result: ['ice', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'ice' }, result: ['packed_ice', 1] },
  { pattern: ['XX', 'XX'], key: { X: 'quartz_block' }, result: ['quartz_block', 4] },
  { pattern: ['XX', 'XX'], key: { X: 'string' }, result: ['white_wool', 1] },

  // Farm and food
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'wheat' }, result: ['hay_bale', 1] },
  { shapeless: ['hay_bale'], result: ['wheat', 9] },
  { pattern: ['XXX'], key: { X: 'wheat' }, result: ['bread', 1] },
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'melon_slice' }, result: ['melon', 1] },
  { pattern: ['P', 'T'], key: { P: 'pumpkin', T: 'torch' }, result: ['jack_o_lantern', 1] },

  // Dyes from flowers and minerals (white dye comes from white flowers here; there are no bones)
  { shapeless: ['red_flower'], result: ['red_dye', 1] },
  { shapeless: ['red_tulip'], result: ['red_dye', 1] },
  { shapeless: ['yellow_flower'], result: ['yellow_dye', 1] },
  { shapeless: ['sunflower'], result: ['yellow_dye', 2] },
  { shapeless: ['orange_tulip'], result: ['orange_dye', 1] },
  { shapeless: ['pink_tulip'], result: ['pink_dye', 1] },
  { shapeless: ['allium'], result: ['magenta_dye', 1] },
  { shapeless: ['blue_orchid'], result: ['light_blue_dye', 1] },
  { shapeless: ['azure_bluet'], result: ['light_gray_dye', 1] },
  { shapeless: ['oxeye_daisy'], result: ['light_gray_dye', 1] },
  { shapeless: ['white_tulip'], result: ['white_dye', 1] },
  { shapeless: ['lapis_lazuli'], result: ['blue_dye', 1] },
  { shapeless: ['coal'], result: ['black_dye', 1] },
  { shapeless: ['brown_mushroom'], result: ['brown_dye', 1] },
  { shapeless: ['red_dye', 'yellow_dye'], result: ['orange_dye', 2] },
  { shapeless: ['red_dye', 'white_dye'], result: ['pink_dye', 2] },
  { shapeless: ['red_dye', 'blue_dye'], result: ['purple_dye', 2] },
  { shapeless: ['purple_dye', 'pink_dye'], result: ['magenta_dye', 2] },
  { shapeless: ['blue_dye', 'white_dye'], result: ['light_blue_dye', 2] },
  { shapeless: ['green_dye', 'white_dye'], result: ['lime_dye', 2] },
  { shapeless: ['green_dye', 'blue_dye'], result: ['cyan_dye', 2] },
  { shapeless: ['black_dye', 'white_dye'], result: ['gray_dye', 2] },
  { shapeless: ['gray_dye', 'white_dye'], result: ['light_gray_dye', 2] },

];

// Planks from each log type.
for (const w of WOODS) RAW_RECIPES.push({ shapeless: [logName(w)], result: [planksName(w), 4] });

// Coloured blocks: wool + dye, 8 terracotta around a dye, concrete from sand + gravel + dye.
for (const [color] of COLORS) {
  if (color !== 'white') RAW_RECIPES.push({ shapeless: ['white_wool', `${color}_dye`], result: [`${color}_wool`, 1] });
  RAW_RECIPES.push({ pattern: ['TTT', 'TDT', 'TTT'], key: { T: 'terracotta', D: `${color}_dye` }, result: [`${color}_terracotta`, 8] });
  // Real concrete needs water to harden; here it's crafted directly.
  RAW_RECIPES.push({ shapeless: ['sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel', `${color}_dye`], result: [`${color}_concrete`, 8] });
}

// Storage blocks: 9 items <-> 1 block.
for (const [item, block] of [['coal', 'coal_block'], ['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'],
  ['diamond', 'diamond_block'], ['emerald', 'emerald_block'], ['lapis_lazuli', 'lapis_block'], ['redstone', 'redstone_block']]) {
  RAW_RECIPES.push({ pattern: ['XXX', 'XXX', 'XXX'], key: { X: item }, result: [block, 1] });
  RAW_RECIPES.push({ shapeless: [block], result: [item, 9] });
}

// Tool recipes for every material tier.
const TOOL_MATERIAL = { wood: '#planks', stone: '#stone_like', iron: 'iron_ingot', gold: 'gold_ingot', diamond: 'diamond' };
for (const tier of Object.keys(TOOL_TIERS)) {
  const X = TOOL_MATERIAL[tier];
  RAW_RECIPES.push(
    { pattern: ['XXX', ' S ', ' S '], key: { X, S: 'stick' }, result: [`${tier}_pickaxe`, 1] },
    { pattern: ['XX', 'XS', ' S'], key: { X, S: 'stick' }, result: [`${tier}_axe`, 1] },
    { pattern: ['X', 'S', 'S'], key: { X, S: 'stick' }, result: [`${tier}_shovel`, 1] },
    { pattern: ['X', 'X', 'S'], key: { X, S: 'stick' }, result: [`${tier}_sword`, 1] },
  );
}

// Armor recipes.
const ARMOR_MATERIAL = { leather: 'leather', gold: 'gold_ingot', iron: 'iron_ingot', diamond: 'diamond' };
for (const tier of Object.keys(ARMOR_TIERS)) {
  const X = ARMOR_MATERIAL[tier];
  RAW_RECIPES.push(
    { pattern: ['XXX', 'X X'], key: { X }, result: [`${tier}_helmet`, 1] },
    { pattern: ['X X', 'XXX', 'XXX'], key: { X }, result: [`${tier}_chestplate`, 1] },
    { pattern: ['XXX', 'X X', 'X X'], key: { X }, result: [`${tier}_leggings`, 1] },
    { pattern: ['X X', 'X X'], key: { X }, result: [`${tier}_boots`, 1] },
  );
}

// Furnace recipes: input item -> output item. Smelting one item takes SMELT_TIME seconds.
export const SMELT_TIME = 8;
const RAW_SMELTING = {
  iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', sand: 'glass', red_sand: 'glass',
  cobblestone: 'stone', stone: 'smooth_stone', stone_bricks: 'cracked_stone_bricks',
  clay_ball: 'brick', clay: 'terracotta', cactus: 'green_dye',
  raw_porkchop: 'cooked_porkchop', raw_beef: 'steak', raw_mutton: 'cooked_mutton', raw_chicken: 'cooked_chicken',
  emerald_ore: 'emerald', diamond_ore: 'diamond', lapis_ore: 'lapis_lazuli', coal_ore: 'coal',
};
for (const w of WOODS) RAW_SMELTING[logName(w)] = 'coal'; // charcoal, simplified to coal

// ---- Compile names to ids once at startup --------------------------------------
function id(name) {
  const it = ITEM_BY_NAME[name];
  if (!it) throw new Error(`Recipe references unknown item "${name}"`);
  return it.id;
}

// A matcher is a Set of acceptable item ids (a tag) or a single id.
const TAG_SETS = Object.fromEntries(Object.entries(TAGS).map(([k, names]) => [k, new Set(names.map(id))]));
function matcher(name) {
  if (name.startsWith('#')) {
    const set = TAG_SETS[name.slice(1)];
    if (!set) throw new Error(`Unknown recipe tag ${name}`);
    return set;
  }
  return id(name);
}
const matches = (m, item) => (typeof m === 'number' ? m === item : m.has(item));

export const RECIPES = RAW_RECIPES.map(r => {
  const out = { result: { id: id(r.result[0]), count: r.result[1] } };
  if (r.shapeless) {
    out.shapeless = r.shapeless.map(matcher);
  } else {
    out.w = Math.max(...r.pattern.map(row => row.length));
    out.h = r.pattern.length;
    out.cells = [];
    for (let y = 0; y < out.h; y++) {
      for (let x = 0; x < out.w; x++) {
        const ch = r.pattern[y][x] || ' ';
        out.cells.push(ch === ' ' ? 0 : matcher(r.key[ch]));
      }
    }
  }
  return out;
});

export const SMELTING = {};
for (const [from, to] of Object.entries(RAW_SMELTING)) SMELTING[id(from)] = id(to);

/** Can this list of items satisfy this list of matchers, one each? (small backtracking search) */
function shapelessMatch(matchers, items) {
  if (matchers.length !== items.length) return false;
  const used = new Array(items.length).fill(false);
  const go = (i) => {
    if (i === matchers.length) return true;
    for (let j = 0; j < items.length; j++) {
      if (!used[j] && matches(matchers[i], items[j])) {
        used[j] = true;
        if (go(i + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  return go(0);
}

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

  for (const r of RECIPES) {
    if (r.shapeless) {
      if (shapelessMatch(r.shapeless, items)) return { ...r.result };
      continue;
    }
    if (r.w !== w || r.h !== h) continue;
    let ok = true, okMirror = true;
    for (let y = 0; y < h && (ok || okMirror); y++) {
      for (let x = 0; x < w; x++) {
        const v = trimmed[y * w + x];
        const a = r.cells[y * w + x], b = r.cells[y * w + (w - 1 - x)];
        if (a === 0 ? v !== 0 : !matches(a, v)) ok = false;
        if (b === 0 ? v !== 0 : !matches(b, v)) okMirror = false;
      }
    }
    if (ok || okMirror) return { ...r.result };
  }
  return null;
}
