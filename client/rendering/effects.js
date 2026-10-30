// ============================================================================
// Short-lived visual effects: particles (hearts, smoke, magic, firework
// sparks), firework rockets, guardian beams and evoker fangs.
//
// Particles live in two big point clouds (one glowing/additive, one ordinary)
// so hundreds of sparks cost a single draw call each. Every particle has a
// position, velocity, colour, gravity, air drag and a lifetime; it fades out
// as it ages.
// ============================================================================
import * as THREE from 'three';
import { mulberry32 } from '../../shared/noise.js';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
function squareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(1, 1, 6, 6);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}
function heartTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 9;
  const x = c.getContext('2d');
  x.fillStyle = '#e8242c';
  for (const [a, b, w] of [[1, 1, 2], [5, 1, 2], [0, 2, 9], [0, 3, 9], [1, 4, 7], [2, 5, 5], [3, 6, 3], [4, 7, 1]]) x.fillRect(a, b, w, 1);
  x.fillStyle = '#ff9a9a'; x.fillRect(1, 2, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  return t;
}

class Particles {
  constructor(scene, cap, additive, size, map) {
    this.cap = cap; this.n = 0; this.additive = additive;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4);
    this.vel = new Float32Array(cap * 3); this.rgb = new Float32Array(cap * 3);
    this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap); this.drag = new Float32Array(cap); this.flicker = new Uint8Array(cap);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size, map, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, alphaTest: additive ? 0 : 0.1,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  add(x, y, z, vx, vy, vz, r, g, b, life, grav = 0, drag = 0, flicker = false) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3); this.vel.set([vx, vy, vz], i * 3); this.rgb.set([r, g, b], i * 3);
    this.life[i] = this.max[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.flicker[i] = flicker ? 1 : 0;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap the last particle into this slot
        const j = --this.n;
        if (i !== j) {
          this.pos.copyWithin(i * 3, j * 3, j * 3 + 3); this.vel.copyWithin(i * 3, j * 3, j * 3 + 3); this.rgb.copyWithin(i * 3, j * 3, j * 3 + 3);
          this.life[i] = this.life[j]; this.max[i] = this.max[j]; this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j]; this.flicker[i] = this.flicker[j];
        }
        continue;
      }
      const k = i * 3, d = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d - this.grav[i] * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      let fade = Math.min(1, (this.life[i] / this.max[i]) * 3);
      if (this.flicker[i] && this.life[i] < this.max[i] * 0.6) fade *= Math.random() < 0.5 ? 0.15 : 1;
      const c = i * 4;
      if (this.additive) { this.col[c] = this.rgb[k] * fade; this.col[c + 1] = this.rgb[k + 1] * fade; this.col[c + 2] = this.rgb[k + 2] * fade; this.col[c + 3] = 1; }
      else { this.col[c] = this.rgb[k]; this.col[c + 1] = this.rgb[k + 1]; this.col[c + 2] = this.rgb[k + 2]; this.col[c + 3] = fade; }
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true;
  }
}

