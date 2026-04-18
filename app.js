import { DEFAULTS } from "./src/config/defaults.js";
import { EVENTS, HydraEventBus } from "./src/core/events.js";
import { clamp, formatTime, round, safeNumber } from "./src/core/utils.js";
import { AuraScanEngine } from "./src/features/intake/AuraScanEngine.js";
import { NeuralHandshakeEngine } from "./src/features/priming/NeuralHandshakeEngine.js";
import { BLEHydrawavClient } from "./src/features/cardiac/BLEHydrawavClient.js";
import { CardiacGatingEngine } from "./src/features/cardiac/CardiacGatingEngine.js";
import { HydrawavMqttClient } from "./src/features/cardiac/HydrawavMqttClient.js";
import { PlasticityScoreEstimator } from "./src/features/cardiac/PlasticityScoreEstimator.js";
import { AdaptiveBeatSelector } from "./src/features/neuro/AdaptiveBeatSelector.js";
import { ElevenLabsClient } from "./src/features/neuro/ElevenLabsClient.js";
import { NarrationManager } from "./src/features/neuro/NarrationManager.js";
import { buildPostSessionNarration, buildThetaNarration } from "./src/features/neuro/NarrationBuilder.js";
import { NeuroacousticEngine } from "./src/features/neuro/NeuroacousticEngine.js";

class HeartbeatSimulator {
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.timeoutId = null;
    this.running = false;
    this.baseBpm = 72;
  }

  start(baseBpm = 72) {
    if (this.running) {
      return;
    }

    this.running = true;
    this.baseBpm = clamp(baseBpm, 40, 180);
    this.scheduleNextBeat();
  }

  stop() {
    this.running = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  scheduleNextBeat() {
    if (!this.running) {
      return;
    }

    const jitter = (Math.random() - 0.5) * 80;
    const rrMs = clamp(60000 / this.baseBpm + jitter, 400, 1500);

    this.timeoutId = setTimeout(() => {
      const heartRateBpm = 60000 / rrMs;
      const frame = {
        timestampMs: performance.now(),
        rPeakDetected: true,
        rrIntervalMs: rrMs,
        heartRateBpm,
        hrvRmssdMs: clamp(32 + (Math.random() - 0.5) * 10, 15, 90),
        microsaccadeHz: clamp(0.65 + (Math.random() - 0.5) * 0.35, 0.2, 2.5)
      };

      this.onFrame(frame);
      this.scheduleNextBeat();
    }, rrMs);
  }
}

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

const simulator = new HeartbeatSimulator((frame) => {
  publishBiometricFrame(frame);
});

const state = {
  sessionContext: {
    athleteName: "Athlete",
    focusZone: "left shoulder"
  },
  protocolContext: {
    focusZone: "left shoulder",
    modality: "photobiomodulation + resonance"
  },
  latestBiometrics: {},
  plasticity: null,
  aura: {
    status: "idle",
    progress: 0,
    coldZone: "Awaiting scan",
    algorithm: "--"
  },
  handshake: {
    status: "idle",
    progress: 0,
    zoneSource: "Manual"
  },
  cardiacEngine: {
    active: false,
    sequenceId: 0,
    offsetMs: DEFAULTS.cardiac.gateOffsetMs
  },
  transport: {
    status: "disconnected",
    failedCount: 0,
    sentCount: 0
  },
  mqtt: {
    status: "logged_out",
    hasToken: false,
    gatePublishEnabled: DEFAULTS.cardiac.mqtt.gatePublishEnabled
  },
  neuro: {
    phase: "idle",
    beatHz: null,
    arousalIndex: null,
    phaseTimeRemainingSec: null,
    sessionProgressPercent: 0
  },
  thetaNarrationTimer: null
};

