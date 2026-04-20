import { DEFAULTS } from "./src/config/defaults.js";
import { EVENTS, HydraEventBus } from "./src/core/events.js";
import { clamp, round, safeNumber } from "./src/core/utils.js";
import { AuraScanEngine } from "./src/features/intake/AuraScanEngine.js";
import { NeuralHandshakeEngine } from "./src/features/priming/NeuralHandshakeEngine.js";
import { CardiacGatingEngine } from "./src/features/cardiac/CardiacGatingEngine.js";
import { HydrawavMqttClient } from "./src/features/cardiac/HydrawavMqttClient.js";
import { PlasticityScoreEstimator } from "./src/features/cardiac/PlasticityScoreEstimator.js";
import { AdaptiveBeatSelector } from "./src/features/neuro/AdaptiveBeatSelector.js";
import { ElevenLabsClient } from "./src/features/neuro/ElevenLabsClient.js";
import { NarrationManager } from "./src/features/neuro/NarrationManager.js";
import { NeuroacousticEngine } from "./src/features/neuro/NeuroacousticEngine.js";
import { FascialThermalEngine } from "./src/features/thermal/FascialThermalEngine.js";
import { recommendProtocol, defaultProtocol, inferModality } from "./src/features/adaptive/AdaptiveProtocolEngine.js";
import { recoveryScore } from "./src/features/adaptive/scoring.js";
import { buildGardenSnapshot } from "./src/features/garden/GardenGrowthEngine.js";
import { renderGardenSnapshot } from "./src/features/garden/GardenCanvasRenderer.js";
import { RecoveryGameEngine } from "./src/features/game/RecoveryGameEngine.js";
import { MirrorMotionAdapter } from "./src/features/game/MirrorMotionAdapter.js";
import { VirtualRecoveryWorld } from "./src/features/game/VirtualRecoveryWorld.js";
import { SplineRecoveryWorld } from "./src/features/game/SplineRecoveryWorld.js";
import { getGuideResourceCatalog } from "./src/features/game/ExercisePlanner.js";
import { WearableVitalsBridge } from "./src/features/wearable/WearableVitalsBridge.js";

const STORAGE_KEY = "hydrav_sessions_v1";
const LAST_PATIENT_STORAGE_KEY = "hydrav_last_patient_id_v1";
const LEGACY_PATIENT_ID = "ATHLETE-DEFAULT-001";

const eventBus = new HydraEventBus(window);

const auraScanEngine = new AuraScanEngine({
  eventBus,
  videoEl: byId("aura-video"),
  cameraCanvasEl: byId("aura-camera-canvas"),
  bodyMapCanvasEl: byId("aura-bodymap-canvas"),
  analytics: {
    usePython: DEFAULTS.auraScan.usePythonAnalytics,
    analyzeEndpoint: DEFAULTS.auraScan.analyzeProxyUrl,
    resetEndpoint: DEFAULTS.auraScan.resetProxyUrl,
    backendIntervalMs: DEFAULTS.auraScan.analyticsIntervalMs
  }
});

const wearableBridge = new WearableVitalsBridge({
  onFrame: (frame) => {
    auraScanEngine.ingestWearableSample(frame);
    eventBus.emit(EVENTS.WEARABLE_FRAME, frame);
    publishBiometricFrame({
      timestampMs: frame.timestampMs,
      rPeakDetected: Number.isFinite(frame.rrIntervalMs),
      rrIntervalMs: frame.rrIntervalMs,
      heartRateBpm: frame.heartRateBpm,
      hrvRmssdMs: state.latestBiometrics?.hrvRmssdMs ?? null,
      microsaccadeHz: state.latestBiometrics?.microsaccadeHz ?? null
    });
  },
  onStatus: (payload) => {
    eventBus.emit(EVENTS.WEARABLE_STATUS, payload);
  }
});

const thermalEngine = new FascialThermalEngine({
  eventBus,
  sourceCanvasEl: byId("aura-camera-canvas"),
  overlayCanvasEl: byId("thermal-overlay-canvas"),
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks(),
  getAuraMetrics: () => auraScanEngine.getLatestMetrics(),
  analyzeEndpoint: DEFAULTS.thermal.analyzeProxyUrl,
  sampleFps: DEFAULTS.thermal.sampleFps,
  maxFrames: DEFAULTS.thermal.maxFrames,
  defaultScanDurationSec: DEFAULTS.thermal.scanDurationSec
});

const neuralHandshakeEngine = new NeuralHandshakeEngine({
  eventBus,
  overlayCanvasEl: byId("neural-ghost-canvas"),
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks()
});

const hydrawavMqttClient = new HydrawavMqttClient(eventBus, {
  loginProxyUrl: DEFAULTS.cardiac.mqtt.loginProxyUrl,
  publishProxyUrl: DEFAULTS.cardiac.mqtt.publishProxyUrl
});
const plasticityEstimator = new PlasticityScoreEstimator();
const cardiacEngine = new CardiacGatingEngine({
  eventBus,
  plasticityEstimator,
  defaultOffsetMs: DEFAULTS.cardiac.gateOffsetMs
});

const selector = new AdaptiveBeatSelector();
const neuroEngine = new NeuroacousticEngine({
  eventBus,
  selector,
  carrierHz: DEFAULTS.neuro.carrierHz,
  masterGain: DEFAULTS.neuro.volume
});

const elevenLabsClient = new ElevenLabsClient({
  proxyUrl: DEFAULTS.voice.proxyUrl,
  voiceId: DEFAULTS.voice.voiceId,
  modelId: DEFAULTS.voice.modelId,
  voiceSettings: DEFAULTS.voice.voiceSettings
});

const narrationManager = new NarrationManager({
  eventBus,
  elevenLabsClient
});

const elements = {
  appShell: byId("app-shell"),
  patientEntryScreen: byId("patient-entry-screen"),
  patientIdInput: byId("patient-id-input"),
  patientLookupSummary: byId("patient-lookup-summary"),
  patientLookupList: byId("patient-lookup-list"),
  patientStartSession: byId("patient-start-session"),
  heroPatientId: byId("hero-patient-id"),
  anatomyPanel: byId("anatomy-panel"),
  anatomyPanelTitle: byId("anatomy-panel-title"),
  anatomyPanelSubtitle: byId("anatomy-panel-subtitle"),
  anatomyScanView: byId("anatomy-scan-view"),
  anatomyGameView: byId("anatomy-game-view"),
  auraBodymapCanvas: byId("aura-bodymap-canvas"),
  gameTrackerCanvas: byId("game-tracker-canvas"),
  leftMetricPosture: byId("left-metric-posture"),
  leftMetricHeart: byId("left-metric-heart"),
  leftMetricBalance: byId("left-metric-balance"),
  leftMetricCalories: byId("left-metric-calories"),
  leftMetricJoint: byId("left-metric-joint"),
  leftGameActionTitle: byId("left-game-action-title"),
  leftGameActionDesc: byId("left-game-action-desc"),
  leftGameImpact: byId("left-game-impact"),
  leftGameReps: byId("left-game-reps"),
  leftGameNext: byId("left-game-next"),
  stepIntake: byId("step-intake"),
  stepGame: byId("step-game"),
  stepSummary: byId("step-summary"),
  stageIntakePanel: byId("stage-intake-panel"),
  stageGamePanel: byId("stage-game-panel"),
  stagePostscanPanel: byId("stage-postscan-panel"),
  stageSummaryPanel: byId("stage-summary-panel"),
  summarySection: byId("summary-section"),
  auraStatusPill: byId("aura-status-pill"),
  thermalStatusPill: byId("thermal-status-pill"),
  handshakeStatusPill: byId("handshake-status-pill"),
  cardiacStatusPill: byId("cardiac-engine-status"),
  deviceApiStatusPill: byId("device-api-status"),
  wearableStatusPill: byId("wearable-status"),
  neuroPhasePill: byId("neuro-phase-status"),
  voiceStatusPill: byId("voice-status"),
  cameraStage: byId("camera-stage"),
  virtualGameCanvas: byId("virtual-game-canvas"),
  auraCameraCanvas: byId("aura-camera-canvas"),
  gameOverlayCanvas: byId("game-overlay-canvas"),
  startCameraButton: byId("start-camera"),
  stopCameraButton: byId("stop-camera"),
  scanDurationInput: byId("intake-scan-duration"),
  startIntakeScanButton: byId("start-intake-scan"),
  intakeProgressLabel: byId("intake-progress-label"),
  scanInlineProgress: byId("scan-inline-progress"),
  intakeAnalysisText: byId("intake-analysis-text"),
  intakeNextButton: byId("intake-next-button"),
  gameStartButton: byId("game-start-button"),
  gameSkipButton: byId("game-skip-button"),
  gameStopButton: byId("game-stop-button"),
  gameStatus: byId("game-status"),
  gameActionTitle: byId("game-action-title"),
  gameActionDesc: byId("game-action-desc"),
  gameImpactText: byId("game-impact-text"),
  gameNextUp: byId("game-next-up"),
  gameScore: byId("game-score"),
  gameReps: byId("game-reps"),
  gameActionsCount: byId("game-actions-count"),
  gameMotionSync: byId("game-motion-sync"),
  gameProgressFill: byId("game-progress-fill"),
  worldBuildOverall: byId("world-build-overall"),
  worldBuildFill: byId("world-build-fill"),
  worldBuildFoundation: byId("world-build-formation"),
  worldBuildWalls: byId("world-build-walls"),
  worldBuildRoof: byId("world-build-roof"),
  worldBuildPeak: byId("world-build-peak"),
  worldActionLog: byId("world-action-log"),
  postscanStatus: byId("postscan-status"),
  summaryStatus: byId("summary-status"),
  summaryHrvDelta: byId("summary-hrv-delta"),
  summarySymmetryGain: byId("summary-symmetry-gain"),
  summaryMicroGain: byId("summary-micro-gain"),
  summaryReadinessGain: byId("summary-readiness-gain"),
  summaryRomGain: byId("summary-rom-gain"),
  summaryGameScore: byId("summary-game-score"),
  summaryMotionSync: byId("summary-motion-sync"),
  summaryAnalysisText: byId("summary-analysis-text"),
  summaryLiveImpact: byId("summary-live-impact"),
  patientHistorySummary: byId("patient-history-summary"),
  patientHistoryList: byId("patient-history-list"),
  summaryPlayVoice: byId("summary-play-voice"),
  summaryRestart: byId("summary-restart"),
  recModelMode: byId("rec-model-mode"),
  recImprovement: byId("rec-improvement"),
  recConfidence: byId("rec-confidence"),
  recUncertainty: byId("rec-uncertainty"),
  recRationale: byId("rec-rationale"),
  recWarnings: byId("rec-warnings"),
  recParams: byId("rec-params"),
  gardenCanvas: byId("garden-canvas"),
  gardenMilestones: byId("garden-milestones"),
  gardenSpecies: byId("garden-species"),
  metricAuraHr: byId("metric-aura-hr"),
  metricAuraHrv: byId("metric-aura-hrv"),
  metricAuraSymmetry: byId("metric-aura-symmetry"),
  metricAuraMicro: byId("metric-aura-micro"),
  metricAuraBreath: byId("metric-aura-breath"),
  metricAuraReadiness: byId("metric-aura-readiness"),
  metricAuraAlgorithm: byId("metric-aura-algorithm"),
  metricAuraSource: byId("metric-aura-source"),
  metricHeartRate: byId("metric-heart-rate"),
  metricRR: byId("metric-rr"),
  metricMicro: byId("metric-micro"),
  metricPlasticity: byId("metric-plasticity"),
  mqttApiBaseUrlInput: byId("mqtt-api-base-url"),
  mqttUsernameInput: byId("mqtt-username"),
  mqttPasswordInput: byId("mqtt-password"),
  mqttTopicInput: byId("mqtt-topic"),
  mqttDeviceMacInput: byId("mqtt-device-mac"),
  mqttLoginButton: byId("mqtt-login"),
  mqttStartButton: byId("mqtt-start"),
  mqttPauseButton: byId("mqtt-pause"),
  mqttResumeButton: byId("mqtt-resume"),
  mqttStopButton: byId("mqtt-stop"),
  wearableConnectButton: byId("wearable-connect"),
  wearableDisconnectButton: byId("wearable-disconnect"),
  gateOffsetInput: byId("gate-offset"),
  gateOffsetValue: byId("gate-offset-value"),
  toggleGatingButton: byId("toggle-gating"),
  voiceEnabledInput: byId("voice-enabled"),
  metricGateCount: byId("metric-gate-count"),
  metricLastDelay: byId("metric-last-delay"),
  metricSeqId: byId("metric-seq-id"),
  runtimeLog: byId("runtime-log")
};

