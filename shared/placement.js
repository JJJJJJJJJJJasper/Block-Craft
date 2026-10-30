// ============================================================================
// Which block (and which STATE of it) to place when a player uses an item.
//
// Shared by the client (to predict the result instantly) and the server (to
// check the client isn't cheating). Most blocks just place themselves, but:
//   logs / pillars  lie along the axis of the face you clicked
//   stairs, slabs   upside down when you click high on a side or a ceiling
//   doors, beds     take two blocks
//   chests etc.     turn their front toward you
//   ladders, vines, buttons, wall torches   stick to the side you clicked
//   seeds           plant a crop on farmland
// ============================================================================
import { BLOCKS, FAMILIES, B, stateId, wallTorchFor, IS_SOLID, SHAPE } from './blocks.js';
import { ITEMS } from './items.js';
import { FACING_VEC } from './shapes.js';
import { placeRail, RAIL_BASES } from './rails.js';

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };

/** The horizontal direction the player looks toward ('north' = -Z, 'east' = +X...). */
export function lookFacing(dir) {
  if (Math.abs(dir[0]) > Math.abs(dir[2])) return dir[0] > 0 ? 'east' : 'west';
  return dir[2] > 0 ? 'south' : 'north';
}
const normalFacing = (nx, nz) => (nx > 0 ? 'east' : nx < 0 ? 'west' : nz > 0 ? 'south' : nz < 0 ? 'north' : null);

/** Can this cell take a new block? (air, water, tall grass...) */
export function canReplace(id) {
  const b = BLOCKS[id];
  return !!b && (id === 0 || b.liquid || b.replaceable);
}

/**
 * Work out what using item `heldId` on the clicked block does.
 * @param {number} heldId
 * @param {{x,y,z,nx,ny,nz,id}} hit  the block looked at and the face normal
 * @param {number[]} dir   look direction
 * @param {number} hitY    height of the exact hit point (for top/bottom halves)
 * @param {(x,y,z)=>number} getBlock
 * @returns {null | {blocks: [x,y,z,id][]}}  every block to set (first one is "the" block)
 */
