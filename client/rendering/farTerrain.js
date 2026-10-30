// ============================================================================
// Far terrain: a cheap, low-detail landscape drawn BEYOND the loaded chunks,
// so big mountains on the horizon are always there, the way they look from a
// real mountaintop.
//
// A worker samples the terrain generator every few blocks out to ~900 blocks
// and colours each point (snow, rock, forest, grass, sand, water). Here that
// grid becomes one mesh with a simple lit shader, thick blue haze with
// distance, and white mist lying in the valleys. Inside the render distance the
// real block chunks take over (the far mesh discards its pixels there).
// ============================================================================
import * as THREE from 'three';

const RADIUS = 896;     // blocks from the centre
const STEP = 8;         // one sample every 8 blocks
const MOVE_REFRESH = 128;

const VERT = /* glsl */`
  attribute vec3 color;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vColor = color;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normal;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const FRAG = /* glsl */`
  uniform float daylight;
  uniform vec3 sunDir;
  uniform vec3 sunTint;
  uniform vec3 hazeColor;
  uniform vec3 mistColor;
  uniform float innerRadius;
  uniform float seaLevel;
  varying vec3 vColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  // (the haze and mist maths match the chunk shader in renderer.js)
  void main() {
    float d = length(vWorld.xz - cameraPosition.xz);
    if (d < innerRadius) discard;  // the real chunks are drawn here
    vec3 n = normalize(vNormal);
    float sun = max(dot(n, sunDir), 0.0);
    float light = (0.55 + 0.45 * sun) * (0.13 + 0.87 * pow(0.8, (1.0 - daylight) * 15.0));
    vec3 col = vColor / 255.0 * light * sunTint;
    // Aerial haze: the further away, the more it fades into the blue air.
    float haze = 1.0 - exp(-d * 0.0016);
    // Valley mist: low ground far away sits in a white mist.
    float mist = exp(-max(vWorld.y - seaLevel - 6.0, 0.0) / 22.0) * smoothstep(140.0, 500.0, d);
    col = mix(col, hazeColor, haze * 0.85);
    col = mix(col, mistColor, mist * 0.55);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class FarTerrain {
  constructor(scene, pool, seaLevel) {
    this.scene = scene;
    this.pool = pool;
    this.mesh = null;
    this.center = null;
    this.busy = false;
    this.uniforms = {
      daylight: { value: 1 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunTint: { value: new THREE.Color(1, 1, 1) },
      hazeColor: { value: new THREE.Color(0.7, 0.8, 0.95) }, mistColor: { value: new THREE.Color(0.9, 0.92, 0.95) },
      innerRadius: { value: 90 }, seaLevel: { value: seaLevel },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      // pushed slightly back so real blocks always win where both exist
      polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4,
    });
  }

  /** Call every frame. Requests a new grid when the player has moved far enough. */
  update(px, pz, renderDistance, env) {
    const U = this.uniforms;
    U.innerRadius.value = Math.max(16, renderDistance * 16 - 10);
    if (env) {
      U.daylight.value = env.daylight;
      U.sunDir.value.copy(env.sunDir);
      U.sunTint.value.copy(env.sunTint);
      U.hazeColor.value.copy(env.haze);
      U.mistColor.value.copy(env.mist);
    }
    if (this.busy) return;
    const cx = Math.round(px / 64) * 64, cz = Math.round(pz / 64) * 64;
    if (this.center && Math.hypot(cx - this.center.x, cz - this.center.z) < MOVE_REFRESH) return;
    this.busy = true;
    // low priority: real chunks around the player always come first
    this.pool.run({ type: 'far', cx, cz, radius: RADIUS, step: STEP }, 1e9).then((res) => {
      this.busy = false;
      if (res && res.far) { this._build(res.far); this.center = { x: cx, z: cz }; }
    });
  }

  _build({ n, step, x0, z0, h, col }) {
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = i + j * n;
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = Math.round(h[k]) + 1; pos[k * 3 + 2] = z0 + j * step;
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let t = 0;
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = i + j * n, b = a + 1, c = a + n, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.scene.add(this.mesh);
  }
}
