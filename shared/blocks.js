// ============================================================================
// Block definitions. To add a block:
//   1. Add an entry to BLOCK_LIST below with a new unique id (< 1024), or for
//      blocks with states (facing, open/closed...) add a family at the END of
//      the families section (they get ids from 1024 up, in order). Never
//      change or reorder existing ids: saved worlds store blocks by id.
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
//   shape      'cube' (default) | 'cross' (plants) | 'torch' | 'flat' (lily pad, rails)
//              | 'wall_torch' | 'wall_flat' (ladder, vine) | 'crop' | 'fence' | 'wall'
//              | 'pane' | a box shape from shared/shapes.js ('stairs', 'slab', 'door'...)
//   faces      six texture names [+X, -X, +Y, -Y, +Z, -Z] (overrides `tex`)
//   state      for blocks in a family: {facing, half, open, axis, age...}
//   support    'below' | 'wall': what must stay solid for the block to survive
//   tint       'grass' | 'foliage': coloured by the biome it's in
//   cat        creative-inventory tab: 'building' | 'decoration' | 'nature'
//   sound      footstep/break sound family
// ============================================================================

import { FACINGS, FACING_VEC, staticBoxes, staticCollision } from './shapes.js';

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
  { id: 143, name: 'lily_pad', tex: { all: 'lily_pad' }, ...PLANT, shape: 'flat', solid: true, collide: 'lily', supportBlocks: ['water'] },
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

// ============================================================================
// Block families with STATES.
// A door can face 4 ways, be open or shut, and be a top or bottom half: that's
// 16 combinations. Each combination is its own block id (like Minecraft's old
// "metadata"). The first state of a family is the "item" form you hold; the
// rest are hidden from the creative menu and drop the base item.
// IMPORTANT: families get ids from 1024 upward IN THE ORDER WRITTEN HERE, so
// only ever ADD new families at the end, or saved worlds will scramble.
// ============================================================================

let nextId = 1024;
export const FAMILIES = {};             // base name -> { base, keys, map: stateKey -> id }
const stateKey = (st) => Object.keys(st).sort().map(k => `${k}=${st[k]}`).join(',');
const byName = (n) => BLOCK_LIST.find(d => d.name === n);

/**
 * Register a family. `list` = [[state, def], ...]; list[0] is the item form.
 * A def that already sits in BLOCK_LIST (found by name) keeps its id.
 */
function family(base, list) {
  const fam = { base, keys: Object.keys(list[0][0]), map: new Map() };
  FAMILIES[base] = fam;
  const baseDef = list[0][1];
  list.forEach(([state, def], i) => {
    if (def.id === undefined) def.id = nextId++;
    if (!def.name) def.name = i === 0 ? base : `${base}[${stateKey(state)}]`;
    if (i > 0) {
      def.hidden = true;
      if (!def.displayName) def.displayName = baseDef.displayName;
      if (def.drops === undefined) def.drops = baseDef.drops === undefined ? base : baseDef.drops;
    }
    def.base = base;
    def.state = state;
    fam.map.set(stateKey(state), def.id);
    if (i === 0) fam.baseId = def.id;
    if (!BLOCK_LIST.includes(def)) BLOCK_LIST.push(def);
  });
}
/** Every combination of the given property values, in order. */
function combos(props) {
  let out = [{}];
  for (const [k, vals] of Object.entries(props)) out = out.flatMap(o => vals.map(v => ({ ...o, [k]: v })));
  return out;
}
// Face index whose texture shows the "front" for a facing: +X,-X,+Y,-Y,+Z,-Z
const FRONT_FACE = { east: 0, west: 1, south: 4, north: 5 };
function facedFaces(side, top, bottom, front, facing) {
  const f = [side, side, top, bottom, side, side];
  f[FRONT_FACE[facing]] = front;
  return f;
}
const rotTex = (t) => `${t}@r`; // texture turned 90 degrees (sideways logs)

const WOODS = [
  // key, log, planks, leaves, plank colour, display prefix
  ['oak', 'log', 'planks', '#a8864f', 'Oak'],
  ['spruce', 'spruce_log', 'spruce_planks', '#735532', 'Spruce'],
  ['birch', 'birch_log', 'birch_planks', '#c4b37b', 'Birch'],
  ['jungle', 'jungle_log', 'jungle_planks', '#a5764d', 'Jungle'],
  ['acacia', 'acacia_log', 'acacia_planks', '#ad5d32', 'Acacia'],
  ['dark_oak', 'dark_oak_log', 'dark_oak_planks', '#4a3218', 'Dark Oak'],
];
const SHAPED = { solid: true, opaque: false, transparent: true, lightOpacity: 0 };

