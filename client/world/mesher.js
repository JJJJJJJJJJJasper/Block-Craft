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
import { IS_OPAQUE, IS_LIQUID, IS_TRANSLUCENT, SHAPE, TINT, WALL_DIR, BOXES, BLOCKS, MAX_ID } from '../../shared/blocks.js';
import { dynamicBoxes, NEIGHBOURS, BOX_FACES } from '../../shared/shapes.js';
import { connects } from '../../shared/physics.js';
import { CHUNK_SIZE as CS, CHUNK_HEIGHT as CH } from '../../shared/config.js';
import { computeLight, sky, blk, PW, PLAYER, PVOL } from './lighting.js';

const LAYER = CS * CS;
const vol = new Uint16Array(PVOL);  // padded block volume, reused
let faceLayers = null;              // block id * 6 + face -> texture layer
let biomes = null;                  // biome id per column of the chunk being meshed

const FLAT_ROT = new Uint8Array(MAX_ID); // rails running east-west use a rotated texture
export function initMesher(layers) {
  faceLayers = layers;
  for (const b of BLOCKS) if (b && b.flatRot) FLAT_ROT[b.id] = 1;
}

/**
 * Index into the shader's tint palette for a block at local column (x, z):
 * 0 = untinted, 1 + 2*biome = that biome's grass colour, 2 + 2*biome = foliage.
 */
function tintOf(id, x, z) {
  const t = TINT[id];
  return t ? (biomes ? biomes[x + z * CS] : 8) * 2 + t : 0;
}

// Growable output buffers for one pass. All per-vertex arrays share ONE
// capacity so they always grow together. (They used to start at different
// sizes and only grew based on `pos`, so big chunks wrote some vertices'
// texture/light data past the end: those vertices rendered black.)
class Buffers {
  constructor() {
    this.cap = 0;
    this._grow(8192);
    this.idx = new Uint32Array(12288);
    this.reset();
  }
  reset() { this.v = 0; this.i = 0; }
  _grow(cap) {
    const grow = (a, n) => { const b = new (a ? a.constructor : Float32Array)(n); if (a) b.set(a); return b; };
    this.pos = grow(this.pos, cap * 3);
    this.uv = grow(this.uv, cap * 2);
    this.data = this.data ? grow(this.data, cap * 4) : new Uint16Array(cap * 4); // 16-bit: >256 textures
    this.tint = this.tint ? grow(this.tint, cap) : new Uint8Array(cap);
    this.cap = cap;
  }
  ensure(nv, ni) {
    if (this.v + nv > this.cap) this._grow(Math.max(this.cap * 2, this.v + nv));
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
 * @param {Uint16Array[]} chunks 9 block arrays, row-major over (dz, dx) in -1..1;
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
        if (shape === 0 || shape === 255) continue;
        if (shape === 1) crossQuads(x, y, z, id, p);
        else if (shape === 2) torchBox(x, y, z, id, p, 0, 0);
        else if (shape === 4) torchBox(x, y, z, id, p, WALL_DIR[id * 2], WALL_DIR[id * 2 + 1]);
        else if (shape === 3) flatQuad(x, y, z, id, p);
        else if (shape === 5) emitBoxes(x, y, z, id, p, BOXES[id]);
        else if (shape === 6 || shape === 7 || shape === 8) {
          const conn = NEIGHBOURS.map(([dx, dz]) => connects(id, vol[p + dx + dz * PW]));
          emitBoxes(x, y, z, id, p, dynamicBoxes(shape === 6 ? 'fence' : shape === 7 ? 'wall' : 'pane', conn));
        } else if (shape === 9) wallQuad(x, y, z, id, p);
        else if (shape === 10) cropQuads(x, y, z, id, p);
      }
    }
  }

  return { opaque: opaqueBuf.export(), trans: transBuf.export() };
}