const elements = {
  auraStatusPill: byId("aura-status-pill"),
  handshakeStatusPill: byId("handshake-status-pill"),
  cardiacEngineStatus: byId("cardiac-engine-status"),
  deviceApiStatus: byId("device-api-status"),
  bleStatus: byId("ble-status"),
  neuroPhaseStatus: byId("neuro-phase-status"),
  voiceStatus: byId("voice-status"),

  metricHeartRate: byId("metric-heart-rate"),
  metricRR: byId("metric-rr"),
  metricMicro: byId("metric-micro"),
  metricPlasticity: byId("metric-plasticity"),

  auraScanDurationInput: byId("aura-scan-duration"),
  auraColdZoneInput: byId("aura-cold-zone"),
  auraStartCameraButton: byId("aura-start-camera"),
  auraStopCameraButton: byId("aura-stop-camera"),
  auraStartScanButton: byId("aura-start-scan"),
  auraStopScanButton: byId("aura-stop-scan"),

  metricAuraStatus: byId("metric-aura-status"),
  metricAuraProgress: byId("metric-aura-progress"),
  metricAuraHr: byId("metric-aura-hr"),
  metricAuraHrv: byId("metric-aura-hrv"),
  metricAuraSymmetry: byId("metric-aura-symmetry"),
  metricAuraMicro: byId("metric-aura-micro"),
  metricAuraBreath: byId("metric-aura-breath"),
  metricAuraReadiness: byId("metric-aura-readiness"),
  metricAuraAlgorithm: byId("metric-aura-algorithm"),
  metricAuraSource: byId("metric-aura-source"),

  handshakeZoneSelect: byId("handshake-zone"),
  handshakeInjuredSideSelect: byId("handshake-injured-side"),
  handshakeDurationInput: byId("handshake-duration"),
  handshakeRecordButton: byId("handshake-record"),
  handshakeStopButton: byId("handshake-stop"),
  metricHandshakeStatus: byId("metric-handshake-status"),
  metricHandshakeProgress: byId("metric-handshake-progress"),
  metricHandshakeZoneSource: byId("metric-handshake-zone-source"),

  gateOffsetInput: byId("gate-offset"),
  gateOffsetValue: byId("gate-offset-value"),
  devicePrefixInput: byId("device-prefix"),
  serviceUuidInput: byId("service-uuid"),
  charUuidInput: byId("char-uuid"),
  connectBleButton: byId("connect-ble"),
  disconnectBleButton: byId("disconnect-ble"),
  toggleGatingButton: byId("toggle-gating"),

  mqttApiBaseUrlInput: byId("mqtt-api-base-url"),
  mqttUsernameInput: byId("mqtt-username"),
  mqttPasswordInput: byId("mqtt-password"),
  mqttTopicInput: byId("mqtt-topic"),
  mqttDeviceMacInput: byId("mqtt-device-mac"),
  mqttGateTopicInput: byId("mqtt-gate-topic"),
  mqttGateEnabledInput: byId("mqtt-gate-enabled"),
  mqttLoginButton: byId("mqtt-login"),
  mqttStartButton: byId("mqtt-start"),
  mqttPauseButton: byId("mqtt-pause"),
  mqttResumeButton: byId("mqtt-resume"),
  mqttStopButton: byId("mqtt-stop"),

  metricGateCount: byId("metric-gate-count"),
  metricLastDelay: byId("metric-last-delay"),
  metricBleFailures: byId("metric-ble-failures"),
  metricSeqId: byId("metric-seq-id"),

  carrierFrequencyInput: byId("carrier-frequency"),
  phasePreInput: byId("phase-pre"),
  phaseDuringInput: byId("phase-during"),
  phasePostInput: byId("phase-post"),
  enableAudioButton: byId("enable-audio"),
  startNeuroSessionButton: byId("start-neuro-session"),
  stopNeuroSessionButton: byId("stop-neuro-session"),

  metricBeatHz: byId("metric-beat-hz"),
  metricArousal: byId("metric-arousal"),
  metricPhaseTime: byId("metric-phase-time"),
  metricSessionComplete: byId("metric-session-complete"),

  voiceEnabledInput: byId("voice-enabled"),
  voiceProxyInput: byId("voice-proxy-url"),
  voiceIdInput: byId("voice-id"),
  voiceModelInput: byId("voice-model-id"),
  testThetaButton: byId("test-theta-note"),
  testPostButton: byId("test-post-note"),

  emitSampleFrameButton: byId("emit-sample-frame"),
  startSimHeartbeatButton: byId("start-sim-heartbeat"),
  stopSimHeartbeatButton: byId("stop-sim-heartbeat"),
  runtimeLog: byId("runtime-log")
};