// ---- 1. Pillars: logs, hay, bone, quartz face the way they're placed ----------
function pillar(baseName, extra = null) {
  const b = byName(baseName) || extra;
  const top = b.tex.top, side = b.tex.side;
  family(baseName, [
    [{ axis: 'y' }, b],
    [{ axis: 'x' }, { ...b, id: undefined, name: undefined, tex: undefined, faces: [top, top, rotTex(side), rotTex(side), rotTex(side), rotTex(side)] }],
    [{ axis: 'z' }, { ...b, id: undefined, name: undefined, tex: undefined, faces: [rotTex(side), rotTex(side), side, side, top, top] }],
  ]);
}
for (const [, log] of WOODS) pillar(log);
pillar('hay_bale');
pillar('bone_block', { name: 'bone_block', tex: { top: 'bone_top', side: 'bone_side' }, hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });
pillar('quartz_pillar', { name: 'quartz_pillar', tex: { top: 'polished:#ece6df', side: 'quartz_pillar' }, hardness: 0.8, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });

// ---- 2. Wall torches (ids 158-161 already existed) ---------------------------
family('wall_torch', [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]].map(([facing, nx, nz], i) => [{ facing }, {
  id: 158 + i, displayName: 'Torch', tex: { all: 'torch' }, hardness: 0, solid: false, opaque: false, transparent: true,
  lightOpacity: 0, light: 14, shape: 'wall_torch', wall: [nx, nz], drops: 'torch', sound: 'wood', hidden: true, placeable: true,
}]));