const state = {
  stage: "intake",
  scanMode: null,
  cameraRunning: false,
  intakeReady: false,
  baselineMetrics: null,
  postMetrics: null,
  thermalResult: null,
  latestBiometrics: {},
  plasticity: null,
  mqtt: {
    status: "logged_out",
    hasToken: false
  },
  wearable: {
    status: "idle",
    source: null
  },
  gameRunning: false,
  gameResult: null,
  voiceEnabled: DEFAULTS.voice.enabled,
  sessionContext: { athleteName: "Athlete", focusZone: "left shoulder" },
  protocolContext: { focusZone: "left shoulder", modality: "hybrid" },
  sessions: loadSessions(),
  activePatientId: null,
  patientSessions: [],
  recommendation: null,
  activeProtocol: defaultProtocol(),
  gardenSnapshot: null,
  lastSummaryRecord: null
};

const UI_PERF = Object.freeze({
  auraPanelMs: 120,
  biometricPanelMs: 100,
  gameTrackerMs: 180
});

let lastAuraPanelUpdateAt = 0;
let lastBiometricPanelUpdateAt = 0;
let lastGameTrackerSyncAt = 0;
let lastWorldStoryId = null;
let lastGameRepMarker = "";
let gameHudAnimationRafId = null;
const gameHudDisplay = {
  score: 0,
  targetScore: 0,
  motionSync: null,
  targetMotionSync: null,
  progress: 0,
  targetProgress: 0
};

const motionAdapter = DEFAULTS.game.useMirrorMotionAdapter
  ? new MirrorMotionAdapter()
  : null;
const threeRecoveryWorld = new VirtualRecoveryWorld({
  canvasEl: elements.virtualGameCanvas,
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks()
});
const splineRecoveryWorld = new SplineRecoveryWorld({
  canvasEl: elements.virtualGameCanvas,
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks(),
  sceneUrl: DEFAULTS.game.splineSceneUrl
});

const gameWorldMode = String(DEFAULTS.game.worldEngine || "three").toLowerCase();
const preferredRecoveryWorld = gameWorldMode === "spline"
  ? splineRecoveryWorld
  : gameWorldMode === "hybrid"
    ? splineRecoveryWorld
    : threeRecoveryWorld;
let activeRecoveryWorld = preferredRecoveryWorld;

function worldEngineName(world) {
  return world === splineRecoveryWorld ? "spline" : "three";
}

function setActiveRecoveryWorld(world) {
  activeRecoveryWorld = world;
}

function resetRecoveryWorldPreference() {
  setActiveRecoveryWorld(preferredRecoveryWorld);
}

async function startRecoveryWorld(context) {
  const preferredWorld = activeRecoveryWorld;
  try {
    await Promise.resolve(preferredWorld.start(context));
    return preferredWorld;
  } catch (error) {
    if (preferredWorld !== threeRecoveryWorld) {
      log(`Spline world unavailable (${error.message}). Falling back to Three.js world.`, "warn");
      setActiveRecoveryWorld(threeRecoveryWorld);
      await Promise.resolve(threeRecoveryWorld.start(context));
      return threeRecoveryWorld;
    }
    throw error;
  }
}

const gameEngine = new RecoveryGameEngine({
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks(),
  getBiometrics: () => state.latestBiometrics,
  getPlannerContext: () => ({
    ...(state.baselineMetrics || {}),
    ...(state.latestBiometrics || {}),
    thermalSun: state.thermalResult?.recommendedPads?.sun || null
  }),
  overlayCanvasEl: elements.gameOverlayCanvas,
  motionAdapter,
  useMirrorMotion: DEFAULTS.game.useMirrorMotionOnLeftShoulder,
  onStatus: (payload) => {
    const difficultyTag = payload.difficulty ? ` | ${payload.difficulty.toUpperCase()} plan` : "";
    elements.gameStatus.textContent = payload.status === "running"
      ? `Guided game running (${payload.side} ${payload.zone}${difficultyTag}).`
      : "Game stopped.";
    if (payload.status !== "running") {
      stopGameHudAnimation(true);
    }
    if (payload.status === "running" && payload.plannerRationale) {
      appendWorldLog(`Planner: ${payload.plannerRationale}`);
    }
  },
  onProgress: (payload) => {
    setGameHudTargets(payload);
    elements.gameReps.textContent = `${payload.repsDone} / ${payload.repsTarget}`;
    elements.leftGameReps.textContent = `${payload.repsDone} / ${payload.repsTarget}`;
    elements.gameActionsCount.textContent = `${payload.actionsCompleted} / ${payload.actionsTotal}`;
    activeRecoveryWorld?.update(payload);
    updateWorldBuildUi();

    const stats = activeRecoveryWorld?.getBuildStats?.();
    const actionImpact = describeActionImpact(payload.actionId);
    const movementFeedback = buildGameMovementFeedback(payload);
    const storyLineValue = stats?.liveStory?.line || stats?.story?.line || "";
    const storyLine = storyLineValue ? ` ${storyLineValue}` : "";
    const repMarker = `${payload.actionId || "none"}:${payload.repsDone || 0}`;
    if ((payload.repsDone || 0) > 0 && repMarker !== lastGameRepMarker) {
      lastGameRepMarker = repMarker;
      appendWorldLog(`Clean rep ${payload.repsDone}/${payload.repsTarget} captured for ${payload.actionLabel || payload.actionId || "movement"}.`);
    }
    const combinedImpact = `${movementFeedback} ${actionImpact}${storyLine}`.trim();
    elements.gameImpactText.textContent = combinedImpact;
    elements.leftGameImpact.textContent = combinedImpact;
  },
  onActionChanged: (payload) => {
    elements.gameActionTitle.textContent = `Action ${payload.index + 1}: ${payload.label}`;
    elements.gameActionDesc.textContent = payload.description;
    elements.leftGameActionTitle.textContent = payload.label;
    elements.leftGameActionDesc.textContent = payload.description;
    elements.gameImpactText.textContent = describeActionImpact(payload.id);
    elements.leftGameImpact.textContent = describeActionImpact(payload.id);
    elements.gameNextUp.textContent = payload.nextLabel || "Finalize build sequence";
    elements.leftGameNext.textContent = payload.nextLabel || "Finalize build sequence";
    appendWorldLog(`Action ${payload.index + 1} active: ${payload.label}`);
    void speakActionCue(payload);
  },
  onComplete: (summary) => {
    void handleGameComplete(summary);
  }
});

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

function normalizePatientId(value, fallback = "") {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
  return normalized || fallback;
}

function cloneSerializable(value) {
  if (value == null) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function loadLastPatientId() {
  try {
    return normalizePatientId(localStorage.getItem(LAST_PATIENT_STORAGE_KEY) || "");
  } catch {
    return "";
  }
}

function persistLastPatientId(patientId) {
  const normalized = normalizePatientId(patientId);
  if (!normalized) {
    return;
  }
  localStorage.setItem(LAST_PATIENT_STORAGE_KEY, normalized);
}

function normalizeStoredSession(session = {}) {
  const protocol = session.protocol && typeof session.protocol === "object"
    ? session.protocol
    : defaultProtocol();

  return {
    id: typeof session.id === "string" && session.id ? session.id : (crypto.randomUUID?.() || `session-${Date.now()}`),
    athleteId: normalizePatientId(session.athleteId || session.patientId || LEGACY_PATIENT_ID, LEGACY_PATIENT_ID),
    createdAt: typeof session.createdAt === "string" && session.createdAt ? session.createdAt : new Date().toISOString(),
    modality: session.modality || inferModality(protocol),
    protocol,
    outcomes: session.outcomes && typeof session.outcomes === "object" ? session.outcomes : {},
    focusZone: typeof session.focusZone === "string" && session.focusZone ? session.focusZone : "left shoulder",
    baselineMetrics: session.baselineMetrics ?? null,
    postMetrics: session.postMetrics ?? null,
    gameSummary: session.gameSummary ?? null
  };
}

function getSessionsForPatient(patientId, sessions = state.sessions) {
  const normalized = normalizePatientId(patientId);
  if (!normalized) {
    return [];
  }
  return sessions.filter((session) => normalizePatientId(session?.athleteId, LEGACY_PATIENT_ID) === normalized);
}

function getActivePatientSessions() {
  return state.activePatientId ? getSessionsForPatient(state.activePatientId) : [];
}

function normalizeFrame(frame = {}) {
  return {
    timestampMs: Number.isFinite(frame.timestampMs) ? frame.timestampMs : performance.now(),
    rPeakDetected: !!(frame.rPeakDetected || frame.rPeak || frame.isRPeak),
    rrIntervalMs: safeNumber(frame.rrIntervalMs ?? frame.rrMs, null),
    heartRateBpm: safeNumber(frame.heartRateBpm ?? frame.hrBpm, null),
    hrvRmssdMs: safeNumber(frame.hrvRmssdMs ?? frame.hrvRmssd ?? frame.hrv, null),
    microsaccadeHz: safeNumber(frame.microsaccadeHz ?? frame.microSaccadeHz, null)
  };
}

function publishBiometricFrame(frame) {
  eventBus.emit(EVENTS.BIOMETRIC_FRAME, normalizeFrame(frame));
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((session) => normalizeStoredSession(session)) : [];
  } catch {
    return [];
  }
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
}

async function checkRuntimeHealth() {
  try {
    const response = await fetch("/api/health", { method: "GET" });
    if (!response.ok) {
      return;
    }
    const health = await response.json();
    if (!health.elevenLabsConfigured) {
      setPill(elements.voiceStatusPill, "Need API Key", "warn");
      log("ElevenLabs key missing on server. Voice will use browser fallback.", "warn");
    }
  } catch {
    // No-op: runtime health endpoint may be unavailable briefly during startup.
  }
}

function isWebGpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function setStage(stage) {
  state.stage = stage;
  elements.appShell.classList.remove("stage-intake", "stage-game", "stage-postscan", "stage-summary");
  elements.appShell.classList.add(`stage-${stage}`);
  elements.stageIntakePanel.classList.toggle("hidden", stage !== "intake");
  elements.stageGamePanel.classList.toggle("hidden", stage !== "game");
  elements.stagePostscanPanel.classList.toggle("hidden", stage !== "postscan");
  elements.stageSummaryPanel.classList.toggle("hidden", stage !== "summary");
  elements.summarySection.classList.toggle("hidden", stage !== "summary");
  elements.cameraStage.classList.toggle("game-mode", stage === "game");
  updateAnatomyPanelForStage(stage);
  elements.stepIntake.classList.toggle("step-active", stage === "intake");
  elements.stepGame.classList.toggle("step-active", stage === "game" || stage === "postscan");
  elements.stepSummary.classList.toggle("step-active", stage === "summary");
  scheduleOverlayResize();
}