// Pre-allocated mask (largest slice is 16 x 256). Float64 so the packed key
// (texture layer, light, AO, tint) can use more than 32 bits.
const mask = new Float64Array(CS * CH);
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
        // Pack everything that must match for two faces to merge into one number.
        mask[m] = 1 + faceLayers[id * 6 + face] + 4096 * (s + 16 * (b + 16 * (ao + 256 * (IS_LIQUID[id] + 2 * tintOf(id, c[0], c[2])))));
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
  // unpack the key built in greedyAxis
  const layer = key % 4096; let k = Math.floor(key / 4096);
  const s = k % 16; k = Math.floor(k / 16);
  const b = k % 16; k = Math.floor(k / 16);
  const ao = k % 256; k = Math.floor(k / 256);
  const liquid = k % 2, tint = Math.floor(k / 2);
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

// Torch: a stick 2/16 wide and 10/16 tall. Standing torches sit in the middle
// of the cell; wall torches (nx, nz = direction away from the wall) are moved
// against the wall, raised, and tilted outward like a sconce.
const TILT = Math.sin(0.35);
function torchBox(x, y, z, id, p, nx, nz) {
  const buf = opaqueBuf;
  buf.ensure(24, 36);
  const layer = faceLayers[id * 6];
  const s = sky[p], b = Math.max(blk[p], 14);
  const wall = nx !== 0 || nz !== 0;
  // Local coordinates: (lx, ly, lz) with the stick centred at lx = lz = 0.
  const place = (lx, ly, lz) => {
    if (!wall) return [x + 0.5 + lx, y + ly, z + 0.5 + lz];
    // lean outward: the higher up, the further from the wall
    const out = -0.42 + ly * TILT;
    return [x + 0.5 + lx + nx * out, y + 0.22 + ly * 0.95, z + 0.5 + lz + nz * out];
  };
  const h = 1 / 16, top = 10 / 16;
  const u0 = 7 / 16, u1 = 9 / 16, v0 = 0, v1 = 10 / 16;
  const sh = (f) => 3 | (f << 2);
  const add = (pts, uvs, f) => {
    const ids = pts.map((pt, k) => { const w = place(pt[0], pt[1], pt[2]); return buf.vertex(w[0], w[1], w[2], uvs[k][0], uvs[k][1], layer, s, b, sh(f)); });
    buf.quad(ids[0], ids[1], ids[2], ids[3], false);
  };
  const side = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  add([[-h, 0, h], [h, 0, h], [h, top, h], [-h, top, h]], side, 4);       // +Z
  add([[h, 0, -h], [-h, 0, -h], [-h, top, -h], [h, top, -h]], side, 5);   // -Z
  add([[h, 0, h], [h, 0, -h], [h, top, -h], [h, top, h]], side, 0);       // +X
  add([[-h, 0, -h], [-h, 0, h], [-h, top, h], [-h, top, -h]], side, 1);   // -X
  // top: shows the glowing tip of the texture
  add([[-h, top, h], [h, top, h], [h, top, -h], [-h, top, -h]], [[u0, 8 / 16], [u1, 8 / 16], [u1, 10 / 16], [u0, 10 / 16]], 2);
}

// Lily pads, rails, redstone: one horizontal, double-sided quad just above the floor.
function flatQuad(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(8, 12);
  const layer = faceLayers[id * 6 + 2];
  const s = sky[p], b = blk[p], shade = 3 | (2 << 2), h = y + 0.03;
  const r = FLAT_ROT[id]; // swap u/v so the rail texture runs east-west
  const v0 = buf.vertex(x, h, z, r ? 0 : 0, r ? 1 : 0, layer, s, b, shade);
  const v1 = buf.vertex(x + 1, h, z, r ? 0 : 1, r ? 0 : 0, layer, s, b, shade);
  const v2 = buf.vertex(x + 1, h, z + 1, r ? 1 : 1, r ? 0 : 1, layer, s, b, shade);
  const v3 = buf.vertex(x, h, z + 1, r ? 1 : 0, r ? 1 : 1, layer, s, b, shade);
  buf.quad(v0, v3, v2, v1, false); // facing up
  buf.quad(v0, v1, v2, v3, false); // facing down
}

