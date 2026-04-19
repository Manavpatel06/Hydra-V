import { clamp } from "../../core/utils.js";

export const HACKATHON_RESOURCE_CATALOG = Object.freeze({
  movementDatasets: [
    {
      id: "ui-prmd",
      name: "UI-PRMD",
      focus: "PT movement quality (correct vs incorrect), joint angles",
      url: "http://webpages.uidaho.edu/ui-prmd/"
    },
    {
      id: "opencap",
      name: "OpenCap (Stanford)",
      focus: "3D kinematics from RGB video",
      url: "https://app.opencap.ai"
    },
    {
      id: "rehab24-6",
      name: "REHAB24-6",
      focus: "Rehab exercises with form labels and segmentation",
      url: "https://zenodo.org/records/13305826"
    },
    {
      id: "mobiphysio",
      name: "MobiPhysio",
      focus: "ROM exercise videos with expert scoring",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12992533/"
    },
    {
      id: "uco-rehab",
      name: "UCO Physical Rehabilitation Dataset",
      focus: "Upper and lower body rehab sequences",
      url: "https://github.com/AVAuco/ucophyrehab"
    },
    {
      id: "addbiomechanics",
      name: "AddBiomechanics",
      focus: "Large-scale biomechanics, gait, squat, sports movement",
      url: "https://addbiomechanics.org/download_data.html"
    },
    {
      id: "health-gait",
      name: "Health & Gait",
      focus: "Gait videos with optical flow and pose",
      url: "https://github.com/AVAuco/healthgait"
    },
    {
      id: "gavd",
      name: "GAVD",
      focus: "Gait abnormality video annotations",
      url: "https://github.com/Rahmyyy/GAVD"
    }
  ],
  contactlessVitalsDatasets: [
    {
      id: "ubfc-rppg",
      name: "UBFC-rPPG",
      focus: "Facial video + ground-truth PPG",
      url: "https://sites.google.com/view/ybenezeth/ubfcrppg"
    },
    {
      id: "pure",
      name: "PURE",
      focus: "Controlled rPPG scenarios (motion + talking)",
      url: "https://www.tu-ilmenau.de/en/university/faculties/faculty-of-computer-science-and-automation/profile/institutes-and-groups/institute-of-technical-informatics-and-systems-engineering/group-for-neuroinformatics-and-cognitive-robotics/data-sets-code/pure"
    },
    {
      id: "cohface",
      name: "COHFACE",
      focus: "Face video with PPG + respiration ground truth",
      url: "https://www.idiap.ch/en/scientific-research/data/cohface"
    }
  ],
  tools: [
    { id: "mediapipe", name: "MediaPipe Pose/FaceMesh", use: "landmarks and motion tracking" },
    { id: "opencv", name: "OpenCV", use: "video processing and optical flow" },
    { id: "scipy", name: "SciPy", use: "signal filtering and frequency analysis" }
  ]
});

const AMPLITUDE_TARGETS = Object.freeze({
  raise: 0.2,
  cross: 0.16,
  "elbow-drive": 0.12,
  march: 0.17,
  "side-step": 0.16,
  hinge: 0.12,
  "mini-squat": 0.9,
  "step-lift": 0.1,
  extension: 0.14
});

