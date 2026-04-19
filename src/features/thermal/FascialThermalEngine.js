import { EVENTS } from "../../core/events.js";
import { clamp, round } from "../../core/utils.js";

const DEFAULT_SCAN_DURATION_SEC = 8;
const DEFAULT_SAMPLE_FPS = 10;
const DEFAULT_MAX_FRAMES = 96;
const POSE_IDX = Object.freeze({
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28
});

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
    this.maskCanvas = document.createElement("canvas");
    this.maskCtx = this.maskCanvas.getContext("2d");
    this.heatCanvas = document.createElement("canvas");
    this.heatCtx = this.heatCanvas.getContext("2d");

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
    const landmarks = this.getPoseLandmarks?.();
    const pose = this.extractPoseModel(landmarks);

    if (!pose) {
      for (const zone of zones) {
        this.drawZoneHeat(this.overlayCtx, zone, { label: true });
      }
      for (const pad of padOverlays) {
        this.drawPadMarker(pad);
      }
      return;
    }

    this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.heatCtx.clearRect(0, 0, this.heatCanvas.width, this.heatCanvas.height);

    this.drawBodySilhouette(this.maskCtx, pose, {
      fillStyle: "rgba(255,255,255,1)"
    });

    this.drawBodySilhouette(this.heatCtx, pose, {
      fillStyle: "rgba(102, 178, 205, 0.13)"
    });

    for (const zone of zones) {
      this.drawZoneHeat(this.heatCtx, zone, { label: false });
    }

    this.heatCtx.globalCompositeOperation = "destination-in";
    this.heatCtx.drawImage(this.maskCanvas, 0, 0);
    this.heatCtx.globalCompositeOperation = "source-over";

    this.overlayCtx.drawImage(this.heatCanvas, 0, 0);
    this.drawBodySilhouette(this.overlayCtx, pose, {
      outlineStyle: "rgba(163, 225, 245, 0.55)",
      outlineWidth: 2.2
    });

    for (const zone of zones) {
      this.drawZoneHeat(this.overlayCtx, zone, { label: true, ringOnly: true });
    }

    for (const pad of padOverlays) {
      this.drawPadMarker(pad);
    }
  }

  drawZoneHeat(ctx, zone, { label = true, ringOnly = false } = {}) {
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

    const glowColor = `rgba(255, ${Math.round(212 - coldScore * 124)}, ${Math.round(84 - coldScore * 48)}, 1)`;
    const ringColor = `rgba(255, ${Math.round(220 - coldScore * 120)}, ${Math.round(70 - coldScore * 40)}, 0.92)`;

    if (!ringOnly) {
      const gradient = ctx.createRadialGradient(x, y, radius * 0.16, x, y, radius);
      gradient.addColorStop(0, `rgba(255, ${Math.round(164 - coldScore * 70)}, ${Math.round(48 + coldScore * 50)}, ${0.36 + coldScore * 0.28})`);
      gradient.addColorStop(0.45, `rgba(255, ${Math.round(130 - coldScore * 45)}, ${Math.round(32 + coldScore * 32)}, ${0.2 + coldScore * 0.15})`);
      gradient.addColorStop(1, "rgba(255, 90, 35, 0)");
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = ringOnly ? 2.4 : 1.6;
    ctx.shadowBlur = ringOnly ? 10 : 4;
    ctx.shadowColor = glowColor;
    ctx.beginPath();
    ctx.arc(x, y, ringOnly ? radius * 0.72 : radius * 0.94, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (label) {
      ctx.save();
      ctx.font = "600 11px JetBrains Mono";
      const text = `${zone.side} ${zone.zone} ${round(coldScore * 100, 0)}%`;
      const pad = 6;
      const textW = ctx.measureText(text).width;
      const bx = clamp(x - textW * 0.5 - pad, 4, width - textW - pad * 2 - 4);
      const by = clamp(y - radius - 24, 4, height - 22);
      ctx.fillStyle = "rgba(12, 26, 35, 0.74)";
      ctx.strokeStyle = "rgba(173, 226, 245, 0.45)";
      roundRect(ctx, bx, by, textW + pad * 2, 18, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fef3c7";
      ctx.fillText(text, bx + pad, by + 12.5);
      ctx.restore();
    }
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

  extractPoseModel(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length <= POSE_IDX.rightAnkle) {
      return null;
    }

    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;
    const point = (idx) => {
      const value = landmarks[idx];
      if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
        return null;
      }
      return {
        x: value.x * width,
        y: value.y * height
      };
    };

    const pose = {
      leftShoulder: point(POSE_IDX.leftShoulder),
      rightShoulder: point(POSE_IDX.rightShoulder),
      leftElbow: point(POSE_IDX.leftElbow),
      rightElbow: point(POSE_IDX.rightElbow),
      leftWrist: point(POSE_IDX.leftWrist),
      rightWrist: point(POSE_IDX.rightWrist),
      leftHip: point(POSE_IDX.leftHip),
      rightHip: point(POSE_IDX.rightHip),
      leftKnee: point(POSE_IDX.leftKnee),
      rightKnee: point(POSE_IDX.rightKnee),
      leftAnkle: point(POSE_IDX.leftAnkle),
      rightAnkle: point(POSE_IDX.rightAnkle)
    };

    if (!pose.leftShoulder || !pose.rightShoulder || !pose.leftHip || !pose.rightHip) {
      return null;
    }
    return pose;
  }

  drawBodySilhouette(ctx, pose, { fillStyle = null, outlineStyle = null, outlineWidth = 2 } = {}) {
    const shoulderCenter = midpoint(pose.leftShoulder, pose.rightShoulder);
    const hipCenter = midpoint(pose.leftHip, pose.rightHip);
    const torsoCenter = midpoint(shoulderCenter, hipCenter);
    const shoulderSpan = distance(pose.leftShoulder, pose.rightShoulder);
    const hipSpan = distance(pose.leftHip, pose.rightHip);
    const armWidth = clamp(shoulderSpan * 0.34, 18, 54);
    const legWidth = clamp(Math.max(hipSpan * 0.33, armWidth * 0.74), 14, 46);
    const headRadius = clamp(shoulderSpan * 0.3, 16, 46);
    const headCenter = {
      x: shoulderCenter.x,
      y: shoulderCenter.y - headRadius * 1.25
    };

    const leftShoulder = inflateFromCenter(pose.leftShoulder, torsoCenter, 1.18, 1.1);
    const rightShoulder = inflateFromCenter(pose.rightShoulder, torsoCenter, 1.18, 1.1);
    const leftHip = inflateFromCenter(pose.leftHip, torsoCenter, 1.14, 1.08);
    const rightHip = inflateFromCenter(pose.rightHip, torsoCenter, 1.14, 1.08);

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

      drawLimbStroke(ctx, [pose.leftShoulder, pose.leftElbow, pose.leftWrist], armWidth, fillStyle);
      drawLimbStroke(ctx, [pose.rightShoulder, pose.rightElbow, pose.rightWrist], armWidth, fillStyle);
      drawLimbStroke(ctx, [pose.leftHip, pose.leftKnee, pose.leftAnkle], legWidth, fillStyle);
      drawLimbStroke(ctx, [pose.rightHip, pose.rightKnee, pose.rightAnkle], legWidth, fillStyle);
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

      drawLimbOutline(ctx, [pose.leftShoulder, pose.leftElbow, pose.leftWrist], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [pose.rightShoulder, pose.rightElbow, pose.rightWrist], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [pose.leftHip, pose.leftKnee, pose.leftAnkle], outlineStyle, outlineWidth);
      drawLimbOutline(ctx, [pose.rightHip, pose.rightKnee, pose.rightAnkle], outlineStyle, outlineWidth);
    }

    ctx.restore();
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

    if (this.maskCanvas.width !== width || this.maskCanvas.height !== height) {
      this.maskCanvas.width = width;
      this.maskCanvas.height = height;
    }

    if (this.heatCanvas.width !== width || this.heatCanvas.height !== height) {
      this.heatCanvas.width = width;
      this.heatCanvas.height = height;
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
