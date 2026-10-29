// ============================================================================
// The local player: movement, physics, and survival stats.
// The client simulates its own movement immediately (no waiting for the
// server, so controls feel instant) and reports its position ~20x/second.
// The server checks those reports and can send a correction ("teleport").
// ============================================================================
import { PHYSICS as P, MAX_HEALTH, MAX_HUNGER, FALL_DAMAGE_START, HUNGER_DRAIN_SECONDS } from '../../shared/config.js';
import { moveEntity, liquidLevel, isSupported, onClimbable } from '../../shared/physics.js';
import { IS_LIQUID, B } from '../../shared/blocks.js';

export class Player {
  constructor() {
    this.pos = { x: 0.5, y: 80, z: 0.5 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;            // radians, 0 = looking toward -Z
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.eyeOffset = 0;      // camera dips when sneaking (smoothed)
    this.inWater = 0;
    this.inLava = false;
    this.lavaTimer = 0;
    this.jumpCooldown = 0;   // seconds until another jump is allowed while holding Space
    this.climbing = false;        // 0..1 fraction of the body submerged
    this.headInWater = false;
    this.fallStartY = null;  // highest point since leaving the ground
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.saturation = 5;     // hidden buffer eaten before hunger drops
    this.hungerTimer = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.dead = false;
    this.moving = false;
    this.stepDistance = 0;
    this.hurtTime = 0;       // for red screen flash
  }

  get eye() { return { x: this.pos.x, y: this.pos.y + P.eyeHeight + this.eyeOffset, z: this.pos.z }; }

  /** Unit vector the camera looks along. */
  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /**
   * Advance the simulation.
   * @param {number} dt seconds since last frame
   * @param {object} ctl {forward, right, jump, down, sprint, sneak} from input
   * @param {(x,y,z)=>number} getBlock
   * @param {object} events callbacks: onFallDamage, onStep, onSplash
   */
  update(dt, ctl, getBlock, mode, events) {
    if (this.dead) return;
    const creative = mode === 'creative';
    if (!creative) this.flying = false;

    // Wanted horizontal direction relative to where we face.
    let fx = ctl.right, fz = -ctl.forward;
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = fx * cos + fz * sin;
    const wishZ = -fx * sin + fz * cos;
    this.moving = len > 0;
    this.sneaking = !!ctl.sneak && !this.flying;
    if (!this.moving || ctl.forward <= 0 || this.sneaking) this.sprinting = false;
    else if (ctl.sprint && (creative || this.hunger > 6)) this.sprinting = true;
    // Camera smoothly dips while sneaking.
    this.eyeOffset += ((this.sneaking ? -0.22 : 0) - this.eyeOffset) * Math.min(1, dt * 12);

    this.inWater = liquidLevel(this.pos, P.playerHeight, getBlock);
    const fx0 = Math.floor(this.pos.x), fz0 = Math.floor(this.pos.z);
    this.inLava = getBlock(fx0, Math.floor(this.pos.y + 0.1), fz0) === B.LAVA || getBlock(fx0, Math.floor(this.pos.y + 1), fz0) === B.LAVA;
    this.headInWater = IS_LIQUID[getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + P.eyeHeight), Math.floor(this.pos.z))] === 1;

    if (this.flying) {
      const speed = this.sprinting ? P.flySprintSpeed : P.flySpeed;
      // Smoothly approach the target velocity (exponential smoothing).
      const k = 1 - Math.exp(-dt * 10);
      this.vel.x += (wishX * speed - this.vel.x) * k;
      this.vel.z += (wishZ * speed - this.vel.z) * k;
      const vy = (ctl.jump ? 1 : 0) - (ctl.down ? 1 : 0);
      this.vel.y += (vy * speed * 0.75 - this.vel.y) * k;
    } else if (this.inWater > 0) {
      const speed = P.swimSpeed * (this.sprinting ? 1.3 : 1) * (this.inLava ? 0.5 : 1);
      const k = 1 - Math.exp(-dt * 6);
      this.vel.x += (wishX * speed - this.vel.x) * k;
      this.vel.z += (wishZ * speed - this.vel.z) * k;
      // Water: weak gravity, strong drag, hold space to swim up.
      this.vel.y -= P.gravity * 0.25 * dt;
      this.vel.y *= Math.exp(-dt * 2.5);
      if (ctl.jump) this.vel.y = Math.min(this.vel.y + 18 * dt, 3.2);
      if (ctl.down) this.vel.y = Math.max(this.vel.y - 18 * dt, -4);
      this.fallStartY = null;
    } else {
      const speed = this.sneaking ? P.walkSpeed * 0.3 : this.sprinting ? P.sprintSpeed : P.walkSpeed;
      // Strong control on the ground, weaker in the air (like real momentum).
      const k = 1 - Math.exp(-dt * (this.onGround ? 14 : 3));
      this.vel.x += (wishX * speed - this.vel.x) * k;
      this.vel.z += (wishZ * speed - this.vel.z) * k;
      this.vel.y -= P.gravity * dt;
      if (this.vel.y < -P.terminalVelocity) this.vel.y = -P.terminalVelocity;
      // Holding Space only re-jumps after a short delay (like the real game),
      // so landing on a block edge mid-jump can't launch you straight up again.
      if (ctl.jump && this.onGround && this.jumpCooldown <= 0) {
        this.vel.y = P.jumpVelocity;
        this.onGround = false;
        this.jumpCooldown = 0.45;
      }
      // Ladders and vines: climb with W or Space, hold Shift to stay put, otherwise slide down slowly.
      this.climbing = onClimbable(this.pos, P.playerWidth, P.playerHeight, getBlock);
      if (this.climbing) {
        if (ctl.jump || (ctl.forward > 0 && this.moving)) this.vel.y = 2.4;
        else if (ctl.sneak) this.vel.y = 0;
        else this.vel.y = Math.max(this.vel.y, -2.2);
        this.fallStartY = null;
      }
    }
    if (this.jumpCooldown > 0) this.jumpCooldown -= dt;