function formatTimer(seconds) {
  const total = Math.max(Math.floor(Number(seconds) || 0), 0);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function setScanTimer(seconds) {
  elements.scanInlineProgress.textContent = formatTimer(seconds);
}

function activeScanDurationSec(mode) {
  if (mode === "baseline") {
    return clamp(Number(elements.scanDurationInput.value) || DEFAULTS.auraScan.scanDurationSec, 20, 180);
  }
  if (mode === "post") {
    return 20;
  }
  if (mode === "game-monitor") {
    return 180;
  }
  return DEFAULTS.auraScan.scanDurationSec;
}

function describeActionImpact(actionId) {
  const map = {
    raise: "The hero lifts a sky beam to open the upper gates.",
    cross: "Cross-link braces tighten and steady the structure.",
    "elbow-drive": "Side locks engage and reinforce your shield walls.",
    march: "Power steps energize the foundation path.",
    "side-step": "Lateral movement extends the defensive wall line.",
    hinge: "Core hinge anchors the rear support arc.",
    "mini-squat": "Each squat lifts a cornerstone into position.",
    "step-lift": "Step lifts stack a recovery tower segment.",
    extension: "Leg extension pushes the final bridge span forward."
  };
  return map[actionId] || "Each rep powers the hero and rebuilds the recovery world.";
}

function describeMovementFix(actionId) {
  const tips = {
    raise: "Lift the working wrist higher than shoulder level, then return with control.",
    cross: "Reach further across the midline before coming back to neutral.",
    "elbow-drive": "Drive the elbow farther back and pause before resetting.",
    march: "Bring the knee higher toward hip level to lock the rep.",
    "side-step": "Step wider to the side, then bring the foot back under control.",
    hinge: "Hinge the torso farther forward from the hips, then return tall.",
    "mini-squat": "Drop slightly deeper into the squat and finish upright.",
    "step-lift": "Lift the stepping foot higher before placing it back down softly.",
    extension: "Extend the lower leg farther forward before returning."
  };
  return tips[actionId] || "Match the preview closely, then return to the start position to count the rep.";
}

function buildGameMovementFeedback(payload = {}) {
  const actionId = payload.actionId;
  const matchScore = Number(payload.movementMatchScore);
  const requiredMatch = Number(payload.requiredMatchScore);
  const tracking = Number(payload.trackingConfidence);
  const requiredTracking = Number(payload.requiredTrackingScore);

  if (Number.isFinite(tracking) && Number.isFinite(requiredTracking) && tracking < requiredTracking) {
    return "Keep the full working side visible in frame so the rep can be validated.";
  }

  if (Number.isFinite(matchScore) && Number.isFinite(requiredMatch) && matchScore >= requiredMatch) {
    return "Clean form matched. Return to the start position to register the rep.";
  }

  return describeMovementFix(actionId);
}

function appendWorldLog(message) {
  const li = document.createElement("li");
  li.textContent = message;
  elements.worldActionLog.prepend(li);
  while (elements.worldActionLog.children.length > 8) {
    elements.worldActionLog.removeChild(elements.worldActionLog.lastChild);
  }
}

function renderGameHudDisplay() {
  elements.gameScore.textContent = `${Math.round(gameHudDisplay.score)}%`;
  elements.gameProgressFill.style.width = `${clamp(gameHudDisplay.progress, 0, 100)}%`;
  elements.gameMotionSync.textContent = Number.isFinite(gameHudDisplay.motionSync)
    ? `${Math.round(gameHudDisplay.motionSync)}%`
    : "-- %";
}

function stopGameHudAnimation(reset = false) {
  if (gameHudAnimationRafId) {
    cancelAnimationFrame(gameHudAnimationRafId);
    gameHudAnimationRafId = null;
  }

  if (reset) {
    gameHudDisplay.score = 0;
    gameHudDisplay.targetScore = 0;
    gameHudDisplay.motionSync = null;
    gameHudDisplay.targetMotionSync = null;
    gameHudDisplay.progress = 0;
    gameHudDisplay.targetProgress = 0;
    renderGameHudDisplay();
  }
}

function stepGameHudAnimation() {
  gameHudAnimationRafId = null;

  const scoreDelta = gameHudDisplay.targetScore - gameHudDisplay.score;
  const progressDelta = gameHudDisplay.targetProgress - gameHudDisplay.progress;
  gameHudDisplay.score += scoreDelta * 0.22;
  gameHudDisplay.progress += progressDelta * 0.22;

  if (Number.isFinite(gameHudDisplay.targetMotionSync)) {
    const current = Number.isFinite(gameHudDisplay.motionSync)
      ? gameHudDisplay.motionSync
      : gameHudDisplay.targetMotionSync;
    gameHudDisplay.motionSync = current + ((gameHudDisplay.targetMotionSync - current) * 0.18);
  } else {
    gameHudDisplay.motionSync = null;
  }

  renderGameHudDisplay();

  const done = Math.abs(scoreDelta) < 0.18
    && Math.abs(progressDelta) < 0.18
    && (
      (!Number.isFinite(gameHudDisplay.targetMotionSync) && !Number.isFinite(gameHudDisplay.motionSync))
      || Math.abs((gameHudDisplay.targetMotionSync || 0) - (gameHudDisplay.motionSync || 0)) < 0.3
    );

  if (!done) {
    gameHudAnimationRafId = requestAnimationFrame(stepGameHudAnimation);
    return;
  }

  gameHudDisplay.score = gameHudDisplay.targetScore;
  gameHudDisplay.progress = gameHudDisplay.targetProgress;
  gameHudDisplay.motionSync = Number.isFinite(gameHudDisplay.targetMotionSync)
    ? gameHudDisplay.targetMotionSync
    : null;
  renderGameHudDisplay();
}

function setGameHudTargets(payload = {}) {
  gameHudDisplay.targetScore = clamp(Number(payload.score || 0), 0, 100);
  gameHudDisplay.targetProgress = clamp(Number(payload.score || 0), 0, 100);
  gameHudDisplay.targetMotionSync = Number.isFinite(payload.motionSyncScore)
    ? clamp(Number(payload.motionSyncScore), 0, 100)
    : null;

  if (!gameHudAnimationRafId) {
    gameHudAnimationRafId = requestAnimationFrame(stepGameHudAnimation);
  }
}

function resetWorldUi() {
  stopGameHudAnimation(true);
  elements.worldBuildOverall.textContent = "0 / 35";
  elements.worldBuildFill.style.width = "0%";
  elements.worldBuildFoundation.textContent = "0 / 9";
  elements.worldBuildWalls.textContent = "0 / 16";
  elements.worldBuildRoof.textContent = "0 / 9";
  elements.worldBuildPeak.textContent = "0 / 1";
  elements.worldActionLog.innerHTML = "";
  lastWorldStoryId = null;
  lastGameRepMarker = "";
}

function updateWorldBuildUi() {
  const stats = activeRecoveryWorld?.getBuildStats?.();
  if (!stats) {
    return;
  }
  elements.worldBuildOverall.textContent = `${stats.totalPlaced} / ${stats.totalTarget}`;
  elements.worldBuildFill.style.width = `${clamp((stats.totalPlaced / Math.max(stats.totalTarget, 1)) * 100, 0, 100)}%`;
  elements.worldBuildFoundation.textContent = `${stats.foundation} / ${stats.targets.foundation}`;
  elements.worldBuildWalls.textContent = `${stats.walls} / ${stats.targets.walls}`;
  elements.worldBuildRoof.textContent = `${stats.roof} / ${stats.targets.roof}`;
  elements.worldBuildPeak.textContent = `${stats.peak} / ${stats.targets.peak}`;

  if (stats.story?.id && stats.story.id !== lastWorldStoryId) {
    lastWorldStoryId = stats.story.id;
    const title = stats.story.title ? `${stats.story.title}: ` : "";
    appendWorldLog(`${title}${stats.story.line || "Recovery world evolving."}`);
  }
}

function updateAnatomyPanelForStage(stage) {
  const gameLike = stage === "game" || stage === "postscan";
  elements.anatomyScanView.classList.toggle("hidden", gameLike);
  elements.anatomyGameView.classList.toggle("hidden", !gameLike);
  
  const gameBuildPanel = byId("game-build-panel");
  if (gameBuildPanel) {
    gameBuildPanel.style.display = gameLike ? "flex" : "none";
  }
  
  if (gameLike) {
    elements.anatomyPanelTitle.textContent = "Current Exercise";
    elements.anatomyPanelSubtitle.textContent = "Track reps and movement while building progress.";
  } else {
    elements.anatomyPanelTitle.textContent = "Body Map";
    elements.anatomyPanelSubtitle.textContent = "Cold-zone targeting with live scan metrics.";
  }
}

function updateLeftScanMetrics(frame = {}) {
  const symmetry = Number(frame.symmetryDeltaPct);
  const readiness = Number(frame.readinessScore);
  const heart = Number(frame.heartRateBpm);

  if (Number.isFinite(heart)) {
    elements.leftMetricHeart.textContent = `${round(heart, 1)} bpm`;
  }
  if (Number.isFinite(symmetry)) {
    const posture = clamp(100 - symmetry * 2, 0, 100);
    const balance = clamp(100 - symmetry * 1.4, 0, 100);
    elements.leftMetricPosture.textContent = `${round(posture, 1)} %`;
    elements.leftMetricBalance.textContent = `${round(balance, 1)} %`;
  }
  if (Number.isFinite(readiness)) {
    elements.leftMetricJoint.textContent = readiness >= 7
      ? "GOOD"
      : readiness >= 5
        ? "MODERATE"
        : "NEEDS FOCUS";
  }
}

function syncGameTrackerFromBodyMap() {
  if (state.stage !== "game" && state.stage !== "postscan") {
    return;
  }
  if (document.hidden) {
    return;
  }

  const nowMs = performance.now();
  if (nowMs - lastGameTrackerSyncAt < UI_PERF.gameTrackerMs) {
    return;
  }
  lastGameTrackerSyncAt = nowMs;

  const src = elements.auraBodymapCanvas;
  const dst = elements.gameTrackerCanvas;
  if (!src || !dst || !src.width || !src.height) {
    return;
  }
  if (dst.width !== src.width || dst.height !== src.height) {
    dst.width = src.width;
    dst.height = src.height;
  }
  const ctx = dst.getContext("2d");
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
}

function setPill(element, text, type = "idle") {
  element.textContent = text;
  element.className = `pill ${type === "live" ? "pill-live" : type === "warn" ? "pill-warn" : "pill-idle"}`;
}

function humanize(value) {
  return String(value || "idle").replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function log(message, level = "info") {
  const timestamp = new Date().toLocaleTimeString();
  const li = document.createElement("li");
  li.textContent = `[${timestamp}] ${message}`;
  if (level === "warn") {
    li.style.borderColor = "#f2bb8f";
    li.style.background = "#fff1e4";
    li.style.color = "#7e4208";
  }
  elements.runtimeLog.prepend(li);
  while (elements.runtimeLog.children.length > 70) {
    elements.runtimeLog.removeChild(elements.runtimeLog.lastChild);
  }
}

function asDelta(value, suffix = "") {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${round(value, 2)}${suffix}`;
}

function formatSessionTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }
  return date.toLocaleString();
}

function summarizePatientSession(session) {
  const parts = [];
  const score = recoveryScore(session);
  const symmetryGain = Number(session?.outcomes?.symmetryGain);
  const hrvDelta = Number(session?.outcomes?.hrvDelta);
  const motionMatch = Number(session?.gameSummary?.movementMatchAvg);

  if (Number.isFinite(score)) {
    parts.push(`Score ${score}`);
  }
  if (Number.isFinite(symmetryGain)) {
    parts.push(`Sym ${asDelta(symmetryGain, "%")}`);
  }
  if (Number.isFinite(hrvDelta)) {
    parts.push(`HRV ${asDelta(hrvDelta, " ms")}`);
  }
  if (Number.isFinite(motionMatch)) {
    parts.push(`Move ${Math.round(motionMatch)}%`);
  }

  return parts.length ? parts.join(" | ") : "Session recorded";
}

function buildPatientContinuityState(patientId = state.activePatientId, currentRecord = null) {
  const normalized = normalizePatientId(patientId);
  if (!normalized) {
    return {
      patientId: "",
      sessions: [],
      priorSessions: [],
      latestPrior: null,
      summary: "Enter a patient ID to retrieve previous sessions before starting.",
      items: []
    };
  }

  const sessions = getSessionsForPatient(normalized);
  const priorSessions = currentRecord
    ? sessions.filter((session) => session.id !== currentRecord.id)
    : sessions;
  const latestPrior = priorSessions.at(-1) || null;

  let summary = "";
  if (!priorSessions.length) {
    summary = currentRecord
      ? `First recorded session stored for ${normalized}. Future visits will compare against today's baseline.`
      : `No prior sessions found for ${normalized}. Starting a new continuity baseline.`;
  } else {
    const plural = priorSessions.length === 1 ? "" : "s";
    summary = `${priorSessions.length} prior session${plural} found for ${normalized}. Last visit ${formatSessionTimestamp(latestPrior.createdAt)}.`;
  }

  const items = [];
  if (currentRecord) {
    items.push(`Today | ${summarizePatientSession(currentRecord)}`);
  }

  const historyRows = (currentRecord ? priorSessions : sessions).slice(-3).reverse();
  historyRows.forEach((session) => {
    items.push(`${formatSessionTimestamp(session.createdAt)} | ${summarizePatientSession(session)}`);
  });

  if (!items.length) {
    items.push(currentRecord
      ? "Today's session becomes the first continuity baseline."
      : "No saved sessions yet for this patient.");
  }

  return {
    patientId: normalized,
    sessions,
    priorSessions,
    latestPrior,
    summary,
    items
  };
}

function renderTextList(element, items = []) {
  element.innerHTML = "";
  items.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    element.appendChild(li);
  });
}

