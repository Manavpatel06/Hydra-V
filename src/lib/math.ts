export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, item) => sum + item, 0) / values.length

export const stdDev = (values: number[]): number => {
  if (values.length < 2) {
    return 0
  }

  const avg = mean(values)
  const variance =
    values.reduce((sum, item) => sum + (item - avg) ** 2, 0) / (values.length - 1)

  return Math.sqrt(variance)
}

export const dot = (a: number[], b: number[]): number =>
  a.reduce((sum, item, index) => sum + item * b[index], 0)

export const matrixVectorMultiply = (matrix: number[][], vector: number[]): number[] =>
  matrix.map((row) => dot(row, vector))

export const matrixMultiply = (a: number[][], b: number[][]): number[][] => {
  const rows = a.length
  const cols = b[0].length
  const shared = b.length
  const result = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0))

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let value = 0
      for (let index = 0; index < shared; index += 1) {
        value += a[row][index] * b[index][col]
      }
      result[row][col] = value
    }
  }

  return result
}

export const identityMatrix = (size: number): number[][] =>
  Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 1 : 0)),
  )

export const invertMatrix = (matrix: number[][]): number[][] => {
  const size = matrix.length
  if (size === 0 || matrix.some((row) => row.length !== size)) {
    throw new Error('Matrix must be non-empty and square.')
  }

  const augmented = matrix.map((row, index) => [...row, ...identityMatrix(size)[index]])

  for (let pivot = 0; pivot < size; pivot += 1) {
    let maxRow = pivot
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[maxRow][pivot])) {
        maxRow = row
      }
    }

    if (Math.abs(augmented[maxRow][pivot]) < 1e-12) {
      throw new Error('Matrix is singular.')
    }

    if (maxRow !== pivot) {
      ;[augmented[pivot], augmented[maxRow]] = [augmented[maxRow], augmented[pivot]]
    }

    const pivotValue = augmented[pivot][pivot]
    for (let col = 0; col < size * 2; col += 1) {
      augmented[pivot][col] /= pivotValue
    }

    for (let row = 0; row < size; row += 1) {
      if (row === pivot) {
        continue
      }

      const factor = augmented[row][pivot]
      for (let col = 0; col < size * 2; col += 1) {
        augmented[row][col] -= factor * augmented[pivot][col]
      }
    }
  }

  return augmented.map((row) => row.slice(size))
}
