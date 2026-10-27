// ============================================================================
// Items. Every block is also an item (same numeric id, < 256). Non-block
// items (tools, food, materials) get ids >= 256.
//
// An inventory slot is stored as { id, count, dmg } (dmg = tool wear) or null.
// ============================================================================
import { BLOCKS } from './blocks.js';

// Tool tiers: speed multiplies mining speed, level decides what can be harvested.
export const TOOL_TIERS = {
  wood:    { level: 1, speed: 2, durability: 60,   damage: 0, color: '#9c7a45' },
  stone:   { level: 2, speed: 4, durability: 132,  damage: 1, color: '#8a8a8a' },
  iron:    { level: 3, speed: 6, durability: 251,  damage: 2, color: '#d8d8d8' },
  gold:    { level: 1, speed: 12, durability: 33,  damage: 0, color: '#f5d742' },
  diamond: { level: 4, speed: 8, durability: 1562, damage: 3, color: '#5ee8e0' },
};

// Base attack damage per tool type (added to the tier bonus).
const TOOL_DAMAGE = { sword: 4, axe: 3, pickaxe: 2, shovel: 1.5 };

const ITEM_LIST = [
  { id: 256, name: 'stick', icon: 'stick', fuel: 5 },
  { id: 257, name: 'coal', icon: 'coal', fuel: 80 },
  { id: 258, name: 'iron_ingot', displayName: 'Iron Ingot', icon: 'ingot:#d8d8d8' },
  { id: 259, name: 'gold_ingot', displayName: 'Gold Ingot', icon: 'ingot:#f5d742' },
  { id: 260, name: 'diamond', icon: 'gem:#5ee8e0' },
  { id: 261, name: 'raw_porkchop', displayName: 'Raw Porkchop', icon: 'meat:#f19a9a', food: 3 },
  { id: 262, name: 'cooked_porkchop', displayName: 'Cooked Porkchop', icon: 'meat:#b5652c', food: 8 },
  { id: 263, name: 'rotten_flesh', displayName: 'Rotten Flesh', icon: 'meat:#7a8a3a', food: 2 },
  { id: 264, name: 'apple', icon: 'apple', food: 4 },
];

// Generate the 20 tools (5 tiers x 4 types) instead of writing them by hand.
let nextToolId = 300;
for (const tier of Object.keys(TOOL_TIERS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
    const t = TOOL_TIERS[tier];
    ITEM_LIST.push({
      id: nextToolId++,
      name: `${tier}_${type}`,
      icon: `${type}:${t.color}`,
      tool: type,
      tier,
      level: t.level,
      speed: t.speed,
      durability: t.durability,
      damage: TOOL_DAMAGE[type] + t.damage,
      maxStack: 1,
    });
  }
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
    maxStack: 64, fuel: b.fuel || 0, hidden: b.hidden || b.liquid,
  };
  ITEMS[b.id] = item;
  ITEM_BY_NAME[b.name] = item;
}
for (const def of ITEM_LIST) {
  const item = { maxStack: 64, fuel: 0, displayName: prettify(def.name), isBlock: false, ...def };
  if (item.tool) item.displayName = prettify(def.name);
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
  // Swords cut leaves and cactus quickly.
  if (held && held.tool === 'sword' && (b.name === 'leaves' || b.name === 'cactus')) time /= 4;
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