// ---- 3. Stairs and slabs -------------------------------------------------------
const STAIR_MATERIALS = [
  // family prefix, source block, display, extra props
  ...WOODS.map(([k, , planks, , disp]) => [k, planks, disp, { tool: 'axe', sound: 'wood', fuel: 15, hardness: 2, harvest: 0 }]),
  ['cobblestone', 'cobblestone', 'Cobblestone', {}],
  ['stone_brick', 'stone_bricks', 'Stone Brick', {}],
  ['brick', 'bricks', 'Brick', {}],
  ['sandstone', 'sandstone', 'Sandstone', {}],
  ['red_sandstone', 'red_sandstone', 'Red Sandstone', {}],
  ['quartz', 'quartz_block', 'Quartz', {}],
];
function texFacesOf(src) {
  const t = src.tex;
  const side = t.side || t.all;
  return [side, side, t.top || t.all, t.bottom || t.top || t.all, side, side];
}
for (const [key, srcName, disp, extra] of STAIR_MATERIALS) {
  const src = byName(srcName);
  const common = { ...SHAPED, faces: texFacesOf(src), hardness: src.hardness, tool: src.tool, harvest: src.harvest, sound: src.sound, cat: 'building', ...extra };
  family(`${key}_stairs`, combos({ half: ['bottom', 'top'], facing: FACINGS }).map(st => [st, { ...common, shape: 'stairs', displayName: `${disp} Stairs` }]));
  family(`${key}_slab`, combos({ half: ['bottom', 'top'] }).map(st => [st, { ...common, shape: 'slab', displayName: `${disp} Slab`, double: srcName }]));
}
{
  const common = { ...SHAPED, faces: ['stone_slab_side', 'stone_slab_side', 'polished:#9e9e9e', 'polished:#9e9e9e', 'stone_slab_side', 'stone_slab_side'], hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' };
  family('stone_slab', combos({ half: ['bottom', 'top'] }).map(st => [st, { ...common, shape: 'slab', displayName: 'Stone Slab', double: 'smooth_stone' }]));
}

// ---- 4. Doors, trapdoors, fences, gates -----------------------------------------
const DOOR_KINDS = [...WOODS.map(([k, , , col, disp]) => [k, col, disp]), ['iron', 'iron', 'Iron']];
for (const [key, col, disp] of DOOR_KINDS) {
  const iron = key === 'iron';
  const common = { ...SHAPED, shape: 'door', door: true, hardness: iron ? 5 : 3, tool: iron ? 'pickaxe' : 'axe', harvest: iron ? 1 : 0,
    sound: iron ? 'stone' : 'wood', cat: 'redstone', itemTex: `door_item:${col}`, support: 'below' };
  family(`${key}_door`, combos({ half: ['lower', 'upper'], open: [false, true], facing: FACINGS }).map(st => {
    const t = `door_${st.half === 'lower' ? 'bottom' : 'top'}:${col}`;
    // only the lower half drops the door, so breaking a door gives back one item
    return [st, { ...common, displayName: `${disp} Door`, faces: [t, t, t, t, t, t], drops: st.half === 'lower' ? `${key}_door` : null }];
  }));
}
for (const [key, col, disp] of [['oak', '#a8864f', 'Wooden'], ['iron', 'iron', 'Iron']]) {
  const t = `trapdoor:${col}`;
  family(`${key}_trapdoor`, combos({ half: ['bottom', 'top'], open: [false, true], facing: FACINGS }).map(st => [st, {
    ...SHAPED, shape: 'trapdoor', displayName: `${disp} Trapdoor`, faces: [t, t, t, t, t, t], hardness: key === 'iron' ? 5 : 3,
    tool: key === 'iron' ? 'pickaxe' : 'axe', harvest: key === 'iron' ? 1 : 0, sound: key === 'iron' ? 'stone' : 'wood', cat: 'redstone' }]));
}
for (const [key, , planks, , disp] of WOODS) {
  const p = byName(planks).tex.all;
  family(`${key}_fence`, [[{}, { ...SHAPED, shape: 'fence', connect: 'fence', displayName: `${disp} Fence`, faces: [p, p, p, p, p, p], hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, cat: 'decoration' }]]);
  family(`${key}_fence_gate`, combos({ open: [false, true], facing: FACINGS }).map(st => [st, {
    ...SHAPED, shape: 'gate', gate: true, displayName: `${disp} Fence Gate`, faces: [p, p, p, p, p, p], hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, cat: 'redstone' }]));
}
for (const [name, tex, disp] of [['cobblestone_wall', 'cobblestone', 'Cobblestone Wall'], ['mossy_cobblestone_wall', 'cobblestone:mossy', 'Mossy Cobblestone Wall']]) {
  family(name, [[{}, { ...SHAPED, shape: 'wall', connect: 'wall', displayName: disp, faces: [tex, tex, tex, tex, tex, tex], hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'decoration' }]]);
}
family('glass_pane', [[{}, { ...SHAPED, shape: 'pane', connect: 'pane', cutout: true, faces: Array(6).fill('glass'), hardness: 0.3, drops: null, sound: 'glass', cat: 'decoration' }]]);
family('iron_bars', [[{}, { ...SHAPED, shape: 'pane', connect: 'pane', cutout: true, faces: Array(6).fill('iron_bars'), hardness: 5, tool: 'pickaxe', sound: 'stone', cat: 'decoration' }]]);

// ---- 5. Colour families ---------------------------------------------------------
COLORS.forEach(([color, wool, concrete, terracotta]) => {
  const disp = color.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  family(`${color}_stained_glass`, [[{}, { tex: { all: `stained_glass:${wool}` }, displayName: `${disp} Stained Glass`, opaque: false, transparent: true, translucent: true, lightOpacity: 0, hardness: 0.3, drops: null, sound: 'glass', cat: 'building' }]]);
  family(`${color}_stained_glass_pane`, [[{}, { ...SHAPED, shape: 'pane', connect: 'pane', translucent: true, faces: Array(6).fill(`stained_glass:${wool}`), displayName: `${disp} Stained Glass Pane`, hardness: 0.3, drops: null, sound: 'glass', cat: 'decoration' }]]);
  family(`${color}_carpet`, [[{}, { ...SHAPED, shape: 'carpet', faces: Array(6).fill(`wool:${wool}`), displayName: `${disp} Carpet`, hardness: 0.1, sound: 'cloth', cat: 'decoration', support: 'below' }]]);
  family(`${color}_concrete_powder`, [[{}, { tex: { all: `powder:${concrete}` }, displayName: `${disp} Concrete Powder`, hardness: 0.5, tool: 'shovel', sound: 'sand', cat: 'building', powderOf: `${color}_concrete` }]]);
  family(`${color}_glazed_terracotta`, [[{}, { tex: { all: `glazed:${terracotta}:${wool}` }, displayName: `${disp} Glazed Terracotta`, hardness: 1.4, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'decoration' }]]);
  family(`${color}_bed`, combos({ part: ['foot', 'head'], facing: FACINGS }).map(st => {
    // the pillow is painted at the north end; turn it to face the right way
    const top = `bed_${st.part}:${wool}` + { north: '', west: '@r1', south: '@r2', east: '@r3' }[st.facing];
    return [st, { ...SHAPED, shape: 'bed', bed: true, displayName: `${disp} Bed`, faces: [`bed_side:${wool}`, `bed_side:${wool}`, top, 'planks:#a8864f', `bed_side:${wool}`, `bed_side:${wool}`],
      hardness: 0.2, sound: 'wood', drops: st.part === 'foot' ? `${color}_bed` : null, cat: 'decoration', itemTex: `bed_item:${wool}`, support: 'below' }];
  }));
});

// ---- 6. Containers and work blocks that face you ------------------------------------
const facingFamily = (base, def, side, top, bottom, front) => family(base, FACINGS.map(f => [{ facing: f }, { ...def, faces: facedFaces(side, top, bottom, front, f) }]).sort((a, b) => (a[0].facing === 'south' ? -1 : b[0].facing === 'south' ? 1 : 0)));
facingFamily('chest', { ...SHAPED, shape: 'chest', container: 'chest', hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 15, cat: 'decoration' }, 'chest_side', 'chest_top', 'chest_top', 'chest_front');
facingFamily('trapped_chest', { ...SHAPED, shape: 'chest', container: 'chest', hardness: 2.5, tool: 'axe', sound: 'wood', cat: 'redstone' }, 'chest_side', 'chest_top', 'chest_top', 'chest_front:trapped');
// Generated dungeon/village chests: open once to roll their loot, then they become normal chests.
family('loot_chest', [[{}, { ...SHAPED, shape: 'chest', container: 'chest', loot: true, faces: facedFaces('chest_side', 'chest_top', 'chest_top', 'chest_front', 'south'), hidden: true, hardness: 2.5, tool: 'axe', sound: 'wood', drops: 'chest' }]]);
facingFamily('dispenser', { hardness: 3.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'redstone' }, 'furnace_side', 'furnace_top', 'furnace_top', 'dispenser_front');
facingFamily('dropper', { hardness: 3.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'redstone' }, 'furnace_side', 'furnace_top', 'furnace_top', 'dropper_front');
facingFamily('observer', { hardness: 3, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'redstone' }, 'observer_side', 'observer_side', 'observer_side', 'observer_front');

// ---- 7. Wall-mounted and floor things -------------------------------------------------
const WALLED = { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, support: 'wall' };
family('ladder', FACINGS.map(f => [{ facing: f }, { ...WALLED, shape: 'wall_flat', climbable: true, tex: { all: 'ladder' }, hardness: 0.4, tool: 'axe', sound: 'wood', cat: 'decoration' }]));
family('vine', FACINGS.map(f => [{ facing: f }, { ...WALLED, support: null, shape: 'wall_flat', climbable: true, tint: 'foliage', tex: { all: 'vine' }, hardness: 0.2, drops: null, replaceable: true, sound: 'grass', cat: 'decoration' }]));
family('redstone_torch', [[{}, { tex: { all: 'torch:redstone' }, hardness: 0, solid: false, opaque: false, transparent: true, lightOpacity: 0, light: 7, shape: 'torch', sound: 'wood', cat: 'redstone', support: 'below' }]]);
family('redstone_wall_torch', [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]].map(([facing, nx, nz]) => [{ facing }, {
  displayName: 'Redstone Torch', tex: { all: 'torch:redstone' }, hardness: 0, solid: false, opaque: false, transparent: true, lightOpacity: 0, light: 7,
  shape: 'wall_torch', wall: [nx, nz], drops: 'redstone_torch', sound: 'wood', hidden: true, placeable: true }]));
