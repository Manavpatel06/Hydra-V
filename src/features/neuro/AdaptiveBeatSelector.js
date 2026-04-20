import { clamp, round } from "../../core/utils.js";

export class AdaptiveBeatSelector {
  getPhaseBaselineHz(phase) {
    if (phase === "pre") {
      return 40;
    }
    if (phase === "during") {
      return 6;
    }
    if (phase === "post") {
      return 10;
    }
    return 10;
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
    const phaseBaseline = this.getPhaseBaselineHz(phase);
    const beatNow = Number.isFinite(currentBeatHz) ? currentBeatHz : phaseBaseline;

    let rawTargetHz = phaseBaseline;
    let personalized = false;

    if (arousalIndex !== null) {
      personalized = true;
      if (phase === "pre") {
        rawTargetHz = 40 + (arousalIndex - 0.5) * 4;
      } else if (phase === "during") {
        rawTargetHz = 4 + arousalIndex * 4;
      } else if (phase === "post") {
        rawTargetHz = 10 + (arousalIndex - 0.5) * 2;
      }
    }

    const boundedTarget = clamp(rawTargetHz, 2, 45);
    const smoothedTarget = beatNow + (boundedTarget - beatNow) * 0.35;

    return {
      arousalIndex,
      personalized,
      rawTargetHz: round(boundedTarget, 2),
      targetBeatHz: round(smoothedTarget, 2)
    };
  }
}
