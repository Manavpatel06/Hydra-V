import { clamp } from "./math.js";

export function compositeOutcomeScore(outcomes) {
  const weighted =
    outcomes.hrvDelta * 0.32 +
    outcomes.symmetryGain * 0.26 +
    outcomes.microsaccadeStabilityGain * 0.12 +
    outcomes.painReduction * 0.12 +
    outcomes.romGain * 0.12 +
    outcomes.subjectiveReadinessGain * 0.06;

  return clamp(weighted, -10, 30);
}

export function recoveryScore(session) {
  if (!session) {
    return 50;
  }

  const score =
    50 +
    session.outcomes.hrvDelta * 2 +
    session.outcomes.symmetryGain * 1.8 +
    session.outcomes.painReduction * 2.2 +
    session.outcomes.romGain * 0.8 -
    session.outcomes.symmetryDeltaRemaining * 1.1;

  return Math.round(clamp(score, 5, 99));
}

export function currentStreak(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return 0;
  }

  return sessions.length;
}
