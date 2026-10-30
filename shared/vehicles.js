// ============================================================================
// Vehicles you can ride: minecarts (on rails, see rails.js) and boats.
//
// The player riding a vehicle drives it on their own computer (so it feels
// instant) and tells the server where it is; everyone else sees it move
// smoothly from the server's snapshots. Empty vehicles just sit where they are.
// ============================================================================
import { IS_LIQUID, B } from './blocks.js';
import { moveEntity, liquidLevel } from './physics.js';
import { PHYSICS } from './config.js';

// Index order is used in network snapshots; only ever append.
export const VEHICLE_KINDS = ['minecart', 'chest_minecart', 'furnace_minecart', 'hopper_minecart', 'tnt_minecart',
  'oak_boat', 'spruce_boat', 'birch_boat', 'jungle_boat', 'acacia_boat', 'dark_oak_boat'];
export const isBoat = (kind) => kind.endsWith('_boat');
export const isCart = (kind) => kind.endsWith('minecart');
export const VEHICLE_SIZE = { cart: [0.98, 0.7], boat: [1.375, 0.6] };

/**
 * Drive a boat for one frame. boat = {pos, vel, yaw}; input = {forward, back, left, right}.
 * Boats float on water, turn with A/D, paddle with W/S, and crawl slowly on land.
 */
export function boatStep(boat, dt, getBlock, input) {
  const x = Math.floor(boat.pos.x), z = Math.floor(boat.pos.z);
  // Is there water at (or just under) the hull?
  const wy = Math.floor(boat.pos.y + 0.3);
  const inWater = IS_LIQUID[getBlock(x, wy, z)] && getBlock(x, wy, z) !== B.LAVA;
  const onWaterTop = !inWater && IS_LIQUID[getBlock(x, wy - 1, z)];
  const floating = inWater || onWaterTop;
  boat.yaw += ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * 2.2 * dt;
  const thrust = (input.forward ? 1 : 0) - (input.back ? 0.5 : 0);
  const maxSpeed = floating ? 8 : 1.2;
  const fx = -Math.sin(boat.yaw), fz = -Math.cos(boat.yaw);
  boat.vel.x += fx * thrust * (floating ? 9 : 4) * dt;
  boat.vel.z += fz * thrust * (floating ? 9 : 4) * dt;
  const sp = Math.hypot(boat.vel.x, boat.vel.z);
  if (sp > maxSpeed) { boat.vel.x *= maxSpeed / sp; boat.vel.z *= maxSpeed / sp; }
  const drag = Math.exp(-dt * (floating ? 0.9 : 6));
  boat.vel.x *= drag; boat.vel.z *= drag;
  if (floating) {
    // bob up to sit on the surface (water blocks are drawn a little below their top)
    const surface = (inWater ? wy : wy - 1) + 0.88 - 0.25;
    boat.vel.y += (surface - boat.pos.y) * 12 * dt - boat.vel.y * 4 * dt;
  } else boat.vel.y -= 24 * dt;
  const res = moveEntity(boat.pos, boat.vel, dt, 1.2, 0.6, (bx, by, bz) => (IS_LIQUID[getBlock(bx, by, bz)] ? 0 : getBlock(bx, by, bz)));
  if (res.hitWall) { boat.vel.x *= 0.3; boat.vel.z *= 0.3; }
  return floating;
}

// How fast each kind of horse runs (blocks per second) when you ride it.
export const RIDE_SPEED = { horse: 9, donkey: 6.5, mule: 7, llama: 4 };

/**
 * Ride a horse for one frame. mount = {pos, vel, yaw, onGround};
 * input = {forward, right, jump, yaw}: it goes the way you look, W/S forward and back,
 * A/D sideways, Space to jump. It steps up single blocks on its own and swims.
 */
export function mountStep(mount, dt, getBlock, input, speed) {
  const width = 0.98, height = 1.6;
  const fx = -Math.sin(input.yaw), fz = -Math.cos(input.yaw);   // forward
  const rx = Math.cos(input.yaw), rz = -Math.sin(input.yaw);    // right
  const wet = liquidLevel(mount.pos, height, getBlock) > 0;
  const sp = speed * (wet ? 0.45 : 1) * (input.forward < 0 ? 0.4 : 1);
  const tx = (fx * input.forward + rx * input.right * 0.5) * sp, tz = (fz * input.forward + rz * input.right * 0.5) * sp;
  const k = 1 - Math.exp(-dt * (mount.onGround || wet ? 5 : 1.2));
  mount.vel.x += (tx - mount.vel.x) * k;
  mount.vel.z += (tz - mount.vel.z) * k;
  if (wet) mount.vel.y += (2.5 - mount.vel.y) * Math.min(1, dt * 3);   // swims at the surface
  else mount.vel.y -= PHYSICS.gravity * dt;
  if (input.jump && mount.onGround) mount.vel.y = 11;
  const res = moveEntity(mount.pos, mount.vel, dt, width, height, getBlock, mount.onGround);
  mount.onGround = res.onGround;
  // walk up one-block steps without having to jump
  if (res.hitWall && res.onGround && (input.forward || input.right)) mount.vel.y = 7.5;
  mount.yaw = input.yaw + Math.PI;
  return res;
}
