import * as THREE from "three";
import { clamp } from "../../core/utils.js";

export class VirtualRecoveryWorld {
  constructor({ canvasEl }) {
    this.canvas = canvasEl;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.ambientLight = null;
    this.keyLight = null;

    this.avatar = null;
    this.avatarMat = null;
    this.energyOrbs = [];
    this.trackMarkers = [];
    this.stars = null;

    this.running = false;
    this.rafId = null;
    this.lastTime = performance.now();

    this.progress = 0;
    this.matchScore = 0;
    this.vitalsScore = 0;
    this.motionSync = 0;
    this.actionsCompleted = 0;
    this.actionsTotal = 0;
    this.repsDone = 0;
    this.repsTarget = 0;
    this.lastRepCount = 0;
    this.actionId = null;

    this.targetAvatarZ = -4;
    this.jumpBoost = 0;
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
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }

  update(payload = {}) {
    this.progress = clamp(Number(payload.score || this.progress || 0), 0, 100);
    this.matchScore = clamp(Number(payload.movementMatchScore || this.matchScore || 0), 0, 100);
    this.vitalsScore = clamp(Number(payload.vitalsScore || this.vitalsScore || 0), 0, 100);
    this.motionSync = clamp(Number(payload.motionSyncScore || this.motionSync || 0), 0, 100);
    this.actionsCompleted = Number(payload.actionsCompleted || this.actionsCompleted || 0);
    this.actionsTotal = Number(payload.actionsTotal || this.actionsTotal || 0);
    this.repsDone = Number(payload.repsDone || 0);
    this.repsTarget = Number(payload.repsTarget || 0);
    this.actionId = payload.actionId || this.actionId;

    if (this.repsDone > this.lastRepCount) {
      this.jumpBoost = 0.35;
      this.lastRepCount = this.repsDone;
    }

    const normalized = this.progress / 100;
    this.targetAvatarZ = -5 - normalized * 38;
    this.updateOrbCollection(normalized);
    this.updateLighting();
  }

  initialize() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#061620");
    this.scene.fog = new THREE.Fog("#061620", 18, 74);

    this.camera = new THREE.PerspectiveCamera(53, 16 / 9, 0.1, 180);
    this.camera.position.set(0, 6, 11);
    this.camera.lookAt(0, 1, -12);

    this.ambientLight = new THREE.AmbientLight("#6bb3ff", 0.7);
    this.keyLight = new THREE.DirectionalLight("#ffffff", 1.15);
    this.keyLight.position.set(5, 9, 2);
    const rimLight = new THREE.DirectionalLight("#8fffd0", 0.45);
    rimLight.position.set(-7, 6, -8);
    this.scene.add(this.ambientLight, this.keyLight, rimLight);

    this.buildTrack();
    this.buildAvatar();
    this.buildOrbs();
    this.buildStars();

