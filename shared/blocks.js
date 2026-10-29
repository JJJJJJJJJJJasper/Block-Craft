// ============================================================================
// Block definitions. To add a block:
//   1. Add an entry to BLOCK_LIST below with a new unique id (< 256). Never
//      change an existing id: saved worlds store blocks by id.
//   2. Give it textures (top/side/bottom or `all`). A texture name is a
//      painter in client/rendering/textures.js, optionally with colour
//      parameters, e.g. 'wool:#3aafd9' or 'planks:#c29d62'. Reuse an existing
//      painter with new colours and you don't need to write any drawing code.
//   3. Optionally add a crafting recipe in shared/recipes.js.
//
// Fields:
//   hardness   base break time (-1 = unbreakable, 0 = instant)
//   tool       tool that mines it fastest: 'pickaxe' | 'axe' | 'shovel' | null
//   harvest    minimum tool tier needed for it to DROP anything in survival
//              (0 = hand, 1 = wood, 2 = stone, 3 = iron, 4 = diamond)
//   drops      item dropped: a name, [name, min, max], or null for nothing
//              (defaults to the block itself)
//   bonus      extra random drops: [[itemName, chance], ...]
//   solid      collides with players/mobs
//   opaque     blocks light completely and hides neighbouring faces
//   transparent see-through (glass, leaves, water, plants)
//   cutout     drawn with alpha-tested holes (leaves, glass, plants)
//   translucent drawn blended in the second pass (water)
//   liquid     swimmable (water, lava)
//   light      light level the block emits (0-15)
//   lightOpacity how much light is lost passing through (0-15)
//   shape      'cube' (default) | 'cross' (plants) | 'torch' | 'flat' (lily pad)
//   tint       'grass' | 'foliage': coloured by the biome it's in
//   cat        creative-inventory tab: 'building' | 'decoration' | 'nature'
//   sound      footstep/break sound family
// ============================================================================

// 16 colours used for wool, concrete and terracotta.
export const COLORS = [
  // name,        wool,      concrete,  terracotta
  ['white', '#e9ecec', '#cfd5d6', '#d1b1a1'],
  ['orange', '#f07613', '#e06101', '#a15325'],
  ['magenta', '#bd44b3', '#a9309f', '#95576c'],
  ['light_blue', '#3aafd9', '#2489c7', '#706c8a'],
  ['yellow', '#f8c527', '#f1af15', '#ba8523'],
  ['lime', '#70b919', '#5ea918', '#677534'],
  ['pink', '#ed8dac', '#d5658e', '#a14e4e'],
  ['gray', '#3e4447', '#36393d', '#392a23'],
  ['light_gray', '#8e8e86', '#7d7d73', '#876b62'],
  ['cyan', '#158991', '#157788', '#575b5b'],
  ['purple', '#792aac', '#64209c', '#764656'],
  ['blue', '#35399d', '#2c2e8f', '#4a3b5b'],
  ['brown', '#724728', '#603b1f', '#4d3323'],
  ['green', '#546d1b', '#495b24', '#4c532a'],
  ['red', '#a12722', '#8e2121', '#8e3c2e'],
  ['black', '#141519', '#080a0f', '#251610'],
];

