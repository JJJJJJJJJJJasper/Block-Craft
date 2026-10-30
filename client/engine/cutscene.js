// ============================================================================
// The sunrise cutscene, played for everyone when all players are in bed.
//
// The server races the clock from night to morning over ~14 seconds; here the
// camera lifts up above the sleeping player and:
//   1. watches the moon sink toward the western horizon,
//   2. swings slowly around to the east,
//   3. watches the sun come up through the haze, with light rays and golden mist.
// Black bars top and bottom and a couple of captions make it feel like a film.
// ============================================================================

const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Cutscene {
  constructor() {
    this.active = false;
    // overlay: letterbox bars, a caption and a fade-to-black layer
    const el = (css) => { const d = document.createElement('div'); d.style.cssText = css; document.body.appendChild(d); return d; };
    const bar = 'position:fixed;left:0;right:0;height:0;background:#000;z-index:40;transition:height 1.2s ease;pointer-events:none;';
    this.top = el(bar + 'top:0;');
    this.bottom = el(bar + 'bottom:0;');
    this.caption = el('position:fixed;left:0;right:0;bottom:6vh;text-align:center;color:#f4ead8;font:600 28px Georgia,serif;letter-spacing:4px;'
      + 'text-shadow:0 2px 10px #000;opacity:0;transition:opacity 1.5s ease;z-index:41;pointer-events:none;');
    this.fade = el('position:fixed;inset:0;background:#000;opacity:0;z-index:42;pointer-events:none;');
  }

  /** msg = {from, ticks, duration} from the server. */
  start(msg, eye, dayTicks) {
    this.active = true;
    this.from = msg.from; this.ticks = msg.ticks; this.duration = msg.duration; this.dayTicks = dayTicks;
    this.t0 = performance.now();
    this.origin = { ...eye };
    this.cam = null;
    this.top.style.height = this.bottom.style.height = '11vh';
    this.caption.textContent = 'The night passes...';
    this.caption.style.opacity = 1;
    this.shownDawn = false;
  }

  get progress() { return Math.min(1, (performance.now() - this.t0) / 1000 / this.duration); }

  /** World time during the cutscene (it speeds up in the middle, slows at dawn). */
  time() { return (this.from + this.ticks * ease(this.progress)) % this.dayTicks; }

  /**
   * Camera pose for this frame. sunDir/moonDir are unit vectors from the sky.
   * Returns null when the cutscene has finished.
   */
  update(sunDir, moonDir, onDawn) {
    const f = this.progress;
    // fade in from black at the start, out to black at the very end
    this.fade.style.opacity = f < 0.08 ? 1 - f / 0.08 : f > 0.94 ? (f - 0.94) / 0.06 : 0;
    if (f > 0.55 && !this.shownDawn) {
      this.shownDawn = true;
      this.caption.style.opacity = 0;
      setTimeout(() => { if (this.active) { this.caption.textContent = 'A new day'; this.caption.style.opacity = 1; } }, 1500);
      if (onDawn) onDawn();
    }
    if (f >= 1) { this.stop(); return null; }
    // Look at the moon first, then turn to the rising sun.
    const look = (d) => ({ yaw: Math.atan2(-d.x, -d.z), pitch: Math.max(0.02, Math.min(0.32, Math.asin(d.y) * 0.6)) }); // keep the horizon in shot
    const moon = look(moonDir), sun = look(sunDir.y > -0.25 ? sunDir : { x: 1, y: 0.05, z: 0.25 });
    const turn = ease(Math.min(1, Math.max(0, (f - 0.35) / 0.3)));
    const target = { yaw: lerpAngle(moon.yaw, sun.yaw, turn), pitch: lerp(moon.pitch, sun.pitch + 0.04, turn) };
    if (!this.cam) this.cam = target;
    this.cam = { yaw: lerpAngle(this.cam.yaw, target.yaw, 0.05), pitch: lerp(this.cam.pitch, target.pitch, 0.05) };
    // Rise slowly above the bed, drifting a little sideways.
    const lift = 14 + 16 * ease(f);
    const pos = { x: this.origin.x + Math.sin(f * 2) * 3, y: Math.min(248, this.origin.y + lift), z: this.origin.z + f * 4 };
    return { pos, yaw: this.cam.yaw, pitch: this.cam.pitch };
  }

  stop() {
    this.active = false;
    this.top.style.height = this.bottom.style.height = '0';
    this.caption.style.opacity = 0;
    this.fade.style.transition = 'opacity 1s ease';
    this.fade.style.opacity = 0;
    setTimeout(() => { this.fade.style.transition = ''; }, 1100);
  }
}
