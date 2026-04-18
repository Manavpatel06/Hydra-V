import { clamp } from "../../core/utils.js";

export function hannWindow(size) {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(size - 1, 1)));
  }
  return window;
}

export function dftMagnitude(realSignal) {
  const n = realSignal.length;
  const magnitudes = new Float64Array(Math.floor(n / 2));

  for (let k = 0; k < magnitudes.length; k += 1) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t += 1) {
      const angle = (2 * Math.PI * k * t) / n;
      re += realSignal[t] * Math.cos(angle);
      im -= realSignal[t] * Math.sin(angle);
    }
    magnitudes[k] = Math.sqrt(re * re + im * im);
  }

  return magnitudes;
}

export function removeLinearTrend(values) {
  if (values.length < 2) {
    return values.slice();
  }

  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  const slope = (last - first) / Math.max(n - 1, 1);

  return values.map((value, index) => value - (first + slope * index));
}

export function normalize(values) {
  if (!values.length) {
    return [];
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance) || 1;

  return values.map((value) => (value - mean) / std);
}

export function estimateDominantFrequency(signal, samplingHz, minHz, maxHz) {
  if (!signal.length || samplingHz <= 0) {
    return null;
  }

  const detrended = removeLinearTrend(signal);
  const norm = normalize(detrended);
  const window = hannWindow(norm.length);
  const windowed = norm.map((value, index) => value * window[index]);
  const magnitudes = dftMagnitude(windowed);

  let bestFreq = null;
  let bestMag = 0;

  for (let k = 1; k < magnitudes.length; k += 1) {
    const frequency = (k * samplingHz) / norm.length;
    if (frequency < minHz || frequency > maxHz) {
      continue;
    }

    if (magnitudes[k] > bestMag) {
      bestMag = magnitudes[k];
      bestFreq = frequency;
    }
  }

  return bestFreq;
}

export function estimateRrIntervalsFromSignal(signal, timestampsMs, minBpm = 42, maxBpm = 200) {
  if (signal.length < 8 || timestampsMs.length !== signal.length) {
    return [];
  }

  const z = normalize(removeLinearTrend(signal));
  const threshold = 0.65;
  const minMs = (60_000 / maxBpm) * 0.75;
  const maxMs = (60_000 / minBpm) * 1.5;

  const peaks = [];
  for (let i = 1; i < z.length - 1; i += 1) {
    if (z[i] > threshold && z[i] > z[i - 1] && z[i] >= z[i + 1]) {
      const t = timestampsMs[i];
      const prev = peaks.at(-1);
      if (!prev || t - prev >= minMs) {
        peaks.push(t);
      }
    }
  }

  const rr = [];
  for (let i = 1; i < peaks.length; i += 1) {
    const delta = peaks[i] - peaks[i - 1];
    if (delta >= minMs && delta <= maxMs) {
      rr.push(delta);
    }
  }

  return rr;
}

export function rmssd(rrIntervalsMs) {
  if (rrIntervalsMs.length < 2) {
    return null;
  }

  let sumSq = 0;
  let n = 0;

  for (let i = 1; i < rrIntervalsMs.length; i += 1) {
    const diff = rrIntervalsMs[i] - rrIntervalsMs[i - 1];
    sumSq += diff * diff;
    n += 1;
  }

  if (!n) {
    return null;
  }

  return Math.sqrt(sumSq / n);
}

export function mean(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function estimateSkinMode(rgb) {
  const [r, g, b] = rgb;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const chroma = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);

  if (luminance < 0.4 || chroma < 28) {
    return "pos";
  }
  return "green";
}

export function computeReadinessScore({ hrvRmssdMs, symmetryDeltaPct, microsaccadeHz }) {
  const hrvNorm = clamp((Number(hrvRmssdMs) - 15) / (80 - 15), 0, 1);
  const symmetryNorm = 1 - clamp(Number(symmetryDeltaPct) / 30, 0, 1);

  let microNorm = 0.4;
  if (Number.isFinite(microsaccadeHz)) {
    if (microsaccadeHz <= 0.5) {
      microNorm = 0.1;
    } else if (microsaccadeHz >= 1.8) {
      microNorm = 1;
    } else {
      microNorm = clamp((microsaccadeHz - 0.5) / (1.8 - 0.5), 0, 1);
    }
  }

  const score = (hrvNorm * 0.45 + symmetryNorm * 0.35 + microNorm * 0.2) * 10;
  return clamp(score, 0, 10);
}
