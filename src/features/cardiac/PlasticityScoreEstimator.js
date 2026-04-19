import { clamp, mean, percentile, round, stdDev } from "../../core/utils.js";

export class PlasticityScoreEstimator {
  constructor(maxSamples = 90) {
    this.maxSamples = maxSamples;
    this.rrIntervalsMs = [];
    this.latest = {
      rrSamples: 0,
      rmssdMs: null,
      sdnnMs: null,
      adaptability: null,
      score0To10: null
    };
  }

  update(sample = {}) {
    if (Number.isFinite(sample.rrIntervalMs) && sample.rrIntervalMs >= 250 && sample.rrIntervalMs <= 2000) {
      this.rrIntervalsMs.push(sample.rrIntervalMs);
      if (this.rrIntervalsMs.length > this.maxSamples) {
        this.rrIntervalsMs.shift();
      }
    }

    const rrSamples = this.rrIntervalsMs.length;
    if (rrSamples < 4) {
      this.latest = {
        rrSamples,
        rmssdMs: null,
        sdnnMs: null,
        adaptability: null,
        score0To10: null
      };
      return this.latest;
    }

    const rrDiffs = [];

    for (let i = 1; i < rrSamples; i += 1) {
      rrDiffs.push(this.rrIntervalsMs[i] - this.rrIntervalsMs[i - 1]);
    }

    const rmssdFromRR = rrDiffs.length
      ? Math.sqrt(mean(rrDiffs.map((value) => value * value)))
      : null;

    const rmssdInput = Number.isFinite(sample.hrvRmssdMs) ? sample.hrvRmssdMs : null;
    let rmssdMs = null;
    if (rmssdFromRR !== null && rmssdInput !== null) {
      rmssdMs = mean([rmssdFromRR, rmssdInput]);
    } else if (rmssdFromRR !== null) {
      rmssdMs = rmssdFromRR;
    } else if (rmssdInput !== null) {
      rmssdMs = rmssdInput;
    }

    const sdnnMs = rrSamples >= 2 ? stdDev(this.rrIntervalsMs) : null;
    const adaptability = this.computeAdaptability(rrDiffs);

    let score0To10 = null;
    if (Number.isFinite(rmssdMs) && Number.isFinite(sdnnMs) && Number.isFinite(adaptability)) {
      const rmssdNorm = clamp((rmssdMs - 12) / (85 - 12), 0, 1);
      const sdnnNorm = clamp((sdnnMs - 15) / (95 - 15), 0, 1);
      score0To10 = round((rmssdNorm * 0.45 + sdnnNorm * 0.35 + adaptability * 0.2) * 10, 2);
    }

    this.latest = {
      rrSamples,
      rmssdMs: Number.isFinite(rmssdMs) ? round(rmssdMs, 2) : null,
      sdnnMs: Number.isFinite(sdnnMs) ? round(sdnnMs, 2) : null,
      adaptability: Number.isFinite(adaptability) ? round(adaptability, 3) : null,
      score0To10
    };

    return this.latest;
  }

  getLatest() {
    return this.latest;
  }

  computeAdaptability(rrDiffs) {
    if (rrDiffs.length < 3) {
      return null;
    }

    const smoothnessSamples = [];
    for (let i = 1; i < rrDiffs.length; i += 1) {
      const jump = Math.abs(rrDiffs[i] - rrDiffs[i - 1]);
      smoothnessSamples.push(clamp(1 - jump / 120, 0, 1));
    }

    const dynamicRange = percentile(this.rrIntervalsMs, 0.9) - percentile(this.rrIntervalsMs, 0.1);
    const dynamicNorm = clamp(dynamicRange / 120, 0, 1);

    return clamp(mean(smoothnessSamples) * 0.6 + dynamicNorm * 0.4, 0, 1);
  }
}
