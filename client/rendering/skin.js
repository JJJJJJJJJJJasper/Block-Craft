// ============================================================================
// Player appearance. Colours are derived from the player's name, so everyone
// sees the same look for the same player without sending any skin data.
// Used by the 3D avatars (entities.js) and the inventory preview.
// ============================================================================
import { hashSeed, mulberry32 } from '../../shared/noise.js';
import { ITEMS, ARMOR_TIERS } from '../../shared/items.js';

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];

function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

export function playerColors(name) {
  const r = mulberry32(hashSeed(name));
  // Same order of random calls as before, so existing players keep their look.
  const shirtH = r(), pantsH = r();
  const skin = SKINS[Math.floor(r() * SKINS.length)];
  return { skin, shirt: hsl(shirtH, 0.55, 0.45), pants: hsl(pantsH, 0.4, 0.25) };
}

/** Armor tier colour for each of the 4 armor slots (or null). */
export function armorColors(slots) {
  return [0, 1, 2, 3].map((i) => {
    const s = slots[36 + i];
    const it = s && ITEMS[s.id];
    return it && it.armor ? ARMOR_TIERS[it.name.split('_')[0]].color : null;
  });
}

/**
 * Draw a front view of the player (like the paper-doll in the inventory) on a
 * canvas, using 1 "skin pixel" = `px` screen pixels.
 */
export function drawPlayerPreview(canvas, name, slots, px = 5) {
  const ctx = canvas.getContext('2d');
  const c = playerColors(name);
  const armor = armorColors(slots);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const ox = Math.floor((canvas.width - 16 * px) / 2), oy = Math.floor((canvas.height - 32 * px) / 2);
  const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(ox + x * px, oy + y * px, w * px, h * px); };
  const darker = (hex, f) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v) => Math.round(v * f).toString(16).padStart(2, '0');
    return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
  };
  // head
  rect(4, 0, 8, 8, c.skin);
  rect(4, 0, 8, 2, darker(c.skin, 0.55));             // hair
  rect(5, 4, 2, 1, '#ffffff'); rect(9, 4, 2, 1, '#ffffff');
  rect(6, 4, 1, 1, '#3355aa'); rect(9, 4, 1, 1, '#3355aa');
  rect(7, 6, 2, 1, darker(c.skin, 0.7));
  // body and arms
  rect(4, 8, 8, 12, c.shirt);
  rect(0, 8, 4, 12, c.skin); rect(12, 8, 4, 12, c.skin);
  rect(0, 8, 4, 4, c.shirt); rect(12, 8, 4, 4, c.shirt);
  // legs
  rect(4, 20, 4, 12, c.pants); rect(8, 20, 4, 12, c.pants);
  rect(4, 29, 4, 3, '#555555'); rect(8, 29, 4, 3, '#555555');
  // armor overlays
  if (armor[0]) { rect(3, -1, 10, 3, armor[0]); rect(3, 2, 1, 5, armor[0]); rect(12, 2, 1, 5, armor[0]); }
  if (armor[1]) { rect(4, 8, 8, 11, armor[1]); rect(0, 8, 4, 5, armor[1]); rect(12, 8, 4, 5, armor[1]); rect(6, 10, 4, 1, darker(armor[1], 0.75)); }
  if (armor[2]) { rect(4, 19, 8, 3, armor[2]); rect(4, 22, 4, 6, armor[2]); rect(8, 22, 4, 6, armor[2]); }
  if (armor[3]) { rect(4, 28, 4, 4, armor[3]); rect(8, 28, 4, 4, armor[3]); }
}
