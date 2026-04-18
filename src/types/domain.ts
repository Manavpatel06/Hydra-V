export type SessionModality =
  | 'photobiomodulation'
  | 'resonance'
  | 'thermal'
  | 'hybrid'

export interface ProtocolParameters {
  lightRatio: number
  vibrationHz: number
  thermalGradient: number
  padDurationMin: number
  resonanceBias: number
  contralateralTargeting: boolean
}

export interface SessionOutcomes {
  hrvDelta: number
  symmetryGain: number
  symmetryDeltaRemaining: number
  microsaccadeStabilityGain: number
  painReduction: number
  romGain: number
  subjectiveReadinessGain: number
}

export interface SessionRecord {
  id: string
  athleteId: string
  createdAt: string
  modality: SessionModality
  protocol: ProtocolParameters
  outcomes: SessionOutcomes
  overrideNote?: string
}

export interface ParameterInsight {
  key: keyof ProtocolParameters
  label: string
  value: number
  range: [number, number]
  confidence: number
}

export interface ProtocolRecommendation {
  protocol: ProtocolParameters
  expectedImprovement: number
  uncertainty: number
  confidence: number
  modelMode: 'warmup' | 'gaussian-process'
  rationale: string[]
  warnings: string[]
  parameterInsights: ParameterInsight[]
  computedAt: string
  usingWebGPU: boolean
}

export type TreeSpecies = 'birch' | 'bamboo' | 'pine' | 'oak' | 'rare'

export interface TreeSegment {
  start: [number, number, number]
  end: [number, number, number]
  radius: number
  depth: number
}

export interface GardenTree {
  id: string
  species: TreeSpecies
  modality: SessionModality
  createdAt: string
  position: [number, number, number]
  rotationY: number
  height: number
  frost: number
  correctiveGrowth: boolean
  segments: TreeSegment[]
  buds: [number, number, number][]
}

export interface GardenMilestones {
  streak: number
  recoveryScore: number
  frostLevel: number
  blossomEvent: boolean
  biomeUnlocked: boolean
  equilibriumRiver: boolean
  rareSpeciesUnlocked: boolean
  speciesMix: Record<TreeSpecies, number>
}

export interface GardenSnapshot {
  trees: GardenTree[]
  milestones: GardenMilestones
}

export interface VoiceNote {
  headline: string
  body: string
}
