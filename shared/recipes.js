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
  coals: ['coal', 'charcoal'],
  wool: COLORS.map(([c]) => `${c}_wool`),
  stone_like: ['cobblestone', 'mossy_cobblestone'],
};

const RAW_RECIPES = [
  { pattern: ['X', 'X'], key: { X: '#planks' }, result: ['stick', 4] },
  { pattern: ['XX', 'XX'], key: { X: '#planks' }, result: ['crafting_table', 1] },
  { pattern: ['C', 'S'], key: { C: 'coal', S: 'stick' }, result: ['torch', 4] },
  { pattern: ['XXX', 'X X', 'XXX'], key: { X: '#stone_like' }, result: ['furnace', 1] },
  { pattern: ['PPP', 'BBB', 'PPP'], key: { P: '#planks', B: 'book' }, result: ['bookshelf', 1] },

  // Stone and sand building blocks
  { pattern: ['XX', 'XX'], key: { X: 'stone' }, result: ['stone_bricks', 4] },
  { shapeless: ['stone_bricks', 'vine'], result: ['mossy_stone_bricks', 1] },
  { shapeless: ['cobblestone', 'vine'], result: ['mossy_cobblestone', 1] },
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
  // Concrete powder hardens into concrete when it touches water.
  RAW_RECIPES.push({ shapeless: ['sand', 'sand', 'sand', 'sand', 'gravel', 'gravel', 'gravel', 'gravel', `${color}_dye`], result: [`${color}_concrete_powder`, 8] });
  RAW_RECIPES.push({ pattern: ['GGG', 'GDG', 'GGG'], key: { G: 'glass', D: `${color}_dye` }, result: [`${color}_stained_glass`, 8] });
  RAW_RECIPES.push({ pattern: ['GGG', 'GGG'], key: { G: `${color}_stained_glass` }, result: [`${color}_stained_glass_pane`, 16] });
  RAW_RECIPES.push({ pattern: ['WW'], key: { W: `${color}_wool` }, result: [`${color}_carpet`, 3] });
  RAW_RECIPES.push({ pattern: ['WWW', 'PPP'], key: { W: `${color}_wool`, P: '#planks' }, result: [`${color}_bed`, 1] });
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
  if (!X) continue; // chainmail is only found, never crafted
  RAW_RECIPES.push(
    { pattern: ['XXX', 'X X'], key: { X }, result: [`${tier}_helmet`, 1] },
    { pattern: ['X X', 'XXX', 'XXX'], key: { X }, result: [`${tier}_chestplate`, 1] },
    { pattern: ['XXX', 'X X', 'X X'], key: { X }, result: [`${tier}_leggings`, 1] },
    { pattern: ['X X', 'X X'], key: { X }, result: [`${tier}_boots`, 1] },
  );
}

// Hoes.
for (const tier of Object.keys(TOOL_TIERS)) {
  RAW_RECIPES.push({ pattern: ['XX', ' S', ' S'], key: { X: TOOL_MATERIAL[tier], S: 'stick' }, result: [`${tier}_hoe`, 1] });
}

// Wood families: stairs, slabs, doors, fences, gates, boats.
const WOOD_KEYS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
WOOD_KEYS.forEach((k, i) => {
  const P = planksName(WOODS[i]);
  RAW_RECIPES.push(
    { pattern: ['P  ', 'PP ', 'PPP'], key: { P }, result: [`${k}_stairs`, 4] },
    { pattern: ['PPP'], key: { P }, result: [`${k}_slab`, 6] },
    { pattern: ['PP', 'PP', 'PP'], key: { P }, result: [`${k}_door`, 3] },
    { pattern: ['PSP', 'PSP'], key: { P, S: 'stick' }, result: [`${k}_fence`, 3] },
    { pattern: ['SPS', 'SPS'], key: { P, S: 'stick' }, result: [`${k}_fence_gate`, 1] },
    { pattern: ['P P', 'PPP'], key: { P }, result: [`${k}_boat`, 1] },
  );
});
for (const [k, src] of [['cobblestone', 'cobblestone'], ['stone_brick', 'stone_bricks'], ['brick', 'bricks'], ['sandstone', 'sandstone'], ['red_sandstone', 'red_sandstone'], ['quartz', 'quartz_block']]) {
  RAW_RECIPES.push({ pattern: ['P  ', 'PP ', 'PPP'], key: { P: src }, result: [`${k}_stairs`, 4] }, { pattern: ['PPP'], key: { P: src }, result: [`${k}_slab`, 6] });
}

