import { EVENTS } from "../../core/events.js";
import { clamp, round } from "../../core/utils.js";

const CONNECTIONS = [
  [11, 13], [13, 15],
  [12, 14], [14, 16],
  [11, 12], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27],
  [24, 26], [26, 28]
];

const ZONE_TO_POINTS = {
  shoulder: {
    left: [11, 13, 15],
    right: [12, 14, 16]
  },
  hip: {
    left: [23, 25, 27],
    right: [24, 26, 28]
  },
  knee: {
    left: [25, 27],
    right: [26, 28]
  }
};

export class NeuralHandshakeEngine {
  constructor({ eventBus, overlayCanvasEl, getPoseLandmarks }) {
    this.eventBus = eventBus;
    this.overlayCanvas = overlayCanvasEl;
    this.overlayCtx = this.overlayCanvas.getContext("2d");
    this.getPoseLandmarks = getPoseLandmarks;

    this.mode = "idle";
    this.recording = false;
    this.playing = false;

    this.recordStartMs = 0;
    this.recordWindowMs = 10_000;
    this.recordFrames = [];
    this.playFrameIndex = 0;

    this.target = {
      zone: "shoulder",
      injuredSide: "left",
      healthySide: "right"
    };

    this.renderLoop = null;

    this.tick = this.tick.bind(this);
  }

