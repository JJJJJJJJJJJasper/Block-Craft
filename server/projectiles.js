// ============================================================================
// Things that fly: arrows from bows, and thrown snowballs, eggs and ender
// pearls. The server simulates them (gravity, then a ray test along each
// step's path so fast arrows can't skip through a thin wall or a mob) and
// sends their positions to everyone in the regular snapshot.
// ============================================================================
import { PHYSICS } from '../shared/config.js';
import { BLOCKS } from '../shared/blocks.js';
import { itemId } from '../shared/items.js';
import { raycastBlocks, rayBox } from '../shared/raycast.js';

// index = order in client/rendering/entities.js PROJECTILE_KINDS
export const PROJECTILES = {
  arrow: { index: 0, gravity: 20, speed: 42 },
  snowball: { index: 1, gravity: 24, speed: 24 },
  egg: { index: 2, gravity: 24, speed: 24 },
  pearl: { index: 3, gravity: 24, speed: 24 },
};
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const solid = (id) => { const b = BLOCKS[id]; return !!b && b.solid; };
let nextId = 1;

export class Projectiles {
  constructor(room) {
    this.room = room;
    this.list = new Map();
  }

  /** A player shot an arrow or threw something. msg = {kind, dir:[x,y,z], power 0..1} */
  launch(p, msg) {
    const def = PROJECTILES[msg.kind];
    if (!def || !p.alive || !Array.isArray(msg.dir) || msg.dir.length !== 3 || !msg.dir.every(num)) return;
    const now = Date.now();
    if (now < (p.throwCooldown || 0)) return;
    p.throwCooldown = now + 220;
    const power = msg.kind === 'arrow' ? Math.max(0.1, Math.min(1, num(msg.power) ? msg.power : 1)) : 1;
    this.spawn(p, { x: p.pos.x, y: p.pos.y + PHYSICS.eyeHeight - 0.1, z: p.pos.z }, msg.dir, msg.kind, power);
  }

  /** Launch from any owner (a player, or a skeleton shooting at you). */
  spawn(owner, from, dir, kind, power = 1) {
    const def = PROJECTILES[kind];
    const len = Math.hypot(...dir) || 1;
    const d = dir.map(c => c / len);
    const v = def.speed * power;
    const pos = { x: from.x + d[0] * 0.4, y: from.y, z: from.z + d[2] * 0.4 };
    this.list.set(nextId, { id: nextId, kind, def, owner, power, pos, vel: { x: d[0] * v, y: d[1] * v, z: d[2] * v }, age: 0 });
    nextId++;
  }

  tick(dt) {
    const room = this.room;
    for (const pr of [...this.list.values()]) {
      pr.age += dt;
      if (pr.age > 12) { this.list.delete(pr.id); continue; }
      pr.vel.y -= pr.def.gravity * dt;
      const step = [pr.vel.x * dt, pr.vel.y * dt, pr.vel.z * dt];
      const dist = Math.hypot(...step);
      if (dist < 1e-6) continue;
      const dir = step.map(c => c / dist);
      const origin = [pr.pos.x, pr.pos.y, pr.pos.z];
      // What does this step's path hit first: a block, a mob or a player?
      let best = null;
      const block = raycastBlocks((x, y, z) => room.world.getBlock(x, y, z), origin, dir, dist, solid);
      if (block) best = { t: block.dist, block };
      for (const m of room.mobs.mobs.values()) {
        if (m === pr.owner && pr.age < 0.5) continue;
        const w = m.def.width / 2;
        const t = rayBox(origin, dir, [m.pos.x - w, m.pos.y, m.pos.z - w], [m.pos.x + w, m.pos.y + m.def.height, m.pos.z + w]);
        if (t >= 0 && t <= dist && (!best || t < best.t)) best = { t, mob: m };
      }
      for (const o of room.players.values()) {
        if (!o.alive || (o === pr.owner && pr.age < 0.3)) continue;
        const w = PHYSICS.playerWidth / 2;
        const t = rayBox(origin, dir, [o.pos.x - w, o.pos.y, o.pos.z - w], [o.pos.x + w, o.pos.y + PHYSICS.playerHeight, o.pos.z + w]);
        if (t >= 0 && t <= dist && (!best || t < best.t)) best = { t, player: o };
      }
      if (!best) { pr.pos.x += step[0]; pr.pos.y += step[1]; pr.pos.z += step[2]; continue; }
      const at = { x: origin[0] + dir[0] * best.t, y: origin[1] + dir[1] * best.t, z: origin[2] + dir[2] * best.t };
      this.list.delete(pr.id);
      this._hit(pr, best, at);
    }
  }

  _hit(pr, hit, at) {
    const room = this.room;
    const from = { x: at.x - pr.vel.x * 0.05, y: at.y - 1, z: at.z - pr.vel.z * 0.05 };
    if (pr.kind === 'arrow') {
      const dmg = Math.max(1, Math.round(pr.power * pr.power * 9));
      if (hit.mob) room.mobs.damage(hit.mob, dmg, from);
      else if (hit.player) room.hurtPlayer(hit.player, dmg, from, `was shot by ${pr.owner.name || 'a skeleton'}`);
      // A survival player's arrow can be picked up again where it landed.
      else if (room.mode === 'survival') room.spawnItem({ id: itemId('arrow'), count: 1 }, at.x, at.y + 0.2, at.z, { x: 0, y: 0, z: 0 });
    } else if (pr.kind === 'snowball') {
      if (hit.mob) room.mobs.damage(hit.mob, 0, from);
      else if (hit.player) room.hurtPlayer(hit.player, 0.5, from, `was snowballed by ${pr.owner.name}`);
    } else if (pr.kind === 'egg') {
      if (Math.random() < 1 / 8) {
        const y = hit.block ? at.y + 0.1 : at.y;
        room.mobs.spawn('chicken', at.x, y, at.z);
      }
    } else if (pr.kind === 'pearl') {
      const o = pr.owner;
      if (o.ws && o.alive && room.players.has(o.id)) {
        o.pos = { x: at.x, y: at.y + (hit.block && hit.block.ny === 1 ? 0.05 : 0), z: at.z };
        room._unstick(o.pos);
        o.moveCredit = 4;
        room.send(o, { t: 'teleport', p: [o.pos.x, o.pos.y, o.pos.z] });
        room.hurtPlayer(o, 5, { x: o.pos.x, y: o.pos.y - 1, z: o.pos.z }, 'fell after an ender pearl');
      }
    }
    room.broadcast({ t: 'poof', kind: pr.kind, x: r2(at.x), y: r2(at.y), z: r2(at.z) });
  }

  snapshot() {
    const out = [];
    for (const pr of this.list.values()) out.push([pr.id, pr.def.index, r2(pr.pos.x), r2(pr.pos.y), r2(pr.pos.z), r2(pr.vel.x), r2(pr.vel.y), r2(pr.vel.z)]);
    return out;
  }
}