for (const [name, tex, disp, extra] of [['stone_button', 'stone', 'Stone Button', { tool: 'pickaxe' }], ['oak_button', 'planks:#a8864f', 'Wooden Button', { tool: 'axe' }]]) {
  family(name, FACINGS.map(f => [{ facing: f }, { ...WALLED, cutout: false, shape: 'button', faces: Array(6).fill(tex), displayName: disp, hardness: 0.5, sound: 'stone', cat: 'redstone', ...extra }]));
}
for (const [name, tex, disp] of [['stone_pressure_plate', 'stone', 'Stone Pressure Plate'], ['oak_pressure_plate', 'planks:#a8864f', 'Wooden Pressure Plate'],
  ['light_weighted_pressure_plate', 'mineral:#f5d742', 'Light Weighted Pressure Plate'], ['heavy_weighted_pressure_plate', 'mineral:#dcdcdc', 'Heavy Weighted Pressure Plate']]) {
  family(name, [[{}, { ...SHAPED, solid: false, shape: 'plate', faces: Array(6).fill(tex), displayName: disp, hardness: 0.5, sound: 'stone', cat: 'redstone', support: 'below' }]]);
}
family('lever', [[{}, { ...SHAPED, solid: false, shape: 'lever', faces: Array(6).fill('lever'), hardness: 0.5, sound: 'wood', cat: 'redstone', support: 'below' }]]);
for (const [name, tex, disp] of [['rail', 'rail', 'Rail'], ['powered_rail', 'rail:powered', 'Powered Rail'], ['detector_rail', 'rail:detector', 'Detector Rail'], ['activator_rail', 'rail:activator', 'Activator Rail']]) {
  family(name, [['ns', 'north'], ['ew', 'east']].map(([dir]) => [{ dir }, { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'flat', flatRot: dir === 'ew',
    tex: { all: tex }, displayName: disp, hardness: 0.7, tool: 'pickaxe', sound: 'stone', cat: 'transport', support: 'below' }]));
}
family('redstone_wire', [[{}, { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'flat', tex: { all: 'redstone_dust' }, displayName: 'Redstone Dust', hardness: 0, drops: 'redstone', hidden: true, placeable: true, support: 'below' }]]);
family('repeater', FACINGS.map(f => [{ facing: f }, { ...SHAPED, shape: 'repeater', faces: ['smooth_stone_edge', 'smooth_stone_edge', 'repeater_top', 'polished:#9e9e9e', 'smooth_stone_edge', 'smooth_stone_edge'],
  displayName: 'Redstone Repeater', hardness: 0, sound: 'stone', cat: 'redstone', support: 'below', itemTex: 'repeater_item' }]));

