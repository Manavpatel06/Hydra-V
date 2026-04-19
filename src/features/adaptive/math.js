export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function mean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

export function stdDev(values) {
  if (!Array.isArray(values) || values.length < 2) {
    return 0;
  }

  const avg = mean(values);
  const variance = values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function dot(a, b) {
  return a.reduce((sum, item, index) => sum + item * b[index], 0);
}

export function matrixVectorMultiply(matrix, vector) {
  return matrix.map((row) => dot(row, vector));
}

export function identityMatrix(size) {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 1 : 0))
  );
}

export function invertMatrix(matrix) {
  const size = matrix.length;
  if (!size || matrix.some((row) => row.length !== size)) {
    throw new Error("Matrix must be non-empty and square.");
  }

  const identity = identityMatrix(size);
  const augmented = matrix.map((row, index) => [...row, ...identity[index]]);

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row;
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-12) {
      throw new Error("Matrix is singular.");
    }

    if (maxRow !== pivot) {
      [augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]];
    }

    const pivotValue = augmented[pivot][pivot];
    for (let col = 0; col < size * 2; col += 1) {
      augmented[pivot][col] /= pivotValue;
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue;
      }

      const factor = augmented[row][pivot];
      for (let col = 0; col < size * 2; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col];
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}
