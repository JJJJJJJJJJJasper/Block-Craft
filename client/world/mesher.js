// ============================================================================
// Greedy chunk mesher (runs inside a Web Worker).
//
// Naive voxel rendering draws 6 faces x 32,768 blocks per chunk. Two tricks
// cut that down by ~100x:
//
//  1. Face culling: a face is only drawn if the block next to it is air or
//     see-through. Buried stone produces no geometry at all.
//  2. Greedy meshing: neighbouring visible faces that look identical (same
//     texture, same light, same ambient-occlusion) are merged into one big
//     rectangle. A flat 16x16 grass field becomes 1 quad instead of 256.
//
// We also compute per-vertex ambient occlusion (AO): corners where blocks meet
// get darker, which gives the world a soft, grounded look for almost no cost.
//
// Output is two meshes per chunk: "opaque" (solid + cut-out blocks like
// leaves/glass) and "translucent" (water, ice) which must be drawn blended.
// ============================================================================
import { IS_OPAQUE, IS_LIQUID, IS_TRANSLUCENT, SHAPE, TINT } from '../../shared/blocks.js';
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH } from '../../shared/config.js';
import { computeLight, sky, blk, PW, PLAYER, PVOL } from './lighting.js';

const LAYER = CS * CS;
const vol = new Uint8Array(PVOL);   // padded block volume, reused
let faceLayers = null;              // block id * 6 + face -> texture layer
let biomes = null;                  // biome id per column of the chunk being meshed

export function initMesher(layers) {
  faceLayers = layers;
}

/**
 * Index into the shader's tint palette for a block at local column (x, z):
 * 0 = untinted, 1 + 2*biome = that biome's grass colour, 2 + 2*biome = foliage.
 */
function tintOf(id, x, z) {
  const t = TINT[id];
  return t ? (biomes ? biomes[x + z * CS] : 8) * 2 + t : 0;
}

// Growable output buffers for one pass.
class Buffers {
  constructor() { this.pos = new Float32Array(1 << 15); this.uv = new Float32Array(1 << 14); this.data = new Uint8Array(1 << 15); this.tint = new Uint8Array(1 << 13); this.idx = new Uint32Array(1 << 14); this.reset(); }
  reset() { this.v = 0; this.i = 0; }
  ensure(nv, ni) {
    if ((this.v + nv) * 3 > this.pos.length) {
      const grow = (a, n) => { const b = new a.constructor(Math.max(a.length * 2, n)); b.set(a); return b; };
      this.pos = grow(this.pos, (this.v + nv) * 3);
      this.uv = grow(this.uv, (this.v + nv) * 2);
      this.data = grow(this.data, (this.v + nv) * 4);
      this.tint = grow(this.tint, this.v + nv);
    }
    if (this.i + ni > this.idx.length) {
      const b = new Uint32Array(Math.max(this.idx.length * 2, this.i + ni)); b.set(this.idx); this.idx = b;
    }
  }
  vertex(x, y, z, u, v, layer, s, b, aoShade, tint = 0) {
    const k = this.v++;
    this.tint[k] = tint;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.uv[k * 2] = u; this.uv[k * 2 + 1] = v;
    this.data[k * 4] = layer; this.data[k * 4 + 1] = s; this.data[k * 4 + 2] = b; this.data[k * 4 + 3] = aoShade;
    return k;
  }
  quad(a, b, c, d, flip) {
    const ix = this.idx;
    if (flip) { ix[this.i++] = b; ix[this.i++] = c; ix[this.i++] = d; ix[this.i++] = b; ix[this.i++] = d; ix[this.i++] = a; }
    else { ix[this.i++] = a; ix[this.i++] = b; ix[this.i++] = c; ix[this.i++] = a; ix[this.i++] = c; ix[this.i++] = d; }
  }
  export() {
    // Copy into exactly-sized arrays so they can be transferred to the main thread.
    const big = this.v > 65535;
    const idx = big ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i));
    return { pos: this.pos.slice(0, this.v * 3), uv: this.uv.slice(0, this.v * 2), data: this.data.slice(0, this.v * 4), tint: this.tint.slice(0, this.v), idx };
  }
}
const opaqueBuf = new Buffers();
const transBuf = new Buffers();

