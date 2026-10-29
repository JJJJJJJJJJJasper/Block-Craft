// ============================================================================
// Block shapes made of boxes (stairs, slabs, doors, fences...).
//
// A box is [x0, y0, z0, x1, y1, z1] inside the block, in block units (0..1;
// fences go up to 1.5 for collision so you can't jump over them).
// The same boxes are used to DRAW a block (client mesher) and to COLLIDE
// with it (shared physics), so what you see is what you bump into.
//
// "Static" shapes depend only on the block's own state (stairs facing north,
// door open...). "Dynamic" shapes (fences, walls, panes) also depend on the
// neighbouring blocks, so they're computed on the fly from a getBlock lookup.
// ============================================================================

const P = 1 / 16;
// Facing directions: the way the player looked when placing. dx/dz unit vector.
export const FACINGS = ['north', 'east', 'south', 'west'];
export const FACING_VEC = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

/** Rotate a box defined for "north" around the block centre to another facing. */
export function rotateBox([x0, y0, z0, x1, y1, z1], facing) {
  switch (facing) {
    case 'east': return [1 - z1, y0, x0, 1 - z0, y1, x1];
    case 'south': return [1 - x1, y0, 1 - z1, 1 - x0, y1, 1 - z0];
    case 'west': return [z0, y0, 1 - x1, z1, y1, 1 - x0];
    default: return [x0, y0, z0, x1, y1, z1];
  }
}
const rot = (boxes, facing) => boxes.map(b => rotateBox(b, facing));
const flipY = (boxes) => boxes.map(([x0, y0, z0, x1, y1, z1]) => [x0, 1 - y1, z0, x1, 1 - y0, z1]);

/**
 * Boxes for a static shape, given the block definition's shape name and state.
 * Boxes are written for a block facing north and rotated.
 */
