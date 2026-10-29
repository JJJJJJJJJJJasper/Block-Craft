// ============================================================================
// Three.js setup + the custom chunk shader.
//
// Chunk vertices carry a packed attribute `aData` = (texture layer, skylight,
// blocklight, AO+face). The fragment shader turns those into a final colour:
//
//   light = max(skylight * daylight, blocklight)
//
// `daylight` is one uniform updated every frame by the sky, so sunrise and
// sunset never require rebuilding any geometry. Fog is computed per-pixel
// from distance to the camera to hide the edge of the loaded world.
// ============================================================================
import * as THREE from 'three';
import { Sky } from './sky.js';
import { tintPalette } from '../../shared/biomes.js';
import { B } from '../../shared/blocks.js';
import { SEA_LEVEL } from '../../shared/config.js';

const TINTS = tintPalette();

const CHUNK_VERT = /* glsl */`
  attribute vec4 aData;
  attribute float aTint;
  uniform vec3 tints[${TINTS.length}];
  varying vec3 vTint;
  varying vec2 vUv;
  varying float vLayer;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vDist;
  varying vec3 vWorld;
  varying float vWater;
  uniform float time;
  uniform float waterLayer;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    float faceId = floor(aData.w / 4.0 + 0.01);
    // Plants and crops (face code 6) sway at the top; leaves (foliage tint) rustle a little.
    float wave = sin(time * 1.7 + world.x * 0.6 + world.z * 0.45) + 0.5 * sin(time * 2.9 + world.z * 0.9);
    if (faceId > 5.5 && uv.y > 0.5) world.xz += vec2(0.05, 0.035) * wave;
    float tintI = floor(aTint + 0.5);
    if (tintI > 0.5 && mod(tintI, 2.0) < 0.5 && faceId < 5.5) world.xyz += vec3(0.02, 0.012, 0.02) * wave;
    // Water: gentle swells on the surface.
    vWater = abs(aData.x - waterLayer) < 0.5 ? 1.0 : 0.0;
    if (vWater > 0.5 && faceId > 1.5 && faceId < 2.5) world.y += 0.04 * (sin(time * 1.3 + world.x * 0.8) + sin(time * 1.1 + world.z * 0.7)) - 0.04;
    vWorld = world.xyz;
    vTint = tints[int(aTint + 0.5)];
    vLayer = aData.x;
    vSky = aData.y / 15.0;
    vBlock = aData.z / 15.0;
    float ao = mod(aData.w, 4.0);
    float face = floor(aData.w / 4.0 + 0.01);
    // Simple directional shading so cube faces are distinguishable:
    // top brightest, bottom darkest, sides in between.
    float faceShade = face < 1.5 ? 0.8 : face < 2.5 ? 1.0 : face < 3.5 ? 0.55 : face < 5.5 ? 0.68 : 0.9;
    vShade = faceShade * (0.5 + ao * (0.5 / 3.0));
    vec4 mv = viewMatrix * world;
    vDist = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const CHUNK_FRAG = /* glsl */`
  precision highp sampler2DArray;
  uniform sampler2DArray atlas;
  uniform float daylight;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float opacity;
  uniform float cutout;
  uniform vec3 sunTint;     // colour of sunlight now (white at noon, gold at sunset, blue at night)
  uniform vec3 skyReflect;  // what water reflects
  uniform vec3 sunDir;
  uniform float time;
  uniform vec3 mistColor;
  uniform float mistAmount;
  uniform float seaLevel;
  varying vec3 vWorld;
  varying float vWater;
  varying vec3 vTint;
  varying vec2 vUv;
  varying float vLayer;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vDist;
  void main() {
    vec4 tex = texture(atlas, vec3(vUv, vLayer));
    if (cutout > 0.5 && tex.a < 0.5) discard;
    // Pixels painted with alpha ~0.9 are biome-tinted (grass, leaves, ferns).
    float tintMask = 1.0 - smoothstep(0.93, 0.97, tex.a);
    tex.rgb *= mix(vec3(1.0), vTint, tintMask);
    float sky = vSky * daylight;
    float light = max(sky, vBlock);
    // Light levels feel linear to the eye when brightness falls off
    // exponentially (~20% per level), plus a little ambient so caves aren't pitch black.
    float bright = 0.07 + 0.93 * pow(0.8, (1.0 - light) * 15.0);
    // Torch light is warm; sunlight is white.
    vec3 tint = mix(sunTint, vec3(1.0, 0.88, 0.72), clamp((vBlock - sky) * 2.0, 0.0, 1.0));
    vec3 color = tex.rgb * bright * tint * vShade;
    float alpha = cutout > 0.5 ? opacity : opacity * max(tex.a, 0.35);
    if (vWater > 0.5) {
      // Water reflects the sky more at grazing angles (Fresnel), with a moving
      // ripple pattern and a bright glint where the sun reflects.
      vec3 view = normalize(vWorld - cameraPosition);
      float ripple = sin(vWorld.x * 2.1 + time * 1.6) * sin(vWorld.z * 1.7 - time * 1.3) * 0.08;
      vec3 n = normalize(vec3(ripple, 1.0, ripple * 0.7));
      float fres = 0.15 + 0.75 * pow(1.0 - abs(dot(view, n)), 3.0);
      color = mix(color, skyReflect * (0.35 + 0.65 * vSky), fres * smoothstep(0.3, 0.8, vSky));
      vec3 refl = reflect(view, n);
      float glint = pow(max(dot(refl, sunDir), 0.0), 220.0) * vSky * daylight;
      color += sunTint * glint * 1.4;
      alpha = mix(alpha, 0.92, fres * 0.6) + glint;
    }
    // Distance haze: things far away fade softly into the blue air (instead of a
    // fog wall at the edge of the render distance), and white mist lies in the
    // low valleys. fogNear/fogFar only matter underwater.
    float fog = max(smoothstep(fogNear, fogFar, vDist), (1.0 - exp(-vDist * 0.0016)) * 0.85);
    color = mix(color, fogColor, fog);
    float mist = exp(-max(vWorld.y - seaLevel - 6.0, 0.0) / 22.0) * smoothstep(140.0, 500.0, vDist);
    color = mix(color, mistColor, mist * mistAmount);
    // translucent blocks (water, stained glass) also use the texture's own alpha
    gl_FragColor = vec4(color, min(alpha, 1.0));
  }
