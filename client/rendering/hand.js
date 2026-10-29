// ============================================================================
// First-person hand: the item you're holding (or your bare arm) in the lower
// right of the screen. It lives in its own tiny scene with its own camera and
// is drawn after the world with the depth buffer cleared, so it never pokes
// into walls. It bobs while you walk and swings when you mine or place.
// ============================================================================
import * as THREE from 'three';

export class HandView {
  constructor(itemModels, skinColor) {
    this.models = itemModels;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.6);
    this.sun.position.set(-0.4, 1, 0.6);
    this.scene.add(this.ambient, this.sun, this.camera);
    this.holder = new THREE.Group();     // moved by bob/swing
    this.scene.add(this.holder);
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.75), new THREE.MeshLambertMaterial({ color: skinColor }));
    this.itemId = -1;
    this.model = null;
    this.swing = 0;       // 0..1 progress of the current swing
    this.bobPhase = 0;
    this.equipDrop = 0;   // item dips down briefly when you switch to it
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  setItem(id) {
    if (id === this.itemId) return;
    this.itemId = id;
    if (this.model) this.holder.remove(this.model);
    this.equipDrop = 1;
    if (!id) {
      this.model = this.arm;
      this.arm.position.set(0, 0, 0);
      this.arm.rotation.set(0.15, -0.35, 0.1);
    } else if (this.models.isCube(id)) {
      this.model = this.models.create(id);
      this.model.scale.setScalar(0.34);
      this.model.position.set(0, 0, 0);
      this.model.rotation.set(0.15, Math.PI / 4, 0);
    } else {
      this.model = this.models.create(id);
      this.model.scale.setScalar(0.62);
      // flat items are turned mostly toward you and tilted, tip pointing up-left
      this.model.position.set(-0.02, 0.08, 0);
      this.model.rotation.set(0, -0.55, 0.25);
    }
    this.holder.add(this.model);
  }

  /** Start a swing (mining, placing, attacking). */
  doSwing() { if (this.swing <= 0 || this.swing > 0.6) this.swing = 1; }

  /**
   * @param {number} dt seconds
   * @param {number} speed horizontal speed of the player (for bobbing)
   * @param {number} brightness 0..1 light where the player stands
   */
  update(dt, speed, onGround, brightness) {
    if (onGround && speed > 0.5) this.bobPhase += dt * Math.min(speed, 6) * 1.9;
    const bob = onGround ? Math.min(speed, 6) / 6 : 0;
    const bx = Math.sin(this.bobPhase) * 0.03 * bob;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.03 * bob;
    this.equipDrop = Math.max(0, this.equipDrop - dt * 5);
    let swingRot = 0, swingY = 0, swingZ = 0;
    if (this.swing > 0) {
      this.swing = Math.max(0, this.swing - dt * 4.5);
      const t = 1 - this.swing;              // 0 -> 1 over the swing
      const arc = Math.sin(t * Math.PI);
      swingRot = -arc * 0.9; swingY = arc * 0.05; swingZ = -arc * 0.12;
    }
    const isArm = this.itemId === 0;
    this.holder.position.set(0.52 + bx, -0.48 + by - this.equipDrop * 0.4 + swingY, -0.75 + swingZ + (isArm ? 0.1 : 0));
    this.holder.rotation.set(swingRot, 0, 0);
    const light = Math.max(0.15, brightness);
    // (x PI: Three.js lights are physically scaled, see renderer.js)
    this.ambient.intensity = Math.PI * (0.25 + 0.55 * light);
    this.sun.intensity = Math.PI * 0.3 * light;
  }

  /** Draw on top of the world (call after the world has been rendered). */
  render(renderer) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}
