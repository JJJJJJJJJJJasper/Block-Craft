// ============================================================================
// Block definitions. To add a block:
//   1. Add an entry to BLOCK_LIST below with a new unique id (< 256).
//   2. Give it texture names (top/side/bottom or `all`). If the texture name is
//      new, add a painter for it in client/rendering/textures.js
//      (or reuse a generic one, see `TEXTURE_PAINTERS`).
//   3. Optionally add a crafting recipe in shared/recipes.js.
//
// Fields:
//   hardness   seconds-ish of base break time (-1 = unbreakable, 0 = instant)
//   tool       which tool type mines it fastest: 'pickaxe' | 'axe' | 'shovel' | null
//   harvest    minimum tool tier needed for it to DROP anything in survival
//              (0 = hand, 1 = wood, 2 = stone, 3 = iron, 4 = diamond)
//   drops      item name dropped (defaults to the block itself; null = nothing)
//   solid      collides with players/mobs
//   opaque     blocks light completely and hides neighbouring faces
//   transparent is see-through (glass, leaves, water). Faces between two
//              different transparent blocks are drawn; between identical ones
//              they're culled.
//   cutout     drawn in the opaque pass but with alpha-tested holes (leaves, glass)
//   liquid     water-like (swimmable, drawn in the translucent pass)
//   light      light level the block emits (0-15)
//   lightOpacity how much skylight/blocklight is lost passing through (0-15)
//   shape      'cube' (default) | 'cross' (plants) | 'torch'
//   sound      footstep/break sound family
// ============================================================================

