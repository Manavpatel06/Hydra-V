import { EVENTS } from "../../core/events.js";
import { clamp, round } from "../../core/utils.js";

const DEFAULT_SCAN_DURATION_SEC = 8;
const DEFAULT_SAMPLE_FPS = 10;
const DEFAULT_MAX_FRAMES = 96;

export class FascialThermalEngine {
  constructor({
    eventBus,
    sourceCanvasEl,
    overlayCanvasEl,
    getPoseLandmarks,
    getAuraMetrics,
    analyzeEndpoint = "/api/thermal/analyze",
    sampleFps = DEFAULT_SAMPLE_FPS,
    maxFrames = DEFAULT_MAX_FRAMES,
    defaultScanDurationSec = DEFAULT_SCAN_DURATION_SEC
  }) {
    this.eventBus = eventBus;
    this.sourceCanvas = sourceCanvasEl;
    this.overlayCanvas = overlayCanvasEl;
    this.overlayCtx = this.overlayCanvas.getContext("2d");

    this.getPoseLandmarks = getPoseLandmarks;
    this.getAuraMetrics = getAuraMetrics;

    this.analyzeEndpoint = analyzeEndpoint;
    this.sampleFps = clamp(Number(sampleFps) || DEFAULT_SAMPLE_FPS, 3, 30);
    this.maxFrames = clamp(Number(maxFrames) || DEFAULT_MAX_FRAMES, 20, 320);
    this.defaultScanDurationSec = clamp(Number(defaultScanDurationSec) || DEFAULT_SCAN_DURATION_SEC, 4, 20);

    this.captureCanvas = document.createElement("canvas");
    this.captureCtx = this.captureCanvas.getContext("2d", { willReadFrequently: false });

    this.running = false;
    this.analyzing = false;
    this.scanStartedAtMs = 0;
    this.scanDurationSec = this.defaultScanDurationSec;
    this.captureTimer = null;
    this.progressTimer = null;
    this.sessionId = null;

    this.frames = [];
    this.poseFrames = [];
    this.lastResult = null;
  }

  startScan(durationSec = this.defaultScanDurationSec) {
    if (this.running || this.analyzing) {
      throw new Error("Thermal scan is already running.");
    }

    if (!this.sourceCanvas?.width || !this.sourceCanvas?.height) {
      throw new Error("Aura camera must be running before thermal mapping.");
    }

    this.scanDurationSec = clamp(Number(durationSec) || this.defaultScanDurationSec, 4, 20);
    this.scanStartedAtMs = performance.now();
    this.running = true;
    this.sessionId = this.generateSessionId();
    this.frames = [];
    this.poseFrames = [];

    this.syncOverlaySize();
    this.clearOverlay();
    this.emitStatus("scanning", {
      scanDurationSec: this.scanDurationSec,
      sampleFps: this.sampleFps
    });

    const frameIntervalMs = Math.round(1000 / this.sampleFps);
    this.captureTimer = setInterval(() => {
      this.captureFrame();
    }, frameIntervalMs);

    this.progressTimer = setInterval(() => {
      const elapsed = performance.now() - this.scanStartedAtMs;
      const progress = clamp(elapsed / (this.scanDurationSec * 1000), 0, 1);

      this.eventBus.emit(EVENTS.THERMAL_SCAN_FRAME, {
        status: this.analyzing ? "analyzing" : "scanning",
        progress,
        frameCount: this.frames.length
      });
    }, 180);
  }

  stopScan() {
    if (!this.running && !this.analyzing) {
      return;
    }

    this.cleanupTimers();
    this.running = false;
    this.analyzing = false;

    this.emitStatus("idle", {
      frameCount: this.frames.length
    });
  }

