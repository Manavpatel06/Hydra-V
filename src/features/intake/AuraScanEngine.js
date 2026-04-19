import { EVENTS } from "../../core/events.js";
import { clamp, round } from "../../core/utils.js";
import {
  computeReadinessScore,
  estimateDominantFrequency,
  estimateRrIntervalsFromSignal,
  estimateSkinMode,
  mean,
  rmssd
} from "./SignalProcessing.js";
import { buildCanonicalPose } from "../visual/AnatomyFigureRenderer.js";

const BODY_SILHOUETTE_CANDIDATES = [
  "/src/assets/anatomy-silhouette.png",
  "/src/assets/anatomy-silhouette.svg"
];

const DEFAULT_SCAN_SECONDS = 60;

const POSE_CONNECTIONS = [
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28]
];

const FACEMESH_FOREHEAD = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323];
const LEFT_EYE_CLUSTER = [33, 133, 159, 145, 153];
const RIGHT_EYE_CLUSTER = [362, 263, 386, 374, 380];
const LEFT_IRIS_CLUSTER = [468, 469, 470, 471, 472];
const RIGHT_IRIS_CLUSTER = [473, 474, 475, 476, 477];
const POSE_QUALITY_POINTS = [11, 12, 23, 24, 25, 26, 27, 28];
const SYMMETRY_ALERT_THRESHOLD_PCT = 6;
const MIN_SYMMETRY_VISIBILITY = 0.2;
const MEDIAPIPE_LOADERS = Object.freeze({
  camera: [
    {
      script: "/node_modules/@mediapipe/camera_utils/camera_utils.js"
    },
    {
      script: "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js"
    }
  ],
  pose: [
    {
      script: "/node_modules/@mediapipe/pose/pose.js",
      assetRoot: "/node_modules/@mediapipe/pose"
    },
    {
      script: "https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js",
      assetRoot: "https://cdn.jsdelivr.net/npm/@mediapipe/pose"
    }
  ],
  faceMesh: [
    {
      script: "/node_modules/@mediapipe/face_mesh/face_mesh.js",
      assetRoot: "/node_modules/@mediapipe/face_mesh"
    },
    {
      script: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js",
      assetRoot: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh"
    }
  ]
});

export class AuraScanEngine {
  constructor({
    eventBus,
    videoEl,
    cameraCanvasEl,
    bodyMapCanvasEl,
    analytics = {}
  }) {
    this.eventBus = eventBus;
    this.videoEl = videoEl;
    this.cameraCanvas = cameraCanvasEl;
    // Frequent getImageData calls for rPPG sampling perform better with this hint.
    this.cameraCtx = this.cameraCanvas.getContext("2d", { willReadFrequently: true })
      || this.cameraCanvas.getContext("2d");
    this.bodyMapCanvas = bodyMapCanvasEl;
    this.bodyMapCtx = this.bodyMapCanvas.getContext("2d");
    this.bodyHeatCanvas = (typeof OffscreenCanvas !== "undefined")
      ? new OffscreenCanvas(1, 1)
      : document.createElement("canvas");
    this.bodyHeatCtx = this.bodyHeatCanvas.getContext("2d");
    this.bodySilhouetteImage = new Image();
    this.bodySilhouetteLoaded = false;
    this.loadBodySilhouette();

    this.stream = null;
    this.pose = null;
    this.faceMesh = null;
    this.cameraLoop = null;
    this.running = false;
    this.scanning = false;
    this.scanStartedAt = 0;
    this.scanDurationSec = DEFAULT_SCAN_SECONDS;

    this.lastPose = null;
    this.lastPoseWorld = null;
    this.lastFace = null;
    this.lastFaceRaw = null;
    this.lastMetrics = null;
    this.lastBackendMetrics = null;
    this.lastStableMetrics = null;
    this.lastSymmetrySnapshot = null;

    this.ppgSamples = [];
    this.eyeMotionSamples = [];
    this.wearableSamples = [];
    this.rrIntervals = [];
    this.lastRPeakAt = null;
    this.foreheadRoiState = null;
    this.metricSmoothers = {};
    this.zoneStabilityState = new Map();
    this.symmetryPairState = new Map();

    this.backendPreferredAnalytics = analytics.usePython === true;
    this.useBackendAnalytics = this.backendPreferredAnalytics;
    this.backendAnalyzeEndpoint = analytics.analyzeEndpoint || "/api/aura/analyze";
    this.backendResetEndpoint = analytics.resetEndpoint || "/api/aura/reset";
    this.backendIntervalMs = Math.max(Number(analytics.backendIntervalMs || 1000), 400);
    this.backendSessionId = generateSessionId();
    this.backendInFlight = false;
    this.lastBackendAt = 0;
    this.backendErrorCount = 0;
    this.sentPpgIndex = 0;
    this.sentEyeIndex = 0;
    this.sentWearableIndex = 0;

    const hardwareThreads = Number(navigator?.hardwareConcurrency || 8);
    const deviceMemoryGb = Number(navigator?.deviceMemory || 8);
    this.lowPowerMode = hardwareThreads <= 6 || deviceMemoryGb <= 6;

    this.poseIntervalMs = this.lowPowerMode ? 84 : 62;
    this.faceIntervalMs = this.lowPowerMode ? 68 : 50;
    this.renderIntervalMs = 33;
    this.metricsIntervalMs = 120;
    this.auraEmitIntervalMs = 120;
    this.biometricEmitIntervalMs = 66;
    this.bodyMapIntervalMs = 140;

    this.poseInFlight = false;
    this.faceInFlight = false;
    this.lastPoseDispatchAt = 0;
    this.lastFaceDispatchAt = 0;
    this.lastRenderAt = 0;
    this.lastMetricsComputeAt = 0;
    this.lastAuraEmitAt = 0;
    this.lastBiometricEmitAt = 0;
    this.lastBodyMapDrawAt = Number.NEGATIVE_INFINITY;

    this.onResultsPose = this.onResultsPose.bind(this);
    this.onResultsFace = this.onResultsFace.bind(this);
    this.mediaPipeRoots = {
      pose: MEDIAPIPE_LOADERS.pose[0].assetRoot,
      faceMesh: MEDIAPIPE_LOADERS.faceMesh[0].assetRoot
    };
  }

  isSupported() {
    return !!(navigator?.mediaDevices?.getUserMedia);
  }

  loadBodySilhouette() {
    let index = 0;
    const tryNext = () => {
      if (index >= BODY_SILHOUETTE_CANDIDATES.length) {
        this.bodySilhouetteLoaded = false;
        return;
      }
      const src = BODY_SILHOUETTE_CANDIDATES[index];
      index += 1;
      this.bodySilhouetteImage.onload = () => {
        this.bodySilhouetteLoaded = true;
      };
      this.bodySilhouetteImage.onerror = () => {
        tryNext();
      };
      this.bodySilhouetteImage.src = src;
    };
    tryNext();
  }

  async initModels() {
    await this.ensureMediaPipeDependencies();

    if (!window.Camera || !window.Pose || !window.FaceMesh) {
      throw new Error("MediaPipe Pose and FaceMesh scripts are not loaded.");
    }

    if (!this.pose) {
      this.pose = new window.Pose({
        locateFile: (file) => `${this.mediaPipeRoots.pose}/${file}`
      });

      this.pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.pose.onResults(this.onResultsPose);
    }

    if (!this.faceMesh) {
      this.faceMesh = new window.FaceMesh({
        locateFile: (file) => `${this.mediaPipeRoots.faceMesh}/${file}`
      });

      this.faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      this.faceMesh.onResults(this.onResultsFace);
    }
  }

  async ensureMediaPipeDependencies() {
    await ensureMediaPipeGlobal("Camera", MEDIAPIPE_LOADERS.camera);
    const poseSource = await ensureMediaPipeGlobal("Pose", MEDIAPIPE_LOADERS.pose);
    const faceMeshSource = await ensureMediaPipeGlobal("FaceMesh", MEDIAPIPE_LOADERS.faceMesh);

    if (poseSource?.assetRoot) {
      this.mediaPipeRoots.pose = poseSource.assetRoot;
    }
    if (faceMeshSource?.assetRoot) {
      this.mediaPipeRoots.faceMesh = faceMeshSource.assetRoot;
    }
  }

