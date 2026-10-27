// ============================================================================
// Keyboard + mouse input with pointer lock.
//
// Pointer lock hides the cursor and gives us raw mouse movement, which is what
// first-person games need. Browsers only allow it after a user click.
//
// Chromebook notes:
//  - Avoid Ctrl shortcuts: Ctrl+W closes the tab and can't be blocked.
//  - The top-row keys act as browser keys (F3 = refresh) unless Search is
//    held, so every F-key action also has a plain-key alternative.
//  - Trackpads: tap = left click, two-finger tap or Alt+click = right click.
//    R and F are keyboard alternatives for break and place.
// ============================================================================

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();     // keys pressed since last frame (edge-triggered)
    this.mouse = { left: false, right: false, dx: 0, dy: 0, wheel: 0, leftPressed: false, rightPressed: false };
    this.locked = false;
    this.enabled = true;           // false while a menu/chat is open
    this.lastTap = {};             // for double-tap detection
    this.doubleTapped = new Set();
    this.sensitivity = 1;
    this.onLockChange = null;
    this.onKey = null;             // raw keydown hook (UI shortcuts)

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.lockTime = performance.now();
      if (!this.locked) this.releaseAll();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('keydown', (e) => this._keyDown(e));
    document.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Chrome sometimes reports one huge jump right after the pointer locks
      // (or when the window regains focus). Ignore those spikes.
      if (performance.now() - this.lockTime < 150) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      // Alt+click acts as right click (handy on Chromebook trackpads).
      const right = e.button === 2 || (e.button === 0 && e.altKey);
      if (right) { this.mouse.right = true; this.mouse.rightPressed = true; this.altRight = e.button === 0; }
      else if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 0) {
        this.mouse.left = false;
        if (this.altRight) this.mouse.right = false;
      }
      this.altRight = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      if (this.locked) { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });
  }

  _keyDown(e) {
    // Let text inputs work normally.
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (this.onKey && this.onKey(e) === true) { e.preventDefault(); return; }
    if (!this.enabled) return;
    // Stop the browser from scrolling or changing focus on game keys.
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'F3', 'Slash', 'Quote'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    const now = performance.now();
    if (now - (this.lastTap[e.code] || 0) < 280) this.doubleTapped.add(e.code);
    this.lastTap[e.code] = now;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  }

  requestLock() {
    if (!this.locked) {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {}); // can fail if called too soon after Esc
    }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  releaseAll() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
  }

  down(code) { return this.enabled && this.keys.has(code); }
  wasPressed(code) { return this.enabled && this.pressed.has(code); }
  wasDoubleTapped(code) { return this.enabled && this.doubleTapped.has(code); }

  /** Read and reset per-frame accumulators. Call once at the end of a frame. */
  endFrame() {
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftPressed = false; this.mouse.rightPressed = false;
    this.pressed.clear();
    this.doubleTapped.clear();
  }
}
