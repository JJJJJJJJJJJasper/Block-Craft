// ============================================================================
// Minecarts and boats on the server. The server keeps where every vehicle is
// and who is riding it; the rider's client drives it and reports its position.
// Vehicles are saved with the world.
// ============================================================================
import { VEHICLE_KINDS, isBoat, isCart } from '../shared/vehicles.js';
import { itemId } from '../shared/items.js';
import { isRail } from '../shared/rails.js';
import { IS_LIQUID } from '../shared/blocks.js';
import { REACH, SERVER_REACH_SLACK, PHYSICS } from '../shared/config.js';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
let nextId = 1;

export class Vehicles {
  constructor(room, saved) {
    this.room = room;
    this.list = new Map();
    for (const v of saved.vehicles ?? []) this._add(v.kind, v.pos, v.yaw);
  }

  _add(kind, pos, yaw = 0) {
    const v = { id: nextId++, kind, pos: { ...pos }, yaw, rider: null, hits: 0 };
    this.list.set(v.id, v);
    return v;
  }

  _near(p, pos, extra = 1) {
    return Math.hypot(pos.x - p.pos.x, pos.y - (p.pos.y + PHYSICS.eyeHeight), pos.z - p.pos.z) <= REACH + SERVER_REACH_SLACK + extra;
  }

  /** A player put down a minecart (on a rail) or a boat (on water or ground). */
  place(p, msg) {
    if (!p.alive || !VEHICLE_KINDS.includes(msg.kind) || ![msg.x, msg.y, msg.z].every(num)) return;
    const pos = { x: msg.x, y: msg.y, z: msg.z };
    if (!this._near(p, pos, 1.5) || this.list.size > 400) return;
    const get = (x, y, z) => this.room.world.getBlock(x, y, z);
    const bx = Math.floor(pos.x), by = Math.floor(pos.y + 0.05), bz = Math.floor(pos.z);
    if (isCart(msg.kind) && !isRail(get(bx, by, bz))) return;
    if (isBoat(msg.kind) && !(IS_LIQUID[get(bx, by, bz)] || IS_LIQUID[get(bx, by - 1, bz)] || get(bx, by, bz) === 0)) return;
    this._add(msg.kind, pos, num(msg.yaw) ? msg.yaw : 0);
    this.room.dirty = true;
  }

  mount(p, msg) {
    const v = this.list.get(msg.id);
    if (!v || v.rider || !p.alive || !this._near(p, v.pos, 1.5)) return;
    if (p.riding) this.leave(p);
    v.rider = p.id;
    p.riding = { type: 'vehicle', id: v.id };
    this.room.send(p, { t: 'mounted', type: 'vehicle', id: v.id, kind: v.kind, pos: [v.pos.x, v.pos.y, v.pos.z], yaw: v.yaw });
  }

  leave(p) {
    if (!p.riding || p.riding.type !== 'vehicle') return;
    const v = this.list.get(p.riding.id);
    if (v && v.rider === p.id) v.rider = null;
    p.riding = null;
    p.moveCredit = 6;
    this.room.dirty = true;
  }

  /** The rider reports where their vehicle is now. */
  move(p, msg) {
    const v = p.riding && p.riding.type === 'vehicle' ? this.list.get(p.riding.id) : null;
    if (!v || v.rider !== p.id || !Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(num)) return;
    const [x, y, z] = msg.p;
    if (Math.hypot(x - v.pos.x, y - v.pos.y, z - v.pos.z) > 6) return; // too far in one update: ignore
    v.pos = { x, y, z };
    if (num(msg.yaw)) v.yaw = msg.yaw;
  }

  /** Left-click: two hits break an empty vehicle and give the item back. */
  hit(p, msg) {
    const v = this.list.get(msg.id);
    if (!v || v.rider || !p.alive || !this._near(p, v.pos, 1.5)) return;
    if (++v.hits < 2 && this.room.mode === 'survival') return;
    this.list.delete(v.id);
    if (this.room.mode === 'survival') this.room.spawnItem({ id: itemId(v.kind), count: 1, dmg: 0 }, v.pos.x, v.pos.y + 0.5, v.pos.z);
    this.room.dirty = true;
  }

  /** A player left or died: free their vehicle. */
  drop(p) { this.leave(p); }

  snapshot() {
    const out = [];
    for (const v of this.list.values()) out.push([v.id, VEHICLE_KINDS.indexOf(v.kind), r2(v.pos.x), r2(v.pos.y), r2(v.pos.z), r2(v.yaw), v.rider || 0]);
    return out;
  }

  serialize() {
    return [...this.list.values()].map(v => ({ kind: v.kind, pos: { x: r2(v.pos.x), y: r2(v.pos.y), z: r2(v.pos.z) }, yaw: r2(v.yaw) }));
  }
}