export function staticBoxes(shape, s = {}) {
  switch (shape) {
    case 'stairs': {
      // full-width bottom half + a back step on the far (north) side
      const b = rot([[0, 0, 0, 1, 0.5, 1], [0, 0.5, 0, 1, 1, 0.5]], s.facing);
      return s.half === 'top' ? flipY(b) : b;
    }
    case 'slab': return s.half === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case 'door': {
      // Closed: panel on the side nearest the player who placed it (south when facing north).
      // Open: swung against the left-hand side (west when facing north).
      const box = s.open ? [0, 0, 0, 3 * P, 1, 1] : [0, 0, 13 * P, 1, 1, 1];
      return [rotateBox(box, s.facing)];
    }
    case 'trapdoor': {
      if (s.open) return [rotateBox([0, 0, 13 * P, 1, 1, 1], s.facing)];
      return s.half === 'top' ? [[0, 13 * P, 0, 1, 1, 1]] : [[0, 0, 0, 1, 3 * P, 1]];
    }
    case 'gate': {
      // posts at both ends + two rails (drawn); collision uses gateCollision()
      const posts = [[0, 5 * P, 7 * P, 2 * P, 1, 9 * P], [14 * P, 5 * P, 7 * P, 1, 1, 9 * P]];
      const rails = s.open
        ? [[0, 6 * P, 9 * P, 2 * P, 9 * P, 15 * P], [0, 12 * P, 9 * P, 2 * P, 15 * P, 15 * P],
          [14 * P, 6 * P, 9 * P, 1, 9 * P, 15 * P], [14 * P, 12 * P, 9 * P, 1, 15 * P, 15 * P]]
        : [[2 * P, 6 * P, 7 * P, 14 * P, 9 * P, 9 * P], [2 * P, 12 * P, 7 * P, 14 * P, 15 * P, 9 * P],
          [6 * P, 9 * P, 7 * P, 10 * P, 12 * P, 9 * P]];
      return rot([...posts, ...rails], s.facing);
    }
    case 'bed': {
      const b = [[0, 3 * P, 0, 1, 9 * P, 1]];
      // two legs on the end that isn't joined to the other half
      const legs = s.part === 'head' ? [[0, 0, 0, 3 * P, 3 * P, 3 * P], [13 * P, 0, 0, 1, 3 * P, 3 * P]]
        : [[0, 0, 13 * P, 3 * P, 3 * P, 1], [13 * P, 0, 13 * P, 1, 3 * P, 1]];
      return rot([...b, ...legs], s.facing);
    }
    case 'chest': return [[P, 0, P, 15 * P, 14 * P, 15 * P]];
    case 'cake': return [[(1 + 2 * (s.bites || 0)) * P, 0, P, 15 * P, 8 * P, 15 * P]];
    case 'carpet': return [[0, 0, 0, 1, P, 1]];
    case 'snow_layer': return [[0, 0, 0, 1, 2 * P, 1]];
    case 'plate': return [[P, 0, P, 15 * P, P, 15 * P]];
    // wall-mounted things: `facing` points away from the wall, so for north the wall is on the south side
    case 'button': return [rotateBox([5 * P, 6 * P, 14 * P, 11 * P, 10 * P, 1], s.facing)];
    case 'lever': return [[5 * P, 0, 4 * P, 11 * P, 3 * P, 12 * P], [7 * P, 3 * P, 7 * P, 9 * P, 11 * P, 9 * P]];
    case 'cocoa': return [rotateBox([5 * P, 4 * P, 9 * P, 11 * P, 11 * P, 15 * P], s.facing)];
    case 'flower_pot': return [[5 * P, 0, 5 * P, 11 * P, 6 * P, 11 * P]];
    case 'table': return [[0, 0, 0, 1, 12 * P, 1]];
    case 'sensor': return [[0, 0, 0, 1, 6 * P, 1]];
    case 'repeater': return rot([[0, 0, 0, 1, 2 * P, 1], [7 * P, 2 * P, 3 * P, 9 * P, 7 * P, 5 * P], [7 * P, 2 * P, 10 * P, 9 * P, 7 * P, 12 * P]], s.facing);
    case 'hopper': return [[0, 10 * P, 0, 1, 1, 1], [4 * P, 4 * P, 4 * P, 12 * P, 10 * P, 12 * P], [6 * P, 0, 6 * P, 10 * P, 4 * P, 10 * P]];
    case 'cauldron': return [[0, 3 * P, 0, 1, 4 * P, 1], [0, 3 * P, 0, 2 * P, 1, 1], [14 * P, 3 * P, 0, 1, 1, 1], [2 * P, 3 * P, 0, 14 * P, 1, 2 * P], [2 * P, 3 * P, 14 * P, 14 * P, 1, 1],
      [0, 0, 0, 4 * P, 3 * P, 4 * P], [12 * P, 0, 0, 1, 3 * P, 4 * P], [0, 0, 12 * P, 4 * P, 3 * P, 1], [12 * P, 0, 12 * P, 1, 3 * P, 1]];
    case 'anvil': return rot([[2 * P, 0, 2 * P, 14 * P, 4 * P, 14 * P], [4 * P, 4 * P, 3 * P, 12 * P, 5 * P, 13 * P], [6 * P, 5 * P, 4 * P, 10 * P, 10 * P, 12 * P], [3 * P, 10 * P, 0, 13 * P, 1, 1]], s.facing);
    case 'lily': return [[0, 0, 0, 1, P / 4, 1]];
    default: return null;
  }
}

/** Collision boxes that differ from the drawn ones (null = same as drawn, [] = none). */
export function staticCollision(shape, s = {}) {
  switch (shape) {
    case 'gate': {
      if (s.open) return [];
      const axisX = s.facing === 'north' || s.facing === 'south';
      return [axisX ? [0, 0, 6 * P, 1, 1.5, 10 * P] : [6 * P, 0, 0, 10 * P, 1.5, 1]];
    }
    case 'bed': return [[0, 0, 0, 1, 9 * P, 1]];
    case 'plate': case 'button': case 'lever': return [];
    case 'lily': return [[0, 0, 0, 1, P, 1]];
    default: return null;
  }
}

// ---- Dynamic shapes: depend on neighbours -----------------------------------
/**
 * @param {string} shape 'fence' | 'wall' | 'pane'
 * @param {boolean[]} conn connections [north, east, south, west]
 */
