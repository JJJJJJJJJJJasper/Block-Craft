// ============================================================================
// Things players do TO blocks, beyond breaking and placing them:
//   - open/close doors, trapdoors and fence gates
//   - chests (and dispensers, droppers, hoppers) that store items
//   - loot chests in dungeons that fill themselves the first time they open
//   - beds: set your respawn point and sleep through the night
//   - farming: hoes make farmland, crops and saplings grow, bone meal helps
//   - buckets, cake, TNT
// The Room owns one Interactions object and forwards messages to it.
// ============================================================================
import { BLOCKS, B, FAMILIES, withState, stateId, IS_SOLID } from '../shared/blocks.js';
import { ITEMS, ITEM_BY_NAME, itemId, maxStack } from '../shared/items.js';
import { FACING_VEC } from '../shared/shapes.js';
import { canReplace } from '../shared/placement.js';
import { DAY_TICKS } from '../shared/config.js';

export const CONTAINER_SIZE = { chest: 27, dispenser: 9, dropper: 9, hopper: 5 };
const int = (v) => Number.isInteger(v);
const key3 = (x, y, z) => `${x},${y},${z}`;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

// Which tree each sapling grows into.
const SAPLING_TREE = { oak: 'oak', spruce: 'spruce', birch: 'birch', jungle: 'jungle', acacia: 'acacia', dark_oak: 'dark_oak' };

// Dungeon chest loot: [item, min, max, weight]
const LOOT = [
  ['bone', 1, 8, 10], ['rotten_flesh', 1, 8, 10], ['gunpowder', 1, 8, 10], ['string', 1, 8, 10],
  ['bread', 1, 1, 15], ['wheat', 1, 4, 10], ['coal', 1, 4, 10], ['redstone', 1, 4, 10], ['beetroot_seeds', 2, 4, 10],
  ['melon_seeds', 2, 4, 10], ['pumpkin_seeds', 2, 4, 10], ['iron_ingot', 1, 4, 10], ['gold_ingot', 1, 4, 5], ['bucket', 1, 1, 10],
  ['saddle', 1, 1, 20], ['name_tag', 1, 1, 20], ['golden_apple', 1, 1, 15], ['enchanted_book', 1, 1, 10], ['iron_horse_armor', 1, 1, 15],
  ['golden_horse_armor', 1, 1, 10], ['diamond_horse_armor', 1, 1, 5], ['music_disc_ember', 1, 1, 8], ['music_disc_tide', 1, 1, 8],
  ['diamond', 1, 2, 3], ['emerald', 1, 2, 4], ['chainmail_chestplate', 1, 1, 3], ['enchanted_golden_apple', 1, 1, 1],
];
const LOOT_TOTAL = LOOT.reduce((a, l) => a + l[3], 0);

export class Interactions {
  constructor(room, saved) {
    this.room = room;
    this.containers = new Map(Object.entries(saved.containers ?? {})); // "x,y,z" -> slots
    this.plants = new Set(saved.plants ?? []);                         // growing crops, saplings, cane
    this.tnt = [];
    this.fires = [];                                                   // burning fire blocks: {x, y, z, t}                                                     // lit TNT: {x, y, z, t}
    this.growTimer = 0;
  }

  get world() { return this.room.world; }

  serialize() {
    const containers = {};
    for (const [k, slots] of this.containers) if (slots.some(Boolean)) containers[k] = slots;
    return { containers, plants: [...this.plants] };
  }

  /** Called whenever a block is placed, so new crops start growing etc. */
  placed(x, y, z, id) {
    const b = BLOCKS[id];
    if (b.crop || b.sapling || id === B.SUGAR_CANE) this.plants.add(key3(x, y, z));
    // Concrete powder sets as soon as it touches water.
    if (b.powderOf && this._touchesWater(x, y, z)) this.room.setBlock(x, y, z, B[b.powderOf.toUpperCase()]);
  }