/**
 * Build meshes for the centre chunk.
 * @param {Uint8Array[]} chunks 9 block arrays, row-major over (dz, dx) in -1..1;
 *                              index 4 is the chunk being meshed.
 * @param {Uint8Array} columnBiomes biome id for each of the 16x16 columns
 */
export function meshChunk(chunks, columnBiomes) {
  biomes = columnBiomes;
  // ---- Assemble the padded volume -------------------------------------
  let maxY = 0;
  for (let n = 0; n < 9; n++) {
    const src = chunks[n];
    const ox = (n % 3) * CS, oz = Math.floor(n / 3) * CS;
    for (let y = 0; y < CH; y++) {
      let rowHasBlocks = false;
      for (let z = 0; z < CS; z++) {
        const s = z * CS + y * LAYER;
        const d = ox + (oz + z) * PW + y * PLAYER;
        for (let x = 0; x < CS; x++) {
          const id = src[s + x];
          vol[d + x] = id;
          if (id) rowHasBlocks = true;
        }
      }
      if (rowHasBlocks && y > maxY) maxY = y;
    }
  }
  computeLight(vol, maxY);

  opaqueBuf.reset();
  transBuf.reset();
  const yLimit = Math.min(CH, maxY + 2);

  // ---- Greedy pass for cube faces, one per direction ----------------------
  // axis: 0 = x, 1 = y, 2 = z. For each axis the two in-plane axes are u, v.
  for (let axis = 0; axis < 3; axis++) {
    for (const dir of [1, -1]) greedyAxis(axis, dir, yLimit);
  }

  // ---- Special shapes (plants, torches) -------------------------------------
  for (let y = 0; y < yLimit; y++) {
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const p = (x + CS) + (z + CS) * PW + y * PLAYER;
        const id = vol[p];
        const shape = SHAPE[id];
        if (shape === 1) crossQuads(x, y, z, id, p);
        else if (shape === 2) torchBox(x, y, z, id, p);
        else if (shape === 3) flatQuad(x, y, z, id, p);
      }
    }
  }

  return { opaque: opaqueBuf.export(), trans: transBuf.export() };
}

// Pre-allocated mask (largest slice is 16 x 128).
const mask = new Int32Array(CS * CH);
const maskPass = new Uint8Array(CS * CH);

// Neighbour offsets inside the padded volume for each axis.
const AXIS_STEP = [1, PLAYER, PW];

