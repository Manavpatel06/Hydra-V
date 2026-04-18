import type { SessionModality, SessionOutcomes, SessionRecord } from '../types/domain'
import { clamp } from './math'

export const modalityLabel = (modality: SessionModality): string => {
  if (modality === 'photobiomodulation') {
    return 'Photobiomodulation'
  }
  if (modality === 'resonance') {
    return 'Resonance'
  }
  if (modality === 'thermal') {
    return 'Thermal'
  }
  return 'Hybrid'
}

export const compositeOutcomeScore = (outcomes: SessionOutcomes): number => {
  const weighted =
    outcomes.hrvDelta * 0.32 +
    outcomes.symmetryGain * 0.26 +
    outcomes.microsaccadeStabilityGain * 0.12 +
    outcomes.painReduction * 0.12 +
    outcomes.romGain * 0.12 +
    outcomes.subjectiveReadinessGain * 0.06

  return clamp(weighted, -10, 30)
}

export const recoveryScore = (session: SessionRecord | undefined): number => {
  if (!session) {
    return 50
  }

  const score =
    50 +
    session.outcomes.hrvDelta * 2 +
    session.outcomes.symmetryGain * 1.8 +
    session.outcomes.painReduction * 2.2 +
    session.outcomes.romGain * 0.8 -
    session.outcomes.symmetryDeltaRemaining * 1.1

  return Math.round(clamp(score, 5, 99))
}

export const currentStreak = (sessions: SessionRecord[]): number => {
  if (sessions.length === 0) {
    return 0
  }

  return sessions.length
}

export const asPercent = (value: number): string => `${Math.round(value * 100)}%`
