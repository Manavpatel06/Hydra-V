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
import {
  buildCanonicalPose,
  drawAnatomyFigure,
  drawZoneHighlight
} from "../visual/AnatomyFigureRenderer.js";

const BODY_SILHOUETTE_URL = "/src/assets/anatomy-silhouette.svg";

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
    this.cameraCtx = this.cameraCanvas.getContext("2d");
    this.bodyMapCanvas = bodyMapCanvasEl;
    this.bodyMapCtx = this.bodyMapCanvas.getContext("2d");
    this.bodySilhouetteImage = new Image();
    this.bodySilhouetteLoaded = false;
    this.bodySilhouetteImage.onload = () => {
      this.bodySilhouetteLoaded = true;
    };
    this.bodySilhouetteImage.onerror = () => {
      this.bodySilhouetteLoaded = false;
    };
    this.bodySilhouetteImage.src = BODY_SILHOUETTE_URL;

    this.stream = null;
    this.pose = null;
    this.faceMesh = null;
    this.cameraLoop = null;
    this.running = false;
    this.scanning = false;
    this.scanStartedAt = 0;
    this.scanDurationSec = DEFAULT_SCAN_SECONDS;

    this.lastPose = null;
    this.lastFace = null;
    this.lastMetrics = null;
    this.lastBackendMetrics = null;

    this.ppgSamples = [];
    this.eyeMotionSamples = [];
    this.rrIntervals = [];
    this.lastRPeakAt = null;

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

    this.onResultsPose = this.onResultsPose.bind(this);
    this.onResultsFace = this.onResultsFace.bind(this);
  }

  isSupported() {
    return !!(navigator?.mediaDevices?.getUserMedia);
  }

  async initModels() {
    if (!window.Pose || !window.FaceMesh) {
      throw new Error("MediaPipe Pose and FaceMesh scripts are not loaded.");
    }

    if (!this.pose) {
      this.pose = new window.Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
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
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
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
        width: { ideal: 960 },
        height: { ideal: 540 },
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
      onFrame: async () => {
        await this.pose.send({ image: this.videoEl });
        await this.faceMesh.send({ image: this.videoEl });
        this.renderFrame();
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
    this.rrIntervals = [];
    this.lastRPeakAt = null;
    this.lastBackendMetrics = null;
    this.backendErrorCount = 0;
    this.sentPpgIndex = 0;
    this.sentEyeIndex = 0;
    this.lastBackendAt = 0;
    this.backendSessionId = generateSessionId();
    this.useBackendAnalytics = this.backendPreferredAnalytics;

    if (this.useBackendAnalytics) {
      this.resetBackendSession().catch(() => {
        this.backendErrorCount += 1;
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

    this.lastPose = results.poseLandmarks;
  }

  onResultsFace(results) {
    if (!results.multiFaceLandmarks?.length) {
      return;
    }

    this.lastFace = results.multiFaceLandmarks[0];
  }

  renderFrame() {
    const width = this.cameraCanvas.width;
    const height = this.cameraCanvas.height;

    this.cameraCtx.save();
    this.cameraCtx.clearRect(0, 0, width, height);
    this.cameraCtx.drawImage(this.videoEl, 0, 0, width, height);

    if (this.lastPose) {
      this.drawPose(this.lastPose, this.cameraCtx, width, height, "rgba(14,165,160,0.85)", 2);
    }

    if (this.lastFace) {
      this.drawForeheadOutline(this.lastFace, this.cameraCtx, width, height);
    }

    this.cameraCtx.restore();

    if (this.scanning) {
      this.ingestScanFrame();
    }

    this.drawBodyMap();
  }

  ingestScanFrame() {
    const nowMs = performance.now();
    const elapsedMs = nowMs - this.scanStartedAt;
    const progress = clamp(elapsedMs / (this.scanDurationSec * 1000), 0, 1);

    if (this.lastFace) {
      this.capturePpgSample(nowMs);
      this.captureEyeMotionSample(nowMs);
    }

    const localMetrics = this.computeMetrics();
    this.maybeRequestBackend(nowMs, localMetrics);
    this.lastMetrics = this.mergeMetrics(localMetrics, this.lastBackendMetrics);

    if (this.lastMetrics) {
      this.eventBus.emit(EVENTS.AURA_SCAN_FRAME, {
        progress,
        ...this.lastMetrics
      });

      const rrInterval = this.lastMetrics.rrIntervalMs;
      const hr = this.lastMetrics.heartRateBpm;
      const hrv = this.lastMetrics.hrvRmssdMs;

      const hasRPeak = Number.isFinite(rrInterval) && this.detectRPeak(nowMs, rrInterval);
      this.eventBus.emit(EVENTS.BIOMETRIC_FRAME, {
        timestampMs: nowMs,
        rPeakDetected: hasRPeak,
        rrIntervalMs: rrInterval,
        heartRateBpm: hr,
        hrvRmssdMs: hrv,
        microsaccadeHz: this.lastMetrics.microsaccadeHz
      });
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

    const summary = this.lastMetrics || this.computeMetrics();
    if (!summary) {
      this.eventBus.emit(EVENTS.AURA_SCAN_STATUS, {
        status: "scan_failed",
        message: "Unable to compute scan metrics."
      });
      return;
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
      mode: sample.mode
    }));

    const eyeSamples = this.eyeMotionSamples.slice(this.sentEyeIndex).map((sample) => ({
      timestamp_ms: sample.timestampMs,
      x: sample.x,
      y: sample.y
    }));

    const symmetry = this.lastPose ? this.computeSymmetry(this.lastPose) : { deltaPct: null, flaggedZones: [] };

    const payload = {
      session_id: this.backendSessionId,
      timestamp_ms: nowMs,
      scan_duration_sec: this.scanDurationSec,
      ppg_samples: ppgSamples,
      eye_samples: eyeSamples,
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
        readiness_score: localMetrics?.readinessScore ?? null
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
      vitalsSource: backendMetrics.vitalsSource ?? null
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
      vitalsSource: metrics.vitals_source ?? null
    };
  }

  capturePpgSample(timestampMs) {
    const forehead = this.lastFace
      .map((landmark, idx) => ({ landmark, idx }))
      .filter((item) => FACEMESH_FOREHEAD.includes(item.idx))
      .map((item) => item.landmark);

    if (forehead.length < 4) {
      return;
    }

    const xs = forehead.map((point) => point.x * this.cameraCanvas.width);
    const ys = forehead.map((point) => point.y * this.cameraCanvas.height);
    const x = Math.max(0, Math.floor(Math.min(...xs)));
    const y = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.max(4, Math.floor(Math.max(...xs) - Math.min(...xs)));
    const h = Math.max(4, Math.floor(Math.max(...ys) - Math.min(...ys)));

    const img = this.cameraCtx.getImageData(x, y, w, h).data;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    const pixels = img.length / 4;

    for (let i = 0; i < img.length; i += 4) {
      sumR += img[i];
      sumG += img[i + 1];
      sumB += img[i + 2];
    }

    const avgR = sumR / pixels;
    const avgG = sumG / pixels;
    const avgB = sumB / pixels;
    const mode = estimateSkinMode([avgR, avgG, avgB]);

    let sample = avgG;
    if (mode === "pos") {
      const iMean = (avgR + avgG + avgB) / 3 || 1;
      sample = (avgG - avgB) / iMean;
    }

    this.ppgSamples.push({
      timestampMs,
      value: sample,
      rgb: [avgR, avgG, avgB],
      mode
    });

    const cutoff = timestampMs - 90_000;
    while (this.ppgSamples.length && this.ppgSamples[0].timestampMs < cutoff) {
      this.ppgSamples.shift();
    }
  }

  captureEyeMotionSample(timestampMs) {
    if (!this.lastFace) {
      return;
    }

    const left = centroid(this.lastFace, LEFT_EYE_CLUSTER);
    const right = centroid(this.lastFace, RIGHT_EYE_CLUSTER);

    const eyeCenter = {
      x: (left.x + right.x) / 2,
      y: (left.y + right.y) / 2
    };

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
    if (!this.lastPose || this.ppgSamples.length < 45) {
      return null;
    }

    const samples = this.ppgSamples;
    const times = samples.map((sample) => sample.timestampMs);
    const values = samples.map((sample) => sample.value);
    const durationSec = Math.max((times.at(-1) - times[0]) / 1000, 0.001);
    const samplingHz = values.length / durationSec;

    const dominantHz = estimateDominantFrequency(values, samplingHz, 0.7, 3.2);
    const heartRateBpm = dominantHz ? dominantHz * 60 : null;

    const rrIntervals = estimateRrIntervalsFromSignal(values, times, 45, 200);
    this.rrIntervals = rrIntervals;

    const rrIntervalMs = mean(rrIntervals);
    const hrvRmssdMs = rmssd(rrIntervals);

    const symmetry = this.computeSymmetry(this.lastPose);
    const microsaccadeHz = this.computeMicrosaccadeHz();

    const readiness = computeReadinessScore({
      hrvRmssdMs,
      symmetryDeltaPct: symmetry.deltaPct,
      microsaccadeHz
    });

    const skinMode = samples.at(-1)?.mode || "green";

    return {
      algorithm: skinMode,
      heartRateBpm: Number.isFinite(heartRateBpm) ? round(heartRateBpm, 1) : null,
      rrIntervalMs: Number.isFinite(rrIntervalMs) ? round(rrIntervalMs, 1) : null,
      hrvRmssdMs: Number.isFinite(hrvRmssdMs) ? round(hrvRmssdMs, 1) : null,
      microsaccadeHz: Number.isFinite(microsaccadeHz) ? round(microsaccadeHz, 3) : null,
      symmetryDeltaPct: Number.isFinite(symmetry.deltaPct) ? round(symmetry.deltaPct, 2) : null,
      flaggedZones: symmetry.flaggedZones,
      readinessScore: Number.isFinite(readiness) ? round(readiness, 2) : null,
      cnsFatigue: Number.isFinite(microsaccadeHz) ? microsaccadeHz < 0.5 : null
    };
  }

  computeSymmetry(poseLandmarks) {
    const leftShoulder = poseLandmarks[11];
    const rightShoulder = poseLandmarks[12];
    const leftHip = poseLandmarks[23];
    const rightHip = poseLandmarks[24];
    const leftKnee = poseLandmarks[25];
    const rightKnee = poseLandmarks[26];

    const pairs = [
      { name: "shoulder", left: leftShoulder, right: rightShoulder },
      { name: "hip", left: leftHip, right: rightHip },
      { name: "knee", left: leftKnee, right: rightKnee }
    ];

    const deltas = [];
    const flagged = [];

    for (const pair of pairs) {
      if (!pair.left || !pair.right) {
        continue;
      }

      const yDelta = Math.abs(pair.left.y - pair.right.y);
      const xSpan = Math.abs(pair.left.x - pair.right.x) || 0.001;
      const pct = (yDelta / xSpan) * 100;
      deltas.push(pct);

      if (pct > 6) {
        const side = pair.left.y > pair.right.y ? "left" : "right";
        flagged.push({
          zone: pair.name,
          side,
          score: round(pct, 2)
        });
      }
    }

    return {
      deltaPct: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null,
      flaggedZones: flagged
    };
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

  drawPose(landmarks, ctx, width, height, color, lineWidth = 2) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;

    for (const [a, b] of POSE_CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      if (!p1 || !p2) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    for (const point of landmarks) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 2.2, 0, Math.PI * 2);
      ctx.fill();
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

    ctx.clearRect(0, 0, width, height);

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "rgba(11,36,48,0.12)");
    bg.addColorStop(1, "rgba(11,36,48,0.03)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const mapPose = buildCanonicalPose(width, height);
    if (this.bodySilhouetteLoaded && this.bodySilhouetteImage.naturalWidth > 0) {
      const spriteHeight = height * 0.9;
      const spriteWidth = spriteHeight * 0.42;
      const x = (width - spriteWidth) * 0.5;
      const y = height * 0.05;
      ctx.save();
      ctx.globalAlpha = 0.84;
      ctx.drawImage(this.bodySilhouetteImage, x, y, spriteWidth, spriteHeight);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(194, 198, 203, 0.62)";
      ctx.fillRect(x, y, spriteWidth, spriteHeight);
      ctx.restore();
    } else {
      drawAnatomyFigure(ctx, mapPose, {
        alpha: 1,
        bodyFill: "rgba(186, 190, 194, 0.88)",
        bodyStroke: "rgba(248, 250, 252, 0.42)",
        detailStroke: "rgba(250, 251, 252, 0.38)"
      });
    }

    const zones = this.lastMetrics?.flaggedZones || [];
    for (const zone of zones) {
      drawZoneHighlight(ctx, mapPose, zone.zone, zone.side, zone.score, {
        showLabel: true,
        baseRadius: 12
      });
    }
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

  return {
    x: n ? x / n : 0,
    y: n ? y / n : 0
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
