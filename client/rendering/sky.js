// ============================================================================
// Sky: a big dome around the camera painted by a shader, plus a cloud layer.
//
// The dome's fragment shader works out the colour for every direction you
// look in:
//   - a gradient from the horizon colour up to the zenith colour,
//   - warm sunrise/sunset light low in the sky, strongest toward the sun,
//   - a round sun with a soft glow,
//   - at night: twinkling stars, a faint band of the galaxy, a crescent
//     moon with a halo, and (in snowy biomes) green/purple aurora curtains.
// The colours themselves are picked on the CPU once per frame from the sun's
// height, so the shader only blends a handful of uniforms.
//
// Clouds are one big flat sheet high in the sky that follows the player;
// its shader samples a small tiling noise texture with a slow wind drift.
// ============================================================================
import * as THREE from 'three';

const C = (hex) => new THREE.Color(hex);
// Zenith / horizon colours for the key moments of the day.
const DAY_ZENITH = C(0x3d78d8), DAY_HORIZON = C(0xb5d3f2);
const NIGHT_ZENITH = C(0x02040c), NIGHT_HORIZON = C(0x0b1428);
const DUSK_ZENITH = C(0x2b3a6e), DUSK_HORIZON = C(0xf08a4b);
const SUNSET_GLOW = C(0xff7a3a);