function renderPatientLookupPreview(patientId = elements.patientIdInput.value) {
  const normalized = normalizePatientId(patientId);
  elements.patientStartSession.disabled = !normalized;

  if (!normalized) {
    elements.patientLookupSummary.textContent = "Enter a patient ID to retrieve previous sessions before starting.";
    elements.patientLookupList.innerHTML = "";
    return;
  }

  const continuity = buildPatientContinuityState(normalized);
  elements.patientLookupSummary.textContent = continuity.summary;
  renderTextList(elements.patientLookupList, continuity.items);
}

function renderPatientHistory(currentRecord = null) {
  const continuity = buildPatientContinuityState(state.activePatientId, currentRecord);
  elements.patientHistorySummary.textContent = continuity.summary;
  renderTextList(elements.patientHistoryList, continuity.items);
  return continuity;
}

function showPatientEntryScreen() {
  elements.patientEntryScreen.classList.remove("hidden");
  elements.appShell.classList.add("hidden");
}

function showAppShell() {
  elements.patientEntryScreen.classList.add("hidden");
  elements.appShell.classList.remove("hidden");
  scheduleOverlayResize();
}

function activatePatient(patientId) {
  const normalized = normalizePatientId(patientId);
  if (!normalized) {
    return "";
  }

  state.activePatientId = normalized;
  state.patientSessions = getSessionsForPatient(normalized);
  state.sessionContext = { ...state.sessionContext, athleteName: normalized };
  eventBus.emit(EVENTS.SESSION_CONTEXT, { ...state.sessionContext });
  elements.heroPatientId.textContent = normalized;
  elements.patientIdInput.value = normalized;
  persistLastPatientId(normalized);
  hydrateAdaptiveState();
  return normalized;
}

function safeDelta(after, before) {
  if (!Number.isFinite(after) || !Number.isFinite(before)) {
    return null;
  }
  return after - before;
}

function getTopFlaggedZone(metrics) {
  if (!Array.isArray(metrics?.flaggedZones) || !metrics.flaggedZones.length) {
    return null;
  }
  return [...metrics.flaggedZones].sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}

function getFocusTarget() {
  const thermalSun = state.thermalResult?.recommendedPads?.sun;
  if (thermalSun?.zone && thermalSun?.side) {
    return { zone: thermalSun.zone, side: thermalSun.side };
  }
  const baselineTop = getTopFlaggedZone(state.baselineMetrics);
  if (baselineTop?.zone && baselineTop?.side) {
    return { zone: baselineTop.zone, side: baselineTop.side };
  }
  return { zone: "shoulder", side: "left" };
}

function setSessionAndProtocolFocus(zone, side) {
  const label = `${side} ${zone}`;
  state.sessionContext = { ...state.sessionContext, focusZone: label };
  state.protocolContext = { ...state.protocolContext, focusZone: label };
  eventBus.emit(EVENTS.SESSION_CONTEXT, { ...state.sessionContext });
  eventBus.emit(EVENTS.PROTOCOL_CONTEXT, { ...state.protocolContext });
}

function formatInsightValue(insight) {
  if (insight.key === "vibrationHz") {
    return `${Math.round(insight.value)} Hz`;
  }
  if (insight.key === "padDurationMin") {
    return `${Math.round(insight.value)} min`;
  }
  if (insight.key === "contralateralTargeting") {
    return insight.value >= 0.5 ? "Enabled" : "Disabled";
  }
  return `${Math.round(insight.value * 100)}%`;
}

function renderRecommendation() {
  const rec = state.recommendation;
  if (!rec) {
    return;
  }
  elements.recModelMode.textContent = rec.modelMode;
  elements.recImprovement.textContent = round(rec.expectedImprovement, 2).toFixed(2);
  elements.recConfidence.textContent = `${Math.round(rec.confidence * 100)}%`;
  elements.recUncertainty.textContent = round(rec.uncertainty, 2).toFixed(2);

  elements.recRationale.innerHTML = "";
  rec.rationale.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    elements.recRationale.appendChild(li);
  });

  elements.recWarnings.innerHTML = "";
  const warnings = rec.warnings.length ? rec.warnings : ["No plateau warnings for this athlete profile yet."];
  warnings.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    elements.recWarnings.appendChild(li);
  });

  elements.recParams.innerHTML = "";
  rec.parameterInsights.forEach((insight) => {
    const row = document.createElement("div");
    row.className = "confidence-row";
    const labels = document.createElement("div");
    labels.className = "confidence-labels";
    const left = document.createElement("span");
    left.textContent = insight.label;
    const right = document.createElement("span");
    right.textContent = formatInsightValue(insight);
    labels.appendChild(left);
    labels.appendChild(right);
    const track = document.createElement("div");
    track.className = "confidence-track";
    const fill = document.createElement("div");
    fill.style.width = `${clamp(insight.confidence, 0, 1) * 100}%`;
    track.appendChild(fill);
    row.appendChild(labels);
    row.appendChild(track);
    elements.recParams.appendChild(row);
  });
}

function renderGarden() {
  if (!state.gardenSnapshot) {
    return;
  }
  renderGardenSnapshot(elements.gardenCanvas, state.gardenSnapshot);

  const milestones = state.gardenSnapshot.milestones;
  const milestoneRows = [
    ["Streak", `${milestones.streak} sessions`],
    ["Recovery Score", String(milestones.recoveryScore)],
    ["Frost Level", `${Math.round(milestones.frostLevel * 100)}%`],
    ["Biome", milestones.biomeUnlocked ? "Unlocked" : "Locked"],
    ["River Event", milestones.equilibriumRiver ? "Active" : "Pending"],
    ["Blossom", milestones.blossomEvent ? "Blooming" : "Inactive"]
  ];

  elements.gardenMilestones.innerHTML = "";
  milestoneRows.forEach(([label, value]) => {
    const row = document.createElement("div");
    const l = document.createElement("span");
    l.textContent = label;
    const r = document.createElement("strong");
    r.textContent = value;
    row.appendChild(l);
    row.appendChild(r);
    elements.gardenMilestones.appendChild(row);
  });

  const speciesLabels = {
    birch: "Birch (Light)",
    bamboo: "Bamboo (Resonance)",
    pine: "Pine (Thermal)",
    oak: "Oak (Balanced)",
    rare: "Rare"
  };
  elements.gardenSpecies.innerHTML = "";
  Object.entries(milestones.speciesMix).forEach(([species, count]) => {
    const row = document.createElement("div");
    const l = document.createElement("span");
    l.textContent = speciesLabels[species] || species;
    const r = document.createElement("strong");
    r.textContent = String(count);
    row.appendChild(l);
    row.appendChild(r);
    elements.gardenSpecies.appendChild(row);
  });
}

function hydrateAdaptiveState() {
  state.patientSessions = getActivePatientSessions();
  state.recommendation = recommendProtocol(state.patientSessions, isWebGpuAvailable());
  state.activeProtocol = { ...state.recommendation.protocol };
  state.gardenSnapshot = buildGardenSnapshot(state.patientSessions);
  renderRecommendation();
  renderGarden();
  elements.heroPatientId.textContent = state.activePatientId || "--";
  renderPatientLookupPreview(elements.patientIdInput.value || state.activePatientId || "");
}

let overlayResizeRafId = null;

function scheduleOverlayResize() {
  if (overlayResizeRafId) {
    cancelAnimationFrame(overlayResizeRafId);
  }
  overlayResizeRafId = requestAnimationFrame(() => {
    overlayResizeRafId = null;
    syncOverlayCanvasSize();
  });
}

function resolveOverlaySize() {
  const rect = elements.cameraStage.getBoundingClientRect();
  const stageWidth = Math.round(rect.width);
  const stageHeight = Math.round(rect.height);
  if (stageWidth >= 120 && stageHeight >= 120) {
    return { width: stageWidth, height: stageHeight };
  }

  const fallbackWidth = Number(elements.auraCameraCanvas.width) || 960;
  const fallbackHeight = Number(elements.auraCameraCanvas.height) || 540;
  return { width: fallbackWidth, height: fallbackHeight };
}

function syncOverlayCanvasSize() {
  const { width, height } = resolveOverlaySize();
  if (elements.virtualGameCanvas.width !== width || elements.virtualGameCanvas.height !== height) {
    elements.virtualGameCanvas.width = width;
    elements.virtualGameCanvas.height = height;
  }
  if (elements.gameOverlayCanvas.width !== width || elements.gameOverlayCanvas.height !== height) {
    elements.gameOverlayCanvas.width = width;
    elements.gameOverlayCanvas.height = height;
  }
  threeRecoveryWorld.resize();
  splineRecoveryWorld.resize();
}

async function ensureCameraStarted() {
  if (state.cameraRunning) {
    return;
  }
  await auraScanEngine.startCamera();
  state.cameraRunning = true;
  syncOverlayCanvasSize();
  log("Camera started.");
}

function stopCamera() {
  const wasRunning = state.cameraRunning;
  auraScanEngine.stopCamera();
  thermalEngine.stopScan();
  thermalEngine.clearOverlay();
  neuralHandshakeEngine.stop();
  gameEngine.stop();
  threeRecoveryWorld.stop();
  splineRecoveryWorld.stop();
  state.cameraRunning = false;
  state.scanMode = null;
  state.gameRunning = false;
  setScanTimer(clamp(Number(elements.scanDurationInput.value) || 60, 20, 180));
  if (wasRunning) {
    log("Camera stopped.");
  }
}

function resetIntakeStageValues() {
  elements.metricAuraHr.textContent = "-- bpm";
  elements.metricAuraHrv.textContent = "-- ms";
  elements.metricAuraSymmetry.textContent = "-- %";
  elements.metricAuraMicro.textContent = "-- Hz";
  elements.metricAuraBreath.textContent = "-- /min";
  elements.metricAuraReadiness.textContent = "-- / 10";
  elements.metricAuraAlgorithm.textContent = "--";
  elements.metricAuraSource.textContent = "--";
  elements.leftMetricPosture.textContent = "-- %";
  elements.leftMetricHeart.textContent = "-- bpm";
  elements.leftMetricBalance.textContent = "-- %";
  elements.leftMetricJoint.textContent = "--";
  elements.intakeProgressLabel.textContent = "Scanning...";
  setScanTimer(clamp(Number(elements.scanDurationInput.value) || 60, 20, 180));
  state.intakeReady = false;
  elements.intakeNextButton.disabled = true;
}

function startAuraScan(mode, durationSec) {
  state.scanMode = mode;
  auraScanEngine.startScan(durationSec);
  setScanTimer(durationSec);
}

function readMqttConfigFromUi() {
  return {
    apiBaseUrl: elements.mqttApiBaseUrlInput.value.trim(),
    topic: elements.mqttTopicInput.value.trim(),
    mac: elements.mqttDeviceMacInput.value.trim()
  };
}

function readMqttCredentialsFromUi() {
  return {
    username: elements.mqttUsernameInput.value.trim(),
    password: elements.mqttPasswordInput.value
  };
}

async function ensureHydrawavReady(forAction = "runtime") {
  const config = readMqttConfigFromUi();
  if (!config.apiBaseUrl) {
    throw new Error(`HydraWav API base URL is required for ${forAction}.`);
  }
  if (!config.topic) {
    throw new Error(`HydraWav MQTT topic is required for ${forAction}.`);
  }
  if (!config.mac) {
    throw new Error(`HydraWav device MAC is required for ${forAction}.`);
  }

  if (hydrawavMqttClient.hasToken()) {
    return config;
  }

  const creds = readMqttCredentialsFromUi();
  await hydrawavMqttClient.login({
    apiBaseUrl: config.apiBaseUrl,
    username: creds.username || undefined,
    password: creds.password || undefined,
    rememberMe: true
  });
  log("HydraWav API authenticated.");
  return config;
}

function buildHydrawavStartPayload(mac) {
  if (!mac) {
    throw new Error("Device MAC is required.");
  }

  return {
    mac,
    ...DEFAULTS.cardiac.mqtt.startTemplate,
    playCmd: 1
  };
}

async function publishHydrawavStartCommand() {
  const config = await ensureHydrawavReady("therapy start");
  await hydrawavMqttClient.publish({
    apiBaseUrl: config.apiBaseUrl,
    topic: config.topic,
    payload: JSON.stringify(buildHydrawavStartPayload(config.mac))
  });
  log("HydraWav start command published.");
}

