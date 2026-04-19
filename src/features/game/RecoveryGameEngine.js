import { clamp } from "../../core/utils.js";
import {
  drawAnatomyFigure
} from "../visual/AnatomyFigureRenderer.js";
import { buildZoneActions, amplitudeTarget } from "./ExercisePlanner.js";

const BODY_SILHOUETTE_URL = "/src/assets/anatomy-silhouette.svg";
const MOVEMENT_PREVIEW_URLS = Object.freeze({
  raise: "/src/assets/movements/demos/raise.gif",
  cross: "/src/assets/movements/demos/cross.gif",
  "elbow-drive": "/src/assets/movements/demos/elbow-drive.gif",
  march: "/src/assets/movements/demos/march.gif",
  "side-step": "/src/assets/movements/demos/side-step.gif",
  hinge: "/src/assets/movements/demos/hinge.gif",
  "mini-squat": "/src/assets/movements/demos/mini-squat.gif",
  "step-lift": "/src/assets/movements/demos/step-lift.gif",
  extension: "/src/assets/movements/demos/extension.gif"
});

function getSideIndexes(side) {
  return side === "right"
    ? { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
    : { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
}

function getActionTrackingIndexes(actionId, side) {
  const i = getSideIndexes(side);
  const opposite = getSideIndexes(side === "right" ? "left" : "right");

  if (actionId === "raise" || actionId === "elbow-drive") {
    return [i.shoulder, i.elbow, i.wrist];
  }
  if (actionId === "cross") {
    return [i.shoulder, i.elbow, i.wrist, opposite.shoulder];
  }
  if (actionId === "march" || actionId === "side-step") {
    return [i.hip, i.knee, i.ankle];
  }
  if (actionId === "hinge") {
    return [i.shoulder, i.hip, opposite.shoulder, opposite.hip];
  }
  if (actionId === "mini-squat" || actionId === "extension") {
    return [i.hip, i.knee, i.ankle];
  }
  if (actionId === "step-lift") {
    return [i.hip, i.knee, i.ankle, opposite.ankle];
  }
  return [i.shoulder, i.elbow, i.wrist, i.hip, i.knee, i.ankle];
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
    getPlannerContext = null,
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
    this.getPlannerContext = getPlannerContext;
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
    this.targetTickMs = 1000 / 30;
    this.lastTickAt = 0;

    this.zone = "shoulder";
    this.side = "left";
    this.actions = [];
    this.currentActionIndex = 0;
    this.currentRepCount = 0;
    this.upSeen = false;
    this.repPeakMatch = 0;
    this.repPeakTracking = 0;
    this.stableUpFrames = 0;
    this.stableDownFrames = 0;
    this.lastRepCompletedAt = 0;
    this.smoothedMovementMatch = 0;
    this.smoothedTrackingConfidence = 0;
    this.progressScore = 0;
    this.amplitudes = [];
    this.completedActions = [];
    this.skippedActions = [];
    this.startedAt = 0;
    this.motionSyncSamples = [];
    this.movementMatchSamples = [];
    this.vitalsScoreSamples = [];
    this.actionTelemetry = [];
    this.latestMotionSample = null;
    this.latestLandmarks = null;
    this.previewAction = null;
    this.activeCurriculum = null;
    this.movementPreviewImages = {};

    this.silhouetteImage = new Image();
    this.silhouetteReady = false;
    this.silhouetteImage.onload = () => {
      this.silhouetteReady = true;
    };
    this.silhouetteImage.onerror = () => {
      this.silhouetteReady = false;
    };
    this.silhouetteImage.src = BODY_SILHOUETTE_URL;
    this.preloadMovementPreviewImages();
  }

  preloadMovementPreviewImages() {
    Object.entries(MOVEMENT_PREVIEW_URLS).forEach(([actionId, url]) => {
      const image = new Image();
      const item = {
        actionId,
        url,
        image,
        ready: false,
        failed: false
      };
      image.onload = () => {
        item.ready = true;
        item.failed = false;
      };
      image.onerror = () => {
        item.ready = false;
        item.failed = true;
      };
      image.src = url;
      this.movementPreviewImages[actionId] = item;
    });
  }

  getMovementPreviewImage(actionId) {
    if (!actionId) {
      return null;
    }
    return this.movementPreviewImages[actionId] || null;
  }

  start({ zone = "shoulder", side = "left" } = {}) {
    this.zone = zone;
    this.side = side;
    const plannerContext = {
      ...(this.getBiometrics?.() || {}),
      ...(this.getPlannerContext?.() || {})
    };
    this.activeCurriculum = buildZoneActions(zone, side, plannerContext);
    this.actions = this.activeCurriculum.actions;
    this.currentActionIndex = 0;
    this.currentRepCount = 0;
    this.upSeen = false;
    this.repPeakMatch = 0;
    this.repPeakTracking = 0;
    this.stableUpFrames = 0;
    this.stableDownFrames = 0;
    this.lastRepCompletedAt = 0;
    this.smoothedMovementMatch = 0;
    this.smoothedTrackingConfidence = 0;
    this.progressScore = 0;
    this.amplitudes = [];
    this.completedActions = [];
    this.skippedActions = [];
    this.motionSyncSamples = [];
    this.movementMatchSamples = [];
    this.vitalsScoreSamples = [];
    this.actionTelemetry = this.actions.map((action) => ({
      id: action.id,
      label: action.label,
      repsTarget: action.repsTarget,
      samples: 0,
      movementMatchSum: 0,
      trackingSum: 0,
      motionSyncSum: 0,
      vitalsSum: 0,
      repsCompleted: 0,
      completed: false,
      skipped: false
    }));
    this.latestMotionSample = null;
    this.latestLandmarks = null;
    this.previewAction = this.actions[0] || null;
    this.startedAt = performance.now();
    this.running = true;
    this.lastTickAt = 0;
    this.motionAdapter?.reset?.();

    this.onStatus?.({
      status: "running",
      zone,
      side,
      difficulty: this.activeCurriculum?.difficulty?.level || "mid",
      plannerRationale: this.activeCurriculum?.plannerRationale || this.activeCurriculum?.difficulty?.rationale || "",
      plannerMode: this.activeCurriculum?.plannerMode || "default",
      datasetIds: this.activeCurriculum?.datasetIds || []
    });
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
    const requiredMatchScore = this.getRepMatchThreshold() * 100;
    const requiredTrackingScore = this.getTrackingThreshold() * 100;

    return {
      zone: this.zone,
      side: this.side,
      durationSec,
      actionsCompleted: this.completedActions.length,
      actionsSkipped: this.skippedActions.length,
      actionsTotal: this.actions.length,
      score: Math.round(this.progressScore),
      romGainEstimate,
      motionSyncAvg: Number.isFinite(motionSyncAvg) ? Math.round(motionSyncAvg) : null,
      movementMatchAvg: Number.isFinite(movementMatchAvg) ? Math.round(movementMatchAvg) : null,
      vitalScoreAvg: Number.isFinite(vitalScoreAvg) ? Math.round(vitalScoreAvg) : null,
      completedActions: [...this.completedActions],
      skippedActions: [...this.skippedActions],
      actionBreakdown: this.actionTelemetry.map((entry) => ({
        id: entry.id,
        label: entry.label,
        repsTarget: entry.repsTarget,
        repsCompleted: entry.repsCompleted,
        completed: entry.completed,
        skipped: entry.skipped,
        avgMovementMatch: entry.samples ? Math.round(entry.movementMatchSum / entry.samples) : null,
        avgTrackingConfidence: entry.samples ? Math.round(entry.trackingSum / entry.samples) : null,
        avgMotionSync: entry.samples ? Math.round(entry.motionSyncSum / entry.samples) : null,
        avgVitals: entry.samples ? Math.round(entry.vitalsSum / entry.samples) : null,
        requiredMatchScore,
        requiredTrackingScore
      })),
      curriculum: this.activeCurriculum
    };
  }

  getActiveCurriculum() {
    return this.activeCurriculum
      ? {
        ...this.activeCurriculum,
        actions: this.activeCurriculum.actions.map((action) => ({
          id: action.id,
          label: action.label,
          description: action.description,
          repsTarget: action.repsTarget,
          datasetRefs: [...(action.datasetRefs || [])],
          retrievalScore: action.retrievalScore,
          retrievalReason: action.retrievalReason
        }))
      }
      : null;
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

  getActionTelemetry(action) {
    if (!action) {
      return null;
    }
    return this.actionTelemetry.find((entry) => entry.id === action.id) || null;
  }

  computeMovementMatch(action, sample, motionSample) {
    if (!sample || !action) {
      return 0;
    }

    const useMotionSync = this.zone === "shoulder";
    const trackingConfidence = clamp(
      Number(sample.trackingConfidence ?? (useMotionSync ? motionSample?.confidence : null) ?? 0.52),
      0,
      1
    );
    const amplitudeRatio = Number.isFinite(sample.amplitude)
      ? sample.amplitude / Math.max(amplitudeTarget(action.id), 0.001)
      : 0.35;
    const amplitudeScore = amplitudeRatio >= 1
      ? 1
      : clamp(amplitudeRatio, 0, 1);
    const directionScore = sample.up || sample.down ? 1 : 0.25;
    const syncScore = useMotionSync && Number.isFinite(motionSample?.syncScore)
      ? clamp(motionSample.syncScore / 100, 0, 1)
      : trackingConfidence;

    let match = amplitudeScore * 0.48
      + directionScore * 0.16
      + trackingConfidence * 0.2
      + syncScore * 0.16;

    if (amplitudeScore < 0.45) {
      match *= 0.76;
    }
    if (trackingConfidence < this.getTrackingThreshold() - 0.08) {
      match *= 0.72;
    }
    return clamp(match, 0, 1);
  }

  computeTrackingConfidence(action, landmarks, motionSample) {
    if (!action || !Array.isArray(landmarks)) {
      return clamp(Number(motionSample?.confidence ?? 0.42), 0, 1);
    }

    const useMotionSync = this.zone === "shoulder";
    const visibilities = getActionTrackingIndexes(action.id, this.side)
      .map((idx) => landmarks[idx]?.visibility)
      .filter((value) => Number.isFinite(value))
      .map((value) => clamp(value, 0, 1));

    const poseConfidence = visibilities.length
      ? (visibilities.reduce((sum, value) => sum + value, 0) / visibilities.length)
      : 0.56;
    const motionConfidence = useMotionSync && Number.isFinite(motionSample?.confidence)
      ? clamp(motionSample.confidence, 0, 1)
      : poseConfidence;

    return clamp(poseConfidence * 0.72 + motionConfidence * 0.28, 0, 1);
  }

  getRepMatchThreshold() {
    const level = this.activeCurriculum?.difficulty?.level || "mid";
    if (level === "high") {
      return 0.72;
    }
    if (level === "low") {
      return 0.58;
    }
    return 0.65;
  }

  getTrackingThreshold() {
    const level = this.activeCurriculum?.difficulty?.level || "mid";
    if (level === "high") {
      return 0.5;
    }
    if (level === "low") {
      return 0.34;
    }
    return 0.42;
  }

  getStablePhaseFrames() {
    const level = this.activeCurriculum?.difficulty?.level || "mid";
    if (level === "high") {
      return { up: 3, down: 3 };
    }
    if (level === "low") {
      return { up: 2, down: 2 };
    }
    return { up: 2, down: 3 };
  }

  getRepCooldownMs() {
    const level = this.activeCurriculum?.difficulty?.level || "mid";
    if (level === "high") {
      return 420;
    }
    if (level === "low") {
      return 300;
    }
    return 360;
  }

  completeSequence(forcePerfectFinish = true) {
    const vitalsScore = this.computeVitalsScore();
    this.progressScore = forcePerfectFinish
      ? 100
      : this.computeProgressScore(0, vitalsScore);
    this.emitProgress(this.latestMotionSample, forcePerfectFinish ? 1 : 0, vitalsScore, null);
    this.drawOverlay(null, true, this.latestMotionSample);
    const summary = this.getSummary();
    this.onComplete?.(summary);
    this.stop();
  }

  advanceToNextAction({ forcePerfectFinish = true } = {}) {
    const action = this.actions[this.currentActionIndex];
    const telemetry = this.getActionTelemetry(action);
    if (telemetry) {
      telemetry.repsCompleted = Math.max(telemetry.repsCompleted, this.currentRepCount);
      telemetry.completed = forcePerfectFinish || telemetry.repsCompleted >= telemetry.repsTarget;
    }
    this.currentActionIndex += 1;
    this.currentRepCount = 0;
    this.upSeen = false;
    this.repPeakMatch = 0;
    this.repPeakTracking = 0;
    this.stableUpFrames = 0;
    this.stableDownFrames = 0;
    this.smoothedMovementMatch = 0;
    this.smoothedTrackingConfidence = 0;

    if (this.currentActionIndex >= this.actions.length) {
      this.completeSequence(forcePerfectFinish);
      return null;
    }

    this.emitActionChanged();
    return this.actions[this.currentActionIndex];
  }

  skipCurrentAction(reason = "manual") {
    const action = this.actions[this.currentActionIndex];
    if (!this.running || !action) {
      return null;
    }

    const telemetry = this.getActionTelemetry(action);
    if (telemetry) {
      telemetry.skipped = true;
      telemetry.repsCompleted = Math.max(telemetry.repsCompleted, this.currentRepCount);
    }

    this.skippedActions.push({
      id: action.id,
      label: action.label,
      reason
    });

    const nextAction = this.advanceToNextAction({ forcePerfectFinish: false });
    if (!nextAction && !this.running) {
      return {
        skippedAction: action,
        nextAction: null,
        completed: true
      };
    }

    const vitalsScore = this.computeVitalsScore();
    this.progressScore = this.computeProgressScore(0, vitalsScore);
    this.emitProgress(this.latestMotionSample, 0, vitalsScore, null);
    this.drawOverlay(null, false, this.latestMotionSample);

    return {
      skippedAction: action,
      nextAction,
      completed: false
    };
  }

  tick = () => {
    if (!this.running) {
      return;
    }

    const nowMs = performance.now();
    if (this.lastTickAt && (nowMs - this.lastTickAt) < this.targetTickMs) {
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }
    this.lastTickAt = nowMs;

    const action = this.actions[this.currentActionIndex];
    const baseLandmarks = this.getPoseLandmarks?.();
    const motionSample = this.motionAdapter?.analyze?.(baseLandmarks, nowMs) || null;
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

    const trackingConfidence = this.computeTrackingConfidence(action, landmarks, this.latestMotionSample);
    if (sample) {
      sample.trackingConfidence = trackingConfidence;
    }
    const rawMovementMatch = this.computeMovementMatch(action, sample, this.latestMotionSample);
    this.smoothedTrackingConfidence = this.smoothedTrackingConfidence <= 0
      ? trackingConfidence
      : clamp(this.smoothedTrackingConfidence * 0.56 + trackingConfidence * 0.44, 0, 1);
    this.smoothedMovementMatch = this.smoothedMovementMatch <= 0
      ? rawMovementMatch
      : clamp(this.smoothedMovementMatch * 0.6 + rawMovementMatch * 0.4, 0, 1);
    const movementMatch = this.smoothedMovementMatch;
    const trackingConfidenceSmooth = this.smoothedTrackingConfidence;
    const repMatchThreshold = this.getRepMatchThreshold();
    const trackingThreshold = this.getTrackingThreshold();
    const stableFrames = this.getStablePhaseFrames();
    const repCooldownMs = this.getRepCooldownMs();
    const cooledDown = !this.lastRepCompletedAt || (nowMs - this.lastRepCompletedAt >= repCooldownMs);

    if (sample) {
      if (Number.isFinite(sample.amplitude)) {
        this.amplitudes.push(sample.amplitude);
      }

      if (sample.up) {
        this.stableUpFrames += 1;
        this.stableDownFrames = 0;
      } else if (sample.down) {
        this.stableDownFrames += 1;
        if (!this.upSeen) {
          this.stableUpFrames = 0;
        }
      } else {
        this.stableUpFrames = 0;
        this.stableDownFrames = 0;
      }

      const stableUp = this.stableUpFrames >= stableFrames.up;
      const stableDown = this.stableDownFrames >= stableFrames.down;

      if (stableUp && movementMatch >= repMatchThreshold && trackingConfidenceSmooth >= trackingThreshold && cooledDown) {
        this.upSeen = true;
        this.repPeakMatch = Math.max(this.repPeakMatch, movementMatch);
        this.repPeakTracking = Math.max(this.repPeakTracking, trackingConfidenceSmooth);
      } else if (stableUp && this.upSeen) {
        this.repPeakMatch = Math.max(this.repPeakMatch, movementMatch);
        this.repPeakTracking = Math.max(this.repPeakTracking, trackingConfidenceSmooth);
      } else if (stableDown && this.upSeen) {
        const repQualified = this.repPeakMatch >= repMatchThreshold
          && this.repPeakTracking >= trackingThreshold
          && cooledDown;
        if (repQualified) {
          this.currentRepCount += 1;
          this.lastRepCompletedAt = nowMs;
          const telemetry = this.getActionTelemetry(action);
          if (telemetry) {
            telemetry.repsCompleted = Math.max(telemetry.repsCompleted, this.currentRepCount);
          }
        }
        this.upSeen = false;
        this.repPeakMatch = 0;
        this.repPeakTracking = 0;
        this.stableUpFrames = 0;
        this.stableDownFrames = 0;

        if (repQualified && this.currentRepCount >= action.repsTarget) {
          this.completedActions.push({
            id: action.id,
            label: action.label,
            reps: this.currentRepCount
          });

          const nextAction = this.advanceToNextAction({ forcePerfectFinish: true });
          if (!nextAction && !this.running) {
            return;
          }
        }
      }
    }

    const vitalsScore = this.computeVitalsScore();
    this.movementMatchSamples.push(movementMatch * 100);
    this.vitalsScoreSamples.push(vitalsScore * 100);
    const telemetry = this.getActionTelemetry(action);
    if (telemetry) {
      telemetry.samples += 1;
      telemetry.movementMatchSum += clamp(movementMatch, 0, 1) * 100;
      telemetry.trackingSum += clamp(trackingConfidenceSmooth, 0, 1) * 100;
      telemetry.motionSyncSum += Number.isFinite(this.latestMotionSample?.syncScore)
        ? clamp(this.latestMotionSample.syncScore, 0, 100)
        : clamp(trackingConfidenceSmooth, 0, 1) * 100;
      telemetry.vitalsSum += clamp(vitalsScore, 0, 1) * 100;
      telemetry.repsCompleted = Math.max(telemetry.repsCompleted, this.currentRepCount);
    }

    this.progressScore = this.computeProgressScore(movementMatch, vitalsScore);
    this.emitProgress(this.latestMotionSample, movementMatch, vitalsScore, trackingConfidenceSmooth);
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
    const nextAction = this.actions[this.currentActionIndex + 1] || null;
    this.previewAction = action;

    this.onActionChanged?.({
      index: this.currentActionIndex,
      total: this.actions.length,
      ...action,
      repsDone: this.currentRepCount,
      nextLabel: nextAction?.label || null,
      difficulty: this.activeCurriculum?.difficulty?.level || "mid",
      plannerRationale: this.activeCurriculum?.plannerRationale || this.activeCurriculum?.difficulty?.rationale || "",
      plannerMode: this.activeCurriculum?.plannerMode || "default",
      datasetIds: this.activeCurriculum?.datasetIds || []
    });
  }

  emitProgress(motionSample, movementMatch = 0, vitalsScore = 0.5, trackingConfidence = null) {
    const action = this.actions[this.currentActionIndex];
    this.onProgress?.({
      score: this.progressScore,
      actionsCompleted: this.completedActions.length,
      actionsSkipped: this.skippedActions.length,
      actionsTotal: this.actions.length,
      actionId: action?.id || null,
      actionLabel: action?.label || null,
      repsDone: this.currentRepCount,
      repsTarget: action?.repsTarget || 0,
      motionSyncScore: Number.isFinite(motionSample?.syncScore) ? motionSample.syncScore : null,
      motionUpperArmRad: Number.isFinite(motionSample?.upperArmRad) ? motionSample.upperArmRad : null,
      motionForearmRad: Number.isFinite(motionSample?.forearmRad) ? motionSample.forearmRad : null,
      movementMatchScore: clamp(movementMatch, 0, 1) * 100,
      vitalsScore: clamp(vitalsScore, 0, 1) * 100,
      requiredMatchScore: this.getRepMatchThreshold() * 100,
      trackingConfidence: Number.isFinite(trackingConfidence) ? trackingConfidence * 100 : null,
      requiredTrackingScore: this.getTrackingThreshold() * 100
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
    const imageRatio = this.silhouetteImage?.naturalWidth && this.silhouetteImage?.naturalHeight
      ? this.silhouetteImage.naturalWidth / this.silhouetteImage.naturalHeight
      : 0.52;
    const drawW = drawH * imageRatio;
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

    const figX = x + 12;
    const figY = y + 40;
    const figW = panelWidth - 24;
    const figH = panelHeight - 52;
    const movementPreview = this.getMovementPreviewImage(action?.id);
    const showImage = movementPreview?.ready && movementPreview?.image?.naturalWidth;

    ctx.save();
    roundRect(ctx, figX, figY, figW, figH, 10);
    ctx.clip();
    const panelGradient = ctx.createLinearGradient(figX, figY, figX, figY + figH);
    panelGradient.addColorStop(0, "rgba(11, 35, 52, 0.9)");
    panelGradient.addColorStop(1, "rgba(8, 23, 35, 0.9)");
    ctx.fillStyle = panelGradient;
    ctx.fillRect(figX, figY, figW, figH);
    ctx.restore();

    if (showImage) {
      const image = movementPreview.image;
      const scale = Math.min(figW / image.naturalWidth, figH / image.naturalHeight);
      const drawW = image.naturalWidth * scale;
      const drawH = image.naturalHeight * scale;
      const dx = figX + (figW - drawW) * 0.5;
      const dy = figY + (figH - drawH) * 0.5;

      ctx.save();
      ctx.globalAlpha = 0.96;
      ctx.drawImage(image, dx, dy, drawW, drawH);
      ctx.restore();
    } else {
      const fallbackX = figX + 46;
      const fallbackY = figY + 10;
      const fallbackW = figW - 92;
      const fallbackH = figH - 18;
      if (this.silhouetteReady && this.silhouetteImage?.naturalWidth) {
        ctx.globalAlpha = 0.8;
        ctx.drawImage(this.silhouetteImage, fallbackX, fallbackY, fallbackW, fallbackH);
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = "rgba(196, 209, 217, 0.58)";
        ctx.fillRect(fallbackX, fallbackY, fallbackW, fallbackH);
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = "rgba(170, 174, 180, 0.8)";
        ctx.fillRect(fallbackX + 34, fallbackY + 8, 28, 96);
        ctx.beginPath();
        ctx.arc(fallbackX + 48, fallbackY + 16, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      this.drawPreviewMotionPath(ctx, action, phase, fallbackX, fallbackY, fallbackW, fallbackH);
    }
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

    const action = this.actions[this.currentActionIndex];
    const phase = (Math.sin((performance.now() - this.startedAt) / 450) + 1) * 0.5;
    const topGradient = ctx.createLinearGradient(0, 0, 0, 120);
    topGradient.addColorStop(0, "rgba(4, 14, 28, 0.82)");
    topGradient.addColorStop(1, "rgba(4, 14, 28, 0)");
    ctx.fillStyle = topGradient;
    ctx.fillRect(0, 0, width, 130);

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
    ctx.fillText("Only clean matches to the shown movement count as reps.", 16, 96);

    this.drawActionPreview(ctx, this.previewAction || action, phase, width, height);

    const progressWidth = Math.max(width - 32, 120);
    ctx.fillStyle = "rgba(6, 25, 40, 0.74)";
    roundRect(ctx, 16, height - 34, progressWidth, 12, 6);
    ctx.fill();
    const fillW = progressWidth * (this.progressScore / 100);
    ctx.fillStyle = "rgba(62,226,176,0.9)";
    roundRect(ctx, 16, height - 34, fillW, 12, 6);
    ctx.fill();

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
      ctx.fillText("Keep full body visible in camera PIP for tracking.", 16, 122);
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