`;

// Treat every colour as already display-ready (sRGB in, sRGB out). Our custom
// shader writes colours directly, so Three's linear-space conversions would
// only make fog and clear colours disagree.
THREE.ColorManagement.enabled = false;

export class Renderer {
  constructor(container, textures) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    // Rendering at native pixel density on a hi-DPI Chromebook screen costs a
    // lot of fill-rate; 1.0 is a good default for integrated GPUs.
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.scene.fog = new THREE.Fog(0x9ec4ff, 50, 100);

    // Lights only affect entity models (players, mobs). Chunks use the custom shader.
    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.8);
    this.sun.position.set(0.3, 1, 0.5);
    this.scene.add(this.ambient, this.sun);

    // Texture array with every block texture as a layer.
    const tex = new THREE.DataArrayTexture(textures.data, textures.size, textures.size, textures.layerCount);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter; // mipmaps reduce far-away shimmer
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;    // lets merged quads tile the texture
    tex.needsUpdate = true;
    this.atlas = tex;

    const uniforms = () => ({
      atlas: { value: tex },
      daylight: { value: 1 },
      fogColor: { value: new THREE.Color(0x9ec4ff) },
      fogNear: { value: 50 },
      fogFar: { value: 100 },
      opacity: { value: 1 },
      cutout: { value: 1 },
      tints: { value: TINTS.map(([r, g, b]) => new THREE.Vector3(r, g, b)) },
      time: { value: 0 },
      waterLayer: { value: textures.faceLayers[B.WATER * 6 + 2] },
      sunTint: { value: new THREE.Color(1, 1, 1) },
      skyReflect: { value: new THREE.Color(0.6, 0.75, 0.95) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      mistColor: { value: new THREE.Color(0.9, 0.92, 0.95) },
      mistAmount: { value: 0.75 },
      seaLevel: { value: SEA_LEVEL },
    });
    this.opaqueMaterial = new THREE.ShaderMaterial({ vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms() });
    this.transMaterial = new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms(),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.transMaterial.uniforms.opacity.value = 0.72;
    this.transMaterial.uniforms.cutout.value = 0;

    this.sky = new Sky(this.scene, this.camera);
    this.fancy = true;
    this._createPost();
    this._createHighlight(textures);

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setFov(fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

  setRenderDistance(chunks) {
    // No fog wall any more: distant chunks fade with the haze and the far
    // terrain carries on behind them. (Underwater fog is set separately.)
    this.renderDistance = chunks;
    this.fogNear = 4000;
    this.fogFar = 5000;
  }

  /**
   * Called every frame.
   * @param {number} timeFrac world time 0..1 (0 = sunrise)
   * @param {string|null} submerged 'water', 'lava' or null: what the camera is inside
   * @param {boolean} aurora show the aurora (snowy biome)
   */
  updateEnvironment(timeFrac, submerged, aurora = false) {
    const env = this.sky.update(timeFrac, aurora);
    let fogColor = env.fogColor, near = this.fogNear, far = this.fogFar;
    const underwater = !!submerged;
    if (submerged === 'water') { fogColor = new THREE.Color(0x1d3f7a).multiplyScalar(0.4 + env.daylight * 0.6); near = 1; far = 22; }
    if (submerged === 'lava') { fogColor = new THREE.Color(0xc84a10); near = 0.2; far = 2.5; }
    // Sunlight colour: golden low in the sky, cool and dim at night.
    const sunY = this.sky.uniforms.sunDir.value.y;
    const gold = Math.max(0, 1 - Math.abs(sunY - 0.08) * 4);
    const night = 1 - THREE.MathUtils.smoothstep(sunY, -0.2, 0.05);
    this.sunTint.setRGB(1, 1, 1).lerp(new THREE.Color(1.0, 0.78, 0.55), gold * 0.7).lerp(new THREE.Color(0.7, 0.8, 1.0), night * 0.8);
    const t = performance.now() / 1000;
    for (const m of [this.opaqueMaterial, this.transMaterial]) {
      m.uniforms.time.value = t;
      m.uniforms.sunTint.value.copy(this.sunTint);
      m.uniforms.skyReflect.value.copy(this.sky.uniforms.horizon.value).lerp(this.sky.uniforms.zenith.value, 0.35);
      m.uniforms.sunDir.value.copy(sunY > -0.1 ? this.sky.uniforms.sunDir.value : this.sky.uniforms.moonDir.value);
      m.uniforms.daylight.value = env.daylight;
      m.uniforms.fogColor.value.copy(fogColor);
      m.uniforms.fogNear.value = near;
      m.uniforms.fogFar.value = far;
    }
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = near; this.scene.fog.far = far;
    this.renderer.setClearColor(underwater ? fogColor : env.skyColor);
    this.sky.dome.visible = this.sky.clouds.visible = !underwater;
    // Three.js lights are physically scaled: a matte (Lambert) surface needs
    // intensity ~PI to show its full colour. Mobs and players use these lights.
    this.ambient.intensity = Math.PI * (0.25 + env.daylight * 0.5);
    this.sun.intensity = Math.PI * (0.1 + env.daylight * 0.35);
    this.daylight = env.daylight;
    this.underwater = underwater;
    // Mist is white by day, golden at sunrise/sunset, a dim blue at night.
    const mist = this.mistColor || (this.mistColor = new THREE.Color());
    mist.copy(env.fogColor).lerp(new THREE.Color(1, 1, 1), 0.45).lerp(new THREE.Color(1.0, 0.82, 0.6), gold * 0.45);
    for (const m of [this.opaqueMaterial, this.transMaterial]) {
      m.uniforms.mistColor.value.copy(mist);
      m.uniforms.mistAmount.value = underwater ? 0 : 0.55;
    }
    this.farEnv = { daylight: env.daylight, sunDir: this.opaqueMaterial.uniforms.sunDir.value, sunTint: this.sunTint, haze: fogColor, mist };
  }

  // ---- Block selection outline and crack overlay ----------------------------
  _createHighlight(textures) {
    const box = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const edges = new THREE.EdgesGeometry(box);
    this.outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.crackTextures = textures.cracks.map(data => {
      const t = new THREE.DataTexture(new Uint8Array(data), 16, 16, THREE.RGBAFormat);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.needsUpdate = true;
      return t;
    });
    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMaterial);
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  setHighlight(hit) {
    if (!hit) { this.outline.visible = false; return; }
    this.outline.visible = true;
    this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  setCrack(hit, progress) {
    if (!hit || progress <= 0) { this.crack.visible = false; return; }
    const stage = Math.min(9, Math.floor(progress * 10));
    this.crackMaterial.map = this.crackTextures[stage];
    this.crack.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.crack.visible = true;
  }

  // ---- Chunk meshes --------------------------------------------------------
  /** Build a Three.js mesh from worker output, or null if the part is empty. */
  createChunkMesh(part, transparent, cx, cz) {
    if (!part.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(part.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(part.uv, 2));
    g.setAttribute('aData', new THREE.BufferAttribute(part.data, 4));
    g.setAttribute('aTint', new THREE.BufferAttribute(part.tint, 1));
    g.setIndex(new THREE.BufferAttribute(part.idx, 1));
    g.computeBoundingSphere(); // enables Three's per-mesh frustum culling
    const mesh = new THREE.Mesh(g, transparent ? this.transMaterial : this.opaqueMaterial);
    mesh.position.set(cx * 16, 0, cz * 16);
    mesh.matrixAutoUpdate = false;  // chunks never move; skip per-frame matrix work
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  removeMesh(mesh) {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
  }

  // ---- "Fancy graphics": a full-screen pass over the finished picture ----------------
  // The world is drawn into a texture first, then one shader adds:
  //   - light shafts ("god rays"): from each pixel we step toward the sun on screen
  //     and count how much open sky we pass; trees and mountains block it, so
  //     beams of light stream out between them,
  //   - colour grading: a touch more contrast and colour, warmer at golden hour,
  //   - a soft vignette darkening the corners.
  _createPost() {
    this.sunTint = new THREE.Color(1, 1, 1);
    this.rt = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.postUniforms = {
      tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture },
      sunPos: { value: new THREE.Vector2(0.5, 0.5) }, rayStrength: { value: 0 }, rayColor: { value: new THREE.Color(1, 0.9, 0.7) },
      warmth: { value: 0 }, aspect: { value: 1 },
    };
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.postUniforms, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 sunPos;
        uniform float rayStrength;
        uniform vec3 rayColor;
        uniform float warmth;
        uniform float aspect;
        varying vec2 vUv;
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          if (rayStrength > 0.001) {
            vec2 delta = (sunPos - vUv) / 22.0;
            vec2 p = vUv;
            float sum = 0.0, w = 1.0;
            for (int i = 0; i < 22; i++) {
              p += delta;
              float sky = step(0.99999, texture2D(tDepth, p).r);
              sum += sky * w;
              w *= 0.95;
            }
            vec2 d = (vUv - sunPos) * vec2(aspect, 1.0);
            float falloff = 1.0 / (1.0 + dot(d, d) * 9.0);
            col += rayColor * (sum / 14.0) * falloff * rayStrength;
          }
          // grading: contrast + saturation, warmer at golden hour
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(lum), col, 1.12);
          col = (col - 0.5) * 1.06 + 0.5;
          col *= mix(vec3(1.0), vec3(1.06, 1.0, 0.9), warmth);
          vec2 c = vUv - 0.5;
          col *= 1.0 - dot(c, c) * 0.55;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    })));
  }

  setFancy(on) { this.fancy = on; }

  render() {
    const r = this.renderer;
    if (!this.fancy) { r.setRenderTarget(null); r.render(this.scene, this.camera); return; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (this.rt.width !== size.x || this.rt.height !== size.y) this.rt.setSize(size.x, size.y);
    r.setRenderTarget(this.rt);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    // Where is the sun (or moon) on screen, and how bright should its beams be?
    const U = this.postUniforms, sky = this.sky.uniforms;
    const sunUp = sky.sunDir.value.y > -0.05;
    const dir = sunUp ? sky.sunDir.value : sky.moonDir.value;
    const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd);
    const facing = THREE.MathUtils.smoothstep(fwd.dot(dir), 0.1, 0.6);
    const p = dir.clone().multiplyScalar(500).add(this.camera.position).project(this.camera);
    U.sunPos.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const height = THREE.MathUtils.smoothstep(dir.y, -0.05, 0.12);
    U.rayStrength.value = this.underwater ? 0 : facing * height * (sunUp ? 0.55 : 0.12);
    U.rayColor.value.copy(sunUp ? this.sunTint : new THREE.Color(0.6, 0.7, 1.0));
    U.warmth.value = sunUp ? Math.max(0, 1 - Math.abs(sky.sunDir.value.y - 0.08) * 4) : 0;
    U.aspect.value = size.x / size.y;
    r.render(this.postScene, this.postCam);
  }
}
