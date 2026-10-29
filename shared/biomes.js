// ============================================================================
// Biome definitions (modelled on the classic 1.12-era overworld list).
//
// The terrain generator (shared/terrain.js) decides WHICH biome a column is
// from climate noise; this file decides what each biome LOOKS like:
//   grass / foliage  tint colours applied to grass, tall grass, ferns and leaves
//   top / filler     surface block and the few blocks under it
//   trees            [chance per 5x5 cell, [[treeType, weight], ...]]
//   plants           [[blockName, chance per column], ...] ground decoration
//   village          true if villages can generate here
//   snowy            water freezes at the surface
//
// Grass/foliage colours are blended into greyscale textures by the shader,
// so one grass texture works for every biome.
// ============================================================================

const RAW = [
  // name,             displayName,           grass,     foliage
  { name: 'ocean', displayName: 'Ocean', grass: '#8eb971', foliage: '#71a74d', top: 'sand', filler: 'sand' },
  { name: 'deep_ocean', displayName: 'Deep Ocean', grass: '#8eb971', foliage: '#71a74d', top: 'gravel', filler: 'gravel' },
  { name: 'frozen_ocean', displayName: 'Frozen Ocean', grass: '#80b497', foliage: '#60a17b', top: 'gravel', filler: 'gravel', snowy: true },
  { name: 'river', displayName: 'River', grass: '#8eb971', foliage: '#71a74d', top: 'sand', filler: 'sand' },
  { name: 'frozen_river', displayName: 'Frozen River', grass: '#80b497', foliage: '#60a17b', top: 'sand', filler: 'sand', snowy: true },
  { name: 'beach', displayName: 'Beach', grass: '#91bd59', foliage: '#77ab2f', top: 'sand', filler: 'sand' },
  { name: 'stone_beach', displayName: 'Stone Beach', grass: '#8ab689', foliage: '#6da36b', top: 'stone', filler: 'stone' },
  { name: 'snowy_beach', displayName: 'Cold Beach', grass: '#80b497', foliage: '#60a17b', top: 'sand', filler: 'sand', snowy: true },
  { name: 'plains', displayName: 'Plains', grass: '#91bd59', foliage: '#77ab2f', village: true,
    trees: [0.04, [['oak', 9], ['big_oak', 1]]],
    plants: [['tall_grass', 0.22], ['pumpkin', 0.0006], ['red_flower', 0.006], ['yellow_flower', 0.008], ['oxeye_daisy', 0.003], ['azure_bluet', 0.003], ['red_tulip', 0.002], ['white_tulip', 0.002]] },
  { name: 'sunflower_plains', displayName: 'Sunflower Plains', grass: '#91bd59', foliage: '#77ab2f', village: true,
    trees: [0.02, [['oak', 1]]],
    plants: [['tall_grass', 0.2], ['sunflower', 0.05], ['yellow_flower', 0.01], ['red_flower', 0.004]] },
  { name: 'forest', displayName: 'Forest', grass: '#79c05a', foliage: '#59ae30',
    trees: [0.7, [['oak', 7], ['birch', 2], ['big_oak', 1]]],
    plants: [['tall_grass', 0.08], ['red_flower', 0.006], ['yellow_flower', 0.006], ['brown_mushroom', 0.002]] },
  { name: 'flower_forest', displayName: 'Flower Forest', grass: '#79c05a', foliage: '#59ae30',
    trees: [0.35, [['oak', 3], ['birch', 1]]],
    plants: [['allium', 0.04], ['azure_bluet', 0.04], ['red_tulip', 0.035], ['orange_tulip', 0.035], ['white_tulip', 0.035], ['pink_tulip', 0.035], ['oxeye_daisy', 0.04], ['red_flower', 0.03], ['yellow_flower', 0.03], ['tall_grass', 0.05]] },
  { name: 'birch_forest', displayName: 'Birch Forest', grass: '#88bb67', foliage: '#6ba941',
    trees: [0.72, [['birch', 1]]],
    plants: [['tall_grass', 0.1], ['red_flower', 0.004], ['yellow_flower', 0.004]] },
  { name: 'dark_forest', displayName: 'Roofed Forest', grass: '#507a32', foliage: '#3e6b24',
    trees: [0.9, [['dark_oak', 8], ['huge_red_mushroom', 1], ['huge_brown_mushroom', 1], ['oak', 1]]],
    plants: [['tall_grass', 0.04], ['brown_mushroom', 0.02], ['red_mushroom', 0.01]] },
  { name: 'taiga', displayName: 'Taiga', grass: '#86b783', foliage: '#68a464', village: true,
    trees: [0.55, [['spruce', 4], ['pine', 1]]],
    plants: [['fern', 0.1], ['tall_grass', 0.04], ['pumpkin', 0.0008], ['brown_mushroom', 0.003]] },
  { name: 'giant_tree_taiga', displayName: 'Mega Taiga', grass: '#86b783', foliage: '#68a464', top: 'podzol',
    trees: [0.6, [['mega_spruce', 2], ['spruce', 3]]],
    plants: [['fern', 0.15], ['tall_grass', 0.05], ['brown_mushroom', 0.01], ['red_mushroom', 0.005], ['dead_bush', 0.004]] },
  { name: 'snowy_taiga', displayName: 'Cold Taiga', grass: '#80b497', foliage: '#60a17b', top: 'snowy_grass', snowy: true,
    trees: [0.5, [['spruce', 3], ['pine', 1]]],
    plants: [['fern', 0.03]] },
  { name: 'snowy_tundra', displayName: 'Ice Plains', grass: '#80b497', foliage: '#60a17b', top: 'snowy_grass', snowy: true, village: true,
    trees: [0.025, [['spruce', 1]]] },
  { name: 'ice_spikes', displayName: 'Ice Plains Spikes', grass: '#80b497', foliage: '#60a17b', top: 'snow', filler: 'dirt', snowy: true,
    trees: [0.12, [['ice_spike', 1]]] },
  { name: 'mountains', displayName: 'Extreme Hills', grass: '#8ab689', foliage: '#6da36b',
    trees: [0.05, [['oak', 1], ['spruce', 1]]],
    plants: [['tall_grass', 0.05]] },
  { name: 'wooded_mountains', displayName: 'Extreme Hills+', grass: '#8ab689', foliage: '#6da36b',
    trees: [0.45, [['oak', 1], ['spruce', 2]]],
    plants: [['tall_grass', 0.05], ['fern', 0.03]] },
  { name: 'desert', displayName: 'Desert', grass: '#bfb755', foliage: '#aea42a', top: 'sand', filler: 'sand', village: true,
    plants: [['dead_bush', 0.012], ['cactus', 0.006]] },
  { name: 'savanna', displayName: 'Savanna', grass: '#bfb755', foliage: '#aea42a', village: true,
    trees: [0.12, [['acacia', 4], ['oak', 1]]],
    plants: [['tall_grass', 0.3], ['yellow_flower', 0.003]] },
  { name: 'savanna_plateau', displayName: 'Savanna Plateau', grass: '#bfb755', foliage: '#aea42a',
    trees: [0.1, [['acacia', 3], ['oak', 1]]],
    plants: [['tall_grass', 0.25], ['coarse_patch', 0.04]] },
  { name: 'jungle', displayName: 'Jungle', grass: '#59c93c', foliage: '#30bb0b',
    trees: [0.9, [['jungle', 5], ['jungle_bush', 4], ['mega_jungle', 1]]],
    plants: [['tall_grass', 0.2], ['fern', 0.08], ['melon', 0.004], ['red_flower', 0.003]] },
  { name: 'jungle_edge', displayName: 'Jungle Edge', grass: '#64c73f', foliage: '#3eb80f',
    trees: [0.3, [['jungle', 2], ['jungle_bush', 3]]],
    plants: [['tall_grass', 0.2], ['fern', 0.06], ['melon', 0.002]] },
  { name: 'swamp', displayName: 'Swampland', grass: '#6a7039', foliage: '#4c763c',
    trees: [0.14, [['swamp_oak', 1]]],
    plants: [['tall_grass', 0.08], ['blue_orchid', 0.015], ['brown_mushroom', 0.006], ['red_mushroom', 0.004], ['lily_pad', 0.06]] },
  { name: 'badlands', displayName: 'Mesa', grass: '#90814d', foliage: '#9e814d', top: 'red_sand', filler: 'red_sand',
    plants: [['dead_bush', 0.012], ['cactus', 0.003]] },
  { name: 'badlands_plateau', displayName: 'Mesa Plateau', grass: '#90814d', foliage: '#9e814d', top: 'red_sand', filler: 'red_sand',
    plants: [['dead_bush', 0.008]] },
  { name: 'mushroom_fields', displayName: 'Mushroom Island', grass: '#55c93f', foliage: '#2bbb0f', top: 'mycelium',
    trees: [0.08, [['huge_red_mushroom', 1], ['huge_brown_mushroom', 1]]],
    plants: [['red_mushroom', 0.012], ['brown_mushroom', 0.012]] },
  // The tops of the big mountain ranges (new; added at the end so saved ids don't shift)
  { name: 'snowy_peaks', displayName: 'Snowy Peaks', grass: '#80b497', foliage: '#60a17b', top: 'snow', filler: 'stone', snowy: true },
  { name: 'stony_peaks', displayName: 'Stony Peaks', grass: '#8ab689', foliage: '#6da36b', top: 'stone', filler: 'stone',
    trees: [0.03, [['spruce', 1]]] },
];

export const BIOME_LIST = RAW.map((b, i) => ({
  top: 'grass', filler: 'dirt', trees: [0, []], plants: [], village: false, snowy: false,
  ...b, id: i,
}));
export const BIOME = Object.fromEntries(BIOME_LIST.map(b => [b.name.toUpperCase(), b.id]));
export const BIOME_NAMES = BIOME_LIST.map(b => b.displayName);

/**
 * Tint palette uploaded to the shader. Index 0 = no tint (white).
 * Grass of biome i is at 1 + 2i, foliage at 2 + 2i.
 */
export function tintPalette() {
  const hex = (h) => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const out = [[1, 1, 1]];
  for (const b of BIOME_LIST) { out.push(hex(b.grass)); out.push(hex(b.foliage)); }
  return out;
}
export const TINT_COUNT = 1 + BIOME_LIST.length * 2; // shader uniform array size; keep under ~200