// Pillars from logs going sideways need no recipe; these are the other new blocks.
RAW_RECIPES.push(
  { pattern: ['PPP'], key: { P: 'stone' }, result: ['stone_slab', 6] },
  { pattern: ['II', 'II', 'II'], key: { I: 'iron_ingot' }, result: ['iron_door', 3] },
  { pattern: ['PPP', 'PPP'], key: { P: '#planks' }, result: ['oak_trapdoor', 2] },
  { pattern: ['II', 'II'], key: { I: 'iron_ingot' }, result: ['iron_trapdoor', 1] },
  { pattern: ['CCC', 'CCC'], key: { C: 'cobblestone' }, result: ['cobblestone_wall', 6] },
  { pattern: ['CCC', 'CCC'], key: { C: 'mossy_cobblestone' }, result: ['mossy_cobblestone_wall', 6] },
  { pattern: ['GGG', 'GGG'], key: { G: 'glass' }, result: ['glass_pane', 16] },
  { pattern: ['III', 'III'], key: { I: 'iron_ingot' }, result: ['iron_bars', 16] },
  { pattern: ['PPP', 'P P', 'PPP'], key: { P: '#planks' }, result: ['chest', 1] },
  { shapeless: ['chest', 'tripwire_hook'], result: ['trapped_chest', 1] },
  { pattern: ['I', 'S', 'P'], key: { I: 'iron_ingot', S: 'stick', P: '#planks' }, result: ['tripwire_hook', 2] },
  { pattern: ['CCC', 'CBC', 'CRC'], key: { C: 'cobblestone', B: 'bow', R: 'redstone' }, result: ['dispenser', 1] },
  { pattern: ['CCC', 'C C', 'CRC'], key: { C: 'cobblestone', R: 'redstone' }, result: ['dropper', 1] },
  { pattern: ['S S', 'SSS', 'S S'], key: { S: 'stick' }, result: ['ladder', 3] },
  { pattern: ['R', 'S'], key: { R: 'redstone', S: 'stick' }, result: ['redstone_torch', 1] },
  { shapeless: ['stone'], result: ['stone_button', 1] },
  { shapeless: ['#planks'], result: ['oak_button', 1] },
  { pattern: ['SS'], key: { S: 'stone' }, result: ['stone_pressure_plate', 1] },
  { pattern: ['PP'], key: { P: '#planks' }, result: ['oak_pressure_plate', 1] },
  { pattern: ['GG'], key: { G: 'gold_ingot' }, result: ['light_weighted_pressure_plate', 1] },
  { pattern: ['II'], key: { I: 'iron_ingot' }, result: ['heavy_weighted_pressure_plate', 1] },
  { pattern: ['S', 'C'], key: { S: 'stick', C: 'cobblestone' }, result: ['lever', 1] },
  { pattern: ['I I', 'ISI', 'I I'], key: { I: 'iron_ingot', S: 'stick' }, result: ['rail', 16] },
  { pattern: ['G G', 'GSG', 'GRG'], key: { G: 'gold_ingot', S: 'stick', R: 'redstone' }, result: ['powered_rail', 6] },
  { pattern: ['I I', 'IPI', 'IRI'], key: { I: 'iron_ingot', P: 'stone_pressure_plate', R: 'redstone' }, result: ['detector_rail', 6] },
  { pattern: ['ISI', 'IRI', 'ISI'], key: { I: 'iron_ingot', S: 'stick', R: 'redstone_torch' }, result: ['activator_rail', 6] },
  { pattern: ['TRT', 'SSS'], key: { T: 'redstone_torch', R: 'redstone', S: 'stone' }, result: ['repeater', 1] },
  { pattern: ['MMM', 'SES', 'WWW'], key: { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' }, result: ['cake', 1] },
  { pattern: ['B B', ' B '], key: { B: 'brick' }, result: ['flower_pot', 1] },
  { pattern: [' B ', 'DOD', 'OOO'], key: { B: 'book', D: 'diamond', O: 'obsidian' }, result: ['enchanting_table', 1] },
  { pattern: ['I I', 'ICI', ' I '], key: { I: 'iron_ingot', C: 'chest' }, result: ['hopper', 1] },
  { pattern: ['I I', 'I I', 'III'], key: { I: 'iron_ingot' }, result: ['cauldron', 1] },
  { pattern: ['BBB', ' I ', 'III'], key: { B: 'iron_block', I: 'iron_ingot' }, result: ['anvil', 1] },
  { pattern: ['PPP', 'PRP', 'PPP'], key: { P: '#planks', R: 'redstone' }, result: ['note_block', 1] },
  { pattern: ['PPP', 'PDP', 'PPP'], key: { P: '#planks', D: 'diamond' }, result: ['jukebox', 1] },
  { pattern: ['PPP', 'CIC', 'CRC'], key: { P: '#planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' }, result: ['piston', 1] },
  { shapeless: ['piston', 'slimeball'], result: ['sticky_piston', 1] },
  { pattern: ['GSG', 'SGS', 'GSG'], key: { G: 'gunpowder', S: 'sand' }, result: ['tnt', 1] },
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'slimeball' }, result: ['slime_block', 1] },
  { shapeless: ['slime_block'], result: ['slimeball', 9] },
  { pattern: ['SS', 'SS'], key: { S: 'prismarine_shard' }, result: ['prismarine', 1] },
  { pattern: ['SSS', 'SSS', 'SSS'], key: { S: 'prismarine_shard' }, result: ['prismarine_bricks', 1] },
  { pattern: ['SSS', 'SDS', 'SSS'], key: { S: 'prismarine_shard', D: 'black_dye' }, result: ['dark_prismarine', 1] },
  { pattern: ['Q', 'Q'], key: { Q: 'quartz_block' }, result: ['quartz_pillar', 2] },
  { pattern: ['S', 'S'], key: { S: 'quartz_slab' }, result: ['chiseled_quartz_block', 1] },
  { pattern: ['DG', 'GD'], key: { D: 'dirt', G: 'gravel' }, result: ['coarse_dirt', 4] },
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'bone_meal' }, result: ['bone_block', 1] },
  { shapeless: ['bone_block'], result: ['bone_meal', 9] },

  // Tools and gadgets
  { pattern: [' I', 'I '], key: { I: 'iron_ingot' }, result: ['shears', 1] },
  { shapeless: ['iron_ingot', 'flint'], result: ['flint_and_steel', 1] },
  { pattern: ['  S', ' ST', 'S T'], key: { S: 'stick', T: 'string' }, result: ['fishing_rod', 1] },
  { pattern: ['F ', ' C'], key: { F: 'fishing_rod', C: 'carrot' }, result: ['carrot_on_a_stick', 1] },
  { pattern: [' ST', 'S T', ' ST'], key: { S: 'stick', T: 'string' }, result: ['bow', 1] },
  { pattern: ['F', 'S', 'E'], key: { F: 'flint', S: 'stick', E: 'feather' }, result: ['arrow', 4] },
  { pattern: [' I ', 'IRI', ' I '], key: { I: 'iron_ingot', R: 'redstone' }, result: ['compass', 1] },
  { pattern: [' G ', 'GRG', ' G '], key: { G: 'gold_ingot', R: 'redstone' }, result: ['clock', 1] },
  { pattern: ['PPP', 'PCP', 'PPP'], key: { P: 'paper', C: 'compass' }, result: ['empty_map', 1] },
  { pattern: ['I I', ' I '], key: { I: 'iron_ingot' }, result: ['bucket', 1] },
  { pattern: ['WIW', 'WWW', ' W '], key: { W: '#planks', I: 'iron_ingot' }, result: ['shield', 1] },
  { pattern: ['SS ', 'SB ', '  S'], key: { S: 'string', B: 'slimeball' }, result: ['lead', 2] },
  { pattern: ['PPP', 'PPP', ' S '], key: { P: '#planks', S: 'stick' }, result: ['sign', 3] },
  { pattern: ['SSS', 'SLS', 'SSS'], key: { S: 'stick', L: 'leather' }, result: ['item_frame', 1] },
  { pattern: ['SSS', 'SWS', 'SSS'], key: { S: 'stick', W: '#wool' }, result: ['painting', 1] },
  { pattern: ['SSS', ' S ', 'SPS'], key: { S: 'stick', P: 'stone_slab' }, result: ['armor_stand', 1] },
  { pattern: ['I I', 'III'], key: { I: 'iron_ingot' }, result: ['minecart', 1] },
  { shapeless: ['minecart', 'chest'], result: ['chest_minecart', 1] },
  { shapeless: ['minecart', 'furnace'], result: ['furnace_minecart', 1] },
  { shapeless: ['minecart', 'hopper'], result: ['hopper_minecart', 1] },
  { shapeless: ['minecart', 'tnt'], result: ['tnt_minecart', 1] },
  { shapeless: ['paper', 'gunpowder'], result: ['firework_rocket', 3] },
  { shapeless: ['gunpowder', 'red_dye'], result: ['firework_star', 1] },
  { pattern: ['G G', ' G '], key: { G: 'glass' }, result: ['glass_bottle', 3] },

  // Materials
  { shapeless: ['bone'], result: ['bone_meal', 3] },
  { shapeless: ['bone_meal'], result: ['white_dye', 1] },
  { shapeless: ['ink_sac'], result: ['black_dye', 1] },
  { shapeless: ['cocoa_beans'], result: ['brown_dye', 1] },
  { shapeless: ['sugar_cane'], result: ['sugar', 1] },
  { pattern: ['XXX'], key: { X: 'sugar_cane' }, result: ['paper', 3] },
  { shapeless: ['paper', 'paper', 'paper', 'leather'], result: ['book', 1] },
  { shapeless: ['book', 'ink_sac', 'feather'], result: ['writable_book', 1] },
  { shapeless: ['iron_ingot'], result: ['iron_nugget', 9] },
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'iron_nugget' }, result: ['iron_ingot', 1] },
  { shapeless: ['gold_ingot'], result: ['gold_nugget', 9] },
  { pattern: ['XXX', 'XXX', 'XXX'], key: { X: 'gold_nugget' }, result: ['gold_ingot', 1] },
  { pattern: ['RR', 'RR'], key: { R: 'rabbit_hide' }, result: ['leather', 1] },
  { shapeless: ['melon_slice'], result: ['melon_seeds', 1] },
  { shapeless: ['pumpkin'], result: ['pumpkin_seeds', 4] },

  // Food
  { pattern: ['P P', ' P '], key: { P: '#planks' }, result: ['bowl', 4] },
  { shapeless: ['bowl', 'red_mushroom', 'brown_mushroom'], result: ['mushroom_stew', 1] },
  { shapeless: ['bowl', 'cooked_rabbit', 'carrot', 'baked_potato', 'brown_mushroom'], result: ['rabbit_stew', 1] },
  { pattern: ['BBB', 'BBB', ' W '], key: { B: 'beetroot', W: 'bowl' }, result: ['beetroot_soup', 1] },
  { pattern: ['WCW'], key: { W: 'wheat', C: 'cocoa_beans' }, result: ['cookie', 8] },
  { shapeless: ['pumpkin', 'sugar', 'egg'], result: ['pumpkin_pie', 1] },
  { pattern: ['GGG', 'GAG', 'GGG'], key: { G: 'gold_ingot', A: 'apple' }, result: ['golden_apple', 1] },
  { pattern: ['GGG', 'GAG', 'GGG'], key: { G: 'gold_block', A: 'apple' }, result: ['enchanted_golden_apple', 1] },
  { pattern: ['NNN', 'NCN', 'NNN'], key: { N: 'gold_nugget', C: 'carrot' }, result: ['golden_carrot', 1] },
  { pattern: ['NNN', 'NMN', 'NNN'], key: { N: 'gold_nugget', M: 'melon_slice' }, result: ['glistering_melon', 1] },
  { shapeless: ['spider_eye', 'brown_mushroom', 'sugar'], result: ['fermented_spider_eye', 1] },
);

