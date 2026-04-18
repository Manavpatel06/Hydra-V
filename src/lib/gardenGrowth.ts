import type {
  GardenMilestones,
  GardenSnapshot,
  GardenTree,
  SessionModality,
  SessionRecord,
  TreeSegment,
  TreeSpecies,
} from '../types/domain'
import { clamp } from './math'
import { currentStreak, recoveryScore } from './scoring'

interface TurtleState {
  x: number
  y: number
  angle: number
  depth: number
  step: number
}

interface SpeciesRules {
  iterations: number
  angleDeg: number
  step: number
  shrink: number
  axiom: string
  production: string
}

const SPECIES_RULES: Record<TreeSpecies, SpeciesRules> = {
  birch: {
    iterations: 4,
    angleDeg: 21,
    step: 0.26,
    shrink: 0.8,
    axiom: 'F',
    production: 'F[+F]F[-F]F',
  },
  bamboo: {
    iterations: 4,
    angleDeg: 13,
    step: 0.24,
    shrink: 0.88,
    axiom: 'F',
    production: 'FF[+F][-F]',
  },
  pine: {
    iterations: 5,
    angleDeg: 27,
    step: 0.23,
    shrink: 0.79,
    axiom: 'F',
    production: 'F[+F][-F][+F]',
  },
  oak: {
    iterations: 5,
    angleDeg: 24,
    step: 0.27,
    shrink: 0.8,
    axiom: 'F',
    production: 'F[+F]F[-F][F]',
  },
  rare: {
    iterations: 5,
    angleDeg: 29,
    step: 0.28,
    shrink: 0.78,
    axiom: 'F',
    production: 'F[+F][-F]F[+F]',
  },
}

