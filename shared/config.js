// ============================================================================
// BlockCraft global configuration.
// Change GAME_NAME here to rename the game everywhere (menu, title, README
// placeholders in the UI). Every tunable number used by both the client and
// the server lives in this file so you can experiment in one place.
// ============================================================================

export const GAME_NAME = 'BlockCraft';

// ---- World layout ----------------------------------------------------------
export const CHUNK_SIZE = 16;          // blocks along X and Z
export const CHUNK_HEIGHT = 128;       // blocks along Y
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT;
export const SEA_LEVEL = 50;           // water fills empty space at or below this Y

// ---- Rendering defaults (client) -------------------------------------------
export const DEFAULT_RENDER_DISTANCE = 6;   // in chunks
export const MIN_RENDER_DISTANCE = 2;
export const MAX_RENDER_DISTANCE = 12;
export const DEFAULT_FOV = 75;

// ---- Player physics (blocks / second) --------------------------------------
export const PHYSICS = {
  gravity: 28,
  jumpVelocity: 8.6,        // gives a jump height of ~1.3 blocks
  walkSpeed: 4.3,
  sprintSpeed: 5.8,
  flySpeed: 10.5,
  flySprintSpeed: 21,
  swimSpeed: 3.0,
  terminalVelocity: 60,
  playerWidth: 0.6,
  playerHeight: 1.8,
  eyeHeight: 1.62,
  stepTime: 0.4,            // seconds between footstep sounds
};

// ---- Interaction ------------------------------------------------------------
export const REACH = 5;                 // blocks the player can reach
export const SERVER_REACH_SLACK = 2;    // extra tolerance for latency on the server

// ---- Time --------------------------------------------------------------------
// One full day/night cycle. The world clock runs from 0 to DAY_TICKS.
// 0 = sunrise, 0.25 = noon, 0.5 = sunset, 0.75 = midnight (as a fraction).
export const DAY_LENGTH_SECONDS = 20 * 60;
export const DAY_TICKS = 24000;

// ---- Survival ----------------------------------------------------------------
export const MAX_HEALTH = 20;           // 10 hearts
export const MAX_HUNGER = 20;           // 10 drumsticks
export const FALL_DAMAGE_START = 3.5;   // blocks you can fall without damage
export const HUNGER_DRAIN_SECONDS = 40; // lose 1 hunger point roughly this often (more when sprinting)

// ---- Networking ----------------------------------------------------------------
export const SERVER_TICK_RATE = 20;     // snapshots per second
export const CLIENT_SEND_RATE = 20;     // position updates per second
export const INTERP_DELAY_MS = 100;     // render remote entities this far in the past
export const MAX_PLAYERS_PER_ROOM = 16;
export const AUTOSAVE_SECONDS = 30;
export const ROOM_IDLE_UNLOAD_SECONDS = 300; // unload empty rooms from memory after this

// ---- Anti-cheat ------------------------------------------------------------------
export const EDIT_RATE_PER_SEC = 20;    // block edits refilled per second
export const EDIT_BURST = 40;           // max edits that can be banked
export const CHAT_RATE_PER_SEC = 1;
export const CHAT_BURST = 5;
export const SPEED_TOLERANCE = 1.6;     // multiplier on the max legal speed

// ---- Mobs -------------------------------------------------------------------------
export const MOBS = {
  maxPigs: 12,
  maxZombies: 10,
  spawnRadiusMin: 16,
  spawnRadiusMax: 40,
  despawnRadius: 80,
};