export function placementFor(heldId, hit, dir, hitY, getBlock) {
  const item = ITEMS[heldId];
  if (!item || !hit) return null;
  const hitDef = BLOCKS[hit.id];
  // Most things go in the cell in front of the clicked face; tall grass etc. are replaced directly.
  const replacing = hitDef.replaceable && !(hitDef.base && hitDef.base === BLOCKS[heldId]?.base);
  let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
  if (replacing) { x = hit.x; y = hit.y; z = hit.z; }
  const side = !replacing && hit.ny === 0;
  const top = side ? hitY - Math.floor(hitY) > 0.5 : hit.ny === -1;
  const look = lookFacing(dir);
  const below = () => getBlock(x, y - 1, z);
  const solidBelow = () => { const s = below(); return IS_SOLID[s] && (SHAPE[s] === 0 || SHAPE[s] === 5); };
  const out = (id, ...more) => (id ? { blocks: [[x, y, z, id], ...more] } : null);

  // ---- items that plant or place a different block ----
  if (item.plants) {
    if (hit.ny !== 1 || hit.id !== B.FARMLAND || getBlock(hit.x, hit.y + 1, hit.z) !== 0) return null;
    return { blocks: [[hit.x, hit.y + 1, hit.z, FAMILIES[item.plants].baseId]] };
  }
  if (item.name === 'redstone') return hit.ny === 1 && canReplace(getBlock(x, y, z)) && solidBelow() ? out(FAMILIES.redstone_wire.baseId) : null;
  if (item.name === 'cocoa_beans') {
    if (!side || hit.id !== B.JUNGLE_LOG) return null;
    return canReplace(getBlock(x, y, z)) ? out(stateId('cocoa', { facing: normalFacing(hit.nx, hit.nz) })) : null;
  }
  if (!item.isBlock) return null;
  const def = BLOCKS[heldId];
  if (!def || def.hidden) return null;

  // ---- slabs stack into a full block ----
  if (def.shape === 'slab') {
    const fam = def.base;
    const onSlab = (id, wantHalf) => BLOCKS[id]?.base === fam && BLOCKS[id].state.half === wantHalf;
    if (!replacing && hit.ny === 1 && onSlab(hit.id, 'bottom')) return { blocks: [[hit.x, hit.y, hit.z, B[def.double.toUpperCase()]]] };
    if (!replacing && hit.ny === -1 && onSlab(hit.id, 'top')) return { blocks: [[hit.x, hit.y, hit.z, B[def.double.toUpperCase()]]] };
    const cur = getBlock(x, y, z);
    if (BLOCKS[cur]?.base === fam) return out(B[def.double.toUpperCase()]);
  }
  if (!canReplace(getBlock(x, y, z))) return null;
  if (y < 0) return null;

  const fam = def.base ? FAMILIES[def.base] : null;
  const st = (state) => stateId(def.base, state);
  const keys = fam ? fam.keys : [];

  if (heldId === B.TORCH || def.name === 'redstone_torch') {
    if (replacing || hit.ny === 1) return out(heldId);
    if (hit.ny === -1) return null;
    return out(wallTorchFor(hit.nx, hit.nz, heldId === B.TORCH ? 'wall_torch' : 'redstone_wall_torch'));
  }
  if (keys.includes('axis')) return out(st({ axis: hit.nx ? 'x' : hit.nz ? 'z' : 'y' }));
  switch (def.shape) {
    case 'stairs': return out(st({ half: top ? 'top' : 'bottom', facing: look }));
    case 'slab': return out(st({ half: top ? 'top' : 'bottom' }));
    case 'trapdoor': return out(st({ half: top ? 'top' : 'bottom', open: false, facing: side ? normalFacing(hit.nx, hit.nz) : OPPOSITE[look] }));
    case 'gate': return out(st({ open: false, facing: look }));
    case 'door': {
      if (!solidBelow() || !canReplace(getBlock(x, y + 1, z))) return null;
      return out(st({ half: 'lower', open: false, facing: look }), [x, y + 1, z, st({ half: 'upper', open: false, facing: look })]);
    }
    case 'bed': {
      const [dx, dz] = FACING_VEC[look];
      if (!solidBelow() || !canReplace(getBlock(x + dx, y, z + dz))) return null;
      const s2 = getBlock(x + dx, y - 1, z + dz);
      if (!IS_SOLID[s2]) return null;
      return out(st({ part: 'foot', facing: look }), [x + dx, y, z + dz, st({ part: 'head', facing: look })]);
    }
    case 'chest': return keys.includes('facing') ? out(st({ facing: OPPOSITE[look] })) : out(heldId);
    case 'wall_flat': case 'button': {
      if (!side) return null;
      return out(st({ facing: normalFacing(hit.nx, hit.nz) }));
    }
    case 'repeater': return out(st({ facing: look }));
    case 'anvil': return out(st({ facing: look === 'north' || look === 'south' ? 'north' : 'east' }));
    case 'flat':
      // rails pick their own shape and join up with their neighbours (only the new rail is sent;
      // the server reshapes the neighbours the same way)
      if (RAIL_BASES.includes(def.base)) {
        if (!solidBelow()) return null;
        const all = placeRail(def.base, x, y, z, look[0], getBlock);
        return { blocks: all, send: [all[0]] };
      }
      if (keys.includes('dir')) return out(st({ dir: look === 'east' || look === 'west' ? 'ew' : 'ns' }));
      break;
    default:
      // Dispensers, droppers and observers look back at you.
      if (keys.includes('facing')) return out(st({ facing: OPPOSITE[look] }));
  }
  return out(heldId);
}

/** Could a player legitimately place block `id`? (item forms, plus the states the rules above produce) */
export function isPlaceableState(id) {
  const b = BLOCKS[id];
  if (!b || id === 0 || b.liquid) return false;
  if (!b.hidden || b.placeable) return true;
  // hidden states of a visible family (a door's upper half, an open gate...)
  if (b.base && FAMILIES[b.base] && !BLOCKS[FAMILIES[b.base].baseId].hidden) return true;
  // double slabs come from stacking two slabs; crops from planting seeds
  return !!b.crop;
}
