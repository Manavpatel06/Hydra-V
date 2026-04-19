import * as THREE from "../../../node_modules/three/build/three.module.js";
import { clamp } from "../../core/utils.js";

const SECTION_TARGETS = {
  foundation: 9,
  walls: 16,
  roof: 9,
  peak: 1
};

const SECTION_ORDER = ["foundation", "walls", "roof", "peak"];
const TOTAL_BLOCKS = SECTION_ORDER.reduce((sum, key) => sum + SECTION_TARGETS[key], 0);

function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - ((1 - x) ** 3);
}

function ringCoords(radius) {
  const coords = [];
  for (let x = -radius; x <= radius; x += 1) {
    for (let z = -radius; z <= radius; z += 1) {
      if (Math.abs(x) === radius || Math.abs(z) === radius) {
        coords.push([x, z]);
      }
    }
  }
  return coords;
}

function actionPalette(actionId = "", section = "foundation") {
  const id = String(actionId || "").toLowerCase();

  if (id.includes("squat") || id.includes("hinge")) {
    return {
      foundation: "#c79b5a",
      walls: "#bf8444",
      roof: "#6ea4de",
      peak: "#ffd978"
    }[section];
  }

  if (id.includes("raise") || id.includes("reach") || id.includes("drive")) {
    return {
      foundation: "#a78f5f",
      walls: "#c08f6a",
      roof: "#6bb3cc",
      peak: "#f3e489"
    }[section];
  }

  if (id.includes("march") || id.includes("step") || id.includes("extension")) {
    return {
      foundation: "#af8a58",
      walls: "#d37b5a",
      roof: "#63a7d4",
      peak: "#ffd884"
    }[section];
  }

  return {
    foundation: "#b58d58",
    walls: "#ce7f56",
    roof: "#679dcf",
    peak: "#f4d974"
  }[section];
}

export class VirtualRecoveryWorld {
  constructor({ canvasEl }) {
    this.canvas = canvasEl;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cameraFrustum = 7.5;

    this.ambientLight = null;
    this.keyLight = null;
    this.fillLight = null;

    this.platformGroup = null;
    this.buildGroup = null;
    this.blockQueue = [];
    this.sectionBlocks = {
      foundation: [],
      walls: [],
      roof: [],
      peak: []
    };
    this.sectionPlaced = {
      foundation: 0,
      walls: 0,
      roof: 0,
      peak: 0
    };

    this.sparkles = null;

    this.running = false;
    this.rafId = null;
    this.lastTime = performance.now();

    this.progress = 0;
    this.matchScore = 0;
    this.vitalsScore = 0;
    this.motionSync = 0;

    this.totalBlocks = TOTAL_BLOCKS;
    this.placedCount = 0;
    this.repDrivenPlacements = 0;
    this.lastRepCount = 0;
    this.lastActionsCompleted = 0;
    this.lastSeenActionId = null;
    this.zoneTint = "#4ce6d1";

    this.initialized = false;
  }

  start(context = {}) {
    if (!this.initialized) {
      this.initialize();
    }

    this.running = true;
    this.canvas.classList.remove("hidden");
    this.resetWorld(context);
    this.lastTime = performance.now();
    this.animate();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  resize() {
    if (!this.renderer || !this.camera || !this.canvas) {
      return;
    }

    const width = this.canvas.clientWidth || this.canvas.width || 960;
    const height = this.canvas.clientHeight || this.canvas.height || 540;

    this.renderer.setSize(width, height, false);
    const aspect = width / Math.max(height, 1);
    this.camera.left = -this.cameraFrustum * aspect;
    this.camera.right = this.cameraFrustum * aspect;
    this.camera.top = this.cameraFrustum;
    this.camera.bottom = -this.cameraFrustum;
    this.camera.updateProjectionMatrix();
  }

  update(payload = {}) {
    this.progress = clamp(Number(payload.score || this.progress || 0), 0, 100);
    this.matchScore = clamp(Number(payload.movementMatchScore || this.matchScore || 0), 0, 100);
    this.vitalsScore = clamp(Number(payload.vitalsScore || this.vitalsScore || 0), 0, 100);
    this.motionSync = clamp(Number(payload.motionSyncScore || this.motionSync || 0), 0, 100);

    const repsDone = Number(payload.repsDone || 0);
    const actionsCompleted = Number(payload.actionsCompleted || 0);

    if (actionsCompleted > this.lastActionsCompleted) {
      this.repDrivenPlacements += actionsCompleted - this.lastActionsCompleted;
      this.lastActionsCompleted = actionsCompleted;
    }

    if (repsDone > this.lastRepCount) {
      this.repDrivenPlacements += repsDone - this.lastRepCount;
      this.lastRepCount = repsDone;
    }

    if (typeof payload.actionId === "string" && payload.actionId) {
      this.lastSeenActionId = payload.actionId;
    }

    const scoreDrivenTarget = Math.round((this.progress / 100) * this.totalBlocks);
    const target = clamp(Math.max(scoreDrivenTarget, this.repDrivenPlacements), 0, this.totalBlocks);
    this.setPlacedCount(target, this.lastSeenActionId);
    this.updateLighting();
  }

  getBuildStats() {
    return {
      totalPlaced: this.placedCount,
      totalTarget: this.totalBlocks,
      ...this.sectionPlaced,
      targets: { ...SECTION_TARGETS }
    };
  }

  initialize() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#041327");
    this.scene.fog = new THREE.Fog("#041327", 11, 40);

    this.camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 80);
    this.camera.position.set(9.6, 8.4, 9.4);
    this.camera.lookAt(0, 0.9, 0);