async function publishHydrawavControlCommand(playCmd, label) {
  const config = await ensureHydrawavReady(label);
  await hydrawavMqttClient.sendControlCommand({
    apiBaseUrl: config.apiBaseUrl,
    topic: config.topic,
    mac: config.mac,
    playCmd
  });
  log(`HydraWav ${label} command published.`);
}

async function startIntakeScanFlow() {
  try {
    await ensureCameraStarted();
    void wearableBridge.tryAutoReconnect();
    const durationSec = clamp(Number(elements.scanDurationInput.value) || 60, 20, 180);
    state.baselineMetrics = null;
    state.postMetrics = null;
    state.thermalResult = null;
    state.gameResult = null;
    state.lastSummaryRecord = null;
    resetIntakeStageValues();
    startAuraScan("baseline", durationSec);
    log(`Started intake scan for ${durationSec}s${state.activePatientId ? ` for ${state.activePatientId}` : ""}.`);
  } catch (error) {
    log(`Failed to start intake scan: ${error.message}`, "warn");
  }
}

function buildIntakeAnalysisText() {
  const baseline = state.baselineMetrics;
  if (!baseline) {
    return "Complete the intake scan to generate body-map analysis and session targets.";
  }
  const focus = getFocusTarget();
  const fatigue = Number.isFinite(baseline.microsaccadeHz)
    ? (baseline.microsaccadeHz < 0.5 ? "high CNS fatigue" : "normal CNS tone")
    : "CNS fatigue unavailable";
  const thermalSun = state.thermalResult?.recommendedPads?.sun;
  const thermalMoon = state.thermalResult?.recommendedPads?.moon;
  const thermalText = thermalSun && thermalMoon
    ? `Thermal mapping suggests Sun=${thermalSun.side} ${thermalSun.zone}, Moon=${thermalMoon.side} ${thermalMoon.zone}.`
    : "Thermal mapping pending or not available.";
  const rec = state.recommendation;
  const recText = rec
    ? `Adaptive model (${rec.modelMode}) predicts +${round(rec.expectedImprovement, 2)} expected improvement for next protocol.`
    : "Adaptive protocol model pending.";
  return [
    `Focus target detected: ${focus.side} ${focus.zone}.`,
    Number.isFinite(baseline.readinessScore)
      ? `Readiness ${round(baseline.readinessScore, 2)}/10 with ${fatigue}.`
      : `Readiness unavailable with ${fatigue}.`,
    thermalText,
    recText
  ].join(" ");
}

async function beginGameFlow() {
  void narrationManager.primeAudio();
  try {
    await neuroEngine.enableAudio();
  } catch (error) {
    log(`Neuroacoustic priming warning: ${error.message}`, "warn");
  }
  if (!state.baselineMetrics) {
    log("Complete intake scan before starting game flow.", "warn");
    return;
  }
  try {
    await ensureCameraStarted();
  } catch (error) {
    log(`Unable to start camera for game flow: ${error.message}`, "warn");
    return;
  }

  const focus = getFocusTarget();
  setSessionAndProtocolFocus(focus.zone, focus.side);

  try {
    await publishHydrawavStartCommand();
  } catch (error) {
    elements.gameStatus.textContent = "HydraWav API is required before game start.";
    log(`HydraWav start required but failed: ${error.message}`, "warn");
    return;
  }

  resetRecoveryWorldPreference();
  setStage("game");
  state.gameRunning = true;
  state.gameResult = null;
  scheduleOverlayResize();
  try {
    await startRecoveryWorld({ zone: focus.zone, side: focus.side });
  } catch (error) {
    log(`Recovery world failed to start: ${error.message}`, "warn");
    elements.gameStatus.textContent = "3D world could not start. Camera-guided recovery is still active.";
  }
  resetWorldUi();
  updateWorldBuildUi();
  appendWorldLog(`Session started: ${focus.side} ${focus.zone} focus.`);
  elements.gameStatus.textContent = "Preparing guided game...";
  elements.gameProgressFill.style.width = "0%";
  elements.gameScore.textContent = "0%";
  elements.gameReps.textContent = "0 / 0";
  elements.gameActionsCount.textContent = "0 / 0";
  elements.gameMotionSync.textContent = "-- %";
  elements.gameImpactText.textContent = "Each rep places blocks in your recovery world.";
  elements.gameNextUp.textContent = "--";
  elements.leftGameActionTitle.textContent = "Waiting for first action";
  elements.leftGameActionDesc.textContent = "Stand in frame and follow the prompt.";
  elements.leftGameImpact.textContent = "Each rep improves recovery and builds the world.";
  elements.leftGameReps.textContent = "0 / 0";
  elements.leftGameNext.textContent = "--";

  try {
    await neuroEngine.enableAudio();
    neuroEngine.startSession({ preSeconds: 20, duringSeconds: 130, postSeconds: 20 });
  } catch (error) {
    log(`Neuroacoustic setup warning: ${error.message}`, "warn");
  }

  try {
    neuralHandshakeEngine.setTarget({ zone: focus.zone, injuredSide: focus.side });
    neuralHandshakeEngine.startRecording(10);
  } catch (error) {
    log(`Neural handshake warning: ${error.message}`, "warn");
  }

  cardiacEngine.start();
  try {
    startAuraScan("game-monitor", 180);
  } catch (error) {
    log(`Background biometric monitor warning: ${error.message}`, "warn");
  }

  gameEngine.start({ zone: focus.zone, side: focus.side });
  const motionSuffix = motionAdapter ? " with mirror motion sync." : ".";
  const worldTag = worldEngineName(activeRecoveryWorld);
  elements.gameStatus.textContent = `Game running on ${focus.side} ${focus.zone} (${worldTag} world). Follow action prompts${motionSuffix}`;
  log(`Game flow started for ${focus.side} ${focus.zone} using ${worldTag} world.`);
}

async function speakActionCue(payload) {
  if (!state.voiceEnabled) {
    return;
  }
  const reps = Number(payload?.repsTarget) > 0 ? ` ${payload.repsTarget} reps.` : "";
  const text = `Next movement: ${payload.label}.${reps}`;
  await narrationManager.speak(text, { source: "recovery-game", actionId: payload.id });
}

async function handleGameComplete(summary) {
  state.gameRunning = false;
  state.gameResult = summary;
  threeRecoveryWorld.stop();
  splineRecoveryWorld.stop();
  updateWorldBuildUi();
  appendWorldLog(`Build complete: ${Math.round(summary.score)}% quality score.`);
  elements.gameNextUp.textContent = "Post-session scan and summary";
  elements.leftGameNext.textContent = "Post-session scan and summary";
  elements.gameStatus.textContent = "Game complete. Starting post-session recheck...";
  log(`Game complete. Score ${summary.score}% with ${summary.actionsCompleted}/${summary.actionsTotal} actions. Motion sync ${summary.motionSyncAvg ?? "--"}%.`);
  if (state.scanMode === "game-monitor") {
    auraScanEngine.stopScan();
    state.scanMode = null;
  }
  neuralHandshakeEngine.stop();
  cardiacEngine.stop();
  neuroEngine.stopSession();
  try {
    await publishHydrawavControlCommand(3, "stop");
  } catch (error) {
    log(`HydraWav stop warning: ${error.message}`, "warn");
  }
  await startPostscanFlow();
}

async function startPostscanFlow() {
  setStage("postscan");
  elements.postscanStatus.textContent = "Collecting post-session biometrics (20s)...";
  startAuraScan("post", 20);
  log("Started post-session biometrics recheck for 20s.");
}

function deriveSessionOutcomes(baseline, post, gameSummary) {
  const hrvDelta = safeDelta(post?.hrvRmssdMs, baseline?.hrvRmssdMs) ?? 0;
  const symmetryGain = (Number.isFinite(baseline?.symmetryDeltaPct) && Number.isFinite(post?.symmetryDeltaPct))
    ? baseline.symmetryDeltaPct - post.symmetryDeltaPct
    : 0;
  const symmetryDeltaRemaining = Number.isFinite(post?.symmetryDeltaPct)
    ? post.symmetryDeltaPct
    : (Number.isFinite(baseline?.symmetryDeltaPct) ? baseline.symmetryDeltaPct : 0);
  const microsaccadeStabilityGain = safeDelta(post?.microsaccadeHz, baseline?.microsaccadeHz) ?? 0;
  const subjectiveReadinessGain = safeDelta(post?.readinessScore, baseline?.readinessScore) ?? 0;
  const score = Number.isFinite(gameSummary?.score) ? gameSummary.score : 0;
  const romGain = Number.isFinite(gameSummary?.romGainEstimate) ? gameSummary.romGainEstimate : 0;
  const motionSync = Number.isFinite(gameSummary?.motionSyncAvg) ? gameSummary.motionSyncAvg : 0;
  const painReduction = clamp(score / 18, 0, 6);
  return {
    hrvDelta: round(hrvDelta, 2),
    symmetryGain: round(symmetryGain, 2),
    symmetryDeltaRemaining: round(Math.max(symmetryDeltaRemaining, 0), 2),
    microsaccadeStabilityGain: round(microsaccadeStabilityGain, 3),
    painReduction: round(painReduction, 2),
    romGain: round(romGain, 2),
    motionSync: round(motionSync, 1),
    subjectiveReadinessGain: round(subjectiveReadinessGain, 2)
  };
}

function createSessionRecord(outcomes) {
  return {
    id: crypto.randomUUID(),
    athleteId: state.activePatientId || LEGACY_PATIENT_ID,
    createdAt: new Date().toISOString(),
    modality: inferModality(state.activeProtocol),
    protocol: cloneSerializable(state.activeProtocol),
    outcomes,
    focusZone: state.sessionContext.focusZone,
    baselineMetrics: cloneSerializable(state.baselineMetrics),
    postMetrics: cloneSerializable(state.postMetrics),
    gameSummary: cloneSerializable(state.gameResult)
  };
}

function actionQualityScore(action = {}) {
  const match = clamp(Number(action.avgMovementMatch || 0) / 100, 0, 1);
  const tracking = clamp(Number(action.avgTrackingConfidence || 0) / 100, 0, 1);
  const sync = Number.isFinite(Number(action.avgMotionSync))
    ? clamp(Number(action.avgMotionSync) / 100, 0, 1)
    : tracking;
  const completion = clamp((Number(action.repsCompleted) || 0) / Math.max(Number(action.repsTarget) || 1, 1), 0, 1);
  const completionScore = action.skipped ? completion * 0.4 : (action.completed ? 1 : completion);
  return match * 0.46 + tracking * 0.22 + sync * 0.18 + completionScore * 0.14;
}

function getMovementCoaching(gameSummary = {}) {
  const breakdown = Array.isArray(gameSummary?.actionBreakdown) ? [...gameSummary.actionBreakdown] : [];
  if (!breakdown.length) {
    return {
      bestAction: null,
      focusAction: null,
      bestLine: "",
      focusLine: "",
      voiceBest: "",
      voiceFocus: ""
    };
  }

  breakdown.sort((a, b) => actionQualityScore(b) - actionQualityScore(a));
  const bestAction = breakdown[0] || null;
  const focusAction = breakdown.find((item) => item.id !== bestAction?.id) || breakdown.at(-1) || null;
  const bestTracking = Number(bestAction?.avgTrackingConfidence);
  const bestMatch = Number(bestAction?.avgMovementMatch);
  const focusTracking = Number(focusAction?.avgTrackingConfidence);
  const focusMatch = Number(focusAction?.avgMovementMatch);
  const focusNeedsTracking = Number.isFinite(focusTracking)
    && Number.isFinite(Number(focusAction?.requiredTrackingScore))
    && focusTracking < Number(focusAction.requiredTrackingScore);
  const bestLine = bestAction
    ? `${bestAction.label} performed best, averaging ${Math.round(bestMatch || 0)}% movement match with ${Math.round(bestTracking || 0)}% tracking confidence.`
    : "";
  const focusLine = focusAction
    ? `${focusAction.label} needs the most work. ${focusNeedsTracking ? "Keep the full working side visible in frame. " : ""}${describeMovementFix(focusAction.id)}`
    : "";
  const voiceBest = bestAction
    ? `${bestAction.label} was your strongest movement, with ${Math.round(bestMatch || 0)} percent match quality.`
    : "";
  const voiceFocus = focusAction
    ? `${focusAction.label} needs more work. ${focusNeedsTracking ? "Keep the working side fully visible. " : ""}${describeMovementFix(focusAction.id)}`
    : "";

  return {
    bestAction,
    focusAction,
    bestLine,
    focusLine,
    voiceBest,
    voiceFocus
  };
}

