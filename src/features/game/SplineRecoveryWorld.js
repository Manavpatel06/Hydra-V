import { Application } from "../../../node_modules/@splinetool/runtime/build/runtime.js";
import { clamp } from "../../core/utils.js";

const DEFAULT_SCENE_URL = "https://prod.spline.design/8yRm8xEBLtMg0FLZ/scene.splinecode";

const SECTION_TARGETS = {
  foundation: 9,
  walls: 16,
  roof: 9,
  peak: 1
};

const TOTAL_TARGET = Object.values(SECTION_TARGETS).reduce((sum, value) => sum + value, 0);

const STORY_CHAPTERS = Object.freeze([
  {
    id: "awakening",
    threshold: 0,
    title: "Awakening",
    line: "The recovery world is quiet. Your first clean reps will wake the core."
  },
  {
    id: "foundation",
    threshold: 9,
    title: "Foundation Rising",
    line: "The ground stabilizes beneath the hero. Movement control is rebuilding trust."
  },
  {
    id: "walls",
    threshold: 25,
    title: "Walls of Resilience",
    line: "Walls rise with every rep. Consistency is turning motion into protection."
  },
  {
    id: "roof",
    threshold: 34,
    title: "Roof of Recovery",
    line: "The shelter closes overhead. Form quality now locks in lasting progress."
  },
  {
    id: "beacon",
    threshold: 35,
    title: "Beacon Complete",
    line: "The recovery beacon is lit. Your body and world are synchronized."
  }
]);

function safeAngle(start, end) {
  if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
    return null;
  }
  return Math.atan2(end.y - start.y, end.x - start.x);
}