const EXERCISE_BLUEPRINTS = Object.freeze({
  shoulder: [
    {
      id: "raise",
      label: "Sky Reach",
      description: "Lift wrist above shoulder and return with control.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["mobiphysio", "uco-rehab", "rehab24-6"],
      retrieval: {
        intensity: 0.58,
        complexity: 0.34,
        stability: 0.46,
        mobility: 0.78,
        fatigueSuitability: 0.74
      }
    },
    {
      id: "cross",
      label: "Cross Reach",
      description: "Reach across midline and return.",
      reps: { low: 5, mid: 6, high: 8 },
      datasetRefs: ["ui-prmd", "mobiphysio", "rehab24-6"],
      retrieval: {
        intensity: 0.45,
        complexity: 0.52,
        stability: 0.72,
        mobility: 0.42,
        fatigueSuitability: 0.82
      }
    },
    {
      id: "elbow-drive",
      label: "Elbow Drive",
      description: "Drive elbow back, then release to neutral.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["uco-rehab", "rehab24-6", "addbiomechanics"],
      retrieval: {
        intensity: 0.66,
        complexity: 0.61,
        stability: 0.67,
        mobility: 0.38,
        fatigueSuitability: 0.52
      }
    }
  ],
  hip: [
    {
      id: "march",
      label: "Power March",
      description: "Lift knee above hip and return.",
      reps: { low: 8, mid: 10, high: 12 },
      datasetRefs: ["ui-prmd", "opencap", "addbiomechanics"],
      retrieval: {
        intensity: 0.65,
        complexity: 0.42,
        stability: 0.45,
        mobility: 0.52,
        fatigueSuitability: 0.56
      }
    },
    {
      id: "side-step",
      label: "Side Step",
      description: "Move ankle away from hip and return.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["rehab24-6", "uco-rehab", "health-gait"],
      retrieval: {
        intensity: 0.51,
        complexity: 0.56,
        stability: 0.79,
        mobility: 0.33,
        fatigueSuitability: 0.77
      }
    },
    {
      id: "hinge",
      label: "Hip Hinge",
      description: "Small hinge and return tall posture.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["ui-prmd", "opencap", "addbiomechanics"],
      retrieval: {
        intensity: 0.48,
        complexity: 0.44,
        stability: 0.84,
        mobility: 0.41,
        fatigueSuitability: 0.86
      }
    }
  ],
  knee: [
    {
      id: "mini-squat",
      label: "Mini Squat",
      description: "Lower into mini squat and stand tall.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["ui-prmd", "opencap", "addbiomechanics"],
      retrieval: {
        intensity: 0.72,
        complexity: 0.62,
        stability: 0.64,
        mobility: 0.3,
        fatigueSuitability: 0.43
      }
    },
    {
      id: "step-lift",
      label: "Step Lift",
      description: "Lift ankle, then place down softly.",
      reps: { low: 8, mid: 10, high: 12 },
      datasetRefs: ["rehab24-6", "health-gait", "gavd"],
      retrieval: {
        intensity: 0.54,
        complexity: 0.47,
        stability: 0.74,
        mobility: 0.39,
        fatigueSuitability: 0.73
      }
    },
    {
      id: "extension",
      label: "Knee Extension",
      description: "Extend leg forward, then return.",
      reps: { low: 6, mid: 8, high: 10 },
      datasetRefs: ["mobiphysio", "uco-rehab", "rehab24-6"],
      retrieval: {
        intensity: 0.42,
        complexity: 0.37,
        stability: 0.78,
        mobility: 0.48,
        fatigueSuitability: 0.89
      }
    }
  ]
});

function asFinite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizePlannerContext(context = {}) {
  const readinessScore = clamp(asFinite(context.readinessScore, 5.5), 0, 10);
  const symmetryDeltaPct = clamp(asFinite(context.symmetryDeltaPct, 11), 0, 35);
  const cnsFatigue = Boolean(context.cnsFatigue);
  const cameraSignalQuality = clamp(asFinite(context.cameraSignalQuality, 0.68), 0.15, 1);
  const poseQuality = clamp(asFinite(context.poseQuality, cameraSignalQuality), 0.15, 1);
  const sensorQuality = Math.min(cameraSignalQuality, poseQuality);
  const heartRateBpm = asFinite(context.heartRateBpm, 82);
  const breathRatePerMin = asFinite(context.breathRatePerMin, 16);
  return {
    readinessScore,
    symmetryDeltaPct,
    cnsFatigue,
    cameraSignalQuality,
    poseQuality,
    sensorQuality,
    heartRateBpm,
    breathRatePerMin
  };
}

function buildRetrievalQuery(context, difficulty) {
  const readinessNorm = clamp(context.readinessScore / 10, 0, 1);
  const symmetrySeverity = clamp(context.symmetryDeltaPct / 22, 0, 1);
  const fatiguePenalty = context.cnsFatigue ? 0.2 : 0;
  const stressPenalty = clamp((context.heartRateBpm - 86) / 60, -0.12, 0.2);
  const breathPenalty = clamp((context.breathRatePerMin - 16) / 24, -0.08, 0.12);

  const targetIntensity = clamp(
    0.36 + readinessNorm * 0.52 - symmetrySeverity * 0.18 - fatiguePenalty - stressPenalty - breathPenalty,
    0.2,
    0.9
  );
  const targetComplexity = clamp(
    context.sensorQuality * 0.62 + readinessNorm * 0.28 - (context.cnsFatigue ? 0.16 : 0),
    0.2,
    0.92
  );
  const targetStability = clamp(
    0.34 + symmetrySeverity * 0.5 + (context.cnsFatigue ? 0.1 : 0),
    0.25,
    0.96
  );
  const targetMobility = clamp(
    0.38 + (1 - readinessNorm) * 0.2 + (context.cnsFatigue ? 0.1 : 0),
    0.2,
    0.95
  );
  const targetFatigueSuitability = context.cnsFatigue ? 0.88 : 0.58;
  const lowReadinessMode = difficulty.level === "low" || readinessNorm < 0.43;

  return {
    readinessNorm,
    symmetrySeverity,
    cnsFatigue: context.cnsFatigue,
    sensorQuality: context.sensorQuality,
    targetIntensity,
    targetComplexity,
    targetStability,
    targetMobility,
    targetFatigueSuitability,
    lowReadinessMode
  };
}

