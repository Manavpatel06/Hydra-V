import { EVENTS } from "../../core/events.js";
import { clamp, round } from "../../core/utils.js";

export class CardiacGatingEngine {
  constructor({ eventBus, plasticityEstimator, defaultOffsetMs = 100 }) {
    this.eventBus = eventBus;
    this.plasticityEstimator = plasticityEstimator;

    this.offsetMs = defaultOffsetMs;
    this.isActive = false;
    this.sequenceId = 0;
    this.pendingTimeouts = new Set();

    this.latestBiometrics = {
      rrIntervalMs: null,
      heartRateBpm: null,
      hrvRmssdMs: null
    };
  }

  start() {
    this.isActive = true;
    this.emitStatus();
  }

  stop() {
    this.isActive = false;
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts.clear();
    this.emitStatus();
  }

  setOffsetMs(offsetMs) {
    this.offsetMs = clamp(Math.round(offsetMs), 80, 120);
    this.emitStatus();
  }

  ingestFrame(frame = {}) {
    if (Number.isFinite(frame.rrIntervalMs)) {
      this.latestBiometrics.rrIntervalMs = frame.rrIntervalMs;
      this.latestBiometrics.heartRateBpm = frame.heartRateBpm ?? (60000 / frame.rrIntervalMs);
    }

    if (Number.isFinite(frame.hrvRmssdMs)) {
      this.latestBiometrics.hrvRmssdMs = frame.hrvRmssdMs;
    }

    const plasticity = this.plasticityEstimator.update({
      rrIntervalMs: frame.rrIntervalMs,
      hrvRmssdMs: frame.hrvRmssdMs
    });

    this.eventBus.emit(EVENTS.PLASTICITY_SCORE_UPDATED, {
      ...plasticity
    });

    if (frame.rPeakDetected) {
      this.registerRPeak({
        timestampMs: frame.timestampMs,
        rrIntervalMs: frame.rrIntervalMs,
        heartRateBpm: frame.heartRateBpm
      });
    }
  }

  registerRPeak(sample = {}) {
    const timestampMs = Number.isFinite(sample.timestampMs) ? sample.timestampMs : performance.now();

    if (!this.isActive) {
      return;
    }

    const timeoutId = setTimeout(() => {
      this.pendingTimeouts.delete(timeoutId);
      this.fireGatePulse({
        rPeakTimestampMs: timestampMs,
        rrIntervalMs: sample.rrIntervalMs ?? this.latestBiometrics.rrIntervalMs,
        heartRateBpm: sample.heartRateBpm ?? this.latestBiometrics.heartRateBpm
      }).catch((error) => {
        this.eventBus.emit(EVENTS.WARNING, {
          scope: "cardiac-gating",
          message: error.message
        });
      });
    }, this.offsetMs);

    this.pendingTimeouts.add(timeoutId);
  }

  async fireGatePulse({ rPeakTimestampMs, rrIntervalMs, heartRateBpm }) {
    this.sequenceId += 1;

    const payload = {
      sequence: this.sequenceId,
      rPeakTimestampMs,
      gateTimestampMs: performance.now(),
      offsetMs: this.offsetMs,
      rrIntervalMs,
      heartRateBpm
    };

    this.eventBus.emit(EVENTS.CARDIAC_GATE_FIRED, {
      ...payload,
      transport: "mqtt",
      effectiveDelayMs: round(payload.gateTimestampMs - payload.rPeakTimestampMs, 2)
    });

    this.emitStatus();
  }

  emitStatus() {
    this.eventBus.emit(EVENTS.CARDIAC_ENGINE_STATUS, {
      active: this.isActive,
      offsetMs: this.offsetMs,
      sequenceId: this.sequenceId,
      pendingGates: this.pendingTimeouts.size
    });
  }
}
