import type { ProtocolParameters, SessionRecord } from '../types/domain'

const daysAgo = (days: number): string => {
  const now = new Date()
  now.setDate(now.getDate() - days)
  return now.toISOString()
}

const protocol = (
  lightRatio: number,
  vibrationHz: number,
  thermalGradient: number,
  padDurationMin: number,
  resonanceBias: number,
  contralateralTargeting = false,
): ProtocolParameters => ({
  lightRatio,
  vibrationHz,
  thermalGradient,
  padDurationMin,
  resonanceBias,
  contralateralTargeting,
})

export const createSeedSessions = (): SessionRecord[] => [
  {
    id: 'seed-001',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(11),
    modality: 'thermal',
    protocol: protocol(0.42, 40, 0.7, 14, 0.31, false),
    outcomes: {
      hrvDelta: 2.8,
      symmetryGain: 3.1,
      symmetryDeltaRemaining: 17,
      microsaccadeStabilityGain: 1.4,
      painReduction: 1.8,
      romGain: 4.2,
      subjectiveReadinessGain: 1.2,
    },
  },
  {
    id: 'seed-002',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(9),
    modality: 'photobiomodulation',
    protocol: protocol(0.71, 38, 0.42, 16, 0.37, false),
    outcomes: {
      hrvDelta: 4.6,
      symmetryGain: 5.2,
      symmetryDeltaRemaining: 14,
      microsaccadeStabilityGain: 1.8,
      painReduction: 2.5,
      romGain: 5.7,
      subjectiveReadinessGain: 2.1,
    },
  },
  {
    id: 'seed-003',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(7),
    modality: 'resonance',
    protocol: protocol(0.48, 46, 0.41, 18, 0.74, true),
    outcomes: {
      hrvDelta: 6.2,
      symmetryGain: 7.4,
      symmetryDeltaRemaining: 11,
      microsaccadeStabilityGain: 2.6,
      painReduction: 2.9,
      romGain: 8.4,
      subjectiveReadinessGain: 2.7,
    },
    overrideNote: 'Added contralateral setup for left shoulder carryover.',
  },
  {
    id: 'seed-004',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(6),
    modality: 'hybrid',
    protocol: protocol(0.61, 52, 0.53, 18, 0.63, true),
    outcomes: {
      hrvDelta: 8.4,
      symmetryGain: 9.1,
      symmetryDeltaRemaining: 8.5,
      microsaccadeStabilityGain: 3.1,
      painReduction: 3.3,
      romGain: 11.3,
      subjectiveReadinessGain: 3.2,
    },
  },
  {
    id: 'seed-005',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(4),
    modality: 'photobiomodulation',
    protocol: protocol(0.75, 56, 0.46, 20, 0.51, true),
    outcomes: {
      hrvDelta: 9.8,
      symmetryGain: 10.4,
      symmetryDeltaRemaining: 6.2,
      microsaccadeStabilityGain: 3.4,
      painReduction: 3.9,
      romGain: 14.6,
      subjectiveReadinessGain: 3.8,
    },
  },
  {
    id: 'seed-006',
    athleteId: 'athlete-demo-001',
    createdAt: daysAgo(2),
    modality: 'hybrid',
    protocol: protocol(0.68, 58, 0.57, 19, 0.62, true),
    outcomes: {
      hrvDelta: 10.6,
      symmetryGain: 11.2,
      symmetryDeltaRemaining: 4.7,
      microsaccadeStabilityGain: 3.6,
      painReduction: 4.3,
      romGain: 16.8,
      subjectiveReadinessGain: 4.2,
    },
  },
]