function byId(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element with id: ${id}`);
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

function setSessionAndProtocolFocus(zoneLabel) {
  if (!zoneLabel || typeof zoneLabel !== "string") {
    return;
  }

  state.sessionContext = {
    ...state.sessionContext,
    focusZone: zoneLabel
  };

  state.protocolContext = {
    ...state.protocolContext,
    focusZone: zoneLabel
  };

  eventBus.emit(EVENTS.SESSION_CONTEXT, { ...state.sessionContext });
  eventBus.emit(EVENTS.PROTOCOL_CONTEXT, { ...state.protocolContext });
}

function initializeBridge() {
  window.HydraVBridge = {
    version: "0.2.0",

    publishBiometricFrame,
    publishRPeak(input = {}) {
      eventBus.emit(EVENTS.R_PEAK, {
        timestampMs: Number.isFinite(input.timestampMs) ? input.timestampMs : performance.now(),
        rrIntervalMs: safeNumber(input.rrIntervalMs ?? input.rrMs, null),
        heartRateBpm: safeNumber(input.heartRateBpm ?? input.hrBpm, null)
      });
    },

    setSessionContext(context = {}) {
      state.sessionContext = {
        ...state.sessionContext,
        ...context
      };
      eventBus.emit(EVENTS.SESSION_CONTEXT, { ...state.sessionContext });
    },

    setProtocolContext(context = {}) {
      state.protocolContext = {
        ...state.protocolContext,
        ...context
      };
      eventBus.emit(EVENTS.PROTOCOL_CONTEXT, { ...state.protocolContext });
    },

    async startAuraCamera() {
      await auraScanEngine.startCamera();
    },

    stopAuraCamera() {
      auraScanEngine.stopCamera();
    },

    startAuraScan(options = {}) {
      auraScanEngine.startScan(Number(options.durationSec) || DEFAULTS.auraScan.scanDurationSec);
    },

    stopAuraScan() {
      auraScanEngine.stopScan();
    },

    setHandshakeTarget(target = {}) {
      neuralHandshakeEngine.setTarget({
        zone: target.zone ?? elements.handshakeZoneSelect.value,
        injuredSide: target.injuredSide ?? elements.handshakeInjuredSideSelect.value
      });
    },

    startNeuralHandshake(options = {}) {
      neuralHandshakeEngine.startRecording(Number(options.durationSec) || DEFAULTS.neuralHandshake.recordDurationSec);
    },

    stopNeuralHandshake() {
      neuralHandshakeEngine.stop();
    },

    startCardiacGating() {
      cardiacEngine.start();
    },

    stopCardiacGating() {
      cardiacEngine.stop();
    },

    setGateOffsetMs(offsetMs) {
      cardiacEngine.setOffsetMs(offsetMs);
    },

    async connectHydrawav3Ble(config) {
      await bleClient.connect({
        deviceNamePrefix: config?.deviceNamePrefix ?? elements.devicePrefixInput.value,
        serviceUuid: config?.serviceUuid ?? elements.serviceUuidInput.value,
        characteristicUuid: config?.characteristicUuid ?? elements.charUuidInput.value
      });
    },

    disconnectHydrawav3Ble() {
      bleClient.disconnect();
    },

    async loginHydrawavMqtt(credentials = {}) {
      return await hydrawavMqttClient.login({
        apiBaseUrl: credentials.apiBaseUrl ?? elements.mqttApiBaseUrlInput.value.trim(),
        username: credentials.username ?? elements.mqttUsernameInput.value.trim(),
        password: credentials.password ?? elements.mqttPasswordInput.value,
        rememberMe: credentials.rememberMe ?? true
      });
    },

    async publishHydrawavMqtt(message = {}) {
      return await hydrawavMqttClient.publish({
        apiBaseUrl: message.apiBaseUrl ?? elements.mqttApiBaseUrlInput.value.trim(),
        topic: message.topic ?? elements.mqttTopicInput.value.trim(),
        payload: message.payload
      });
    },

    async sendHydrawavCommand(input = {}) {
      return await hydrawavMqttClient.sendControlCommand({
        apiBaseUrl: input.apiBaseUrl ?? elements.mqttApiBaseUrlInput.value.trim(),
        topic: input.topic ?? elements.mqttTopicInput.value.trim(),
        mac: input.mac ?? elements.mqttDeviceMacInput.value.trim(),
        playCmd: Number.isInteger(input.playCmd) ? input.playCmd : 1,
        extra: input.extra ?? {}
      });
    },

    async enableNeuroAudio() {
      await neuroEngine.enableAudio();
    },

    startNeuroSession(sessionPlan = {}) {
      neuroEngine.startSession({
        preSeconds: safeNumber(sessionPlan.preSeconds, DEFAULTS.neuro.phaseDurationSec.pre),
        duringSeconds: safeNumber(sessionPlan.duringSeconds, DEFAULTS.neuro.phaseDurationSec.during),
        postSeconds: safeNumber(sessionPlan.postSeconds, DEFAULTS.neuro.phaseDurationSec.post)
      });
    },

    stopNeuroSession() {
      neuroEngine.stopSession();
    },

    async speakNarration(text) {
      await narrationManager.speak(text, { source: "bridge" });
    },

    getSnapshot() {
      return {
        sessionContext: state.sessionContext,
        protocolContext: state.protocolContext,
        latestBiometrics: state.latestBiometrics,
        aura: state.aura,
        handshake: state.handshake,
        plasticity: state.plasticity,
        cardiac: state.cardiacEngine,
        transport: state.transport,
        mqtt: state.mqtt,
        neuro: state.neuro
      };
    }
  };
}

function bindUi() {
  elements.auraScanDurationInput.value = String(DEFAULTS.auraScan.scanDurationSec);
  elements.handshakeZoneSelect.value = DEFAULTS.neuralHandshake.defaultZone;
  elements.handshakeInjuredSideSelect.value = DEFAULTS.neuralHandshake.defaultInjuredSide;
  elements.handshakeDurationInput.value = String(DEFAULTS.neuralHandshake.recordDurationSec);

  elements.gateOffsetInput.value = String(DEFAULTS.cardiac.gateOffsetMs);
  elements.gateOffsetValue.textContent = `${DEFAULTS.cardiac.gateOffsetMs} ms`;

  elements.voiceEnabledInput.checked = DEFAULTS.voice.enabled;
  narrationManager.setEnabled(DEFAULTS.voice.enabled);

  elements.mqttApiBaseUrlInput.value = DEFAULTS.cardiac.mqtt.apiBaseUrl;
  elements.mqttTopicInput.value = DEFAULTS.cardiac.mqtt.topic;
  elements.mqttDeviceMacInput.value = DEFAULTS.cardiac.mqtt.mac;
  elements.mqttGateTopicInput.value = DEFAULTS.cardiac.mqtt.gateTopic;
  elements.mqttGateEnabledInput.checked = DEFAULTS.cardiac.mqtt.gatePublishEnabled;
  state.mqtt.gatePublishEnabled = DEFAULTS.cardiac.mqtt.gatePublishEnabled;

  elements.auraStartCameraButton.addEventListener("click", async () => {
    try {
      await auraScanEngine.startCamera();
      log("Aura camera started.");
    } catch (error) {
      log(`Aura camera start failed: ${error.message}`, "warn");
    }
  });

  elements.auraStopCameraButton.addEventListener("click", () => {
    auraScanEngine.stopCamera();
    neuralHandshakeEngine.stop();
    log("Aura camera stopped.");
  });

  elements.auraStartScanButton.addEventListener("click", () => {
    try {
      const duration = Number(elements.auraScanDurationInput.value);
      auraScanEngine.startScan(duration);
      log(`Aura scan started for ${duration || DEFAULTS.auraScan.scanDurationSec}s.`);
    } catch (error) {
      log(`Aura scan failed to start: ${error.message}`, "warn");
    }
  });

  elements.auraStopScanButton.addEventListener("click", () => {
    auraScanEngine.stopScan();
    log("Aura scan stopped.");
  });

  const syncHandshakeTargetFromUi = () => {
    neuralHandshakeEngine.setTarget({
      zone: elements.handshakeZoneSelect.value,
      injuredSide: elements.handshakeInjuredSideSelect.value
    });
    state.handshake.zoneSource = "Manual";
    elements.metricHandshakeZoneSource.textContent = state.handshake.zoneSource;
  };

  elements.handshakeZoneSelect.addEventListener("change", syncHandshakeTargetFromUi);
  elements.handshakeInjuredSideSelect.addEventListener("change", syncHandshakeTargetFromUi);

  elements.handshakeRecordButton.addEventListener("click", () => {
    try {
      const durationSec = Number(elements.handshakeDurationInput.value);
      syncHandshakeTargetFromUi();
      neuralHandshakeEngine.startRecording(durationSec);
      log("Neural handshake recording started.");
    } catch (error) {
      log(`Neural handshake start failed: ${error.message}`, "warn");
    }
  });

  elements.handshakeStopButton.addEventListener("click", () => {
    neuralHandshakeEngine.stop();
    log("Neural handshake stopped.");
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
      log(`BLE connection failed: ${error.message}`, "warn");
    }
  });

  elements.disconnectBleButton.addEventListener("click", () => {
    bleClient.disconnect();
    log("BLE disconnected.");
  });

  elements.toggleGatingButton.addEventListener("click", () => {
    if (state.cardiacEngine.active) {
      cardiacEngine.stop();
      log("Cardiac gating stopped.");
    } else {
      cardiacEngine.start();
      log(`Cardiac gating started at ${state.cardiacEngine.offsetMs} ms offset.`);
    }
  });

  elements.mqttGateEnabledInput.addEventListener("change", () => {
    state.mqtt.gatePublishEnabled = elements.mqttGateEnabledInput.checked;
    log(state.mqtt.gatePublishEnabled ? "MQTT gate telemetry enabled." : "MQTT gate telemetry disabled.");
  });

  const readMqttBaseConfig = () => ({
    apiBaseUrl: elements.mqttApiBaseUrlInput.value.trim(),
    topic: elements.mqttTopicInput.value.trim(),
    mac: elements.mqttDeviceMacInput.value.trim()
  });

  elements.mqttLoginButton.addEventListener("click", async () => {
    const config = readMqttBaseConfig();
    try {
      await hydrawavMqttClient.login({
        apiBaseUrl: config.apiBaseUrl,
        username: elements.mqttUsernameInput.value.trim(),
        password: elements.mqttPasswordInput.value,
        rememberMe: true
      });
      log("HydraWav MQTT API login successful.");
    } catch (error) {
      log(`HydraWav API login failed: ${error.message}`, "warn");
    }
  });

  elements.mqttStartButton.addEventListener("click", async () => {
    const config = readMqttBaseConfig();
    try {
      const startPayload = buildHydrawavStartPayload(config.mac);
      await hydrawavMqttClient.publish({
        apiBaseUrl: config.apiBaseUrl,
        topic: config.topic,
        payload: JSON.stringify(startPayload)
      });
      log("HydraWav start command published.");
    } catch (error) {
      log(`HydraWav start failed: ${error.message}`, "warn");
    }
  });

  elements.mqttPauseButton.addEventListener("click", async () => {
    const config = readMqttBaseConfig();
    try {
      await hydrawavMqttClient.sendControlCommand({
        apiBaseUrl: config.apiBaseUrl,
        topic: config.topic,
        mac: config.mac,
        playCmd: 2
      });
      log("HydraWav pause command published.");
    } catch (error) {
      log(`HydraWav pause failed: ${error.message}`, "warn");
    }
  });

  elements.mqttResumeButton.addEventListener("click", async () => {
    const config = readMqttBaseConfig();
    try {
      await hydrawavMqttClient.sendControlCommand({
        apiBaseUrl: config.apiBaseUrl,
        topic: config.topic,
        mac: config.mac,
        playCmd: 4
      });
      log("HydraWav resume command published.");
    } catch (error) {
      log(`HydraWav resume failed: ${error.message}`, "warn");
    }
  });

  elements.mqttStopButton.addEventListener("click", async () => {
    const config = readMqttBaseConfig();
    try {
      await hydrawavMqttClient.sendControlCommand({
        apiBaseUrl: config.apiBaseUrl,
        topic: config.topic,
        mac: config.mac,
        playCmd: 3
      });
      log("HydraWav stop command published.");
    } catch (error) {
      log(`HydraWav stop failed: ${error.message}`, "warn");
    }
  });

  elements.enableAudioButton.addEventListener("click", async () => {
    try {
      neuroEngine.setCarrierHz(Number(elements.carrierFrequencyInput.value));
      await neuroEngine.enableAudio();
      setPill(elements.neuroPhaseStatus, "Audio Ready", "live");
      log("Audio engine enabled.");
    } catch (error) {
      log(`Audio enable failed: ${error.message}`, "warn");
    }
  });

  elements.carrierFrequencyInput.addEventListener("change", () => {
    neuroEngine.setCarrierHz(Number(elements.carrierFrequencyInput.value));
  });

  elements.startNeuroSessionButton.addEventListener("click", () => {
    try {
      neuroEngine.startSession({
        preSeconds: Number(elements.phasePreInput.value),
        duringSeconds: Number(elements.phaseDuringInput.value),
        postSeconds: Number(elements.phasePostInput.value)
      });
      log("Neuroacoustic session started.");
    } catch (error) {
      log(`Session start failed: ${error.message}`, "warn");
    }
  });

  elements.stopNeuroSessionButton.addEventListener("click", () => {
    neuroEngine.stopSession();
    log("Neuroacoustic session stopped.");
  });

  elements.voiceEnabledInput.addEventListener("change", () => {
    const enabled = elements.voiceEnabledInput.checked;
    narrationManager.setEnabled(enabled);
    setPill(elements.voiceStatus, enabled ? "Enabled" : "Disabled", enabled ? "live" : "idle");
    log(enabled ? "Voice narration enabled." : "Voice narration disabled.");
  });

  const applyVoiceConfig = () => {
    elevenLabsClient.updateConfig({
      proxyUrl: elements.voiceProxyInput.value.trim(),
      voiceId: elements.voiceIdInput.value.trim(),
      modelId: elements.voiceModelInput.value.trim()
    });
  };

  elements.voiceProxyInput.addEventListener("change", applyVoiceConfig);
  elements.voiceIdInput.addEventListener("change", applyVoiceConfig);
  elements.voiceModelInput.addEventListener("change", applyVoiceConfig);

  elements.testThetaButton.addEventListener("click", async () => {
    applyVoiceConfig();
    await narrationManager.speak(
      buildThetaNarration({
        sessionContext: state.sessionContext,
        protocolContext: state.protocolContext,
        biometrics: state.latestBiometrics,
        beatHz: state.neuro.beatHz || 6,
        plasticityScore: state.plasticity?.score0To10
      }),
      { type: "theta-test" }
    );
  });

  elements.testPostButton.addEventListener("click", async () => {
    applyVoiceConfig();
    await narrationManager.speak(
      buildPostSessionNarration({
        sessionContext: state.sessionContext,
        protocolContext: state.protocolContext,
        biometrics: state.latestBiometrics,
        beatHz: state.neuro.beatHz || 10,
        plasticityScore: state.plasticity?.score0To10
      }),
      { type: "post-test" }
    );
  });

  elements.emitSampleFrameButton.addEventListener("click", () => {
    publishBiometricFrame({
      timestampMs: performance.now(),
      rPeakDetected: true,
      rrIntervalMs: 845,
      heartRateBpm: 71,
      hrvRmssdMs: 38,
      microsaccadeHz: 0.74
    });
    log("Published sample biometric frame.");
  });

  elements.startSimHeartbeatButton.addEventListener("click", () => {
    simulator.start();
    log("Heartbeat simulator running.");
  });

  elements.stopSimHeartbeatButton.addEventListener("click", () => {
    simulator.stop();
    log("Heartbeat simulator stopped.");
  });
}

function bindEvents() {
  eventBus.on(EVENTS.AURA_SCAN_STATUS, (event) => {
    const status = event.detail.status || "idle";
    state.aura.status = status;

    const statusLabel = humanize(status);
    elements.metricAuraStatus.textContent = statusLabel;

    const pillType = status.includes("failed")
      ? "warn"
      : (status.includes("scan") || status.includes("running") ? "live" : "idle");
    setPill(elements.auraStatusPill, statusLabel, pillType);
  });

  eventBus.on(EVENTS.AURA_SCAN_FRAME, (event) => {
    const d = event.detail;

    state.aura.progress = d.progress ?? 0;
    elements.metricAuraProgress.textContent = `${round((d.progress ?? 0) * 100, 1)}%`;

    if (Number.isFinite(d.heartRateBpm)) {
      elements.metricAuraHr.textContent = `${round(d.heartRateBpm, 1)} bpm`;
    }

    if (Number.isFinite(d.hrvRmssdMs)) {
      elements.metricAuraHrv.textContent = `${round(d.hrvRmssdMs, 1)} ms`;
    }

    if (Number.isFinite(d.symmetryDeltaPct)) {
      elements.metricAuraSymmetry.textContent = `${round(d.symmetryDeltaPct, 2)} %`;
    }

    if (Number.isFinite(d.microsaccadeHz)) {
      elements.metricAuraMicro.textContent = `${round(d.microsaccadeHz, 3)} Hz`;
    }

    if (Number.isFinite(d.breathRatePerMin)) {
      elements.metricAuraBreath.textContent = `${round(d.breathRatePerMin, 1)} /min`;
    }

    if (Number.isFinite(d.readinessScore)) {
      elements.metricAuraReadiness.textContent = `${round(d.readinessScore, 2)} / 10`;
    }

    if (d.algorithm) {
      state.aura.algorithm = d.algorithm;
      elements.metricAuraAlgorithm.textContent = d.algorithm.toUpperCase();
    }

    if (typeof d.vitalsSource === "string" && d.vitalsSource) {
      elements.metricAuraSource.textContent = d.vitalsSource;
    }
  });

  eventBus.on(EVENTS.AURA_SCAN_COMPLETE, (event) => {
    const d = event.detail;

    elements.metricAuraProgress.textContent = "100%";

    const topZone = pickTopZone(d.flaggedZones);
    if (topZone) {
      const zoneLabel = `${topZone.side} ${topZone.zone}`;
      state.aura.coldZone = zoneLabel;
      elements.auraColdZoneInput.value = zoneLabel;

      elements.handshakeZoneSelect.value = topZone.zone;
      elements.handshakeInjuredSideSelect.value = topZone.side;
      neuralHandshakeEngine.setTarget({ zone: topZone.zone, injuredSide: topZone.side });
      state.handshake.zoneSource = "Aura-Scan";
      elements.metricHandshakeZoneSource.textContent = state.handshake.zoneSource;

      setSessionAndProtocolFocus(zoneLabel);
    } else {
      elements.auraColdZoneInput.value = "No strong asymmetry zone found";
    }

    log(`Aura scan complete. Readiness ${round(d.readinessScore ?? 0, 2)}/10.`);
  });

  eventBus.on(EVENTS.NEURAL_HANDSHAKE_STATUS, (event) => {
    const status = event.detail.status || "idle";
    state.handshake.status = status;

    const label = humanize(status);
    elements.metricHandshakeStatus.textContent = label;
    setPill(elements.handshakeStatusPill, label, status === "idle" ? "idle" : "live");
  });

  eventBus.on(EVENTS.NEURAL_HANDSHAKE_PROGRESS, (event) => {
    const progress = clamp(event.detail.progress ?? 0, 0, 1);
    state.handshake.progress = progress;
    elements.metricHandshakeProgress.textContent = `${round(progress * 100, 1)}%`;
  });

  eventBus.on(EVENTS.BIOMETRIC_FRAME, (event) => {
    const frame = normalizeFrame(event.detail);
    state.latestBiometrics = {
      ...state.latestBiometrics,
      ...frame
    };

    cardiacEngine.ingestFrame(frame);
    neuroEngine.updateBiometrics(frame);

    if (Number.isFinite(frame.heartRateBpm)) {
      elements.metricHeartRate.textContent = `${round(frame.heartRateBpm, 1)} bpm`;
    }

    if (Number.isFinite(frame.rrIntervalMs)) {
      elements.metricRR.textContent = `${round(frame.rrIntervalMs, 1)} ms`;
    }

    if (Number.isFinite(frame.microsaccadeHz)) {
      elements.metricMicro.textContent = `${round(frame.microsaccadeHz, 2)} Hz`;
    }
  });

  eventBus.on(EVENTS.R_PEAK, (event) => {
    cardiacEngine.registerRPeak(event.detail);
  });

  eventBus.on(EVENTS.CARDIAC_ENGINE_STATUS, (event) => {
    state.cardiacEngine = {
      ...state.cardiacEngine,
      ...event.detail
    };

    const active = !!event.detail.active;
    setPill(elements.cardiacEngineStatus, active ? "Active" : "Idle", active ? "live" : "idle");
    elements.toggleGatingButton.textContent = active ? "Stop Gating" : "Start Gating";
    elements.gateOffsetValue.textContent = `${event.detail.offsetMs} ms`;
    elements.metricSeqId.textContent = String(event.detail.sequenceId ?? "--");
  });

  eventBus.on(EVENTS.CARDIAC_TRANSPORT_STATUS, (event) => {
    state.transport = {
      ...state.transport,
      ...event.detail
    };

    const status = event.detail.status;
    const pillType = status === "connected" ? "live" : (status === "error" ? "warn" : "idle");

    setPill(elements.bleStatus, humanize(status), pillType);
    elements.metricBleFailures.textContent = String(event.detail.failedCount ?? 0);
  });

  eventBus.on(EVENTS.HYDRAWAV_MQTT_STATUS, (event) => {
    state.mqtt = {
      ...state.mqtt,
      ...event.detail
    };

    const status = event.detail.status || "logged_out";
    const human = status === "authenticated" ? "Authenticated" : (status === "error" ? "Error" : "Logged Out");
    const pillType = status === "authenticated" ? "live" : (status === "error" ? "warn" : "idle");
    setPill(elements.deviceApiStatus, human, pillType);
  });

  eventBus.on(EVENTS.HYDRAWAV_MQTT_COMMAND, (event) => {
    const topic = event.detail.topic || "unknown-topic";
    log(`HydraWav MQTT publish ok on topic ${topic}.`);
  });

  eventBus.on(EVENTS.CARDIAC_GATE_FIRED, async (event) => {
    elements.metricGateCount.textContent = String(event.detail.sequence);
    elements.metricLastDelay.textContent = `${round(event.detail.effectiveDelayMs, 1)} ms`;
    elements.metricSeqId.textContent = String(event.detail.sequence);

    log(`Gate #${event.detail.sequence} fired (${event.detail.transport}) at ${round(event.detail.effectiveDelayMs, 1)} ms.`);

    if (state.mqtt.gatePublishEnabled) {
      try {
        await hydrawavMqttClient.sendGatePulse({
          topic: elements.mqttGateTopicInput.value.trim(),
          mac: elements.mqttDeviceMacInput.value.trim(),
          sequence: event.detail.sequence,
          rrIntervalMs: event.detail.rrIntervalMs,
          heartRateBpm: event.detail.heartRateBpm,
          offsetMs: event.detail.offsetMs,
          gateTimestampMs: event.detail.gateTimestampMs
        });
      } catch (error) {
        log(`Gate telemetry publish failed: ${error.message}`, "warn");
      }
    }
  });

  eventBus.on(EVENTS.PLASTICITY_SCORE_UPDATED, (event) => {
    state.plasticity = event.detail;
    elements.metricPlasticity.textContent = `${round(event.detail.score0To10, 2)} / 10`;
  });

  eventBus.on(EVENTS.NEURO_PHASE_CHANGED, (event) => {
    state.neuro.phase = event.detail.phase;

    if (event.detail.phase === "idle") {
      setPill(elements.neuroPhaseStatus, "Idle", "idle");
      clearThetaNarrationTimer();
    } else {
      setPill(elements.neuroPhaseStatus, event.detail.phase.toUpperCase(), "live");
    }

    if (event.detail.phase === "during") {
      scheduleThetaNarration();
    }
  });

  eventBus.on(EVENTS.NEURO_BEAT_UPDATED, (event) => {
    state.neuro = {
      ...state.neuro,
      ...event.detail
    };

    elements.metricBeatHz.textContent = `${round(event.detail.beatHz, 2)} Hz`;
    elements.metricArousal.textContent = Number.isFinite(event.detail.arousalIndex)
      ? String(round(event.detail.arousalIndex, 3))
      : "--";
    elements.metricPhaseTime.textContent = formatTime(event.detail.phaseTimeRemainingSec);
    elements.metricSessionComplete.textContent = `${round(event.detail.sessionProgressPercent, 1)}%`;
  });

  eventBus.on(EVENTS.NEURO_SESSION_COMPLETED, async () => {
    clearThetaNarrationTimer();
    log("Neuroacoustic session completed.");

    await narrationManager.speak(
      buildPostSessionNarration({
        sessionContext: state.sessionContext,
        protocolContext: state.protocolContext,
        biometrics: state.latestBiometrics,
        beatHz: state.neuro.beatHz || 10,
        plasticityScore: state.plasticity?.score0To10
      }),
      { type: "post-session" }
    );
  });

  eventBus.on(EVENTS.VOICE_NOTE_READY, () => {
    setPill(elements.voiceStatus, "Delivered", "live");
    log("Voice note delivered.");
  });

  eventBus.on(EVENTS.WARNING, (event) => {
    log(`${event.detail.scope || "runtime"}: ${event.detail.message}`, "warn");
  });
}