    this.ambientLight = new THREE.AmbientLight("#8dd8ff", 0.74);
    this.keyLight = new THREE.DirectionalLight("#ffffff", 1.1);
    this.keyLight.position.set(7, 11, 4);
    this.fillLight = new THREE.DirectionalLight("#4bc7ff", 0.44);
    this.fillLight.position.set(-6, 7, -7);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight);

    this.platformGroup = new THREE.Group();
    this.buildGroup = new THREE.Group();
    this.scene.add(this.platformGroup, this.buildGroup);

    this.buildIsometricPlatform();
    this.buildStructureBlocks();
    this.buildSparkles();

    this.initialized = true;
    this.resize();
  }

  buildIsometricPlatform() {
    const tileGeom = new THREE.BoxGeometry(0.94, 0.24, 0.94);

    for (let gx = -3; gx <= 3; gx += 1) {
      for (let gz = -3; gz <= 3; gz += 1) {
        const distance = Math.sqrt(gx * gx + gz * gz);
        const edgeFade = clamp(1 - distance / 5.2, 0, 1);
        const color = new THREE.Color().setHSL(0.29, 0.33, 0.2 + edgeFade * 0.14);
        const emissive = new THREE.Color().setHSL(0.33, 0.44, 0.06 + edgeFade * 0.04);

        const tile = new THREE.Mesh(
          tileGeom,
          new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: 0.85,
            roughness: 0.72,
            metalness: 0.08
          })
        );

        tile.position.set(gx, 0, gz);
        this.platformGroup.add(tile);
      }
    }

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(2.3, 40),
      new THREE.MeshBasicMaterial({
        color: "#0f4568",
        transparent: true,
        opacity: 0.32
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.13, 0);
    this.platformGroup.add(water);
  }

  buildStructureBlocks() {
    this.blockQueue = [];
    this.sectionBlocks = {
      foundation: [],
      walls: [],
      roof: [],
      peak: []
    };

    const blockGeom = new THREE.BoxGeometry(0.84, 0.38, 0.84);

    const addBlock = (section, x, y, z, sortBias = 0) => {
      const baseColor = actionPalette("", section);
      const mesh = new THREE.Mesh(
        blockGeom,
        new THREE.MeshStandardMaterial({
          color: baseColor,
          emissive: "#2b1e12",
          emissiveIntensity: 0.16,
          roughness: 0.4,
          metalness: 0.12
        })
      );

      mesh.visible = false;
      mesh.position.set(x, y, z);
      mesh.userData = {
        section,
        targetY: y,
        rise: 0,
        bornAt: 0,
        sortBias
      };

      this.buildGroup.add(mesh);
      this.sectionBlocks[section].push(mesh);
      this.blockQueue.push(mesh);
    };

    for (let x = -1; x <= 1; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        addBlock("foundation", x, 0.33, z, 0);
      }
    }

    const wallCoords = ringCoords(2);
    wallCoords.forEach(([x, z], idx) => {
      addBlock("walls", x * 0.95, 0.73, z * 0.95, idx * 0.001);
    });

    for (let x = -1; x <= 1; x += 1) {
      for (let z = -1; z <= 1; z += 1) {
        addBlock("roof", x * 0.95, 1.13, z * 0.95, 0);
      }
    }

    addBlock("peak", 0, 1.53, 0, 0);

    this.blockQueue.sort((a, b) => {
      const sectionDelta = SECTION_ORDER.indexOf(a.userData.section) - SECTION_ORDER.indexOf(b.userData.section);
      if (sectionDelta !== 0) {
        return sectionDelta;
      }
      return (a.userData.targetY + a.userData.sortBias) - (b.userData.targetY + b.userData.sortBias);
    });
  }

  buildSparkles() {
    const positions = [];
    for (let i = 0; i < 240; i += 1) {
      positions.push((Math.random() - 0.5) * 34, Math.random() * 11 + 0.4, (Math.random() - 0.5) * 34);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: "#9edfff",
      size: 0.08,
      transparent: true,
      opacity: 0.56
    });

    this.sparkles = new THREE.Points(geo, mat);
    this.scene.add(this.sparkles);
  }

  resetWorld(context = {}) {
    this.progress = 0;
    this.matchScore = 0;
    this.vitalsScore = 0;
    this.motionSync = 0;
    this.placedCount = 0;
    this.repDrivenPlacements = 0;
    this.lastRepCount = 0;
    this.lastActionsCompleted = 0;
    this.lastSeenActionId = null;

    this.sectionPlaced = {
      foundation: 0,
      walls: 0,
      roof: 0,
      peak: 0
    };

    this.blockQueue.forEach((mesh) => {
      mesh.visible = false;
      mesh.position.y = mesh.userData.targetY;
      mesh.scale.set(1, 1, 1);
      mesh.userData.rise = 0;
      mesh.userData.bornAt = 0;
    });

    if (context.zone === "knee") {
      this.zoneTint = "#73d8ff";
    } else if (context.zone === "hip") {
      this.zoneTint = "#65f2b8";
    } else {
      this.zoneTint = "#ffd08a";
    }

    this.updateLighting();
  }

  setPlacedCount(targetCount, actionId = null) {
    const target = clamp(Math.round(targetCount), 0, this.totalBlocks);

    while (this.placedCount < target) {
      this.placeNextBlock(actionId);
    }

    while (this.placedCount > target) {
      this.removeLastBlock();
    }
  }

  placeNextBlock(actionId = null) {
    const mesh = this.blockQueue[this.placedCount];
    if (!mesh) {
      return;
    }

    const { section, targetY } = mesh.userData;
    const color = actionPalette(actionId, section);

    mesh.material.color.set(color);
    mesh.material.emissive.set(section === "roof" || section === "peak" ? "#235e8a" : "#6a3a1e");
    mesh.material.emissiveIntensity = section === "peak" ? 0.58 : 0.26;

    mesh.visible = true;
    mesh.position.y = targetY - 1.15;
    mesh.scale.set(1, 0.08, 1);
    mesh.userData.rise = 1;
    mesh.userData.bornAt = performance.now();

    this.placedCount += 1;
    this.sectionPlaced[section] += 1;
  }

  removeLastBlock() {
    if (this.placedCount <= 0) {
      return;
    }

    const index = this.placedCount - 1;
    const mesh = this.blockQueue[index];
    if (!mesh) {
      return;
    }

    mesh.visible = false;
    mesh.userData.rise = 0;
    mesh.position.y = mesh.userData.targetY;
    mesh.scale.set(1, 1, 1);

    this.placedCount = index;
    this.sectionPlaced[mesh.userData.section] = Math.max(this.sectionPlaced[mesh.userData.section] - 1, 0);
  }

  updateLighting() {
    const vital = this.vitalsScore / 100;
    const match = this.matchScore / 100;
    const sync = this.motionSync / 100;
    const blend = clamp(vital * 0.4 + match * 0.36 + sync * 0.24, 0, 1);

    if (this.ambientLight) {
      this.ambientLight.intensity = 0.55 + blend * 0.55;
      this.ambientLight.color.setHSL(0.54 - blend * 0.08, 0.5, 0.54);
    }

    if (this.keyLight) {
      this.keyLight.intensity = 0.95 + blend * 0.45;
    }

    if (this.fillLight) {
      this.fillLight.intensity = 0.26 + blend * 0.44;
      this.fillLight.color.set(this.zoneTint);
    }
  }

  animate = () => {
    if (!this.running) {
      return;
    }

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.06);
    this.lastTime = now;
    const t = now * 0.001;

    for (const mesh of this.blockQueue) {
      if (!mesh.visible) {
        continue;
      }

      if (mesh.userData.rise > 0) {
        mesh.userData.rise = Math.max(mesh.userData.rise - dt * 2.2, 0);
        const eased = easeOutCubic(1 - mesh.userData.rise);
        mesh.position.y = THREE.MathUtils.lerp(mesh.userData.targetY - 1.15, mesh.userData.targetY, eased);
        mesh.scale.y = THREE.MathUtils.lerp(0.08, 1, eased);
      }

      const lifeSec = (now - mesh.userData.bornAt) / 1000;
      const pulse = 0.08 + Math.max(0, 1.2 - lifeSec) * 0.28;
      mesh.material.emissiveIntensity = clamp((mesh.material.emissiveIntensity * 0.95) + pulse * 0.05, 0.1, 0.64);
    }

    if (this.platformGroup) {
      this.platformGroup.rotation.y = Math.sin(t * 0.2) * 0.03;
    }

    if (this.sparkles) {
      this.sparkles.rotation.y += dt * 0.03;
      this.sparkles.position.y = Math.sin(t * 0.35) * 0.1;
      this.sparkles.material.opacity = 0.45 + Math.sin(t * 0.8) * 0.08;
    }

    const drift = Math.sin(t * 0.22) * 0.18;
    this.camera.position.x = 9.6 + drift;
    this.camera.position.z = 9.4 + Math.cos(t * 0.22) * 0.12;
    this.camera.lookAt(0, 0.92, 0);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.animate);
  };
}
