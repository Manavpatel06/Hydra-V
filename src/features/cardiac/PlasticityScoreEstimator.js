import { clamp, mean, percentile, round, stdDev } from "../../core/utils.js";

export class PlasticityScoreEstimator {
  constructor(maxSamples = 90) {
    this.maxSamples = maxSamples;
    this.rrIntervalsMs = [];
    this.latest = {
      rrSamples: 0,
      rmssdMs: 0,
      sdnnMs: 0,
      adaptability: 0,
      score0To10: 0
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
    const rrDiffs = [];

    for (let i = 1; i < rrSamples; i += 1) {
      rrDiffs.push(this.rrIntervalsMs[i] - this.rrIntervalsMs[i - 1]);
    }

    const rmssdFromRR = rrDiffs.length
      ? Math.sqrt(mean(rrDiffs.map((value) => value * value)))
      : 0;

    const rmssdInput = Number.isFinite(sample.hrvRmssdMs) ? sample.hrvRmssdMs : null;
    const rmssdMs = rmssdInput === null
      ? rmssdFromRR
      : (rmssdFromRR > 0 ? mean([rmssdFromRR, rmssdInput]) : rmssdInput);

    const sdnnMs = stdDev(this.rrIntervalsMs);
    const adaptability = this.computeAdaptability(rrDiffs);

    const rmssdNorm = clamp((rmssdMs - 12) / (85 - 12), 0, 1);
    const sdnnNorm = clamp((sdnnMs - 15) / (95 - 15), 0, 1);
    const score0To10 = round((rmssdNorm * 0.45 + sdnnNorm * 0.35 + adaptability * 0.2) * 10, 2);

    this.latest = {
      rrSamples,
      rmssdMs: round(rmssdMs, 2),
      sdnnMs: round(sdnnMs, 2),
      adaptability: round(adaptability, 3),
      score0To10
    };

    return this.latest;
  }

  getLatest() {
    return this.latest;
  }

  computeAdaptability(rrDiffs) {
    if (rrDiffs.length < 3) {
      return 0.5;
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
