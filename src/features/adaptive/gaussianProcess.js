import { dot, invertMatrix, matrixVectorMultiply } from "./math.js";

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const polynomial = (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t);
  const y = 1 - polynomial * Math.exp(-x * x);
  return sign * y;
}

function normalPdf(z) {
  return Math.exp(-(z ** 2) / 2) / Math.sqrt(2 * Math.PI);
}

function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

function rbfKernel(left, right, lengthScale, signalVariance) {
  let squaredDistance = 0;
  for (let index = 0; index < left.length; index += 1) {
    squaredDistance += (left[index] - right[index]) ** 2;
  }

  return signalVariance * Math.exp(-squaredDistance / (2 * lengthScale ** 2));
}

function buildKernelMatrix(x, lengthScale, signalVariance, noiseVariance) {
  return x.map((left, row) =>
    x.map((right, col) => {
      const base = rbfKernel(left, right, lengthScale, signalVariance);
      return row === col ? base + noiseVariance : base;
    })
  );
}

function invertWithJitter(matrix) {
  let jitter = 1e-8;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const stabilized = matrix.map((row, rowIndex) =>
        row.map((value, colIndex) => (rowIndex === colIndex ? value + jitter : value))
      );
      return invertMatrix(stabilized);
    } catch {
      jitter *= 10;
    }
  }

  throw new Error("Unable to invert kernel matrix.");
}

export function trainGaussianProcess(x, y, options = {}) {
  if (!x.length || y.length !== x.length) {
    return null;
  }

  const lengthScale = options.lengthScale ?? 0.33;
  const signalVariance = options.signalVariance ?? 1.0;
  const noiseVariance = options.noiseVariance ?? 0.03;
  const kernel = buildKernelMatrix(x, lengthScale, signalVariance, noiseVariance);
  const inverseKernel = invertWithJitter(kernel);
  const alpha = matrixVectorMultiply(inverseKernel, y);

  return {
    x,
    y,
    alpha,
    inverseKernel,
    lengthScale,
    signalVariance,
    noiseVariance,
    yBest: Math.max(...y)
  };
}

export function predictGaussianProcess(model, point) {
  const kStar = model.x.map((row) => rbfKernel(row, point, model.lengthScale, model.signalVariance));
  const mean = dot(kStar, model.alpha);
  const projected = matrixVectorMultiply(model.inverseKernel, kStar);
  const variance = Math.max(model.signalVariance + model.noiseVariance - dot(kStar, projected), 1e-6);

  return {
    mean,
    variance
  };
}

export function expectedImprovement(mean, variance, best, explorationBias = 0.04) {
  const standardDeviation = Math.sqrt(Math.max(variance, 1e-6));
  if (standardDeviation < 1e-5) {
    return 0;
  }

  const improvement = mean - best - explorationBias;
  const zScore = improvement / standardDeviation;
  return improvement * normalCdf(zScore) + standardDeviation * normalPdf(zScore);
}
