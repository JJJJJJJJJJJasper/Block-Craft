// ============================================================================
// Mobs: pigs (peaceful, wander, flee when hit) and zombies (night only, chase
// survival players). The AI is deliberately simple ("steering" toward a
// target and jumping when blocked) so it costs almost nothing per tick.
// ============================================================================
import { moveEntity, liquidLevel } from '../shared/physics.js';
import { MOBS, PHYSICS } from '../shared/config.js';
import { B, IS_SOLID, IS_LIQUID } from '../shared/blocks.js';
import { itemId, ITEMS } from '../shared/items.js';
import { REACH, SERVER_REACH_SLACK, CHUNK_HEIGHT } from '../shared/config.js';
import { PROFESSIONS, TRADES } from '../shared/trades.js';

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// `index` must match MOB_KINDS order in client/rendering/entities.js.
export const MOB_TYPES = {
  pig: { index: 0, width: 0.9, height: 0.9, health: 10, speed: 1.6, passive: true, drops: () => [['raw_porkchop', rnd(1, 3)]] },
  zombie: { index: 1, width: 0.6, height: 1.95, health: 20, speed: 2.6, damage: 3, drops: () => (Math.random() < 0.7 ? [['rotten_flesh', rnd(1, 2)]] : []) },
  cow: { index: 2, width: 0.9, height: 1.4, health: 10, speed: 1.4, passive: true, drops: () => [['leather', rnd(0, 2)], ['raw_beef', rnd(1, 3)]] },
  sheep: { index: 3, width: 0.9, height: 1.3, health: 8, speed: 1.4, passive: true, drops: () => [['white_wool', 1], ['raw_mutton', rnd(1, 2)]] },
  chicken: { index: 4, width: 0.4, height: 0.7, health: 4, speed: 1.3, passive: true, drops: () => [['feather', rnd(0, 2)], ['raw_chicken', 1]] },
  villager: { index: 5, width: 0.6, height: 1.95, health: 20, speed: 1.1, drops: () => [] },
  // Night monsters. Skeletons keep their distance and shoot arrows; spiders are
  // fast and climb walls; Rumblers (BlockCraft's own exploding stone beast)
  // creep up to you, hiss, and blow up.
  skeleton: { index: 6, width: 0.6, height: 1.95, health: 20, speed: 2.4, damage: 2, burns: true, hostile: true, cause: 'was shot by a skeleton',
    drops: () => [['bone', rnd(0, 2)], ['arrow', rnd(0, 2)]] },
  spider: { index: 7, width: 1.3, height: 0.9, health: 16, speed: 3.4, damage: 2, climbs: true, hostile: true, cause: 'was slain by a spider',
    drops: () => [['string', rnd(0, 2)], ['spider_eye', Math.random() < 0.33 ? 1 : 0]] },
  rumbler: { index: 8, width: 0.7, height: 1.4, health: 20, speed: 2.2, hostile: true, cause: 'was blown up by a Rumbler',
    drops: () => [['gunpowder', rnd(0, 2)]] },
};
for (const d of Object.values(MOB_TYPES)) if (d.damage && !d.cause) d.cause = 'was slain by a zombie';
MOB_TYPES.zombie.hostile = MOB_TYPES.zombie.burns = true;
// Which monster appears at night.
const MONSTERS = [['zombie', 4], ['skeleton', 3], ['spider', 3], ['rumbler', 2]];
// Relative chance of each farm animal when one spawns.
const ANIMALS = [['pig', 3], ['cow', 3], ['sheep', 4], ['chicken', 3]];

let nextMobId = 1;

export class MobManager {
  constructor(room) {
    this.room = room;
    this.mobs = new Map();
    this.spawnTimer = 0;
  }

  count(type) {
    let n = 0;
    for (const m of this.mobs.values()) if (m.type === type) n++;
    return n;
  }

  countHostile() {
    let n = 0;
    for (const m of this.mobs.values()) if (m.def.hostile) n++;
    return n;
  }

  countPassive() {
    let n = 0;
    for (const m of this.mobs.values()) if (m.def.passive) n++;
    return n;
  }