const PLANT = { hardness: 0, solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', sound: 'grass', cat: 'nature' };
const LEAVES = { hardness: 0.2, opaque: false, transparent: true, cutout: true, lightOpacity: 1, drops: null, sound: 'grass', cat: 'nature' };
const LOG = { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, cat: 'building' };
const PLANKS = { hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, cat: 'building' };
const STONE = { hardness: 1.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' };
const ORE = { hardness: 3, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'nature' };

const BLOCK_LIST = [
  { id: 0, name: 'air', solid: false, opaque: false, transparent: true, lightOpacity: 0, hardness: 0, hidden: true },
  { id: 1, name: 'grass', displayName: 'Grass Block', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass', tint: 'grass', cat: 'nature' },
  { id: 2, name: 'dirt', tex: { all: 'dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel', cat: 'nature' },
  { id: 3, name: 'stone', tex: { all: 'stone' }, ...STONE, drops: 'cobblestone' },
  { id: 4, name: 'cobblestone', tex: { all: 'cobblestone' }, ...STONE, hardness: 2 },
  { id: 5, name: 'sand', tex: { all: 'sand:#dbd3a0' }, hardness: 0.5, tool: 'shovel', sound: 'sand', cat: 'nature' },
  { id: 6, name: 'gravel', tex: { all: 'gravel' }, hardness: 0.6, tool: 'shovel', sound: 'gravel', bonus: [['flint', 0.1]], cat: 'nature' },
  { id: 7, name: 'log', displayName: 'Oak Log', tex: { top: 'log_top:#b39462:#6b5132', side: 'log_side:#6b5132' }, ...LOG },
  { id: 8, name: 'planks', displayName: 'Oak Planks', tex: { all: 'planks:#a8864f' }, ...PLANKS },
  { id: 9, name: 'leaves', displayName: 'Oak Leaves', tex: { all: 'leaves_tint' }, ...LEAVES, tint: 'foliage', bonus: [['apple', 0.05], ['stick', 0.04]] },
  { id: 10, name: 'glass', tex: { all: 'glass' }, hardness: 0.3, opaque: false, transparent: true, cutout: true, lightOpacity: 0, drops: null, sound: 'glass', cat: 'building' },
  { id: 11, name: 'water', tex: { all: 'water' }, hardness: -1, solid: false, opaque: false, transparent: true, translucent: true, liquid: true, lightOpacity: 2, drops: null, hidden: true },
  { id: 12, name: 'coal_ore', displayName: 'Coal Ore', tex: { all: 'ore:#262626' }, ...ORE, drops: 'coal' },
  { id: 13, name: 'iron_ore', displayName: 'Iron Ore', tex: { all: 'ore:#d8a782' }, ...ORE, harvest: 2 },
  { id: 14, name: 'gold_ore', displayName: 'Gold Ore', tex: { all: 'ore:#f5d742' }, ...ORE, harvest: 3 },
  { id: 15, name: 'diamond_ore', displayName: 'Diamond Ore', tex: { all: 'ore:#5ee8e0' }, ...ORE, harvest: 3, drops: 'diamond' },
  { id: 16, name: 'bricks', tex: { all: 'bricks' }, ...STONE, hardness: 2 },
  { id: 17, name: 'torch', tex: { all: 'torch' }, hardness: 0, solid: false, opaque: false, transparent: true, lightOpacity: 0, light: 14, shape: 'torch', sound: 'wood', cat: 'decoration' },
  { id: 18, name: 'crafting_table', displayName: 'Crafting Table', tex: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks:#a8864f' }, hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 15, cat: 'decoration' },
  { id: 19, name: 'furnace', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top' }, hardness: 3.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'decoration' },
  { id: 20, name: 'bedrock', tex: { all: 'bedrock' }, hardness: -1, sound: 'stone', cat: 'building' },
  { id: 21, name: 'snowy_grass', displayName: 'Snowy Grass Block', tex: { top: 'snow', side: 'snowy_grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'snow', cat: 'nature' },
  { id: 22, name: 'snow', displayName: 'Snow Block', tex: { all: 'snow' }, hardness: 0.2, tool: 'shovel', sound: 'snow', cat: 'nature' },
  // Ice is drawn as a solid block: see-through ice over see-through water
  // can't be sorted correctly per pixel and looked patchy.
  { id: 23, name: 'ice', tex: { all: 'ice' }, hardness: 0.5, tool: 'pickaxe', lightOpacity: 3, drops: null, sound: 'glass', cat: 'nature' },
  { id: 24, name: 'sandstone', tex: { top: 'sandstone_top:#d8cc90', side: 'sandstone_side:#d8cc90', bottom: 'sandstone_bottom:#d8cc90' }, ...STONE, hardness: 0.8 },
  { id: 25, name: 'cactus', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hardness: 0.4, opaque: false, transparent: true, cutout: true, lightOpacity: 0, sound: 'cloth', cat: 'nature' },
  { id: 26, name: 'tall_grass', displayName: 'Grass', tex: { all: 'tall_grass' }, ...PLANT, drops: null, replaceable: true, tint: 'grass', bonus: [['wheat_seeds', 0.12]] },
  { id: 27, name: 'red_flower', displayName: 'Poppy', tex: { all: 'flower:#d8322b:#3a1a10' }, ...PLANT },
  { id: 28, name: 'yellow_flower', displayName: 'Dandelion', tex: { all: 'flower:#f2d32b:#e0a010' }, ...PLANT },
  { id: 29, name: 'fern', tex: { all: 'fern' }, ...PLANT, drops: null, replaceable: true, tint: 'grass' },
  // 30-37 and 90-97: wool (see COLORS)
  { id: 38, name: 'lit_furnace', displayName: 'Furnace', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit', bottom: 'furnace_top' }, hardness: 3.5, tool: 'pickaxe', harvest: 1, light: 13, drops: 'furnace', sound: 'stone', hidden: true },

  // ---- Wood types ----
  { id: 39, name: 'spruce_log', tex: { top: 'log_top:#7a5a34:#3b2812', side: 'log_side:#3b2812' }, ...LOG },
  { id: 40, name: 'spruce_planks', tex: { all: 'planks:#735532' }, ...PLANKS },
  { id: 41, name: 'spruce_leaves', tex: { all: 'leaves:#3d6340' }, ...LEAVES },
  { id: 42, name: 'birch_log', tex: { top: 'log_top:#cfbf86:#d8d7d0', side: 'birch_side' }, ...LOG },
  { id: 43, name: 'birch_planks', tex: { all: 'planks:#c4b37b' }, ...PLANKS },
  { id: 44, name: 'birch_leaves', tex: { all: 'leaves:#6a9a46' }, ...LEAVES },
  { id: 45, name: 'jungle_log', tex: { top: 'log_top:#a87a4b:#5a4521', side: 'log_side:#5a4521' }, ...LOG },
  { id: 46, name: 'jungle_planks', tex: { all: 'planks:#a5764d' }, ...PLANKS },
  { id: 47, name: 'jungle_leaves', tex: { all: 'leaves_tint' }, ...LEAVES, tint: 'foliage', bonus: [['stick', 0.04]] },
  { id: 48, name: 'acacia_log', tex: { top: 'log_top:#b0603a:#6a6359', side: 'log_side:#6a6359' }, ...LOG },
  { id: 49, name: 'acacia_planks', tex: { all: 'planks:#ad5d32' }, ...PLANKS },
  { id: 50, name: 'acacia_leaves', tex: { all: 'leaves_tint' }, ...LEAVES, tint: 'foliage', bonus: [['stick', 0.04]] },
  { id: 51, name: 'dark_oak_log', tex: { top: 'log_top:#4a3420:#3a2a16', side: 'log_side:#3a2a16' }, ...LOG },
  { id: 52, name: 'dark_oak_planks', tex: { all: 'planks:#4a3218' }, ...PLANKS },
  { id: 53, name: 'dark_oak_leaves', tex: { all: 'leaves_tint' }, ...LEAVES, tint: 'foliage', bonus: [['apple', 0.05], ['stick', 0.04]] },

  // ---- Stone family ----
  { id: 54, name: 'granite', tex: { all: 'speckled:#9a6b5a:#b08070:#7a5040' }, ...STONE },
  { id: 55, name: 'polished_granite', tex: { all: 'polished:#9d6a58' }, ...STONE },
  { id: 56, name: 'diorite', tex: { all: 'speckled:#bdbdbd:#e8e8e8:#7a7a7a' }, ...STONE },
  { id: 57, name: 'polished_diorite', tex: { all: 'polished:#c4c4c6' }, ...STONE },
  { id: 58, name: 'andesite', tex: { all: 'speckled:#888888:#a0a0a0:#6a6a6a' }, ...STONE },
  { id: 59, name: 'polished_andesite', tex: { all: 'polished:#848786' }, ...STONE },
  { id: 60, name: 'stone_bricks', tex: { all: 'stone_bricks' }, ...STONE },
  { id: 61, name: 'mossy_stone_bricks', tex: { all: 'stone_bricks:mossy' }, ...STONE },
  { id: 62, name: 'cracked_stone_bricks', tex: { all: 'stone_bricks:cracked' }, ...STONE },
  { id: 63, name: 'chiseled_stone_bricks', tex: { all: 'chiseled_stone' }, ...STONE },
  { id: 64, name: 'mossy_cobblestone', tex: { all: 'cobblestone:mossy' }, ...STONE, hardness: 2 },
  { id: 65, name: 'smooth_stone', tex: { all: 'polished:#9e9e9e' }, ...STONE, hardness: 2 },
  { id: 66, name: 'chiseled_sandstone', tex: { top: 'sandstone_top:#d8cc90', side: 'chiseled_sandstone:#d8cc90', bottom: 'sandstone_top:#d8cc90' }, ...STONE, hardness: 0.8 },
  { id: 67, name: 'smooth_sandstone', tex: { top: 'sandstone_top:#d8cc90', side: 'smooth_sandstone:#d8cc90', bottom: 'sandstone_top:#d8cc90' }, ...STONE, hardness: 0.8 },
  { id: 68, name: 'red_sand', tex: { all: 'sand:#be6b2b' }, hardness: 0.5, tool: 'shovel', sound: 'sand', cat: 'nature' },
  { id: 69, name: 'red_sandstone', tex: { top: 'sandstone_top:#ba6528', side: 'sandstone_side:#ba6528', bottom: 'sandstone_bottom:#ba6528' }, ...STONE, hardness: 0.8 },
  { id: 70, name: 'chiseled_red_sandstone', tex: { top: 'sandstone_top:#ba6528', side: 'chiseled_sandstone:#ba6528', bottom: 'sandstone_top:#ba6528' }, ...STONE, hardness: 0.8 },
  { id: 71, name: 'smooth_red_sandstone', tex: { top: 'sandstone_top:#ba6528', side: 'smooth_sandstone:#ba6528', bottom: 'sandstone_top:#ba6528' }, ...STONE, hardness: 0.8 },
  { id: 72, name: 'clay', tex: { all: 'noise:#a0a6b3:0.05' }, hardness: 0.6, tool: 'shovel', drops: ['clay_ball', 4, 4], sound: 'gravel', cat: 'nature' },
  { id: 73, name: 'terracotta', tex: { all: 'terracotta:#985e43' }, ...STONE, hardness: 1.25 },
  // 74-89 stained terracotta, 98-113 concrete (see COLORS)

  // ---- Ores and mineral blocks ----
  { id: 114, name: 'emerald_ore', tex: { all: 'ore:#17dd62' }, ...ORE, harvest: 3, drops: 'emerald' },
  { id: 115, name: 'lapis_ore', displayName: 'Lapis Lazuli Ore', tex: { all: 'ore:#1d47a6' }, ...ORE, harvest: 2, drops: ['lapis_lazuli', 4, 8] },
  { id: 116, name: 'redstone_ore', tex: { all: 'ore:#c41010' }, ...ORE, harvest: 3, drops: ['redstone', 4, 5] },
  { id: 117, name: 'coal_block', displayName: 'Block of Coal', tex: { all: 'mineral:#1c1c1c' }, ...STONE, hardness: 5, fuel: 800, cat: 'building' },
  { id: 118, name: 'iron_block', displayName: 'Block of Iron', tex: { all: 'mineral:#dcdcdc' }, ...STONE, harvest: 2, hardness: 5 },
  { id: 119, name: 'gold_block', displayName: 'Block of Gold', tex: { all: 'mineral:#f5d742' }, ...STONE, harvest: 3, hardness: 3 },
  { id: 120, name: 'diamond_block', displayName: 'Block of Diamond', tex: { all: 'mineral:#5ee8e0' }, ...STONE, harvest: 3, hardness: 5 },
  { id: 121, name: 'emerald_block', displayName: 'Block of Emerald', tex: { all: 'mineral:#2bcf6a' }, ...STONE, harvest: 3, hardness: 5 },
  { id: 122, name: 'lapis_block', displayName: 'Lapis Lazuli Block', tex: { all: 'mineral:#2550b0' }, ...STONE, harvest: 2, hardness: 3 },
  { id: 123, name: 'redstone_block', displayName: 'Block of Redstone', tex: { all: 'mineral:#b01810' }, ...STONE, hardness: 5 },

  // ---- Natural blocks ----
  { id: 124, name: 'podzol', tex: { top: 'podzol_top', side: 'podzol_side', bottom: 'dirt' }, hardness: 0.5, tool: 'shovel', drops: 'dirt', sound: 'gravel', cat: 'nature' },
  { id: 125, name: 'mycelium', tex: { top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass', cat: 'nature' },
  { id: 126, name: 'coarse_dirt', tex: { all: 'coarse_dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel', cat: 'nature' },
  { id: 127, name: 'packed_ice', tex: { all: 'packed_ice' }, hardness: 0.5, tool: 'pickaxe', drops: null, sound: 'glass', cat: 'nature' },
  { id: 128, name: 'red_mushroom_block', tex: { all: 'mushroom_cap:#c22a24' }, hardness: 0.2, tool: 'axe', drops: ['red_mushroom', 0, 2], sound: 'wood', cat: 'nature' },
  { id: 129, name: 'brown_mushroom_block', tex: { all: 'mushroom_cap:#916d50' }, hardness: 0.2, tool: 'axe', drops: ['brown_mushroom', 0, 2], sound: 'wood', cat: 'nature' },
  { id: 130, name: 'mushroom_stem', tex: { all: 'mushroom_stem' }, hardness: 0.2, tool: 'axe', drops: null, sound: 'wood', cat: 'nature' },
  { id: 131, name: 'red_mushroom', tex: { all: 'small_mushroom:#c22a24' }, ...PLANT },
  { id: 132, name: 'brown_mushroom', tex: { all: 'small_mushroom:#916d50' }, ...PLANT, light: 1 },
  { id: 133, name: 'dead_bush', tex: { all: 'dead_bush' }, ...PLANT, drops: ['stick', 0, 2], replaceable: true },
  { id: 134, name: 'blue_orchid', tex: { all: 'flower:#2aa0e8:#1a70b0' }, ...PLANT },
  { id: 135, name: 'allium', tex: { all: 'allium' }, ...PLANT },
  { id: 136, name: 'azure_bluet', tex: { all: 'bluet' }, ...PLANT },
  { id: 137, name: 'red_tulip', tex: { all: 'tulip:#d8322b' }, ...PLANT },
  { id: 138, name: 'orange_tulip', tex: { all: 'tulip:#f07a20' }, ...PLANT },
  { id: 139, name: 'white_tulip', tex: { all: 'tulip:#efefef' }, ...PLANT },
  { id: 140, name: 'pink_tulip', tex: { all: 'tulip:#f0a6c8' }, ...PLANT },
  { id: 141, name: 'oxeye_daisy', tex: { all: 'flower:#f4f4f4:#f2c21a' }, ...PLANT },
  { id: 142, name: 'sunflower', tex: { all: 'sunflower' }, ...PLANT },
  { id: 143, name: 'lily_pad', tex: { all: 'lily_pad' }, ...PLANT, shape: 'flat' },
  { id: 144, name: 'wheat', displayName: 'Wheat Crops', tex: { all: 'wheat_crop' }, ...PLANT, drops: ['wheat', 1, 1], bonus: [['wheat_seeds', 0.8]] },
  { id: 145, name: 'farmland', tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'gravel', cat: 'nature' },
  { id: 146, name: 'melon', tex: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', drops: ['melon_slice', 3, 7], sound: 'wood', cat: 'nature' },
  { id: 147, name: 'pumpkin', tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' }, hardness: 1, tool: 'axe', sound: 'wood', cat: 'nature' },
  { id: 148, name: 'jack_o_lantern', displayName: "Jack o'Lantern", tex: { top: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face:lit' }, hardness: 1, tool: 'axe', light: 15, sound: 'wood', cat: 'decoration' },
  { id: 149, name: 'hay_bale', tex: { top: 'hay_top', side: 'hay_side' }, hardness: 0.5, sound: 'grass', cat: 'building' },
  { id: 150, name: 'bookshelf', tex: { top: 'planks:#a8864f', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', fuel: 15, sound: 'wood', cat: 'decoration' },
  { id: 151, name: 'obsidian', tex: { all: 'speckled:#140f1e:#2a1f3e:#0a0810' }, hardness: 50, tool: 'pickaxe', harvest: 4, sound: 'stone', cat: 'building' },
  { id: 152, name: 'glowstone', tex: { all: 'glowstone' }, hardness: 0.3, light: 15, sound: 'glass', cat: 'decoration' },
  { id: 153, name: 'sea_lantern', tex: { all: 'sea_lantern' }, hardness: 0.3, light: 15, drops: null, sound: 'glass', cat: 'decoration' },
  { id: 154, name: 'lava', tex: { all: 'lava' }, hardness: -1, solid: false, opaque: false, transparent: true, liquid: true, light: 15, lightOpacity: 15, drops: null, hidden: true },
  { id: 155, name: 'sponge', tex: { all: 'sponge' }, hardness: 0.6, sound: 'grass', cat: 'decoration' },
  { id: 156, name: 'quartz_block', displayName: 'Block of Quartz', tex: { all: 'polished:#ece6df' }, ...STONE, hardness: 0.8 },
  { id: 157, name: 'cobweb', tex: { all: 'cobweb' }, ...PLANT, hardness: 1, tool: 'sword', drops: 'string', cat: 'decoration' },
];

// Generated colour families. Existing wool ids (30-37) are kept for old saves.
const WOOL_IDS = { white: 30, red: 31, orange: 32, yellow: 33, green: 34, blue: 35, purple: 36, black: 37,
  magenta: 90, light_blue: 91, lime: 92, pink: 93, gray: 94, light_gray: 95, cyan: 96, brown: 97 };
COLORS.forEach(([color, wool, concrete, terracotta], i) => {
  BLOCK_LIST.push({ id: WOOL_IDS[color], name: `${color}_wool`, tex: { all: `wool:${wool}` }, hardness: 0.8, sound: 'cloth', cat: 'building' });
  BLOCK_LIST.push({ id: 74 + i, name: `${color}_terracotta`, tex: { all: `terracotta:${terracotta}` }, ...STONE, hardness: 1.25 });
  BLOCK_LIST.push({ id: 98 + i, name: `${color}_concrete`, tex: { all: `noise:${concrete}:0.025` }, ...STONE, hardness: 1.8 });
});

// Fill in defaults so the rest of the code can read every field safely.
const DEFAULTS = {
  solid: true, opaque: true, transparent: false, cutout: false, translucent: false, liquid: false,
  light: 0, lightOpacity: 15, shape: 'cube', tool: null, harvest: 0, tint: null,
  hardness: 1, sound: 'stone', replaceable: false, hidden: false, fuel: 0, bonus: [], cat: 'building',
};

export const BLOCKS = [];          // indexed by id (sparse array)
export const BLOCK_BY_NAME = {};   // name -> definition

for (const def of BLOCK_LIST) {
  if (BLOCKS[def.id]) throw new Error(`Duplicate block id ${def.id} (${def.name} vs ${BLOCKS[def.id].name})`);
  const b = { ...DEFAULTS, ...def };
  if (!b.displayName) {
    b.displayName = b.name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  if (b.drops === undefined) b.drops = b.name;
  BLOCKS[b.id] = b;
  BLOCK_BY_NAME[b.name] = b;
}

// Convenience constants for ids used in code (terrain generator etc.)
export const B = Object.fromEntries(BLOCK_LIST.map(b => [b.name.toUpperCase(), b.id]));

// Lookup tables as typed arrays: much faster than object property access in the
// inner loops of the mesher and light engine (which touch ~300k cells per chunk).
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256);
export const IS_TRANSPARENT = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const IS_TRANSLUCENT = new Uint8Array(256);
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256).fill(15);
export const SHAPE = new Uint8Array(256); // 0 cube, 1 cross, 2 torch, 3 flat, 255 none
export const TINT = new Uint8Array(256);  // 0 none, 1 grass, 2 foliage
for (const b of BLOCKS) {
  if (!b) continue;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_TRANSPARENT[b.id] = b.transparent ? 1 : 0;
  IS_LIQUID[b.id] = b.liquid ? 1 : 0;
  IS_TRANSLUCENT[b.id] = b.translucent ? 1 : 0;
  LIGHT_EMIT[b.id] = b.light;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  SHAPE[b.id] = b.id === 0 ? 255 : b.shape === 'cross' ? 1 : b.shape === 'torch' ? 2 : b.shape === 'flat' ? 3 : 0;
  TINT[b.id] = b.tint === 'grass' ? 1 : b.tint === 'foliage' ? 2 : 0;
}

/** Blocks that pop off when the block under them is removed. */
export function needsSupport(id) {
  const s = SHAPE[id];
  return s === 1 || s === 2 || s === 3;
}

export function isBlockId(id) {
  return id >= 0 && id < 256 && BLOCKS[id] !== undefined;
}
