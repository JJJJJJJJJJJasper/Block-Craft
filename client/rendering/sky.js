// ============================================================================
// Sky: background colour over the day, a square sun and moon that orbit the
// player, and stars that fade in at night. All very cheap: a few sprites.
// ============================================================================
import * as THREE from 'three';

const DAY = new THREE.Color(0x87b5ff);
const SUNSET = new THREE.Color(0xf09a5a);
const NIGHT = new THREE.Color(0x070b1a);
const FOG_DAY = new THREE.Color(0xb4d0ff);
const FOG_NIGHT = new THREE.Color(0x0b1022);

function pixelTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  return t;
}

export class Sky {
  constructor(scene, camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    scene.add(this.group);

    const sunTex = pixelTexture(ctx => {
      ctx.fillStyle = '#fff7c0'; ctx.fillRect(4, 4, 24, 24);
      ctx.fillStyle = '#ffe36b'; ctx.fillRect(8, 8, 16, 16);
    });
    const moonTex = pixelTexture(ctx => {
      ctx.fillStyle = '#e8ecf4'; ctx.fillRect(6, 6, 20, 20);
      ctx.fillStyle = '#b9c0cc'; ctx.fillRect(10, 10, 5, 5); ctx.fillRect(18, 16, 4, 4); ctx.fillRect(12, 20, 3, 3);
    });
    const mat = (map) => new THREE.SpriteMaterial({ map, fog: false, depthWrite: false, transparent: true });
    this.sunSprite = new THREE.Sprite(mat(sunTex));
    this.sunSprite.scale.set(60, 60, 1);
    this.moonSprite = new THREE.Sprite(mat(moonTex));
    this.moonSprite.scale.set(40, 40, 1);
    this.group.add(this.sunSprite, this.moonSprite);

    // Stars: random points on a sphere.
    const n = 600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(a) * 400; pos[i * 3 + 1] = Math.abs(u) * 400; pos[i * 3 + 2] = r * Math.sin(a) * 400;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.group.add(this.stars);
    for (const o of this.group.children) o.renderOrder = -1;

    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();
  }

  /**
   * @param {number} t time of day 0..1 (0 sunrise, .25 noon, .5 sunset, .75 midnight)
   */
  update(t) {
    // Sun angle: rises in the east (+x), sets in the west.
    const angle = t * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    // Daylight: 1 at day, ~0.28 at night (moonlight), smooth transition around sunrise/sunset.
    const height = sunDir.y;
    const daylight = THREE.MathUtils.clamp(0.28 + (height + 0.15) * 2.2, 0.28, 1);

    // Blend sky colours: night -> sunset glow near the horizon -> day.
    const dayAmt = THREE.MathUtils.smoothstep(height, -0.2, 0.25);
    this.skyColor.copy(NIGHT).lerp(DAY, dayAmt);
    const glow = Math.max(0, 1 - Math.abs(height) * 4) * 0.6;
    this.skyColor.lerp(SUNSET, glow);
    this.fogColor.copy(FOG_NIGHT).lerp(FOG_DAY, dayAmt).lerp(SUNSET, glow * 0.7);

    this.group.position.copy(this.camera.position);
    this.sunSprite.position.copy(sunDir).multiplyScalar(300);
    this.moonSprite.position.copy(sunDir).multiplyScalar(-300);
    this.starMat.opacity = THREE.MathUtils.clamp(1 - dayAmt * 1.5, 0, 1);
    this.stars.visible = this.starMat.opacity > 0.01;
    this.stars.rotation.z = angle;

    return { daylight, skyColor: this.skyColor, fogColor: this.fogColor };
  }
}
