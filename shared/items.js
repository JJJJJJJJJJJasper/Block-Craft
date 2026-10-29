// ============================================================================
// Items. Every block is also an item (same numeric id, < 256). Non-block
// items (tools, armor, food, materials) get ids >= 256. Never reuse an id:
// saved inventories store items by id.
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
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

// Base attack damage per tool type (added to the tier bonus).
const TOOL_DAMAGE = { sword: 4, axe: 3, pickaxe: 2, shovel: 1.5 };

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
  { id: 275, name: 'wheat_seeds', icon: 'seeds', cat: 'materials' },
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
      damage: TOOL_DAMAGE[type] + t.damage, maxStack: 1, cat: 'tools',
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
      armor: { slot, points: t.points[slot] }, durability: t.durability[slot], maxStack: 1, cat: 'tools',
    });
  });
}

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
