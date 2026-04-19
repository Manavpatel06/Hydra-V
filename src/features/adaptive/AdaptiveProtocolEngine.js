import { expectedImprovement, predictGaussianProcess, trainGaussianProcess } from "./gaussianProcess.js";
import { clamp, mean, stdDev } from "./math.js";
import { compositeOutcomeScore } from "./scoring.js";

const MIN_VIBRATION = 20;
const MAX_VIBRATION = 80;
const MIN_DURATION = 8;
const MAX_DURATION = 30;

const PARAMETER_LABELS = {
  lightRatio: "Light Ratio",
  vibrationHz: "Vibration",
  thermalGradient: "Thermal Gradient",
  padDurationMin: "Pad Duration",
  resonanceBias: "Resonance Bias",
  contralateralTargeting: "Contralateral"
};

function rngFromSeed(seed) {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let value = current;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function defaultProtocol() {
  return {
    lightRatio: 0.58,
    vibrationHz: 44,
    thermalGradient: 0.5,
    padDurationMin: 16,
    resonanceBias: 0.52,
    contralateralTargeting: false
  };
}

function normalizeProtocol(protocol) {
  return [
    clamp(protocol.lightRatio, 0, 1),
    clamp((protocol.vibrationHz - MIN_VIBRATION) / (MAX_VIBRATION - MIN_VIBRATION), 0, 1),
    clamp(protocol.thermalGradient, 0, 1),
    clamp((protocol.padDurationMin - MIN_DURATION) / (MAX_DURATION - MIN_DURATION), 0, 1),
    clamp(protocol.resonanceBias, 0, 1),
    protocol.contralateralTargeting ? 1 : 0
  ];
}

function denormalizeProtocol(features) {
  return {
    lightRatio: clamp(features[0], 0, 1),
    vibrationHz: Math.round(MIN_VIBRATION + clamp(features[1], 0, 1) * (MAX_VIBRATION - MIN_VIBRATION)),
    thermalGradient: clamp(features[2], 0, 1),
    padDurationMin: Math.round(MIN_DURATION + clamp(features[3], 0, 1) * (MAX_DURATION - MIN_DURATION)),
    resonanceBias: clamp(features[4], 0, 1),
    contralateralTargeting: features[5] >= 0.5
  };
}

export function inferModality(protocol) {
  const thermalSignal = protocol.thermalGradient;
  const lightSignal = protocol.lightRatio;
  const resonanceSignal = protocol.resonanceBias;

  if (lightSignal > thermalSignal && lightSignal > resonanceSignal) {
    return "photobiomodulation";
  }
  if (resonanceSignal > lightSignal && resonanceSignal > thermalSignal) {
    return "resonance";
  }
  if (thermalSignal > lightSignal && thermalSignal > resonanceSignal) {
    return "thermal";
  }

  return "hybrid";
}

function candidateSet(latest, size, seed) {
  const random = rngFromSeed(seed);
  const center = normalizeProtocol(latest);
  const candidates = [];

  for (let index = 0; index < size; index += 1) {
    const local = center.map((point, axis) => {
      const jitter = (random() - 0.5) * ((axis === 1 || axis === 3) ? 0.4 : 0.25);
      return clamp(point + jitter, 0, 1);
    });

    local[5] = random() > 0.55 ? 1 : 0;
    candidates.push(local);

    candidates.push([
      random(),
      random(),
      random(),
      random(),
      random(),
      random() > 0.5 ? 1 : 0
    ]);
  }

  return candidates;
}

function confidenceForNumericAxis(values, observations) {
  const spread = clamp(stdDev(values), 0, 0.45);
  return clamp(0.25 + Math.min(observations / 9, 0.55) + spread * 0.4, 0.2, 0.96);
}

function buildParameterInsights(protocol, sessions) {
  const normalized = sessions.map((session) => normalizeProtocol(session.protocol));
  const observations = sessions.length;

  const lightValues = normalized.map((point) => point[0]);
  const vibrationValues = normalized.map((point) => point[1]);
  const thermalValues = normalized.map((point) => point[2]);
  const durationValues = normalized.map((point) => point[3]);
  const resonanceValues = normalized.map((point) => point[4]);
  const contraValues = normalized.map((point) => point[5]);

  return [
    {
      key: "lightRatio",
      label: PARAMETER_LABELS.lightRatio,
      value: protocol.lightRatio,
      range: [0, 1],
      confidence: confidenceForNumericAxis(lightValues, observations)
    },
    {
      key: "vibrationHz",
      label: PARAMETER_LABELS.vibrationHz,
      value: protocol.vibrationHz,
      range: [MIN_VIBRATION, MAX_VIBRATION],
      confidence: confidenceForNumericAxis(vibrationValues, observations)
    },
    {
      key: "thermalGradient",
      label: PARAMETER_LABELS.thermalGradient,
      value: protocol.thermalGradient,
      range: [0, 1],
      confidence: confidenceForNumericAxis(thermalValues, observations)
    },
    {
      key: "padDurationMin",
      label: PARAMETER_LABELS.padDurationMin,
      value: protocol.padDurationMin,
      range: [MIN_DURATION, MAX_DURATION],
      confidence: confidenceForNumericAxis(durationValues, observations)
    },
    {
      key: "resonanceBias",
      label: PARAMETER_LABELS.resonanceBias,
      value: protocol.resonanceBias,
      range: [0, 1],
      confidence: confidenceForNumericAxis(resonanceValues, observations)
    },
    {
      key: "contralateralTargeting",
      label: PARAMETER_LABELS.contralateralTargeting,
      value: protocol.contralateralTargeting ? 1 : 0,
      range: [0, 1],
      confidence: clamp(0.25 + mean(contraValues) * 0.35 + observations * 0.04, 0.2, 0.95)
    }
  ];
}

function plateauSignal(sessions, key, tolerance) {
  const recent = sessions.slice(-4);
  if (recent.length < 4) {
    return null;
  }

  const values = recent.map((session) => {
    const value = session.protocol[key];
    return typeof value === "boolean" ? (value ? 1 : 0) : value;
  });
  const outcomes = recent.map((session) => compositeOutcomeScore(session.outcomes));
  const span = Math.max(...values) - Math.min(...values);
  const trend = outcomes[outcomes.length - 1] - outcomes[0];

  if (span > tolerance || trend > 0.9) {
    return null;
  }

  const baseline = mean(values);
  if (key === "vibrationHz") {
    const suggestion = clamp(Math.round((baseline + 12) / 5) * 5, MIN_VIBRATION, MAX_VIBRATION);
    return `Vibration response is plateauing near ${Math.round(baseline)} Hz. Try ${suggestion} Hz or add contralateral targeting next session.`;
  }

  if (key === "thermalGradient") {
    const suggestion = clamp(baseline + 0.14, 0, 1);
    return `Thermal adaptation is flattening near ${baseline.toFixed(2)}. Increase gradient toward ${suggestion.toFixed(2)} for exploration.`;
  }

  if (key === "lightRatio") {
    const suggestion = clamp(baseline + 0.12, 0, 1);
    return `Light ratio impact is flattening near ${baseline.toFixed(2)}. Test a shift toward ${suggestion.toFixed(2)} for improved response.`;
  }

  return null;
}

function warmupRecommendation(sessions, usingWebGPU) {
  const latest = sessions.at(-1)?.protocol ?? defaultProtocol();
  const scoreDrift = sessions.at(-1) ? compositeOutcomeScore(sessions.at(-1).outcomes) : 0;
  const protocol = {
    ...latest,
    vibrationHz: clamp(Math.round((latest.vibrationHz + (scoreDrift > 7 ? 2 : 6)) / 2), 26, 68),
    padDurationMin: clamp(latest.padDurationMin + 1, MIN_DURATION, MAX_DURATION)
  };

  const parameterInsights = buildParameterInsights(protocol, sessions);
  const confidence = mean(parameterInsights.map((item) => item.confidence));

  return {
    protocol,
    expectedImprovement: 0.42,
    uncertainty: 0.61,
    confidence,
    modelMode: "warmup",
    rationale: [
      "Warmup mode is active until at least 3 sessions are available for stable regression.",
      `Current strategy leans on the latest ${inferModality(protocol)} response pattern.`,
      "After the next completed session, expected-improvement optimization will engage automatically."
    ],
    warnings: [],
    parameterInsights,
    computedAt: new Date().toISOString(),
    usingWebGPU
  };
}

export function recommendProtocol(sessions, usingWebGPU) {
  if (sessions.length < 3) {
    return warmupRecommendation(sessions, usingWebGPU);
  }

  const x = sessions.map((session) => normalizeProtocol(session.protocol));
  const y = sessions.map((session) => compositeOutcomeScore(session.outcomes));
  const model = trainGaussianProcess(x, y);

  if (!model) {
    return warmupRecommendation(sessions, usingWebGPU);
  }

  const latest = sessions.at(-1)?.protocol ?? defaultProtocol();
  const candidates = candidateSet(latest, 140, sessions.length * 17 + 43);

  let bestVector = normalizeProtocol(latest);
  let bestExpectedImprovement = -Infinity;
  let bestUncertainty = 0.25;
  let bestMean = 0;

  for (const candidate of candidates) {
    const prediction = predictGaussianProcess(model, candidate);
    const gain = expectedImprovement(prediction.mean, prediction.variance, model.yBest, 0.05);

    if (gain > bestExpectedImprovement) {
      bestExpectedImprovement = gain;
      bestVector = candidate;
      bestUncertainty = Math.sqrt(prediction.variance);
      bestMean = prediction.mean;
    }
  }

  const protocol = denormalizeProtocol(bestVector);
  const parameterInsights = buildParameterInsights(protocol, sessions);
  const confidence = mean(parameterInsights.map((item) => item.confidence));
  const warnings = [
    plateauSignal(sessions, "vibrationHz", 5),
    plateauSignal(sessions, "thermalGradient", 0.08),
    plateauSignal(sessions, "lightRatio", 0.08)
  ].filter(Boolean);

  return {
    protocol,
    expectedImprovement: clamp(bestExpectedImprovement, 0, 2.5),
    uncertainty: clamp(bestUncertainty, 0.05, 2),
    confidence,
    modelMode: "gaussian-process",
    rationale: [
      `N-of-1 model trained on ${sessions.length} sessions with expected-improvement candidate search.`,
      `Predicted composite gain ${bestMean.toFixed(2)} with targeted exploration to avoid local plateaus.`,
      `${inferModality(protocol)}-leaning protocol selected for the next session.`
    ],
    warnings,
    parameterInsights,
    computedAt: new Date().toISOString(),
    usingWebGPU
  };
}