    // Sneaking on the ground: refuse to step off an edge (like a guard rail).
    if (this.sneaking && this.onGround && this.inWater === 0) {
      const hw = P.playerWidth / 2 - 0.05;
      if (!isSupported({ x: this.pos.x + this.vel.x * dt, y: this.pos.y, z: this.pos.z }, hw, getBlock)) this.vel.x = 0;
      if (!isSupported({ x: this.pos.x, y: this.pos.y, z: this.pos.z + this.vel.z * dt }, hw, getBlock)) this.vel.z = 0;
    }

    const wasOnGround = this.onGround;
    const res = moveEntity(this.pos, this.vel, dt, P.playerWidth, P.playerHeight, getBlock, this.onGround && !this.flying);
    this.onGround = res.onGround;
    if (this.flying && this.onGround && !ctl.jump) this.flying = false; // land to stop flying

    // ---- Fall damage: measure from the highest point of the fall ----
    if (this.flying || this.inWater > 0) this.fallStartY = null;
    else if (!this.onGround) {
      if (this.fallStartY === null || this.pos.y > this.fallStartY) this.fallStartY = this.pos.y;
    } else if (!wasOnGround && this.fallStartY !== null) {
      const fell = this.fallStartY - this.pos.y;
      this.fallStartY = null;
      if (!creative && fell > FALL_DAMAGE_START) events.onFallDamage(Math.floor(fell - FALL_DAMAGE_START + 0.5));
      events.onLand && events.onLand(fell);
    }

    // ---- Footsteps ----
    if (this.onGround && this.moving) {
      this.stepDistance += Math.hypot(this.vel.x, this.vel.z) * dt;
      if (this.stepDistance > 1.7) {
        this.stepDistance = 0;
        events.onStep(getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.2), Math.floor(this.pos.z)));
      }
    }

    if (!creative) {
      this._survival(dt, events);
      if (this.inLava) {
        this.lavaTimer -= dt;
        if (this.lavaTimer <= 0) { this.lavaTimer = 0.5; events.onDamage(4, 'lava'); }
      } else this.lavaTimer = 0;
    }
    if (this.hurtTime > 0) this.hurtTime -= dt;
  }

  // Hunger drains over time (faster when sprinting); full hunger slowly
  // heals you; empty hunger slowly hurts you.
  _survival(dt, events) {
    this.hungerTimer += dt * (this.sprinting ? 2.5 : 1) * (this.moving ? 1.2 : 1);
    if (this.hungerTimer > HUNGER_DRAIN_SECONDS) {
      this.hungerTimer = 0;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      if (this.regenTimer > 3) { this.regenTimer = 0; this.health = Math.min(MAX_HEALTH, this.health + 1); this.hungerTimer += 6; }
    } else this.regenTimer = 0;
    if (this.hunger === 0) {
      this.starveTimer += dt;
      if (this.starveTimer > 4) { this.starveTimer = 0; if (this.health > 1) events.onDamage(1, 'starving'); }
    }
    // Drowning, simplified: lose health slowly while the head is underwater for long.
    if (this.headInWater) {
      this.airTime = (this.airTime || 0) + dt;
      if (this.airTime > 15) { this.airTime = 14; events.onDamage(2, 'drowning'); }
    } else this.airTime = 0;
  }

  eat(food) {
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food);
    this.saturation = Math.min(this.hunger, this.saturation + food * 0.6);
  }
}