// Firework colours (as RGB 0..1) and burst shapes.
const FIREWORK_COLORS = [[1, 0.25, 0.2], [1, 0.6, 0.1], [1, 0.95, 0.3], [0.3, 1, 0.35], [0.25, 0.9, 1], [0.35, 0.45, 1], [0.8, 0.35, 1], [1, 0.45, 0.8], [1, 1, 1]];
const SHAPES = ['ball', 'big', 'star', 'ring', 'heart'];

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = new Particles(scene, 3000, true, 0.6, dotTexture());
    this.solid = new Particles(scene, 1500, false, 0.18, squareTexture());
    this.heartMat = new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false });
    this.sprites = [];   // {sprite, vy, life}
    this.rockets = [];   // {x, y, z, vy, t, fuse, rng, colors, shape, trail, twinkle}
    this.beams = [];     // {line, from: () => pos, to: () => pos, t, time}
    this.jaws = [];      // {group, t}: evoker fangs
  }

  /** Hearts float up (breeding, taming). */
  hearts(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(this.heartMat.clone());
      s.scale.set(0.3, 0.3, 1);
      s.position.set(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.8);
      this.scene.add(s);
      this.sprites.push({ sprite: s, vy: 0.6 + Math.random() * 0.4, life: 1.2 + Math.random() * 0.6, max: 1.8 });
    }
  }

  /** A puff of particles: smoke (failed taming, golems), magic (spells), snow, teleport. */
  puff(kind, x, y, z) {
    const n = kind === 'teleport' ? 30 : 14;
    for (let i = 0; i < n; i++) {
      const vx = (Math.random() - 0.5) * 2, vy = Math.random() * 1.5, vz = (Math.random() - 0.5) * 2;
      if (kind === 'smoke') { const g = 0.4 + Math.random() * 0.3; this.solid.add(x, y, z, vx, vy, vz, g, g, g, 0.8 + Math.random() * 0.5, -0.5, 1); }
      else if (kind === 'snow') this.solid.add(x, y, z, vx * 2, vy * 2, vz * 2, 0.95, 0.97, 1, 0.8, 6, 0.5);
      else if (kind === 'spell') this.glow.add(x, y, z, vx, vy + 0.5, vz, 0.7, 0.45, 1, 1, -0.3, 1);
      else if (kind === 'teleport') this.glow.add(x + vx * 0.3, y + (Math.random() - 0.5) * 2.4, z + vz * 0.3, vx * 0.6, vy * 0.3, vz * 0.6, 0.35, 1, 0.85, 1.1, 0, 0.6);
    }
  }

  /** A firework launched from (x, y, z). Everything about it comes from `seed`, so every player sees the same one. */
  firework(x, y, z, seed) {
    const rng = mulberry32(seed >>> 0);
    const colors = [];
    for (let i = 0, n = 1 + Math.floor(rng() * 3); i < n; i++) colors.push(FIREWORK_COLORS[Math.floor(rng() * FIREWORK_COLORS.length)]);
    this.rockets.push({ x, y, z, vx: (rng() - 0.5) * 1.2, vy: 18, vz: (rng() - 0.5) * 1.2, t: 0, fuse: 1.1 + rng() * 0.7,
      rng, colors, shape: SHAPES[Math.floor(rng() * SHAPES.length)], trail: rng() < 0.4, twinkle: rng() < 0.4 });
  }

  _burst(r) {
    const { rng, colors, shape } = r;
    const spark = (dx, dy, dz, speed) => {
      const c = colors[Math.floor(rng() * colors.length)];
      this.glow.add(r.x, r.y, r.z, dx * speed, dy * speed, dz * speed, c[0], c[1], c[2], 1.8 + rng() * 0.9, 3, 1.6, r.twinkle);
      if (r.trail) this.glow.add(r.x, r.y, r.z, dx * speed * 0.6, dy * speed * 0.6, dz * speed * 0.6, c[0], c[1], c[2], 2.2, 3, 1.6, true);
    };
    if (shape === 'ball' || shape === 'big') {
      const n = shape === 'big' ? 220 : 120, sp = shape === 'big' ? 17 : 10;
      for (let i = 0; i < n; i++) {
        const u = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        spark(s * Math.cos(a), u, s * Math.sin(a), sp * (0.85 + rng() * 0.15));
      }
    } else if (shape === 'ring') {
      const tilt = rng() * Math.PI;
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        spark(Math.cos(a), Math.sin(a) * Math.cos(tilt), Math.sin(a) * Math.sin(tilt), 11);
      }
    } else {
      // a flat outline (star or heart) facing a random direction
      const yaw = rng() * Math.PI * 2;
      const pts = [];
      if (shape === 'star') {
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 + Math.PI / 2, rr = k % 2 ? 0.45 : 1; pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      } else {
        for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2; pts.push([16 * Math.sin(t) ** 3 / 16, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16]); }
      }
      for (let k = 0; k < pts.length; k++) {
        const [a0, b0] = pts[k], [a1, b1] = pts[(k + 1) % pts.length];
        for (let s = 0; s < 6; s++) {
          const f = s / 6, a = a0 + (a1 - a0) * f, b = b0 + (b1 - b0) * f;
          spark(Math.cos(yaw) * a, b, Math.sin(yaw) * a, 11);
        }
      }
    }
  }

  /** A guardian's beam: from its eye to its target, glowing brighter until it fires. */
  beam(from, to, time) {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8a40ff, transparent: true, opacity: 0.9 }));
    line.frustumCulled = false;
    this.scene.add(line);
    this.beams.push({ line, from, to, t: 0, time });
  }

  /** Evoker fangs: jaws snap up out of the ground along a line. */
  fangs(points) {
    const m = new THREE.MeshLambertMaterial({ color: 0xc8c0a8 });
    points.forEach(([x, y, z], i) => {
      const g = new THREE.Group();
      g.position.set(x, y - 0.6, z);
      for (const s of [1, -1]) {
        const jaw = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.2), m); b.position.set(0, 0.3, 0.1 * s);
        for (let k = -1; k <= 1; k++) { const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.15, 0.08), m); tooth.position.set(k * 0.16, 0.66, 0.06 * s); jaw.add(tooth); }
        jaw.add(b); jaw.userData.side = s;
        g.add(jaw);
      }
      g.visible = false;
      this.scene.add(g);
      this.jaws.push({ group: g, t: -i * 0.05 });
    });
  }

  update(dt, sfx, listener) {
    // firework rockets climb, leave sparks behind, then burst
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt;
      r.vy -= 4 * dt;
      r.x += r.vx * dt; r.y += r.vy * dt; r.z += r.vz * dt;
      for (let k = 0; k < 3; k++) this.glow.add(r.x, r.y, r.z, (Math.random() - 0.5) * 0.6, -1 - Math.random(), (Math.random() - 0.5) * 0.6, 1, 0.75, 0.4, 0.4 + Math.random() * 0.3, 2, 2);
      if (r.t >= r.fuse) {
        this._burst(r);
        this.rockets.splice(i, 1);
        if (sfx) sfx.burst(Math.hypot(r.x - listener.x, r.y - listener.y, r.z - listener.z));
      }
    }
    this.glow.update(dt);
    this.solid.update(dt);
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const s = this.sprites[i];
      s.life -= dt;
      s.sprite.position.y += s.vy * dt;
      s.sprite.material.opacity = Math.min(1, s.life * 2);
      if (s.life <= 0) { this.scene.remove(s.sprite); s.sprite.material.dispose(); this.sprites.splice(i, 1); }
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += dt;
      const a = b.from(), c = b.to();
      if (!a || !c || b.t > b.time + 0.15) { this.scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); this.beams.splice(i, 1); continue; }
      const arr = b.line.geometry.attributes.position.array;
      arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = c.x; arr[4] = c.y; arr[5] = c.z;
      b.line.geometry.attributes.position.needsUpdate = true;
      const f = Math.min(1, b.t / b.time);
      b.line.material.color.setRGB(0.55 + 0.45 * f, 0.25 + 0.65 * f, 1 - 0.7 * f);
    }
    for (let i = this.jaws.length - 1; i >= 0; i--) {
      const f = this.jaws[i];
      f.t += dt;
      if (f.t < 0) continue;
      f.group.visible = true;
      // rise out of the ground, bite, sink back
      const t = f.t;
      f.group.position.y += (t < 0.25 ? 2.4 : t > 0.8 ? -2.4 : 0) * dt;
      const bite = t < 0.35 ? 0.9 : t < 0.5 ? 0.9 - (t - 0.35) / 0.15 * 0.9 : 0;
      for (const jaw of f.group.children) jaw.rotation.x = bite * jaw.userData.side;
      if (t > 1.05) { this.scene.remove(f.group); this.jaws.splice(i, 1); }
    }
  }
}