  async captureFrame() {
    if (!this.running) {
      return;
    }

    this.syncOverlaySize();
    this.syncCaptureCanvasSize();

    const nowMs = performance.now();

    this.captureCtx.drawImage(this.sourceCanvas, 0, 0, this.captureCanvas.width, this.captureCanvas.height);
    const imageBase64 = this.captureCanvas.toDataURL("image/jpeg", 0.64);

    this.frames.push({
      timestamp_ms: nowMs,
      image_base64: imageBase64
    });

    const landmarks = this.getPoseLandmarks?.();
    if (Array.isArray(landmarks) && landmarks.length) {
      this.poseFrames.push({
        timestamp_ms: nowMs,
        landmarks: landmarks.map((point) => ({
          x: Number(point?.x ?? 0),
          y: Number(point?.y ?? 0),
          z: Number(point?.z ?? 0),
          visibility: Number.isFinite(point?.visibility) ? Number(point.visibility) : null
        }))
      });
    }

    if (this.frames.length > this.maxFrames) {
      this.frames.shift();
      if (this.poseFrames.length > this.maxFrames) {
        this.poseFrames.shift();
      }
    }

    const elapsed = nowMs - this.scanStartedAtMs;
    if (elapsed >= this.scanDurationSec * 1000 || this.frames.length >= this.maxFrames) {
      this.running = false;
      this.cleanupTimers();
      await this.analyzeCapturedFrames();
    }
  }