function buildSummaryVoiceText(sessionRecord, nextRecommendation, continuity = buildPatientContinuityState(sessionRecord?.athleteId, sessionRecord)) {
  const score = recoveryScore(sessionRecord);
  const outcomes = sessionRecord?.outcomes || {};
  const movement = getMovementCoaching(sessionRecord?.gameSummary || {});
  const lines = [
    `Session complete for patient ${sessionRecord.athleteId}.`,
    "Here is the recovery analysis."
  ];

  if (Number.isFinite(score)) {
    lines.push(`Overall recovery score ${score}.`);
  }
  if (movement.voiceBest) {
    lines.push(movement.voiceBest);
  }
  if (movement.voiceFocus) {
    lines.push(movement.voiceFocus);
  }
  if (Number.isFinite(outcomes.symmetryGain)) {
    lines.push(`Symmetry ${outcomes.symmetryGain >= 0 ? "improved" : "decreased"} by ${Math.abs(outcomes.symmetryGain).toFixed(1)} percent.`);
  }
  if (Number.isFinite(outcomes.hrvDelta)) {
    lines.push(`Heart rate variability moved ${outcomes.hrvDelta >= 0 ? "up" : "down"} ${Math.abs(outcomes.hrvDelta).toFixed(1)} milliseconds from intake.`);
  }
  if (continuity?.latestPrior) {
    const previousScore = recoveryScore(continuity.latestPrior);
    const scoreDelta = safeDelta(score, previousScore);
    if (Number.isFinite(scoreDelta)) {
      lines.push(`Compared with the last visit, recovery score ${scoreDelta >= 0 ? "improved" : "fell"} by ${Math.abs(scoreDelta).toFixed(1)} points.`);
    }
  } else if (continuity?.patientId) {
    lines.push(`This session is now the baseline record for ${continuity.patientId}.`);
  }
  if (Number.isFinite(nextRecommendation?.expectedImprovement) && Number.isFinite(nextRecommendation?.confidence)) {
    lines.push(`Next session is predicted to improve by ${round(nextRecommendation.expectedImprovement, 2)}, with ${Math.round(nextRecommendation.confidence * 100)} percent confidence.`);
  }

  return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 1350);
}

function buildReaAiAnalysis(sessionRecord, baseline, post, recommendation, continuity) {
  const outcomes = sessionRecord?.outcomes || {};
  const gameSummary = sessionRecord?.gameSummary || {};
  const lines = [];
  const focus = state.sessionContext.focusZone;
  const currentScore = recoveryScore(sessionRecord);
  const movement = getMovementCoaching(gameSummary);

  if (Number.isFinite(outcomes.symmetryGain)) {
    const direction = outcomes.symmetryGain >= 0 ? "improved" : "regressed";
    lines.push(`REA AI: Symmetry ${direction} by ${Math.abs(outcomes.symmetryGain).toFixed(2)}%.`);
  }

  if (Number.isFinite(outcomes.hrvDelta)) {
    const trend = outcomes.hrvDelta >= 0 ? "up" : "down";
    lines.push(`HRV moved ${trend} ${Math.abs(outcomes.hrvDelta).toFixed(1)} ms from intake baseline.`);
  }

  if (Number.isFinite(outcomes.subjectiveReadinessGain)) {
    lines.push(`Readiness shifted ${outcomes.subjectiveReadinessGain >= 0 ? "up" : "down"} ${Math.abs(outcomes.subjectiveReadinessGain).toFixed(2)} points.`);
  }

  if (Number.isFinite(gameSummary?.movementMatchAvg)) {
    lines.push(`Movement match averaged ${Math.round(gameSummary.movementMatchAvg)}% during guided gameplay.`);
  }
  if (Number.isFinite(gameSummary?.vitalScoreAvg)) {
    lines.push(`Vital stability averaged ${Math.round(gameSummary.vitalScoreAvg)}% during active protocol.`);
  }
  if (movement.bestLine) {
    lines.push(movement.bestLine);
  }
  if (movement.focusLine) {
    lines.push(movement.focusLine);
  }
  if (Number.isFinite(currentScore)) {
    lines.push(`Composite recovery score closed at ${currentScore}.`);
  }

  if (continuity?.latestPrior) {
    const previousScore = recoveryScore(continuity.latestPrior);
    const scoreDelta = safeDelta(currentScore, previousScore);
    const hrvResponseShift = safeDelta(outcomes.hrvDelta, continuity.latestPrior?.outcomes?.hrvDelta);
    lines.push(`Patient continuity includes ${continuity.priorSessions.length} prior sessions, with the latest visit on ${formatSessionTimestamp(continuity.latestPrior.createdAt)}.`);
    if (Number.isFinite(scoreDelta)) {
      lines.push(`Recovery score ${scoreDelta >= 0 ? "outperformed" : "trailed"} the last visit by ${Math.abs(scoreDelta).toFixed(1)} points.`);
    }
    if (Number.isFinite(hrvResponseShift)) {
      lines.push(`HRV response was ${hrvResponseShift >= 0 ? "stronger" : "lower"} than the last visit by ${Math.abs(hrvResponseShift).toFixed(1)} ms.`);
    }
  } else if (continuity?.patientId) {
    lines.push(`This is the first recorded continuity baseline for patient ${continuity.patientId}.`);
  }

  if (Number.isFinite(recommendation?.expectedImprovement) && Number.isFinite(recommendation?.confidence)) {
    lines.push(`Next-session expected gain is ${recommendation.expectedImprovement.toFixed(2)} with ${Math.round(recommendation.confidence * 100)}% confidence.`);
  }

  if (Number.isFinite(post?.breathRatePerMin) && Number.isFinite(post?.heartRateBpm)) {
    lines.push(`Post-session cardiorespiratory snapshot: ${post.heartRateBpm.toFixed(1)} bpm HR and ${post.breathRatePerMin.toFixed(1)}/min breath.`);
  }

  return `${focus} focus. ${lines.join(" ")}`.trim();
}

function buildLiveImpactRows(outcomes, gameSummary) {
  const rows = [];
  const movement = getMovementCoaching(gameSummary);
  rows.push(`Focus Zone: ${state.sessionContext.focusZone}`);
  rows.push(`Actions Completed: ${gameSummary?.actionsCompleted ?? 0}/${gameSummary?.actionsTotal ?? 0}`);
  rows.push(`Game Score: ${Math.round(gameSummary?.score ?? 0)}%`);
  if (Number.isFinite(gameSummary?.movementMatchAvg)) {
    rows.push(`Movement Match Avg: ${Math.round(gameSummary.movementMatchAvg)}%`);
  }
  if (Number.isFinite(gameSummary?.motionSyncAvg)) {
    rows.push(`Motion Sync Avg: ${Math.round(gameSummary.motionSyncAvg)}%`);
  }
  if (Number.isFinite(gameSummary?.vitalScoreAvg)) {
    rows.push(`Vitals Stability Avg: ${Math.round(gameSummary.vitalScoreAvg)}%`);
  }
  if (movement.bestAction) {
    rows.push(`Best Movement: ${movement.bestAction.label}`);
  }
  if (movement.focusAction) {
    rows.push(`Needs More Work: ${movement.focusAction.label}`);
  }
  rows.push(`ROM Gain Estimate: ${Number(outcomes?.romGain ?? 0).toFixed(2)} pts`);
  return rows;
}

function renderSummary(outcomes, sessionRecord) {
  const continuity = renderPatientHistory(sessionRecord);
  elements.summaryStatus.textContent = `Session saved (${new Date(sessionRecord.createdAt).toLocaleString()}).`;
  elements.summaryHrvDelta.textContent = asDelta(outcomes.hrvDelta, " ms");
  elements.summarySymmetryGain.textContent = asDelta(outcomes.symmetryGain, " %");
  elements.summaryMicroGain.textContent = asDelta(outcomes.microsaccadeStabilityGain, " Hz");
  elements.summaryReadinessGain.textContent = asDelta(outcomes.subjectiveReadinessGain, " /10");
  elements.summaryRomGain.textContent = asDelta(outcomes.romGain, " pts");
  elements.summaryGameScore.textContent = Number.isFinite(state.gameResult?.score) ? `${Math.round(state.gameResult.score)}%` : "--";
  elements.summaryMotionSync.textContent = Number.isFinite(outcomes.motionSync) ? `${Math.round(outcomes.motionSync)}%` : "--";
  elements.summaryAnalysisText.textContent = buildReaAiAnalysis(
    sessionRecord,
    state.baselineMetrics,
    state.postMetrics,
    state.recommendation,
    continuity
  );

  elements.summaryLiveImpact.innerHTML = "";
  buildLiveImpactRows(outcomes, state.gameResult).forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    elements.summaryLiveImpact.appendChild(li);
  });
}

async function finalizeSession() {
  const outcomes = deriveSessionOutcomes(state.baselineMetrics, state.postMetrics, state.gameResult);
  const record = createSessionRecord(outcomes);
  const continuity = buildPatientContinuityState(record.athleteId, record);
  state.sessions.push(record);
  persistSessions();
  state.lastSummaryRecord = record;
  hydrateAdaptiveState();
  renderSummary(outcomes, record);
  setStage("summary");
  if (state.voiceEnabled) {
    await narrationManager.speak(buildSummaryVoiceText(record, state.recommendation, continuity), { source: "summary-auto" });
  }
  log("Session completed and persisted with updated analysis.");
}

function resetForNewSession(options = {}) {
  const { returnToLanding = true } = options;
  stopCamera();
  state.scanMode = null;
  state.intakeReady = false;
  state.baselineMetrics = null;
  state.postMetrics = null;
  state.thermalResult = null;
  state.gameRunning = false;
  state.gameResult = null;
  state.lastSummaryRecord = null;
  elements.gameMotionSync.textContent = "-- %";
  elements.gameImpactText.textContent = "Each rep places blocks in your recovery world.";
  elements.gameNextUp.textContent = "--";
  elements.leftGameActionTitle.textContent = "--";
  elements.leftGameActionDesc.textContent = "--";
  elements.leftGameImpact.textContent = "Each rep improves recovery and builds the world.";
  elements.leftGameReps.textContent = "0 / 0";
  elements.leftGameNext.textContent = "--";
  elements.intakeNextButton.disabled = true;
  elements.intakeProgressLabel.textContent = "Ready for 60-second scan.";
  setScanTimer(clamp(Number(elements.scanDurationInput.value) || 60, 20, 180));
  elements.intakeAnalysisText.textContent = "Complete the intake scan to generate body-map analysis and session targets.";
  gameEngine.stop();
  threeRecoveryWorld.stop();
  splineRecoveryWorld.stop();
  resetWorldUi();
  neuralHandshakeEngine.stop();
  cardiacEngine.stop();
  neuroEngine.stopSession();
  thermalEngine.clearOverlay();
  setStage("intake");
  renderPatientHistory(null);
  if (returnToLanding) {
    elements.patientIdInput.value = state.activePatientId || elements.patientIdInput.value;
    renderPatientLookupPreview(elements.patientIdInput.value);
    showPatientEntryScreen();
  } else {
    showAppShell();
  }
  log(returnToLanding ? "Ready for next patient session." : "Ready for new session.");
}

async function startPatientSessionFromEntry() {
  const patientId = normalizePatientId(elements.patientIdInput.value);
  elements.patientIdInput.value = patientId;
  renderPatientLookupPreview(patientId);

  if (!patientId) {
    elements.patientLookupSummary.textContent = "Enter a valid patient ID to start the recovery session.";
    elements.patientIdInput.focus();
    log("Patient ID is required before starting the session.", "warn");
    return;
  }

  activatePatient(patientId);
  resetForNewSession({ returnToLanding: false });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await startIntakeScanFlow();
}

async function playSummaryVoice() {
  if (!state.lastSummaryRecord) {
    log("No summary record available yet.", "warn");
    return;
  }
  const continuity = buildPatientContinuityState(state.lastSummaryRecord.athleteId, state.lastSummaryRecord);
  await narrationManager.speak(buildSummaryVoiceText(state.lastSummaryRecord, state.recommendation, continuity), { source: "summary-manual" });
}