const rngFromSeed = (seed: number): (() => number) => {
  let current = seed >>> 0
  return () => {
    current += 0x6d2b79f5
    let value = current
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const expandLSystem = (seed: string, rule: string, iterations: number): string => {
  let current = seed
  for (let index = 0; index < iterations; index += 1) {
    current = current
      .split('')
      .map((char) => (char === 'F' ? rule : char))
      .join('')
  }
  return current
}

const rotateY = (point: [number, number, number], radians: number): [number, number, number] => {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return [point[0] * cos - point[2] * sin, point[1], point[0] * sin + point[2] * cos]
}

const modalityToSpecies = (
  modality: SessionModality,
  symmetryDeltaRemaining: number,
  hrvDelta: number,
): TreeSpecies => {
  if (hrvDelta >= 10 && symmetryDeltaRemaining <= 5) {
    return 'oak'
  }
  if (modality === 'photobiomodulation') {
    return 'birch'
  }
  if (modality === 'resonance') {
    return 'bamboo'
  }
  if (modality === 'thermal') {
    return 'pine'
  }
  return 'oak'
}

const buildTreeGeometry = (
  species: TreeSpecies,
  correctiveGrowth: boolean,
  seed: number,
): { segments: TreeSegment[]; buds: [number, number, number][]; height: number } => {
  const random = rngFromSeed(seed)
  const rule = SPECIES_RULES[species]
  const system = expandLSystem(rule.axiom, rule.production, rule.iterations)
  const initialState: TurtleState = {
    x: 0,
    y: 0,
    angle: Math.PI / 2,
    depth: 0,
    step: rule.step,
  }
  const stack: TurtleState[] = []
  const segments: TreeSegment[] = []
  const buds: [number, number, number][] = []
  let state = initialState
  let maxHeight = 0
  const angleStep = (rule.angleDeg * Math.PI) / 180

  for (const command of system) {
    if (command === 'F') {
      const correctionFactor =
        correctiveGrowth && state.y < 1 ? 0.6 : correctiveGrowth && state.y > 1.2 ? 1.08 : 1
      const segmentLength = state.step * correctionFactor
      const nextX = state.x + Math.cos(state.angle) * segmentLength
      const nextY = state.y + Math.sin(state.angle) * segmentLength
      const depthFactor = clamp(1 - state.depth * 0.12, 0.2, 1)
      const zNoise = (random() - 0.5) * 0.11 * (state.depth + 1)

      segments.push({
        start: [state.x, state.y, 0],
        end: [nextX, nextY, zNoise],
        radius: 0.06 * depthFactor,
        depth: state.depth,
      })

      state = {
        ...state,
        x: nextX,
        y: nextY,
        step: state.step * rule.shrink,
      }

      maxHeight = Math.max(maxHeight, nextY)
      if (state.depth > 2 && random() > 0.6) {
        buds.push([nextX, nextY, zNoise])
      }
      continue
    }

    if (command === '+') {
      state = {
        ...state,
        angle: state.angle + angleStep + (random() - 0.5) * 0.18,
      }
      continue
    }

    if (command === '-') {
      state = {
        ...state,
        angle: state.angle - angleStep + (random() - 0.5) * 0.18,
      }
      continue
    }

    if (command === '[') {
      stack.push({ ...state, depth: state.depth + 1 })
      continue
    }

    if (command === ']' && stack.length > 0) {
      const previous = stack.pop()
      if (previous) {
        state = previous
      }
    }
  }

  return { segments, buds, height: maxHeight }
}

const speciesMixFromTrees = (trees: GardenTree[]): Record<TreeSpecies, number> =>
  trees.reduce<Record<TreeSpecies, number>>(
    (mix, tree) => {
      mix[tree.species] += 1
      return mix
    },
    { birch: 0, bamboo: 0, pine: 0, oak: 0, rare: 0 },
  )

const isBlossomRun = (sessions: SessionRecord[]): boolean => {
  if (sessions.length < 4) {
    return false
  }

  const recent = sessions.slice(-4)
  return recent.every(
    (session) => session.outcomes.hrvDelta >= 6 && session.outcomes.symmetryGain >= 5,
  )
}

const buildMilestones = (sessions: SessionRecord[], trees: GardenTree[]): GardenMilestones => {
  const latest = sessions.at(-1)
  const bestHrv = Math.max(...sessions.map((session) => session.outcomes.hrvDelta))
  const frostLevel = latest
    ? clamp((latest.outcomes.symmetryDeltaRemaining - 5) / 15, 0, 1)
    : 0

  return {
    streak: currentStreak(sessions),
    recoveryScore: recoveryScore(latest),
    frostLevel,
    blossomEvent: isBlossomRun(sessions),
    biomeUnlocked: sessions.length >= 3,
    equilibriumRiver: latest ? latest.outcomes.symmetryDeltaRemaining <= 5 : false,
    rareSpeciesUnlocked:
      latest !== undefined && latest.outcomes.hrvDelta >= bestHrv && latest.outcomes.hrvDelta >= 10,
    speciesMix: speciesMixFromTrees(trees),
  }
}

export const buildGardenSnapshot = (sessions: SessionRecord[]): GardenSnapshot => {
  if (sessions.length === 0) {
    return {
      trees: [],
      milestones: {
        streak: 0,
        recoveryScore: 50,
        frostLevel: 0,
        blossomEvent: false,
        biomeUnlocked: false,
        equilibriumRiver: false,
        rareSpeciesUnlocked: false,
        speciesMix: { birch: 0, bamboo: 0, pine: 0, oak: 0, rare: 0 },
      },
    }
  }

  const bestHrv = Math.max(...sessions.map((session) => session.outcomes.hrvDelta))

  const trees = sessions.map((session, index) => {
    const baseSpecies = modalityToSpecies(
      session.modality,
      session.outcomes.symmetryDeltaRemaining,
      session.outcomes.hrvDelta,
    )
    const species: TreeSpecies =
      session.outcomes.hrvDelta >= bestHrv && session.outcomes.hrvDelta >= 10 ? 'rare' : baseSpecies
    const correctiveGrowth =
      session.outcomes.symmetryDeltaRemaining > 12 && session.outcomes.symmetryGain > 8
    const geometry = buildTreeGeometry(species, correctiveGrowth, 1000 + index * 41)
    const ring = 1.4 + index * 0.58
    const angle = index * 0.94
    const position: [number, number, number] = [Math.cos(angle) * ring, 0, Math.sin(angle) * ring]
    const rotationY = angle * 0.8 + 0.2
    const segments = geometry.segments.map((segment) => ({
      ...segment,
      start: rotateY(segment.start, rotationY),
      end: rotateY(segment.end, rotationY),
    }))
    const buds = geometry.buds.map((bud) => rotateY(bud, rotationY))

    return {
      id: session.id,
      species,
      modality: session.modality,
      createdAt: session.createdAt,
      position,
      rotationY,
      height: geometry.height,
      frost: clamp((session.outcomes.symmetryDeltaRemaining - 5) / 18, 0, 1),
      correctiveGrowth,
      segments,
      buds,
    }
  })

  return {
    trees,
    milestones: buildMilestones(sessions, trees),
  }
}
