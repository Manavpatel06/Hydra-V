import { clamp } from "../../core/utils.js";

const IDX = Object.freeze({
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16
});

function hasPoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function safeVisibility(point) {
  return Number.isFinite(point?.visibility) ? clamp(point.visibility, 0, 1) : 0.6;
}

function normalizeRad(rad) {
  if (!Number.isFinite(rad)) {
    return 0;
  }
  let value = rad;
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  while (value < -Math.PI) {
    value += Math.PI * 2;
  }
  return value;
}

function mirrorPoint(point, midlineX) {
  return {
    ...point,
    x: midlineX - (point.x - midlineX)
  };
}

export class MirrorMotionAdapter {
  constructor() {
    this.lastTimestampMs = null;
    this.lastWristY = null;
  }

  reset() {
    this.lastTimestampMs = null;
    this.lastWristY = null;
  }

  analyze(landmarks, timestampMs = performance.now()) {
    if (!Array.isArray(landmarks) || landmarks.length <= IDX.rightWrist) {
      this.reset();
      return { available: false };
    }

    const leftShoulder = landmarks[IDX.leftShoulder];
    const rightShoulder = landmarks[IDX.rightShoulder];
    const rightElbow = landmarks[IDX.rightElbow];
    const rightWrist = landmarks[IDX.rightWrist];

    if (!hasPoint(rightShoulder) || !hasPoint(rightElbow) || !hasPoint(rightWrist)) {
      this.reset();
      return { available: false };
    }

    const upperArmRad = Math.atan2(
      rightElbow.y - rightShoulder.y,
      rightElbow.x - rightShoulder.x
    );
    const forearmAbsRad = Math.atan2(
      rightWrist.y - rightElbow.y,
      rightWrist.x - rightElbow.x
    );
    const forearmRad = normalizeRad(forearmAbsRad - upperArmRad);

    const wristLift = clamp((rightShoulder.y - rightWrist.y + 0.05) / 0.26, 0, 1);
    let wristVelocity = null;
    if (Number.isFinite(this.lastTimestampMs) && Number.isFinite(this.lastWristY) && timestampMs > this.lastTimestampMs) {
      const dtSec = (timestampMs - this.lastTimestampMs) / 1000;
      if (dtSec > 0) {
        wristVelocity = (rightWrist.y - this.lastWristY) / dtSec;
      }
    }

    this.lastTimestampMs = timestampMs;
    this.lastWristY = rightWrist.y;

    const confidence = (
      safeVisibility(rightShoulder) +
      safeVisibility(rightElbow) +
      safeVisibility(rightWrist)
    ) / 3;

    const motionEnergy = Number.isFinite(wristVelocity)
      ? clamp(Math.abs(wristVelocity) * 0.18, 0, 1)
      : wristLift;

    const syncScore = clamp(
      (wristLift * 0.45) +
      (motionEnergy * 0.3) +
      (confidence * 0.25),
      0,
      1
    ) * 100;

    const midlineX = (hasPoint(leftShoulder) && hasPoint(rightShoulder))
      ? (leftShoulder.x + rightShoulder.x) / 2
      : 0.5;

    const mirroredLandmarks = landmarks.map((landmark) => (
      landmark ? { ...landmark } : landmark
    ));
    mirroredLandmarks[IDX.leftShoulder] = mirrorPoint(rightShoulder, midlineX);
    mirroredLandmarks[IDX.leftElbow] = mirrorPoint(rightElbow, midlineX);
    mirroredLandmarks[IDX.leftWrist] = mirrorPoint(rightWrist, midlineX);

    return {
      available: true,
      confidence,
      syncScore,
      wristLift,
      motionEnergy,
      upperArmRad,
      forearmRad,
      mirroredLandmarks
    };
  }
}
