// ============================================================================
// Axis-aligned bounding box (AABB) physics against the block grid.
//
// Entities are boxes: `pos` is the centre of the box's *bottom* face (the
// feet). We move one axis at a time (Y, then X, then Z). After each axis move
// we look for any block box overlapping the entity; if there is one, we snap
// the entity flush against it and zero that axis' velocity. Doing the axes
// separately is what makes "sliding along walls" work naturally.
//
// Blocks aren't always full cubes: stairs, slabs, doors and fences have their
// own boxes (shared/shapes.js). Walking into something at most STEP_HEIGHT
// tall (a slab, a stair) lifts you onto it automatically.
// ============================================================================
import { IS_SOLID, IS_LIQUID, IS_CLIMBABLE, COLLIDE, SHAPE, CONNECT, IS_OPAQUE } from './blocks.js';
import { dynamicCollision, NEIGHBOURS } from './shapes.js';

const EPS = 1e-4;
export const STEP_HEIGHT = 0.6;
const FULL = [[0, 0, 0, 1, 1, 1]];

/** Does a fence/wall/pane at (x,y,z) join the neighbour block `n`? */
export function connects(self, n) {
  const a = CONNECT[self], b = CONNECT[n];
  if (IS_OPAQUE[n]) return true;
  if (!a || !b) return false;
  if (a === 4 || b === 4) return a !== 3 && b !== 3; // gates join fences and walls
  return a === b || (a !== 3 && b !== 3 && a === b);
}

/** Collision boxes (block units) for the block at (x, y, z), or null if none. */
export function collisionBoxes(id, x, y, z, getBlock) {
  if (!IS_SOLID[id]) return null;
  const s = SHAPE[id];
  if (s === 6 || s === 7 || s === 8) {
    const conn = NEIGHBOURS.map(([dx, dz]) => connects(id, getBlock(x + dx, y, z + dz)));
    return dynamicCollision(s === 6 ? 'fence' : s === 7 ? 'wall' : 'pane', conn);
  }
  return COLLIDE[id] || FULL;
}

/**
 * Move an entity with collisions.
 * @param {{x:number,y:number,z:number}} pos   feet position (mutated)
 * @param {{x:number,y:number,z:number}} vel   velocity in blocks/s (mutated)
 * @param {number} dt         seconds
 * @param {number} width      box width (X and Z)
 * @param {number} height     box height
 * @param {(x:number,y:number,z:number)=>number} getBlock  block id lookup
 * @param {boolean} [canStep] true when standing on the ground (allows stepping up)
 * @returns {{onGround:boolean, hitWall:boolean, hitCeiling:boolean}}
 */
export function moveEntity(pos, vel, dt, width, height, getBlock, canStep = false) {
  const result = { onGround: false, hitWall: false, hitCeiling: false };
  // Split big moves into sub-steps so fast objects can't tunnel through blocks.
  const maxMove = Math.max(Math.abs(vel.x), Math.abs(vel.y), Math.abs(vel.z)) * dt;
  const steps = Math.max(1, Math.ceil(maxMove / 0.4));
  const sdt = dt / steps;
  const hw = width / 2;
  let grounded = canStep;
  for (let s = 0; s < steps; s++) {
    // --- Y axis ---
    if (vel.y !== 0) {
      pos.y += vel.y * sdt;
      const hit = findCollision(pos, hw, height, getBlock);
      if (hit) {
        if (vel.y < 0) { pos.y = hit.maxY + EPS; result.onGround = true; grounded = true; }
        else { pos.y = hit.minY - height - EPS; result.hitCeiling = true; }
        vel.y = 0;
      }
    }
    // --- X and Z axes, with step-up ---
    for (const axis of ['x', 'z']) {
      const v = vel[axis];
      if (v === 0) continue;
      const before = pos[axis];
      pos[axis] += v * sdt;
      const hit = findCollision(pos, hw, height, getBlock);
      if (!hit) continue;
      // Low obstacle and we're on the ground: try standing on top of it.
      const rise = hit.maxY - pos.y;
      if (grounded && rise > 0 && rise <= STEP_HEIGHT) {
        const oldY = pos.y;
        pos.y = hit.maxY + EPS;
        if (!findCollision(pos, hw, height, getBlock)) continue;
        pos.y = oldY;
      }
      const min = axis === 'x' ? hit.minX : hit.minZ, max = axis === 'x' ? hit.maxX : hit.maxZ;
      pos[axis] = v > 0 ? min - hw - EPS : max + hw + EPS;
      // If snapping would move us backwards past where we started (diagonal
      // corner cases), just stay put instead.
      if ((v > 0 && pos[axis] < before - 0.01) || (v < 0 && pos[axis] > before + 0.01)) pos[axis] = before;
      vel[axis] = 0;
      result.hitWall = true;
    }
  }
  // Even with zero vertical velocity we want to know if we're standing on something.
  if (!result.onGround && vel.y <= 0) result.onGround = isSupported(pos, hw, getBlock);
  return result;
}

