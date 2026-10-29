// ============================================================================
// Web Worker: terrain generation + lighting + meshing off the main thread.
// The main thread stays free for input and rendering, so the game never
// freezes while new chunks stream in.
//
// Messages in:  {type:'init', seed, faceLayers}
//               {type:'gen',  id, cx, cz}
//               {type:'mesh', id, cx, cz, chunks:[9 x Uint8Array]}
// Messages out: {id, blocks} | {id, mesh:{opaque, trans}}
// ============================================================================
import { createGenerator } from '../../shared/terrain.js';
import { initMesher, meshChunk } from './mesher.js';

let generator = null;

// Biome of every column of a chunk (for grass/leaf colours), cached because
// a chunk is often re-meshed after edits.
const biomeCache = new Map();
function biomesFor(cx, cz) {
  const key = cx + ',' + cz;
  let b = biomeCache.get(key);
  if (!b) {
    b = new Uint8Array(256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) b[x + z * 16] = generator.column(cx * 16 + x, cz * 16 + z).biome;
    biomeCache.set(key, b);
    if (biomeCache.size > 1024) biomeCache.delete(biomeCache.keys().next().value);
  }
  return b;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generator = createGenerator(msg.seed);
    biomeCache.clear();
    initMesher(msg.faceLayers);
    return;
  }
  if (msg.type === 'gen') {
    const blocks = generator.generateChunk(msg.cx, msg.cz);
    self.postMessage({ id: msg.id, blocks }, [blocks.buffer]);
    return;
  }
  if (msg.type === 'mesh') {
    const mesh = meshChunk(msg.chunks, biomesFor(msg.cx, msg.cz));
    const transfer = [];
    for (const part of [mesh.opaque, mesh.trans]) {
      transfer.push(part.pos.buffer, part.uv.buffer, part.data.buffer, part.tint.buffer, part.idx.buffer);
    }
    self.postMessage({ id: msg.id, mesh }, transfer);
  }
};