// ---- 8. Odd-shaped furniture -----------------------------------------------------------------
family('cake', [0, 1, 2, 3, 4, 5, 6].map(b => [{ bites: b }, { ...SHAPED, shape: 'cake', faces: [b ? 'cake_inner' : 'cake_side', 'cake_side', 'cake_top', 'cake_bottom', 'cake_side', 'cake_side'],
  hardness: 0.5, drops: null, sound: 'cloth', cat: 'food', itemTex: 'cake_item', support: 'below' }]));
family('flower_pot', [[{}, { ...SHAPED, shape: 'flower_pot', faces: Array(6).fill('flower_pot'), hardness: 0, sound: 'stone', cat: 'decoration', support: 'below' }]]);
family('enchanting_table', [[{}, { ...SHAPED, shape: 'table', faces: ['enchant_side', 'enchant_side', 'enchant_top', 'speckled:#140f1e:#2a1f3e:#0a0810', 'enchant_side', 'enchant_side'], hardness: 5, tool: 'pickaxe', harvest: 1, light: 7, sound: 'stone', cat: 'decoration' }]]);
family('daylight_detector', [[{}, { ...SHAPED, shape: 'sensor', faces: ['daylight_side', 'daylight_side', 'daylight_top', 'daylight_side', 'daylight_side', 'daylight_side'], hardness: 0.2, tool: 'axe', sound: 'wood', cat: 'redstone' }]]);
family('hopper', [[{}, { ...SHAPED, shape: 'hopper', faces: ['hopper_side', 'hopper_side', 'hopper_top', 'hopper_side', 'hopper_side', 'hopper_side'], hardness: 3, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'redstone', itemTex: 'hopper_item' }]]);
family('cauldron', [[{}, { ...SHAPED, shape: 'cauldron', faces: ['cauldron_side', 'cauldron_side', 'cauldron_top', 'cauldron_side', 'cauldron_side', 'cauldron_side'], hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'misc', itemTex: 'cauldron_item' }]]);
family('anvil', ['north', 'east'].map(f => [{ facing: f }, { ...SHAPED, shape: 'anvil', faces: Array(6).fill('anvil'), hardness: 5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'decoration' }]));
family('cocoa', FACINGS.map(f => [{ facing: f }, { ...SHAPED, solid: false, shape: 'cocoa', support: 'wall', supportBlocks: ['jungle_log'], faces: Array(6).fill('cocoa'), hardness: 0.2, drops: ['cocoa_beans', 2, 3], sound: 'wood', hidden: true, placeable: true }]));
family('snow_layer', [[{}, { ...SHAPED, shape: 'snow_layer', faces: Array(6).fill('snow'), hardness: 0.1, tool: 'shovel', drops: ['snowball', 1, 1], replaceable: true, sound: 'snow', cat: 'decoration', support: 'below' }]]);

