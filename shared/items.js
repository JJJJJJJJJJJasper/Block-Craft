// ============================================================================
// Items. Every block is also an item (same numeric id: below 256, or 1024 and
// up for newer blocks). Non-block items (tools, armor, food, materials) use
// ids 256-1023. Never reuse an id: saved inventories store items by id.
//
// An inventory slot is stored as { id, count, dmg } (dmg = wear) or null.
// ============================================================================
import { BLOCKS, COLORS } from './blocks.js';

// Tool tiers: speed multiplies mining speed, level decides what can be harvested.
export const TOOL_TIERS = {
  wood:    { level: 1, speed: 2, durability: 60,   damage: 0, color: '#9c7a45' },
  stone:   { level: 2, speed: 4, durability: 132,  damage: 1, color: '#8a8a8a' },
  iron:    { level: 3, speed: 6, durability: 251,  damage: 2, color: '#d8d8d8' },
  gold:    { level: 1, speed: 12, durability: 33,  damage: 0, color: '#f5d742' },
  diamond: { level: 4, speed: 8, durability: 1562, damage: 3, color: '#5ee8e0' },
};

// Armor: protection points per piece [helmet, chestplate, leggings, boots] and
// durability. 20 points = 80% less damage from mobs.
export const ARMOR_TIERS = {
  leather: { points: [1, 3, 2, 1], durability: [55, 80, 75, 65], color: '#8b5a2b' },
  gold:    { points: [2, 5, 3, 1], durability: [77, 112, 105, 91], color: '#f5d742' },
  iron:    { points: [2, 6, 5, 2], durability: [165, 240, 225, 195], color: '#d8d8d8' },
  diamond: { points: [3, 8, 6, 3], durability: [363, 528, 495, 429], color: '#5ee8e0' },
  chainmail: { points: [2, 5, 4, 1], durability: [165, 240, 225, 195], color: '#9a9aa2' }, // ids 356-359 (found, not crafted)
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

// Base attack damage per tool type (added to the tier bonus).
const TOOL_DAMAGE = { sword: 4, axe: 3, pickaxe: 2, shovel: 1.5, hoe: 1 };

const ITEM_LIST = [
  { id: 256, name: 'stick', icon: 'stick', fuel: 5, cat: 'materials' },
  { id: 257, name: 'coal', icon: 'coal', fuel: 80, cat: 'materials' },
  { id: 258, name: 'iron_ingot', icon: 'ingot:#d8d8d8', cat: 'materials' },
  { id: 259, name: 'gold_ingot', icon: 'ingot:#f5d742', cat: 'materials' },
  { id: 260, name: 'diamond', icon: 'gem:#5ee8e0', cat: 'materials' },
  { id: 261, name: 'raw_porkchop', icon: 'meat:#f19a9a', food: 3, cat: 'food' },
  { id: 262, name: 'cooked_porkchop', icon: 'meat:#b5652c', food: 8, cat: 'food' },
  { id: 263, name: 'rotten_flesh', icon: 'meat:#7a8a3a', food: 4, cat: 'food' },
  { id: 264, name: 'apple', icon: 'apple', food: 4, cat: 'food' },
  { id: 265, name: 'brick', icon: 'brick', cat: 'materials' },
  { id: 266, name: 'clay_ball', icon: 'ball:#a0a6b3', cat: 'materials' },
  { id: 267, name: 'emerald', icon: 'gem:#17dd62', cat: 'materials' },
  { id: 268, name: 'lapis_lazuli', icon: 'gem:#2550b0', cat: 'materials' },
  { id: 269, name: 'redstone', displayName: 'Redstone Dust', icon: 'dust:#c41010', cat: 'materials' },
  { id: 270, name: 'flint', icon: 'flint', cat: 'materials' },
  { id: 271, name: 'feather', icon: 'feather', cat: 'materials' },
  { id: 272, name: 'leather', icon: 'leather', cat: 'materials' },
  { id: 273, name: 'string', icon: 'string', cat: 'materials' },
  { id: 274, name: 'wheat', icon: 'wheat', cat: 'materials' },
  { id: 275, name: 'wheat_seeds', icon: 'seeds', plants: 'wheat_crop', cat: 'materials' },
  { id: 276, name: 'bread', icon: 'bread', food: 5, cat: 'food' },
  { id: 277, name: 'raw_beef', icon: 'meat:#d0453a', food: 3, cat: 'food' },
  { id: 278, name: 'steak', icon: 'meat:#7a4524', food: 8, cat: 'food' },
  { id: 279, name: 'raw_mutton', icon: 'meat:#d8605a', food: 2, cat: 'food' },
  { id: 280, name: 'cooked_mutton', icon: 'meat:#9a5530', food: 6, cat: 'food' },
  { id: 281, name: 'raw_chicken', icon: 'drumstick:#f0c0a8', food: 2, cat: 'food' },
  { id: 282, name: 'cooked_chicken', icon: 'drumstick:#c8803a', food: 6, cat: 'food' },
  { id: 283, name: 'melon_slice', icon: 'melon_slice', food: 2, cat: 'food' },
];

// 16 dyes, ids 284-299, in the same colour order as blocks.js COLORS.
COLORS.forEach(([color, wool], i) => {
  ITEM_LIST.push({ id: 284 + i, name: `${color}_dye`, icon: `dye:${wool}`, cat: 'materials' });
});

// Generate the 20 tools (5 tiers x 4 types) instead of writing them by hand.
let nextToolId = 300;
for (const tier of Object.keys(TOOL_TIERS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
    const t = TOOL_TIERS[tier];
    ITEM_LIST.push({
      id: nextToolId++, name: `${tier}_${type}`, icon: `${type}:${t.color}`,
      tool: type, tier, level: t.level, speed: t.speed, durability: t.durability,
      damage: TOOL_DAMAGE[type] + t.damage, maxStack: 1, cat: type === 'sword' ? 'combat' : 'tools',
    });
  }
}

// 16 armor pieces, ids 340-355.
let nextArmorId = 340;
for (const tier of Object.keys(ARMOR_TIERS)) {
  const t = ARMOR_TIERS[tier];
  ARMOR_PIECES.forEach((piece, slot) => {
    ITEM_LIST.push({
      id: nextArmorId++, name: `${tier}_${piece}`, icon: `${piece}:${t.color}`,
      armor: { slot, points: t.points[slot] }, durability: t.durability[slot], maxStack: 1, cat: 'combat',
    });
  });
}

// Hoes, ids 360-364 (they till dirt into farmland).
let nextHoeId = 360;
for (const tier of Object.keys(TOOL_TIERS)) {
  const t = TOOL_TIERS[tier];
  ITEM_LIST.push({ id: nextHoeId++, name: `${tier}_hoe`, icon: `hoe:${t.color}`, tool: 'hoe', tier, level: 0, speed: 1,
    durability: t.durability, damage: 1, maxStack: 1, cat: 'tools' });
}

// ---- Everything else in the overworld, ids from 400 --------------------------------
// food = hunger points restored; returns = what's left in your hand after eating;
// throw = thrown when used (snowball, egg, ender pearl); fills / empties = buckets.
// Names of music discs are made up for BlockCraft.
const MORE = [
  ['shears', 'shears:#d8d8d8', { maxStack: 1, durability: 238, cat: 'tools' }],
  ['flint_and_steel', 'flint_and_steel', { maxStack: 1, durability: 64, cat: 'tools', displayName: 'Flint and Steel' }],
  ['fishing_rod', 'fishing_rod', { maxStack: 1, durability: 64, cat: 'tools' }],
  ['bow', 'bow', { maxStack: 1, durability: 384, cat: 'combat' }],
  ['arrow', 'arrow', { cat: 'combat' }],
  ['compass', 'compass', { cat: 'tools' }],
  ['clock', 'clock', { cat: 'tools' }],
  ['empty_map', 'map', { cat: 'misc', displayName: 'Empty Map' }],
  ['bucket', 'bucket:#3a3a3a', { maxStack: 16, cat: 'misc' }],
  ['water_bucket', 'bucket:#3b6fd8', { maxStack: 1, cat: 'misc', empties: 'water' }],
  ['lava_bucket', 'bucket:#ff8a20', { maxStack: 1, cat: 'misc', empties: 'lava', fuel: 1000 }],
  ['milk_bucket', 'bucket:#f8f8f8', { maxStack: 1, cat: 'misc', drink: true, returns: 'bucket' }],
  ['shield', 'shield:#8a6a3c', { maxStack: 1, durability: 336, cat: 'combat' }],
  ['lead', 'lead', { cat: 'tools' }],
  ['name_tag', 'name_tag', { cat: 'tools' }],
  ['saddle', 'saddle', { maxStack: 1, cat: 'transport' }],
  ['iron_horse_armor', 'chestplate:#d8d8d8', { maxStack: 1, cat: 'misc' }],
  ['golden_horse_armor', 'chestplate:#f5d742', { maxStack: 1, cat: 'misc' }],
  ['diamond_horse_armor', 'chestplate:#5ee8e0', { maxStack: 1, cat: 'misc' }],
  ['totem_of_undying', 'totem', { maxStack: 1, cat: 'combat' }],
  ['charcoal', 'coal:#4a3a2a', { fuel: 80, cat: 'materials' }],
  ['bone', 'bone', { cat: 'misc' }],
  ['bone_meal', 'dust:#f0f0e8', { cat: 'materials' }],
  ['ink_sac', 'dye:#22222e', { cat: 'materials' }],
  ['cocoa_beans', 'dye:#7a4a1a', { cat: 'materials' }],
  ['gunpowder', 'dust:#5a5a5a', { cat: 'materials' }],
  ['sugar', 'dust:#f4f4f4', { cat: 'materials' }],
  ['paper', 'paper', { cat: 'misc' }],
  ['book', 'book:#7a4a2a', { cat: 'misc' }],
  ['writable_book', 'quill_book', { maxStack: 1, cat: 'misc', displayName: 'Book and Quill' }],
  ['enchanted_book', 'book:#8a4ac8', { maxStack: 1, cat: 'misc' }],
  ['slimeball', 'ball:#7ad85a', { cat: 'misc' }],
  ['ender_pearl', 'ball:#1a6a62', { maxStack: 16, cat: 'misc', throw: 'pearl' }],
  ['egg', 'egg', { maxStack: 16, cat: 'materials', throw: 'egg' }],
  ['snowball', 'ball:#f4f8fa', { maxStack: 16, cat: 'misc', throw: 'snowball' }],
  ['iron_nugget', 'nugget:#d8d8d8', { cat: 'materials' }],
  ['gold_nugget', 'nugget:#f5d742', { cat: 'materials' }],
  ['glass_bottle', 'bottle:#d8ecf4', { cat: 'brewing' }],
  ['spider_eye', 'eye:#b02a3a', { food: 2, cat: 'brewing' }],
  ['fermented_spider_eye', 'eye:#7a4a3a', { cat: 'brewing' }],
  ['glistering_melon', 'melon_slice:#f5d742', { cat: 'brewing', displayName: 'Glistering Melon' }],
  ['golden_carrot', 'carrot:#f5d742', { food: 6, cat: 'brewing' }],
  ['golden_apple', 'apple:#f5d742', { food: 4, regen: 5, cat: 'food' }],
  ['enchanted_golden_apple', 'apple:#ffe680', { food: 4, regen: 20, cat: 'food' }],
  ['cookie', 'cookie', { food: 2, cat: 'food' }],
  ['pumpkin_pie', 'pie', { food: 8, cat: 'food' }],
  ['mushroom_stew', 'stew:#b08a6a', { food: 6, maxStack: 1, returns: 'bowl', cat: 'food' }],
  ['rabbit_stew', 'stew:#a8683a', { food: 10, maxStack: 1, returns: 'bowl', cat: 'food' }],
  ['beetroot_soup', 'stew:#a8283a', { food: 6, maxStack: 1, returns: 'bowl', cat: 'food' }],
  ['raw_rabbit', 'meat:#e8a8a0', { food: 3, cat: 'food' }],
  ['cooked_rabbit', 'meat:#b06a3a', { food: 5, cat: 'food' }],
  ['rabbit_foot', 'drumstick:#d8c8a8', { cat: 'brewing' }],
  ['rabbit_hide', 'leather:#c8a878', { cat: 'materials' }],
  ['carrot', 'carrot:#f08a20', { food: 3, plants: 'carrots', cat: 'food' }],
  ['potato', 'potato:#d8b060', { food: 1, plants: 'potatoes', cat: 'food' }],
  ['baked_potato', 'potato:#c08030', { food: 5, cat: 'food' }],
  ['poisonous_potato', 'potato:#a8b84a', { food: 2, cat: 'food' }],
  ['beetroot', 'beetroot', { food: 1, cat: 'food' }],
  ['beetroot_seeds', 'seeds:#c89a50', { plants: 'beetroots', cat: 'materials' }],
  ['melon_seeds', 'seeds:#2a2a1a', { cat: 'materials' }],
  ['pumpkin_seeds', 'seeds:#e8d8a0', { cat: 'materials' }],
  ['raw_cod', 'fish:#a8b0b8', { food: 2, cat: 'food', displayName: 'Raw Fish' }],
  ['cooked_cod', 'fish:#c09060', { food: 5, cat: 'food', displayName: 'Cooked Fish' }],
  ['raw_salmon', 'fish:#c85a50', { food: 2, cat: 'food' }],
  ['cooked_salmon', 'fish:#c8784a', { food: 6, cat: 'food' }],
  ['clownfish', 'fish:#f0782a', { food: 1, cat: 'food' }],
  ['pufferfish', 'fish:#e8c840', { food: 1, cat: 'food' }],
  ['bowl', 'bowl', { cat: 'materials' }],
  ['firework_rocket', 'rocket', { cat: 'misc' }],
  ['firework_star', 'ball:#5a5a5a', { cat: 'misc' }],
  ['item_frame', 'frame', { cat: 'decoration' }],
  ['painting', 'painting', { cat: 'decoration' }],
  ['armor_stand', 'armor_stand', { maxStack: 16, cat: 'decoration' }],
  ...[['ember', '#e85a2a'], ['tide', '#2a8ae8'], ['meadow', '#5ac83a'], ['dusk', '#8a4ac8'], ['frost', '#a8e0f0'], ['honey', '#f0c040'],
    ['cinder', '#5a5a5a'], ['bloom', '#e868a8'], ['moss', '#3a7a3a'], ['echo', '#c8c8c8'], ['ripple', '#40c8b0'], ['spark', '#f8f070']]
    .map(([n, col]) => [`music_disc_${n}`, `disc:${col}`, { maxStack: 1, cat: 'misc', displayName: `Music Disc (${n[0].toUpperCase()}${n.slice(1)})` }]),
  ['minecart', 'minecart:#4a4a4a', { maxStack: 1, cat: 'transport' }],
  ['chest_minecart', 'minecart:#a0743a', { maxStack: 1, cat: 'transport', displayName: 'Minecart with Chest' }],
  ['furnace_minecart', 'minecart:#6a6a6a', { maxStack: 1, cat: 'transport', displayName: 'Minecart with Furnace' }],
  ['hopper_minecart', 'minecart:#2e2e32', { maxStack: 1, cat: 'transport', displayName: 'Minecart with Hopper' }],
  ['tnt_minecart', 'minecart:#d8402e', { maxStack: 1, cat: 'transport', displayName: 'Minecart with TNT' }],
  ['oak_boat', 'boat:#a8864f', { maxStack: 1, cat: 'transport' }],
  ['spruce_boat', 'boat:#735532', { maxStack: 1, cat: 'transport' }],
  ['birch_boat', 'boat:#c4b37b', { maxStack: 1, cat: 'transport' }],
  ['jungle_boat', 'boat:#a5764d', { maxStack: 1, cat: 'transport' }],
  ['acacia_boat', 'boat:#ad5d32', { maxStack: 1, cat: 'transport' }],
  ['dark_oak_boat', 'boat:#4a3218', { maxStack: 1, cat: 'transport' }],
  ['carrot_on_a_stick', 'carrot_rod', { maxStack: 1, durability: 25, cat: 'transport', displayName: 'Carrot on a Stick' }],
  ['sign', 'sign', { maxStack: 16, cat: 'decoration' }],
  ['experience_bottle', 'bottle:#7ad85a', { cat: 'misc', displayName: "Bottle o' Enchanting" }],
  ['water_bottle', 'bottle:#3b6fd8', { maxStack: 1, cat: 'brewing' }],
  ['prismarine_shard', 'flint:#5aa898', { cat: 'materials' }],
  ['prismarine_crystals', 'gem:#b8e0d0', { cat: 'materials' }],
  ['tripwire_hook', 'hook', { cat: 'redstone' }],
];
let nextMoreId = 400;
for (const [name, icon, extra] of MORE) ITEM_LIST.push({ id: nextMoreId++, name, icon, ...extra });
if (nextMoreId > 1024) throw new Error('Item ids ran into the block range');

export const ITEMS = [];           // id -> item definition (blocks included)
export const ITEM_BY_NAME = {};

function prettify(name) {
  return name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// Blocks become items automatically.
for (const b of BLOCKS) {
  if (!b || b.id === 0) continue;
  const item = {
    id: b.id, name: b.name, displayName: b.displayName, isBlock: true,
    maxStack: 64, fuel: b.fuel || 0, hidden: b.hidden, cat: b.cat,
  };
  ITEMS[b.id] = item;
  ITEM_BY_NAME[b.name] = item;
}
for (const def of ITEM_LIST) {
  const item = { maxStack: 64, fuel: 0, isBlock: false, ...def };
  if (!item.displayName) item.displayName = prettify(def.name);
  ITEMS[item.id] = item;
  ITEM_BY_NAME[item.name] = item;
}

export function itemId(name) {
  const it = ITEM_BY_NAME[name];
  if (!it) throw new Error(`Unknown item: ${name}`);
  return it.id;
}

export function maxStack(id) {
  return ITEMS[id] ? ITEMS[id].maxStack : 64;
}

/**
 * How long (seconds) it takes to break `blockId` holding item `heldId`.
 * Mirrors the classic formula: hardness x 1.5 when the tool can harvest it,
 * hardness x 5 when it can't, divided by the tool's speed when it's the right
 * tool type for that block.
 */
export function breakTime(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b || b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0.05;
  const held = ITEMS[heldId];
  const rightTool = held && held.tool && held.tool === b.tool;
  const level = rightTool ? held.level : 0;
  const canHarvest = level >= b.harvest;
  let time = b.hardness * (canHarvest ? 1.5 : 5);
  if (rightTool) time /= held.speed;
  // Swords cut leaves, plants and cobwebs quickly.
  if (held && held.tool === 'sword' && (b.cutout || b.name === 'cactus')) time /= 4;
  return time;
}

/** Does breaking this block with this held item drop something? */
export function canHarvest(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (!b) return false;
  if (b.harvest === 0) return true;
  const held = ITEMS[heldId];
  return !!(held && held.tool === b.tool && held.level >= b.harvest);
}

export function attackDamage(heldId) {
  const held = ITEMS[heldId];
  return held && held.damage ? held.damage : 1;
}
