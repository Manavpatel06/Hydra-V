import { dot, invertMatrix, matrixVectorMultiply } from './math'

export interface GaussianProcessModel {
  x: number[][]
  y: number[]
  alpha: number[]
  inverseKernel: number[][]
  lengthScale: number
  signalVariance: number
  noiseVariance: number
  yBest: number
}

const erf = (value: number): number => {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const t = 1 / (1 + p * x)
  const polynomial =
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t)
  const y = 1 - polynomial * Math.exp(-x * x)
  return sign * y
}

const normalPdf = (z: number): number => Math.exp(-(z ** 2) / 2) / Math.sqrt(2 * Math.PI)

const normalCdf = (z: number): number => 0.5 * (1 + erf(z / Math.sqrt(2)))

const rbfKernel = (
  left: number[],
  right: number[],
  lengthScale: number,
  signalVariance: number,
): number => {
  let squaredDistance = 0
  for (let index = 0; index < left.length; index += 1) {
    squaredDistance += (left[index] - right[index]) ** 2
  }

  return signalVariance * Math.exp(-squaredDistance / (2 * lengthScale ** 2))
}

const buildKernelMatrix = (
  x: number[][],
  lengthScale: number,
  signalVariance: number,
  noiseVariance: number,
): number[][] =>
  x.map((left, row) =>
    x.map((right, col) => {
      const base = rbfKernel(left, right, lengthScale, signalVariance)
      return row === col ? base + noiseVariance : base
    }),
  )

const invertWithJitter = (matrix: number[][]): number[][] => {
  let jitter = 1e-8
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const stabilized = matrix.map((row, rowIndex) =>
        row.map((value, colIndex) => (rowIndex === colIndex ? value + jitter : value)),
      )
      return invertMatrix(stabilized)
    } catch {
      jitter *= 10
    }
  }

  throw new Error('Unable to invert kernel matrix.')
}

export const trainGaussianProcess = (
  x: number[][],
  y: number[],
  options?: {
    lengthScale?: number
    signalVariance?: number
    noiseVariance?: number
  },
): GaussianProcessModel | null => {
  if (x.length === 0 || y.length !== x.length) {
    return null
  }

  const lengthScale = options?.lengthScale ?? 0.33
  const signalVariance = options?.signalVariance ?? 1.0
  const noiseVariance = options?.noiseVariance ?? 0.03
  const kernel = buildKernelMatrix(x, lengthScale, signalVariance, noiseVariance)
  const inverseKernel = invertWithJitter(kernel)
  const alpha = matrixVectorMultiply(inverseKernel, y)

  return {
    x,
    y,
    alpha,
    inverseKernel,
    lengthScale,
    signalVariance,
    noiseVariance,
    yBest: Math.max(...y),
  }
}

export const predictGaussianProcess = (
  model: GaussianProcessModel,
  point: number[],
): { mean: number; variance: number } => {
  const kStar = model.x.map((row) =>
    rbfKernel(row, point, model.lengthScale, model.signalVariance),
  )
  const mean = dot(kStar, model.alpha)
  const projected = matrixVectorMultiply(model.inverseKernel, kStar)
  const variance = Math.max(
    model.signalVariance + model.noiseVariance - dot(kStar, projected),
    1e-6,
  )

  return {
    mean,
    variance,
  }
}

export const expectedImprovement = (
  mean: number,
  variance: number,
  best: number,
  explorationBias = 0.04,
): number => {
  const standardDeviation = Math.sqrt(Math.max(variance, 1e-6))
  if (standardDeviation < 1e-5) {
    return 0
  }

  const improvement = mean - best - explorationBias
  const zScore = improvement / standardDeviation
  return improvement * normalCdf(zScore) + standardDeviation * normalPdf(zScore)
}