  async startCamera() {
    if (this.running) {
      return;
    }

    if (!this.isSupported()) {
      throw new Error("Camera APIs are not available in this browser.");
    }

    await this.initModels();

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: this.lowPowerMode ? 720 : 960 },
        height: { ideal: this.lowPowerMode ? 405 : 540 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: "user"
      },
      audio: false
    });

    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();

    this.syncCanvasSize();
    this.running = true;

    this.cameraLoop = new window.Camera(this.videoEl, {
      width: this.cameraCanvas.width,
      height: this.cameraCanvas.height,
      onFrame: () => {
        const nowMs = performance.now();

        if (!this.poseInFlight && (nowMs - this.lastPoseDispatchAt >= this.poseIntervalMs)) {
          this.poseInFlight = true;
          this.lastPoseDispatchAt = nowMs;
          void this.pose.send({ image: this.videoEl })
            .catch((error) => {
              this.eventBus.emit(EVENTS.WARNING, {
                scope: "aura-pose",
                message: error?.message || "MediaPipe pose processing failed."
              });
            })
            .finally(() => {
              this.poseInFlight = false;
            });
        }

        if (!this.faceInFlight && (nowMs - this.lastFaceDispatchAt >= this.faceIntervalMs)) {
          this.faceInFlight = true;
          this.lastFaceDispatchAt = nowMs;
          void this.faceMesh.send({ image: this.videoEl })
            .catch((error) => {
              this.eventBus.emit(EVENTS.WARNING, {
                scope: "aura-facemesh",
                message: error?.message || "MediaPipe face mesh processing failed."
              });
            })
            .finally(() => {
              this.faceInFlight = false;
            });
        }

        if (nowMs - this.lastRenderAt >= this.renderIntervalMs) {
          this.lastRenderAt = nowMs;
          this.renderFrame(nowMs);
        }
      }
    });

    this.cameraLoop.start();

    this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
      status: "camera_running"
    });
  }

  stopCamera() {
    this.stopScan();

    if (this.cameraLoop) {
      this.cameraLoop.stop();
      this.cameraLoop = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }

    this.running = false;
    this.poseInFlight = false;
    this.faceInFlight = false;
    this.lastRenderAt = 0;

    this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
      status: "camera_stopped"
    });
  }

  startScan(scanDurationSec = DEFAULT_SCAN_SECONDS) {
    if (!this.running) {
      throw new Error("Start the camera before starting Aura scan.");
    }

    this.scanDurationSec = clamp(Number(scanDurationSec) || DEFAULT_SCAN_SECONDS, 15, 180);
    this.scanStartedAt = performance.now();
    this.scanning = true;
    this.ppgSamples = [];
    this.eyeMotionSamples = [];
    this.wearableSamples = [];
    this.rrIntervals = [];
    this.lastRPeakAt = null;
    this.foreheadRoiState = null;
    this.metricSmoothers = {};
    this.zoneStabilityState.clear();
    this.symmetryPairState.clear();
    this.lastMetrics = null;
    this.lastStableMetrics = null;
    this.lastBackendMetrics = null;
    this.lastSymmetrySnapshot = null;
    this.backendErrorCount = 0;
    this.sentPpgIndex = 0;
    this.sentEyeIndex = 0;
    this.sentWearableIndex = 0;
    this.lastBackendAt = 0;
    this.backendSessionId = generateSessionId();
    this.useBackendAnalytics = this.backendPreferredAnalytics;
    this.lastMetricsComputeAt = 0;
    this.lastAuraEmitAt = 0;
    this.lastBiometricEmitAt = 0;

    if (this.useBackendAnalytics) {
      this.resetBackendSession().catch(() => {
        this.backendErrorCount += 1;
        this.useBackendAnalytics = false;
        this.eventBus.emit(EVENTS.WARNING, {
          scope: "aura-python-analytics",
          message: "Python analytics unavailable at scan start. Falling back to local JS metrics."
        });
      });
    }

    this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
      status: "scanning",
      scanDurationSec: this.scanDurationSec
    });
  }

  stopScan() {
    if (!this.scanning) {
      return;
    }

    this.scanning = false;

    this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
      status: "scan_stopped"
    });
  }

  onResultsPose(results) {
    if (!results.poseLandmarks?.length) {
      return;
    }

    this.lastPose = this.smoothLandmarks2d(results.poseLandmarks, this.lastPose, 0.34);
    this.lastPoseWorld = Array.isArray(results.poseWorldLandmarks) && results.poseWorldLandmarks.length
      ? this.smoothLandmarks3d(results.poseWorldLandmarks, this.lastPoseWorld, 0.28)
      : null;
  }

  onResultsFace(results) {
    if (!results.multiFaceLandmarks?.length) {
      return;
    }

    this.lastFaceRaw = results.multiFaceLandmarks[0];
    this.lastFace = this.smoothLandmarks2d(this.lastFaceRaw, this.lastFace, 0.38);
  }

  renderFrame(nowMs = performance.now()) {
    const width = this.cameraCanvas.width;
    const height = this.cameraCanvas.height;

    this.cameraCtx.save();
    this.cameraCtx.clearRect(0, 0, width, height);
    this.cameraCtx.drawImage(this.videoEl, 0, 0, width, height);

    if (this.lastPose) {
      this.drawPose(this.lastPose, this.cameraCtx, width, height, "rgba(56, 225, 244, 0.96)", 2.4);
    }

    if (this.lastFace) {
      this.drawForeheadOutline(this.lastFace, this.cameraCtx, width, height);
    }

    this.cameraCtx.restore();

    if (this.scanning) {
      this.ingestScanFrame(nowMs);
    }

    if (nowMs - this.lastBodyMapDrawAt >= this.bodyMapIntervalMs) {
      this.lastBodyMapDrawAt = nowMs;
      this.drawBodyMap();
    }
  }

  ingestScanFrame(nowMs = performance.now()) {
    const elapsedMs = nowMs - this.scanStartedAt;
    const progress = clamp(elapsedMs / (this.scanDurationSec * 1000), 0, 1);

    if (this.lastFace) {
      this.capturePpgSample(nowMs);
      this.captureEyeMotionSample(nowMs);
    }

    const shouldRecomputeMetrics = !this.lastMetrics || (nowMs - this.lastMetricsComputeAt >= this.metricsIntervalMs);
    if (shouldRecomputeMetrics) {
      this.lastMetricsComputeAt = nowMs;
      const localMetrics = this.computeMetrics();
      this.maybeRequestBackend(nowMs, localMetrics);
      const mergedMetrics = this.mergeMetrics(localMetrics, this.lastBackendMetrics);
      this.lastMetrics = this.stabilizeMetrics(mergedMetrics);
    }

    if (this.lastMetrics) {
      if (nowMs - this.lastAuraEmitAt >= this.auraEmitIntervalMs || progress >= 0.999) {
        this.lastAuraEmitAt = nowMs;
        this.eventBus.emit(EVENTS.AURA_SCAN_FRAME, {
          progress,
          ...this.lastMetrics
        });
      }

      const rrInterval = this.lastMetrics.rrIntervalMs;
      const hr = this.lastMetrics.heartRateBpm;
      const hrv = this.lastMetrics.hrvRmssdMs;

      const hasRPeak = Number.isFinite(rrInterval) && this.detectRPeak(nowMs, rrInterval);
      if (nowMs - this.lastBiometricEmitAt >= this.biometricEmitIntervalMs) {
        this.lastBiometricEmitAt = nowMs;
        this.eventBus.emit(EVENTS.BIOMETRIC_FRAME, {
          timestampMs: nowMs,
          rPeakDetected: hasRPeak,
          rrIntervalMs: rrInterval,
          heartRateBpm: hr,
          hrvRmssdMs: hrv,
          microsaccadeHz: this.lastMetrics.microsaccadeHz
        });
      }
    }

    if (elapsedMs >= this.scanDurationSec * 1000) {
      this.finishScan();
    }
  }

  detectRPeak(nowMs, rrIntervalMs) {
    if (!Number.isFinite(rrIntervalMs) || rrIntervalMs < 250 || rrIntervalMs > 2000) {
      return false;
    }

    if (!this.lastRPeakAt) {
      this.lastRPeakAt = nowMs;
      return true;
    }

    if (nowMs - this.lastRPeakAt >= rrIntervalMs) {
      this.lastRPeakAt = nowMs;
      return true;
    }

    return false;
  }

  finishScan() {
    this.scanning = false;

    const summary = this.lastMetrics || this.computeMetrics() || this.buildDegradedSummary();
    if (!summary) {
      this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
        status: "scan_failed",
        message: "Unable to compute scan metrics."
      });
      return;
    }

    if (summary.degraded === true) {
      this.eventBus.emit(EVENTS.WARNING, {
        scope: "aura-scan-quality",
        message: "Aura scan completed with limited signal quality. Position face/body clearly and retry for best accuracy."
      });
    }

    this.eventBus.emit(EVENTS.AURA_SCAN_COMPLETE, {
      ...summary,
      scanDurationSec: this.scanDurationSec
    });

    this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
      status: "scan_complete",
      scanDurationSec: this.scanDurationSec
    });
  }

  async resetBackendSession() {
    try {
      await fetch(this.backendResetEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session_id: this.backendSessionId
        })
      });
    } catch (error) {
      this.eventBus.emit(EVENTS.WARNING, {
        scope: "aura-backend-reset",
        message: error.message
      });
    }
  }

  async maybeRequestBackend(nowMs, localMetrics) {
    if (!this.useBackendAnalytics) {
      return;
    }

    if (this.backendInFlight) {
      return;
    }

    if (nowMs - this.lastBackendAt < this.backendIntervalMs) {
      return;
    }

    const ppgSamples = this.ppgSamples.slice(this.sentPpgIndex).map((sample) => ({
      timestamp_ms: sample.timestampMs,
      value: sample.value,
      mode: sample.mode,
      rgb: Array.isArray(sample.rgb) ? sample.rgb : [],
      quality: Number.isFinite(sample.quality) ? sample.quality : null
    }));

    const eyeSamples = this.eyeMotionSamples.slice(this.sentEyeIndex).map((sample) => ({
      timestamp_ms: sample.timestampMs,
      x: sample.x,
      y: sample.y
    }));

    const wearableSamples = this.wearableSamples.slice(this.sentWearableIndex).map((sample) => ({
      timestamp_ms: sample.timestampMs,
      heart_rate_bpm: sample.heartRateBpm,
      rr_interval_ms: sample.rrIntervalMs,
      rr_intervals_ms: Array.isArray(sample.rrIntervalsMs) ? sample.rrIntervalsMs : [],
      confidence: sample.confidence,
      source: sample.source
    }));

    const symmetry = this.lastPose
      ? this.computeSymmetry(this.lastPose, this.lastPoseWorld)
      : { deltaPct: null, flaggedZones: [] };

    const payload = {
      session_id: this.backendSessionId,
      timestamp_ms: nowMs,
      scan_duration_sec: this.scanDurationSec,
      ppg_samples: ppgSamples,
      eye_samples: eyeSamples,
      wearable_samples: wearableSamples,
      pose_summary: {
        symmetry_delta_pct: symmetry.deltaPct,
        flagged_zones: symmetry.flaggedZones
      },
      local_metrics: {
        algorithm: localMetrics?.algorithm ?? null,
        heart_rate_bpm: localMetrics?.heartRateBpm ?? null,
        rr_interval_ms: localMetrics?.rrIntervalMs ?? null,
        hrv_rmssd_ms: localMetrics?.hrvRmssdMs ?? null,
        microsaccade_hz: localMetrics?.microsaccadeHz ?? null,
        symmetry_delta_pct: localMetrics?.symmetryDeltaPct ?? symmetry.deltaPct,
        flagged_zones: localMetrics?.flaggedZones ?? symmetry.flaggedZones,
        readiness_score: localMetrics?.readinessScore ?? null,
        camera_signal_quality: localMetrics?.cameraSignalQuality ?? null,
        pose_quality: localMetrics?.poseQuality ?? null,
        motion_artifact_score: localMetrics?.motionArtifactScore ?? null
      }
    };

    this.backendInFlight = true;
    this.lastBackendAt = nowMs;

    try {
      const response = await fetch(this.backendAnalyzeEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.details || "Aura backend request failed.");
      }

      this.sentPpgIndex = this.ppgSamples.length;
      this.sentEyeIndex = this.eyeMotionSamples.length;
      this.sentWearableIndex = this.wearableSamples.length;
      this.lastBackendMetrics = this.normalizeBackendMetrics(body.metrics);

      if (this.lastBackendMetrics) {
        this.backendErrorCount = 0;
      }
    } catch (error) {
      this.backendErrorCount += 1;
      this.eventBus.emit(EVENTS.WARNING, {
        scope: "aura-python-analytics",
        message: error.message
      });

      if (this.backendErrorCount >= 3) {
        this.useBackendAnalytics = false;
        this.eventBus.emit(EVENTS.WARNING, {
          scope: "aura-python-analytics",
          message: "Python analytics disabled after repeated failures. Falling back to local JS metrics."
        });
      }
    } finally {
      this.backendInFlight = false;
    }
  }

  mergeMetrics(localMetrics, backendMetrics) {
    if (!localMetrics && !backendMetrics) {
      return null;
    }

    if (!backendMetrics) {
      return localMetrics;
    }

    return {
      algorithm: backendMetrics.algorithm ?? localMetrics?.algorithm,
      heartRateBpm: backendMetrics.heartRateBpm ?? localMetrics?.heartRateBpm ?? null,
      rrIntervalMs: backendMetrics.rrIntervalMs ?? localMetrics?.rrIntervalMs ?? null,
      hrvRmssdMs: backendMetrics.hrvRmssdMs ?? localMetrics?.hrvRmssdMs ?? null,
      microsaccadeHz: backendMetrics.microsaccadeHz ?? localMetrics?.microsaccadeHz ?? null,
      symmetryDeltaPct: backendMetrics.symmetryDeltaPct ?? localMetrics?.symmetryDeltaPct ?? null,
      flaggedZones: backendMetrics.flaggedZones ?? localMetrics?.flaggedZones ?? [],
      readinessScore: backendMetrics.readinessScore ?? localMetrics?.readinessScore ?? null,
      cnsFatigue: backendMetrics.cnsFatigue ?? localMetrics?.cnsFatigue ?? null,
      breathRatePerMin: backendMetrics.breathRatePerMin ?? localMetrics?.breathRatePerMin ?? null,
      vitalsSource: backendMetrics.vitalsSource ?? localMetrics?.vitalsSource ?? null,
      heartRateConfidence: backendMetrics.heartRateConfidence ?? localMetrics?.heartRateConfidence ?? null,
      cameraSignalQuality: backendMetrics.cameraSignalQuality ?? localMetrics?.cameraSignalQuality ?? null,
      poseQuality: backendMetrics.poseQuality ?? localMetrics?.poseQuality ?? null
    };
  }

  normalizeBackendMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      return null;
    }

    const flaggedZones = Array.isArray(metrics.flagged_zones)
      ? metrics.flagged_zones.map((zone) => ({
        zone: zone.zone,
        side: zone.side,
        score: Number(zone.score)
      }))
      : null;

    const cnsFatigue = typeof metrics.cns_fatigue === "boolean" ? metrics.cns_fatigue : null;

    return {
      algorithm: metrics.algorithm ?? null,
      heartRateBpm: asFinite(metrics.heart_rate_bpm),
      rrIntervalMs: asFinite(metrics.rr_interval_ms),
      hrvRmssdMs: asFinite(metrics.hrv_rmssd_ms),
      microsaccadeHz: asFinite(metrics.microsaccade_hz),
      symmetryDeltaPct: asFinite(metrics.symmetry_delta_pct),
      flaggedZones,
      readinessScore: asFinite(metrics.readiness_score),
      cnsFatigue,
      breathRatePerMin: asFinite(metrics.breath_rate_per_min),
      vitalsSource: metrics.vitals_source ?? null,
      heartRateConfidence: asFinite(metrics.heart_rate_confidence),
      cameraSignalQuality: asFinite(metrics.camera_signal_quality),
      poseQuality: asFinite(metrics.pose_quality)
    };
  }

  stabilizeMetrics(metrics) {
    if (!metrics || typeof metrics !== "object") {
      return null;
    }

    const qualityHr = bestFinite(metrics.heartRateConfidence, metrics.cameraSignalQuality, 0.52);
    const qualityPose = bestFinite(metrics.poseQuality, 0.62);
    const stable = {
      ...metrics
    };

    stable.heartRateBpm = roundIfFinite(this.smoothNumericMetric("heartRateBpm", metrics.heartRateBpm, {
      alpha: 0.2,
      maxStep: 1.4,
      quality: qualityHr,
      minQuality: 0.26
    }), 1);
    stable.rrIntervalMs = roundIfFinite(this.smoothNumericMetric("rrIntervalMs", metrics.rrIntervalMs, {
      alpha: 0.2,
      maxStep: 18,
      quality: qualityHr,
      minQuality: 0.24
    }), 1);
    stable.hrvRmssdMs = roundIfFinite(this.smoothNumericMetric("hrvRmssdMs", metrics.hrvRmssdMs, {
      alpha: 0.18,
      maxStep: 2.2,
      quality: qualityHr,
      minQuality: 0.22
    }), 1);
    stable.microsaccadeHz = roundIfFinite(this.smoothNumericMetric("microsaccadeHz", metrics.microsaccadeHz, {
      alpha: 0.15,
      maxStep: 0.035,
      quality: qualityPose,
      minQuality: 0.2
    }), 3);
    stable.symmetryDeltaPct = roundIfFinite(this.smoothNumericMetric("symmetryDeltaPct", metrics.symmetryDeltaPct, {
      alpha: 0.18,
      maxStep: 0.55,
      quality: qualityPose,
      minQuality: 0.2
    }), 2);
    stable.readinessScore = roundIfFinite(this.smoothNumericMetric("readinessScore", metrics.readinessScore, {
      alpha: 0.16,
      maxStep: 0.12,
      quality: bestFinite(qualityHr, qualityPose, 0.48),
      minQuality: 0.22
    }), 2);
    stable.breathRatePerMin = roundIfFinite(this.smoothNumericMetric("breathRatePerMin", metrics.breathRatePerMin, {
      alpha: 0.2,
      maxStep: 0.3,
      quality: qualityHr,
      minQuality: 0.15
    }), 1);

    stable.flaggedZones = this.stabilizeFlaggedZones(
      Array.isArray(metrics.flaggedZones) ? metrics.flaggedZones : [],
      qualityPose
    );
    stable.cnsFatigue = Number.isFinite(stable.microsaccadeHz)
      ? stable.microsaccadeHz < 0.5
      : (this.lastStableMetrics?.cnsFatigue ?? metrics.cnsFatigue ?? null);

    this.lastStableMetrics = stable;
    return stable;
  }

  stabilizeFlaggedZones(rawZones, poseQuality) {
    const seen = new Set();
    const quality = clamp(Number(poseQuality) || 0, 0, 1);
    const freezeUpdates = quality > 0 && quality < 0.35;

    if (!freezeUpdates) {
      for (const zone of rawZones) {
        if (!zone || !zone.zone || !zone.side) {
          continue;
        }
        const score = Number(zone.score);
        if (!Number.isFinite(score)) {
          continue;
        }

        const key = `${zone.side}:${zone.zone}`;
        seen.add(key);
        const current = this.zoneStabilityState.get(key) || {
          zone: zone.zone,
          side: zone.side,
          score,
          hold: 0,
          miss: 0
        };

        current.score = current.score + (score - current.score) * 0.26;
        current.hold += 1;
        current.miss = 0;
        this.zoneStabilityState.set(key, current);
      }
    }

    for (const [key, state] of this.zoneStabilityState.entries()) {
      if (seen.has(key)) {
        continue;
      }
      state.miss += 1;
      if (!freezeUpdates) {
        state.hold = Math.max(state.hold - 1, 0);
        state.score *= 0.92;
      }
      if (state.miss > 5 || state.score < 4.5) {
        this.zoneStabilityState.delete(key);
      }
    }

    const stableZones = [];
    for (const state of this.zoneStabilityState.values()) {
      if (state.hold < 2 || state.miss > 2) {
        continue;
      }
      if (state.score < SYMMETRY_ALERT_THRESHOLD_PCT - 0.8) {
        continue;
      }
      stableZones.push({
        zone: state.zone,
        side: state.side,
        score: round(state.score, 2)
      });
    }

    stableZones.sort((a, b) => b.score - a.score);
    return stableZones;
  }

  smoothNumericMetric(key, incoming, options = {}) {
    const {
      alpha = 0.2,
      maxStep = Number.POSITIVE_INFINITY,
      quality = 1,
      minQuality = 0
    } = options;

    const previous = this.metricSmoothers[key];
    const nextValue = Number(incoming);
    if (!Number.isFinite(nextValue)) {
      return Number.isFinite(previous) ? previous : null;
    }

    if (!Number.isFinite(previous)) {
      this.metricSmoothers[key] = nextValue;
      return nextValue;
    }

    const confidence = clamp(Number(quality), 0, 1);
    if (confidence < minQuality) {
      return previous;
    }

    const dynamicAlpha = clamp(alpha * (0.55 + confidence * 0.7), 0.06, 0.85);
    const rawDelta = nextValue - previous;
    if (Number.isFinite(maxStep) && Math.abs(rawDelta) > maxStep * 4 && confidence < 0.55) {
      return previous;
    }

    let smoothed = previous + rawDelta * dynamicAlpha;
    if (Number.isFinite(maxStep)) {
      const limitedDelta = clamp(smoothed - previous, -maxStep, maxStep);
      smoothed = previous + limitedDelta;
    }

    this.metricSmoothers[key] = smoothed;
    return smoothed;
  }

  capturePpgSample(timestampMs) {
    const faceLandmarks = this.lastFace || this.lastFaceRaw;
    if (!faceLandmarks) {
      return;
    }

    const forehead = faceLandmarks
      .map((landmark, idx) => ({ landmark, idx }))
      .filter((item) => FACEMESH_FOREHEAD.includes(item.idx))
      .map((item) => item.landmark);

    if (forehead.length < 4) {
      return;
    }

    const xs = forehead.map((point) => point.x * this.cameraCanvas.width);
    const ys = forehead.map((point) => point.y * this.cameraCanvas.height);
    let x = Math.max(0, Math.floor(Math.min(...xs)));
    let y = Math.max(0, Math.floor(Math.min(...ys)));
    let w = Math.max(4, Math.floor(Math.max(...xs) - Math.min(...xs)));
    let h = Math.max(4, Math.floor(Math.max(...ys) - Math.min(...ys)));

    const roiCenterX = x + w * 0.5;
    const roiCenterY = y + h * 0.5;
    let motionPenalty = 0;
    if (this.foreheadRoiState) {
      const dx = Math.abs(roiCenterX - this.foreheadRoiState.cx) / Math.max(this.cameraCanvas.width, 1);
      const dy = Math.abs(roiCenterY - this.foreheadRoiState.cy) / Math.max(this.cameraCanvas.height, 1);
      const maxShift = Math.max(dx, dy);
      if (maxShift > 0.18) {
        // Re-seed the forehead ROI instead of stalling the first few seconds of the scan.
        this.foreheadRoiState = null;
        motionPenalty = clamp(maxShift * 1.35, 0.18, 0.5);
      } else {
        const alpha = 0.24;
        motionPenalty = clamp(maxShift * 1.2, 0, 0.2);
        x = Math.floor(this.foreheadRoiState.x + (x - this.foreheadRoiState.x) * alpha);
        y = Math.floor(this.foreheadRoiState.y + (y - this.foreheadRoiState.y) * alpha);
        w = Math.max(4, Math.floor(this.foreheadRoiState.w + (w - this.foreheadRoiState.w) * alpha));
        h = Math.max(4, Math.floor(this.foreheadRoiState.h + (h - this.foreheadRoiState.h) * alpha));
      }
    }

    this.foreheadRoiState = {
      x,
      y,
      w,
      h,
      cx: x + w * 0.5,
      cy: y + h * 0.5
    };

    const img = this.cameraCtx.getImageData(x, y, w, h).data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumL = 0;
    let validPixels = 0;
    const pixels = img.length / 4;

    for (let i = 0; i < img.length; i += 4) {
      const r = img[i];
      const g = img[i + 1];
      const b = img[i + 2];
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = (maxC - minC) / Math.max(maxC, 1);
      if (luminance < 24 || luminance > 245 || saturation < 0.02 || saturation > 0.82) {
        continue;
      }
      sumR += r;
      sumG += g;
      sumB += b;
      sumL += luminance;
      validPixels += 1;
    }

    if (validPixels < 10 || validPixels < pixels * 0.1) {
      return;
    }

    const avgR = sumR / validPixels;
    const avgG = sumG / validPixels;
    const avgB = sumB / validPixels;
    const avgL = sumL / validPixels;
    const mode = estimateSkinMode([avgR, avgG, avgB]);
    const pixelCoverage = validPixels / pixels;
    const luminanceScore = clamp(1 - Math.abs(avgL - 135) / 140, 0.2, 1);
    const motionScore = clamp(1 - motionPenalty, 0.2, 1);
    const sampleQuality = clamp(pixelCoverage * 0.64 + luminanceScore * 0.24 + motionScore * 0.12, 0, 1);

    let sample = avgG;
    if (mode === "pos") {
      const iMean = (avgR + avgG + avgB) / 3 || 1;
      sample = (avgG - avgB) / iMean;
    }

    this.ppgSamples.push({
      timestampMs,
      value: sample,
      rgb: [avgR, avgG, avgB],
      mode,
      quality: sampleQuality
    });

    const cutoff = timestampMs - 90_000;
    while (this.ppgSamples.length && this.ppgSamples[0].timestampMs < cutoff) {
      this.ppgSamples.shift();
    }
  }

  captureEyeMotionSample(timestampMs) {
    const faceLandmarks = this.lastFace || this.lastFaceRaw;
    if (!faceLandmarks) {
      return;
    }

    const leftIris = centroid(faceLandmarks, LEFT_IRIS_CLUSTER);
    const rightIris = centroid(faceLandmarks, RIGHT_IRIS_CLUSTER);
    const leftEyeInner = faceLandmarks[133];
    const leftEyeOuter = faceLandmarks[33];
    const rightEyeInner = faceLandmarks[362];
    const rightEyeOuter = faceLandmarks[263];
    const leftEyeTop = faceLandmarks[159];
    const leftEyeBottom = faceLandmarks[145];
    const rightEyeTop = faceLandmarks[386];
    const rightEyeBottom = faceLandmarks[374];

    const leftBase = centroid(faceLandmarks, LEFT_EYE_CLUSTER);
    const rightBase = centroid(faceLandmarks, RIGHT_EYE_CLUSTER);
    if (!leftBase || !rightBase) {
      return;
    }
    const fallbackCenter = {
      x: (leftBase.x + rightBase.x) / 2,
      y: (leftBase.y + rightBase.y) / 2
    };

    const leftHorizontalSpan = distance(leftEyeInner, leftEyeOuter) || 0.001;
    const rightHorizontalSpan = distance(rightEyeInner, rightEyeOuter) || 0.001;
    const leftVerticalSpan = distance(leftEyeTop, leftEyeBottom) || 0.001;
    const rightVerticalSpan = distance(rightEyeTop, rightEyeBottom) || 0.001;

    const leftEyeMid = leftEyeInner && leftEyeOuter
      ? midpoint(leftEyeInner, leftEyeOuter)
      : leftBase;
    const rightEyeMid = rightEyeInner && rightEyeOuter
      ? midpoint(rightEyeInner, rightEyeOuter)
      : rightBase;

    const leftDx = leftIris && leftEyeMid ? (leftIris.x - leftEyeMid.x) / leftHorizontalSpan : null;
    const rightDx = rightIris && rightEyeMid ? (rightIris.x - rightEyeMid.x) / rightHorizontalSpan : null;
    const leftDy = leftIris && leftEyeMid ? (leftIris.y - leftEyeMid.y) / leftVerticalSpan : null;
    const rightDy = rightIris && rightEyeMid ? (rightIris.y - rightEyeMid.y) / rightVerticalSpan : null;

    const hasIrisTrack = Number.isFinite(leftDx) && Number.isFinite(rightDx) && Number.isFinite(leftDy) && Number.isFinite(rightDy);
    const eyeCenter = hasIrisTrack
      ? {
        x: (leftDx + rightDx) * 0.5,
        y: (leftDy + rightDy) * 0.5
      }
      : fallbackCenter;

    this.eyeMotionSamples.push({
      timestampMs,
      x: eyeCenter.x,
      y: eyeCenter.y
    });

    const cutoff = timestampMs - 45_000;
    while (this.eyeMotionSamples.length && this.eyeMotionSamples[0].timestampMs < cutoff) {
      this.eyeMotionSamples.shift();
    }
  }

  computeMetrics() {
    const samples = this.ppgSamples;
    const hasPpgWindow = samples.length >= 24;
    let heartRateBpm = null;
    let rrIntervalMs = null;
    let hrvRmssdMs = null;
    let skinMode = "pending";

    if (hasPpgWindow) {
      const times = samples.map((sample) => sample.timestampMs);
      const values = samples.map((sample) => sample.value);
      const durationSec = Math.max((times.at(-1) - times[0]) / 1000, 0.001);
      const samplingHz = values.length / durationSec;

      const dominantHz = estimateDominantFrequency(values, samplingHz, 0.7, 3.2);
      heartRateBpm = dominantHz ? dominantHz * 60 : null;

      const rrIntervals = estimateRrIntervalsFromSignal(values, times, 45, 200);
      this.rrIntervals = rrIntervals;

      rrIntervalMs = mean(rrIntervals);
      hrvRmssdMs = rmssd(rrIntervals);
      skinMode = samples.at(-1)?.mode || "green";
    } else {
      this.rrIntervals = [];
    }

    const wearableFallback = this.estimateWearableFallback();
    if (!Number.isFinite(heartRateBpm) && Number.isFinite(wearableFallback.heartRateBpm)) {
      heartRateBpm = wearableFallback.heartRateBpm;
    }
    if (!Number.isFinite(rrIntervalMs) && Number.isFinite(wearableFallback.rrIntervalMs)) {
      rrIntervalMs = wearableFallback.rrIntervalMs;
    }
    if (!Number.isFinite(hrvRmssdMs) && Number.isFinite(wearableFallback.hrvRmssdMs)) {
      hrvRmssdMs = wearableFallback.hrvRmssdMs;
    }

    const hasPose = Array.isArray(this.lastPose) && this.lastPose.length > 26;
    const symmetry = hasPose
      ? this.computeSymmetry(this.lastPose, this.lastPoseWorld)
      : { deltaPct: null, flaggedZones: [] };
    this.lastSymmetrySnapshot = symmetry;
    const microsaccadeHz = this.computeMicrosaccadeHz();
    const poseQuality = hasPose ? this.estimatePoseQuality() : null;
    const cameraSignalQuality = this.estimatePpgSignalQuality();
    const motionArtifactScore = this.computeMotionArtifactScore();

    const readiness = computeReadinessScore({
      hrvRmssdMs,
      symmetryDeltaPct: symmetry.deltaPct,
      microsaccadeHz
    });
    const usingWearable = !hasPpgWindow
      && (Number.isFinite(heartRateBpm) || Number.isFinite(rrIntervalMs) || Number.isFinite(hrvRmssdMs));
    const vitalsSource = usingWearable ? "wearable-fallback" : "camera-local";
    const algorithm = usingWearable ? "wearable-fused" : skinMode;

    return {
      algorithm,
      heartRateBpm: Number.isFinite(heartRateBpm) ? round(heartRateBpm, 1) : null,
      rrIntervalMs: Number.isFinite(rrIntervalMs) ? round(rrIntervalMs, 1) : null,
      hrvRmssdMs: Number.isFinite(hrvRmssdMs) ? round(hrvRmssdMs, 1) : null,
      microsaccadeHz: Number.isFinite(microsaccadeHz) ? round(microsaccadeHz, 3) : null,
      symmetryDeltaPct: Number.isFinite(symmetry.deltaPct) ? round(symmetry.deltaPct, 2) : null,
      flaggedZones: symmetry.flaggedZones,
      readinessScore: Number.isFinite(readiness) ? round(readiness, 2) : null,
      cnsFatigue: Number.isFinite(microsaccadeHz) ? microsaccadeHz < 0.5 : null,
      poseQuality: Number.isFinite(poseQuality) ? round(poseQuality, 3) : null,
      cameraSignalQuality: Number.isFinite(cameraSignalQuality) ? round(cameraSignalQuality, 3) : null,
      motionArtifactScore: Number.isFinite(motionArtifactScore) ? round(motionArtifactScore, 3) : null,
      vitalsSource
    };
  }

  buildDegradedSummary() {
    const wearable = this.estimateWearableFallback();
    const microsaccadeHz = this.computeMicrosaccadeHz();
    const poseQuality = this.estimatePoseQuality();
    const cameraSignalQuality = this.estimatePpgSignalQuality();
    const motionArtifactScore = this.computeMotionArtifactScore();

    return {
      algorithm: "degraded-fallback",
      heartRateBpm: Number.isFinite(wearable.heartRateBpm) ? round(wearable.heartRateBpm, 1) : null,
      rrIntervalMs: Number.isFinite(wearable.rrIntervalMs) ? round(wearable.rrIntervalMs, 1) : null,
      hrvRmssdMs: Number.isFinite(wearable.hrvRmssdMs) ? round(wearable.hrvRmssdMs, 1) : null,
      microsaccadeHz: Number.isFinite(microsaccadeHz) ? round(microsaccadeHz, 3) : null,
      symmetryDeltaPct: null,
      flaggedZones: [],
      readinessScore: null,
      cnsFatigue: Number.isFinite(microsaccadeHz) ? microsaccadeHz < 0.5 : null,
      poseQuality: Number.isFinite(poseQuality) ? round(poseQuality, 3) : null,
      cameraSignalQuality: Number.isFinite(cameraSignalQuality) ? round(cameraSignalQuality, 3) : null,
      motionArtifactScore: Number.isFinite(motionArtifactScore) ? round(motionArtifactScore, 3) : null,
      degraded: true
    };
  }

  estimateWearableFallback() {
    const recent = this.wearableSamples.slice(-180);
    if (!recent.length) {
      return { heartRateBpm: null, rrIntervalMs: null, hrvRmssdMs: null };
    }

    const hrValues = recent
      .map((sample) => Number(sample.heartRateBpm))
      .filter((value) => Number.isFinite(value) && value >= 35 && value <= 220);

    const rrValues = recent
      .flatMap((sample) => {
        const singles = Number.isFinite(Number(sample.rrIntervalMs)) ? [Number(sample.rrIntervalMs)] : [];
        const arr = Array.isArray(sample.rrIntervalsMs)
          ? sample.rrIntervalsMs.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        return [...singles, ...arr];
      })
      .filter((value) => value >= 250 && value <= 2200);

    const heartRateBpm = hrValues.length
      ? (hrValues.reduce((sum, value) => sum + value, 0) / hrValues.length)
      : null;
    const rrIntervalMs = rrValues.length
      ? (rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length)
      : null;

    let hrvRmssdMs = null;
    if (rrValues.length >= 2) {
      let sumSq = 0;
      let n = 0;
      for (let i = 1; i < rrValues.length; i += 1) {
        const diff = rrValues[i] - rrValues[i - 1];
        sumSq += diff * diff;
        n += 1;
      }
      if (n > 0) {
        hrvRmssdMs = Math.sqrt(sumSq / n);
      }
    }

    return { heartRateBpm, rrIntervalMs, hrvRmssdMs };
  }

  computeSymmetry(poseLandmarks, poseWorldLandmarks = null) {
    if (!Array.isArray(poseLandmarks) || poseLandmarks.length < 27) {
      return {
        deltaPct: null,
        flaggedZones: []
      };
    }

    const leftShoulder = poseLandmarks[11];
    const rightShoulder = poseLandmarks[12];
    const leftHip = poseLandmarks[23];
    const rightHip = poseLandmarks[24];
    const leftKnee = poseLandmarks[25];
    const rightKnee = poseLandmarks[26];
    const hasWorld = Array.isArray(poseWorldLandmarks) && poseWorldLandmarks.length > 26;

    const pairs = [
      { name: "shoulder", left: leftShoulder, right: rightShoulder, leftIdx: 11, rightIdx: 12 },
      { name: "hip", left: leftHip, right: rightHip, leftIdx: 23, rightIdx: 24 },
      { name: "knee", left: leftKnee, right: rightKnee, leftIdx: 25, rightIdx: 26 }
    ];

    const deltas = [];
    const flagged = [];
    const pairDeltas = [];
    let torsoScale = 0;
    const shoulderSpan2d = distance(leftShoulder, rightShoulder);
    const hipSpan2d = distance(leftHip, rightHip);
    const pixelScale = Math.max(
      Number.isFinite(shoulderSpan2d) ? shoulderSpan2d : 0,
      Number.isFinite(hipSpan2d) ? hipSpan2d : 0,
      0.08
    );

    if (hasWorld) {
      const wsL = poseWorldLandmarks[11];
      const wsR = poseWorldLandmarks[12];
      const whL = poseWorldLandmarks[23];
      const whR = poseWorldLandmarks[24];
      const shoulderSpan = distance3d(wsL, wsR);
      const hipSpan = distance3d(whL, whR);
      torsoScale = Math.max((shoulderSpan + hipSpan) * 0.5, 0.06);
    }

    for (const pair of pairs) {
      if (!pair.left || !pair.right) {
        continue;
      }

      const leftVisible = !Number.isFinite(pair.left.visibility) || pair.left.visibility >= MIN_SYMMETRY_VISIBILITY;
      const rightVisible = !Number.isFinite(pair.right.visibility) || pair.right.visibility >= MIN_SYMMETRY_VISIBILITY;
      if (!leftVisible || !rightVisible) {
        continue;
      }

      let pct;
      let signedDelta;
      if (hasWorld) {
        const wl = poseWorldLandmarks[pair.leftIdx];
        const wr = poseWorldLandmarks[pair.rightIdx];
        if (isFinitePoint3d(wl) && isFinitePoint3d(wr) && torsoScale > 0) {
          const yzDelta = Math.hypot(wl.y - wr.y, wl.z - wr.z);
          pct = (yzDelta / torsoScale) * 100;
          signedDelta = wl.y - wr.y;
        }
      }

      if (!Number.isFinite(pct)) {
        const yDelta = Math.abs(pair.left.y - pair.right.y);
        pct = (yDelta / pixelScale) * 100;
        signedDelta = pair.left.y - pair.right.y;
      }

      const state = this.symmetryPairState.get(pair.name) || {};
      const prevPct = Number(state.pct);
      const smoothedPct = Number.isFinite(prevPct)
        ? prevPct + (pct - prevPct) * 0.24
        : pct;
      state.pct = smoothedPct;
      this.symmetryPairState.set(pair.name, state);

      const side = this.resolveSymmetrySide(pair.name, signedDelta);
      pct = smoothedPct;
      deltas.push(pct);
      pairDeltas.push({
        zone: pair.name,
        side,
        pct: round(pct, 2)
      });

      if (pct > SYMMETRY_ALERT_THRESHOLD_PCT) {
        flagged.push({
          zone: pair.name,
          side,
          score: round(pct, 2)
        });
      }
    }

    return {
      deltaPct: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null,
      flaggedZones: flagged,
      pairDeltas
    };
  }

  resolveSymmetrySide(pairName, signedDelta) {
    const delta = Number(signedDelta);
    if (!Number.isFinite(delta)) {
      return this.symmetryPairState.get(pairName)?.side || "left";
    }

    const state = this.symmetryPairState.get(pairName) || {};
    const prevDelta = Number(state.sideDelta);
    const blended = Number.isFinite(prevDelta)
      ? prevDelta + (delta - prevDelta) * 0.28
      : delta;
    const deadband = 0.0045;

    let side = state.side || (blended >= 0 ? "left" : "right");
    if (Math.abs(blended) >= deadband) {
      side = blended >= 0 ? "left" : "right";
    }

    state.side = side;
    state.sideDelta = blended;
    this.symmetryPairState.set(pairName, state);
    return side;
  }

  smoothLandmarks2d(currentLandmarks, previousLandmarks, alpha = 0.35) {
    if (!Array.isArray(currentLandmarks)) {
      return previousLandmarks || null;
    }
    if (!Array.isArray(previousLandmarks) || previousLandmarks.length !== currentLandmarks.length) {
      return currentLandmarks.map((point) => ({ ...point }));
    }

    const a = clamp(alpha, 0.05, 0.95);
    return currentLandmarks.map((point, index) => {
      const prev = previousLandmarks[index];
      if (!point || !prev) {
        return point ? { ...point } : prev;
      }
      return {
        ...point,
        x: prev.x + (point.x - prev.x) * a,
        y: prev.y + (point.y - prev.y) * a,
        z: Number.isFinite(point.z) && Number.isFinite(prev.z) ? (prev.z + (point.z - prev.z) * a) : point.z,
        visibility: Number.isFinite(point.visibility) && Number.isFinite(prev.visibility)
          ? (prev.visibility + (point.visibility - prev.visibility) * a)
          : point.visibility
      };
    });
  }

  smoothLandmarks3d(currentLandmarks, previousLandmarks, alpha = 0.28) {
    if (!Array.isArray(currentLandmarks)) {
      return previousLandmarks || null;
    }
    if (!Array.isArray(previousLandmarks) || previousLandmarks.length !== currentLandmarks.length) {
      return currentLandmarks.map((point) => ({ ...point }));
    }

    const a = clamp(alpha, 0.05, 0.95);
    return currentLandmarks.map((point, index) => {
      const prev = previousLandmarks[index];
      if (!point || !prev) {
        return point ? { ...point } : prev;
      }
      return {
        ...point,
        x: prev.x + (point.x - prev.x) * a,
        y: prev.y + (point.y - prev.y) * a,
        z: prev.z + (point.z - prev.z) * a,
        visibility: Number.isFinite(point.visibility) && Number.isFinite(prev.visibility)
          ? (prev.visibility + (point.visibility - prev.visibility) * a)
          : point.visibility
      };
    });
  }

  computeMicrosaccadeHz() {
    const samples = this.eyeMotionSamples;
    if (samples.length < 8) {
      return null;
    }

    let burstCount = 0;
    let prevSpeed = 0;

    for (let i = 1; i < samples.length; i += 1) {
      const dt = Math.max((samples[i].timestampMs - samples[i - 1].timestampMs) / 1000, 0.001);
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      const speed = Math.sqrt(dx * dx + dy * dy) / dt;

      if (speed > 0.18 && prevSpeed <= 0.18) {
        burstCount += 1;
      }

      prevSpeed = speed;
    }

    const spanSec = Math.max((samples.at(-1).timestampMs - samples[0].timestampMs) / 1000, 1);
    return burstCount / spanSec;
  }

  estimatePoseQuality() {
    if (!Array.isArray(this.lastPose) || this.lastPose.length < 29) {
      return null;
    }

    const visibilities = POSE_QUALITY_POINTS
      .map((idx) => this.lastPose[idx]?.visibility)
      .filter((value) => Number.isFinite(value));

    if (!visibilities.length) {
      return null;
    }

    return clamp(visibilities.reduce((sum, value) => sum + value, 0) / visibilities.length, 0, 1);
  }

  estimatePpgSignalQuality() {
    const recent = this.ppgSamples.slice(-150);
    if (!recent.length) {
      return null;
    }

    const validFraction = recent
      .map((sample) => Number(sample.quality))
      .filter((value) => Number.isFinite(value));
    const meanQuality = validFraction.length
      ? validFraction.reduce((sum, value) => sum + value, 0) / validFraction.length
      : 0;

    const values = recent.map((sample) => sample.value).filter((value) => Number.isFinite(value));
    if (values.length < 8) {
      return clamp(meanQuality, 0, 1);
    }

    const meanValue = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - meanValue) ** 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const signalScore = clamp(std / 2.2, 0, 1);

    return clamp((meanQuality * 0.65) + (signalScore * 0.35), 0, 1);
  }

  computeMotionArtifactScore() {
    const samples = this.eyeMotionSamples.slice(-90);
    if (samples.length < 4) {
      return null;
    }

    const speeds = [];
    for (let i = 1; i < samples.length; i += 1) {
      const dt = Math.max((samples[i].timestampMs - samples[i - 1].timestampMs) / 1000, 0.001);
      const dx = samples[i].x - samples[i - 1].x;
      const dy = samples[i].y - samples[i - 1].y;
      speeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
    }

    if (!speeds.length) {
      return null;
    }

    const meanSpeed = speeds.reduce((sum, value) => sum + value, 0) / speeds.length;
    return clamp(meanSpeed / 2.4, 0, 1);
  }

  ingestWearableSample(sample = {}) {
    const timestampMs = Number(sample.timestampMs ?? performance.now());
    if (!Number.isFinite(timestampMs)) {
      return;
    }

    const frame = {
      timestampMs,
      heartRateBpm: asFinite(sample.heartRateBpm),
      rrIntervalMs: asFinite(sample.rrIntervalMs),
      rrIntervalsMs: Array.isArray(sample.rrIntervalsMs)
        ? sample.rrIntervalsMs.map((value) => asFinite(value)).filter((value) => value !== null)
        : [],
      confidence: asFinite(sample.confidence),
      source: typeof sample.source === "string" && sample.source.trim() ? sample.source.trim() : "wearable"
    };

    if (!Number.isFinite(frame.heartRateBpm) && !Number.isFinite(frame.rrIntervalMs) && !frame.rrIntervalsMs.length) {
      return;
    }

    this.wearableSamples.push(frame);
    const cutoff = timestampMs - 180_000;
    while (this.wearableSamples.length && this.wearableSamples[0].timestampMs < cutoff) {
      this.wearableSamples.shift();
    }
  }

  drawPose(landmarks, ctx, width, height, color, lineWidth = 2) {
    const minVisibility = 0.15;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    for (const [a, b] of POSE_CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      if (!p1 || !p2) {
        continue;
      }
      if (Number.isFinite(p1.visibility) && p1.visibility < minVisibility) {
        continue;
      }
      if (Number.isFinite(p2.visibility) && p2.visibility < minVisibility) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    for (const point of landmarks) {
      if (!point) {
        continue;
      }
      if (Number.isFinite(point.visibility) && point.visibility < minVisibility) {
        continue;
      }
      const px = point.x * width;
      const py = point.y * height;
      ctx.globalAlpha = Number.isFinite(point.visibility) ? clamp(point.visibility, 0.3, 1) : 0.92;
      ctx.beginPath();
      ctx.arc(px, py, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  drawForeheadOutline(faceLandmarks, ctx, width, height) {
    const points = FACEMESH_FOREHEAD
      .map((index) => faceLandmarks[index])
      .filter(Boolean);

    if (points.length < 3) {
      return;
    }

    ctx.strokeStyle = "rgba(247,178,103,0.9)";
    ctx.fillStyle = "rgba(247,178,103,0.12)";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  drawBodyMap() {
    const ctx = this.bodyMapCtx;
    const width = this.bodyMapCanvas.width;
    const height = this.bodyMapCanvas.height;
    if (!ctx || !width || !height) {
      return;
    }

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "rgba(11,36,48,0.12)");
    bg.addColorStop(1, "rgba(11,36,48,0.03)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    this.syncBodyHeatBufferSize(width, height);
    const sprite = this.computeBodySpriteRect(width, height);
    const mapPose = this.buildBodyPoseFromSprite(sprite) || buildCanonicalPose(width, height);

    if (this.bodySilhouetteLoaded && this.bodySilhouetteImage.naturalWidth > 0) {
      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.drawImage(this.bodySilhouetteImage, sprite.x, sprite.y, sprite.width, sprite.height);
      ctx.restore();
    }

    const zones = this.resolveBodyMapZones();
    this.drawMaskedBodyHeat(ctx, zones, mapPose, sprite);
    this.drawImpactMarkers(ctx, zones, mapPose, width, height);
  }

  resolveBodyMapZones() {
    const flaggedZones = Array.isArray(this.lastMetrics?.flaggedZones)
      ? this.lastMetrics.flaggedZones.filter((zone) => Number.isFinite(Number(zone?.score)))
      : [];

    if (flaggedZones.length) {
      return flaggedZones;
    }

    const pairs = Array.isArray(this.lastSymmetrySnapshot?.pairDeltas)
      ? this.lastSymmetrySnapshot.pairDeltas
      : [];

    if (!pairs.length) {
      return [];
    }

    return pairs
      .filter((pair) => Number.isFinite(Number(pair?.pct)))
      .sort((a, b) => Number(b.pct) - Number(a.pct))
      .slice(0, 3)
      .map((pair) => ({
        zone: pair.zone,
        side: pair.side,
        score: round(clamp(Number(pair.pct) * 1.35, 2.6, 18), 2)
      }));
  }

  syncBodyHeatBufferSize(width, height) {
    if (!this.bodyHeatCanvas || !this.bodyHeatCtx) {
      return;
    }
    if (this.bodyHeatCanvas.width !== width) {
      this.bodyHeatCanvas.width = width;
    }
    if (this.bodyHeatCanvas.height !== height) {
      this.bodyHeatCanvas.height = height;
    }
  }

  computeBodySpriteRect(width, height) {
    const imageRatio = this.bodySilhouetteLoaded && this.bodySilhouetteImage?.naturalWidth > 0
      ? this.bodySilhouetteImage.naturalWidth / Math.max(this.bodySilhouetteImage.naturalHeight, 1)
      : 0.42;
    let spriteHeight = height * 0.93;
    let spriteWidth = spriteHeight * imageRatio;
    const maxWidth = width * 0.82;
    if (spriteWidth > maxWidth) {
      spriteWidth = maxWidth;
      spriteHeight = spriteWidth / Math.max(imageRatio, 0.001);
    }

    return {
      x: (width - spriteWidth) * 0.5,
      y: height * 0.032,
      width: spriteWidth,
      height: spriteHeight
    };
  }

  buildBodyPoseFromSprite(sprite) {
    if (!sprite) {
      return null;
    }
    const pt = (fx, fy) => ({
      x: sprite.x + sprite.width * fx,
      y: sprite.y + sprite.height * fy
    });

    const pose = {
      leftShoulder: pt(0.338, 0.255),
      rightShoulder: pt(0.662, 0.255),
      leftElbow: pt(0.286, 0.458),
      rightElbow: pt(0.714, 0.458),
      leftWrist: pt(0.225, 0.64),
      rightWrist: pt(0.775, 0.64),
      leftHip: pt(0.432, 0.555),
      rightHip: pt(0.568, 0.555),
      leftKnee: pt(0.432, 0.79),
      rightKnee: pt(0.568, 0.79),
      leftAnkle: pt(0.432, 0.955),
      rightAnkle: pt(0.568, 0.955)
    };
    const shoulderCenter = midpoint(pose.leftShoulder, pose.rightShoulder);
    const hipCenter = midpoint(pose.leftHip, pose.rightHip);
    return {
      ...pose,
      shoulderCenter,
      hipCenter,
      torsoCenter: midpoint(shoulderCenter, hipCenter)
    };
  }

  drawMaskedBodyHeat(ctx, zones, mapPose, sprite) {
    if (!ctx
      || !this.bodyHeatCtx
      || !this.bodySilhouetteLoaded
      || !this.bodySilhouetteImage?.naturalWidth
      || !Array.isArray(zones)
      || !zones.length) {
      return;
    }

    const heatCtx = this.bodyHeatCtx;
    const width = this.bodyHeatCanvas.width;
    const height = this.bodyHeatCanvas.height;
    heatCtx.clearRect(0, 0, width, height);

    const rankedZones = [...zones]
      .filter((zone) => Number.isFinite(Number(zone?.score)))
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 8);

    for (const zone of rankedZones) {
      const anchor = this.resolveBodyZoneAnchor(zone, mapPose);
      if (!anchor) {
        continue;
      }

      const severity = clamp(Number(zone.score) / 20, 0.12, 1);
      const radius = 14 + severity * 22;
      const isHot = Number(zone.score) >= 12;
      const inner = isHot ? "rgba(247, 111, 61, 0.82)" : "rgba(244, 188, 81, 0.74)";
      const outer = isHot ? "rgba(247, 111, 61, 0.0)" : "rgba(244, 188, 81, 0.0)";

      const g = heatCtx.createRadialGradient(anchor.x, anchor.y, radius * 0.12, anchor.x, anchor.y, radius);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      heatCtx.fillStyle = g;
      heatCtx.beginPath();
      heatCtx.ellipse(anchor.x, anchor.y, radius * 0.95, radius * 1.14, 0, 0, Math.PI * 2);
      heatCtx.fill();
    }

    heatCtx.globalCompositeOperation = "destination-in";
    heatCtx.drawImage(this.bodySilhouetteImage, sprite.x, sprite.y, sprite.width, sprite.height);
    heatCtx.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.globalAlpha = 0.78;
    ctx.drawImage(this.bodyHeatCanvas, 0, 0, width, height);
    ctx.restore();
  }

  drawImpactMarkers(ctx, zones, mapPose, width, height) {
    if (!ctx || !Array.isArray(zones) || !zones.length) {
      return;
    }

    const now = performance.now() * 0.001;
    const rankedZones = [...zones]
      .filter((zone) => Number.isFinite(Number(zone?.score)))
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, 6);

    ctx.save();
    ctx.font = "600 10px JetBrains Mono";
    rankedZones.forEach((zone, idx) => {
      const anchor = this.resolveBodyZoneAnchor(zone, mapPose);
      if (!anchor) {
        return;
      }

      const score = Number(zone.score);
      const severity = clamp(score / 20, 0.1, 1);
      const pulse = 1 + Math.sin(now * 4.8 + idx * 0.85) * 0.08;
      const radius = (9 + severity * 8) * pulse;
      const hot = score >= 12;
      const ringColor = hot ? "rgba(255, 132, 88, 0.92)" : "rgba(255, 211, 102, 0.9)";
      const coreColor = hot ? "rgba(255, 118, 72, 0.95)" : "rgba(255, 194, 88, 0.95)";

      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, radius * 1.22, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(220, 244, 255, 0.72)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = coreColor;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, radius * 0.36, 0, Math.PI * 2);
      ctx.fill();

      const label = `${zone.side} ${zone.zone} ${Math.round(score)}%`;
      const tw = ctx.measureText(label).width;
      const bx = clamp(anchor.x - tw * 0.5 - 6, 4, width - tw - 16);
      const by = clamp(anchor.y - radius * 1.35 - 16, 4, height - 20);
      ctx.fillStyle = "rgba(10, 29, 44, 0.84)";
      ctx.strokeStyle = "rgba(176, 227, 245, 0.52)";
      roundRect(ctx, bx, by, tw + 12, 14, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f3ede1";
      ctx.fillText(label, bx + 6, by + 10.4);
    });
    ctx.restore();
  }

  drawBodyZonePatch(zone, mapPose) {
    const ctx = this.bodyMapCtx;
    const width = this.bodyMapCanvas.width;
    const height = this.bodyMapCanvas.height;

    const anchor = this.resolveBodyZoneAnchor(zone, mapPose);
    if (!anchor) {
      return;
    }

    const severity = clamp(Number(zone.score || 0) / 20, 0, 1);
    const radiusX = clamp(12 + severity * 12, 11, 24);
    const radiusY = clamp(radiusX * 1.16, 12, 28);
    const colorInner = zone.score > 12 ? "rgba(239, 102, 48, 0.68)" : "rgba(245, 165, 66, 0.58)";
    const colorOuter = zone.score > 12 ? "rgba(239, 102, 48, 0.08)" : "rgba(245, 165, 66, 0.06)";

    const gradient = ctx.createRadialGradient(anchor.x, anchor.y, radiusX * 0.16, anchor.x, anchor.y, radiusX);
    gradient.addColorStop(0, colorInner);
    gradient.addColorStop(1, colorOuter);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(anchor.x, anchor.y, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.font = "600 10px JetBrains Mono";
    const text = `${zone.side} ${zone.zone} ${zone.score}%`;
    const textWidth = ctx.measureText(text).width;
    const bx = clamp(anchor.x - textWidth / 2 - 5, 3, width - textWidth - 13);
    const by = clamp(anchor.y - radiusY - 18, 3, height - 17);
    ctx.fillStyle = "rgba(10, 34, 46, 0.8)";
    ctx.strokeStyle = "rgba(180, 229, 242, 0.5)";
    roundRect(ctx, bx, by, textWidth + 10, 14, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f4efe2";
    ctx.fillText(text, bx + 5, by + 10.4);
    ctx.restore();
  }

  resolveBodyZoneAnchor(zone, mapPose) {
    const zoneKey = `${zone.side || "left"}-${zone.zone || "hip"}`;
    const map = {
      "left-shoulder": mapPose.leftShoulder,
      "right-shoulder": mapPose.rightShoulder,
      "left-hip": mapPose.leftHip,
      "right-hip": mapPose.rightHip,
      "left-knee": mapPose.leftKnee,
      "right-knee": mapPose.rightKnee
    };

    return map[zoneKey] || mapPose.torsoCenter;
  }

  buildBodyMapPose(width, height) {
    const fallback = {
      shoulderCenter: { x: width * 0.5, y: height * 0.33 },
      hipCenter: { x: width * 0.5, y: height * 0.58 },
      torsoCenter: { x: width * 0.5, y: height * 0.46 },
      leftShoulder: { x: width * 0.39, y: height * 0.34 },
      rightShoulder: { x: width * 0.61, y: height * 0.34 },
      leftElbow: { x: width * 0.31, y: height * 0.48 },
      rightElbow: { x: width * 0.69, y: height * 0.48 },
      leftWrist: { x: width * 0.3, y: height * 0.62 },
      rightWrist: { x: width * 0.7, y: height * 0.62 },
      leftHip: { x: width * 0.44, y: height * 0.58 },
      rightHip: { x: width * 0.56, y: height * 0.58 },
      leftKnee: { x: width * 0.44, y: height * 0.75 },
      rightKnee: { x: width * 0.56, y: height * 0.75 },
      leftAnkle: { x: width * 0.43, y: height * 0.92 },
      rightAnkle: { x: width * 0.57, y: height * 0.92 }
    };

    const pose = this.lastPose;
    if (!Array.isArray(pose) || pose.length < 29) {
      return fallback;
    }

    const point = (idx) => {
      const value = pose[idx];
      if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
        return null;
      }
      return { x: value.x, y: value.y };
    };

    const src = {
      leftShoulder: point(11),
      rightShoulder: point(12),
      leftElbow: point(13),
      rightElbow: point(14),
      leftWrist: point(15),
      rightWrist: point(16),
      leftHip: point(23),
      rightHip: point(24),
      leftKnee: point(25),
      rightKnee: point(26),
      leftAnkle: point(27),
      rightAnkle: point(28)
    };

    if (!src.leftShoulder || !src.rightShoulder || !src.leftHip || !src.rightHip) {
      return fallback;
    }

    const points = Object.values(src).filter(Boolean);
    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const spanX = Math.max(maxX - minX, 0.1);
    const spanY = Math.max(maxY - minY, 0.1);
    const scale = Math.min((width * 0.48) / spanX, (height * 0.7) / spanY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const targetCx = width * 0.5;
    const targetCy = height * 0.54;

    const mapped = {};
    for (const [name, p] of Object.entries(src)) {
      if (!p) {
        mapped[name] = fallback[name];
        continue;
      }
      mapped[name] = {
        x: targetCx + (p.x - cx) * scale,
        y: targetCy + (p.y - cy) * scale
      };
    }

    const shoulderCenter = midpoint(mapped.leftShoulder, mapped.rightShoulder);
    const hipCenter = midpoint(mapped.leftHip, mapped.rightHip);
    return {
      ...mapped,
      shoulderCenter,
      hipCenter,
      torsoCenter: midpoint(shoulderCenter, hipCenter)
    };
  }

  drawBodySilhouetteMap(ctx, mapPose, { fillStyle = null, outlineStyle = null, outlineWidth = 2 } = {}) {
    const shoulderCenter = mapPose.shoulderCenter || midpoint(mapPose.leftShoulder, mapPose.rightShoulder);
    const hipCenter = mapPose.hipCenter || midpoint(mapPose.leftHip, mapPose.rightHip);
    const torsoCenter = mapPose.torsoCenter || midpoint(shoulderCenter, hipCenter);
    const shoulderSpan = distance(mapPose.leftShoulder, mapPose.rightShoulder);
    const hipSpan = distance(mapPose.leftHip, mapPose.rightHip);
    const armWidth = clamp(shoulderSpan * 0.38, 10, 24);
    const legWidth = clamp(Math.max(hipSpan * 0.36, armWidth * 0.8), 9, 22);
    const headRadius = clamp(shoulderSpan * 0.31, 10, 24);
    const headCenter = {
      x: shoulderCenter.x,
      y: shoulderCenter.y - headRadius * 1.18
    };

    const leftShoulder = inflateFromCenter(mapPose.leftShoulder, torsoCenter, 1.18, 1.1);
    const rightShoulder = inflateFromCenter(mapPose.rightShoulder, torsoCenter, 1.18, 1.1);
    const leftHip = inflateFromCenter(mapPose.leftHip, torsoCenter, 1.14, 1.08);
    const rightHip = inflateFromCenter(mapPose.rightHip, torsoCenter, 1.14, 1.08);

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      ctx.arc(headCenter.x, headCenter.y, headRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(leftShoulder.x, leftShoulder.y);
      ctx.lineTo(rightShoulder.x, rightShoulder.y);
      ctx.lineTo(rightHip.x, rightHip.y);
      ctx.lineTo(leftHip.x, leftHip.y);
      ctx.closePath();
      ctx.fill();

      drawLimbStroke(ctx, [mapPose.leftShoulder, mapPose.leftElbow, mapPose.leftWrist], armWidth, fillStyle);
      drawLimbStroke(ctx, [mapPose.rightShoulder, mapPose.rightElbow, mapPose.rightWrist], armWidth, fillStyle);
      drawLimbStroke(ctx, [mapPose.leftHip, mapPose.leftKnee, mapPose.leftAnkle], legWidth, fillStyle);
      drawLimbStroke(ctx, [mapPose.rightHip, mapPose.rightKnee, mapPose.rightAnkle], legWidth, fillStyle);
    }

    if (outlineStyle) {
      ctx.strokeStyle = outlineStyle;
      ctx.lineWidth = outlineWidth;

      ctx.beginPath();
      ctx.arc(headCenter.x, headCenter.y, headRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(leftShoulder.x, leftShoulder.y);
      ctx.lineTo(rightShoulder.x, rightShoulder.y);
      ctx.lineTo(rightHip.x, rightHip.y);
      ctx.lineTo(leftHip.x, leftHip.y);
      ctx.closePath();
      ctx.stroke();

      drawLimbOutline(ctx, [mapPose.leftShoulder, mapPose.leftElbow, mapPose.leftWrist], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [mapPose.rightShoulder, mapPose.rightElbow, mapPose.rightWrist], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [mapPose.leftHip, mapPose.leftKnee, mapPose.leftAnkle], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [mapPose.rightHip, mapPose.rightKnee, mapPose.rightAnkle], outlineStyle, outlineWidth);
    }

    ctx.restore();
  }

  syncCanvasSize() {
    const width = this.videoEl.videoWidth || 960;
    const height = this.videoEl.videoHeight || 540;

    this.cameraCanvas.width = width;
    this.cameraCanvas.height = height;

    this.bodyMapCanvas.width = 320;
    this.bodyMapCanvas.height = 520;
  }

  getLatestPoseLandmarks() {
    return this.lastPose;
  }

  getLatestPoseWorldLandmarks() {
    return this.lastPoseWorld;
  }

  getLatestMetrics() {
    return this.lastMetrics;
  }
}

function centroid(faceLandmarks, indexes) {
  let x = 0;
  let y = 0;
  let n = 0;

  for (const idx of indexes) {
    const point = faceLandmarks[idx];
    if (!point) {
      continue;
    }

    x += point.x;
    y += point.y;
    n += 1;
  }

  if (!n) {
    return null;
  }

  return {
    x: x / n,
    y: y / n
  };
}

function distance(a, b) {
  if (!a || !b) {
    return 0;
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distance3d(a, b) {
  if (!isFinitePoint3d(a) || !isFinitePoint3d(b)) {
    return 0;
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function isFinitePoint3d(point) {
  return !!point
    && Number.isFinite(point.x)
    && Number.isFinite(point.y)
    && Number.isFinite(point.z);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function inflateFromCenter(point, center, sx = 1, sy = 1) {
  return {
    x: center.x + (point.x - center.x) * sx,
    y: center.y + (point.y - center.y) * sy
  };
}

function drawLimbStroke(ctx, points, lineWidth, color) {
  const valid = points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(valid[0].x, valid[0].y);
  for (let i = 1; i < valid.length; i += 1) {
    ctx.lineTo(valid[i].x, valid[i].y);
  }
  ctx.stroke();
}

function drawLimbOutline(ctx, points, color, lineWidth) {
  const valid = points.filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (valid.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(valid[0].x, valid[0].y);
  for (let i = 1; i < valid.length; i += 1) {
    ctx.lineTo(valid[i].x, valid[i].y);
  }
  ctx.stroke();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function generateSessionId() {
  return `aura-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asFinite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bestFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function roundIfFinite(value, digits) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? round(parsed, digits) : null;
}

const scriptLoadCache = new Map();

async function ensureMediaPipeGlobal(globalName, candidates = []) {
  if (typeof window !== "undefined" && window[globalName]) {
    return candidates[0] || null;
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      await loadScriptOnce(candidate.script);
      if (typeof window !== "undefined" && window[globalName]) {
        return candidate;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`MediaPipe dependency "${globalName}" could not be loaded.`);
}

function loadScriptOnce(src) {
  if (!src) {
    return Promise.reject(new Error("Script source is required."));
  }

  const absoluteSrc = new URL(src, window.location.href).href;
  const cached = scriptLoadCache.get(absoluteSrc);
  if (cached) {
    return cached;
  }

  const promise = new Promise((resolve, reject) => {
    const existing = [...document.getElementsByTagName("script")]
      .find((script) => script.src === absoluteSrc);
    if (existing) {
      resolve(existing);
      return;
    }

    const script = document.createElement("script");
    script.src = absoluteSrc;
    script.async = false;
    script.onload = () => {
      resolve(script);
    };
    script.onerror = () => {
      scriptLoadCache.delete(absoluteSrc);
      reject(new Error(`Failed to load script: ${src}`));
    };
    document.head.appendChild(script);
  });

  scriptLoadCache.set(absoluteSrc, promise);
  return promise;
}
