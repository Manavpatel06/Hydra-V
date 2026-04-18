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
      cnsFatigue: backendMetrics.cnsFatigue ?? localMetrics?.cnsFatigue ?? false,
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

    return {
      algorithm: metrics.algorithm ?? null,
      heartRateBpm: asFinite(metrics.heart_rate_bpm),
      rrIntervalMs: asFinite(metrics.rr_interval_ms),
      hrvRmssdMs: asFinite(metrics.hrv_rmssd_ms),
      microsaccadeHz: asFinite(metrics.microsaccade_hz),
      symmetryDeltaPct: asFinite(metrics.symmetry_delta_pct),
      flaggedZones,
      readinessScore: asFinite(metrics.readiness_score),
      cnsFatigue: Boolean(metrics.cns_fatigue),
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
      hrvRmssdMs: hrvRmssdMs ?? (rrIntervalMs ? rrIntervalMs / 12 : 20),
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
      symmetryDeltaPct: round(symmetry.deltaPct, 2),
      flaggedZones: symmetry.flaggedZones,
      readinessScore: round(readiness, 2),
      cnsFatigue: Number.isFinite(microsaccadeHz) ? microsaccadeHz < 0.5 : false
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
      deltaPct: deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : 0,
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

    ctx.fillStyle = "rgba(12,47,64,0.08)";
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2;

    ctx.strokeStyle = "rgba(16,54,75,0.45)";
    ctx.lineWidth = 3;

    ctx.beginPath();
    ctx.arc(centerX, 42, 24, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX, 66);
    ctx.lineTo(centerX, 184);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX - 58, 96);
    ctx.lineTo(centerX + 58, 96);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX, 184);
    ctx.lineTo(centerX - 38, 260);
    ctx.moveTo(centerX, 184);
    ctx.lineTo(centerX + 38, 260);
    ctx.stroke();

    const zones = this.lastMetrics?.flaggedZones || [];

    for (const zone of zones) {
      this.drawFlagZone(zone);
    }
  }

  drawFlagZone(zone) {
    const ctx = this.bodyMapCtx;
    const width = this.bodyMapCanvas.width;
    const centerX = width / 2;

    const anchors = {
      shoulder: 96,
      hip: 160,
      knee: 226
    };

    const y = anchors[zone.zone] || 160;
    const x = zone.side === "left" ? centerX - 44 : centerX + 44;

    const color = zone.score > 12 ? "rgba(205,85,25,0.95)" : "rgba(216,131,32,0.95)";
    ctx.fillStyle = color;

    const radius = clamp(6 + zone.score * 0.22, 7, 15);

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = "11px JetBrains Mono";
    ctx.fillStyle = "#163648";
    ctx.fillText(`${zone.zone} ${zone.score}%`, x + 10, y + 4);
  }

  syncCanvasSize() {
    const width = this.videoEl.videoWidth || 960;
    const height = this.videoEl.videoHeight || 540;

    this.cameraCanvas.width = width;
    this.cameraCanvas.height = height;

    this.bodyMapCanvas.width = 320;
    this.bodyMapCanvas.height = 280;
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

function generateSessionId() {
  return `aura-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asFinite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