// ---- 9. Crops, saplings, tall plants ---------------------------------------------------------
const CROP = { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'crop', hardness: 0, sound: 'grass', hidden: true, placeable: true, support: 'below', supportBlocks: ['farmland'], crop: true };
const ages = (n) => Array.from({ length: n }, (_, i) => i);
family('wheat_crop', ages(8).map(a => [{ age: a }, { ...CROP, id: a === 7 ? 144 : undefined, name: a === 7 ? 'wheat' : undefined, displayName: 'Wheat Crops', tex: { all: `wheat_stage:${a}` },
  maxAge: 7, drops: a === 7 ? ['wheat', 1, 1] : ['wheat_seeds', 1, 1], bonus: a === 7 ? [['wheat_seeds', 0.9], ['wheat_seeds', 0.5]] : [] }]));
family('carrots', ages(4).map(a => [{ age: a }, { ...CROP, displayName: 'Carrots', tex: { all: `carrot_stage:${a}` }, maxAge: 3, drops: a === 3 ? ['carrot', 2, 4] : ['carrot', 1, 1] }]));
family('potatoes', ages(4).map(a => [{ age: a }, { ...CROP, displayName: 'Potatoes', tex: { all: `potato_stage:${a}` }, maxAge: 3, drops: a === 3 ? ['potato', 2, 4] : ['potato', 1, 1], bonus: a === 3 ? [['poisonous_potato', 0.02]] : [] }]));
family('beetroots', ages(4).map(a => [{ age: a }, { ...CROP, displayName: 'Beetroots', tex: { all: `beet_stage:${a}` }, maxAge: 3, drops: a === 3 ? ['beetroot', 1, 1] : ['beetroot_seeds', 1, 1], bonus: a === 3 ? [['beetroot_seeds', 0.9], ['beetroot_seeds', 0.5]] : [] }]));
for (const [key, , , , disp] of WOODS) {
  const leafCol = { oak: '#4a8a2a', spruce: '#3d6340', birch: '#6a9a46', jungle: '#3a9a1a', acacia: '#7a9a2a', dark_oak: '#3e6b24' }[key];
  family(`${key}_sapling`, [[{}, { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', tex: { all: `sapling:${leafCol}` },
    displayName: `${disp} Sapling`, hardness: 0, sound: 'grass', cat: 'nature', support: 'below', supportBlocks: ['grass', 'dirt', 'podzol', 'coarse_dirt', 'snowy_grass'], sapling: key, fuel: 5 }]]);
}
family('sugar_cane', [[{}, { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', tex: { all: 'sugar_cane' }, hardness: 0, sound: 'grass', cat: 'nature', support: 'below', supportBlocks: ['sugar_cane', 'grass', 'dirt', 'sand', 'red_sand', 'podzol'], needsWater: true }]]);
for (const [name, col, disp] of [['lilac', '#c890d8', 'Lilac'], ['rose_bush', '#c8282a', 'Rose Bush'], ['peony', '#e8a8d8', 'Peony']]) {
  family(name, [[{}, { solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', tex: { all: `bush_flower:${col}` }, displayName: disp, hardness: 0, sound: 'grass', cat: 'nature', support: 'below' }]]);
}

// ---- 10. More cube blocks -------------------------------------------------------------------
const cube = (name, def) => family(name, [[{}, def]]);
cube('tnt', { tex: { top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }, displayName: 'TNT', hardness: 0, sound: 'grass', cat: 'redstone' });
cube('note_block', { tex: { all: 'note_block' }, hardness: 0.8, tool: 'axe', sound: 'wood', fuel: 15, cat: 'redstone' });
cube('jukebox', { tex: { top: 'jukebox_top', side: 'note_block' }, hardness: 2, tool: 'axe', sound: 'wood', fuel: 15, cat: 'decoration' });
cube('piston', { tex: { top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 0.5, tool: 'pickaxe', sound: 'stone', cat: 'redstone' });
cube('sticky_piston', { tex: { top: 'piston_top:sticky', side: 'piston_side', bottom: 'piston_bottom' }, hardness: 0.5, tool: 'pickaxe', sound: 'stone', cat: 'redstone' });
cube('redstone_lamp', { tex: { all: 'redstone_lamp' }, light: 15, hardness: 0.3, sound: 'glass', cat: 'redstone' });
cube('slime_block', { tex: { all: 'slime' }, opaque: false, transparent: true, translucent: true, lightOpacity: 1, hardness: 0, sound: 'cloth', cat: 'redstone' });
cube('spawner', { tex: { all: 'spawner' }, opaque: false, transparent: true, cutout: true, lightOpacity: 1, hardness: 5, tool: 'pickaxe', harvest: 1, drops: null, sound: 'stone', cat: 'decoration' });
cube('prismarine', { tex: { all: 'prismarine' }, hardness: 1.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });
cube('prismarine_bricks', { tex: { all: 'prismarine_bricks' }, hardness: 1.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });
cube('dark_prismarine', { tex: { all: 'dark_prismarine' }, hardness: 1.5, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });
cube('grass_path', { tex: { top: 'grass_path_top', side: 'grass_path_side', bottom: 'dirt' }, hardness: 0.65, tool: 'shovel', drops: 'dirt', sound: 'grass', cat: 'decoration' });
cube('chiseled_quartz_block', { tex: { top: 'polished:#ece6df', side: 'chiseled_quartz' }, hardness: 0.8, tool: 'pickaxe', harvest: 1, sound: 'stone', cat: 'building' });
cube('wet_sponge', { tex: { all: 'sponge:wet' }, hardness: 0.6, sound: 'grass', cat: 'decoration' });

// ---- Defaults and lookup tables -----------------------------------------------------------
const DEFAULTS = {
  solid: true, opaque: true, transparent: false, cutout: false, translucent: false, liquid: false,
  light: 0, lightOpacity: 15, shape: 'cube', tool: null, harvest: 0, tint: null,
  hardness: 1, sound: 'stone', replaceable: false, hidden: false, fuel: 0, bonus: [], cat: 'building',
};

export const MAX_ID = 4096;
export const BLOCKS = [];          // indexed by id (sparse array)
export const BLOCK_BY_NAME = {};   // name -> definition

for (const def of BLOCK_LIST) {
  if (def.id >= MAX_ID) throw new Error(`Block id ${def.id} too large`);
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
export const B = Object.fromEntries(BLOCK_LIST.filter(b => !b.name.includes('[')).map(b => [b.name.toUpperCase(), b.id]));

// Shape codes used by the mesher and physics.
export const SHAPE_CODE = { cube: 0, cross: 1, torch: 2, flat: 3, wall_torch: 4, boxes: 5, fence: 6, wall: 7, pane: 8, wall_flat: 9, crop: 10 };
const DYNAMIC = { fence: 6, wall: 7, pane: 8 };

// Lookup tables as typed arrays: much faster than object property access in the
// inner loops of the mesher and light engine (which touch ~600k cells per chunk).
export const IS_SOLID = new Uint8Array(MAX_ID);
export const IS_OPAQUE = new Uint8Array(MAX_ID);
export const IS_TRANSPARENT = new Uint8Array(MAX_ID);
export const IS_LIQUID = new Uint8Array(MAX_ID);
export const IS_TRANSLUCENT = new Uint8Array(MAX_ID);
export const IS_CLIMBABLE = new Uint8Array(MAX_ID);
export const LIGHT_EMIT = new Uint8Array(MAX_ID);
export const LIGHT_OPACITY = new Uint8Array(MAX_ID).fill(15);
export const SHAPE = new Uint8Array(MAX_ID);       // see SHAPE_CODE; 255 = air
export const WALL_DIR = new Int8Array(MAX_ID * 2); // wall-mounted blocks: direction away from the wall
export const TINT = new Uint8Array(MAX_ID);        // 0 none, 1 grass, 2 foliage
export const CONNECT = new Uint8Array(MAX_ID);     // fences/walls/panes join: 1 fence, 2 wall, 3 pane, 4 gate
export const BOXES = new Array(MAX_ID).fill(null);   // drawn boxes for box shapes
export const COLLIDE = new Array(MAX_ID).fill(null); // collision boxes when different from a full cube
export const SUPPORT = new Uint8Array(MAX_ID);     // 0 none, 1 block below, 2 wall behind
for (const b of BLOCKS) {
  if (!b) continue;
  const id = b.id;
  IS_SOLID[id] = b.solid ? 1 : 0;
  IS_OPAQUE[id] = b.opaque ? 1 : 0;
  IS_TRANSPARENT[id] = b.transparent ? 1 : 0;
  IS_LIQUID[id] = b.liquid ? 1 : 0;
  IS_TRANSLUCENT[id] = b.translucent ? 1 : 0;
  IS_CLIMBABLE[id] = b.climbable ? 1 : 0;
  LIGHT_EMIT[id] = b.light;
  LIGHT_OPACITY[id] = b.lightOpacity;
  TINT[id] = b.tint === 'grass' ? 1 : b.tint === 'foliage' ? 2 : 0;
  CONNECT[id] = b.gate ? 4 : b.connect === 'fence' ? 1 : b.connect === 'wall' ? 2 : b.connect === 'pane' ? 3 : 0;
  if (id === 0) { SHAPE[id] = 255; continue; }
  const st = b.state || {};
  const facingVec = st.facing ? FACING_VEC[st.facing] : null;
  if (b.wall) { WALL_DIR[id * 2] = b.wall[0]; WALL_DIR[id * 2 + 1] = b.wall[1]; }
  else if (facingVec) { WALL_DIR[id * 2] = facingVec[0]; WALL_DIR[id * 2 + 1] = facingVec[1]; }
  const boxes = staticBoxes(b.shape, st);
  if (boxes) {
    SHAPE[id] = SHAPE_CODE.boxes;
    BOXES[id] = boxes;
    COLLIDE[id] = staticCollision(b.shape, st) || boxes;
  } else if (DYNAMIC[b.shape]) {
    SHAPE[id] = DYNAMIC[b.shape];
  } else {
    SHAPE[id] = SHAPE_CODE[b.shape] ?? 0;
  }
  if (b.collide) COLLIDE[id] = staticCollision(b.collide, st);
  SUPPORT[id] = b.support === 'wall' || b.shape === 'wall_torch' ? 2
    : (b.support === 'below' || b.shape === 'cross' || b.shape === 'torch' || b.shape === 'flat' || b.shape === 'crop') ? 1 : 0;
}

/** Blocks that pop off when the block holding them up is removed. */
export function needsSupport(id) { return SUPPORT[id] !== 0; }

/** Position of the block that holds up block `id` at (x, y, z). */
export function supportPos(id, x, y, z) {
  if (SUPPORT[id] === 2) return [x - WALL_DIR[id * 2], y, z - WALL_DIR[id * 2 + 1]];
  return [x, y - 1, z];
}

/** Can block `id` stay at (x,y,z)? Checks its support block. */
export function isSupported(id, x, y, z, getBlock) {
  if (!SUPPORT[id]) return true;
  const [sx, sy, sz] = supportPos(id, x, y, z);
  const s = getBlock(sx, sy, sz);
  const def = BLOCKS[id];
  if (def.supportBlocks) return def.supportBlocks.some(n => BLOCK_BY_NAME[n] && (BLOCK_BY_NAME[n].id === s || BLOCKS[s]?.base === n));
  return IS_SOLID[s] === 1 && (SHAPE[s] === 0 || SHAPE[s] === SHAPE_CODE.boxes);
}

// ---- State helpers -------------------------------------------------------------------------
/** Id of the block in family `base` with the given state, or 0. */
export function stateId(base, state) {
  const fam = FAMILIES[base];
  if (!fam) return 0;
  return fam.map.get(stateKey(state)) || 0;
}
/** Same family, some properties changed (e.g. open a door). */
export function withState(id, changes) {
  const b = BLOCKS[id];
  if (!b || !b.base) return id;
  return stateId(b.base, { ...b.state, ...changes }) || id;
}
/** The base (item) id of a block's family. */
export function baseOf(id) {
  const b = BLOCKS[id];
  return b && b.base ? FAMILIES[b.base].baseId : id;
}

/** The wall-torch block that points along (nx, nz), or 0. */
export function wallTorchFor(nx, nz, base = 'wall_torch') {
  const f = Object.keys(FACING_VEC).find(k => FACING_VEC[k][0] === nx && FACING_VEC[k][1] === nz);
  return f ? stateId(base, { facing: f }) : 0;
}

export function isBlockId(id) {
  return Number.isInteger(id) && id >= 0 && id < MAX_ID && BLOCKS[id] !== undefined;
}
