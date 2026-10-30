// ============================================================================
// Drawing minecarts and boats. Simple blocky models built from boxes (our own
// designs), moved smoothly between network snapshots. The vehicle you are
// riding is placed directly from your own simulation instead.
// ============================================================================
import * as THREE from 'three';
import { VEHICLE_KINDS, isBoat } from '../../shared/vehicles.js';
import { rayBox } from '../../shared/raycast.js';

const WOOD = { oak: 0xa8864f, spruce: 0x735532, birch: 0xc4b37b, jungle: 0xa5764d, acacia: 0xad5d32, dark_oak: 0x4a3218 };
const CARGO = { chest_minecart: 0xa0743a, furnace_minecart: 0x6a6a6a, hopper_minecart: 0x3e3e42, tnt_minecart: 0xd8402e };

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cartModel(kind) {
  const g = new THREE.Group();
  const iron = new THREE.MeshLambertMaterial({ color: 0x8c8c90 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3a3e });
  // an open iron tub on four wheels
  g.add(box(0.9, 0.08, 0.7, dark, 0, 0.18, 0));
  g.add(box(0.9, 0.5, 0.06, iron, 0, 0.45, 0.32), box(0.9, 0.5, 0.06, iron, 0, 0.45, -0.32));
  g.add(box(0.06, 0.5, 0.7, iron, 0.45, 0.45, 0), box(0.06, 0.5, 0.7, iron, -0.45, 0.45, 0));
  for (const [x, z] of [[0.3, 0.36], [-0.3, 0.36], [0.3, -0.36], [-0.3, -0.36]]) g.add(box(0.16, 0.16, 0.04, dark, x, 0.1, z));
  if (CARGO[kind]) g.add(box(0.7, 0.55, 0.55, new THREE.MeshLambertMaterial({ color: CARGO[kind] }), 0, 0.5, 0));
  return g;
}

function boatModel(kind) {
  const g = new THREE.Group();
  const wood = new THREE.MeshLambertMaterial({ color: WOOD[kind.replace('_boat', '')] || WOOD.oak });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a3420 });
  // a flat hull with sides and a pointed-ish bow, plus two oars
  g.add(box(1.0, 0.1, 1.4, wood, 0, 0.05, 0));
  g.add(box(0.08, 0.35, 1.4, wood, 0.5, 0.25, 0), box(0.08, 0.35, 1.4, wood, -0.5, 0.25, 0));
  g.add(box(1.0, 0.35, 0.08, wood, 0, 0.25, 0.7), box(0.7, 0.35, 0.08, wood, 0, 0.25, -0.74));
  g.add(box(0.9, 0.06, 0.25, dark, 0, 0.3, 0.1));
  for (const s of [1, -1]) { const oar = box(0.06, 0.06, 1.1, dark, 0.6 * s, 0.35, 0); oar.rotation.y = 0.5 * s; g.add(oar); }
  return g;
}

export class VehicleView {
  constructor(scene) {
    this.scene = scene;
    this.list = new Map(); // id -> {group, kind, from, to, t}
    this.localId = null;   // the one I'm riding
  }

  apply(snapshot) {
    const seen = new Set();
    const now = performance.now();
    for (const [id, k, x, y, z, yaw, rider] of snapshot || []) {
      seen.add(id);
      let v = this.list.get(id);
      if (!v) {
        const kind = VEHICLE_KINDS[k] || 'minecart';
        const group = isBoat(kind) ? boatModel(kind) : cartModel(kind);
        group.position.set(x, y, z);
        this.scene.add(group);
        v = { group, kind, prev: { x, y, z, yaw }, next: { x, y, z, yaw }, t: now };
        this.list.set(id, v);
      }
      v.prev = { ...v.group.position, yaw: v.group.rotation.y };
      v.next = { x, y, z, yaw };
      v.t = now;
      v.rider = rider;
    }
    for (const [id, v] of this.list) if (!seen.has(id)) { this.scene.remove(v.group); this.list.delete(id); }
  }

  /** Put the vehicle I'm riding exactly where my simulation says. */
  setLocal(id, pos, yaw) {
    this.localId = id;
    const v = this.list.get(id);
    if (v) { v.group.position.set(pos.x, pos.y, pos.z); v.group.rotation.y = yaw; }
  }

  update() {
    const now = performance.now();
    for (const [id, v] of this.list) {
      if (id === this.localId) continue;
      const t = Math.min(1, (now - v.t) / 60);
      v.group.position.set(v.prev.x + (v.next.x - v.prev.x) * t, v.prev.y + (v.next.y - v.prev.y) * t, v.prev.z + (v.next.z - v.prev.z) * t);
      v.group.rotation.y = v.next.yaw;
    }
  }

  /** Closest vehicle hit by a ray: {id, dist, kind} or null. */
  raycast(origin, dir, maxDist) {
    let best = null;
    for (const [id, v] of this.list) {
      if (id === this.localId) continue;
      const p = v.group.position, w = isBoat(v.kind) ? 0.7 : 0.5;
      const d = rayBox(origin, dir, [p.x - w, p.y, p.z - w], [p.x + w, p.y + 0.8, p.z + w]);
      if (d >= 0 && d <= maxDist && (!best || d < best.dist)) best = { id, dist: d, kind: v.kind, vehicle: true };
    }
    return best;
  }

  get(id) { return this.list.get(id); }
}