function clearThetaNarrationTimer() {
  if (state.thetaNarrationTimer) {
    clearInterval(state.thetaNarrationTimer);
    state.thetaNarrationTimer = null;
  }
}

function scheduleThetaNarration() {
  clearThetaNarrationTimer();

  const runNarration = async () => {
    await narrationManager.speak(
      buildThetaNarration({
        sessionContext: state.sessionContext,
        protocolContext: state.protocolContext,
        biometrics: state.latestBiometrics,
        beatHz: state.neuro.beatHz || 6,
        plasticityScore: state.plasticity?.score0To10
      }),
      { type: "theta-loop", phase: state.neuro.phase }
    );
  };

  runNarration();
  state.thetaNarrationTimer = setInterval(runNarration, 55_000);
}

function pickTopZone(flaggedZones) {
  if (!Array.isArray(flaggedZones) || !flaggedZones.length) {
    return null;
  }

  const sorted = [...flaggedZones].sort((a, b) => (b.score || 0) - (a.score || 0));
  return sorted[0] || null;
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

function humanize(value) {
  return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) || "Idle";
}

function setPill(element, text, type = "idle") {
  element.textContent = text;
  element.className = `pill ${type === "live" ? "pill-live" : type === "warn" ? "pill-warn" : "pill-idle"}`;
}