// ---- Box shapes: stairs, slabs, doors, fences... ----------------------------------
const ON_EDGE = [(b) => b[3] >= 1, (b) => b[0] <= 0, (b) => b[4] >= 1, (b) => b[1] <= 0, (b) => b[5] >= 1, (b) => b[2] <= 0];
const NEIGH = [1, -1, PLAYER, -PLAYER, PW, -PW];

function emitBoxes(x, y, z, id, p, boxes) {
  const buf = IS_TRANSLUCENT[id] ? transBuf : opaqueBuf;
  const tint = tintOf(id, x, z);
  for (const box of boxes) {
    for (let f = 0; f < 6; f++) {
      let lp = p;
      if (ON_EDGE[f](box)) {
        // A face flush with the cell edge is hidden by an opaque neighbour.
        const ny = y + (f === 2 ? 1 : f === 3 ? -1 : 0);
        if (ny >= 0 && ny < CH) {
          const np = p + NEIGH[f];
          if (IS_OPAQUE[vol[np]]) continue;
          lp = np;
        }
      }
      buf.ensure(4, 6);
      const layer = faceLayers[id * 6 + f];
      const s = Math.max(sky[lp], sky[p]), bl = Math.max(blk[lp], blk[p]);
      const ids = BOX_FACES[f](box).map(([vx, vy, vz, u, v]) => buf.vertex(x + vx, y + vy, z + vz, u, v, layer, s, bl, 3 | (f << 2), tint));
      buf.quad(ids[0], ids[1], ids[2], ids[3], false);
    }
  }
}

// Ladders and vines: a double-sided quad just in front of the wall they hang on.
function wallQuad(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(8, 12);
  const nx = WALL_DIR[id * 2], nz = WALL_DIR[id * 2 + 1];
  const layer = faceLayers[id * 6], s = sky[p], b = blk[p], tint = tintOf(id, x, z), sh = 3 | (6 << 2);
  let pts;
  if (nz !== 0) { const zz = z + (nz < 0 ? 15 / 16 : 1 / 16); pts = [[x, y, zz], [x + 1, y, zz], [x + 1, y + 1, zz], [x, y + 1, zz]]; }
  else { const xx = x + (nx < 0 ? 15 / 16 : 1 / 16); pts = [[xx, y, z], [xx, y, z + 1], [xx, y + 1, z + 1], [xx, y + 1, z]]; }
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const ids = pts.map((q, k) => buf.vertex(q[0], q[1], q[2], uv[k][0], uv[k][1], layer, s, b, sh, tint));
  buf.quad(ids[0], ids[1], ids[2], ids[3], false);
  buf.quad(ids[0], ids[3], ids[2], ids[1], false);
}

// Crops: four upright planes in a # pattern.
function cropQuads(x, y, z, id, p) {
  const buf = opaqueBuf;
  buf.ensure(32, 48);
  const layer = faceLayers[id * 6], s = sky[p], b = blk[p], sh = 3 | (6 << 2);
  const planes = [];
  for (const o of [4 / 16, 12 / 16]) {
    planes.push([[x + o, y, z], [x + o, y, z + 1], [x + o, y + 1, z + 1], [x + o, y + 1, z]]);
    planes.push([[x, y, z + o], [x + 1, y, z + o], [x + 1, y + 1, z + o], [x, y + 1, z + o]]);
  }
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const pts of planes) {
    const ids = pts.map((q, k) => buf.vertex(q[0], q[1], q[2], uv[k][0], uv[k][1], layer, s, b, sh));
    buf.quad(ids[0], ids[1], ids[2], ids[3], false);
    buf.quad(ids[0], ids[3], ids[2], ids[1], false);
  }
}
