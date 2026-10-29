// ============================================================================
// Client-side world: which chunks are loaded, their block data, and their
// meshes. Each chunk goes through these steps:
//
//   1. requested  -> a worker generates the terrain from the seed, and in
//                    parallel the server is asked for that chunk's edits
//   2. ready      -> terrain + server edits are both in; block data is final
//   3. meshed     -> once all 8 neighbours are ready too (their blocks affect
//                    face culling and light at the border), a worker builds the mesh
//
// Chunks too far from the player are unloaded to keep memory bounded.
// ============================================================================
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH } from '../../shared/config.js';
import { chunkNumKey, toChunk, toLocal, blockIndex } from '../../shared/chunk.js';
import { B } from '../../shared/blocks.js';
import { WorkerPool } from './workerPool.js';

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null;          // Uint8Array once generated
    this.generating = false;
    this.editsReceived = false;  // server has told us this chunk's edits
    this.pendingEdits = [];      // edits that arrived before generation finished
    this.version = 0;            // bumps on every change; used to detect stale meshes
    this.meshedVersion = -1;
    this.meshing = false;
    this.opaqueMesh = null;
    this.transMesh = null;
    this.urgent = false;         // player edit: remesh before anything else
  }
  get ready() { return this.blocks !== null && this.editsReceived; }
}

export class ClientWorld {
  constructor(renderer, seed, faceLayers, requestEdits) {
    this.renderer = renderer;
    this.requestEdits = requestEdits;  // callback(list of [cx,cz]) -> asks the server
    this.chunks = new Map();
    this.renderDistance = 6;
    this.center = { cx: 0, cz: 0 };
    this.pendingEditRequests = [];
    // Leave one core for the main thread; cap at 3 workers (memory on 4GB devices).
    const cores = navigator.hardwareConcurrency || 2;
    const n = Math.max(1, Math.min(3, cores - 1));
    this.pool = new WorkerPool(n, { type: 'init', seed, faceLayers });
    this.meshJobsInFlight = 0;
    this.maxMeshJobs = n * 2;
    this.stats = { meshed: 0, chunksLoaded: 0 };
  }