function bindUi() {
  narrationManager.setEnabled(state.voiceEnabled);
  elements.voiceEnabledInput.checked = state.voiceEnabled;
  setPill(elements.voiceStatusPill, state.voiceEnabled ? "Enabled" : "Disabled", state.voiceEnabled ? "live" : "idle");
  window.addEventListener("pointerdown", () => {
    void narrationManager.primeAudio();
    void neuroEngine.enableAudio().catch(() => {});
  }, { once: true });
  elements.scanDurationInput.value = String(DEFAULTS.auraScan.scanDurationSec);
  setScanTimer(DEFAULTS.auraScan.scanDurationSec);
  resetWorldUi();
  elements.gateOffsetInput.value = String(DEFAULTS.cardiac.gateOffsetMs);
  elements.gateOffsetValue.textContent = `${DEFAULTS.cardiac.gateOffsetMs} ms`;
  elements.mqttApiBaseUrlInput.value = DEFAULTS.cardiac.mqtt.apiBaseUrl;
  elements.mqttTopicInput.value = DEFAULTS.cardiac.mqtt.topic;
  elements.mqttDeviceMacInput.value = DEFAULTS.cardiac.mqtt.mac;
  elements.patientIdInput.addEventListener("input", () => {
    renderPatientLookupPreview(elements.patientIdInput.value);
  });
  elements.patientIdInput.addEventListener("blur", () => {
    elements.patientIdInput.value = normalizePatientId(elements.patientIdInput.value);
    renderPatientLookupPreview(elements.patientIdInput.value);
  });
  elements.patientIdInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void startPatientSessionFromEntry();
    }
  });
  elements.patientStartSession.addEventListener("click", () => {
    void startPatientSessionFromEntry();
  });

  elements.startCameraButton.addEventListener("click", () => { void ensureCameraStarted(); });
  elements.stopCameraButton.addEventListener("click", () => { stopCamera(); });
  elements.startIntakeScanButton.addEventListener("click", () => { void startIntakeScanFlow(); });
  elements.intakeNextButton.addEventListener("click", () => {
    void narrationManager.primeAudio();
    void beginGameFlow();
  });
  elements.gameStartButton.addEventListener("click", () => {
    void narrationManager.primeAudio();
    if (!state.gameRunning) {
      void beginGameFlow();
    }
  });
  elements.gameSkipButton.addEventListener("click", () => {
    if (!state.gameRunning) {
      return;
    }
    const result = gameEngine.skipCurrentAction("manual");
    if (!result?.skippedAction) {
      return;
    }
    if (result.completed) {
      appendWorldLog(`Skipped: ${result.skippedAction.label}`);
      log(`Skipped workout: ${result.skippedAction.label}.`);
      return;
    }
    const nextLabel = result.nextAction?.label || "post-session recheck";
    elements.gameStatus.textContent = `Skipped ${result.skippedAction.label}. Next: ${nextLabel}.`;
    elements.gameNextUp.textContent = nextLabel;
    elements.leftGameNext.textContent = nextLabel;
    appendWorldLog(`Skipped: ${result.skippedAction.label}`);
    log(`Skipped workout: ${result.skippedAction.label}.`);
  });
  elements.gameStopButton.addEventListener("click", async () => {
    if (state.gameRunning) {
      state.gameRunning = false;
      gameEngine.stop();
      threeRecoveryWorld.stop();
      splineRecoveryWorld.stop();
      neuralHandshakeEngine.stop();
      cardiacEngine.stop();
      neuroEngine.stopSession();
      if (state.scanMode === "game-monitor") {
        auraScanEngine.stopScan();
        state.scanMode = null;
      }
      elements.gameStatus.textContent = "Game stopped manually.";
      elements.gameMotionSync.textContent = "-- %";
      elements.gameNextUp.textContent = "Restart when ready";
      elements.leftGameNext.textContent = "Restart when ready";
      appendWorldLog("Game stopped manually.");
      try {
        await publishHydrawavControlCommand(3, "stop");
      } catch (error) {
        log(`HydraWav stop warning: ${error.message}`, "warn");
      }
      log("Game stopped manually.", "warn");
    } else {
      gameEngine.stop();
      threeRecoveryWorld.stop();
      splineRecoveryWorld.stop();
    }
  });
  elements.summaryRestart.addEventListener("click", () => { resetForNewSession(); });
  elements.summaryPlayVoice.addEventListener("click", () => {
    void narrationManager.primeAudio();
    void playSummaryVoice();
  });
  elements.voiceEnabledInput.addEventListener("change", () => {
    state.voiceEnabled = elements.voiceEnabledInput.checked;
    narrationManager.setEnabled(state.voiceEnabled);
    setPill(elements.voiceStatusPill, state.voiceEnabled ? "Enabled" : "Disabled", state.voiceEnabled ? "live" : "idle");
    log(state.voiceEnabled ? "Voice narration enabled." : "Voice narration disabled.");
  });

  elements.mqttLoginButton.addEventListener("click", async () => {
    try {
      await ensureHydrawavReady("manual login");
      log("HydraWav API login verified.");
    } catch (error) {
      log(`HydraWav API login failed: ${error.message}`, "warn");
    }
  });

  elements.mqttStartButton.addEventListener("click", async () => {
    try {
      await publishHydrawavStartCommand();
    } catch (error) {
      log(`HydraWav start failed: ${error.message}`, "warn");
    }
  });

  elements.mqttPauseButton.addEventListener("click", async () => {
    try {
      await publishHydrawavControlCommand(2, "pause");
    } catch (error) {
      log(`HydraWav pause failed: ${error.message}`, "warn");
    }
  });

  elements.mqttResumeButton.addEventListener("click", async () => {
    try {
      await publishHydrawavControlCommand(4, "resume");
    } catch (error) {
      log(`HydraWav resume failed: ${error.message}`, "warn");
    }
  });

  elements.mqttStopButton.addEventListener("click", async () => {
    try {
      await publishHydrawavControlCommand(3, "stop");
    } catch (error) {
      log(`HydraWav stop failed: ${error.message}`, "warn");
    }
  });

  elements.wearableConnectButton.addEventListener("click", async () => {
    try {
      const ok = await wearableBridge.connectInteractive();
      if (!ok) {
        log("Wearable connection cancelled or unavailable.", "warn");
      }
    } catch (error) {
      log(`Wearable connect failed: ${error.message}`, "warn");
    }
  });

  elements.wearableDisconnectButton.addEventListener("click", () => {
    void wearableBridge.disconnect();
  });

  elements.gateOffsetInput.addEventListener("input", () => {
    const value = Number(elements.gateOffsetInput.value);
    elements.gateOffsetValue.textContent = `${value} ms`;
    cardiacEngine.setOffsetMs(value);
  });
  elements.toggleGatingButton.addEventListener("click", () => {
    if (cardiacEngine.isActive) {
      cardiacEngine.stop();
      log("Cardiac gating stopped.");
    } else {
      cardiacEngine.start();
      log("Cardiac gating started.");
    }
  });
  window.addEventListener("resize", () => {
    scheduleOverlayResize();
    renderGarden();
  });
}