  async analyzeCapturedFrames() {
    if (this.analyzing) {
      return;
    }

    this.analyzing = true;
    this.emitStatus("analyzing", {
      frameCount: this.frames.length
    });

    try {
      if (this.frames.length < 4) {
        throw new Error("Thermal scan captured too few frames. Try again with stable camera view.");
      }

      const aura = this.getAuraMetrics?.() || {};

      const response = await fetch(this.analyzeEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          session_id: this.sessionId,
          timestamp_ms: performance.now(),
          scan_duration_sec: this.scanDurationSec,
          frames: this.frames.map((frame) => ({
            timestamp_ms: frame.timestamp_ms,
            image_base64: frame.image_base64
          })),
          pose_frames: this.poseFrames.map((frame) => ({
            timestamp_ms: frame.timestamp_ms,
            landmarks: frame.landmarks
          })),
          aura_context: {
            flagged_zones: Array.isArray(aura.flaggedZones) ? aura.flaggedZones : [],
            symmetry_delta_pct: Number.isFinite(aura.symmetryDeltaPct) ? aura.symmetryDeltaPct : null,
            readiness_score: Number.isFinite(aura.readinessScore) ? aura.readinessScore : null
          }
        })
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || body.details || "Thermal mapping backend request failed.");
      }

      const metrics = this.normalizeMetrics(body.metrics || {});
      this.lastResult = metrics;
      this.renderOverlay(metrics.overlay);

      this.eventBus.emit(EVENTS.THERMAL_SCAN_COMPLETE, metrics);
      this.emitStatus("scan_complete", {
        frameCount: this.frames.length
      });
    } catch (error) {
      this.clearOverlay();
      this.emitStatus("scan_failed", {
        message: error.message
      });
      this.eventBus.emit(EVENTS.WARNING, {
        scope: "fascial-thermal-mapping",
        message: error.message
      });
    } finally {
      this.analyzing = false;
      this.running = false;
      this.cleanupTimers();
    }
  }

  normalizeMetrics(raw) {
    const recommendedPads = raw.recommended_pads || {};
    const overlay = raw.overlay || {};

    return {
      algorithm: raw.algorithm || "python-farneback-thermal",
      scanDurationSec: Number(raw.scan_duration_sec) || this.scanDurationSec,
      flaggedZones: Array.isArray(raw.flagged_zones) ? raw.flagged_zones : [],
      zoneScores: Array.isArray(raw.zone_scores) ? raw.zone_scores : [],
      chainTargets: Array.isArray(raw.chain_targets) ? raw.chain_targets : [],
      quality: raw.quality || {},
      recommendedPads: {
        sun: recommendedPads.sun || null,
        moon: recommendedPads.moon || null
      },
      overlay: {
        zones: Array.isArray(overlay.zones) ? overlay.zones : [],
        recommendedPads: Array.isArray(overlay.recommended_pads) ? overlay.recommended_pads : []
      }
    };
  }

  renderOverlay(overlay = {}) {
    this.syncOverlaySize();
    this.clearOverlay();

    const zones = Array.isArray(overlay.zones) ? overlay.zones : [];
    const padOverlays = Array.isArray(overlay.recommendedPads) ? overlay.recommendedPads : [];

    for (const zone of zones) {
      this.drawZone(zone);
    }

    for (const pad of padOverlays) {
      this.drawPadMarker(pad);
    }
  }

  drawZone(zone) {
    if (!zone?.anchor || !Array.isArray(zone.anchor)) {
      return;
    }

    const [xNorm, yNorm] = zone.anchor;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;

    const x = xNorm * width;
    const y = yNorm * height;
    const radiusNorm = Number(zone.radius_norm) || 0.1;
    const radius = clamp(radiusNorm * Math.min(width, height), 16, 96);
    const coldScore = clamp(Number(zone.cold_score) || 0, 0, 1);

    this.overlayCtx.save();
    this.overlayCtx.globalCompositeOperation = "screen";
    this.overlayCtx.strokeStyle = `rgba(255, ${Math.round(210 - coldScore * 120)}, ${Math.round(80 - coldScore * 45)}, 0.9)`;
    this.overlayCtx.fillStyle = `rgba(255, ${Math.round(150 - coldScore * 70)}, ${Math.round(30 + coldScore * 40)}, ${0.12 + coldScore * 0.2})`;
    this.overlayCtx.lineWidth = 2;
    this.overlayCtx.beginPath();
    this.overlayCtx.arc(x, y, radius, 0, Math.PI * 2);
    this.overlayCtx.fill();
    this.overlayCtx.stroke();

    this.overlayCtx.font = "12px JetBrains Mono";
    this.overlayCtx.fillStyle = "#fef3c7";
    this.overlayCtx.fillText(`${zone.side} ${zone.zone} ${round(coldScore * 100, 0)}%`, x - radius * 0.6, y - radius - 8);
    this.overlayCtx.restore();
  }

  drawPadMarker(pad) {
    if (!pad?.anchor || !Array.isArray(pad.anchor)) {
      return;
    }

    const [xNorm, yNorm] = pad.anchor;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;

    const x = xNorm * width;
    const y = yNorm * height;
    const isSun = pad.pad === "sun";

    this.overlayCtx.save();
    this.overlayCtx.globalCompositeOperation = "lighter";
    this.overlayCtx.shadowBlur = 24;
    this.overlayCtx.shadowColor = isSun ? "rgba(255,185,60,0.95)" : "rgba(110,190,255,0.95)";
    this.overlayCtx.fillStyle = isSun ? "rgba(255,170,35,0.95)" : "rgba(90,175,255,0.95)";

    this.overlayCtx.beginPath();
    this.overlayCtx.arc(x, y, isSun ? 13 : 11, 0, Math.PI * 2);
    this.overlayCtx.fill();

    this.overlayCtx.font = "12px JetBrains Mono";
    this.overlayCtx.fillStyle = "#f8fafc";
    this.overlayCtx.fillText(isSun ? "SUN" : "MOON", x + 14, y + 4);
    this.overlayCtx.restore();
  }

  clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  emitStatus(status, detail = {}) {
    this.eventBus.emit(EVENTS.THERMAL_SCAN_STATUS, {
      status,
      ...detail
    });
  }

  syncCaptureCanvasSize() {
    const sourceWidth = this.sourceCanvas.width;
    const sourceHeight = this.sourceCanvas.height;
    const targetWidth = Math.min(sourceWidth || 320, 320);
    const ratio = targetWidth / Math.max(sourceWidth || 1, 1);
    const targetHeight = Math.max(Math.round((sourceHeight || 180) * ratio), 180);

    if (this.captureCanvas.width !== targetWidth || this.captureCanvas.height !== targetHeight) {
      this.captureCanvas.width = targetWidth;
      this.captureCanvas.height = targetHeight;
    }
  }

  syncOverlaySize() {
    const width = this.sourceCanvas.width || 960;
    const height = this.sourceCanvas.height || 540;

    if (this.overlayCanvas.width !== width || this.overlayCanvas.height !== height) {
      this.overlayCanvas.width = width;
      this.overlayCanvas.height = height;
    }
  }

  cleanupTimers() {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
  }

  generateSessionId() {
    return `thermal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  getLatestResult() {
    return this.lastResult;
  }
}
