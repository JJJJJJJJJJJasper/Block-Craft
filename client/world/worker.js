// ============================================================================
// Web Worker: terrain generation + lighting + meshing off the main thread.
// The main thread stays free for input and rendering, so the game never
// freezes while new chunks stream in.
//
// Messages in:  {type:'init', seed, faceLayers}
//               {type:'gen',  id, cx, cz}
//               {type:'mesh', id, chunks:[9 x Uint8Array]}
// Messages out: {id, blocks} | {id, mesh:{opaque, trans}}
// ============================================================================
import { createGenerator } from '../../shared/terrain.js';
import { initMesher, meshChunk } from './mesher.js';

let generator = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    generator = createGenerator(msg.seed);
    initMesher(msg.faceLayers);
    return;
  }
  if (msg.type === 'gen') {
    const blocks = generator.generateChunk(msg.cx, msg.cz);
    self.postMessage({ id: msg.id, blocks }, [blocks.buffer]);
    return;
  }
  if (msg.type === 'mesh') {
    const mesh = meshChunk(msg.chunks);
    const transfer = [];
    for (const part of [mesh.opaque, mesh.trans]) {
      transfer.push(part.pos.buffer, part.uv.buffer, part.data.buffer, part.idx.buffer);
    }
    self.postMessage({ id: msg.id, mesh }, transfer);
  }
};