function describeRetrievalReason(parts) {
  if (!parts.length) {
    return "General context fit";
  }
  return parts.slice(0, 2).join(" + ");
}

function scoreBlueprintForQuery(blueprint, query) {
  const profile = blueprint.retrieval || {};
  const intensity = asFinite(profile.intensity, 0.5);
  const complexity = asFinite(profile.complexity, 0.5);
  const stability = asFinite(profile.stability, 0.5);
  const mobility = asFinite(profile.mobility, 0.5);
  const fatigueSuitability = asFinite(profile.fatigueSuitability, 0.5);

  const intensityDelta = Math.abs(intensity - query.targetIntensity);
  const complexityDelta = Math.abs(complexity - query.targetComplexity);
  const stabilityDelta = Math.abs(stability - query.targetStability);
  const mobilityDelta = Math.abs(mobility - query.targetMobility);
  const fatigueDelta = Math.abs(fatigueSuitability - query.targetFatigueSuitability);

  let score = 1;
  score -= intensityDelta * 0.31;
  score -= complexityDelta * 0.2;
  score -= stabilityDelta * 0.2;
  score -= mobilityDelta * 0.15;
  score -= fatigueDelta * 0.14;

  if (query.sensorQuality < 0.45 && complexity > 0.62) {
    score -= 0.08;
  }
  if (query.cnsFatigue && intensity > 0.66) {
    score -= 0.08;
  }
  if (!query.cnsFatigue && query.readinessNorm >= 0.7 && intensity >= 0.62) {
    score += 0.04;
  }

  const reasons = [];
  if (intensityDelta <= 0.16) reasons.push("intensity match");
  if (stabilityDelta <= 0.16) reasons.push("stability support");
  if (complexityDelta <= 0.16) reasons.push("tracking-quality fit");
  if (query.cnsFatigue && fatigueSuitability >= 0.75) reasons.push("fatigue-safe");
  if (mobilityDelta <= 0.18) reasons.push("mobility need fit");

  return {
    score: clamp(score, 0, 1),
    reason: describeRetrievalReason(reasons)
  };
}

