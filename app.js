import { DEFAULTS } from "./src/config/defaults.js";
import { EVENTS, HydraEventBus } from "./src/core/events.js";
import { clamp, round, safeNumber } from "./src/core/utils.js";
import { AuraScanEngine } from "./src/features/intake/AuraScanEngine.js";
import { NeuralHandshakeEngine } from "./src/features/priming/NeuralHandshakeEngine.js";
import { BLEHydrawavClient } from "./src/features/cardiac/BLEHydrawavClient.js";
import { CardiacGatingEngine } from "./src/features/cardiac/CardiacGatingEngine.js";
import { HydrawavMqttClient } from "./src/features/cardiac/HydrawavMqttClient.js";
import { PlasticityScoreEstimator } from "./src/features/cardiac/PlasticityScoreEstimator.js";
import { AdaptiveBeatSelector } from "./src/features/neuro/AdaptiveBeatSelector.js";
import { ElevenLabsClient } from "./src/features/neuro/ElevenLabsClient.js";
import { NarrationManager } from "./src/features/neuro/NarrationManager.js";
import { buildThetaNarration } from "./src/features/neuro/NarrationBuilder.js";
import { NeuroacousticEngine } from "./src/features/neuro/NeuroacousticEngine.js";
import { FascialThermalEngine } from "./src/features/thermal/FascialThermalEngine.js";
import { recommendProtocol, defaultProtocol, inferModality } from "./src/features/adaptive/AdaptiveProtocolEngine.js";
import { recoveryScore } from "./src/features/adaptive/scoring.js";
import { buildGardenSnapshot } from "./src/features/garden/GardenGrowthEngine.js";
import { renderGardenSnapshot } from "./src/features/garden/GardenCanvasRenderer.js";
import { RecoveryGameEngine } from "./src/features/game/RecoveryGameEngine.js";
import { ReyaMotionAdapter } from "./src/features/game/ReyaMotionAdapter.js";

const STORAGE_KEY = "hydrav_sessions_v1";
const ATHLETE_ID = "athlete-default-001";

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