  _touchesWater(x, y, z) {
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => this.world.getBlock(x + dx, y + dy, z + dz) === B.WATER);
  }

  /** The other half of a door or bed, or null. */
  partnerOf(id, x, y, z) {
    const b = BLOCKS[id];
    if (!b || !b.state) return null;
    if (b.door) {
      const py = b.state.half === 'lower' ? y + 1 : y - 1;
      const pid = this.world.getBlock(x, py, z);
      return BLOCKS[pid]?.base === b.base ? [x, py, z, pid] : null;
    }
    if (b.bed) {
      const [dx, dz] = FACING_VEC[b.state.facing];
      const s = b.state.part === 'foot' ? 1 : -1;
      const px = x + dx * s, pz = z + dz * s;
      const pid = this.world.getBlock(px, y, pz);
      return BLOCKS[pid]?.base === b.base ? [px, y, pz, pid] : null;
    }
    return null;
  }

  /** A block was broken: clean up anything attached to it. */
  broken(x, y, z, id, survival) {
    const k = key3(x, y, z);
    this.plants.delete(k);
    const slots = this.containers.get(k);
    if (slots) {
      if (survival) for (const s of slots) if (s) this.room.spawnItem(s, x + 0.5, y + 0.5, z + 0.5);
      this.containers.delete(k);
      for (const p of this.room.players.values()) if (p.container === k) { p.container = null; this.room.send(p, { t: 'containerClosed' }); }
    }
    const partner = this.partnerOf(id, x, y, z);
    if (partner) this.room.setBlock(partner[0], partner[1], partner[2], 0);
  }

  // ---- Right-click on a block -------------------------------------------------------
  /**
   * @param {object} p player
   * @param {{action:string, x:number, y:number, z:number, held:number}} msg
   */
  use(p, msg) {
    const { x, y, z } = msg;
    const room = this.room;
    const id = this.world.getBlock(x, y, z);
    const b = BLOCKS[id];
    const held = int(msg.held) && ITEMS[msg.held] ? ITEMS[msg.held] : null;
    if (!b) return;
    switch (msg.action) {
      case 'toggle': {
        if (!b.door && b.shape !== 'trapdoor' && !b.gate) return;
        const open = !b.state.open;
        const partner = this.partnerOf(id, x, y, z);
        room.setBlock(x, y, z, withState(id, { open }));
        if (partner) room.setBlock(partner[0], partner[1], partner[2], withState(partner[3], { open }));
        return;
      }
      case 'open': return this.openContainer(p, x, y, z, id);
      case 'sleep': return this.sleep(p, x, y, z, b);
      case 'till': {
        if (!held || held.tool !== 'hoe' || this.world.getBlock(x, y + 1, z) !== 0) return;
        if (id === B.GRASS || id === B.DIRT || id === B.GRASS_PATH) room.setBlock(x, y, z, B.FARMLAND);
        else if (id === B.COARSE_DIRT) room.setBlock(x, y, z, B.DIRT);
        return;
      }
      case 'path': {
        if (held && held.tool === 'shovel' && id === B.GRASS && this.world.getBlock(x, y + 1, z) === 0) room.setBlock(x, y, z, B.GRASS_PATH);
        return;
      }
      case 'bonemeal': return held && held.name === 'bone_meal' ? this.boneMeal(x, y, z, id) : undefined;
      case 'ignite': {
        if (!held || held.name !== 'flint_and_steel') return;
        if (id === FAMILIES.tnt.baseId) return this.light(x, y, z, 4);
        // Start a fire in an empty spot, if there's something next to it to burn on.
        if (id !== 0 && !(b.replaceable && !b.liquid)) return;
        const nearSolid = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
          .some(([dx, dy, dz]) => IS_SOLID[this.world.getBlock(x + dx, y + dy, z + dz)]);
        if (!nearSolid) return room._reject(p, x, y, z);
        room.setBlock(x, y, z, FAMILIES.fire.baseId);
        this.fires.push({ x, y, z, t: 4 + Math.random() * 4 });
        // Fire touching TNT sets it off.
        for (const [dx, dy, dz] of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
          if (this.world.getBlock(x + dx, y + dy, z + dz) === FAMILIES.tnt.baseId) this.light(x + dx, y + dy, z + dz, 4);
        }
        return;
      }
      case 'fill': {
        // Water is endless (the ocean doesn't drain); lava is scooped up.
        if (held && held.name === 'bucket' && id === B.LAVA) room.setBlock(x, y, z, 0);
        return;
      }
      case 'empty': {
        if (!held || !held.empties || !canReplace(id) || IS_SOLID[id]) return;
        room.setBlock(x, y, z, held.empties === 'water' ? B.WATER : B.LAVA);
        if (held.empties === 'water') {
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const n = this.world.getBlock(x + dx, y + dy, z + dz);
            if (BLOCKS[n]?.powderOf) room.setBlock(x + dx, y + dy, z + dz, B[BLOCKS[n].powderOf.toUpperCase()]);
          }
        }
        return;
      }
      case 'cake': {
        if (b.base !== 'cake') return;
        const bites = b.state.bites + 1;
        room.setBlock(x, y, z, bites > 6 ? 0 : withState(id, { bites }));
        return;
      }
      default: return;
    }
  }

  // ---- Containers ---------------------------------------------------------------------
  openContainer(p, x, y, z, id) {
    const b = BLOCKS[id];
    if (!b.container) return;
    const k = key3(x, y, z);
    const size = CONTAINER_SIZE[b.container] || 27;
    let slots = this.containers.get(k);
    if (b.loot) {
      // A dungeon chest: roll its loot once, then it becomes an ordinary chest.
      slots = this.rollLoot(size);
      this.containers.set(k, slots);
      this.room.setBlock(x, y, z, stateId('chest', { facing: 'south' }));
    }
    if (!slots) { slots = new Array(size).fill(null); this.containers.set(k, slots); }
    p.container = k;
    this.room.send(p, { t: 'container', x, y, z, kind: b.container, slots });
  }

  rollLoot(size) {
    const slots = new Array(size).fill(null);
    const n = rnd(4, 8);
    for (let i = 0; i < n; i++) {
      let pick = Math.random() * LOOT_TOTAL, entry = LOOT[0];
      for (const l of LOOT) { if ((pick -= l[3]) < 0) { entry = l; break; } }
      const [name, min, max] = entry;
      if (!ITEM_BY_NAME[name]) continue;
      const id = itemId(name);
      slots[Math.floor(Math.random() * size)] = { id, count: Math.min(maxStack(id), rnd(min, max)), dmg: 0 };
    }
    return slots;
  }

  /** The client changed the contents of the container it has open. */
  setContainer(p, msg) {
    const k = key3(msg.x, msg.y, msg.z);
    if (p.container !== k || !Array.isArray(msg.slots)) return;
    const slots = this.containers.get(k);
    if (!slots || msg.slots.length !== slots.length) return;
    for (let i = 0; i < slots.length; i++) slots[i] = this.room._stack(msg.slots[i]);
    this.room.dirty = true;
    // Show the change to anyone else looking into the same chest.
    for (const o of this.room.players.values()) {
      if (o !== p && o.container === k) this.room.send(o, { t: 'container', x: msg.x, y: msg.y, z: msg.z, kind: 'update', slots });
    }
  }

  // ---- Beds ------------------------------------------------------------------------------
  sleep(p, x, y, z, b) {
    if (!b.bed) return;
    p.spawnPoint = { x: x + 0.5, y: y + 0.6, z: z + 0.5 };
    const room = this.room;
    if (!room.isNight()) return room.send(p, { t: 'chat', sys: true, text: 'Respawn point set. You can only sleep at night.' });
    p.sleptAt = Date.now();
    const players = [...room.players.values()].filter(o => o.alive);
    const asleep = players.filter(o => o.sleptAt && Date.now() - o.sleptAt < 8000).length;
    if (asleep >= players.length) {
      room.time = Math.round(DAY_TICKS * 0.98) % DAY_TICKS; // just before sunrise
      room.broadcast({ t: 'time', time: room.time });
      room.sys('Everyone slept. Good morning!');
      for (const o of players) o.sleptAt = 0;
    } else {
      room.sys(`${p.name} is sleeping (${asleep}/${players.length}). Everyone needs a bed to skip the night.`);
    }
  }

  // ---- Farming -----------------------------------------------------------------------------
  boneMeal(x, y, z, id) {
    const b = BLOCKS[id];
    const room = this.room;
    if (b.crop) {
      room.setBlock(x, y, z, withState(id, { age: Math.min(b.maxAge, b.state.age + rnd(2, 5)) }));
    } else if (b.sapling) {
      if (Math.random() < 0.45) this.growSapling(x, y, z, b);
    } else if (id === B.GRASS) {
      // a little meadow springs up around the block
      const flowers = [B.TALL_GRASS, B.TALL_GRASS, B.TALL_GRASS, B.RED_FLOWER, B.YELLOW_FLOWER];
      for (let i = 0; i < 14; i++) {
        const gx = x + rnd(-3, 3), gz = z + rnd(-3, 3);
        for (let gy = y + 2; gy >= y - 2; gy--) {
          if (this.world.getBlock(gx, gy, gz) === B.GRASS && this.world.getBlock(gx, gy + 1, gz) === 0) {
            room.setBlock(gx, gy + 1, gz, flowers[rnd(0, flowers.length - 1)]);
            break;
          }
        }
      }
    }
  }

  growSapling(x, y, z, b) {
    let kind = SAPLING_TREE[b.sapling] || 'oak';
    if (kind === 'oak' && Math.random() < 0.1) kind = 'big_oak';
    this.plants.delete(key3(x, y, z));
    this.room.setBlock(x, y, z, 0);
    this.world.gen.growTree(kind, x, y, z, (tx, ty, tz, id, soft) => {
      if (ty < 1 || ty >= 255) return;
      const cur = this.world.getBlock(tx, ty, tz);
      if (tx === x && tz === z && ty === y - 1) return;             // keep the dirt under the trunk as it is
      if (cur !== 0 && !(BLOCKS[cur].replaceable || BLOCKS[cur].cutout)) return; // never break player builds
      if (soft && cur !== 0) return;
      this.room.setBlock(tx, ty, tz, id);
    });
  }

  /** Once a second: crops, saplings and sugar cane near players may grow. */
  tick(dt) {
    this.growTimer += dt;
    if (this.growTimer >= 1) {
      this.growTimer = 0;
      const players = [...this.room.players.values()];
      for (const k of [...this.plants]) {
        const [x, y, z] = k.split(',').map(Number);
        if (!players.some(p => Math.abs(p.pos.x - x) < 128 && Math.abs(p.pos.z - z) < 128)) continue;
        const id = this.world.getBlock(x, y, z);
        const b = BLOCKS[id];
        if (b.crop) {
          if (b.state.age >= b.maxAge) { this.plants.delete(k); continue; }
          if (Math.random() < 1 / 18) this.room.setBlock(x, y, z, withState(id, { age: b.state.age + 1 }));
        } else if (b.sapling) {
          if (Math.random() < 1 / 100 && this.world.getBlock(x, y + 1, z) === 0) this.growSapling(x, y, z, b);
        } else if (id === B.SUGAR_CANE) {
          let h = 1;
          while (h < 3 && this.world.getBlock(x, y + h, z) === B.SUGAR_CANE) h++;
          if (h < 3 && this.world.getBlock(x, y + h, z) === 0 && Math.random() < 1 / 30) this.room.setBlock(x, y + h, z, B.SUGAR_CANE);
          if (h >= 3) this.plants.delete(k);
        } else this.plants.delete(k);
      }
    }
    // Fires burn out after a few seconds.
    if (this.fires.length) {
      this.fires = this.fires.filter(f => {
        if ((f.t -= dt) > 0) return true;
        if (this.world.getBlock(f.x, f.y, f.z) === FAMILIES.fire.baseId) this.room.setBlock(f.x, f.y, f.z, 0);
        return false;
      });
    }
    // Lit TNT counts down, then explodes.
    if (this.tnt.length) {
      const due = [];
      this.tnt = this.tnt.filter(t => ((t.t -= dt) > 0 ? true : (due.push(t), false)));
      for (const t of due) {
        // Breaking lit TNT before it goes off defuses it.
        if (this.world.getBlock(t.x, t.y, t.z) !== FAMILIES.tnt.baseId) continue;
        this.room.setBlock(t.x, t.y, t.z, 0);
        this.explode(t.x + 0.5, t.y + 0.5, t.z + 0.5, 3.5);
      }
    }
  }

  // ---- TNT -------------------------------------------------------------------------------
  light(x, y, z, fuse) {
    if (this.tnt.some(t => t.x === x && t.y === y && t.z === z)) return;
    this.tnt.push({ x, y, z, t: fuse });
    this.room.broadcast({ t: 'fuse', x, y, z, time: fuse });
  }

  explode(cx, cy, cz, power) {
    const room = this.room, survival = room.mode === 'survival';
    const r = Math.ceil(power);
    const changes = [];
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
      const d = Math.hypot(dx, dy, dz);
      if (d > power * (0.75 + Math.random() * 0.4) || y < 1) continue;
      const id = this.world.getBlock(x, y, z);
      const b = BLOCKS[id];
      if (!id || !b || b.liquid || b.hardness < 0 || b.hardness >= 50) continue; // bedrock, obsidian, water survive
      if (id === FAMILIES.tnt.baseId) { this.light(x, y, z, 0.4 + Math.random() * 0.8); continue; }
      changes.push([x, y, z, id]);
    }
    for (const [x, y, z, id] of changes) {
      if (this.world.getBlock(x, y, z) !== id) continue;
      this.broken(x, y, z, id, survival);
      room.setBlock(x, y, z, 0);
      if (survival && Math.random() < 0.3) room._dropsFor(BLOCKS[id], x + 0.5, y + 0.3, z + 0.5);
    }
    room.broadcast({ t: 'boom', x: cx, y: cy, z: cz });
    // Hurt everything nearby, more the closer it is.
    const hurtR = power * 2;
    for (const p of room.players.values()) {
      const d = Math.hypot(p.pos.x - cx, p.pos.y + 0.9 - cy, p.pos.z - cz);
      if (d < hurtR) room.hurtPlayer(p, Math.round((1 - d / hurtR) * 16), { x: cx, y: cy - 1, z: cz }, 'blew up');
    }
    for (const m of [...room.mobs.mobs.values()]) {
      const d = Math.hypot(m.pos.x - cx, m.pos.y - cy, m.pos.z - cz);
      if (d < hurtR) room.mobs.damage(m, Math.round((1 - d / hurtR) * 16), { x: cx, y: cy, z: cz });
    }
  }
}

