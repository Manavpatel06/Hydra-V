import { clamp, round } from "../../core/utils.js";

const PHASE_TARGETS = Object.freeze({
  pre: {
    baseHz: 10.5,
    minHz: 9.2,
    maxHz: 11.8
  },
  during: {
    // Workout phase: hold the active game in an alert, movement-focused low-beta / SMR band.
    baseHz: 15,
    minHz: 13.5,
    maxHz: 16.5
  },
  post: {
    baseHz: 8.2,
    minHz: 6.8,
    maxHz: 9.2
  },
  idle: {
    baseHz: 10,
    minHz: 8,
    maxHz: 12
  }
});

export class AdaptiveBeatSelector {
  getPhaseTarget(phase) {
    return PHASE_TARGETS[phase] || PHASE_TARGETS.idle;
  }

  getPhaseBaselineHz(phase) {
    return this.getPhaseTarget(phase).baseHz;
  }

  calculateArousal(biometrics = {}) {
    const hrv = Number.isFinite(biometrics.hrvRmssdMs) ? biometrics.hrvRmssdMs : null;
    const microsaccade = Number.isFinite(biometrics.microsaccadeHz) ? biometrics.microsaccadeHz : null;
    const heartRate = Number.isFinite(biometrics.heartRateBpm) ? biometrics.heartRateBpm : null;

    // Do not fabricate arousal from defaults; require real biometric inputs.
    if (hrv === null || microsaccade === null || heartRate === null) {
      return null;
    }

    const hrvStress = clamp(1 - (hrv - 18) / (90 - 18), 0, 1);
    const microStress = clamp((microsaccade - 0.3) / (2.4 - 0.3), 0, 1);
    const heartRateStress = clamp((heartRate - 52) / (114 - 52), 0, 1);

    return round(hrvStress * 0.5 + microStress * 0.3 + heartRateStress * 0.2, 3);
  }

  selectTarget({ phase, biometrics, currentBeatHz }) {
    const arousalIndex = this.calculateArousal(biometrics);
    const targetWindow = this.getPhaseTarget(phase);
    const phaseBaseline = targetWindow.baseHz;
    const beatNow = Number.isFinite(currentBeatHz) ? currentBeatHz : phaseBaseline;

    let rawTargetHz = phaseBaseline;
    let personalized = false;

    if (arousalIndex !== null) {
      personalized = true;
      if (phase === "pre") {
        rawTargetHz = targetWindow.maxHz - (arousalIndex * (targetWindow.maxHz - targetWindow.minHz));
      } else if (phase === "during") {
        // Lower arousal gets a slightly stronger drive; higher arousal stays sharp without overshooting.
        rawTargetHz = targetWindow.maxHz - (arousalIndex * (targetWindow.maxHz - targetWindow.minHz));
      } else if (phase === "post") {
        rawTargetHz = targetWindow.maxHz - (arousalIndex * (targetWindow.maxHz - targetWindow.minHz));
      }
    }

    const boundedTarget = clamp(rawTargetHz, targetWindow.minHz, targetWindow.maxHz);
    const smoothedTarget = beatNow + (boundedTarget - beatNow) * 0.35;

    return {
      arousalIndex,
      personalized,
      rawTargetHz: round(boundedTarget, 2),
      targetBeatHz: round(smoothedTarget, 2)
    };
  }
}