const bleClient = new BLEHydrawavClient(eventBus);
const hydrawavMqttClient = new HydrawavMqttClient(eventBus, {
  loginProxyUrl: DEFAULTS.cardiac.mqtt.loginProxyUrl,
  publishProxyUrl: DEFAULTS.cardiac.mqtt.publishProxyUrl
});
const plasticityEstimator = new PlasticityScoreEstimator();
const cardiacEngine = new CardiacGatingEngine({
  eventBus,
  bleClient,
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
  bleStatusPill: byId("ble-status"),
  neuroPhasePill: byId("neuro-phase-status"),
  voiceStatusPill: byId("voice-status"),
  auraCameraCanvas: byId("aura-camera-canvas"),
  gameOverlayCanvas: byId("game-overlay-canvas"),
  startCameraButton: byId("start-camera"),
  stopCameraButton: byId("stop-camera"),
  scanDurationInput: byId("intake-scan-duration"),
  startIntakeScanButton: byId("start-intake-scan"),
  intakeProgressLabel: byId("intake-progress-label"),
  intakeAnalysisText: byId("intake-analysis-text"),
  intakeNextButton: byId("intake-next-button"),
  gameStartButton: byId("game-start-button"),
  gameStopButton: byId("game-stop-button"),
  gameStatus: byId("game-status"),
  gameActionTitle: byId("game-action-title"),
  gameActionDesc: byId("game-action-desc"),
  gameScore: byId("game-score"),
  gameReps: byId("game-reps"),
  gameActionsCount: byId("game-actions-count"),
  gameReyaSync: byId("game-reya-sync"),
  gameProgressFill: byId("game-progress-fill"),
  postscanStatus: byId("postscan-status"),
  summaryStatus: byId("summary-status"),
  summaryHrvDelta: byId("summary-hrv-delta"),
  summarySymmetryGain: byId("summary-symmetry-gain"),
  summaryMicroGain: byId("summary-micro-gain"),
  summaryReadinessGain: byId("summary-readiness-gain"),
  summaryRomGain: byId("summary-rom-gain"),
  summaryGameScore: byId("summary-game-score"),
  summaryReyaSync: byId("summary-reya-sync"),
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
  gateOffsetInput: byId("gate-offset"),
  gateOffsetValue: byId("gate-offset-value"),
  devicePrefixInput: byId("device-prefix"),
  serviceUuidInput: byId("service-uuid"),
  charUuidInput: byId("char-uuid"),
  connectBleButton: byId("connect-ble"),
  disconnectBleButton: byId("disconnect-ble"),
  toggleGatingButton: byId("toggle-gating"),
  voiceEnabledInput: byId("voice-enabled"),
  metricGateCount: byId("metric-gate-count"),
  metricLastDelay: byId("metric-last-delay"),
  metricBleFailures: byId("metric-ble-failures"),
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
  gameRunning: false,
  gameResult: null,
  voiceEnabled: DEFAULTS.voice.enabled,
  sessionContext: { athleteName: "Athlete", focusZone: "left shoulder" },
  protocolContext: { focusZone: "left shoulder", modality: "hybrid" },
  sessions: loadSessions(),
  recommendation: null,
  activeProtocol: defaultProtocol(),
  gardenSnapshot: null,
  lastSummaryRecord: null
};

const reyaMotionAdapter = DEFAULTS.game.useReyaMotionBridge
  ? new ReyaMotionAdapter()
  : null;

const gameEngine = new RecoveryGameEngine({
  getPoseLandmarks: () => auraScanEngine.getLatestPoseLandmarks(),
  overlayCanvasEl: elements.gameOverlayCanvas,
  reyaAdapter: reyaMotionAdapter,
  useReyaMirror: DEFAULTS.game.useReyaMirrorOnLeftShoulder,
  onStatus: (payload) => {
    elements.gameStatus.textContent = payload.status === "running"
      ? `Guided game running (${payload.side} ${payload.zone}).`
      : "Game stopped.";
    if (payload.status !== "running") {
      elements.gameReyaSync.textContent = "-- %";
    }
  },
  onProgress: (payload) => {
    elements.gameScore.textContent = `${Math.round(payload.score)}%`;
    elements.gameReps.textContent = `${payload.repsDone} / ${payload.repsTarget}`;
    elements.gameActionsCount.textContent = `${payload.actionsCompleted} / ${payload.actionsTotal}`;
    elements.gameReyaSync.textContent = Number.isFinite(payload.reyaSyncScore)
      ? `${Math.round(payload.reyaSyncScore)}%`
      : "-- %";
    elements.gameProgressFill.style.width = `${payload.score}%`;
  },
  onActionChanged: (payload) => {
    elements.gameActionTitle.textContent = `Action ${payload.index + 1}: ${payload.label}`;
    elements.gameActionDesc.textContent = payload.description;
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
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
}

function isWebGpuAvailable() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

function setStage(stage) {
  state.stage = stage;
  elements.stageIntakePanel.classList.toggle("hidden", stage !== "intake");
  elements.stageGamePanel.classList.toggle("hidden", stage !== "game");
  elements.stagePostscanPanel.classList.toggle("hidden", stage !== "postscan");
  elements.stageSummaryPanel.classList.toggle("hidden", stage !== "summary");
  elements.summarySection.classList.toggle("hidden", stage !== "summary");
  elements.stepIntake.classList.toggle("step-active", stage === "intake");
  elements.stepGame.classList.toggle("step-active", stage === "game" || stage === "postscan");
  elements.stepSummary.classList.toggle("step-active", stage === "summary");
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
  state.recommendation = recommendProtocol(state.sessions, isWebGpuAvailable());
  state.activeProtocol = { ...state.recommendation.protocol };
  state.gardenSnapshot = buildGardenSnapshot(state.sessions);
  renderRecommendation();
  renderGarden();
}

function syncOverlayCanvasSize() {
  const width = elements.auraCameraCanvas.width || 960;
  const height = elements.auraCameraCanvas.height || 540;
  elements.gameOverlayCanvas.width = width;
  elements.gameOverlayCanvas.height = height;
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
  auraScanEngine.stopCamera();
  thermalEngine.stopScan();
  thermalEngine.clearOverlay();
  neuralHandshakeEngine.stop();
  gameEngine.stop();
  state.cameraRunning = false;
  state.scanMode = null;
  state.gameRunning = false;
  log("Camera stopped.");
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
  elements.intakeProgressLabel.textContent = "Scanning...";
  state.intakeReady = false;
  elements.intakeNextButton.disabled = true;
}

function startAuraScan(mode, durationSec) {
  state.scanMode = mode;
  auraScanEngine.startScan(durationSec);
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
    const durationSec = clamp(Number(elements.scanDurationInput.value) || 60, 20, 180);
    state.baselineMetrics = null;
    state.postMetrics = null;
    state.thermalResult = null;
    state.gameResult = null;
    resetIntakeStageValues();
    startAuraScan("baseline", durationSec);
    log(`Started intake scan for ${durationSec}s.`);
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

  setStage("game");
  state.gameRunning = true;
  state.gameResult = null;
  elements.gameStatus.textContent = "Preparing guided game...";
  elements.gameProgressFill.style.width = "0%";
  elements.gameScore.textContent = "0%";
  elements.gameReps.textContent = "0 / 0";
  elements.gameActionsCount.textContent = "0 / 0";
  elements.gameReyaSync.textContent = "-- %";

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
  const reyaSuffix = reyaMotionAdapter ? " with Reya mirror sync." : ".";
  elements.gameStatus.textContent = `Game running on ${focus.side} ${focus.zone}. Follow action prompts${reyaSuffix}`;
  log(`Game flow started for ${focus.side} ${focus.zone}.`);
}

async function speakActionCue(payload) {
  if (!state.voiceEnabled) {
    return;
  }
  const text = `${state.sessionContext.athleteName}, action ${payload.index + 1}. ${payload.label}. ${payload.description}`;
  await narrationManager.speak(text, { source: "recovery-game", actionId: payload.id });
}

async function handleGameComplete(summary) {
  state.gameRunning = false;
  state.gameResult = summary;
  elements.gameStatus.textContent = "Game complete. Starting post-session recheck...";
  log(`Game complete. Score ${summary.score}% with ${summary.actionsCompleted}/${summary.actionsTotal} actions. Reya sync ${summary.reyaSyncAvg ?? "--"}%.`);
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
  const reyaSync = Number.isFinite(gameSummary?.reyaSyncAvg) ? gameSummary.reyaSyncAvg : 0;
  const painReduction = clamp(score / 18, 0, 6);
  return {
    hrvDelta: round(hrvDelta, 2),
    symmetryGain: round(symmetryGain, 2),
    symmetryDeltaRemaining: round(Math.max(symmetryDeltaRemaining, 0), 2),
    microsaccadeStabilityGain: round(microsaccadeStabilityGain, 3),
    painReduction: round(painReduction, 2),
    romGain: round(romGain, 2),
    reyaSync: round(reyaSync, 1),
    subjectiveReadinessGain: round(subjectiveReadinessGain, 2)
  };
}

function createSessionRecord(outcomes) {
  return {
    id: crypto.randomUUID(),
    athleteId: ATHLETE_ID,
    createdAt: new Date().toISOString(),
    modality: inferModality(state.activeProtocol),
    protocol: { ...state.activeProtocol },
    outcomes,
    focusZone: state.sessionContext.focusZone
  };
}

function buildSummaryVoiceText(sessionRecord, nextRecommendation) {
  const score = recoveryScore(sessionRecord);
  const focusZone = state.sessionContext.focusZone;
  const expected = round(nextRecommendation.expectedImprovement, 2);
  const reyaSync = Number.isFinite(sessionRecord?.outcomes?.reyaSync)
    ? Math.round(sessionRecord.outcomes.reyaSync)
    : null;
  const reyaText = reyaSync !== null ? ` Reya mirror sync averaged ${reyaSync} percent.` : "";
  return `${state.sessionContext.athleteName}, session complete. Recovery score is ${score}. Focus zone was ${focusZone}. Next adaptive protocol expects improvement of ${expected}.${reyaText} Your digital garden has grown with today's biological progress.`;
}

function renderSummary(outcomes, sessionRecord) {
  elements.summaryStatus.textContent = `Session saved (${new Date(sessionRecord.createdAt).toLocaleString()}).`;
  elements.summaryHrvDelta.textContent = asDelta(outcomes.hrvDelta, " ms");
  elements.summarySymmetryGain.textContent = asDelta(outcomes.symmetryGain, " %");
  elements.summaryMicroGain.textContent = asDelta(outcomes.microsaccadeStabilityGain, " Hz");
  elements.summaryReadinessGain.textContent = asDelta(outcomes.subjectiveReadinessGain, " /10");
  elements.summaryRomGain.textContent = asDelta(outcomes.romGain, " pts");
  elements.summaryGameScore.textContent = Number.isFinite(state.gameResult?.score) ? `${Math.round(state.gameResult.score)}%` : "--";
  elements.summaryReyaSync.textContent = Number.isFinite(outcomes.reyaSync) ? `${Math.round(outcomes.reyaSync)}%` : "--";
}

async function finalizeSession() {
  const outcomes = deriveSessionOutcomes(state.baselineMetrics, state.postMetrics, state.gameResult);
  const record = createSessionRecord(outcomes);
  state.sessions.push(record);
  persistSessions();
  state.lastSummaryRecord = record;
  hydrateAdaptiveState();
  renderSummary(outcomes, record);
  setStage("summary");
  if (state.voiceEnabled) {
    await narrationManager.speak(buildSummaryVoiceText(record, state.recommendation), { source: "summary-auto" });
  }
  log("Session completed and persisted. Feature 6/7 updated.");
}

function resetForNewSession() {
  state.scanMode = null;
  state.intakeReady = false;
  state.baselineMetrics = null;
  state.postMetrics = null;
  state.thermalResult = null;
  state.gameRunning = false;
  state.gameResult = null;
  elements.gameReyaSync.textContent = "-- %";
  elements.intakeNextButton.disabled = true;
  elements.intakeProgressLabel.textContent = "Ready for 60-second scan.";
  elements.intakeAnalysisText.textContent = "Complete the intake scan to generate body-map analysis and session targets.";
  gameEngine.stop();
  neuralHandshakeEngine.stop();
  thermalEngine.clearOverlay();
  setStage("intake");
  log("Ready for new session.");
}

async function playSummaryVoice() {
  if (!state.lastSummaryRecord) {
    log("No summary record available yet.", "warn");
    return;
  }
  await narrationManager.speak(buildSummaryVoiceText(state.lastSummaryRecord, state.recommendation), { source: "summary-manual" });
}

function bindUi() {
  narrationManager.setEnabled(state.voiceEnabled);
  elements.voiceEnabledInput.checked = state.voiceEnabled;
  setPill(elements.voiceStatusPill, state.voiceEnabled ? "Enabled" : "Disabled", state.voiceEnabled ? "live" : "idle");
  elements.scanDurationInput.value = String(DEFAULTS.auraScan.scanDurationSec);
  elements.gateOffsetInput.value = String(DEFAULTS.cardiac.gateOffsetMs);
  elements.gateOffsetValue.textContent = `${DEFAULTS.cardiac.gateOffsetMs} ms`;
  elements.mqttApiBaseUrlInput.value = DEFAULTS.cardiac.mqtt.apiBaseUrl;
  elements.mqttTopicInput.value = DEFAULTS.cardiac.mqtt.topic;
  elements.mqttDeviceMacInput.value = DEFAULTS.cardiac.mqtt.mac;

  elements.startCameraButton.addEventListener("click", () => { void ensureCameraStarted(); });
  elements.stopCameraButton.addEventListener("click", () => { stopCamera(); });
  elements.startIntakeScanButton.addEventListener("click", () => { void startIntakeScanFlow(); });
  elements.intakeNextButton.addEventListener("click", () => { void beginGameFlow(); });
  elements.gameStartButton.addEventListener("click", () => { if (!state.gameRunning) { void beginGameFlow(); } });
  elements.gameStopButton.addEventListener("click", async () => {
    if (state.gameRunning) {
      state.gameRunning = false;
      gameEngine.stop();
      neuralHandshakeEngine.stop();
      cardiacEngine.stop();
      neuroEngine.stopSession();
      if (state.scanMode === "game-monitor") {
        auraScanEngine.stopScan();
        state.scanMode = null;
      }
      elements.gameStatus.textContent = "Game stopped manually.";
      elements.gameReyaSync.textContent = "-- %";
      try {
        await publishHydrawavControlCommand(3, "stop");
      } catch (error) {
        log(`HydraWav stop warning: ${error.message}`, "warn");
      }
      log("Game stopped manually.", "warn");
    } else {
      gameEngine.stop();
    }
  });
  elements.summaryRestart.addEventListener("click", () => { resetForNewSession(); });
  elements.summaryPlayVoice.addEventListener("click", () => { void playSummaryVoice(); });
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

  elements.gateOffsetInput.addEventListener("input", () => {
    const value = Number(elements.gateOffsetInput.value);
    elements.gateOffsetValue.textContent = `${value} ms`;
    cardiacEngine.setOffsetMs(value);
  });
  elements.connectBleButton.addEventListener("click", async () => {
    try {
      await bleClient.connect({
        deviceNamePrefix: elements.devicePrefixInput.value,
        serviceUuid: elements.serviceUuidInput.value,
        characteristicUuid: elements.charUuidInput.value
      });
      log(`BLE connected to ${bleClient.device?.name || "device"}.`);
    } catch (error) {
      log(`BLE connect failed: ${error.message}`, "warn");
    }
  });
  elements.disconnectBleButton.addEventListener("click", () => { bleClient.disconnect(); });
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
    syncOverlayCanvasSize();
    renderGarden();
  });
}

function bindEvents() {
  eventBus.on(EVENTS.AURA_SCAN_STATUS, (event) => {
    const status = event.detail.status || "idle";
    const type = status.includes("failed") ? "warn" : ((status.includes("scan") || status.includes("running")) ? "live" : "idle");
    setPill(elements.auraStatusPill, humanize(status), type);
    if (status === "camera_running") {
      state.cameraRunning = true;
      syncOverlayCanvasSize();
    }
    if (status === "camera_stopped") {
      state.cameraRunning = false;
    }
  });

  eventBus.on(EVENTS.AURA_SCAN_FRAME, (event) => {
    const d = event.detail;
    elements.metricAuraHr.textContent = Number.isFinite(d.heartRateBpm) ? `${round(d.heartRateBpm, 1)} bpm` : "-- bpm";
    elements.metricAuraHrv.textContent = Number.isFinite(d.hrvRmssdMs) ? `${round(d.hrvRmssdMs, 1)} ms` : "-- ms";
    elements.metricAuraSymmetry.textContent = Number.isFinite(d.symmetryDeltaPct) ? `${round(d.symmetryDeltaPct, 2)} %` : "-- %";
    elements.metricAuraMicro.textContent = Number.isFinite(d.microsaccadeHz) ? `${round(d.microsaccadeHz, 3)} Hz` : "-- Hz";
    elements.metricAuraBreath.textContent = Number.isFinite(d.breathRatePerMin) ? `${round(d.breathRatePerMin, 1)} /min` : "-- /min";
    elements.metricAuraReadiness.textContent = Number.isFinite(d.readinessScore) ? `${round(d.readinessScore, 2)} / 10` : "-- / 10";
    elements.metricAuraAlgorithm.textContent = typeof d.algorithm === "string" && d.algorithm ? d.algorithm.toUpperCase() : "--";
    elements.metricAuraSource.textContent = typeof d.vitalsSource === "string" && d.vitalsSource ? d.vitalsSource : "--";
    const progress = clamp(Number(d.progress || 0), 0, 1);
    if (state.scanMode === "baseline") {
      elements.intakeProgressLabel.textContent = `Intake scan progress ${Math.round(progress * 100)}%`;
    } else if (state.scanMode === "post") {
      elements.postscanStatus.textContent = `Post-scan progress ${Math.round(progress * 100)}%`;
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
      void finalizeSession();
      return;
    }
  });

  eventBus.on(EVENTS.BIOMETRIC_FRAME, (event) => {
    const frame = normalizeFrame(event.detail);
    state.latestBiometrics = { ...state.latestBiometrics, ...frame };
    cardiacEngine.ingestFrame(frame);
    neuroEngine.updateBiometrics(frame);
    elements.metricHeartRate.textContent = Number.isFinite(frame.heartRateBpm) ? `${round(frame.heartRateBpm, 1)} bpm` : "-- bpm";
    elements.metricRR.textContent = Number.isFinite(frame.rrIntervalMs) ? `${round(frame.rrIntervalMs, 1)} ms` : "-- ms";
    elements.metricMicro.textContent = Number.isFinite(frame.microsaccadeHz) ? `${round(frame.microsaccadeHz, 2)} Hz` : "-- Hz";
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

  eventBus.on(EVENTS.CARDIAC_TRANSPORT_STATUS, (event) => {
    const status = event.detail.status || "disconnected";
    const type = status === "connected" ? "live" : (status === "error" ? "warn" : "idle");
    setPill(elements.bleStatusPill, humanize(status), type);
    elements.metricBleFailures.textContent = String(event.detail.failedCount ?? 0);
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
    if (phase === "during" && state.voiceEnabled) {
      void narrationManager.speak(
        buildThetaNarration({
          sessionContext: state.sessionContext,
          protocolContext: state.protocolContext,
          biometrics: state.latestBiometrics,
          beatHz: null,
          plasticityScore: state.plasticity?.score0To10
        }),
        { source: "theta-phase" }
      );
    }
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
    version: "0.4.0",
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
    async connectHydrawav3Ble(config = {}) {
      await bleClient.connect({
        deviceNamePrefix: config.deviceNamePrefix ?? elements.devicePrefixInput.value,
        serviceUuid: config.serviceUuid ?? elements.serviceUuidInput.value,
        characteristicUuid: config.characteristicUuid ?? elements.charUuidInput.value
      });
    },
    disconnectHydrawav3Ble() { bleClient.disconnect(); },
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
    getSnapshot() {
      return {
        stage: state.stage,
        scanMode: state.scanMode,
        baselineMetrics: state.baselineMetrics,
        postMetrics: state.postMetrics,
        thermalResult: state.thermalResult,
        latestBiometrics: state.latestBiometrics,
        gameResult: state.gameResult,
        recommendation: state.recommendation,
        gardenSnapshot: state.gardenSnapshot,
        sessions: state.sessions
      };
    },
    async startFlow() { await startIntakeScanFlow(); },
    async nextToGame() { await beginGameFlow(); }
  };
}

async function bootstrap() {
  bindUi();
  bindEvents();
  initializeBridge();
  hydrateAdaptiveState();
  setStage("intake");
  cardiacEngine.emitStatus();
  bleClient.emitStatus("disconnected", { sentCount: 0, failedCount: 0 });
  setPill(elements.auraStatusPill, "Idle", "idle");
  setPill(elements.thermalStatusPill, "Idle", "idle");
  setPill(elements.handshakeStatusPill, "Idle", "idle");
  setPill(elements.cardiacStatusPill, "Idle", "idle");
  setPill(elements.deviceApiStatusPill, "Logged Out", "idle");
  setPill(elements.bleStatusPill, "Disconnected", "idle");
  setPill(elements.neuroPhasePill, "Idle", "idle");
  if (!bleClient.isSupported()) {
    log("Web Bluetooth is not supported in this browser. Use Chrome/Edge on HTTPS or localhost.", "warn");
  }
  if (!auraScanEngine.isSupported()) {
    log("Camera APIs are not supported in this browser.", "warn");
  }
  try {
    await ensureHydrawavReady("startup");
    setPill(elements.deviceApiStatusPill, "Authenticated", "live");
  } catch (error) {
    setPill(elements.deviceApiStatusPill, "Required", "warn");
    log(`HydraWav API is required. Setup/login failed on startup: ${error.message}`, "warn");
  }
  log("HYDRA-V flow runtime initialized (Features 1-7).");
}

bootstrap();
