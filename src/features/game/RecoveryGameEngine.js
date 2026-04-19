import { clamp } from "../../core/utils.js";
import {
  buildPoseFromLandmarks,
  drawAnatomyFigure,
  drawZoneHighlight
} from "../visual/AnatomyFigureRenderer.js";

const BODY_SILHOUETTE_URL = "/src/assets/anatomy-silhouette.svg";

function getSideIndexes(side) {
  return side === "right"
    ? { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
    : { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
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

function createShoulderActions(side) {
  const i = getSideIndexes(side);
  return [
    {
      id: "raise",
      label: "Sky Reach",
      description: "Lift wrist above shoulder and return with control.",
      repsTarget: 8,
      sample(landmarks) {
        const shoulder = landmarks[i.shoulder];
        const wrist = landmarks[i.wrist];
        if (!shoulder || !wrist) {
          return null;
        }
        const delta = shoulder.y - wrist.y;
        return {
          up: delta > 0.04,
          down: delta < -0.015,
          amplitude: Math.abs(delta)
        };
      }
    },
    {
      id: "cross",
      label: "Cross Reach",
      description: "Reach across midline and return.",
      repsTarget: 6,
      sample(landmarks) {
        const shoulder = landmarks[i.shoulder];
        const wrist = landmarks[i.wrist];
        const oppositeShoulder = landmarks[side === "right" ? 11 : 12];
        if (!shoulder || !wrist || !oppositeShoulder) {
          return null;
        }
        const midline = (shoulder.x + oppositeShoulder.x) / 2;
        const crossed = side === "right" ? wrist.x < midline : wrist.x > midline;
        const neutral = side === "right" ? wrist.x > shoulder.x - 0.02 : wrist.x < shoulder.x + 0.02;
        const amplitude = Math.abs(wrist.x - midline);
        return {
          up: crossed,
          down: neutral,
          amplitude
        };
      }
    },
    {
      id: "elbow-drive",
      label: "Elbow Drive",
      description: "Drive elbow back, then release to neutral.",
      repsTarget: 8,
      sample(landmarks) {
        const shoulder = landmarks[i.shoulder];
        const elbow = landmarks[i.elbow];
        if (!shoulder || !elbow) {
          return null;
        }
        const drive = side === "right" ? (elbow.x - shoulder.x) > 0.07 : (shoulder.x - elbow.x) > 0.07;
        const neutral = Math.abs(elbow.x - shoulder.x) < 0.04;
        const amplitude = Math.abs(elbow.x - shoulder.x);
        return {
          up: drive,
          down: neutral,
          amplitude
        };
      }
    }
  ];
}

function createHipActions(side) {
  const i = getSideIndexes(side);
  return [
    {
      id: "march",
      label: "Power March",
      description: "Lift knee above hip and return.",
      repsTarget: 10,
      sample(landmarks) {
        const hip = landmarks[i.hip];
        const knee = landmarks[i.knee];
        if (!hip || !knee) {
          return null;
        }
        const lift = hip.y - knee.y;
        return {
          up: lift > 0.03,
          down: lift < -0.01,
          amplitude: Math.abs(lift)
        };
      }
    },
    {
      id: "side-step",
      label: "Side Step",
      description: "Move ankle away from hip and return.",
      repsTarget: 8,
      sample(landmarks) {
        const hip = landmarks[i.hip];
        const ankle = landmarks[i.ankle];
        if (!hip || !ankle) {
          return null;
        }
        const lateral = Math.abs(ankle.x - hip.x);
        return {
          up: lateral > 0.13,
          down: lateral < 0.08,
          amplitude: lateral
        };
      }
    },
    {
      id: "hinge",
      label: "Hip Hinge",
      description: "Small hinge and return tall posture.",
      repsTarget: 8,
      sample(landmarks) {
        const shoulder = landmarks[i.shoulder];
        const hip = landmarks[i.hip];
        if (!shoulder || !hip) {
          return null;
        }
        const forward = Math.abs(shoulder.x - hip.x);
        return {
          up: forward > 0.1,
          down: forward < 0.06,
          amplitude: forward
        };
      }
    }
  ];
}

function createKneeActions(side) {
  const i = getSideIndexes(side);
  return [
    {
      id: "mini-squat",
      label: "Mini Squat",
      description: "Lower into mini squat and stand tall.",
      repsTarget: 8,
      sample(landmarks) {
        const hip = landmarks[i.hip];
        const knee = landmarks[i.knee];
        const ankle = landmarks[i.ankle];
        const angle = angleDeg(hip, knee, ankle);
        if (!Number.isFinite(angle)) {
          return null;
        }
        return {
          up: angle < 125,
          down: angle > 155,
          amplitude: clamp((170 - angle) / 60, 0, 1)
        };
      }
    },
    {
      id: "step-lift",
      label: "Step Lift",
      description: "Lift ankle, then place down softly.",
      repsTarget: 10,
      sample(landmarks) {
        const ankle = landmarks[i.ankle];
        const oppositeAnkle = landmarks[side === "right" ? 27 : 28];
        if (!ankle || !oppositeAnkle) {
          return null;
        }
        const lift = oppositeAnkle.y - ankle.y;
        return {
          up: lift > 0.035,
          down: lift < 0.01,
          amplitude: Math.abs(lift)
        };
      }
    },
    {
      id: "extension",
      label: "Knee Extension",
      description: "Extend leg forward, then return.",
      repsTarget: 8,
      sample(landmarks) {
        const knee = landmarks[i.knee];
        const ankle = landmarks[i.ankle];
        if (!knee || !ankle) {
          return null;
        }
        const extension = Math.abs(ankle.x - knee.x);
        return {
          up: extension > 0.12,
          down: extension < 0.07,
          amplitude: extension
        };
      }
    }
  ];
}

function actionsForZone(zone, side) {
  if (zone === "hip") {
    return createHipActions(side);
  }
  if (zone === "knee") {
    return createKneeActions(side);
  }
  return createShoulderActions(side);
}

function amplitudeTarget(actionId) {
  const map = {
    raise: 0.2,
    cross: 0.16,
    "elbow-drive": 0.12,
    march: 0.17,
    "side-step": 0.16,
    hinge: 0.12,
    "mini-squat": 0.9,
    "step-lift": 0.1,
    extension: 0.14
  };
  return map[actionId] || 0.15;
}

function cloneLandmarks(landmarks) {
  return landmarks.map((point) => (point ? { ...point } : point));
}

function poseToPoints(pose) {
  if (!pose) {
    return [];
  }
  return [
    pose.leftShoulder,
    pose.rightShoulder,
    pose.leftElbow,
    pose.rightElbow,
    pose.leftWrist,
    pose.rightWrist,
    pose.leftHip,
    pose.rightHip,
    pose.leftKnee,
    pose.rightKnee,
    pose.leftAnkle,
    pose.rightAnkle
  ].filter(Boolean);
}

export class RecoveryGameEngine {
  constructor({
    getPoseLandmarks,
    getBiometrics = null,
    overlayCanvasEl,
    motionAdapter = null,
    useMirrorMotion = true,
    onStatus,
    onProgress,
    onActionChanged,
    onComplete
  }) {
    this.getPoseLandmarks = getPoseLandmarks;
    this.getBiometrics = getBiometrics;
    this.overlayCanvas = overlayCanvasEl;
    this.overlayCtx = this.overlayCanvas.getContext("2d");
    this.motionAdapter = motionAdapter;
    this.useMirrorMotion = !!useMirrorMotion;

    this.onStatus = onStatus;
    this.onProgress = onProgress;
    this.onActionChanged = onActionChanged;
    this.onComplete = onComplete;

    this.running = false;
    this.rafId = null;

    this.zone = "shoulder";
    this.side = "left";
    this.actions = [];
    this.currentActionIndex = 0;
    this.currentRepCount = 0;
    this.upSeen = false;
    this.progressScore = 0;
    this.amplitudes = [];
    this.completedActions = [];
    this.startedAt = 0;
    this.motionSyncSamples = [];
    this.movementMatchSamples = [];
    this.vitalsScoreSamples = [];
    this.latestMotionSample = null;
    this.latestLandmarks = null;
    this.previewAction = null;

    this.silhouetteImage = new Image();
    this.silhouetteReady = false;
    this.silhouetteImage.onload = () => {
      this.silhouetteReady = true;
    };
    this.silhouetteImage.onerror = () => {
      this.silhouetteReady = false;
    };
    this.silhouetteImage.src = BODY_SILHOUETTE_URL;
  }

  start({ zone = "shoulder", side = "left" } = {}) {
    this.zone = zone;
    this.side = side;
    this.actions = actionsForZone(zone, side);
    this.currentActionIndex = 0;
    this.currentRepCount = 0;
    this.upSeen = false;
    this.progressScore = 0;
    this.amplitudes = [];
    this.completedActions = [];
    this.motionSyncSamples = [];
    this.movementMatchSamples = [];
    this.vitalsScoreSamples = [];
    this.latestMotionSample = null;
    this.latestLandmarks = null;
    this.previewAction = this.actions[0] || null;
    this.startedAt = performance.now();
    this.running = true;
    this.motionAdapter?.reset?.();

    this.onStatus?.({ status: "running", zone, side });
    this.emitActionChanged();
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.latestMotionSample = null;
    this.latestLandmarks = null;
    this.motionAdapter?.reset?.();
    this.clearOverlay();
    this.onStatus?.({ status: "stopped" });
  }

  getSummary() {
    const durationSec = Math.max((performance.now() - this.startedAt) / 1000, 0);
    const amplitudeAvg = this.amplitudes.length
      ? this.amplitudes.reduce((sum, value) => sum + value, 0) / this.amplitudes.length
      : 0;
    const romGainEstimate = Math.round(clamp(amplitudeAvg * 100, 0, 25));
    const motionSyncAvg = this.motionSyncSamples.length
      ? this.motionSyncSamples.reduce((sum, value) => sum + value, 0) / this.motionSyncSamples.length
      : null;
    const movementMatchAvg = this.movementMatchSamples.length
      ? this.movementMatchSamples.reduce((sum, value) => sum + value, 0) / this.movementMatchSamples.length
      : null;
    const vitalScoreAvg = this.vitalsScoreSamples.length
      ? this.vitalsScoreSamples.reduce((sum, value) => sum + value, 0) / this.vitalsScoreSamples.length
      : null;

    return {
      zone: this.zone,
      side: this.side,
      durationSec,
      actionsCompleted: this.completedActions.length,
      actionsTotal: this.actions.length,
      score: Math.round(this.progressScore),
      romGainEstimate,
      motionSyncAvg: Number.isFinite(motionSyncAvg) ? Math.round(motionSyncAvg) : null,
      movementMatchAvg: Number.isFinite(movementMatchAvg) ? Math.round(movementMatchAvg) : null,
      vitalScoreAvg: Number.isFinite(vitalScoreAvg) ? Math.round(vitalScoreAvg) : null,
      completedActions: [...this.completedActions]
    };
  }

  resolveLandmarks(baseLandmarks, motionSample) {
    if (!Array.isArray(baseLandmarks)) {
      return null;
    }
    if (
      this.useMirrorMotion
      && this.zone === "shoulder"
      && this.side === "left"
      && motionSample?.available
      && Number.isFinite(motionSample.confidence)
      && motionSample.confidence >= 0.25
      && Array.isArray(motionSample.mirroredLandmarks)
    ) {
      return motionSample.mirroredLandmarks;
    }
    return baseLandmarks;
  }

  computeVitalsScore() {
    const biometrics = this.getBiometrics?.() || {};
    let score = 0;
    let count = 0;

    if (Number.isFinite(biometrics.heartRateBpm)) {
      const hr = biometrics.heartRateBpm;
      const hrQuality = clamp(1 - Math.abs(hr - 86) / 70, 0, 1);
      score += hrQuality;
      count += 1;
    }

    if (Number.isFinite(biometrics.rrIntervalMs)) {
      const rr = biometrics.rrIntervalMs;
      const rrQuality = clamp(1 - Math.abs(rr - 760) / 560, 0, 1);
      score += rrQuality;
      count += 1;
    }

    if (Number.isFinite(biometrics.microsaccadeHz)) {
      const micro = biometrics.microsaccadeHz;
      const microQuality = clamp(1 - Math.abs(micro - 1.3) / 1.8, 0, 1);
      score += microQuality;
      count += 1;
    }

    if (Number.isFinite(biometrics.readinessScore)) {
      score += clamp(biometrics.readinessScore / 10, 0, 1);
      count += 1;
    }

    return count ? score / count : 0.5;
  }

  computeMovementMatch(action, sample, motionSample) {
    if (!sample || !action) {
      return 0;
    }

    const amplitudeScore = Number.isFinite(sample.amplitude)
      ? clamp(sample.amplitude / amplitudeTarget(action.id), 0, 1)
      : 0.45;

    const directionScore = sample.up || sample.down ? 0.9 : 0.4;
    let match = amplitudeScore * 0.7 + directionScore * 0.3;

    if (Number.isFinite(motionSample?.syncScore)) {
      const sync = clamp(motionSample.syncScore / 100, 0, 1);
      match = match * 0.65 + sync * 0.35;
    }

    return clamp(match, 0, 1);
  }

  tick = () => {
    if (!this.running) {
      return;
    }

    const action = this.actions[this.currentActionIndex];
    const baseLandmarks = this.getPoseLandmarks?.();
    const motionSample = this.motionAdapter?.analyze?.(baseLandmarks, performance.now()) || null;
    this.latestMotionSample = motionSample?.available ? motionSample : null;
    if (this.latestMotionSample && Number.isFinite(this.latestMotionSample.syncScore)) {
      this.motionSyncSamples.push(this.latestMotionSample.syncScore);
    }

    const landmarks = this.resolveLandmarks(baseLandmarks, motionSample);
    this.latestLandmarks = Array.isArray(landmarks) ? landmarks : null;

    let sample = null;
    if (action && Array.isArray(landmarks) && landmarks.length > 28) {
      sample = action.sample(landmarks);
    }

    if (sample) {
      if (Number.isFinite(sample.amplitude)) {
        this.amplitudes.push(sample.amplitude);
      }

      if (sample.up) {
        this.upSeen = true;
      } else if (sample.down && this.upSeen) {
        this.currentRepCount += 1;
        this.upSeen = false;
      }

      if (this.currentRepCount >= action.repsTarget) {
        this.completedActions.push({
          id: action.id,
          label: action.label,
          reps: this.currentRepCount
        });

        this.currentActionIndex += 1;
        this.currentRepCount = 0;
        this.upSeen = false;

        if (this.currentActionIndex >= this.actions.length) {
          this.progressScore = 100;
          this.emitProgress(this.latestMotionSample, 1, this.computeVitalsScore());
          this.drawOverlay(sample, true, this.latestMotionSample);
          const summary = this.getSummary();
          this.onComplete?.(summary);
          this.stop();
          return;
        }

        this.emitActionChanged();
      }
    }

    const movementMatch = this.computeMovementMatch(action, sample, this.latestMotionSample);
    const vitalsScore = this.computeVitalsScore();
    this.movementMatchSamples.push(movementMatch * 100);
    this.vitalsScoreSamples.push(vitalsScore * 100);

    this.progressScore = this.computeProgressScore(movementMatch, vitalsScore);
    this.emitProgress(this.latestMotionSample, movementMatch, vitalsScore);
    this.drawOverlay(sample, false, this.latestMotionSample);

    this.rafId = requestAnimationFrame(this.tick);
  };

  computeProgressScore(movementMatch = 0, vitalsScore = 0.5) {
    const completedWeight = this.actions.length ? this.completedActions.length / this.actions.length : 0;
    const action = this.actions[this.currentActionIndex];
    const repWeight = action ? Math.min(this.currentRepCount / action.repsTarget, 1) * (1 / this.actions.length) : 0;
    const progression = clamp((completedWeight + repWeight) * 100, 0, 100);
    const quality = clamp((movementMatch * 0.75) + (vitalsScore * 0.25), 0, 1) * 12;
    return clamp(progression * 0.88 + quality, 0, 100);
  }

  emitActionChanged() {
    const action = this.actions[this.currentActionIndex];
    if (!action) {
      return;
    }
    this.previewAction = action;

    this.onActionChanged?.({
      index: this.currentActionIndex,
      total: this.actions.length,
      ...action,
      repsDone: this.currentRepCount
    });
  }

  emitProgress(motionSample, movementMatch = 0, vitalsScore = 0.5) {
    const action = this.actions[this.currentActionIndex];
    this.onProgress?.({
      score: this.progressScore,
      actionsCompleted: this.completedActions.length,
      actionsTotal: this.actions.length,
      actionId: action?.id || null,
      actionLabel: action?.label || null,
      repsDone: this.currentRepCount,
      repsTarget: action?.repsTarget || 0,
      motionSyncScore: Number.isFinite(motionSample?.syncScore) ? motionSample.syncScore : null,
      motionUpperArmRad: Number.isFinite(motionSample?.upperArmRad) ? motionSample.upperArmRad : null,
      motionForearmRad: Number.isFinite(motionSample?.forearmRad) ? motionSample.forearmRad : null,
      movementMatchScore: clamp(movementMatch, 0, 1) * 100,
      vitalsScore: clamp(vitalsScore, 0, 1) * 100
    });
  }

  buildTargetLandmarks(sourceLandmarks, action, phase) {
    if (!Array.isArray(sourceLandmarks) || !action) {
      return null;
    }

    const target = cloneLandmarks(sourceLandmarks);
    const i = getSideIndexes(this.side);
    const sign = this.side === "right" ? 1 : -1;

    const shoulder = target[i.shoulder];
    const elbow = target[i.elbow];
    const wrist = target[i.wrist];
    const hip = target[i.hip];
    const knee = target[i.knee];
    const ankle = target[i.ankle];

    if (action.id === "raise" && shoulder && wrist) {
      wrist.y = shoulder.y - (0.02 + phase * 0.22);
    } else if (action.id === "cross" && shoulder && wrist) {
      wrist.x = shoulder.x - sign * (0.03 + phase * 0.2);
    } else if (action.id === "elbow-drive" && shoulder && elbow) {
      elbow.x = shoulder.x + sign * (0.03 + phase * 0.16);
    } else if (action.id === "march" && hip && knee && ankle) {
      knee.y = hip.y - (0.02 + phase * 0.16);
      ankle.y = knee.y + 0.13;
    } else if (action.id === "side-step" && hip && ankle) {
      ankle.x = hip.x + sign * (0.07 + phase * 0.18);
    } else if (action.id === "hinge" && shoulder && hip) {
      shoulder.x = hip.x + sign * (0.02 + phase * 0.1);
    } else if (action.id === "mini-squat" && hip && knee && ankle) {
      hip.y += 0.03 + phase * 0.08;
      knee.y += 0.02 + phase * 0.06;
      ankle.y += 0.01 + phase * 0.02;
    } else if (action.id === "step-lift" && ankle) {
      ankle.y -= 0.03 + phase * 0.14;
    } else if (action.id === "extension" && knee && ankle) {
      ankle.x = knee.x + sign * (0.03 + phase * 0.2);
    }

    return target;
  }

  drawPoseFigure(ctx, pose, {
    alpha = 1,
    tint = null,
    fallbackFill = "rgba(196, 198, 203, 0.86)",
    fallbackStroke = "rgba(244, 247, 250, 0.46)",
    fallbackDetail = "rgba(246, 248, 250, 0.38)",
    glow = null
  } = {}) {
    if (!pose) {
      return;
    }

    if (!this.silhouetteReady || !this.silhouetteImage?.naturalWidth) {
      drawAnatomyFigure(ctx, pose, {
        alpha,
        bodyFill: fallbackFill,
        bodyStroke: fallbackStroke,
        detailStroke: fallbackDetail,
        shadowColor: glow || null,
        shadowBlur: glow ? 8 : 0
      });
      return;
    }

    const points = poseToPoints(pose);
    if (!points.length) {
      return;
    }

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const spanY = Math.max(maxY - minY, 80);
    const drawH = spanY * 1.22;
    const drawW = drawH * 0.42;
    const x = centerX - drawW * 0.5;
    const y = centerY - drawH * 0.52;

    ctx.save();
    ctx.globalAlpha = alpha;
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 10;
    }
    ctx.drawImage(this.silhouetteImage, x, y, drawW, drawH);
    if (tint) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = tint;
      ctx.fillRect(x, y, drawW, drawH);
    }
    ctx.restore();
  }

  drawActionPreview(ctx, action, phase, width, height) {
    const panelWidth = 208;
    const panelHeight = 176;
    const x = 14;
    const y = height - panelHeight - 52;

    ctx.save();
    ctx.fillStyle = "rgba(6, 19, 29, 0.76)";
    ctx.strokeStyle = "rgba(159, 214, 236, 0.5)";
    ctx.lineWidth = 1.3;
    roundRect(ctx, x, y, panelWidth, panelHeight, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#dbf3ff";
    ctx.font = "600 12px Sora";
    ctx.fillText("Movement Preview", x + 10, y + 17);
    ctx.font = "500 11px JetBrains Mono";
    ctx.fillStyle = "rgba(201, 233, 246, 0.9)";
    ctx.fillText("Match this action rhythm", x + 10, y + 33);

    const figX = x + 56;
    const figY = y + 36;
    const figW = 95;
    const figH = 124;
    if (this.silhouetteReady && this.silhouetteImage?.naturalWidth) {
      ctx.globalAlpha = 0.8;
      ctx.drawImage(this.silhouetteImage, figX, figY, figW, figH);
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(196, 209, 217, 0.58)";
      ctx.fillRect(figX, figY, figW, figH);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(170, 174, 180, 0.8)";
      ctx.fillRect(figX + 34, figY + 8, 28, 96);
      ctx.beginPath();
      ctx.arc(figX + 48, figY + 16, 14, 0, Math.PI * 2);
      ctx.fill();
    }

    this.drawPreviewMotionPath(ctx, action, phase, figX, figY, figW, figH);
    ctx.restore();
  }

  drawPreviewMotionPath(ctx, action, phase, figX, figY, figW, figH) {
    if (!action) {
      return;
    }

    const cx = figX + figW * 0.5;
    const leftShoulder = { x: figX + figW * 0.37, y: figY + figH * 0.27 };
    const rightShoulder = { x: figX + figW * 0.63, y: figY + figH * 0.27 };
    const leftHip = { x: figX + figW * 0.43, y: figY + figH * 0.53 };
    const rightHip = { x: figX + figW * 0.57, y: figY + figH * 0.53 };
    const leftKnee = { x: figX + figW * 0.43, y: figY + figH * 0.74 };
    const rightKnee = { x: figX + figW * 0.57, y: figY + figH * 0.74 };

    const swing = (Math.sin(phase * Math.PI * 2) + 1) * 0.5;
    const accent = "rgba(88, 226, 255, 0.95)";
    const trail = "rgba(119, 197, 226, 0.45)";

    ctx.strokeStyle = trail;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 4]);

    if (action.id === "raise") {
      const from = { x: rightShoulder.x, y: rightShoulder.y + 40 };
      const to = { x: rightShoulder.x, y: rightShoulder.y - 18 };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y - (from.y - to.y) * swing);
      ctx.lineTo(from.x, from.y - (from.y - to.y) * swing - 22);
      ctx.stroke();
    } else if (action.id === "cross" || action.id === "elbow-drive") {
      const y = rightShoulder.y + 24;
      const fromX = rightShoulder.x + 30;
      const toX = cx - 22;
      ctx.beginPath();
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      const px = fromX - (fromX - toX) * swing;
      ctx.beginPath();
      ctx.moveTo(px, y - 8);
      ctx.lineTo(px, y + 8);
      ctx.stroke();
    } else if (action.id === "march" || action.id === "step-lift") {
      const from = { x: rightHip.x + 5, y: rightKnee.y + 30 };
      const to = { x: rightHip.x + 5, y: rightHip.y + 8 };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      const py = from.y - (from.y - to.y) * swing;
      ctx.beginPath();
      ctx.moveTo(from.x - 8, py);
      ctx.lineTo(from.x + 8, py);
      ctx.stroke();
    } else if (action.id === "side-step" || action.id === "extension") {
      const y = rightKnee.y + 24;
      const fromX = rightHip.x;
      const toX = rightHip.x + 34;
      ctx.beginPath();
      ctx.moveTo(fromX, y);
      ctx.lineTo(toX, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      const px = fromX + (toX - fromX) * swing;
      ctx.beginPath();
      ctx.moveTo(px, y - 8);
      ctx.lineTo(px, y + 8);
      ctx.stroke();
    } else {
      const topY = leftHip.y - 8;
      const bottomY = rightKnee.y + 18;
      ctx.beginPath();
      ctx.moveTo(cx - 18, topY);
      ctx.lineTo(cx - 18, bottomY);
      ctx.moveTo(cx + 18, topY);
      ctx.lineTo(cx + 18, bottomY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      const py = topY + (bottomY - topY) * swing;
      ctx.beginPath();
      ctx.moveTo(cx - 24, py);
      ctx.lineTo(cx + 24, py);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  drawOverlay(sample, finished, motionSample) {
    const ctx = this.overlayCtx;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(6, 16, 24, 0.34)";
    ctx.fillRect(0, 0, width, height);

    const action = this.actions[this.currentActionIndex];
    const phase = (Math.sin((performance.now() - this.startedAt) / 450) + 1) * 0.5;

    if (this.latestLandmarks && action && !finished) {
      const targetLandmarks = this.buildTargetLandmarks(this.latestLandmarks, action, phase);
      const targetPose = targetLandmarks
        ? buildPoseFromLandmarks(targetLandmarks, width, height)
        : null;
      const livePose = buildPoseFromLandmarks(this.latestLandmarks, width, height);

      if (targetPose) {
        this.drawPoseFigure(ctx, targetPose, {
          alpha: 0.5,
          tint: "rgba(79, 218, 255, 0.82)",
          fallbackFill: "rgba(85, 214, 255, 0.55)",
          fallbackStroke: "rgba(166, 241, 255, 0.78)",
          fallbackDetail: "rgba(219, 250, 255, 0.58)",
          glow: "rgba(80, 214, 255, 0.72)"
        });
        drawZoneHighlight(ctx, targetPose, this.zone, this.side, 14, {
          showLabel: false,
          baseRadius: 14
        });
      }

      if (livePose) {
        this.drawPoseFigure(ctx, livePose, {
          alpha: 0.83,
          tint: "rgba(248, 183, 102, 0.86)",
          fallbackFill: "rgba(248, 183, 102, 0.72)",
          fallbackStroke: "rgba(255, 226, 182, 0.78)",
          fallbackDetail: "rgba(255, 239, 212, 0.54)",
          glow: "rgba(245, 169, 65, 0.56)"
        });
        drawZoneHighlight(ctx, livePose, this.zone, this.side, 11, {
          showLabel: false,
          baseRadius: 12
        });
      }
    }

    ctx.fillStyle = "rgba(7, 22, 33, 0.72)";
    ctx.fillRect(0, 0, width, 106);

    ctx.fillStyle = "#e9f8ff";
    ctx.font = "600 21px Sora";
    ctx.fillText(
      finished ? "Recovery Sequence Complete" : `Action ${this.currentActionIndex + 1}: ${action?.label || "--"}`,
      16,
      32
    );

    ctx.font = "500 13px JetBrains Mono";
    const repText = finished
      ? `Score ${Math.round(this.progressScore)}%`
      : `${this.currentRepCount}/${action?.repsTarget || 0} reps | ${Math.round(this.progressScore)}% progress`;
    ctx.fillText(repText, 16, 54);

    const matchText = this.movementMatchSamples.length
      ? `Match ${Math.round(this.movementMatchSamples.at(-1) || 0)}%`
      : "Match --";
    const vitalsText = this.vitalsScoreSamples.length
      ? `Vitals ${Math.round(this.vitalsScoreSamples.at(-1) || 0)}%`
      : "Vitals --";
    const motionText = Number.isFinite(motionSample?.syncScore)
      ? `Motion Sync ${Math.round(motionSample.syncScore)}%`
      : "Motion Sync --";
    ctx.fillStyle = "rgba(165, 226, 252, 0.95)";
    ctx.fillText(`${matchText} | ${vitalsText} | ${motionText}`, 16, 76);
    ctx.fillStyle = "rgba(210, 239, 252, 0.85)";
    ctx.fillText("Follow the preview in bottom-left to match each rep clearly.", 16, 96);

    this.drawActionPreview(ctx, this.previewAction || action, phase, width, height);

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.fillRect(16, height - 34, width - 32, 12);
    ctx.fillStyle = "rgba(62,226,176,0.9)";
    ctx.fillRect(16, height - 34, (width - 32) * (this.progressScore / 100), 12);

    for (let i = 0; i < 5; i += 1) {
      const x = width - 26 - i * 22;
      const y = 28;
      const lit = this.progressScore >= ((i + 1) / 5) * 100;
      ctx.fillStyle = lit ? "rgba(255,209,102,0.95)" : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!sample) {
      ctx.fillStyle = "rgba(255,255,255,0.84)";
      ctx.font = "500 14px Sora";
      ctx.fillText("Hold full body in frame for anatomy-tracked exercise.", 16, 122);
    }
  }

  clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }
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