/**
 * Merged bounds of all block boxes overlapping the entity box, or null.
 * Merging (min/max over all hits) is good enough because we only call this
 * after moving along a single axis.
 */
function findCollision(pos, hw, height, getBlock) {
  const ex0 = pos.x - hw, ex1 = pos.x + hw, ey0 = pos.y, ey1 = pos.y + height, ez0 = pos.z - hw, ez1 = pos.z + hw;
  const x0 = Math.floor(ex0), x1 = Math.floor(ex1);
  const y0 = Math.floor(ey0) - 1, y1 = Math.floor(ey1); // one row lower: fences are 1.5 tall
  const z0 = Math.floor(ez0), z1 = Math.floor(ez1);
  let hit = null;
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = getBlock(x, y, z);
        if (!IS_SOLID[id]) continue;
        const boxes = collisionBoxes(id, x, y, z, getBlock);
        for (const b of boxes) {
          const bx0 = x + b[0], by0 = y + b[1], bz0 = z + b[2], bx1 = x + b[3], by1 = y + b[4], bz1 = z + b[5];
          if (bx1 <= ex0 || bx0 >= ex1 || by1 <= ey0 || by0 >= ey1 || bz1 <= ez0 || bz0 >= ez1) continue;
          if (!hit) hit = { minX: bx0, maxX: bx1, minY: by0, maxY: by1, minZ: bz0, maxZ: bz1 };
          else {
            if (bx0 < hit.minX) hit.minX = bx0; if (bx1 > hit.maxX) hit.maxX = bx1;
            if (by0 < hit.minY) hit.minY = by0; if (by1 > hit.maxY) hit.maxY = by1;
            if (bz0 < hit.minZ) hit.minZ = bz0; if (bz1 > hit.maxZ) hit.maxZ = bz1;
          }
        }
      }
    }
  }
  return hit;
}

/** Is the entity resting on top of some block box (feet within a hair of its top)? */
export function isSupported(pos, hw, getBlock) {
  const x0 = Math.floor(pos.x - hw), x1 = Math.floor(pos.x + hw);
  const z0 = Math.floor(pos.z - hw), z1 = Math.floor(pos.z + hw);
  const yTop = Math.floor(pos.y - 0.01);
  for (let y = yTop - 1; y <= yTop; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = getBlock(x, y, z);
        if (!IS_SOLID[id]) continue;
        for (const b of collisionBoxes(id, x, y, z, getBlock)) {
          const top = y + b[4];
          if (Math.abs(pos.y - top) > 0.02) continue;
          if (x + b[3] <= pos.x - hw || x + b[0] >= pos.x + hw || z + b[5] <= pos.z - hw || z + b[2] >= pos.z + hw) continue;
          return true;
        }
      }
    }
  }
  return false;
}

/** Does a solid block at (bx,by,bz) overlap this entity box? (stops placing blocks inside players) */
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

/** Is the entity touching a ladder or vine? */
export function onClimbable(pos, width, height, getBlock) {
  const hw = width / 2;
  for (let y = Math.floor(pos.y); y <= Math.floor(pos.y + height * 0.8); y++) {
    for (const [dx, dz] of [[0, 0], [hw, 0], [-hw, 0], [0, hw], [0, -hw]]) {
      if (IS_CLIMBABLE[getBlock(Math.floor(pos.x + dx), y, Math.floor(pos.z + dz))]) return true;
    }
  }
  return false;
}