function retrieveBlueprints(zone, context, difficulty) {
  const pool = EXERCISE_BLUEPRINTS[zone] || EXERCISE_BLUEPRINTS.shoulder;
  const normalizedContext = normalizePlannerContext(context);
  const query = buildRetrievalQuery(normalizedContext, difficulty);

  const ranked = pool
    .map((blueprint) => {
      const result = scoreBlueprintForQuery(blueprint, query);
      return {
        blueprint,
        score: result.score,
        reason: result.reason
      };
    })
    .sort((a, b) => b.score - a.score);

  const targetCount = query.lowReadinessMode ? 2 : 3;
  const selected = ranked.slice(0, Math.min(targetCount, ranked.length));
  const confidence = clamp(
    normalizedContext.sensorQuality * 0.45
      + (Number.isFinite(context.readinessScore) ? 0.25 : 0.1)
      + (Number.isFinite(context.symmetryDeltaPct) ? 0.2 : 0.1)
      + (selected.length / Math.max(pool.length, 1)) * 0.1,
    0,
    1
  );

  const rationale = query.lowReadinessMode
    ? "Retrieval mode selected lower-load exercises due to readiness/fatigue context."
    : "Retrieval mode selected highest-fit exercises from zone dataset signatures.";

  return {
    selected,
    ranked,
    rationale,
    confidence,
    query: {
      readiness: round(normalizedContext.readinessScore, 2),
      symmetry: round(normalizedContext.symmetryDeltaPct, 2),
      sensorQuality: round(normalizedContext.sensorQuality, 2),
      targetIntensity: round(query.targetIntensity, 2),
      targetComplexity: round(query.targetComplexity, 2),
      targetStability: round(query.targetStability, 2),
      targetMobility: round(query.targetMobility, 2)
    }
  };
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getSideIndexes(side) {
  return side === "right"
    ? { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 }
    : { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
}

function angleDeg(a, b, c) {
  if (!a || !b || !c) {
    return null;
  }

  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;

  const dot = abx * cbx + aby * cby;
  const mag1 = Math.sqrt(abx * abx + aby * aby) || 1;
  const mag2 = Math.sqrt(cbx * cbx + cby * cby) || 1;
  const cos = clamp(dot / (mag1 * mag2), -1, 1);
  return Math.acos(cos) * (180 / Math.PI);
}

function chooseDifficulty(context = {}) {
  const readiness = Number(context.readinessScore);
  const symmetry = Number(context.symmetryDeltaPct);
  const cameraSignalQuality = Number(context.cameraSignalQuality);
  const poseQuality = Number(context.poseQuality);
  const signalQuality = Number.isFinite(cameraSignalQuality) && Number.isFinite(poseQuality)
    ? Math.min(cameraSignalQuality, poseQuality)
    : Number.isFinite(cameraSignalQuality)
      ? cameraSignalQuality
      : poseQuality;
  const cnsFatigue = Boolean(context.cnsFatigue);

  let score = 0;
  if (Number.isFinite(readiness)) {
    if (readiness >= 7) {
      score += 2;
    } else if (readiness >= 5) {
      score += 1;
    } else {
      score -= 1;
    }
  }

  if (Number.isFinite(symmetry)) {
    if (symmetry <= 8) {
      score += 1;
    } else if (symmetry >= 15) {
      score -= 1;
    }
  }

  if (Number.isFinite(signalQuality) && signalQuality < 0.45) {
    score -= 1;
  }

  if (cnsFatigue) {
    score -= 1;
  } else {
    score += 1;
  }

  if (score >= 3) {
    return { level: "high", rationale: "High readiness and stable movement quality." };
  }
  if (score <= 0) {
    return { level: "low", rationale: "Conservative plan due to readiness/fatigue/signal constraints." };
  }
  return { level: "mid", rationale: "Balanced progression from current scan state." };
}

function buildSampleEvaluator(actionId, side, difficultyLevel) {
  const i = getSideIndexes(side);
  const high = difficultyLevel === "high";
  const low = difficultyLevel === "low";
  const upScale = high ? 1.12 : low ? 0.86 : 1;
  const downScale = high ? 0.9 : low ? 1.15 : 1;

  return (landmarks) => {
    if (!Array.isArray(landmarks)) {
      return null;
    }

    if (actionId === "raise") {
      const shoulder = landmarks[i.shoulder];
      const wrist = landmarks[i.wrist];
      if (!shoulder || !wrist) return null;
      const delta = shoulder.y - wrist.y;
      return {
        up: delta > (0.04 * upScale),
        down: delta < (-0.015 * downScale),
        amplitude: Math.abs(delta)
      };
    }

    if (actionId === "cross") {
      const shoulder = landmarks[i.shoulder];
      const wrist = landmarks[i.wrist];
      const oppositeShoulder = landmarks[side === "right" ? 11 : 12];
      if (!shoulder || !wrist || !oppositeShoulder) return null;
      const midline = (shoulder.x + oppositeShoulder.x) / 2;
      const crossed = side === "right" ? wrist.x < midline : wrist.x > midline;
      const neutral = side === "right"
        ? wrist.x > shoulder.x - (0.02 * downScale)
        : wrist.x < shoulder.x + (0.02 * downScale);
      return {
        up: crossed,
        down: neutral,
        amplitude: Math.abs(wrist.x - midline)
      };
    }

    if (actionId === "elbow-drive") {
      const shoulder = landmarks[i.shoulder];
      const elbow = landmarks[i.elbow];
      if (!shoulder || !elbow) return null;
      const drive = side === "right"
        ? (elbow.x - shoulder.x) > (0.07 * upScale)
        : (shoulder.x - elbow.x) > (0.07 * upScale);
      const neutral = Math.abs(elbow.x - shoulder.x) < (0.04 * downScale);
      return {
        up: drive,
        down: neutral,
        amplitude: Math.abs(elbow.x - shoulder.x)
      };
    }

    if (actionId === "march") {
      const hip = landmarks[i.hip];
      const knee = landmarks[i.knee];
      if (!hip || !knee) return null;
      const lift = hip.y - knee.y;
      return {
        up: lift > (0.03 * upScale),
        down: lift < (-0.01 * downScale),
        amplitude: Math.abs(lift)
      };
    }

    if (actionId === "side-step") {
      const hip = landmarks[i.hip];
      const ankle = landmarks[i.ankle];
      if (!hip || !ankle) return null;
      const lateral = Math.abs(ankle.x - hip.x);
      return {
        up: lateral > (0.13 * upScale),
        down: lateral < (0.08 * downScale),
        amplitude: lateral
      };
    }

    if (actionId === "hinge") {
      const shoulder = landmarks[i.shoulder];
      const hip = landmarks[i.hip];
      if (!shoulder || !hip) return null;
      const forward = Math.abs(shoulder.x - hip.x);
      return {
        up: forward > (0.1 * upScale),
        down: forward < (0.06 * downScale),
        amplitude: forward
      };
    }

    if (actionId === "mini-squat") {
      const hip = landmarks[i.hip];
      const knee = landmarks[i.knee];
      const ankle = landmarks[i.ankle];
      const angle = angleDeg(hip, knee, ankle);
      if (!Number.isFinite(angle)) return null;
      return {
        up: angle < (125 / upScale),
        down: angle > (155 * downScale),
        amplitude: clamp((170 - angle) / 60, 0, 1)
      };
    }

    if (actionId === "step-lift") {
      const ankle = landmarks[i.ankle];
      const oppositeAnkle = landmarks[side === "right" ? 27 : 28];
      if (!ankle || !oppositeAnkle) return null;
      const lift = oppositeAnkle.y - ankle.y;
      return {
        up: lift > (0.035 * upScale),
        down: lift < (0.01 * downScale),
        amplitude: Math.abs(lift)
      };
    }

    if (actionId === "extension") {
      const knee = landmarks[i.knee];
      const ankle = landmarks[i.ankle];
      if (!knee || !ankle) return null;
      const extension = Math.abs(ankle.x - knee.x);
      return {
        up: extension > (0.12 * upScale),
        down: extension < (0.07 * downScale),
        amplitude: extension
      };
    }

    return null;
  };
}

export function amplitudeTarget(actionId) {
  return AMPLITUDE_TARGETS[actionId] || 0.15;
}

export function buildZoneActions(zone, side, context = {}) {
  const normalizedZone = zone === "hip" || zone === "knee" ? zone : "shoulder";
  const difficulty = chooseDifficulty(context);
  const retrieval = retrieveBlueprints(normalizedZone, context, difficulty);

  const actions = retrieval.selected.map((entry) => {
    const blueprint = entry.blueprint;
    const repsTarget = Number(blueprint.reps?.[difficulty.level] ?? blueprint.reps?.mid ?? 8);
    return {
      id: blueprint.id,
      label: blueprint.label,
      description: blueprint.description,
      repsTarget,
      datasetRefs: [...(blueprint.datasetRefs || [])],
      retrievalScore: round(entry.score, 3),
      retrievalReason: entry.reason,
      sample: buildSampleEvaluator(blueprint.id, side, difficulty.level)
    };
  });

  const datasetIds = [...new Set(actions.flatMap((action) => action.datasetRefs || []))];
  const plannerRationale = `${difficulty.rationale} ${retrieval.rationale}`.trim();

  return {
    zone: normalizedZone,
    side,
    difficulty,
    plannerMode: "dataset-retrieval-v1",
    plannerRationale,
    datasetIds,
    retrieval: {
      mode: "dataset-retrieval-v1",
      confidence: retrieval.confidence,
      query: retrieval.query,
      selectedActionIds: actions.map((action) => action.id),
      candidates: retrieval.ranked.map((entry) => ({
        id: entry.blueprint.id,
        label: entry.blueprint.label,
        score: round(entry.score, 3),
        reason: entry.reason
      }))
    },
    actions
  };
}

export function getGuideResourceCatalog() {
  return {
    movementDatasets: HACKATHON_RESOURCE_CATALOG.movementDatasets.map((item) => ({ ...item })),
    contactlessVitalsDatasets: HACKATHON_RESOURCE_CATALOG.contactlessVitalsDatasets.map((item) => ({ ...item })),
    tools: HACKATHON_RESOURCE_CATALOG.tools.map((item) => ({ ...item }))
  };
}