  spawn(type, x, y, z, home = null) {
    const def = MOB_TYPES[type];
    const m = {
      id: nextMobId++, type, def,
      pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 },
      yaw: Math.random() * Math.PI * 2, health: def.health,
      wander: 0, walking: false, fleeTimer: 0, fleeFrom: null,
      attackCooldown: 0, hurtTimer: 0, onGround: false, burnTimer: 0, home,
    };
    this.mobs.set(m.id, m);
    return m;
  }

  tick(dt) {
    const room = this.room;
    const players = [...room.players.values()].filter(p => p.alive);
    if (!players.length) return;

    // ---- Spawning (one attempt per second) ----
    this.spawnTimer += dt;
    if (this.spawnTimer > 1) {
      this.spawnTimer = 0;
      this._trySpawn(players);
      for (const p of players) this._spawnVillagers(p);
    }

    const night = room.isNight();
    for (const m of this.mobs.values()) {
      // Despawn when no player is near.
      let nearest = null, nd = Infinity;
      for (const p of players) {
        const d = Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y, p.pos.z - m.pos.z);
        if (d < nd) { nd = d; nearest = p; }
      }
      if (nd > MOBS.despawnRadius) { this.mobs.delete(m.id); continue; }
      if (m.def.hostile) this._hostile(m, dt, players, night);
      else this._wanderer(m, dt);
      if (m.sheared > 0) m.sheared -= dt;  // a sheep's wool grows back
      // Chickens lay an egg every few minutes.
      if (m.type === 'chicken' && (m.eggTimer = (m.eggTimer ?? 300 + Math.random() * 300) - dt) <= 0) {
        m.eggTimer = 300 + Math.random() * 300;
        room.spawnItem({ id: itemId('egg'), count: 1 }, m.pos.x, m.pos.y + 0.3, m.pos.z);
      }
      this._physics(m, dt);
      if (m.hurtTimer > 0) m.hurtTimer -= dt;
      if (m.pos.y < -20) this.mobs.delete(m.id);
    }
  }

  _trySpawn(players) {
    const room = this.room;
    const p = players[Math.floor(Math.random() * players.length)];
    const ang = Math.random() * Math.PI * 2;
    const dist = MOBS.spawnRadiusMin + Math.random() * (MOBS.spawnRadiusMax - MOBS.spawnRadiusMin);
    const x = Math.floor(p.pos.x + Math.cos(ang) * dist), z = Math.floor(p.pos.z + Math.sin(ang) * dist);
    const y = room.world.surfaceY(x, z);
    if (y < 0) return;
    const ground = room.world.getBlock(x, y, z);
    if (IS_LIQUID[ground] || !IS_SOLID[ground]) return;
    if (room.world.getBlock(x, y + 1, z) !== 0 && room.world.getBlock(x, y + 1, z) !== B.TALL_GRASS) return;
    const night = room.isNight();
    if (night && room.mode === 'survival' && this.countHostile() < MOBS.maxZombies) {
      let roll = Math.random() * MONSTERS.reduce((a, [, w]) => a + w, 0), kind = 'zombie';
      for (const [k, w] of MONSTERS) { if ((roll -= w) < 0) { kind = k; break; } }
      this.spawn(kind, x + 0.5, y + 1, z + 0.5);
    } else if (!night && ground === B.GRASS && this.countPassive() < MOBS.maxAnimals) {
      // farm animals spawn in small herds of one kind
      let roll = Math.random() * ANIMALS.reduce((a, [, w]) => a + w, 0), kind = 'pig';
      for (const [k, w] of ANIMALS) { if ((roll -= w) < 0) { kind = k; break; } }
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.spawn(kind, x + 0.5 + i * 0.6, y + 1, z + 0.5);
    }
  }

  /** Keep a few villagers in any village near this player. */
  _spawnVillagers(p) {
    const v = this.room.world.gen.villageNear(p.pos.x, p.pos.z, 96);
    if (!v) return;
    let n = 0;
    for (const m of this.mobs.values()) if (m.type === 'villager' && m.home && m.home.id === v.id) n++;
    if (n >= 5) return;
    const x = Math.floor(v.x + (Math.random() - 0.5) * 14), z = Math.floor(v.z + (Math.random() - 0.5) * 14);
    const y = this.room.world.surfaceY(x, z);
    if (y < 0 || !IS_SOLID[this.room.world.getBlock(x, y, z)] || IS_LIQUID[this.room.world.getBlock(x, y, z)]) return;
    const m = this.spawn('villager', x + 0.5, y + 1, z + 0.5, v);
    m.profession = Math.floor(Math.random() * PROFESSIONS.length);
  }

  /** Passive mobs: wander about, flee when hit; villagers stay near home. */
  _wanderer(m, dt) {
    const def = m.def;
    let speed = def.speed;
    if (m.fleeTimer > 0) {
      m.fleeTimer -= dt;
      if (m.fleeFrom) m.yaw = Math.atan2(m.pos.x - m.fleeFrom.x, m.pos.z - m.fleeFrom.z);
      m.walking = true;
      speed *= 2;
    } else {
      m.wander -= dt;
      if (m.wander <= 0) {
        m.walking = Math.random() < 0.6;
        m.yaw = Math.random() * Math.PI * 2;
        // Villagers head back toward the village centre if they stray.
        if (m.home && Math.hypot(m.home.x - m.pos.x, m.home.z - m.pos.z) > 20) {
          m.yaw = Math.atan2(m.home.x - m.pos.x, m.home.z - m.pos.z); m.walking = true;
        }
        m.wander = 2 + Math.random() * 4;
      }
    }
    this._steer(m, m.walking ? speed : 0, dt);
  }

  _hostile(m, dt, players, night) {
    // Zombies and skeletons burn in daylight when nothing is overhead.
    if (!night && m.def.burns) {
      m.burnTimer += dt;
      if (m.burnTimer > 1) {
        m.burnTimer = 0;
        if (this._skyAbove(m)) this.damage(m, 2, null);
      }
    }
    // Chase the nearest survival player within 24 blocks.
    let target = null, td = 24;
    for (const p of players) {
      if (this.room.mode !== 'survival') break;
      const d = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
      if (d < td && Math.abs(p.pos.y - m.pos.y) < 10) { td = d; target = p; }
    }
    if (m.attackCooldown > 0) m.attackCooldown -= dt;
    // A Rumbler that lost its target calms down and its fuse goes out.
    if (m.type === 'rumbler' && (!target || td > 6)) m.fuse = 0;
    if (target) {
      m.yaw = Math.atan2(target.pos.x - m.pos.x, target.pos.z - m.pos.z);
      if (m.type === 'skeleton') {
        // keep 6-12 blocks away and shoot
        const want = td > 12 ? m.def.speed : td < 6 ? -m.def.speed * 0.8 : 0;
        this._steer(m, want, dt);
        if (td < 16 && m.attackCooldown <= 0 && this._canSee(m, target)) {
          m.attackCooldown = 2 + Math.random();
          const eyeY = m.pos.y + 1.6;
          const dx = target.pos.x - m.pos.x, dz = target.pos.z - m.pos.z, dy = target.pos.y + 1.2 - eyeY;
          // aim a little high so the arrow's drop lands on target, with some wobble
          const flat = Math.hypot(dx, dz);
          const dir = [dx + (Math.random() - 0.5) * 1.2, dy + flat * 0.12, dz + (Math.random() - 0.5) * 1.2];
          this.room.projectiles.spawn(m, { x: m.pos.x, y: eyeY, z: m.pos.z }, dir, 'arrow', 0.6);
        }
      } else if (m.type === 'rumbler') {
        this._steer(m, td > 1.6 ? m.def.speed : 0, dt);
        if (td < 2.8) {
          if (!m.fuse) this.room.broadcast({ t: 'fuse', x: m.pos.x, y: m.pos.y, z: m.pos.z, time: 1.5 });
          m.fuse = (m.fuse || 0) + dt;
          if (m.fuse > 1.5) {
            this.mobs.delete(m.id);
            this.room.act.explode(m.pos.x, m.pos.y + 0.7, m.pos.z, 3);
            return;
          }
        } else if (m.fuse) m.fuse = Math.max(0, m.fuse - dt);
      } else {
        this._steer(m, td > 1.0 ? m.def.speed : 0, dt);
        if (m.def.climbs && m.hitWall) m.vel.y = 4; // spiders walk straight up walls
        if (td < (m.def.width > 1 ? 1.8 : 1.4) && Math.abs(target.pos.y - m.pos.y) < 1.6 && m.attackCooldown <= 0) {
          m.attackCooldown = 1;
          this.room.hurtPlayer(target, m.def.damage, m.pos, m.def.cause);
        }
      }
    } else {
      m.wander -= dt;
      if (m.wander <= 0) { m.walking = Math.random() < 0.5; m.yaw = Math.random() * Math.PI * 2; m.wander = 3 + Math.random() * 3; }
      this._steer(m, m.walking ? m.def.speed * 0.5 : 0, dt);
    }
  }

  /** Is there a clear line from the mob's eyes to the player? */
  _canSee(m, p) {
    const steps = Math.ceil(Math.hypot(p.pos.x - m.pos.x, p.pos.y - m.pos.y, p.pos.z - m.pos.z) * 2);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = m.pos.x + (p.pos.x - m.pos.x) * t, y = m.pos.y + 1.6 + (p.pos.y + 1.5 - m.pos.y - 1.6) * t, z = m.pos.z + (p.pos.z - m.pos.z) * t;
      if (IS_SOLID[this.room.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]) return false;
    }
    return true;
  }

  _skyAbove(m) {
    const x = Math.floor(m.pos.x), z = Math.floor(m.pos.z);
    for (let y = Math.floor(m.pos.y + 2); y < CHUNK_HEIGHT; y++) {
      const id = this.room.world.getBlock(x, y, z);
      if (id !== 0 && id !== B.TORCH) return false;
    }
    return true;
  }

  // Set horizontal velocity toward the facing direction.
  _steer(m, speed, dt) {
    if (m.knockTimer > 0) { m.knockTimer -= dt; return; }
    const k = 1 - Math.exp(-dt * 8);
    m.vel.x += (Math.sin(m.yaw) * speed - m.vel.x) * k;
    m.vel.z += (Math.cos(m.yaw) * speed - m.vel.z) * k;
  }

  _physics(m, dt) {
    const world = this.room.world;
    const get = (x, y, z) => world.getBlock(x, y, z);
    const water = liquidLevel(m.pos, m.def.height, get);
    if (water > 0) {
      m.vel.y += (2 - m.vel.y) * Math.min(1, dt * 3); // float upward
    } else {
      m.vel.y -= PHYSICS.gravity * dt;
      if (m.type === 'chicken' && m.vel.y < -3) m.vel.y = -3; // chickens flap and fall slowly
    }
    const res = moveEntity(m.pos, m.vel, dt, m.def.width, m.def.height, get, m.onGround);
    m.onGround = res.onGround;
    m.hitWall = res.hitWall;
    // Hop up one-block steps when walking into a wall.
    if (res.hitWall && (m.onGround || water > 0)) m.vel.y = 7.5;
  }

  /** Apply damage; returns true if the mob died. */
  damage(m, amount, attacker) {
    m.health -= amount;
    m.hurtTimer = 0.4;
    if (attacker) {
      // knockback away from the attacker
      const dx = m.pos.x - attacker.x, dz = m.pos.z - attacker.z;
      const len = Math.hypot(dx, dz) || 1;
      m.vel.x = (dx / len) * 9; m.vel.z = (dz / len) * 9; m.vel.y = 6;
      m.knockTimer = 0.45; // fly back instead of walking straight back in
      if (m.def.passive || m.type === 'villager') { m.fleeTimer = 4; m.fleeFrom = { ...attacker }; }
    }
    if (m.health <= 0) {
      this.mobs.delete(m.id);
      if (this.room.mode === 'survival') {
        for (const [name, count] of m.def.drops()) {
          if (count <= 0) continue;
          this.room.spawnItem({ id: itemId(name), count }, m.pos.x, m.pos.y + 0.5, m.pos.z);
        }
      }
      return true;
    }
    return false;
  }

  /** Compact array for network snapshots. */
  /** Right-click on a mob: shear a sheep (milking a cow happens on the client, it only swaps the bucket). */
  use(p, msg) {
    const m = this.mobs.get(msg.mob);
    if (!m || !p.alive) return;
    if (Math.hypot(m.pos.x - p.pos.x, m.pos.y - p.pos.y, m.pos.z - p.pos.z) > REACH + SERVER_REACH_SLACK + 1) return;
    const held = ITEMS[msg.held];
    // Villagers show what they'll trade (the client does the swap; inventories live there).
    if (m.type === 'villager') {
      const job = PROFESSIONS[m.profession ?? 0];
      m.fleeTimer = 0; m.walking = false; m.wander = 6; // stand still while you shop
      m.yaw = Math.atan2(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
      this.room.send(p, { t: 'trades', mob: m.id, job, offers: TRADES[job] });
      return;
    }
    if (m.type === 'sheep' && held && held.name === 'shears' && !(m.sheared > 0)) {
      m.sheared = 240;
      this.room.spawnItem({ id: itemId('white_wool'), count: rnd(1, 3) }, m.pos.x, m.pos.y + 0.8, m.pos.z);
    }
  }

  snapshot() {
    const out = [];
    for (const m of this.mobs.values()) {
      // flags: 1 = just hurt, 2 = Rumbler fuse lit
      out.push([m.id, m.def.index, r2(m.pos.x), r2(m.pos.y), r2(m.pos.z), r2(m.yaw), (m.hurtTimer > 0 ? 1 : 0) | (m.fuse > 0 ? 2 : 0) | ((m.profession ?? 0) << 2)]);
    }
    return out;
  }
}

function r2(v) { return Math.round(v * 100) / 100; }