function bindEvents() {
  eventBus.on(EVENTS.AURA_SCAN_STATUS, (event) => {
    const status = event.detail.status || "idle";
    const type = status.includes("failed") ? "warn" : ((status.includes("scan") || status.includes("running")) ? "live" : "idle");
    setPill(elements.auraStatusPill, humanize(status), type);
    if (status === "scanning") {
      setScanTimer(activeScanDurationSec(state.scanMode));
    }
    if (status === "camera_running") {
      state.cameraRunning = true;
      elements.cameraStage.classList.add("camera-live");
      scheduleOverlayResize();
    }
    if (status === "camera_stopped") {
      state.cameraRunning = false;
      elements.cameraStage.classList.remove("camera-live");
      setScanTimer(activeScanDurationSec("baseline"));
    }
  });

  eventBus.on(EVENTS.AURA_SCAN_FRAME, (event) => {
    const d = event.detail;
    state.latestBiometrics = {
      ...state.latestBiometrics,
      heartRateBpm: d.heartRateBpm,
      rrIntervalMs: d.rrIntervalMs,
      hrvRmssdMs: d.hrvRmssdMs,
      microsaccadeHz: d.microsaccadeHz,
      readinessScore: d.readinessScore,
      symmetryDeltaPct: d.symmetryDeltaPct,
      breathRatePerMin: d.breathRatePerMin,
      heartRateConfidence: d.heartRateConfidence,
      cameraSignalQuality: d.cameraSignalQuality,
      poseQuality: d.poseQuality
    };

    const progress = clamp(Number(d.progress || 0), 0, 1);
    const activeDuration = activeScanDurationSec(state.scanMode);
    const remainingSec = Math.max(Math.ceil((1 - progress) * activeDuration), 0);

    const nowMs = performance.now();
    const shouldRefreshPanels = (nowMs - lastAuraPanelUpdateAt >= UI_PERF.auraPanelMs) || progress >= 0.995;
    if (shouldRefreshPanels) {
      lastAuraPanelUpdateAt = nowMs;
      elements.metricAuraHr.textContent = Number.isFinite(d.heartRateBpm) ? `${round(d.heartRateBpm, 1)} bpm` : "-- bpm";
      elements.metricAuraHrv.textContent = Number.isFinite(d.hrvRmssdMs) ? `${round(d.hrvRmssdMs, 1)} ms` : "-- ms";
      elements.metricAuraSymmetry.textContent = Number.isFinite(d.symmetryDeltaPct) ? `${round(d.symmetryDeltaPct, 2)} %` : "-- %";
      elements.metricAuraMicro.textContent = Number.isFinite(d.microsaccadeHz) ? `${round(d.microsaccadeHz, 3)} Hz` : "-- Hz";
      elements.metricAuraBreath.textContent = Number.isFinite(d.breathRatePerMin) ? `${round(d.breathRatePerMin, 1)} /min` : "-- /min";
      elements.metricAuraReadiness.textContent = Number.isFinite(d.readinessScore) ? `${round(d.readinessScore, 2)} / 10` : "-- / 10";
      elements.metricAuraAlgorithm.textContent = typeof d.algorithm === "string" && d.algorithm ? d.algorithm.toUpperCase() : "--";
      elements.metricAuraSource.textContent = typeof d.vitalsSource === "string" && d.vitalsSource ? d.vitalsSource : "--";
      updateLeftScanMetrics(d);
      syncGameTrackerFromBodyMap();

      setScanTimer(remainingSec);
      if (state.scanMode === "baseline") {
        elements.intakeProgressLabel.textContent = `Intake scan progress ${Math.round(progress * 100)}%`;
      } else if (state.scanMode === "post") {
        elements.postscanStatus.textContent = `Post-scan progress ${Math.round(progress * 100)}%`;
      }
    }
  });

  eventBus.on(EVENTS.AURA_SCAN_COMPLETE, (event) => {
    const d = event.detail;
    if (state.scanMode === "baseline") {
      state.baselineMetrics = d;
      state.scanMode = null;
      state.intakeReady = true;
      elements.intakeNextButton.disabled = false;
      elements.intakeProgressLabel.textContent = "Intake scan complete.";
      setScanTimer(0);
      const focus = getFocusTarget();
      setSessionAndProtocolFocus(focus.zone, focus.side);
      elements.intakeAnalysisText.textContent = buildIntakeAnalysisText();
      log("Intake scan complete. Ready for AR recovery game.");
      try {
        thermalEngine.startScan(8);
      } catch (error) {
        log(`Thermal scan could not start automatically: ${error.message}`, "warn");
      }
      return;
    }
    if (state.scanMode === "post") {
      state.postMetrics = d;
      state.scanMode = null;
      setScanTimer(0);
      void finalizeSession();
      return;
    }
  });

  eventBus.on(EVENTS.BIOMETRIC_FRAME, (event) => {
    const frame = normalizeFrame(event.detail);
    state.latestBiometrics = { ...state.latestBiometrics, ...frame };
    cardiacEngine.ingestFrame(frame);
    neuroEngine.updateBiometrics(frame);

    const nowMs = performance.now();
    if (nowMs - lastBiometricPanelUpdateAt >= UI_PERF.biometricPanelMs) {
      lastBiometricPanelUpdateAt = nowMs;
      elements.metricHeartRate.textContent = Number.isFinite(frame.heartRateBpm) ? `${round(frame.heartRateBpm, 1)} bpm` : "-- bpm";
      elements.metricRR.textContent = Number.isFinite(frame.rrIntervalMs) ? `${round(frame.rrIntervalMs, 1)} ms` : "-- ms";
      elements.metricMicro.textContent = Number.isFinite(frame.microsaccadeHz) ? `${round(frame.microsaccadeHz, 2)} Hz` : "-- Hz";
    }
  });

  eventBus.on(EVENTS.THERMAL_SCAN_STATUS, (event) => {
    const status = event.detail.status || "idle";
    const type = status.includes("failed") ? "warn" : ((status.includes("scan") || status.includes("analy")) ? "live" : "idle");
    setPill(elements.thermalStatusPill, humanize(status), type);
  });

  eventBus.on(EVENTS.THERMAL_SCAN_COMPLETE, (event) => {
    state.thermalResult = event.detail || null;
    elements.intakeAnalysisText.textContent = buildIntakeAnalysisText();
    const sun = state.thermalResult?.recommendedPads?.sun;
    const moon = state.thermalResult?.recommendedPads?.moon;
    if (sun && moon) {
      log(`Thermal mapping complete. Sun ${sun.side} ${sun.zone}, Moon ${moon.side} ${moon.zone}.`);
    } else {
      log("Thermal mapping complete.");
    }
  });

  eventBus.on(EVENTS.NEURAL_HANDSHAKE_STATUS, (event) => {
    const status = event.detail.status || "idle";
    setPill(elements.handshakeStatusPill, humanize(status), status === "idle" ? "idle" : "live");
  });

  eventBus.on(EVENTS.CARDIAC_ENGINE_STATUS, (event) => {
    const active = !!event.detail.active;
    setPill(elements.cardiacStatusPill, active ? "Active" : "Idle", active ? "live" : "idle");
    elements.metricSeqId.textContent = String(event.detail.sequenceId ?? 0);
    elements.toggleGatingButton.textContent = active ? "Stop Gating" : "Start Gating";
  });

  eventBus.on(EVENTS.HYDRAWAV_MQTT_STATUS, (event) => {
    state.mqtt = {
      ...state.mqtt,
      ...event.detail
    };

    const status = event.detail.status || "logged_out";
    if (status === "authenticated") {
      setPill(elements.deviceApiStatusPill, "Authenticated", "live");
    } else if (status === "error") {
      setPill(elements.deviceApiStatusPill, "Error", "warn");
    } else {
      setPill(elements.deviceApiStatusPill, "Logged Out", "idle");
    }
  });

  eventBus.on(EVENTS.WEARABLE_STATUS, (event) => {
    const status = event.detail.status || "idle";
    const source = event.detail.source || null;
    state.wearable = { status, source };

    if (status === "connected") {
      const label = source ? `Connected (${source})` : "Connected";
      setPill(elements.wearableStatusPill, label, "live");
      log(source ? `Wearable connected: ${source}.` : "Wearable connected.");
      return;
    }
    if (status === "connecting") {
      setPill(elements.wearableStatusPill, "Connecting", "live");
      return;
    }
    if (status === "unsupported") {
      setPill(elements.wearableStatusPill, "Unsupported", "warn");
      log(event.detail.message || "Web Bluetooth is unavailable in this browser.", "warn");
      return;
    }
    if (status === "disconnected") {
      setPill(elements.wearableStatusPill, "Disconnected", "idle");
      return;
    }
    if (status === "idle") {
      setPill(elements.wearableStatusPill, "Idle", "idle");
      return;
    }

    setPill(elements.wearableStatusPill, humanize(status), status.includes("error") ? "warn" : "idle");
  });

  eventBus.on(EVENTS.WEARABLE_FRAME, (event) => {
    const frame = event.detail || {};
    state.latestBiometrics = {
      ...state.latestBiometrics,
      wearableHeartRateBpm: safeNumber(frame.heartRateBpm, null),
      wearableRrIntervalMs: safeNumber(frame.rrIntervalMs, null),
      wearableConfidence: safeNumber(frame.confidence, null),
      wearableSource: frame.source || state.latestBiometrics.wearableSource
    };
  });

  eventBus.on(EVENTS.HYDRAWAV_MQTT_COMMAND, (event) => {
    const topic = event.detail.topic || "unknown-topic";
    log(`HydraWav MQTT publish ok on topic ${topic}.`);
  });

  eventBus.on(EVENTS.CARDIAC_GATE_FIRED, async (event) => {
    elements.metricGateCount.textContent = String(event.detail.sequence);
    elements.metricLastDelay.textContent = `${round(event.detail.effectiveDelayMs, 1)} ms`;
    elements.metricSeqId.textContent = String(event.detail.sequence);

    try {
      const config = await ensureHydrawavReady("cardiac gate sync");
      await hydrawavMqttClient.sendGatePulse({
        topic: DEFAULTS.cardiac.mqtt.gateTopic || config.topic,
        mac: config.mac,
        sequence: event.detail.sequence,
        rrIntervalMs: event.detail.rrIntervalMs,
        heartRateBpm: event.detail.heartRateBpm,
        offsetMs: event.detail.offsetMs,
        gateTimestampMs: event.detail.gateTimestampMs
      });
    } catch (error) {
      log(`HydraWav gate sync failed: ${error.message}`, "warn");
    }
  });

  eventBus.on(EVENTS.PLASTICITY_SCORE_UPDATED, (event) => {
    state.plasticity = event.detail;
    elements.metricPlasticity.textContent = Number.isFinite(event.detail.score0To10)
      ? `${round(event.detail.score0To10, 2)} / 10`
      : "-- / 10";
  });

  eventBus.on(EVENTS.NEURO_PHASE_CHANGED, (event) => {
    const phase = event.detail.phase || "idle";
    setPill(elements.neuroPhasePill, phase.toUpperCase(), phase === "idle" ? "idle" : "live");
  });

  eventBus.on(EVENTS.VOICE_NOTE_READY, () => {
    setPill(elements.voiceStatusPill, "Delivered", "live");
  });

  eventBus.on(EVENTS.WARNING, (event) => {
    log(`${event.detail.scope || "runtime"}: ${event.detail.message}`, "warn");
  });
}

function initializeBridge() {
  window.HydraVBridge = {
    version: "0.6.0",
    publishBiometricFrame,
    setSessionContext(context = {}) {
      state.sessionContext = { ...state.sessionContext, ...context };
      eventBus.emit(EVENTS.SESSION_CONTEXT, { ...state.sessionContext });
    },
    setProtocolContext(context = {}) {
      state.protocolContext = { ...state.protocolContext, ...context };
      eventBus.emit(EVENTS.PROTOCOL_CONTEXT, { ...state.protocolContext });
    },
    async startAuraCamera() { await ensureCameraStarted(); },
    stopAuraCamera() { stopCamera(); },
    async connectWearable() { return await wearableBridge.connectInteractive(); },
    async reconnectWearable() { return await wearableBridge.tryAutoReconnect(); },
    disconnectWearable() { return wearableBridge.disconnect(); },
    getWearableStatus() { return { ...state.wearable }; },
    ingestWearableSample(sample = {}) {
      auraScanEngine.ingestWearableSample(sample);
      publishBiometricFrame({
        timestampMs: safeNumber(sample.timestampMs, performance.now()),
        rPeakDetected: Number.isFinite(Number(sample.rrIntervalMs)),
        rrIntervalMs: safeNumber(sample.rrIntervalMs, null),
        heartRateBpm: safeNumber(sample.heartRateBpm, null),
        hrvRmssdMs: state.latestBiometrics?.hrvRmssdMs ?? null,
        microsaccadeHz: state.latestBiometrics?.microsaccadeHz ?? null
      });
    },
    startAuraScan(options = {}) { startAuraScan("external", Number(options.durationSec) || DEFAULTS.auraScan.scanDurationSec); },
    stopAuraScan() { auraScanEngine.stopScan(); state.scanMode = null; },
    startFascialThermalScan(options = {}) { thermalEngine.startScan(Number(options.durationSec) || DEFAULTS.thermal.scanDurationSec); },
    stopFascialThermalScan() { thermalEngine.stopScan(); },
    clearThermalOverlay() { thermalEngine.clearOverlay(); },
    getLatestThermalMapping() { return thermalEngine.getLatestResult(); },
    setHandshakeTarget(target = {}) {
      neuralHandshakeEngine.setTarget({
        zone: target.zone || "shoulder",
        injuredSide: target.injuredSide || "left"
      });
    },
    startNeuralHandshake(options = {}) { neuralHandshakeEngine.startRecording(Number(options.durationSec) || DEFAULTS.neuralHandshake.recordDurationSec); },
    stopNeuralHandshake() { neuralHandshakeEngine.stop(); },
    startCardiacGating() { cardiacEngine.start(); },
    stopCardiacGating() { cardiacEngine.stop(); },
    setGateOffsetMs(offsetMs) { cardiacEngine.setOffsetMs(offsetMs); },
    async loginHydrawavMqtt(credentials = {}) {
      return await hydrawavMqttClient.login({
        apiBaseUrl: credentials.apiBaseUrl || "",
        username: credentials.username || "",
        password: credentials.password || "",
        rememberMe: credentials.rememberMe ?? true
      });
    },
    async publishHydrawavMqtt(message = {}) {
      return await hydrawavMqttClient.publish({
        apiBaseUrl: message.apiBaseUrl || "",
        topic: message.topic || DEFAULTS.cardiac.mqtt.topic,
        payload: message.payload
      });
    },
    async enableNeuroAudio() { await neuroEngine.enableAudio(); },
    startNeuroSession(plan = {}) {
      neuroEngine.startSession({
        preSeconds: safeNumber(plan.preSeconds, DEFAULTS.neuro.phaseDurationSec.pre),
        duringSeconds: safeNumber(plan.duringSeconds, DEFAULTS.neuro.phaseDurationSec.during),
        postSeconds: safeNumber(plan.postSeconds, DEFAULTS.neuro.phaseDurationSec.post)
      });
    },
    stopNeuroSession() { neuroEngine.stopSession(); },
    async speakNarration(text) { await narrationManager.speak(text, { source: "bridge" }); },
    getExerciseResourceCatalog() { return getGuideResourceCatalog(); },
    getSnapshot() {
      return {
        stage: state.stage,
        activePatientId: state.activePatientId,
        scanMode: state.scanMode,
        baselineMetrics: state.baselineMetrics,
        postMetrics: state.postMetrics,
        thermalResult: state.thermalResult,
        latestBiometrics: state.latestBiometrics,
        gameResult: state.gameResult,
        activeExercisePlan: gameEngine.getActiveCurriculum?.() || null,
        recommendation: state.recommendation,
        gardenSnapshot: state.gardenSnapshot,
        patientSessions: state.patientSessions,
        sessions: state.sessions
      };
    },
    async startFlow() {
      if (!state.activePatientId && normalizePatientId(elements.patientIdInput.value)) {
        await startPatientSessionFromEntry();
        return;
      }
      await startIntakeScanFlow();
    },
    async nextToGame() { await beginGameFlow(); },
    skipCurrentWorkout() { return gameEngine.skipCurrentAction("bridge"); }
  };
}

async function bootstrap() {
  bindUi();
  bindEvents();
  initializeBridge();
  hydrateAdaptiveState();
  setStage("intake");
  showPatientEntryScreen();
  cardiacEngine.emitStatus();
  setPill(elements.auraStatusPill, "Idle", "idle");
  setPill(elements.thermalStatusPill, "Idle", "idle");
  setPill(elements.handshakeStatusPill, "Idle", "idle");
  setPill(elements.cardiacStatusPill, "Idle", "idle");
  setPill(elements.deviceApiStatusPill, "Logged Out", "idle");
  setPill(elements.wearableStatusPill, "Idle", "idle");
  setPill(elements.neuroPhasePill, "Idle", "idle");
  await checkRuntimeHealth();
  if (!auraScanEngine.isSupported()) {
    log("Camera APIs are not supported in this browser.", "warn");
  }
  if (!wearableBridge.isSupported()) {
    setPill(elements.wearableStatusPill, "Unsupported", "warn");
  } else {
    void wearableBridge.tryAutoReconnect();
  }
  const lastPatientId = loadLastPatientId();
  if (lastPatientId) {
    elements.patientIdInput.value = lastPatientId;
    renderPatientLookupPreview(lastPatientId);
  } else {
    renderPatientLookupPreview("");
  }
  try {
    await ensureHydrawavReady("startup");
    setPill(elements.deviceApiStatusPill, "Authenticated", "live");
  } catch (error) {
    setPill(elements.deviceApiStatusPill, "Required", "warn");
    log(`HydraWav API is required. Setup/login failed on startup: ${error.message}`, "warn");
  }
  log("HYDRA-V flow runtime initialized.");
}

bootstrap();