    this.initialized = true;
    this.resize();
  }

  buildTrack() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(24, 100, 1, 1),
      new THREE.MeshStandardMaterial({
        color: "#0d2532",
        roughness: 0.88,
        metalness: 0.06
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.position.z = -30;
    this.scene.add(ground);

    const laneMat = new THREE.MeshStandardMaterial({
      color: "#1e5164",
      emissive: "#123847",
      emissiveIntensity: 0.45
    });
    for (let i = 0; i < 28; i += 1) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 1.5), laneMat.clone());
      marker.position.set(0, 0.02, -4 - i * 3.1);
      this.trackMarkers.push(marker);
      this.scene.add(marker);
    }
  }

  buildAvatar() {
    const group = new THREE.Group();
    this.avatarMat = new THREE.MeshStandardMaterial({
      color: "#ffbc70",
      emissive: "#7e4f24",
      emissiveIntensity: 0.32,
      roughness: 0.35,
      metalness: 0.08
    });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 1.2, 10, 16), this.avatarMat);
    body.position.y = 1.4;
    group.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 18), this.avatarMat);
    head.position.y = 2.42;
    group.add(head);

    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.7, 8, 10), this.avatarMat);
    leftArm.position.set(-0.5, 1.7, 0);
    leftArm.rotation.z = 0.22;
    group.add(leftArm);

    const rightArm = leftArm.clone();
    rightArm.position.x = 0.5;
    rightArm.rotation.z = -0.22;
    group.add(rightArm);

    const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.9, 8, 10), this.avatarMat);
    leftLeg.position.set(-0.22, 0.56, 0);
    group.add(leftLeg);

    const rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.22;
    group.add(rightLeg);

    group.position.set(0, 0.02, -4);
    this.avatar = group;
    this.scene.add(group);
  }

  buildOrbs() {
    const geometry = new THREE.SphereGeometry(0.22, 14, 14);
    for (let i = 0; i < 24; i += 1) {
      const t = i / 23;
      const mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? "#4de8c2" : "#6ad2ff",
        emissive: i % 2 === 0 ? "#1f8f74" : "#2f8db8",
        emissiveIntensity: 0.75,
        roughness: 0.22,
        metalness: 0.15,
        transparent: true,
        opacity: 0.96
      });
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set((i % 2 === 0 ? -1 : 1) * (0.8 + (i % 3) * 0.2), 1.2 + (i % 4) * 0.16, -6 - t * 36);
      mesh.userData = {
        idx: i,
        baseY: mesh.position.y,
        collected: false
      };
      this.energyOrbs.push(mesh);
      this.scene.add(mesh);
    }
  }

  buildStars() {
    const geo = new THREE.BufferGeometry();
    const points = [];
    for (let i = 0; i < 320; i += 1) {
      points.push((Math.random() - 0.5) * 60, Math.random() * 18 + 1, -Math.random() * 90);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    const mat = new THREE.PointsMaterial({
      color: "#cceeff",
      size: 0.08,
      transparent: true,
      opacity: 0.78
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);
  }

  resetWorld(context) {
    this.progress = 0;
    this.matchScore = 0;
    this.vitalsScore = 0;
    this.motionSync = 0;
    this.actionsCompleted = 0;
    this.actionsTotal = 0;
    this.repsDone = 0;
    this.repsTarget = 0;
    this.lastRepCount = 0;
    this.actionId = null;
    this.targetAvatarZ = -5;
    this.jumpBoost = 0;

    if (this.avatar) {
      this.avatar.position.set(0, 0.02, -5);
    }

    this.energyOrbs.forEach((orb) => {
      orb.userData.collected = false;
      orb.visible = true;
      orb.material.opacity = 0.96;
    });

    const zoneHue = context.zone === "hip" ? "#7df7cc" : context.zone === "knee" ? "#79dbff" : "#ffc57a";
    if (this.avatarMat) {
      this.avatarMat.color.set(zoneHue);
      this.avatarMat.emissive.set("#5e3b1a");
    }
    this.updateLighting();
  }

  updateOrbCollection(normalizedProgress) {
    const collected = Math.floor(normalizedProgress * this.energyOrbs.length);
    this.energyOrbs.forEach((orb, index) => {
      if (index < collected) {
        orb.userData.collected = true;
      }
    });
  }

  updateLighting() {
    const vital = this.vitalsScore / 100;
    const match = this.matchScore / 100;
    const sync = this.motionSync / 100;
    const blend = clamp(vital * 0.45 + match * 0.35 + sync * 0.2, 0, 1);
    if (this.ambientLight) {
      this.ambientLight.intensity = 0.52 + blend * 0.55;
      this.ambientLight.color.setHSL(0.53 - blend * 0.1, 0.45, 0.56);
    }
    if (this.keyLight) {
      this.keyLight.intensity = 0.9 + blend * 0.5;
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

    if (this.avatar) {
      this.avatar.position.z += (this.targetAvatarZ - this.avatar.position.z) * 0.1;
      this.jumpBoost = Math.max(this.jumpBoost - dt * 1.1, 0);
      this.avatar.position.y = 0.06 + Math.sin(t * 6.5) * 0.06 + this.jumpBoost;
      this.avatar.rotation.y = Math.sin(t * 2.2) * 0.08;
    }

    this.energyOrbs.forEach((orb, idx) => {
      orb.position.y = orb.userData.baseY + Math.sin(t * 2.4 + idx * 0.5) * 0.1;
      if (orb.userData.collected) {
        orb.material.opacity = Math.max(orb.material.opacity - dt * 3.8, 0);
        orb.scale.multiplyScalar(0.985);
        if (orb.material.opacity <= 0.02) {
          orb.visible = false;
        }
      } else {
        orb.scale.setScalar(1 + Math.sin(t * 3 + idx) * 0.06);
      }
    });

    this.trackMarkers.forEach((marker, idx) => {
      const pulse = 0.35 + Math.sin(t * 4 + idx * 0.4) * 0.2;
      marker.material.emissiveIntensity = pulse * (0.5 + (this.progress / 100) * 0.8);
    });

    if (this.stars) {
      this.stars.rotation.y += dt * 0.03;
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.animate);
  };
}