function log(message, level = "info") {
  const timeStamp = new Date().toLocaleTimeString();
  const item = document.createElement("li");
  item.textContent = `[${timeStamp}] ${message}`;

  if (level === "warn") {
    item.style.borderColor = "#f3ba8c";
    item.style.background = "#fff4e8";
    item.style.color = "#7a3e0c";
  }

  elements.runtimeLog.prepend(item);

  while (elements.runtimeLog.children.length > 64) {
    elements.runtimeLog.removeChild(elements.runtimeLog.lastChild);
  }

  eventBus.emit(EVENTS.LOG, {
    level,
    message,
    timeStamp
  });
}

async function bootstrap() {
  bindUi();
  bindEvents();
  initializeBridge();

  neuralHandshakeEngine.setTarget({
    zone: DEFAULTS.neuralHandshake.defaultZone,
    injuredSide: DEFAULTS.neuralHandshake.defaultInjuredSide
  });

  cardiacEngine.emitStatus();
  bleClient.emitStatus("disconnected", {
    sentCount: 0,
    failedCount: 0
  });

  setPill(elements.auraStatusPill, "Idle", "idle");
  setPill(elements.handshakeStatusPill, "Idle", "idle");
  setPill(elements.deviceApiStatus, "Logged Out", "idle");
  setPill(elements.voiceStatus, "Disabled", "idle");

  if (!bleClient.isSupported()) {
    log("Web Bluetooth is not supported in this browser. Use Chrome/Edge over HTTPS or localhost.", "warn");
  }

  if (!auraScanEngine.isSupported()) {
    log("Camera APIs are not supported in this browser.", "warn");
  }

  if (DEFAULTS.auraScan.autoStartCamera) {
    try {
      await auraScanEngine.startCamera();
      log("Aura camera auto-started.");
    } catch (error) {
      log(`Aura camera auto-start failed: ${error.message}`, "warn");
    }
  }

  log("HYDRA-V Feature 1-4 runtime initialized.");
}

bootstrap();