function greedyAxis(axis, dir, yLimit) {
  // Dimensions of the slab: d = slicing axis, u/v = the face plane.
  const uAxis = axis === 0 ? 2 : 0;         // x-faces: u=z ; y,z-faces: u=x
  const vAxis = axis === 1 ? 2 : 1;         // y-faces: v=z ; x,z-faces: v=y
  const size = [CS, yLimit, CS];
  const dSize = size[axis], uSize = size[uAxis], vSize = size[vAxis];
  const dStep = AXIS_STEP[axis] * dir;
  const uStep = AXIS_STEP[uAxis], vStep = AXIS_STEP[vAxis];
  const face = axis * 2 + (dir > 0 ? 0 : 1); // matches FACE order: +X,-X,+Y,-Y,+Z,-Z
  const c = [0, 0, 0];

  for (let d = 0; d < dSize; d++) {
    // ---- 1. Build the mask of visible faces for this slice ----
    let any = false;
    for (let v = 0; v < vSize; v++) {
      for (let u = 0; u < uSize; u++) {
        c[axis] = d; c[uAxis] = u; c[vAxis] = v;
        const p = (c[0] + CS) + (c[2] + CS) * PW + c[1] * PLAYER;
        const id = vol[p];
        const m = u + v * uSize;
        mask[m] = 0;
        if (id === 0 || SHAPE[id] !== 0) continue;
        // neighbour in the face direction (y out of range = air above / bedrock below)
        const ny = c[1] + (axis === 1 ? dir : 0);
        if (ny < 0) continue;
        const np = p + dStep;
        const nid = ny >= CH ? 0 : vol[np];
        if (IS_OPAQUE[nid] || nid === id) continue;
        // Water goes in the blended (translucent) mesh; everything else is opaque.
        const trans = IS_TRANSLUCENT[id];
        const s = ny >= CH ? 15 : sky[np];
        const b = ny >= CH ? 0 : blk[np];
        // Ambient occlusion: look at the 8 blocks around the neighbour cell, in the face plane.
        let ao = 0;
        if (!trans && ny < CH) {
          ao = aoValues(np, uStep, vStep, c[uAxis], c[vAxis], uAxis, vAxis);
        } else ao = 0xff; // all corners unoccluded (3,3,3,3)
        // Pack everything that must match for two faces to merge into one integer.
        mask[m] = 1 + (faceLayers[id * 6 + face] | (s << 8) | (b << 12) | (ao << 16) | (IS_LIQUID[id] << 24) | (tintOf(id, c[0], c[2]) << 25));
        maskPass[m] = trans;
        any = true;
      }
    }
    if (!any) continue;

    // ---- 2. Greedily merge equal mask cells into rectangles ----
    for (let v = 0; v < vSize; v++) {
      for (let u = 0; u < uSize;) {
        const m = u + v * uSize;
        const key = mask[m];
        if (!key) { u++; continue; }
        // grow width
        let w = 1;
        while (u + w < uSize && mask[m + w] === key) w++;
        // grow height while the whole row matches
        let h = 1;
        outer: for (; v + h < vSize; h++) {
          for (let k = 0; k < w; k++) if (mask[m + k + h * uSize] !== key) break outer;
        }
        // clear merged cells
        for (let hh = 0; hh < h; hh++) for (let k = 0; k < w; k++) mask[m + k + hh * uSize] = 0;
        emitQuad(axis, uAxis, vAxis, dir, d, u, v, w, h, key - 1, maskPass[m], face);
        u += w;
      }
    }
  }
}

/**
 * Ambient occlusion for the 4 corners of a face. Returns 4 x 2-bit values
 * packed in a byte, corner order (u0,v0) (u1,v0) (u1,v1) (u0,v1).
 * Each corner is 3 (bright) .. 0 (dark) depending on how many of the two
 * edge neighbours and one diagonal neighbour are solid.
 */
