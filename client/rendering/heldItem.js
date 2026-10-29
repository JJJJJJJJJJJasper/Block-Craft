// ============================================================================
// 3D models of items for holding in a hand: your own first-person view and
// other players' avatars. Blocks become small 3D models made of the same
// boxes the world uses (a cube, a stair, a fence...); everything else (tools,
// food, plants, torches, doors) becomes a flat cut-out of its icon.
// Geometry and materials are cached per item, so many players holding dirt share one.
// ============================================================================
import * as THREE from 'three';
import { BLOCKS } from '../../shared/blocks.js';
import { ITEMS } from '../../shared/items.js';
import { BOX_FACES } from '../../shared/shapes.js';
import { iconBoxes } from './textures.js';

const PLANE = new THREE.PlaneGeometry(1, 1);

function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** One geometry for a list of boxes, centred on the origin, 1 unit = 1 block. Face f uses material group f. */
function boxesGeometry(boxes) {
  const pos = [], uv = [], index = [];
  const g = new THREE.BufferGeometry();
  let start = 0;
  for (let f = 0; f < 6; f++) {
    for (const box of boxes) {
      const base = pos.length / 3;
      for (const [x, y, z, u, v] of BOX_FACES[f](box)) { pos.push(x - 0.5, y - 0.5, z - 0.5); uv.push(u, v); }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    g.addGroup(start, index.length - start, f);
    start = index.length;
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export class ItemModels {
  constructor(textures) {
    this.textures = textures;
    this.materials = new Map();  // item id -> material or material[]
    this.geometries = new Map(); // item id -> geometry for block models
  }

  /** The boxes of a block item drawn as a 3D model, or null for flat sprites. */
  _boxes(id) {
    const b = ITEMS[id] && ITEMS[id].isBlock ? BLOCKS[id] : null;
    return b && !b.itemTex ? iconBoxes(b) : null;
  }

  /** Is this item drawn as a 3D block (true) or a flat sprite (false)? */
  isCube(id) { return !!this._boxes(id); }

  _material(id) {
    let m = this.materials.get(id);
    if (m) return m;
    // Light sources (torches, glowstone...) glow: they ignore scene lighting.
    const glows = ITEMS[id] && ITEMS[id].isBlock && BLOCKS[id].light > 0;
    const Mat = glows ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
    if (this.isCube(id)) {
      // Face order (+X, -X, +Y, -Y, +Z, -Z) matches our block faces.
      m = [0, 1, 2, 3, 4, 5].map(f => new Mat({ map: canvasTexture(this.textures.faceCanvas(id, f)), alphaTest: 0.5, side: THREE.DoubleSide }));
    } else {
      m = new Mat({ map: canvasTexture(this.textures.iconCanvas(id)), alphaTest: 0.5, side: THREE.DoubleSide });
    }
    this.materials.set(id, m);
    return m;
  }

  /** A new mesh for item `id` (1 unit across; scale it to taste). */
  create(id) {
    const boxes = this._boxes(id);
    if (!boxes) return new THREE.Mesh(PLANE, this._material(id));
    if (!this.geometries.has(id)) this.geometries.set(id, boxesGeometry(boxes));
    return new THREE.Mesh(this.geometries.get(id), this._material(id));
  }
}