// Furnace recipes: input item -> output item. Smelting one item takes SMELT_TIME seconds.
export const SMELT_TIME = 8;
const RAW_SMELTING = {
  iron_ore: 'iron_ingot', gold_ore: 'gold_ingot', sand: 'glass', red_sand: 'glass',
  cobblestone: 'stone', stone: 'smooth_stone', stone_bricks: 'cracked_stone_bricks',
  clay_ball: 'brick', clay: 'terracotta', cactus: 'green_dye',
  raw_porkchop: 'cooked_porkchop', raw_beef: 'steak', raw_mutton: 'cooked_mutton', raw_chicken: 'cooked_chicken',
  emerald_ore: 'emerald', diamond_ore: 'diamond', lapis_ore: 'lapis_lazuli', coal_ore: 'coal',
  potato: 'baked_potato', raw_cod: 'cooked_cod', raw_salmon: 'cooked_salmon', raw_rabbit: 'cooked_rabbit',
  wet_sponge: 'sponge', redstone_ore: 'redstone',
};
for (const w of WOODS) RAW_SMELTING[logName(w)] = 'charcoal';
for (const [color] of COLORS) RAW_SMELTING[`${color}_terracotta`] = `${color}_glazed_terracotta`;

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
        if (ch !== ' ' && !r.key[ch]) throw new Error(`Recipe for ${r.result[0]} uses "${ch}" without a key`);
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