function aoValues(np, uStep, vStep, u, v, uAxis, vAxis) {
  const occ = (off) => IS_OPAQUE[vol[np + off]];
  // Within the padded volume, u/v +-1 is always valid except y at 0/top.
  // y is only ever v for side faces; guard by treating out-of-range as open.
  const yIsV = vAxis === 1;
  const vy = yIsV ? v : -1;
  const canDown = !yIsV || vy > 0, canUp = !yIsV || vy < CH - 1;
  const uN = occ(-uStep), uP = occ(uStep);
  const vN = canDown ? occ(-vStep) : 0, vP = canUp ? occ(vStep) : 0;
  const nn = canDown ? occ(-uStep - vStep) : 0, pn = canDown ? occ(uStep - vStep) : 0;
  const pp = canUp ? occ(uStep + vStep) : 0, np_ = canUp ? occ(-uStep + vStep) : 0;
  const corner = (s1, s2, c) => (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
  const a0 = corner(uN, vN, nn), a1 = corner(uP, vN, pn), a2 = corner(uP, vP, pp), a3 = corner(uN, vP, np_);
  return a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
}

function emitQuad(axis, uAxis, vAxis, dir, d, u, v, w, h, key, trans, face) {
  const buf = trans ? transBuf : opaqueBuf;
  buf.ensure(4, 6);
  const layer = key & 0xff, s = (key >> 8) & 15, b = (key >> 12) & 15, ao = (key >> 16) & 0xff;
  const liquid = (key >> 24) & 1, tint = (key >> 25) & 63;
  // plane position along the slicing axis
  let plane = d + (dir > 0 ? 1 : 0);
  if (liquid && axis === 1 && dir > 0) plane -= 0.12; // water surface sits a little lower
  const corners = [[u, v], [u + w, v], [u + w, v + h], [u, v + h]];
  const idx = [];
  for (let k = 0; k < 4; k++) {
    const p = [0, 0, 0];
    p[axis] = plane; p[uAxis] = corners[k][0]; p[vAxis] = corners[k][1];
    const a = (ao >> (k * 2)) & 3;
    idx.push(buf.vertex(p[0], p[1], p[2], corners[k][0], corners[k][1], layer, s, b, a | (face << 2), tint));
  }
  // Winding: the triangle must be counter-clockwise when seen from outside.
  // u x v points along -axis for x and y faces and +axis for z faces.
  const uxv = axis === 2 ? 1 : -1;
  const a0 = ao & 3, a1 = (ao >> 2) & 3, a2 = (ao >> 4) & 3, a3 = (ao >> 6) & 3;
  // Flip the diagonal so AO interpolates smoothly (avoids a visible crease).
  const flip = a0 + a2 < a1 + a3;
  if (dir * uxv > 0) buf.quad(idx[0], idx[1], idx[2], idx[3], flip);
  else buf.quad(idx[0], idx[3], idx[2], idx[1], flip);
}

// Plants: two crossed, double-sided quads.
function crossQuads(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(16, 24);
  const layer = faceLayers[id * 6];
  const s = sky[p], b = blk[p];
  const shade = 3 | (6 << 2);
  const tint = tintOf(id, x, z);
  const planes = [[[0.15, 0.15], [0.85, 0.85]], [[0.85, 0.15], [0.15, 0.85]]];
  for (const [[x0, z0], [x1, z1]] of planes) {
    const v0 = buf.vertex(x + x0, y, z + z0, 0, 0, layer, s, b, shade, tint);
    const v1 = buf.vertex(x + x1, y, z + z1, 1, 0, layer, s, b, shade, tint);
    const v2 = buf.vertex(x + x1, y + 1, z + z1, 1, 1, layer, s, b, shade, tint);
    const v3 = buf.vertex(x + x0, y + 1, z + z0, 0, 1, layer, s, b, shade, tint);
    buf.quad(v0, v1, v2, v3, false);
    buf.quad(v0, v3, v2, v1, false); // back side
  }
}

// Torch: a thin stick 2/16 wide and 10/16 tall in the middle of the cell.
function torchBox(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(24, 36);
  const layer = faceLayers[id * 6];
  const s = sky[p], b = Math.max(blk[p], 14);
  const x0 = x + 7 / 16, x1 = x + 9 / 16, z0 = z + 7 / 16, z1 = z + 9 / 16, y0 = y, y1 = y + 10 / 16;
  const u0 = 7 / 16, u1 = 9 / 16, v0 = 0, v1 = 10 / 16;
  const sh = (f) => 3 | (f << 2);
  const add = (pts, uvs, f) => {
    const ids = pts.map((pt, k) => buf.vertex(pt[0], pt[1], pt[2], uvs[k][0], uvs[k][1], layer, s, b, sh(f)));
    buf.quad(ids[0], ids[1], ids[2], ids[3], false);
  };
  const side = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  add([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], side, 4);   // +Z
  add([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], side, 5);   // -Z
  add([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], side, 0);   // +X
  add([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], side, 1);   // -X
  add([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[u0, 8 / 16], [u1, 8 / 16], [u1, 10 / 16], [u0, 10 / 16]], 2); // top
}


// Lily pads: one horizontal, double-sided quad resting on the water.
function flatQuad(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(8, 12);
  const layer = faceLayers[id * 6 + 2];
  const s = sky[p], b = blk[p], shade = 3 | (2 << 2), h = y + 0.03;
  const v0 = buf.vertex(x, h, z, 0, 0, layer, s, b, shade);
  const v1 = buf.vertex(x + 1, h, z, 1, 0, layer, s, b, shade);
  const v2 = buf.vertex(x + 1, h, z + 1, 1, 1, layer, s, b, shade);
  const v3 = buf.vertex(x, h, z + 1, 0, 1, layer, s, b, shade);
  buf.quad(v0, v3, v2, v1, false); // facing up
  buf.quad(v0, v1, v2, v3, false); // facing down
}
