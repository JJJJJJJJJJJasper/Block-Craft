// ============================================================================
// Light engine (runs inside a Web Worker, just before meshing a chunk).
//
// Two kinds of light, each 0..15:
//   skylight   - light from the open sky. Its *brightness* follows the day/
//                night cycle, but that scaling happens in the shader, so the
//                light values themselves never change with time of day.
//   blocklight - light emitted by blocks such as torches.
//
// We compute light over a "padded" volume: the chunk being meshed plus its 8
// neighbours (48 x 48 x 128). A torch can light up to 14 blocks away, so
// light from neighbouring chunks spills correctly across chunk borders.
//
// Both kinds spread with a breadth-first flood fill (BFS): every step away
// from a source loses 1 level (more through leaves/water). BFS processes cells
// in order of distance, the same idea as Dijkstra's algorithm on a grid.
// ============================================================================
import { LIGHT_OPACITY, LIGHT_EMIT, IS_OPAQUE } from '../../shared/blocks.js';
import { CHUNK_HEIGHT } from '../../shared/config.js';

export const PW = 48;                   // padded width (3 chunks)
export const PH = CHUNK_HEIGHT;
export const PLAYER = PW * PW;          // cells per horizontal layer
export const PVOL = PW * PW * PH;

// Re-used between calls so we don't allocate megabytes per chunk.
const queue = new Int32Array(PVOL);
export const sky = new Uint8Array(PVOL);
export const blk = new Uint8Array(PVOL);

/**
 * @param {Uint8Array} vol padded block ids, index = x + z*PW + y*PW*PW
 * @param {number} maxY highest non-air y in the volume
 */
export function computeLight(vol, maxY) {
  sky.fill(0);
  blk.fill(0);
  const top = Math.min(PH - 1, maxY + 1);

  // --- 1. Skylight straight down each column ---------------------------
  for (let z = 0; z < PW; z++) {
    for (let x = 0; x < PW; x++) {
      const col = x + z * PW;
      // Everything above the highest block is fully lit.
      for (let y = PH - 1; y > top; y--) sky[col + y * PLAYER] = 15;
      let light = 15;
      for (let y = top; y >= 0 && light > 0; y--) {
        const i = col + y * PLAYER;
        const op = LIGHT_OPACITY[vol[i]];
        if (op) light = op >= 15 ? 0 : Math.max(0, light - op);
        sky[i] = light;
      }
    }
  }

  // --- 2. Seed the sideways spread ----------------------------------------
  // A lit cell next to a darker transparent cell (e.g. under an overhang or
  // at a cave mouth) is a starting point for the flood fill.
  let head = 0, tail = 0;
  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < PW; z++) {
      for (let x = 0; x < PW; x++) {
        const i = x + z * PW + y * PLAYER;
        const l = sky[i];
        if (l < 2) continue;
        if ((x > 0 && sky[i - 1] < l - 1 && !IS_OPAQUE[vol[i - 1]]) ||
            (x < PW - 1 && sky[i + 1] < l - 1 && !IS_OPAQUE[vol[i + 1]]) ||
            (z > 0 && sky[i - PW] < l - 1 && !IS_OPAQUE[vol[i - PW]]) ||
            (z < PW - 1 && sky[i + PW] < l - 1 && !IS_OPAQUE[vol[i + PW]]) ||
            (y > 0 && sky[i - PLAYER] < l - 1 && !IS_OPAQUE[vol[i - PLAYER]])) {
          queue[tail++] = i;
        }
      }
    }
  }
  flood(vol, sky, head, tail);

  // --- 3. Block light from emitters (torches, lit furnaces) ----------------
  tail = 0;
  for (let i = 0; i < PLAYER * (top + 1); i++) {
    const e = LIGHT_EMIT[vol[i]];
    if (e) { blk[i] = e; queue[tail++] = i; }
  }
  flood(vol, blk, 0, tail);
}

/** Breadth-first light spreading from the cells already in the queue. */
function flood(vol, light, head, tail) {
  while (head < tail) {
    const i = queue[head++];
    const l = light[i];
    if (l <= 1) continue;
    const y = (i / PLAYER) | 0;
    const rem = i - y * PLAYER;
    const z = (rem / PW) | 0;
    const x = rem - z * PW;
    // Try each of the 6 neighbours.
    if (x > 0) tail = spread(vol, light, i - 1, l, tail);
    if (x < PW - 1) tail = spread(vol, light, i + 1, l, tail);
    if (z > 0) tail = spread(vol, light, i - PW, l, tail);
    if (z < PW - 1) tail = spread(vol, light, i + PW, l, tail);
    if (y > 0) tail = spread(vol, light, i - PLAYER, l, tail);
    if (y < PH - 1) tail = spread(vol, light, i + PLAYER, l, tail);
  }
}

function spread(vol, light, n, l, tail) {
  const op = LIGHT_OPACITY[vol[n]];
  if (op >= 15) return tail;
  const nl = l - 1 - op;
  if (nl > light[n]) {
    light[n] = nl;
    queue[tail++] = n;
  }
  return tail;
}