const BLOCK_LIST = [
  { id: 0, name: 'air', solid: false, opaque: false, transparent: true, lightOpacity: 0, hardness: 0 },
  { id: 1, name: 'grass', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'grass' },
  { id: 2, name: 'dirt', tex: { all: 'dirt' }, hardness: 0.5, tool: 'shovel', sound: 'gravel' },
  { id: 3, name: 'stone', tex: { all: 'stone' }, hardness: 1.5, tool: 'pickaxe', harvest: 1, drops: 'cobblestone', sound: 'stone' },
  { id: 4, name: 'cobblestone', tex: { all: 'cobblestone' }, hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone' },
  { id: 5, name: 'sand', tex: { all: 'sand' }, hardness: 0.5, tool: 'shovel', sound: 'sand' },
  { id: 6, name: 'gravel', tex: { all: 'gravel' }, hardness: 0.6, tool: 'shovel', sound: 'gravel' },
  { id: 7, name: 'log', displayName: 'Wood Log', tex: { top: 'log_top', side: 'log_side', bottom: 'log_top' }, hardness: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  { id: 8, name: 'planks', displayName: 'Wood Planks', tex: { all: 'planks' }, hardness: 2, tool: 'axe', sound: 'wood', fuel: 15 },
  { id: 9, name: 'leaves', tex: { all: 'leaves' }, hardness: 0.2, tool: null, opaque: false, transparent: true, cutout: true, lightOpacity: 1, drops: null, sound: 'grass' },
  { id: 10, name: 'glass', tex: { all: 'glass' }, hardness: 0.3, opaque: false, transparent: true, cutout: true, lightOpacity: 0, drops: null, sound: 'glass' },
  { id: 11, name: 'water', tex: { all: 'water' }, hardness: -1, solid: false, opaque: false, transparent: true, liquid: true, lightOpacity: 2, drops: null },
  { id: 12, name: 'coal_ore', displayName: 'Coal Ore', tex: { all: 'coal_ore' }, hardness: 3, tool: 'pickaxe', harvest: 1, drops: 'coal', sound: 'stone' },
  { id: 13, name: 'iron_ore', displayName: 'Iron Ore', tex: { all: 'iron_ore' }, hardness: 3, tool: 'pickaxe', harvest: 2, sound: 'stone' },
  { id: 14, name: 'gold_ore', displayName: 'Gold Ore', tex: { all: 'gold_ore' }, hardness: 3, tool: 'pickaxe', harvest: 3, sound: 'stone' },
  { id: 15, name: 'diamond_ore', displayName: 'Diamond Ore', tex: { all: 'diamond_ore' }, hardness: 3, tool: 'pickaxe', harvest: 3, drops: 'diamond', sound: 'stone' },
  { id: 16, name: 'bricks', tex: { all: 'bricks' }, hardness: 2, tool: 'pickaxe', harvest: 1, sound: 'stone' },
  { id: 17, name: 'torch', tex: { all: 'torch' }, hardness: 0, solid: false, opaque: false, transparent: true, lightOpacity: 0, light: 14, shape: 'torch', sound: 'wood' },
  { id: 18, name: 'crafting_table', displayName: 'Crafting Table', tex: { top: 'crafting_top', side: 'crafting_side', bottom: 'planks' }, hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 15 },
  { id: 19, name: 'furnace', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front', bottom: 'furnace_top' }, hardness: 3.5, tool: 'pickaxe', harvest: 1, sound: 'stone' },
  { id: 20, name: 'bedrock', tex: { all: 'bedrock' }, hardness: -1, sound: 'stone' },
  { id: 21, name: 'snowy_grass', displayName: 'Snowy Grass', tex: { top: 'snow', side: 'snowy_grass_side', bottom: 'dirt' }, hardness: 0.6, tool: 'shovel', drops: 'dirt', sound: 'snow' },
  { id: 22, name: 'snow', displayName: 'Snow Block', tex: { all: 'snow' }, hardness: 0.2, tool: 'shovel', sound: 'snow' },
  { id: 23, name: 'ice', tex: { all: 'ice' }, hardness: 0.5, tool: 'pickaxe', opaque: false, transparent: true, lightOpacity: 2, drops: null, sound: 'glass', translucent: true },
  { id: 24, name: 'sandstone', tex: { top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_top' }, hardness: 0.8, tool: 'pickaxe', harvest: 1, sound: 'stone' },
  { id: 25, name: 'cactus', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_top' }, hardness: 0.4, sound: 'grass' },
  { id: 26, name: 'tall_grass', displayName: 'Tall Grass', tex: { all: 'tall_grass' }, hardness: 0, solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', drops: null, sound: 'grass', replaceable: true },
  { id: 27, name: 'red_flower', displayName: 'Red Flower', tex: { all: 'red_flower' }, hardness: 0, solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', sound: 'grass' },
  { id: 28, name: 'yellow_flower', displayName: 'Yellow Flower', tex: { all: 'yellow_flower' }, hardness: 0, solid: false, opaque: false, transparent: true, cutout: true, lightOpacity: 0, shape: 'cross', sound: 'grass' },
  // Wool colours. The texture painter reads `color` to tint a shared wool pattern.
  { id: 30, name: 'white_wool', displayName: 'White Wool', tex: { all: 'wool:#e9ecec' }, hardness: 0.8, sound: 'cloth' },
  { id: 31, name: 'red_wool', displayName: 'Red Wool', tex: { all: 'wool:#b02e26' }, hardness: 0.8, sound: 'cloth' },
  { id: 32, name: 'orange_wool', displayName: 'Orange Wool', tex: { all: 'wool:#f07613' }, hardness: 0.8, sound: 'cloth' },
  { id: 33, name: 'yellow_wool', displayName: 'Yellow Wool', tex: { all: 'wool:#f8c527' }, hardness: 0.8, sound: 'cloth' },
  { id: 34, name: 'green_wool', displayName: 'Green Wool', tex: { all: 'wool:#5e7c16' }, hardness: 0.8, sound: 'cloth' },
  { id: 35, name: 'blue_wool', displayName: 'Blue Wool', tex: { all: 'wool:#3c44aa' }, hardness: 0.8, sound: 'cloth' },
  { id: 36, name: 'purple_wool', displayName: 'Purple Wool', tex: { all: 'wool:#8932b8' }, hardness: 0.8, sound: 'cloth' },
  { id: 37, name: 'black_wool', displayName: 'Black Wool', tex: { all: 'wool:#1d1d21' }, hardness: 0.8, sound: 'cloth' },
  { id: 38, name: 'lit_furnace', displayName: 'Furnace', tex: { top: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit', bottom: 'furnace_top' }, hardness: 3.5, tool: 'pickaxe', harvest: 1, light: 13, drops: 'furnace', sound: 'stone', hidden: true },
];

// Fill in defaults so the rest of the code can read every field safely.
const DEFAULTS = {
  solid: true, opaque: true, transparent: false, cutout: false, liquid: false,
  light: 0, lightOpacity: 15, shape: 'cube', tool: null, harvest: 0,
  hardness: 1, sound: 'stone', replaceable: false, hidden: false, fuel: 0,
};

export const BLOCKS = [];          // indexed by id (sparse array)
export const BLOCK_BY_NAME = {};   // name -> definition

for (const def of BLOCK_LIST) {
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
export const LIGHT_EMIT = new Uint8Array(256);
export const LIGHT_OPACITY = new Uint8Array(256).fill(15);
export const SHAPE = new Uint8Array(256); // 0 cube, 1 cross, 2 torch, 255 none
for (const b of BLOCKS) {
  if (!b) continue;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_TRANSPARENT[b.id] = b.transparent ? 1 : 0;
  IS_LIQUID[b.id] = b.liquid ? 1 : 0;
  LIGHT_EMIT[b.id] = b.light;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  SHAPE[b.id] = b.id === 0 ? 255 : b.shape === 'cross' ? 1 : b.shape === 'torch' ? 2 : 0;
}

export function isBlockId(id) {
  return id >= 0 && id < 256 && BLOCKS[id] !== undefined;
}
