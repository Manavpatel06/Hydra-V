import { round } from "../../core/utils.js";

export function buildThetaNarration({ sessionContext, protocolContext, biometrics, beatHz, plasticityScore }) {
  const athleteName = sessionContext?.athleteName || "athlete";
  const focusZone = sessionContext?.focusZone || protocolContext?.focusZone || "target zone";

  const heartRate = Number.isFinite(biometrics?.heartRateBpm) ? round(biometrics.heartRateBpm, 0) : null;
  const micro = Number.isFinite(biometrics?.microsaccadeHz) ? round(biometrics.microsaccadeHz, 2) : null;

  const lines = [
    `${athleteName}, stay with your breath while we move through the theta recovery phase.`,
    `Your entrainment beat is ${round(beatHz, 2)} hertz, calibrated for nervous system downshift.`,
    `We are focusing support into your ${focusZone}.`
  ];

  if (heartRate !== null) {
    lines.push(`Current heart rate is around ${heartRate} beats per minute and settling.`);
  }

  if (micro !== null) {
    lines.push(`Micro-saccade rhythm is ${micro} hertz, and we are guiding it toward stable recovery cadence.`);
  }

  if (Number.isFinite(plasticityScore)) {
    lines.push(`Plasticity score is ${round(plasticityScore, 2)} out of ten and improving with synchronized input.`);
  }

  lines.push("Let the pads do the work while your system integrates this signal.");

  return lines.join(" ");
}

export function buildPostSessionNarration({ sessionContext, protocolContext, biometrics, plasticityScore, beatHz }) {
  const athleteName = sessionContext?.athleteName || "athlete";
  const focusZone = sessionContext?.focusZone || protocolContext?.focusZone || "target zone";

  const heartRate = Number.isFinite(biometrics?.heartRateBpm) ? round(biometrics.heartRateBpm, 0) : null;
  const hrv = Number.isFinite(biometrics?.hrvRmssdMs) ? round(biometrics.hrvRmssdMs, 1) : null;

  const lines = [
    `${athleteName}, today's session is complete.`,
    `We synchronized stimulation to your heartbeat and completed adaptive entrainment around ${round(beatHz, 2)} hertz.`,
    `Primary treatment focus was your ${focusZone}.`
  ];

  if (hrv !== null) {
    lines.push(`Your HRV proxy is ${hrv} milliseconds, showing recovery readiness tracking.`);
  }

  if (heartRate !== null) {
    lines.push(`Final heart rate sits near ${heartRate} beats per minute.`);
  }

  if (Number.isFinite(plasticityScore)) {
    lines.push(`Nervous system plasticity score closed at ${round(plasticityScore, 2)} out of ten.`);
  }

  lines.push("Keep hydration and mobility work light today, then check your next garden growth update before your next visit.");

  return lines.join(" ");
}