function angleDeg(a, b, c) {
  if (!a || !b || !c) {
    return null;
  }

  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag1 = Math.sqrt(abx * abx + aby * aby) || 1;
  const mag2 = Math.sqrt(cbx * cbx + cby * cby) || 1;
  const cos = clamp(dot / (mag1 * mag2), -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

function createLivePoseState() {
  return {
    rootOffsetX: 0,
    rootOffsetY: 0,
    hipsPitch: 0,
    hipsYaw: 0,
    spinePitch: 0,
    chestPitch: 0,
    headPitch: 0,
    leftThighPitch: 0,
    rightThighPitch: 0,
    leftShinPitch: 0,
    rightShinPitch: 0,
    leftUpperDelta: 0,
    rightUpperDelta: 0,
    leftForeDelta: 0,
    rightForeDelta: 0
  };
}

function pickFirst(app, names) {
  for (const name of names) {
    const object = app?.findObjectByName?.(name);
    if (object) {
      return object;
    }
  }
  return null;
}

function pickByContains(objects, keywords) {
  if (!Array.isArray(objects) || !Array.isArray(keywords)) {
    return null;
  }
  const lowered = keywords.map((token) => String(token).toLowerCase());
  for (const object of objects) {
    const name = String(object?.name || "").toLowerCase();
    if (!name) {
      continue;
    }
    if (lowered.some((token) => name.includes(token))) {
      return object;
    }
  }
  return null;
}

function lerpNumber(current, target, alpha = 0.2) {
  if (!Number.isFinite(target)) {
    return current;
  }
  if (!Number.isFinite(current)) {
    return target;
  }
  return current + (target - current) * clamp(alpha, 0.01, 1);
}

export class SplineRecoveryWorld {
  constructor({
    canvasEl,
    getPoseLandmarks,
    sceneUrl = DEFAULT_SCENE_URL
  }) {
    this.canvas = canvasEl;
    this.getPoseLandmarks = getPoseLandmarks;
    this.sceneUrl = sceneUrl;

    this.app = null;
    this.loaded = false;
    this.loadPromise = null;
    this.lastError = null;

    this.running = false;
    this.rafId = null;
    this.lastTickAt = 0;
    this.targetFrameMs = 1000 / 30;

    this.zone = "shoulder";
    this.side = "left";
    this.progress = 0;
    this.motionSync = 0;
    this.sectionPlaced = {
      foundation: 0,
      walls: 0,
      roof: 0,
      peak: 0
    };

    this.armTargets = {
      leftUpper: null,
      leftFore: null,
      leftHand: null,
      rightUpper: null,
      rightFore: null,
      rightHand: null
    };

    this.heroTargets = {
      root: null,
      hips: null,
      spine: null,
      chest: null,
      head: null,
      leftThigh: null,
      rightThigh: null,
      leftShin: null,
      rightShin: null
    };

    this.materials = [];
    this.baseTransforms = new WeakMap();

    this.currentActionId = null;
    this.currentRepsDone = 0;
    this.currentRepsTarget = 0;
    this.actionsCompleted = 0;
    this.lastRepPulseAt = 0;

    this.lastUpperAngle = null;
    this.lastForeAngle = null;
    this.livePoseState = createLivePoseState();

    this.storyChapter = STORY_CHAPTERS[0];

    this.originalAudioConstructor = null;
    this.originalCreateElement = null;
    this.audioPatched = false;
    this.createElementPatched = false;
    this.audioSilenceTimer = null;
    this.trackedMediaElements = new Set();
  }

  async ensureLoaded() {
    if (this.loaded) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }
    if (!this.sceneUrl) {
      throw new Error("Spline scene URL is not configured.");
    }

    this.app = new Application(this.canvas);
    this.loadPromise = this.app.load(this.sceneUrl)
      .then(() => {
        this.loaded = true;
        this.cacheSceneObjects();
        this.forceMuteSplineAudio();
      })
      .catch((error) => {
        this.lastError = error;
        throw error;
      });

    return this.loadPromise;
  }

  cacheSceneObjects() {
    const app = this.app;
    const all = app?.getAllObjects?.() || [];
    const byContains = (tokens) => pickByContains(all, tokens);

    this.armTargets.leftUpper = pickFirst(app, ["LeftArm", "LeftUpperArm", "L_UpperArm"]) || byContains(["left", "upper", "arm"]);
    this.armTargets.leftFore = pickFirst(app, ["LeftForeArm", "LeftForearm", "LeftLowerArm", "L_ForeArm"]) || byContains(["left", "fore", "arm"]);
    this.armTargets.leftHand = pickFirst(app, ["LeftHand", "L_Hand"]) || byContains(["left", "hand"]);
    this.armTargets.rightUpper = pickFirst(app, ["RightArm", "RightUpperArm", "R_UpperArm"]) || byContains(["right", "upper", "arm"]);
    this.armTargets.rightFore = pickFirst(app, ["RightForeArm", "RightForearm", "RightLowerArm", "R_ForeArm"]) || byContains(["right", "fore", "arm"]);
    this.armTargets.rightHand = pickFirst(app, ["RightHand", "R_Hand"]) || byContains(["right", "hand"]);

    this.heroTargets.root = pickFirst(app, ["Character", "Avatar", "Player", "Rig", "Armature", "Root"]) || byContains(["character"]) || byContains(["avatar"]);
    this.heroTargets.hips = pickFirst(app, ["Hips", "Pelvis", "Hip"]) || byContains(["hip"]) || this.heroTargets.root;
    this.heroTargets.spine = pickFirst(app, ["Spine", "Spine1", "Torso", "Body", "UpperBody"]) || byContains(["spine"]);
    this.heroTargets.chest = pickFirst(app, ["Chest", "UpperChest"]) || byContains(["chest"]);
    this.heroTargets.head = pickFirst(app, ["Head", "Neck"]) || byContains(["head"]);
    this.heroTargets.leftThigh = pickFirst(app, ["LeftUpLeg", "LeftThigh", "L_Thigh"]) || byContains(["left", "thigh"]);
    this.heroTargets.rightThigh = pickFirst(app, ["RightUpLeg", "RightThigh", "R_Thigh"]) || byContains(["right", "thigh"]);
    this.heroTargets.leftShin = pickFirst(app, ["LeftLeg", "LeftShin", "L_Shin"]) || byContains(["left", "shin"]) || byContains(["left", "leg"]);
    this.heroTargets.rightShin = pickFirst(app, ["RightLeg", "RightShin", "R_Shin"]) || byContains(["right", "shin"]) || byContains(["right", "leg"]);

    [
      ...Object.values(this.armTargets),
      ...Object.values(this.heroTargets)
    ].forEach((object) => {
      this.captureBaseTransform(object);
    });

    this.materials = all.filter((object) => object && typeof object === "object" && Number.isFinite(Number(object.emissiveIntensity)));
  }

  start(context = {}) {
    this.zone = context.zone || this.zone;
    this.side = context.side || this.side;
    this.running = true;
    this.progress = 0;
    this.motionSync = 0;
    this.currentActionId = null;
    this.currentRepsDone = 0;
    this.currentRepsTarget = 0;
    this.actionsCompleted = 0;
    this.lastRepPulseAt = 0;
    this.lastUpperAngle = null;
    this.lastForeAngle = null;
    this.livePoseState = createLivePoseState();
    this.storyChapter = STORY_CHAPTERS[0];
    this.sectionPlaced = {
      foundation: 0,
      walls: 0,
      roof: 0,
      peak: 0
    };
    this.lastTickAt = 0;
    this.canvas.classList.remove("hidden");
    this.setupAudioSuppression();

    const loadTask = this.ensureLoaded().catch((error) => {
      this.stop();
      throw error;
    });
    this.tick();
    return loadTask;
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.teardownAudioSuppression();
  }

  resize() {
    if (!this.canvas) {
      return;
    }
    const width = Math.round(this.canvas.clientWidth || this.canvas.width || 960);
    const height = Math.round(this.canvas.clientHeight || this.canvas.height || 540);
    if (this.canvas.width !== width) {
      this.canvas.width = width;
    }
    if (this.canvas.height !== height) {
      this.canvas.height = height;
    }
  }

  update(payload = {}) {
    this.progress = clamp(Number(payload.score || 0), 0, 100);
    this.motionSync = clamp(Number(payload.motionSyncScore || 0), 0, 100);

    const nextActionId = typeof payload.actionId === "string" && payload.actionId ? payload.actionId : this.currentActionId;
    const nextRepsDone = Number(payload.repsDone || 0);
    if (Number.isFinite(nextRepsDone) && nextRepsDone > this.currentRepsDone) {
      this.lastRepPulseAt = performance.now();
    }

    this.currentActionId = nextActionId;
    this.currentRepsDone = Number.isFinite(nextRepsDone) ? nextRepsDone : this.currentRepsDone;
    this.currentRepsTarget = Number.isFinite(Number(payload.repsTarget)) ? Number(payload.repsTarget) : this.currentRepsTarget;
    this.actionsCompleted = Number.isFinite(Number(payload.actionsCompleted)) ? Number(payload.actionsCompleted) : this.actionsCompleted;

    this.applySectionPlacementFromProgress(this.progress);
    const totalPlaced = this.sectionPlaced.foundation + this.sectionPlaced.walls + this.sectionPlaced.roof + this.sectionPlaced.peak;
    this.storyChapter = this.resolveStoryChapter(totalPlaced);
  }

  getBuildStats() {
    const totalPlaced = this.sectionPlaced.foundation + this.sectionPlaced.walls + this.sectionPlaced.roof + this.sectionPlaced.peak;
    return {
      totalPlaced,
      totalTarget: TOTAL_TARGET,
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

  applySectionPlacementFromProgress(progress) {
    let remaining = Math.round((clamp(progress, 0, 100) / 100) * TOTAL_TARGET);
    const sectionPlaced = {};
    for (const section of Object.keys(SECTION_TARGETS)) {
      const target = SECTION_TARGETS[section];
      const placed = Math.min(target, remaining);
      sectionPlaced[section] = placed;
      remaining -= placed;
    }
    this.sectionPlaced = sectionPlaced;
  }

  resolveStoryChapter(totalPlaced) {
    let chapter = STORY_CHAPTERS[0];
    for (const item of STORY_CHAPTERS) {
      if (totalPlaced >= item.threshold) {
        chapter = item;
      }
    }
    return chapter;
  }

  tick = () => {
    if (!this.running) {
      return;
    }

    const now = performance.now();
    if (this.lastTickAt && (now - this.lastTickAt) < this.targetFrameMs) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }
    this.lastTickAt = now;

    if (this.loaded) {
      this.applyPoseToScene();
      this.applyActionAnimation(now);
      this.applyProgressPulse(now);
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  setupAudioSuppression() {
    if (!this.audioPatched && typeof window !== "undefined" && typeof window.Audio === "function") {
      this.originalAudioConstructor = window.Audio;
      const silencer = this;
      function PatchedAudio(...args) {
        const audio = new silencer.originalAudioConstructor(...args);
        silencer.trackAndMuteMedia(audio);
        return audio;
      }
      PatchedAudio.prototype = this.originalAudioConstructor.prototype;
      Object.setPrototypeOf(PatchedAudio, this.originalAudioConstructor);
      window.Audio = PatchedAudio;
      this.audioPatched = true;
    }

    if (!this.createElementPatched && typeof document !== "undefined" && typeof document.createElement === "function") {
      this.originalCreateElement = document.createElement.bind(document);
      const silencer = this;
      document.createElement = function patchedCreateElement(tagName, options) {
        const element = silencer.originalCreateElement(tagName, options);
        if (typeof tagName === "string") {
          const lower = tagName.toLowerCase();
          if (lower === "audio" || lower === "video") {
            silencer.trackAndMuteMedia(element);
          }
        }
        return element;
      };
      this.createElementPatched = true;
    }

    if (!this.audioSilenceTimer && typeof window !== "undefined") {
      this.audioSilenceTimer = window.setInterval(() => {
        this.forceMuteSplineAudio();
      }, 600);
    }
  }

  teardownAudioSuppression() {
    if (this.audioSilenceTimer) {
      clearInterval(this.audioSilenceTimer);
      this.audioSilenceTimer = null;
    }

    if (this.audioPatched && this.originalAudioConstructor && typeof window !== "undefined") {
      window.Audio = this.originalAudioConstructor;
      this.originalAudioConstructor = null;
      this.audioPatched = false;
    }

    if (this.createElementPatched && this.originalCreateElement && typeof document !== "undefined") {
      document.createElement = this.originalCreateElement;
      this.originalCreateElement = null;
      this.createElementPatched = false;
    }

    this.trackedMediaElements.clear();
  }

  trackAndMuteMedia(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return;
    }
    this.trackedMediaElements.add(media);
    this.applyMute(media);
    if (!media.__hydraSplineAudioSilenced) {
      media.__hydraSplineAudioSilenced = true;
      media.addEventListener("play", () => this.applyMute(media));
      media.addEventListener("loadeddata", () => this.applyMute(media));
      media.addEventListener("canplay", () => this.applyMute(media));
    }
  }

  applyMute(media) {
    if (!(media instanceof HTMLMediaElement)) {
      return;
    }
    media.muted = true;
    media.defaultMuted = true;
    media.volume = 0;
    try {
      media.pause();
    } catch {
      // no-op
    }
  }

  mutePossibleAudioHandle(handle) {
    if (!handle) {
      return;
    }

    if (handle instanceof HTMLMediaElement) {
      this.trackAndMuteMedia(handle);
      return;
    }

    if (typeof handle.mute === "function") {
      try {
        handle.mute(true);
      } catch {
        // no-op
      }
    }

    if (typeof handle.setVolume === "function") {
      try {
        handle.setVolume(0);
      } catch {
        // no-op
      }
    }

    if (typeof handle.volume === "number") {
      try {
        handle.volume = 0;
      } catch {
        // no-op
      }
    }

    if (typeof handle.pause === "function") {
      try {
        handle.pause();
      } catch {
        // no-op
      }
    }

    if (typeof handle.stop === "function") {
      try {
        handle.stop();
      } catch {
        // no-op
      }
    }
  }

  forceMuteSplineAudio() {
    if (typeof window !== "undefined" && window.Howler && typeof window.Howler.mute === "function") {
      try {
        window.Howler.mute(true);
      } catch {
        // no-op
      }
    }

    this.trackedMediaElements.forEach((media) => {
      this.applyMute(media);
    });

    const objects = this.app?.getAllObjects?.() || [];
    for (const object of objects) {
      if (!object) {
        continue;
      }
      this.mutePossibleAudioHandle(object.audio);
      this.mutePossibleAudioHandle(object.audioPlayer);
      this.mutePossibleAudioHandle(object.sound);
      this.mutePossibleAudioHandle(object.media);
      this.mutePossibleAudioHandle(object.video);
      this.mutePossibleAudioHandle(object.player);

      const layers = object?.material?.layers;
      if (Array.isArray(layers)) {
        for (const layer of layers) {
          if (!layer || layer.type !== "video") {
            continue;
          }
          const texture = layer.texture;
          if (texture) {
            this.mutePossibleAudioHandle(texture.video);
            this.mutePossibleAudioHandle(texture.image);
            this.mutePossibleAudioHandle(texture.element);
            this.mutePossibleAudioHandle(texture.source);
          }
        }
      }
    }
  }

  captureBaseTransform(object) {
    if (!object || this.baseTransforms.has(object)) {
      return;
    }
    this.baseTransforms.set(object, {
      rotation: {
        x: Number.isFinite(Number(object?.rotation?.x)) ? Number(object.rotation.x) : 0,
        y: Number.isFinite(Number(object?.rotation?.y)) ? Number(object.rotation.y) : 0,
        z: Number.isFinite(Number(object?.rotation?.z)) ? Number(object.rotation.z) : 0
      },
      position: {
        x: Number.isFinite(Number(object?.position?.x)) ? Number(object.position.x) : 0,
        y: Number.isFinite(Number(object?.position?.y)) ? Number(object.position.y) : 0,
        z: Number.isFinite(Number(object?.position?.z)) ? Number(object.position.z) : 0
      }
    });
  }

  getBase(object, kind, axis, fallback = 0) {
    if (!object) {
      return fallback;
    }
    const base = this.baseTransforms.get(object);
    if (!base || !base[kind] || !Number.isFinite(Number(base[kind][axis]))) {
      return fallback;
    }
    return Number(base[kind][axis]);
  }

  driveRotation(object, axis, target, alpha = 0.2) {
    if (!object?.rotation || !Number.isFinite(Number(object.rotation[axis]))) {
      return;
    }
    object.rotation[axis] = lerpNumber(Number(object.rotation[axis]), target, alpha);
  }

  drivePosition(object, axis, target, alpha = 0.2) {
    if (!object?.position || !Number.isFinite(Number(object.position[axis]))) {
      return;
    }
    object.position[axis] = lerpNumber(Number(object.position[axis]), target, alpha);
  }

  getRepPulse(now) {
    if (!Number.isFinite(this.lastRepPulseAt) || this.lastRepPulseAt <= 0) {
      return 0;
    }
    return clamp(1 - (now - this.lastRepPulseAt) / 450, 0, 1);
  }

  applyPoseToScene() {
    const landmarks = this.getPoseLandmarks?.();
    if (!Array.isArray(landmarks) || landmarks.length < 17) {
      this.livePoseState = createLivePoseState();
      return;
    }

    const nextLivePose = createLivePoseState();
    const sourceShoulder = this.side === "left" ? landmarks[12] : landmarks[11];
    const sourceElbow = this.side === "left" ? landmarks[14] : landmarks[13];
    const sourceWrist = this.side === "left" ? landmarks[16] : landmarks[15];
    const upperAngle = safeAngle(sourceShoulder, sourceElbow);
    const foreAngle = safeAngle(sourceElbow, sourceWrist);
    if (Number.isFinite(upperAngle) && Number.isFinite(foreAngle)) {
      const smooth = 0.26;
      this.lastUpperAngle = Number.isFinite(this.lastUpperAngle)
        ? this.lastUpperAngle + (upperAngle - this.lastUpperAngle) * smooth
        : upperAngle;
      this.lastForeAngle = Number.isFinite(this.lastForeAngle)
        ? this.lastForeAngle + (foreAngle - this.lastForeAngle) * smooth
        : foreAngle;

      const mirrorOffset = Math.PI / 2;
      const relativeFore = this.lastForeAngle - this.lastUpperAngle;

      if (this.side === "left") {
        const upperBase = this.getBase(this.armTargets.leftUpper, "rotation", "z", Number(this.armTargets.leftUpper?.rotation?.z) || 0);
        const foreBase = this.getBase(this.armTargets.leftFore, "rotation", "z", Number(this.armTargets.leftFore?.rotation?.z) || 0);
        nextLivePose.leftUpperDelta = (this.lastUpperAngle + mirrorOffset) - upperBase;
        nextLivePose.leftForeDelta = relativeFore - foreBase;
      } else {
        const upperBase = this.getBase(this.armTargets.rightUpper, "rotation", "z", Number(this.armTargets.rightUpper?.rotation?.z) || 0);
        const foreBase = this.getBase(this.armTargets.rightFore, "rotation", "z", Number(this.armTargets.rightFore?.rotation?.z) || 0);
        nextLivePose.rightUpperDelta = (this.lastUpperAngle + mirrorOffset) - upperBase;
        nextLivePose.rightForeDelta = relativeFore - foreBase;
      }
    }

    const sideIndexes = this.side === "right"
      ? { shoulder: 12, hip: 24, knee: 26, ankle: 28 }
      : { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
    const oppositeIndexes = this.side === "right"
      ? { hip: 23, knee: 25, ankle: 27 }
      : { hip: 24, knee: 26, ankle: 28 };

    const activeShoulder = landmarks[sideIndexes.shoulder];
    const activeHip = landmarks[sideIndexes.hip];
    const activeKnee = landmarks[sideIndexes.knee];
    const activeAnkle = landmarks[sideIndexes.ankle];
    const oppositeHip = landmarks[oppositeIndexes.hip];
    const oppositeKnee = landmarks[oppositeIndexes.knee];
    const oppositeAnkle = landmarks[oppositeIndexes.ankle];
    const sideSign = this.side === "right" ? 1 : -1;
    const actionId = this.currentActionId || this.zone;

    const applyActiveLeg = (thighPitch, shinPitch) => {
      if (this.side === "left") {
        nextLivePose.leftThighPitch = thighPitch;
        nextLivePose.leftShinPitch = shinPitch;
      } else {
        nextLivePose.rightThighPitch = thighPitch;
        nextLivePose.rightShinPitch = shinPitch;
      }
    };

    const applyOppositeLeg = (thighPitch, shinPitch) => {
      if (this.side === "left") {
        nextLivePose.rightThighPitch = thighPitch;
        nextLivePose.rightShinPitch = shinPitch;
      } else {
        nextLivePose.leftThighPitch = thighPitch;
        nextLivePose.leftShinPitch = shinPitch;
      }
    };

    if (actionId === "mini-squat" && activeHip && activeKnee && activeAnkle && oppositeHip && oppositeKnee && oppositeAnkle) {
      const leftAngle = angleDeg(activeHip, activeKnee, activeAnkle);
      const rightAngle = angleDeg(oppositeHip, oppositeKnee, oppositeAnkle);
      const activeDepth = Number.isFinite(leftAngle) ? clamp((170 - leftAngle) / 55, 0, 1) : 0;
      const oppositeDepth = Number.isFinite(rightAngle) ? clamp((170 - rightAngle) / 55, 0, 1) : 0;
      const depth = (activeDepth + oppositeDepth) * 0.5;
      nextLivePose.rootOffsetY = -depth * 0.09;
      nextLivePose.hipsPitch = -depth * 0.3;
      nextLivePose.spinePitch = depth * 0.14;
      nextLivePose.leftThighPitch = -depth * 0.44;
      nextLivePose.rightThighPitch = -depth * 0.44;
      nextLivePose.leftShinPitch = depth * 0.34;
      nextLivePose.rightShinPitch = depth * 0.34;
    } else if ((actionId === "march" || actionId === "step-lift") && activeHip && activeKnee && activeAnkle) {
      const lift = clamp((activeHip.y - activeKnee.y + 0.01) / 0.18, 0, 1);
      applyActiveLeg(-lift * 0.88, lift * 0.5);
      applyOppositeLeg(lift * 0.12, 0);
      nextLivePose.rootOffsetY = lift * 0.04;
      nextLivePose.hipsYaw = lift * sideSign * 0.12;
      nextLivePose.spinePitch = -lift * 0.08;
    } else if (actionId === "side-step" && activeHip && activeAnkle) {
      const lateral = clamp(Math.abs(activeAnkle.x - activeHip.x) / 0.22, 0, 1);
      nextLivePose.rootOffsetX = clamp((activeAnkle.x - activeHip.x) * 1.8, -0.28, 0.28);
      nextLivePose.hipsYaw = nextLivePose.rootOffsetX * 0.45;
      nextLivePose.chestPitch = lateral * 0.08;
      applyActiveLeg(-lateral * 0.22, lateral * 0.05);
    } else if (actionId === "hinge" && activeShoulder && activeHip) {
      const forward = clamp(Math.abs(activeShoulder.x - activeHip.x) / 0.18, 0, 1);
      nextLivePose.hipsPitch = -forward * 0.56;
      nextLivePose.spinePitch = forward * 0.36;
      nextLivePose.chestPitch = forward * 0.18;
      nextLivePose.headPitch = -forward * 0.08;
      nextLivePose.leftThighPitch = -forward * 0.16;
      nextLivePose.rightThighPitch = -forward * 0.16;
    } else if (actionId === "extension" && activeKnee && activeAnkle) {
      const extension = clamp(Math.abs(activeAnkle.x - activeKnee.x) / 0.18, 0, 1);
      applyActiveLeg(-extension * 0.26, extension * 0.68);
      nextLivePose.rootOffsetY = extension * 0.02;
    }

    this.livePoseState = nextLivePose;
  }

  applyActionAnimation(now) {
    const actionId = this.currentActionId || "mini-squat";
    const repPulse = this.getRepPulse(now);
    const sync = clamp(this.motionSync / 100, 0, 1);
    const rhythm = Math.sin(now * 0.008 + this.actionsCompleted * 0.72);
    const cycle = (Math.sin(now * 0.0075) + 1) * 0.5;
    const effort = clamp(0.28 + sync * 0.4 + repPulse * 0.32, 0.22, 1);

    const root = this.heroTargets.root || this.heroTargets.hips;
    const hips = this.heroTargets.hips || root;
    const spine = this.heroTargets.spine || this.heroTargets.chest;
    const chest = this.heroTargets.chest || spine;
    const head = this.heroTargets.head;

    const leftThigh = this.heroTargets.leftThigh;
    const rightThigh = this.heroTargets.rightThigh;
    const leftShin = this.heroTargets.leftShin;
    const rightShin = this.heroTargets.rightShin;

    const rootBaseX = this.getBase(root, "position", "x", Number(root?.position?.x) || 0);
    const rootBaseY = this.getBase(root, "position", "y", Number(root?.position?.y) || 0);

    const hipsBaseX = this.getBase(hips, "rotation", "x", Number(hips?.rotation?.x) || 0);
    const hipsBaseY = this.getBase(hips, "rotation", "y", Number(hips?.rotation?.y) || 0);
    const spineBaseX = this.getBase(spine, "rotation", "x", Number(spine?.rotation?.x) || 0);
    const chestBaseX = this.getBase(chest, "rotation", "x", Number(chest?.rotation?.x) || 0);
    const headBaseX = this.getBase(head, "rotation", "x", Number(head?.rotation?.x) || 0);

    const leftThighBaseX = this.getBase(leftThigh, "rotation", "x", Number(leftThigh?.rotation?.x) || 0);
    const rightThighBaseX = this.getBase(rightThigh, "rotation", "x", Number(rightThigh?.rotation?.x) || 0);
    const leftShinBaseX = this.getBase(leftShin, "rotation", "x", Number(leftShin?.rotation?.x) || 0);
    const rightShinBaseX = this.getBase(rightShin, "rotation", "x", Number(rightShin?.rotation?.x) || 0);

    const leftUpperBaseZ = this.getBase(this.armTargets.leftUpper, "rotation", "z", Number(this.armTargets.leftUpper?.rotation?.z) || 0);
    const rightUpperBaseZ = this.getBase(this.armTargets.rightUpper, "rotation", "z", Number(this.armTargets.rightUpper?.rotation?.z) || 0);
    const leftForeBaseZ = this.getBase(this.armTargets.leftFore, "rotation", "z", Number(this.armTargets.leftFore?.rotation?.z) || 0);
    const rightForeBaseZ = this.getBase(this.armTargets.rightFore, "rotation", "z", Number(this.armTargets.rightFore?.rotation?.z) || 0);
    const live = this.livePoseState || createLivePoseState();

    let rootOffsetX = 0;
    let rootOffsetY = 0;
    let hipsPitch = 0;
    let hipsYaw = 0;
    let spinePitch = 0;
    let chestPitch = 0;
    let headPitch = 0;

    let leftThighPitch = 0;
    let rightThighPitch = 0;
    let leftShinPitch = 0;
    let rightShinPitch = 0;

    let leftUpperDelta = 0;
    let rightUpperDelta = 0;
    let leftForeDelta = 0;
    let rightForeDelta = 0;

    if (actionId === "mini-squat") {
      const depth = (0.08 + 0.09 * effort) * (0.4 + cycle * 0.6 + repPulse * 0.4);
      rootOffsetY = -depth * 0.92;
      hipsPitch = -0.28 * effort * cycle;
      spinePitch = 0.12 * effort * cycle;
      leftThighPitch = -0.42 * effort * cycle;
      rightThighPitch = -0.42 * effort * cycle;
      leftShinPitch = 0.36 * effort * cycle;
      rightShinPitch = 0.36 * effort * cycle;
    } else if (actionId === "march" || actionId === "step-lift") {
      const stride = rhythm * (0.16 + 0.12 * effort);
      rootOffsetY = Math.abs(stride) * 0.07;
      hipsYaw = stride * 0.34;
      spinePitch = -Math.abs(stride) * 0.08;
      leftThighPitch = stride;
      rightThighPitch = -stride;
      leftShinPitch = Math.max(0, stride) * 0.45;
      rightShinPitch = Math.max(0, -stride) * 0.45;
    } else if (actionId === "side-step") {
      const lateral = Math.sin(now * 0.0062) * (0.2 + 0.14 * effort);
      rootOffsetX = lateral;
      hipsYaw = lateral * 0.25;
      chestPitch = Math.abs(lateral) * 0.08;
      leftThighPitch = -Math.max(0, -lateral) * 0.36;
      rightThighPitch = -Math.max(0, lateral) * 0.36;
    } else if (actionId === "hinge") {
      const hinge = cycle * (0.16 + 0.12 * effort);
      hipsPitch = -hinge;
      spinePitch = hinge * 0.68;
      chestPitch = hinge * 0.3;
      headPitch = -hinge * 0.14;
      leftThighPitch = -hinge * 0.22;
      rightThighPitch = -hinge * 0.22;
    } else if (actionId === "raise") {
      const lift = cycle * (0.75 + 0.3 * effort);
      const sideScale = this.side === "left" ? 1 : 0.7;
      leftUpperDelta = this.side === "left" ? -lift : -lift * sideScale;
      rightUpperDelta = this.side === "right" ? lift : lift * sideScale;
      leftForeDelta = leftUpperDelta * 0.56;
      rightForeDelta = rightUpperDelta * 0.56;
      chestPitch = -0.06 * lift;
    } else if (actionId === "cross") {
      const sweep = rhythm * (0.45 + 0.2 * effort);
      leftUpperDelta = -sweep * 0.9;
      rightUpperDelta = sweep * 0.9;
      leftForeDelta = -sweep * 0.45;
      rightForeDelta = sweep * 0.45;
      hipsYaw = sweep * 0.12;
    } else if (actionId === "elbow-drive") {
      const drive = (Math.sin(now * 0.011) + 1) * 0.5 * (0.32 + 0.18 * effort);
      if (this.side === "left") {
        leftUpperDelta = -drive;
        leftForeDelta = drive * 0.82;
      } else {
        rightUpperDelta = drive;
        rightForeDelta = -drive * 0.82;
      }
      chestPitch = -drive * 0.09;
    } else if (actionId === "extension") {
      const kick = (Math.sin(now * 0.0105) + 1) * 0.5 * (0.38 + 0.2 * effort);
      if (this.side === "left") {
        leftThighPitch = -kick * 0.45;
        leftShinPitch = kick * 0.62;
      } else {
        rightThighPitch = -kick * 0.45;
        rightShinPitch = kick * 0.62;
      }
      rootOffsetY = kick * 0.03;
    }

    this.drivePosition(root, "x", rootBaseX + live.rootOffsetX + rootOffsetX, 0.2);
    this.drivePosition(root, "y", rootBaseY + live.rootOffsetY + rootOffsetY, 0.22);

    this.driveRotation(hips, "x", hipsBaseX + live.hipsPitch + hipsPitch, 0.24);
    this.driveRotation(hips, "y", hipsBaseY + live.hipsYaw + hipsYaw, 0.2);
    this.driveRotation(spine, "x", spineBaseX + live.spinePitch + spinePitch, 0.2);
    this.driveRotation(chest, "x", chestBaseX + live.chestPitch + chestPitch, 0.2);
    this.driveRotation(head, "x", headBaseX + live.headPitch + headPitch, 0.15);

    this.driveRotation(leftThigh, "x", leftThighBaseX + live.leftThighPitch + leftThighPitch, 0.22);
    this.driveRotation(rightThigh, "x", rightThighBaseX + live.rightThighPitch + rightThighPitch, 0.22);
    this.driveRotation(leftShin, "x", leftShinBaseX + live.leftShinPitch + leftShinPitch, 0.22);
    this.driveRotation(rightShin, "x", rightShinBaseX + live.rightShinPitch + rightShinPitch, 0.22);

    this.driveRotation(this.armTargets.leftUpper, "z", leftUpperBaseZ + live.leftUpperDelta + leftUpperDelta, 0.24);
    this.driveRotation(this.armTargets.rightUpper, "z", rightUpperBaseZ + live.rightUpperDelta + rightUpperDelta, 0.24);
    this.driveRotation(this.armTargets.leftFore, "z", leftForeBaseZ + live.leftForeDelta + leftForeDelta, 0.24);
    this.driveRotation(this.armTargets.rightFore, "z", rightForeBaseZ + live.rightForeDelta + rightForeDelta, 0.24);
  }

  applyProgressPulse(now) {
    if (!this.materials.length) {
      return;
    }
    const chapterBoost = this.storyChapter.id === "beacon"
      ? 0.25
      : this.storyChapter.id === "roof"
        ? 0.18
        : this.storyChapter.id === "walls"
          ? 0.12
          : this.storyChapter.id === "foundation"
            ? 0.08
            : 0;
    const baseline = 0.34 + (this.progress / 100) * 0.58 + chapterBoost;
    const syncBoost = (this.motionSync / 100) * 0.24;
    const pulse = Math.sin(now * 0.0055) * 0.1;
    const intensity = clamp(baseline + syncBoost + pulse, 0.18, 1.9);

    for (const material of this.materials) {
      if (!material || !Number.isFinite(Number(material.emissiveIntensity))) {
        continue;
      }
      material.emissiveIntensity = intensity;
    }
  }
}