const SKY_RADIUS = 1000;
const CLOUD_HEIGHT = 196;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane, behind everything
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 glowColor;
  uniform vec3 sunDir;
  uniform vec3 moonDir;
  uniform float sunset;   // 0..1 how strong the sunrise/sunset colours are
  uniform float night;    // 0 day .. 1 full night
  uniform float time;     // seconds, for twinkling and the aurora's motion
  uniform float starAngle;
  uniform float aurora;   // 0..1
  varying vec3 vDir;

  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

  void main() {
    vec3 d = normalize(vDir);
    float up = d.y;

    // --- base gradient ---
    vec3 col = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.5));
    if (up < 0.0) col = horizon * (1.0 - min(-up * 2.0, 0.35));

    // --- sunrise / sunset band, strongest in the sun's direction ---
    vec2 hd = normalize(d.xz + vec2(1e-5));
    vec2 hs = normalize(sunDir.xz + vec2(1e-5));
    float facing = dot(hd, hs) * 0.5 + 0.5;
    float band = exp(-abs(up) * 5.0);
    col = mix(col, glowColor, sunset * band * (0.25 + 0.75 * facing * facing * facing));

    // --- sun ---
    float toSun = max(dot(d, sunDir), 0.0);
    float dayVis = 1.0 - night * 0.9;
    col += vec3(1.0, 0.82, 0.55) * (pow(toSun, 500.0) * 0.9 + pow(toSun, 40.0) * 0.25 + pow(toSun, 6.0) * 0.08 * sunset) * dayVis;
    col = mix(col, vec3(1.0, 0.98, 0.88), smoothstep(0.99935, 0.99965, toSun));

    if (night > 0.01) {
      // Stars live on a sphere that slowly turns with the time of day.
      float c = cos(starAngle), s = sin(starAngle);
      vec3 sd = vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z);
      vec3 q = sd * 260.0;
      vec3 cell = floor(q);
      float h = hash(cell);
      if (h > 0.965) {
        vec3 center = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 5.1)) - 0.5) * 0.6;
        center = normalize(center) * 260.0;
        float size = h > 0.995 ? 0.9 : 0.55;
        float b = smoothstep(size, 0.0, length(q - center));
        float twinkle = 0.65 + 0.35 * sin(time * (2.0 + h * 3.0) + h * 80.0);
        vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(h * 37.0));
        col += tint * b * twinkle * night * smoothstep(-0.02, 0.15, up) * (h > 0.995 ? 1.6 : 1.0);
      }
      // a faint galaxy band across the sky
      vec3 n0 = normalize(vec3(0.35, 0.25, 0.9));
      float g = exp(-pow(dot(sd, n0) / 0.16, 2.0));
      float clumps = 0.55 + 0.45 * sin(sd.x * 23.0 + sin(sd.z * 17.0) * 2.0) * sin(sd.y * 19.0 + sd.x * 7.0);
      col += vec3(0.32, 0.34, 0.5) * g * clumps * 0.16 * night * smoothstep(0.0, 0.2, up);

      // --- crescent moon ---
      float toMoon = dot(d, moonDir);
      if (toMoon > 0.97) {
        vec3 right = normalize(cross(moonDir, vec3(0.0, 0.0, 1.0)));
        vec3 upv = cross(right, moonDir);
        vec2 m = vec2(dot(d, right), dot(d, upv));
        float r = 0.034;
        float disc = smoothstep(r, r * 0.93, length(m));
        float shadow = smoothstep(r * 0.86, r * 0.98, length(m - vec2(r * 0.48, r * 0.18)));
        float spots = 0.9 + 0.1 * sin(m.x * 400.0) * sin(m.y * 350.0);
        col = mix(col, vec3(0.93, 0.95, 1.0) * spots, disc * shadow);
        col += vec3(0.05, 0.06, 0.09) * disc * (1.0 - shadow);      // dim "earthshine" side
      }
      col += vec3(0.35, 0.42, 0.6) * pow(max(toMoon, 0.0), 300.0) * 0.6 * night; // halo
      col += vec3(0.15, 0.2, 0.32) * pow(max(toMoon, 0.0), 12.0) * 0.18 * night;

      // --- aurora curtains ---
      if (aurora > 0.01 && up > 0.0) {
        float az = atan(d.z, d.x);
        float h0 = 0.3 + 0.08 * sin(az * 3.0 + time * 0.07) + 0.04 * sin(az * 7.0 - time * 0.11);
        float curtain = exp(-pow((up - h0) / 0.07, 2.0));
        float rays = smoothstep(h0 - 0.03, h0 + 0.02, up) * exp(-(up - h0) * 5.0);
        float streak = 0.5 + 0.5 * sin(az * 70.0 + sin(az * 9.0 + time * 0.35) * 5.0);
        float patches = smoothstep(-0.3, 0.8, sin(az * 2.0 + time * 0.04) + 0.4 * sin(az * 5.0 - time * 0.09));
        vec3 ac = mix(vec3(0.15, 1.0, 0.55), vec3(0.6, 0.3, 1.0), smoothstep(h0, h0 + 0.3, up));
        col += ac * (curtain * 0.8 + rays * 0.7) * (0.4 + 0.6 * streak) * patches * aurora * night * 0.6;
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CLOUD_VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const CLOUD_FRAG = /* glsl */`
  uniform sampler2D noiseMap;
  uniform vec2 wind;
  uniform vec3 cloudColor;
  uniform vec3 camPos;
  uniform float cover;
  varying vec3 vWorld;
  void main() {
    vec2 uv = (vWorld.xz + wind) / 900.0;
    float n = texture2D(noiseMap, uv).r * 0.65 + texture2D(noiseMap, uv * 3.1 + 0.37).r * 0.35;
    float a = smoothstep(cover, cover + 0.16, n);
    float dist = length(vWorld.xz - camPos.xz);
    a *= 1.0 - smoothstep(380.0, 900.0, dist);
    if (a < 0.01) discard;
    // thicker parts are a little darker underneath
    vec3 col = cloudColor * (1.04 - smoothstep(cover, cover + 0.45, n) * 0.18);
    gl_FragColor = vec4(col, a * 0.88);
  }
`;

/** A small tiling value-noise texture for the clouds. */
function cloudNoise() {
  const N = 128, data = new Uint8Array(N * N * 4);
  let s = 1234567;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const grid = 16, g = [];
  for (let i = 0; i < grid * grid; i++) g.push(rnd());
  const at = (i, j) => g[((j + grid) % grid) * grid + ((i + grid) % grid)];
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 0.6, freq = 1;
    for (let o = 0; o < 3; o++) {
      const fx = (x / N) * grid * freq, fy = (y / N) * grid * freq;
      const i = Math.floor(fx), j = Math.floor(fy), tx = smooth(fx - i), ty = smooth(fy - j);
      const a = at(i, j) + (at(i + 1, j) - at(i, j)) * tx, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
      v += (a + (b - a) * ty) * amp; amp *= 0.5; freq *= 2;
    }
    const k = (y * N + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = Math.min(255, v / 0.95 * 255); data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class Sky {
  constructor(scene, camera) {
    this.camera = camera;
    this.uniforms = {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glowColor: { value: SUNSET_GLOW.clone() },
      sunDir: { value: new THREE.Vector3() }, moonDir: { value: new THREE.Vector3() },
      sunset: { value: 0 }, night: { value: 0 }, time: { value: 0 }, starAngle: { value: 0 }, aurora: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_RADIUS, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    this.cloudUniforms = {
      noiseMap: { value: cloudNoise() }, wind: { value: new THREE.Vector2() }, cloudColor: { value: new THREE.Color(1, 1, 1) },
      camPos: { value: new THREE.Vector3() }, cover: { value: 0.56 },
    };
    const cloudGeo = new THREE.PlaneGeometry(1900, 1900, 1, 1);
    cloudGeo.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cloudGeo, new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG, uniforms: this.cloudUniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.skyColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.auroraLevel = 0;
    this.start = performance.now();
  }

  /**
   * @param {number} t time of day 0..1 (0 sunrise, .25 noon, .5 sunset, .75 midnight)
   * @param {boolean} auroraWanted the player is in a snowy biome
   */
  update(t, auroraWanted = false) {
    const seconds = (performance.now() - this.start) / 1000;
    // Sun angle: rises in the east (+x), sets in the west.
    const angle = t * Math.PI * 2;
    const sunDir = this.uniforms.sunDir.value.set(Math.cos(angle), Math.sin(angle), 0.25).normalize();
    this.uniforms.moonDir.value.copy(sunDir).multiplyScalar(-1);
    const height = sunDir.y;
    // Daylight: 1 at day, ~0.28 at night (moonlight), smooth transition around sunrise/sunset.
    const daylight = THREE.MathUtils.clamp(0.28 + (height + 0.15) * 2.2, 0.28, 1);

    const dayAmt = THREE.MathUtils.smoothstep(height, -0.22, 0.3);
    const dusk = Math.max(0, 1 - Math.abs(height + 0.03) * 4.5); // peaks just as the sun touches the horizon
    const U = this.uniforms;
    U.zenith.value.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, dayAmt).lerp(DUSK_ZENITH, dusk * 0.55);
    U.horizon.value.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, dayAmt).lerp(DUSK_HORIZON, dusk * 0.45);
    U.sunset.value = dusk;
    U.night.value = 1 - THREE.MathUtils.smoothstep(height, -0.25, 0.05);
    U.time.value = seconds;
    U.starAngle.value = angle;
    // Fade the aurora in and out over a few seconds when moving between biomes.
    this.auroraLevel += ((auroraWanted ? 1 : 0) - this.auroraLevel) * 0.02;
    U.aurora.value = this.auroraLevel;

    this.dome.position.copy(this.camera.position);

    // Clouds: white by day, warm at sunset, dark blue-grey at night.
    const cu = this.cloudUniforms;
    cu.cloudColor.value.setRGB(0.07, 0.08, 0.12).lerp(new THREE.Color(1, 1, 1), dayAmt).lerp(new THREE.Color(1.0, 0.72, 0.6), dusk * 0.6);
    cu.wind.value.set(seconds * 1.6, seconds * 0.4);
    cu.camPos.value.copy(this.camera.position);
    this.clouds.position.set(this.camera.position.x, CLOUD_HEIGHT, this.camera.position.z);

    // Fog matches the horizon so distant terrain melts into the sky.
    this.skyColor.copy(U.horizon.value);
    this.fogColor.copy(U.horizon.value);
    return { daylight, skyColor: this.skyColor, fogColor: this.fogColor };
  }
}
