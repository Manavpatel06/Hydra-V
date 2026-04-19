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
const STORY_CHAPTERS = Object.freeze([
  {
    id: "awakening",
    threshold: 0,
    title: "Awakening",
    line: "The recovery world is quiet. Clean reps will wake the first structures."
  },
  {
    id: "foundation",
    threshold: 9,
    title: "Foundation Rising",
    line: "The base is stabilizing. Strong form is turning motion into structure."
  },
  {
    id: "walls",
    threshold: 25,
    title: "Walls of Control",
    line: "Walls are going up. Consistent reps are protecting the recovery zone."
  },
  {
    id: "roof",
    threshold: 34,
    title: "Recovery Shelter",
    line: "The roof is closing in. Precision and pacing are locking in gains."
  },
  {
    id: "beacon",
    threshold: 35,
    title: "Beacon Online",
    line: "The beacon is lit. The world is synchronized with the session."
  }
]);

function easeOutCubic(t) {
  const x = clamp(t, 0, 1);
  return 1 - ((1 - x) ** 3);
}

function lerp(current, target, alpha = 0.12) {
  return current + (target - current) * alpha;
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

function actionAccent(actionId = "") {
  const id = String(actionId || "").toLowerCase();
  if (id.includes("squat") || id.includes("hinge")) {
    return "#ffbf73";
  }
  if (id.includes("raise") || id.includes("cross") || id.includes("drive")) {
    return "#5de3ff";
  }
  if (id.includes("march") || id.includes("step") || id.includes("extension")) {
    return "#72ffc0";
  }
  return "#7be6ff";
}

function zoneTint(zone = "shoulder") {
  if (zone === "knee") {
    return "#73d8ff";
  }
  if (zone === "hip") {
    return "#65f2b8";
  }
  return "#ffd08a";
}

export class VirtualRecoveryWorld {
  constructor({ canvasEl }) {
    this.canvas = canvasEl;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.cameraFrustum = 7.3;

    this.ambientLight = null;
    this.keyLight = null;
    this.fillLight = null;
    this.beaconLight = null;

    this.platformGroup = null;
    this.buildGroup = null;
    this.worldProps = null;
    this.heroRoot = null;
    this.hero = {};
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

    this.targetRing = null;
    this.recoveryPads = [];
    this.orbitOrbs = [];
    this.beaconCore = null;
    this.energyColumn = null;
    this.sparkles = null;

    this.running = false;
    this.rafId = null;
    this.lastTime = performance.now();
    this.targetFrameMs = 1000 / 30;

    this.progress = 0;
    this.matchScore = 0;
    this.vitalsScore = 0;
    this.motionSync = 0;
    this.trackingConfidence = 0;
    this.requiredMatch = 65;
    this.requiredTracking = 42;

    this.totalBlocks = TOTAL_BLOCKS;
    this.placedCount = 0;
    this.repDrivenPlacements = 0;
    this.lastRepCount = 0;
    this.lastActionsCompleted = 0;
    this.currentRepTarget = 0;
    this.currentActionId = null;
    this.currentActionLabel = null;
    this.zone = "shoulder";
    this.side = "left";
    this.zoneColor = zoneTint(this.zone);
    this.actionEnergy = 0;
    this.repBurst = 0;
    this.actionSwitchPulse = 0;
    this.storyChapter = STORY_CHAPTERS[0];

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
    this.trackingConfidence = clamp(Number(payload.trackingConfidence || this.trackingConfidence || 0), 0, 100);
    this.requiredMatch = Number(payload.requiredMatchScore || this.requiredMatch || 65);
    this.requiredTracking = Number(payload.requiredTrackingScore || this.requiredTracking || 42);

    const repsDone = Number(payload.repsDone || 0);
    const actionsCompleted = Number(payload.actionsCompleted || 0);
    this.currentRepTarget = Number(payload.repsTarget || this.currentRepTarget || 0);

    if (actionsCompleted > this.lastActionsCompleted) {
      this.repDrivenPlacements += actionsCompleted - this.lastActionsCompleted;
      this.repBurst = 1;
      this.lastActionsCompleted = actionsCompleted;
    }

    if (repsDone > this.lastRepCount) {
      this.repDrivenPlacements += repsDone - this.lastRepCount;
      this.repBurst = 1;
      this.lastRepCount = repsDone;
    }

    if (typeof payload.actionId === "string" && payload.actionId && payload.actionId !== this.currentActionId) {
      this.currentActionId = payload.actionId;
      this.actionSwitchPulse = 1;
    } else if (typeof payload.actionId === "string" && payload.actionId) {
      this.currentActionId = payload.actionId;
    }
    if (typeof payload.actionLabel === "string" && payload.actionLabel) {
      this.currentActionLabel = payload.actionLabel;
    }

    const qualityBlend = (
      this.matchScore * 0.42
      + this.trackingConfidence * 0.18
      + this.motionSync * 0.2
      + this.vitalsScore * 0.2
    ) / 100;
    this.actionEnergy = clamp(qualityBlend, 0, 1);

    const scoreDrivenTarget = Math.round((this.progress / 100) * this.totalBlocks);
    const target = clamp(Math.max(scoreDrivenTarget, this.repDrivenPlacements), 0, this.totalBlocks);
    this.setPlacedCount(target, this.currentActionId);
    this.storyChapter = this.resolveStoryChapter(this.placedCount);
    this.updateLighting();
  }

  getBuildStats() {
    return {
      totalPlaced: this.placedCount,
      totalTarget: this.totalBlocks,
      ...this.sectionPlaced,
      targets: { ...SECTION_TARGETS },
      story: {
        id: this.storyChapter.id,
        title: this.storyChapter.title,
        line: this.storyChapter.line
      },
      activeActionId: this.currentActionId
    };
  }

  initialize() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog("#041327", 11, 36);

    this.camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 80);
    this.camera.position.set(9.6, 8.2, 9.2);
    this.camera.lookAt(0, 1.1, 0);

    this.ambientLight = new THREE.AmbientLight("#8dd8ff", 0.72);
    this.keyLight = new THREE.DirectionalLight("#ffffff", 1.1);
    this.keyLight.position.set(7, 11, 4);
    this.fillLight = new THREE.DirectionalLight("#4bc7ff", 0.44);
    this.fillLight.position.set(-6, 7, -7);
    this.beaconLight = new THREE.PointLight("#74e7ff", 0.6, 13, 1.9);
    this.beaconLight.position.set(0, 2.7, 2.5);
    this.scene.add(this.ambientLight, this.keyLight, this.fillLight, this.beaconLight);

    this.platformGroup = new THREE.Group();
    this.buildGroup = new THREE.Group();
    this.worldProps = new THREE.Group();
    this.scene.add(this.platformGroup, this.buildGroup, this.worldProps);

    this.buildIsometricPlatform();
    this.buildStructureBlocks();
    this.buildRecoveryProps();
    this.buildHeroRig();
    this.buildSparkles();

    this.initialized = true;
    this.resize();
  }

  buildIsometricPlatform() {
    const tileGeom = new THREE.BoxGeometry(0.94, 0.22, 0.94);

    for (let gx = -3; gx <= 3; gx += 1) {
      for (let gz = -3; gz <= 3; gz += 1) {
        const distance = Math.sqrt(gx * gx + gz * gz);
        const edgeFade = clamp(1 - distance / 5.2, 0, 1);
        const color = new THREE.Color().setHSL(0.29, 0.33, 0.2 + edgeFade * 0.14);
        const emissive = new THREE.Color().setHSL(0.33, 0.44, 0.05 + edgeFade * 0.04);

        const tile = new THREE.Mesh(
          tileGeom,
          new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: 0.78,
            roughness: 0.72,
            metalness: 0.08,
            transparent: true,
            opacity: 0.9
          })
        );

        tile.position.set(gx, 0, gz);
        this.platformGroup.add(tile);
      }
    }

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.7, 50),
      new THREE.MeshBasicMaterial({
        color: "#0fb5d4",
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0, 0.12, 0);
    this.platformGroup.add(halo);
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
      const mesh = new THREE.Mesh(
        blockGeom,
        new THREE.MeshStandardMaterial({
          color: actionPalette("", section),
          emissive: "#2b1e12",
          emissiveIntensity: 0.16,
          roughness: 0.4,
          metalness: 0.12,
          transparent: true,
          opacity: 0.96
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

    ringCoords(2).forEach(([x, z], idx) => {
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

  buildRecoveryProps() {
    const accent = "#63e8ff";

    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    this.targetRing = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.09, 14, 56), ringMat);
    this.targetRing.position.set(0, 1.4, -2.45);
    this.worldProps.add(this.targetRing);

    const beaconBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.6, 1.1, 8),
      new THREE.MeshStandardMaterial({
        color: "#15314d",
        emissive: "#0b2037",
        emissiveIntensity: 0.45,
        roughness: 0.58,
        metalness: 0.24,
        transparent: true,
        opacity: 0.94
      })
    );
    beaconBase.position.set(0, 0.58, 2.4);
    this.worldProps.add(beaconBase);

    this.beaconCore = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.34, 0),
      new THREE.MeshStandardMaterial({
        color: "#8fe9ff",
        emissive: "#49dfff",
        emissiveIntensity: 0.95,
        roughness: 0.12,
        metalness: 0.36,
        transparent: true,
        opacity: 0.9
      })
    );
    this.beaconCore.position.set(0, 1.46, 2.4);
    this.worldProps.add(this.beaconCore);

    this.energyColumn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.26, 2.4, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#64ecff",
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide
      })
    );
    this.energyColumn.position.set(0, 1.6, 2.4);
    this.worldProps.add(this.energyColumn);

    const padGeom = new THREE.CylinderGeometry(0.18, 0.22, 0.12, 12);
    for (let i = 0; i < 5; i += 1) {
      const pad = new THREE.Mesh(
        padGeom,
        new THREE.MeshStandardMaterial({
          color: "#173149",
          emissive: "#10324d",
          emissiveIntensity: 0.26,
          roughness: 0.52,
          metalness: 0.2,
          transparent: true,
          opacity: 0.84
        })
      );
      const offset = (i - 2) * 0.68;
      pad.position.set(offset, 0.18, -1.45 - Math.abs(offset) * 0.12);
      this.recoveryPads.push(pad);
      this.worldProps.add(pad);
    }

    const orbGeom = new THREE.SphereGeometry(0.08, 10, 10);
    for (let i = 0; i < 8; i += 1) {
      const orb = new THREE.Mesh(
        orbGeom,
        new THREE.MeshBasicMaterial({
          color: accent,
          transparent: true,
          opacity: 0.54
        })
      );
      this.orbitOrbs.push(orb);
      this.worldProps.add(orb);
    }
  }

  buildHeroRig() {
    this.heroRoot = new THREE.Group();
    this.heroRoot.position.set(0, 0.34, 0.4);

    const coreMat = new THREE.MeshStandardMaterial({
      color: "#f1f7ff",
      emissive: "#37cfff",
      emissiveIntensity: 0.18,
      roughness: 0.36,
      metalness: 0.18
    });
    const limbMat = new THREE.MeshStandardMaterial({
      color: "#b0d5f2",
      emissive: "#1e89b6",
      emissiveIntensity: 0.12,
      roughness: 0.44,
      metalness: 0.12
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: "#4de0ff",
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide
    });

    this.hero.pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.2, 0.3), coreMat);
    this.hero.pelvis.position.set(0, 0.15, 0);
    this.heroRoot.add(this.hero.pelvis);

    this.hero.spinePivot = new THREE.Group();
    this.hero.spinePivot.position.set(0, 0.24, 0);
    this.heroRoot.add(this.hero.spinePivot);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.32), coreMat);
    torso.position.set(0, 0.42, 0);
    this.hero.spinePivot.add(torso);

    this.hero.chestPivot = new THREE.Group();
    this.hero.chestPivot.position.set(0, 0.78, 0);
    this.hero.spinePivot.add(this.hero.chestPivot);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.32, 0.34), coreMat);
    chest.position.set(0, 0.08, 0);
    this.hero.chestPivot.add(chest);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 18), coreMat);
    head.position.set(0, 0.38, 0);
    this.hero.chestPivot.add(head);
    this.hero.head = head;

    const auraRing = new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.05, 12, 48), glowMat);
    auraRing.rotation.x = Math.PI / 2;
    auraRing.position.set(0, 0.02, 0);
    this.heroRoot.add(auraRing);
    this.hero.auraRing = auraRing;

    const createArm = (side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.34, 0.18, 0);
      this.hero.chestPivot.add(shoulder);

      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.58, 12), limbMat);
      upper.position.set(0, -0.29, 0);
      shoulder.add(upper);

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.56, 0);
      shoulder.add(elbow);

      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.52, 12), limbMat);
      lower.position.set(0, -0.26, 0);
      elbow.add(lower);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), coreMat);
      hand.position.set(0, -0.56, 0);
      elbow.add(hand);

      return { shoulder, elbow };
    };

    const createLeg = (side) => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.18, 0.08, 0);
      this.heroRoot.add(hip);

      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.68, 12), limbMat);
      thigh.position.set(0, -0.34, 0);
      hip.add(thigh);

      const knee = new THREE.Group();
      knee.position.set(0, -0.68, 0);
      hip.add(knee);

      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.62, 12), limbMat);
      shin.position.set(0, -0.31, 0);
      knee.add(shin);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.32), coreMat);
      foot.position.set(0, -0.64, 0.08);
      knee.add(foot);

      return { hip, knee };
    };

    const leftArm = createArm(-1);
    const rightArm = createArm(1);
    const leftLeg = createLeg(-1);
    const rightLeg = createLeg(1);

    this.hero.leftShoulder = leftArm.shoulder;
    this.hero.leftElbow = leftArm.elbow;
    this.hero.rightShoulder = rightArm.shoulder;
    this.hero.rightElbow = rightArm.elbow;
    this.hero.leftHip = leftLeg.hip;
    this.hero.leftKnee = leftLeg.knee;
    this.hero.rightHip = rightLeg.hip;
    this.hero.rightKnee = rightLeg.knee;

    this.scene.add(this.heroRoot);
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
    this.trackingConfidence = 0;
    this.placedCount = 0;
    this.repDrivenPlacements = 0;
    this.lastRepCount = 0;
    this.lastActionsCompleted = 0;
    this.currentRepTarget = 0;
    this.currentActionId = null;
    this.currentActionLabel = null;
    this.actionEnergy = 0;
    this.repBurst = 0;
    this.actionSwitchPulse = 0;
    this.zone = context.zone || "shoulder";
    this.side = context.side || "left";
    this.zoneColor = zoneTint(this.zone);
    this.storyChapter = STORY_CHAPTERS[0];

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

    if (this.heroRoot) {
      this.heroRoot.position.set(0, 0.34, 0.4);
      this.heroRoot.rotation.set(0, 0, 0);
    }
    if (this.hero.spinePivot) this.hero.spinePivot.rotation.set(0, 0, 0);
    if (this.hero.chestPivot) this.hero.chestPivot.rotation.set(0, 0, 0);
    if (this.hero.leftShoulder) this.hero.leftShoulder.rotation.set(0, 0, 0);
    if (this.hero.rightShoulder) this.hero.rightShoulder.rotation.set(0, 0, 0);
    if (this.hero.leftElbow) this.hero.leftElbow.rotation.set(0, 0, 0);
    if (this.hero.rightElbow) this.hero.rightElbow.rotation.set(0, 0, 0);
    if (this.hero.leftHip) this.hero.leftHip.rotation.set(0, 0, 0);
    if (this.hero.rightHip) this.hero.rightHip.rotation.set(0, 0, 0);
    if (this.hero.leftKnee) this.hero.leftKnee.rotation.set(0, 0, 0);
    if (this.hero.rightKnee) this.hero.rightKnee.rotation.set(0, 0, 0);

    this.updateLighting();
  }

  resolveStoryChapter(totalPlaced) {
    let selected = STORY_CHAPTERS[0];
    for (const chapter of STORY_CHAPTERS) {
      if (totalPlaced >= chapter.threshold) {
        selected = chapter;
      }
    }
    return selected;
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
    mesh.material.color.set(actionPalette(actionId, section));
    mesh.material.emissive.set(section === "roof" || section === "peak" ? "#235e8a" : "#6a3a1e");
    mesh.material.emissiveIntensity = section === "peak" ? 0.58 : 0.28;

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
    const blend = clamp(
      (this.vitalsScore * 0.32 + this.matchScore * 0.4 + this.motionSync * 0.16 + this.trackingConfidence * 0.12) / 100,
      0,
      1
    );

    if (this.ambientLight) {
      this.ambientLight.intensity = 0.52 + blend * 0.58;
      this.ambientLight.color.setHSL(0.54 - blend * 0.08, 0.5, 0.54);
    }
    if (this.keyLight) {
      this.keyLight.intensity = 0.92 + blend * 0.5;
    }
    if (this.fillLight) {
      this.fillLight.intensity = 0.24 + blend * 0.48;
      this.fillLight.color.set(this.zoneColor);
    }
    if (this.beaconLight) {
      this.beaconLight.intensity = 0.5 + blend * 1.2 + (this.storyChapter.id === "beacon" ? 0.5 : 0);
      this.beaconLight.color.set(actionAccent(this.currentActionId || this.zone));
    }
  }

  animateHero(t) {
    if (!this.heroRoot) {
      return;
    }

    const active = this.currentActionId || this.zone || "raise";
    const sideSign = this.side === "right" ? 1 : -1;
    const tempo = 1.4 + this.actionEnergy * 2.1;
    const cycle = (Math.sin(t * tempo * Math.PI) + 1) * 0.5;
    const quality = clamp((this.matchScore * 0.7 + this.trackingConfidence * 0.3) / 100, 0, 1);

    let rootX = 0;
    let rootY = 0.34 + Math.sin(t * 2.2) * 0.015 * (0.3 + this.actionEnergy);
    let spinePitch = 0;
    let chestYaw = 0;
    let leftArmX = 0.06;
    let rightArmX = -0.06;
    let leftArmZ = 0;
    let rightArmZ = 0;
    let leftElbowX = 0;
    let rightElbowX = 0;
    let leftHipX = 0;
    let rightHipX = 0;
    let leftKneeX = 0;
    let rightKneeX = 0;

    const armAmplitude = 0.3 + quality * 0.9;
    const legAmplitude = 0.25 + quality * 0.8;

    if (active === "raise") {
      if (sideSign > 0) {
        rightArmX = -(0.25 + cycle * 1.35 * armAmplitude);
        rightElbowX = -(0.15 + cycle * 0.45);
      } else {
        leftArmX = -(0.25 + cycle * 1.35 * armAmplitude);
        leftElbowX = -(0.15 + cycle * 0.45);
      }
      chestYaw = sideSign * 0.08 * cycle;
    } else if (active === "cross") {
      if (sideSign > 0) {
        rightArmX = -(0.45 + cycle * 0.55 * armAmplitude);
        rightArmZ = -sideSign * (0.2 + cycle * 0.52);
        rightElbowX = -(0.35 + cycle * 0.25);
      } else {
        leftArmX = -(0.45 + cycle * 0.55 * armAmplitude);
        leftArmZ = -sideSign * (0.2 + cycle * 0.52);
        leftElbowX = -(0.35 + cycle * 0.25);
      }
      chestYaw = -sideSign * 0.22 * cycle;
    } else if (active === "elbow-drive") {
      if (sideSign > 0) {
        rightArmX = -(0.22 + cycle * 0.45);
        rightArmZ = sideSign * (0.18 + cycle * 0.34);
        rightElbowX = -(0.7 - cycle * 0.12);
      } else {
        leftArmX = -(0.22 + cycle * 0.45);
        leftArmZ = sideSign * (0.18 + cycle * 0.34);
        leftElbowX = -(0.7 - cycle * 0.12);
      }
      chestYaw = sideSign * 0.18 * cycle;
    } else if (active === "march" || active === "step-lift") {
      rootY += cycle * 0.08;
      rootX = sideSign * 0.08 * (cycle - 0.5);
      if (sideSign > 0) {
        rightHipX = cycle * 1.05 * legAmplitude;
        rightKneeX = -(0.16 - cycle * 0.36);
      } else {
        leftHipX = cycle * 1.05 * legAmplitude;
        leftKneeX = -(0.16 - cycle * 0.36);
      }
      leftArmX = cycle * 0.35;
      rightArmX = -cycle * 0.35;
    } else if (active === "side-step") {
      rootX = sideSign * (cycle - 0.5) * 0.9;
      chestYaw = -sideSign * 0.16 * cycle;
      if (sideSign > 0) {
        rightHipX = cycle * 0.22;
        rightKneeX = -cycle * 0.18;
      } else {
        leftHipX = cycle * 0.22;
        leftKneeX = -cycle * 0.18;
      }
      leftArmX = cycle * 0.22;
      rightArmX = -cycle * 0.22;
    } else if (active === "hinge") {
      spinePitch = -(0.18 + cycle * 0.55);
      leftHipX = cycle * 0.24;
      rightHipX = cycle * 0.24;
      leftKneeX = -cycle * 0.16;
      rightKneeX = -cycle * 0.16;
      leftArmX = cycle * 0.14;
      rightArmX = cycle * 0.14;
    } else if (active === "mini-squat") {
      rootY -= cycle * 0.28;
      spinePitch = -cycle * 0.14;
      leftHipX = cycle * 0.82;
      rightHipX = cycle * 0.82;
      leftKneeX = -cycle * 0.68;
      rightKneeX = -cycle * 0.68;
      leftArmX = cycle * 0.24;
      rightArmX = cycle * 0.24;
    } else if (active === "extension") {
      rootY += cycle * 0.04;
      if (sideSign > 0) {
        rightHipX = cycle * 0.36;
        rightKneeX = -(0.1 + cycle * 0.58);
      } else {
        leftHipX = cycle * 0.36;
        leftKneeX = -(0.1 + cycle * 0.58);
      }
      leftArmX = cycle * 0.18;
      rightArmX = cycle * 0.18;
    }

    this.heroRoot.position.x = lerp(this.heroRoot.position.x, rootX, 0.14);
    this.heroRoot.position.y = lerp(this.heroRoot.position.y, rootY, 0.14);
    this.hero.spinePivot.rotation.x = lerp(this.hero.spinePivot.rotation.x, spinePitch, 0.16);
    this.hero.chestPivot.rotation.y = lerp(this.hero.chestPivot.rotation.y, chestYaw, 0.16);
    this.hero.leftShoulder.rotation.x = lerp(this.hero.leftShoulder.rotation.x, leftArmX, 0.18);
    this.hero.rightShoulder.rotation.x = lerp(this.hero.rightShoulder.rotation.x, rightArmX, 0.18);
    this.hero.leftShoulder.rotation.z = lerp(this.hero.leftShoulder.rotation.z, leftArmZ, 0.18);
    this.hero.rightShoulder.rotation.z = lerp(this.hero.rightShoulder.rotation.z, rightArmZ, 0.18);
    this.hero.leftElbow.rotation.x = lerp(this.hero.leftElbow.rotation.x, leftElbowX, 0.18);
    this.hero.rightElbow.rotation.x = lerp(this.hero.rightElbow.rotation.x, rightElbowX, 0.18);
    this.hero.leftHip.rotation.x = lerp(this.hero.leftHip.rotation.x, leftHipX, 0.18);
    this.hero.rightHip.rotation.x = lerp(this.hero.rightHip.rotation.x, rightHipX, 0.18);
    this.hero.leftKnee.rotation.x = lerp(this.hero.leftKnee.rotation.x, leftKneeX, 0.18);
    this.hero.rightKnee.rotation.x = lerp(this.hero.rightKnee.rotation.x, rightKneeX, 0.18);

    if (this.hero.auraRing) {
      const auraScale = 1 + this.actionEnergy * 0.22 + this.repBurst * 0.18;
      this.hero.auraRing.scale.setScalar(auraScale);
      this.hero.auraRing.material.color.set(actionAccent(active));
      this.hero.auraRing.material.opacity = 0.18 + this.actionEnergy * 0.16 + this.repBurst * 0.12;
    }
  }

  updateRecoveryProps(t) {
    if (!this.targetRing || !this.beaconCore || !this.energyColumn) {
      return;
    }

    const accent = actionAccent(this.currentActionId || this.zone);
    const qualityNorm = clamp(this.matchScore / Math.max(this.requiredMatch, 1), 0.25, 1.4);
    const trackingNorm = clamp(this.trackingConfidence / Math.max(this.requiredTracking, 1), 0.25, 1.5);
    const chapterBoost = this.storyChapter.id === "beacon"
      ? 1
      : this.storyChapter.id === "roof"
        ? 0.82
        : this.storyChapter.id === "walls"
          ? 0.64
          : this.storyChapter.id === "foundation"
            ? 0.48
            : 0.3;

    this.targetRing.material.color.set(accent);
    this.targetRing.material.opacity = 0.34 + this.actionEnergy * 0.26 + this.actionSwitchPulse * 0.18;
    const ringScale = 1 + (qualityNorm - 0.5) * 0.08 + this.actionSwitchPulse * 0.12;
    this.targetRing.scale.setScalar(ringScale);
    this.targetRing.rotation.z += 0.01 + this.actionEnergy * 0.01;

    this.beaconCore.material.color.set(accent);
    this.beaconCore.material.emissive.set(accent);
    this.beaconCore.material.emissiveIntensity = 0.62 + chapterBoost * 0.9 + this.repBurst * 0.42;
    this.beaconCore.scale.setScalar(0.95 + chapterBoost * 0.3 + this.repBurst * 0.24);
    this.beaconCore.rotation.y += 0.02 + chapterBoost * 0.02;
    this.beaconCore.position.y = 1.46 + Math.sin(t * 2.2) * 0.08;

    this.energyColumn.material.color.set(accent);
    this.energyColumn.material.opacity = 0.12 + chapterBoost * 0.22 + this.actionEnergy * 0.14;
    this.energyColumn.scale.y = 0.9 + chapterBoost * 0.4 + trackingNorm * 0.12;

    const repFill = this.currentRepTarget > 0
      ? clamp(this.lastRepCount / this.currentRepTarget, 0, 1)
      : 0;
    this.recoveryPads.forEach((pad, index) => {
      const threshold = (index + 1) / this.recoveryPads.length;
      const active = repFill >= threshold;
      pad.material.color.set(active ? accent : "#173149");
      pad.material.emissive.set(active ? accent : "#10324d");
      pad.material.emissiveIntensity = active ? 0.5 + this.repBurst * 0.18 : 0.16;
      const scale = active ? 1.12 + this.repBurst * 0.12 : 1;
      pad.scale.setScalar(scale);
    });

    this.orbitOrbs.forEach((orb, index) => {
      const angle = t * (0.9 + this.actionEnergy * 1.2) + (index / this.orbitOrbs.length) * Math.PI * 2;
      const radius = 1.18 + chapterBoost * 0.3 + (index % 2) * 0.18;
      orb.position.set(
        Math.cos(angle) * radius,
        1.15 + Math.sin(angle * 1.4) * 0.38 + chapterBoost * 0.3,
        -2.45 + Math.sin(angle) * 0.34
      );
      orb.material.color.set(accent);
      orb.material.opacity = 0.25 + this.actionEnergy * 0.22 + trackingNorm * 0.08;
      orb.scale.setScalar(0.85 + this.repBurst * 0.5);
    });
  }

  animate = () => {
    if (!this.running) {
      return;
    }

    const now = performance.now();
    if (this.lastTime && (now - this.lastTime) < this.targetFrameMs) {
      this.rafId = requestAnimationFrame(this.animate);
      return;
    }
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
      const pulse = 0.08 + Math.max(0, 1.1 - lifeSec) * 0.3 + this.repBurst * 0.18;
      mesh.material.emissiveIntensity = clamp((mesh.material.emissiveIntensity * 0.93) + pulse * 0.06, 0.1, 0.72);
    }

    if (this.platformGroup) {
      this.platformGroup.rotation.y = Math.sin(t * 0.2) * 0.03;
    }

    if (this.buildGroup) {
      this.buildGroup.rotation.y = Math.sin(t * 0.16) * 0.04;
    }

    if (this.sparkles) {
      this.sparkles.rotation.y += dt * 0.03;
      this.sparkles.position.y = Math.sin(t * 0.35) * 0.1;
      this.sparkles.material.opacity = 0.38 + Math.sin(t * 0.8) * 0.08 + this.actionEnergy * 0.1;
    }

    this.repBurst = Math.max(this.repBurst - dt * 1.8, 0);
    this.actionSwitchPulse = Math.max(this.actionSwitchPulse - dt * 1.4, 0);

    this.animateHero(t);
    this.updateRecoveryProps(t);

    const drift = Math.sin(t * 0.22) * 0.18;
    this.camera.position.x = 9.6 + drift;
    this.camera.position.z = 9.2 + Math.cos(t * 0.22) * 0.14;
    this.camera.lookAt(0, 1.06, 0);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.animate);
  };
}
