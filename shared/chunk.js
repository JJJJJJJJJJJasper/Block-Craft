// ============================================================================
// Chunk coordinate helpers shared by client and server.
//
// A chunk is a 16 x 128 x 16 column of blocks stored in a flat Uint8Array
// (one byte per block = the block id). Index layout is x fastest, then z,
// then y:   index = x + z*16 + y*256
// so a horizontal 16x16 slice is contiguous in memory.
// ============================================================================
import { CHUNK_SIZE, CHUNK_HEIGHT } from './config.js';

export const CS = CHUNK_SIZE;
export const CH = CHUNK_HEIGHT;
export const LAYER = CS * CS;

export function blockIndex(x, y, z) {
  return x + z * CS + y * LAYER;
}

/** Floor-divide that works for negatives: -1 -> chunk -1, not 0. */
export function toChunk(v) {
  return Math.floor(v / CS);
}

/** World coordinate -> local coordinate inside its chunk (0..15). */
export function toLocal(v) {
  return ((v % CS) + CS) % CS;
}

/** String key for maps that are saved to JSON. */
export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

/**
 * Numeric key for hot-path maps (faster than strings). Valid for chunk
 * coordinates within +-32767, i.e. +-524k blocks from the origin.
 */
export function chunkNumKey(cx, cz) {
  return (cx + 32768) * 65536 + (cz + 32768);
}