  setTarget({ zone, injuredSide }) {
    const safeZone = ["shoulder", "hip", "knee"].includes(zone) ? zone : "shoulder";
    const safeInjured = injuredSide === "right" ? "right" : "left";

    this.target = {
      zone: safeZone,
      injuredSide: safeInjured,
      healthySide: safeInjured === "left" ? "right" : "left"
    };

    this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_STATUS, {
      status: this.mode,
      target: this.target
    });
  }

  startRecording(durationSec = 10) {
    this.recording = true;
    this.playing = false;
    this.mode = "recording";
    this.recordWindowMs = clamp(Number(durationSec) * 1000 || 10_000, 4_000, 20_000);
    this.recordStartMs = performance.now();
    this.recordFrames = [];

    this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_STATUS, {
      status: "recording",
      target: this.target,
      durationSec: round(this.recordWindowMs / 1000, 1)
    });

    this.ensureRenderLoop();
  }

  stop() {
    this.recording = false;
    this.playing = false;
    this.mode = "idle";
    this.playFrameIndex = 0;
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    if (this.renderLoop) {
      cancelAnimationFrame(this.renderLoop);
      this.renderLoop = null;
    }

    this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_STATUS, {
      status: "idle",
      target: this.target
    });
  }

  startPlayback() {
    if (!this.recordFrames.length) {
      throw new Error("No recorded movement found. Record healthy-side movement first.");
    }

    this.recording = false;
    this.playing = true;
    this.mode = "playing";
    this.playFrameIndex = 0;

    this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_STATUS, {
      status: "playing",
      target: this.target,
      frameCount: this.recordFrames.length
    });

    this.ensureRenderLoop();
  }

  ensureRenderLoop() {
    if (!this.renderLoop) {
      this.renderLoop = requestAnimationFrame(this.tick);
    }
  }

  tick() {
    this.renderLoop = requestAnimationFrame(this.tick);

    const pose = this.getPoseLandmarks();
    if (!pose?.length) {
      this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      return;
    }

    if (this.recording) {
      this.captureFrame(pose);
      const elapsed = performance.now() - this.recordStartMs;
      const progress = clamp(elapsed / this.recordWindowMs, 0, 1);

      this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_PROGRESS, {
        phase: "recording",
        progress,
        target: this.target
      });

      if (elapsed >= this.recordWindowMs) {
        this.recording = false;
        this.startPlayback();
      }
    }

    if (this.playing) {
      this.renderGhostOverlay(pose);
    }
  }

  captureFrame(poseLandmarks) {
    const selected = this.extractSidePoints(poseLandmarks, this.target.zone, this.target.healthySide);
    if (!selected.length) {
      return;
    }

    const frame = selected.map((item) => ({
      index: item.index,
      x: item.landmark.x,
      y: item.landmark.y,
      z: item.landmark.z || 0,
      visibility: item.landmark.visibility ?? 1
    }));

    this.recordFrames.push(frame);

    if (this.recordFrames.length > 420) {
      this.recordFrames.shift();
    }
  }

  renderGhostOverlay(currentPose) {
    const ctx = this.overlayCtx;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!this.recordFrames.length) {
      return;
    }

    const frame = this.recordFrames[this.playFrameIndex % this.recordFrames.length];
    this.playFrameIndex += 1;

    const mirrored = frame.map((point) => ({
      index: mirrorIndex(point.index),
      x: 1 - point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility
    }));

    const anchorCurrent = this.getAnchor(currentPose, this.target.zone, this.target.injuredSide);
    const anchorGhost = this.getAnchorFromPoints(mirrored, this.target.zone, this.target.injuredSide);

    const dx = anchorCurrent.x - anchorGhost.x;
    const dy = anchorCurrent.y - anchorGhost.y;

    const transformed = mirrored.map((point) => ({
      ...point,
      x: clamp(point.x + dx * 0.86, 0, 1),
      y: clamp(point.y + dy * 0.86, 0, 1)
    }));

    this.drawGhost(transformed, width, height);

    this.eventBus.emit(EVENTS.NEURAL_HANDSHAKE_PROGRESS, {
      phase: "playing",
      progress: (this.playFrameIndex % this.recordFrames.length) / this.recordFrames.length,
      target: this.target,
      frame: this.playFrameIndex
    });
  }

  drawGhost(points, width, height) {
    const ctx = this.overlayCtx;

    ctx.save();
    ctx.globalCompositeOperation = "screen";

    ctx.shadowColor = "rgba(120,238,255,0.85)";
    ctx.shadowBlur = 22;

    ctx.strokeStyle = "rgba(120,238,255,0.8)";
    ctx.lineWidth = 3;

    for (const [a, b] of CONNECTIONS) {
      const p1 = points.find((point) => point.index === a);
      const p2 = points.find((point) => point.index === b);
      if (!p1 || !p2) {
        continue;
      }

      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(180,247,255,0.95)";
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x * width, point.y * height, 3.1, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  extractSidePoints(poseLandmarks, zone, side) {
    const indexes = ZONE_TO_POINTS[zone]?.[side] || [];

    const expanded = new Set(indexes);
    expanded.add(11);
    expanded.add(12);
    expanded.add(23);
    expanded.add(24);

    const points = [];
    for (const idx of expanded) {
      const landmark = poseLandmarks[idx];
      if (!landmark) {
        continue;
      }
      points.push({ index: idx, landmark });
    }

    return points;
  }

  getAnchor(poseLandmarks, zone, side) {
    const points = this.extractSidePoints(poseLandmarks, zone, side);
    return this.getAnchorFromPoints(points.map((item) => ({ ...item.landmark, index: item.index })), zone, side);
  }

  getAnchorFromPoints(points, zone, side) {
    const indexes = ZONE_TO_POINTS[zone]?.[side] || [];
    let x = 0;
    let y = 0;
    let n = 0;

    for (const idx of indexes) {
      const point = points.find((candidate) => candidate.index === idx);
      if (!point) {
        continue;
      }
      x += point.x;
      y += point.y;
      n += 1;
    }

    if (!n) {
      return { x: 0.5, y: 0.5 };
    }

    return { x: x / n, y: y / n };
  }
}

function mirrorIndex(index) {
  const pairs = {
    11: 12, 12: 11,
    13: 14, 14: 13,
    15: 16, 16: 15,
    23: 24, 24: 23,
    25: 26, 26: 25,
    27: 28, 28: 27
  };

  return pairs[index] ?? index;
}