export function dynamicBoxes(shape, conn) {
  const out = [];
  if (shape === 'fence') {
    out.push([6 * P, 0, 6 * P, 10 * P, 1, 10 * P]);
    const bars = (x0, z0, x1, z1) => { out.push([x0, 6 * P, z0, x1, 9 * P, z1], [x0, 12 * P, z0, x1, 15 * P, z1]); };
    if (conn[0]) bars(7 * P, 0, 9 * P, 6 * P);
    if (conn[1]) bars(10 * P, 7 * P, 1, 9 * P);
    if (conn[2]) bars(7 * P, 10 * P, 9 * P, 1);
    if (conn[3]) bars(0, 7 * P, 6 * P, 9 * P);
  } else if (shape === 'wall') {
    // a straight wall without a post when it only connects on one axis
    const straight = (conn[0] && conn[2] && !conn[1] && !conn[3]) || (conn[1] && conn[3] && !conn[0] && !conn[2]);
    if (!straight) out.push([4 * P, 0, 4 * P, 12 * P, 1, 12 * P]);
    const h = 13 * P;
    if (conn[0]) out.push([5 * P, 0, 0, 11 * P, h, straight ? 1 : 4 * P]);
    if (conn[1]) out.push([straight ? 0 : 12 * P, 0, 5 * P, 1, h, 11 * P]);
    if (conn[2] && !straight) out.push([5 * P, 0, 12 * P, 11 * P, h, 1]);
    if (conn[3] && !straight) out.push([0, 0, 5 * P, 4 * P, h, 11 * P]);
  } else if (shape === 'pane') {
    const any = conn.some(Boolean);
    const n = conn[0] || !any, e = conn[1] || !any, s = conn[2] || !any, w = conn[3] || !any;
    out.push([7 * P, 0, 7 * P, 9 * P, 1, 9 * P]);
    if (n) out.push([7 * P, 0, 0, 9 * P, 1, 7 * P]);
    if (s) out.push([7 * P, 0, 9 * P, 9 * P, 1, 1]);
    if (e) out.push([9 * P, 0, 7 * P, 1, 1, 9 * P]);
    if (w) out.push([0, 0, 7 * P, 7 * P, 1, 9 * P]);
  }
  return out;
}

export function dynamicCollision(shape, conn) {
  if (shape === 'fence' || shape === 'wall') {
    // Taller than a jump, like the real thing. Connected sides extend to the edge.
    return [[conn[3] ? 0 : 5 * P, 0, conn[0] ? 0 : 5 * P, conn[1] ? 1 : 11 * P, 1.5, conn[2] ? 1 : 11 * P]];
  }
  if (shape === 'pane') return dynamicBoxes('pane', conn);
  return [];
}

export const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // north, east, south, west

// Corners (counter-clockwise seen from outside) and texture coordinates for
// each face of a box b = [x0, y0, z0, x1, y1, z1], faces +X,-X,+Y,-Y,+Z,-Z.
export const BOX_FACES = [
  (b) => [[b[3], b[1], b[5], 1 - b[5], b[1]], [b[3], b[1], b[2], 1 - b[2], b[1]], [b[3], b[4], b[2], 1 - b[2], b[4]], [b[3], b[4], b[5], 1 - b[5], b[4]]],
  (b) => [[b[0], b[1], b[2], b[2], b[1]], [b[0], b[1], b[5], b[5], b[1]], [b[0], b[4], b[5], b[5], b[4]], [b[0], b[4], b[2], b[2], b[4]]],
  (b) => [[b[0], b[4], b[5], b[0], b[5]], [b[3], b[4], b[5], b[3], b[5]], [b[3], b[4], b[2], b[3], b[2]], [b[0], b[4], b[2], b[0], b[2]]],
  (b) => [[b[0], b[1], b[2], b[0], b[2]], [b[3], b[1], b[2], b[3], b[2]], [b[3], b[1], b[5], b[3], b[5]], [b[0], b[1], b[5], b[0], b[5]]],
  (b) => [[b[0], b[1], b[5], b[0], b[1]], [b[3], b[1], b[5], b[3], b[1]], [b[3], b[4], b[5], b[3], b[4]], [b[0], b[4], b[5], b[0], b[4]]],
  (b) => [[b[3], b[1], b[2], 1 - b[3], b[1]], [b[0], b[1], b[2], 1 - b[0], b[1]], [b[0], b[4], b[2], 1 - b[0], b[4]], [b[3], b[4], b[2], 1 - b[3], b[4]]],
];