  // ---- Block access ------------------------------------------------------
  getChunk(cx, cz) { return this.chunks.get(chunkNumKey(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= CH) return 0;
    const c = this.chunks.get(chunkNumKey(toChunk(x), toChunk(z)));
    if (!c || !c.blocks) return 0;
    return c.blocks[blockIndex(toLocal(x), y, toLocal(z))];
  }

  /** Is the terrain at this world position loaded and final? */
  isReadyAt(x, z) {
    const c = this.chunks.get(chunkNumKey(toChunk(x), toChunk(z)));
    return !!(c && c.ready);
  }

  /**
   * Change a block. Marks the chunk and any neighbour that could be affected
   * (borders for culling, light can spread up to 14 blocks) for remeshing.
   */
  setBlock(x, y, z, id, urgent = false) {
    if (y < 0 || y >= CH) return;
    const cx = toChunk(x), cz = toChunk(z);
    const c = this.chunks.get(chunkNumKey(cx, cz));
    if (!c) return;
    if (!c.blocks) { c.pendingEdits.push([blockIndex(toLocal(x), y, toLocal(z)), id]); return; }
    const i = blockIndex(toLocal(x), y, toLocal(z));
    if (c.blocks[i] === id) return;
    c.blocks[i] = id;
    this._touch(cx, cz, toLocal(x), toLocal(z), urgent);
  }

  _touch(cx, cz, lx, lz, urgent) {
    const c = this.getChunk(cx, cz);
    c.version++;
    if (urgent) c.urgent = true;
    // Light changes can reach neighbouring chunks, so remesh all 8 of them
    // (with lower priority than the edited chunk itself).
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const n = this.getChunk(cx + dx, cz + dz);
        if (!n) continue;
        n.version++;
        // Directly adjacent border edits change visible faces: also urgent.
        const touchesBorder = (dx === -1 && lx === 0) || (dx === 1 && lx === CS - 1) || (dz === -1 && lz === 0) || (dz === 1 && lz === CS - 1);
        if (urgent && touchesBorder && (dx === 0 || dz === 0)) n.urgent = true;
      }
    }
  }

  /** Server sent the edit list for a chunk: [idx, id, idx, id, ...]. */
  applyChunkEdits(cx, cz, edits) {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    if (c.blocks) {
      for (let i = 0; i < edits.length; i += 2) c.blocks[edits[i]] = edits[i + 1];
      c.version++;
    } else {
      for (let i = 0; i < edits.length; i += 2) c.pendingEdits.push([edits[i], edits[i + 1]]);
    }
    c.editsReceived = true;
  }

  // ---- Streaming ------------------------------------------------------------
  /** Called every frame with the player's position. */
  update(px, pz) {
    const pcx = toChunk(Math.floor(px)), pcz = toChunk(Math.floor(pz));
    this.center = { cx: pcx, cz: pcz };
    const rd = this.renderDistance;
    // Load further than we draw: every drawn chunk needs all 8 neighbours
    // (including diagonals, which stick out ~1.4 chunks past the circle).
    const loadR = rd + 2;

    // Load missing chunks, nearest first.
    if (!this._lastCenter || this._lastCenter.cx !== pcx || this._lastCenter.cz !== pcz || this._lastRd !== rd) {
      this._lastCenter = { cx: pcx, cz: pcz };
      this._lastRd = rd;
      const wanted = [];
      for (let dz = -loadR; dz <= loadR; dz++) {
        for (let dx = -loadR; dx <= loadR; dx++) {
          if (dx * dx + dz * dz > loadR * loadR) continue;
          wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
        }
      }
      wanted.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of wanted) {
        const key = chunkNumKey(cx, cz);
        if (!this.chunks.has(key)) this._loadChunk(cx, cz, key);
      }
      // Unload far chunks.
      const unloadR2 = (rd + 4) * (rd + 4); // a little slack so walking back and forth doesn't reload chunks
      for (const [key, c] of this.chunks) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > unloadR2) this._unloadChunk(key, c);
      }
    }

    if (this.pendingEditRequests.length) {
      this.requestEdits(this.pendingEditRequests);
      this.pendingEditRequests = [];
    }

    this._scheduleMeshing(pcx, pcz, rd);
  }

  _loadChunk(cx, cz, key) {
    const c = new Chunk(cx, cz);
    this.chunks.set(key, c);
    c.generating = true;
    this.pendingEditRequests.push([cx, cz]);
    const prio = () => {
      const dx = cx - this.center.cx, dz = cz - this.center.cz;
      return dx * dx + dz * dz;
    };
    this.pool.run({ type: 'gen', cx, cz }, prio).then(res => {
      if (!res || this.chunks.get(key) !== c) return; // cancelled or unloaded
      c.blocks = res.blocks;
      c.generating = false;
      for (const [i, id] of c.pendingEdits) c.blocks[i] = id;
      c.pendingEdits.length = 0;
      c.version++;
      this.stats.chunksLoaded++;
      // Neighbours may have been waiting on us to mesh.
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = this.getChunk(cx + dx, cz + dz);
        if (n && n !== c) n.version++;
      }
    });
  }

  _unloadChunk(key, c) {
    this.renderer.removeMesh(c.opaqueMesh);
    this.renderer.removeMesh(c.transMesh);
    c.opaqueMesh = c.transMesh = null;
    this.chunks.delete(key);
    if (c.generating) this.pool.cancel(m => m.type === 'gen' && m.cx === c.cx && m.cz === c.cz);
  }

  _neighboursReady(c) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (!n || !n.ready) return false;
    }
    return true;
  }

  _scheduleMeshing(pcx, pcz, rd) {
    // Gather chunks that need a (re)mesh, nearest first; urgent ones jump the queue.
    const candidates = [];
    const r2 = rd * rd + 1;
    for (const c of this.chunks.values()) {
      if (c.meshing || c.meshedVersion === c.version || !c.ready) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (!this._neighboursReady(c)) continue;
      candidates.push([c, c.urgent ? -1 : d2]);
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a[1] - b[1]);
    for (const [c, prio] of candidates) {
      if (this.meshJobsInFlight >= this.maxMeshJobs && prio >= 0) break;
      this._meshChunk(c, prio);
    }
  }

  _meshChunk(c, prio) {
    const chunks = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      chunks.push(this.getChunk(c.cx + dx, c.cz + dz).blocks);
    }
    const version = c.version;
    c.meshing = true;
    c.urgent = false;
    this.meshJobsInFlight++;
    this.pool.run({ type: 'mesh', chunks, cx: c.cx, cz: c.cz }, prio).then(res => {
      this.meshJobsInFlight--;
      c.meshing = false;
      if (!res || this.getChunk(c.cx, c.cz) !== c) return;
      this.renderer.removeMesh(c.opaqueMesh);
      this.renderer.removeMesh(c.transMesh);
      c.opaqueMesh = this.renderer.createChunkMesh(res.mesh.opaque, false, c.cx, c.cz);
      c.transMesh = this.renderer.createChunkMesh(res.mesh.trans, true, c.cx, c.cz);
      c.meshedVersion = version;
      this.stats.meshed++;
    });
  }

  /** Fraction of chunks within `radius` of the player that are meshed (for the loading bar). */
  loadProgress(radius) {
    let total = 0, done = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > radius * radius + 1) continue;
      total++;
      const c = this.getChunk(this.center.cx + dx, this.center.cz + dz);
      if (c && c.meshedVersion >= 0) done++;
    }
    return total ? done / total : 0;
  }

  /** Throw everything away (used after a reconnect to resync with the server). */
  clear() {
    for (const [key, c] of this.chunks) this._unloadChunk(key, c);
    this._lastCenter = null;
  }

  get loadedCount() { return this.chunks.size; }
}
