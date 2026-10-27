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

const CHUNK_VERT = /* glsl */`
  attribute vec4 aData;
  varying vec2 vUv;
  varying float vLayer;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vDist;
  void main() {
    vUv = uv;
    vLayer = aData.x;
    vSky = aData.y / 15.0;
    vBlock = aData.z / 15.0;
    float ao = mod(aData.w, 4.0);
    float face = floor(aData.w / 4.0 + 0.01);
    // Simple directional shading so cube faces are distinguishable:
    // top brightest, bottom darkest, sides in between.
    float faceShade = face < 1.5 ? 0.8 : face < 2.5 ? 1.0 : face < 3.5 ? 0.55 : face < 5.5 ? 0.68 : 0.9;
    vShade = faceShade * (0.5 + ao * (0.5 / 3.0));
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
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
  varying vec2 vUv;
  varying float vLayer;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying float vDist;
  void main() {
    vec4 tex = texture(atlas, vec3(vUv, vLayer));
    if (cutout > 0.5 && tex.a < 0.5) discard;
    float sky = vSky * daylight;
    float light = max(sky, vBlock);
    // Light levels feel linear to the eye when brightness falls off
    // exponentially (~20% per level), plus a little ambient so caves aren't pitch black.
    float bright = 0.035 + 0.965 * pow(0.8, (1.0 - light) * 15.0);
    // Torch light is warm; sunlight is white.
    vec3 tint = mix(vec3(1.0), vec3(1.0, 0.88, 0.72), clamp((vBlock - sky) * 2.0, 0.0, 1.0));
    vec3 color = tex.rgb * bright * tint * vShade;
    float fog = smoothstep(fogNear, fogFar, vDist);
    color = mix(color, fogColor, fog);
    gl_FragColor = vec4(color, opacity);
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
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 1000);
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
    });
    this.opaqueMaterial = new THREE.ShaderMaterial({ vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms() });
    this.transMaterial = new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms(),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.transMaterial.uniforms.opacity.value = 0.72;
    this.transMaterial.uniforms.cutout.value = 0;

    this.sky = new Sky(this.scene, this.camera);
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
    const far = chunks * 16;
    this.fogFar = Math.max(24, far - 6);
    this.fogNear = this.fogFar * 0.55;
  }

  /** Called every frame with the world time (0..1, 0 = sunrise). */
  updateEnvironment(timeFrac, underwater) {
    const env = this.sky.update(timeFrac);
    let fogColor = env.fogColor, near = this.fogNear, far = this.fogFar;
    if (underwater) { fogColor = new THREE.Color(0x1d3f7a).multiplyScalar(0.4 + env.daylight * 0.6); near = 1; far = 22; }
    for (const m of [this.opaqueMaterial, this.transMaterial]) {
      m.uniforms.daylight.value = env.daylight;
      m.uniforms.fogColor.value.copy(fogColor);
      m.uniforms.fogNear.value = near;
      m.uniforms.fogFar.value = far;
    }
    this.scene.fog.color.copy(fogColor);
    this.scene.fog.near = near; this.scene.fog.far = far;
    this.renderer.setClearColor(underwater ? fogColor : env.skyColor);
    this.ambient.intensity = 0.25 + env.daylight * 0.55;
    this.sun.intensity = 0.2 + env.daylight * 0.7;
    this.daylight = env.daylight;
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

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
