// ============================================================================
// The server's copy of one world.
//
// The server never stores whole chunks on disk. Terrain is regenerated from
// the seed whenever needed, and only the *edits* (blocks players changed) are
// saved. Edits are kept per chunk as a Map of blockIndex -> blockId.
//
// Generated chunks are cached in memory (with edits applied) for validating
// edits and for mob physics. The cache is bounded (least-recently-used
// chunks are dropped), which is safe because edits are stored separately.
// ============================================================================
import { createGenerator } from '../shared/terrain.js';
import { CHUNK_HEIGHT as CH } from '../shared/config.js';
import { chunkKey, toChunk, toLocal, blockIndex } from '../shared/chunk.js';
import { B } from '../shared/blocks.js';

const MAX_CACHED_CHUNKS = 400; // ~13 MB

export class ServerWorld {
  constructor(seed, savedEdits = {}) {
    this.seed = seed;
    this.gen = createGenerator(seed);
    this.edits = new Map(); // "cx,cz" -> Map(index -> id)
    for (const [key, flat] of Object.entries(savedEdits)) {
      const m = new Map();
      for (let i = 0; i < flat.length; i += 2) m.set(flat[i], flat[i + 1]);
      this.edits.set(key, m);
    }
    this.cache = new Map();
    this.spawn = this.gen.findSpawn();
  }

  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let blocks = this.cache.get(key);
    if (blocks) {
      // refresh LRU position (Map keeps insertion order)
      this.cache.delete(key);
      this.cache.set(key, blocks);
      return blocks;
    }
    blocks = this.gen.generateChunk(cx, cz);
    const e = this.edits.get(key);
    if (e) for (const [i, id] of e) blocks[i] = id;
    this.cache.set(key, blocks);
    if (this.cache.size > MAX_CACHED_CHUNKS) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return blocks;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return 0;
    return this.getChunk(toChunk(x), toChunk(z))[blockIndex(toLocal(x), y, toLocal(z))];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return;
    const cx = toChunk(x), cz = toChunk(z);
    const i = blockIndex(toLocal(x), y, toLocal(z));
    this.getChunk(cx, cz)[i] = id;
    const key = chunkKey(cx, cz);
    let e = this.edits.get(key);
    if (!e) { e = new Map(); this.edits.set(key, e); }
    e.set(i, id);
  }

  /** Flat [idx, id, idx, id...] list of edits for one chunk (empty if none). */
  editsFor(cx, cz) {
    const e = this.edits.get(chunkKey(cx, cz));
    if (!e) return [];
    const out = new Array(e.size * 2);
    let k = 0;
    for (const [i, id] of e) { out[k++] = i; out[k++] = id; }
    return out;
  }

  /** Highest solid (non-air, non-plant) block in a column, or -1. */
  surfaceY(x, z) {
    for (let y = CH - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && id !== B.TALL_GRASS && id !== B.RED_FLOWER && id !== B.YELLOW_FLOWER && id !== B.TORCH) return y;
    }
    return -1;
  }

  serializeEdits() {
    const out = {};
    for (const [key, m] of this.edits) {
      if (!m.size) continue;
      const flat = [];
      for (const [i, id] of m) flat.push(i, id);
      out[key] = flat;
    }
    return out;
  }
}
