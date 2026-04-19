import { clamp } from "../../core/utils.js";

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

export class RecoveryGameEngine {
  constructor({ getPoseLandmarks, overlayCanvasEl, onStatus, onProgress, onActionChanged, onComplete }) {
    this.getPoseLandmarks = getPoseLandmarks;
    this.overlayCanvas = overlayCanvasEl;
    this.overlayCtx = this.overlayCanvas.getContext("2d");

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
    this.startedAt = performance.now();
    this.running = true;

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
    this.clearOverlay();
    this.onStatus?.({ status: "stopped" });
  }

  getSummary() {
    const durationSec = Math.max((performance.now() - this.startedAt) / 1000, 0);
    const amplitudeAvg = this.amplitudes.length
      ? this.amplitudes.reduce((sum, value) => sum + value, 0) / this.amplitudes.length
      : 0;
    const romGainEstimate = Math.round(clamp(amplitudeAvg * 100, 0, 25));

    return {
      zone: this.zone,
      side: this.side,
      durationSec,
      actionsCompleted: this.completedActions.length,
      actionsTotal: this.actions.length,
      score: Math.round(this.progressScore),
      romGainEstimate,
      completedActions: [...this.completedActions]
    };
  }

  tick = () => {
    if (!this.running) {
      return;
    }

    const action = this.actions[this.currentActionIndex];
    const landmarks = this.getPoseLandmarks?.();
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
          this.emitProgress();
          this.drawOverlay(sample, true);
          const summary = this.getSummary();
          this.onComplete?.(summary);
          this.stop();
          return;
        }

        this.emitActionChanged();
      }
    }

    this.progressScore = this.computeProgressScore();
    this.emitProgress();
    this.drawOverlay(sample, false);

    this.rafId = requestAnimationFrame(this.tick);
  };

  computeProgressScore() {
    const completedWeight = this.actions.length ? this.completedActions.length / this.actions.length : 0;
    const action = this.actions[this.currentActionIndex];
    const repWeight = action ? Math.min(this.currentRepCount / action.repsTarget, 1) * (1 / this.actions.length) : 0;
    return clamp((completedWeight + repWeight) * 100, 0, 100);
  }

  emitActionChanged() {
    const action = this.actions[this.currentActionIndex];
    if (!action) {
      return;
    }

    this.onActionChanged?.({
      index: this.currentActionIndex,
      total: this.actions.length,
      ...action,
      repsDone: this.currentRepCount
    });
  }

  emitProgress() {
    const action = this.actions[this.currentActionIndex];
    this.onProgress?.({
      score: this.progressScore,
      actionsCompleted: this.completedActions.length,
      actionsTotal: this.actions.length,
      actionId: action?.id || null,
      actionLabel: action?.label || null,
      repsDone: this.currentRepCount,
      repsTarget: action?.repsTarget || 0
    });
  }

  drawOverlay(sample, finished) {
    const ctx = this.overlayCtx;
    const width = this.overlayCanvas.width;
    const height = this.overlayCanvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(6,20,30,0.32)";
    ctx.fillRect(0, 0, width, 68);

    const action = this.actions[this.currentActionIndex];
    ctx.fillStyle = "#e3f3f7";
    ctx.font = "600 20px Sora";
    ctx.fillText(finished ? "Recovery Sequence Complete" : `Action ${this.currentActionIndex + 1}: ${action?.label || "--"}`, 16, 30);

    ctx.font = "500 13px JetBrains Mono";
    const repText = finished
      ? `Score ${Math.round(this.progressScore)}%`
      : `${this.currentRepCount}/${action?.repsTarget || 0} reps  |  ${Math.round(this.progressScore)}% progress`;
    ctx.fillText(repText, 16, 52);

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
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.font = "500 14px Sora";
      ctx.fillText("Hold full body in frame for pose tracking.", 16, 90);
    }
  }

  clearOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }
}
