// ============================================================================
// Axis-aligned bounding box (AABB) physics against the block grid.
//
// Entities are boxes: `pos` is the centre of the box's *bottom* face (the
// feet). We move one axis at a time (Y, then X, then Z). After each axis move
// we look for any solid block overlapping the box; if there is one, we snap
// the box flush against it and zero that axis' velocity. Doing the axes
// separately is what makes "sliding along walls" work naturally.
// ============================================================================
import { IS_SOLID, IS_LIQUID } from './blocks.js';

const EPS = 1e-4;

/**
 * Move an entity with collisions.
 * @param {{x:number,y:number,z:number}} pos   feet position (mutated)
 * @param {{x:number,y:number,z:number}} vel   velocity in blocks/s (mutated)
 * @param {number} dt         seconds
 * @param {number} width      box width (X and Z)
 * @param {number} height     box height
 * @param {(x:number,y:number,z:number)=>number} getBlock  block id lookup
 * @returns {{onGround:boolean, hitWall:boolean, hitCeiling:boolean}}
 */
export function moveEntity(pos, vel, dt, width, height, getBlock) {
  const result = { onGround: false, hitWall: false, hitCeiling: false };
  // Split big moves into sub-steps so fast objects can't tunnel through blocks.
  const maxMove = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxMove / 0.4));
  const sdt = dt / steps;
  const hw = width / 2;
  for (let s = 0; s < steps; s++) {
    // --- Y axis ---
    if (vel.y !== 0) {
      pos.y += vel.y * sdt;
      const hit = findCollision(pos, hw, height, getBlock);
      if (hit) {
        if (vel.y < 0) { pos.y = hit.maxY + EPS; result.onGround = true; }
        else { pos.y = hit.minY - height - EPS; result.hitCeiling = true; }
        vel.y = 0;
      }
    }
    // --- X axis ---
    if (vel.x !== 0) {
      pos.x += vel.x * sdt;
      const hit = findCollision(pos, hw, height, getBlock);
      if (hit) {
        pos.x = vel.x > 0 ? hit.minX - hw - EPS : hit.maxX + hw + EPS;
        vel.x = 0; result.hitWall = true;
      }
    }
    // --- Z axis ---
    if (vel.z !== 0) {
      pos.z += vel.z * sdt;
      const hit = findCollision(pos, hw, height, getBlock);
      if (hit) {
        pos.z = vel.z > 0 ? hit.minZ - hw - EPS : hit.maxZ + hw + EPS;
        vel.z = 0; result.hitWall = true;
      }
    }
  }
  // Even with zero vertical velocity we want to know if we're standing on something.
  if (!result.onGround) {
    result.onGround = isSupported(pos, hw, getBlock);
  }
  return result;
}

/**
 * Return the merged bounds of solid blocks overlapping the box, or null.
 * Merging (taking min/max over all hits) is good enough because we only
 * call this after moving along a single axis.
 */
function findCollision(pos, hw, height, getBlock) {
  const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw);
  const y0 = Math.floor(pos.y), y1 = Math.floor(pos.y + height);
  const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw);
  let hit = null;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!IS_SOLID[getBlock(x, y, z)]) continue;
        if (!hit) hit = { minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: z, maxZ: z + 1 };
        else {
          if (x < hit.minX) hit.minX = x; if (x + 1 > hit.maxX) hit.maxX = x + 1;
          if (y < hit.minY) hit.minY = y; if (y + 1 > hit.maxY) hit.maxY = y + 1;
          if (z < hit.minZ) hit.minZ = z; if (z + 1 > hit.maxZ) hit.maxZ = z + 1;
        }
      }
    }
  }
  return hit;
}

/** Is there a solid block just under the feet? */
export function isSupported(pos, hw, getBlock) {
  const y = Math.floor(pos.y - 0.01);
  const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw);
  const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw);
  if (pos.y - (y + 1) > 0.02) return false; // feet aren't resting on top of block row y
  for (let z = z0; z <= z1; z++)
    for (let x = x0; x <= x1; x++)
      if (IS_SOLID[getBlock(x, y, z)]) return true;
  return false;
}

/** Does any solid block overlap this box? (used to stop placing blocks inside players) */
export function boxIntersectsBlock(pos, width, height, bx, by, bz) {
  const hw = width / 2;
  return pos.x + hw > bx && pos.x - hw < bx + 1 &&
         pos.y + height > by && pos.y < by + 1 &&
         pos.z + hw > bz && pos.z - hw < bz + 1;
}

/** Fraction of the body that is in liquid: 0 = dry, >0 = wading/swimming. */
export function liquidLevel(pos, height, getBlock) {
  const x = Math.floor(pos.x), z = Math.floor(pos.z);
  let count = 0;
  const samples = [0.1, 0.6, 1.2, 1.6];
  for (const dy of samples) {
    if (dy > height) break;
    if (IS_LIQUID[getBlock(x, Math.floor(pos.y + dy), z)]) count++;
  }
  return count / samples.length;
}
