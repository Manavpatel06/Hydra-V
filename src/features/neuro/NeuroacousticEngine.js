import { EVENTS } from "../../core/events.js";
import { clamp } from "../../core/utils.js";

export class NeuroacousticEngine {
  constructor({ eventBus, selector, carrierHz = 220, masterGain = 0.24 }) {
    this.eventBus = eventBus;
    this.selector = selector;
    this.carrierHz = carrierHz;
    this.masterGainValue = masterGain;

    this.audioContext = null;
    this.nodes = null;

    this.currentBeatHz = 10;
    this.currentPhase = "idle";
    this.latestArousalIndex = null;
    this.latestBiometrics = {};

    this.sessionPlan = null;
    this.phaseEndAtMs = null;
    this.phaseTimer = null;
    this.sessionStartedAtMs = null;
    this.sessionTotalMs = 0;
    this.sessionTicker = null;
    this.speakerPulseTimer = null;
  }

  async enableAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      throw new Error("Web Audio API is not available in this browser.");
    }

    if (!this.audioContext) {
      this.audioContext = new AudioCtx();
      this.setupAudioGraph();
    }

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }

    this.setMasterGain(this.masterGainValue, 0.15);
    if (this.currentPhase !== "idle") {
      this.startSpeakerPulseLoop();
    }
  }

  setupAudioGraph() {
    const now = this.audioContext.currentTime;

    const leftOsc = this.audioContext.createOscillator();
    leftOsc.type = "sine";
    const rightOsc = this.audioContext.createOscillator();
    rightOsc.type = "sine";

    const leftGain = this.audioContext.createGain();
    leftGain.gain.value = 0;
    const rightGain = this.audioContext.createGain();
    rightGain.gain.value = 0;

    const leftPan = this.audioContext.createStereoPanner();
    leftPan.pan.value = -0.85;
    const rightPan = this.audioContext.createStereoPanner();
    rightPan.pan.value = 0.85;

    const pulseOsc = this.audioContext.createOscillator();
    pulseOsc.type = "triangle";
    const pulseEnvelope = this.audioContext.createGain();
    pulseEnvelope.gain.value = 0;
    const pulseLevel = this.audioContext.createGain();
    pulseLevel.gain.value = 0;

    const dynamics = this.audioContext.createDynamicsCompressor();
    dynamics.threshold.value = -18;
    dynamics.knee.value = 18;
    dynamics.ratio.value = 2.6;
    dynamics.attack.value = 0.01;
    dynamics.release.value = 0.22;

    const master = this.audioContext.createGain();
    master.gain.setValueAtTime(0, now);

    leftOsc.connect(leftGain);
    rightOsc.connect(rightGain);

    leftGain.connect(leftPan);
    rightGain.connect(rightPan);

    pulseOsc.connect(pulseEnvelope);
    pulseEnvelope.connect(pulseLevel);

    leftPan.connect(dynamics);
    rightPan.connect(dynamics);
    pulseLevel.connect(dynamics);
    dynamics.connect(master);
    master.connect(this.audioContext.destination);

    leftOsc.start(now);
    rightOsc.start(now);
    pulseOsc.start(now);

    this.nodes = {
      leftOsc,
      rightOsc,
      leftGain,
      rightGain,
      pulseOsc,
      pulseEnvelope,
      pulseLevel,
      dynamics,
      master
    };

    this.applyCarrierAndBeat(this.carrierHz, this.currentBeatHz, 0);
    this.setStereoVolume(0.28, 0.2);
    this.setPulseVolume(0.92, 0.2);
  }

  setCarrierHz(carrierHz) {
    this.carrierHz = clamp(Number(carrierHz) || 220, 80, 520);
    if (this.nodes) {
      this.applyCarrierAndBeat(this.carrierHz, this.currentBeatHz, 0.25);
    }
  }

  setMasterGain(value, rampSeconds = 0.2) {
    this.masterGainValue = clamp(value, 0, 1);
    if (!this.nodes) {
      return;
    }
    const now = this.audioContext.currentTime;
    this.nodes.master.gain.cancelScheduledValues(now);
    this.nodes.master.gain.linearRampToValueAtTime(this.masterGainValue, now + rampSeconds);
  }

  setStereoVolume(value, rampSeconds = 0.2) {
    if (!this.nodes) {
      return;
    }
    const level = clamp(value, 0, 1);
    const now = this.audioContext.currentTime;
    this.nodes.leftGain.gain.cancelScheduledValues(now);
    this.nodes.rightGain.gain.cancelScheduledValues(now);
    this.nodes.leftGain.gain.linearRampToValueAtTime(level, now + rampSeconds);
    this.nodes.rightGain.gain.linearRampToValueAtTime(level, now + rampSeconds);
  }

  setPulseVolume(value, rampSeconds = 0.2) {
    if (!this.nodes) {
      return;
    }
    const level = clamp(value, 0, 1);
    const now = this.audioContext.currentTime;
    this.nodes.pulseLevel.gain.cancelScheduledValues(now);
    this.nodes.pulseLevel.gain.linearRampToValueAtTime(level, now + rampSeconds);
  }

  triggerSpeakerPulse(intensity = 1) {
    if (!this.nodes || !this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    const amount = clamp(intensity, 0.18, 1);
    const floor = 0.004;
    const peak = 0.065 * amount;
    const attack = 0.012;
    const decay = clamp(0.085 - this.currentBeatHz * 0.0011, 0.03, 0.085);

    this.nodes.pulseEnvelope.gain.cancelScheduledValues(now);
    this.nodes.pulseEnvelope.gain.setValueAtTime(floor, now);
    this.nodes.pulseEnvelope.gain.linearRampToValueAtTime(peak, now + attack);
    this.nodes.pulseEnvelope.gain.exponentialRampToValueAtTime(Math.max(floor, peak * 0.16), now + decay);
  }

  scheduleSpeakerPulse() {
    if (this.currentPhase === "idle") {
      return;
    }

    const intervalMs = 1000 / Math.max(Math.min(this.currentBeatHz, 18), 2);
    this.triggerSpeakerPulse(this.currentPhase === "during" ? 1 : 0.9);
    this.speakerPulseTimer = window.setTimeout(() => {
      this.scheduleSpeakerPulse();
    }, intervalMs);
  }

  startSpeakerPulseLoop() {
    this.stopSpeakerPulseLoop();
    if (this.currentPhase === "idle") {
      return;
    }
    this.scheduleSpeakerPulse();
  }

  stopSpeakerPulseLoop() {
    if (this.speakerPulseTimer) {
      clearTimeout(this.speakerPulseTimer);
      this.speakerPulseTimer = null;
    }
  }

  applyCarrierAndBeat(carrierHz, beatHz, rampSeconds = 0.25) {
    if (!this.nodes) {
      return;
    }

    const now = this.audioContext.currentTime;
    const boundedBeat = clamp(beatHz, 2, 45);

    this.currentBeatHz = boundedBeat;

    const leftFrequency = clamp(carrierHz - boundedBeat / 2, 20, 19000);
    const rightFrequency = clamp(carrierHz + boundedBeat / 2, 20, 19000);

    this.nodes.leftOsc.frequency.cancelScheduledValues(now);
    this.nodes.rightOsc.frequency.cancelScheduledValues(now);
    this.nodes.pulseOsc.frequency.cancelScheduledValues(now);

    this.nodes.leftOsc.frequency.linearRampToValueAtTime(leftFrequency, now + rampSeconds);
    this.nodes.rightOsc.frequency.linearRampToValueAtTime(rightFrequency, now + rampSeconds);
    this.nodes.pulseOsc.frequency.linearRampToValueAtTime(
      clamp(carrierHz * 0.5, 74, 164),
      now + rampSeconds
    );

    if (this.currentPhase !== "idle") {
      this.startSpeakerPulseLoop();
    }
  }

  updateBiometrics(frame = {}) {
    this.latestBiometrics = {
      ...this.latestBiometrics,
      ...frame
    };

    if (this.currentPhase === "idle") {
      return;
    }

    this.retargetBeat(this.currentPhase);
  }

  retargetBeat(phase) {
    const selection = this.selector.selectTarget({
      phase,
      biometrics: this.latestBiometrics,
      currentBeatHz: this.currentBeatHz
    });

    this.latestArousalIndex = selection.arousalIndex;
    this.applyCarrierAndBeat(this.carrierHz, selection.targetBeatHz, 0.25);

    this.eventBus.emit(EVENTS.NEURO_BEAT_UPDATED, {
      phase,
      beatHz: this.currentBeatHz,
      rawTargetHz: selection.rawTargetHz,
      arousalIndex: selection.arousalIndex,
      phaseTimeRemainingSec: this.getPhaseTimeRemainingSec(),
      sessionProgressPercent: this.getSessionProgressPercent()
    });
  }

  setPhase(phase) {
    if (!["pre", "during", "post", "idle"].includes(phase)) {
      throw new Error(`Unsupported neuro phase: ${phase}`);
    }

    this.currentPhase = phase;

    if (phase === "idle") {
      this.stopSpeakerPulseLoop();
      this.setStereoVolume(0, 0.25);
      this.setPulseVolume(0, 0.2);
    } else {
      this.setStereoVolume(0.24, 0.25);
      this.setPulseVolume(1, 0.15);
      this.retargetBeat(phase);
      this.startSpeakerPulseLoop();
    }

    this.eventBus.emit(EVENTS.NEURO_PHASE_CHANGED, {
      phase,
      phaseTimeRemainingSec: this.getPhaseTimeRemainingSec(),
      sessionProgressPercent: this.getSessionProgressPercent()
    });
  }

  startSession({ preSeconds, duringSeconds, postSeconds }) {
    if (!this.audioContext || !this.nodes) {
      throw new Error("Enable audio before starting a neuroacoustic session.");
    }

    this.stopSession();

    const plan = [
      { phase: "pre", durationMs: clamp(preSeconds, 5, 900) * 1000 },
      { phase: "during", durationMs: clamp(duringSeconds, 10, 3600) * 1000 },
      { phase: "post", durationMs: clamp(postSeconds, 5, 900) * 1000 }
    ];

    this.sessionPlan = plan;
    this.sessionStartedAtMs = performance.now();
    this.sessionTotalMs = plan.reduce((sum, item) => sum + item.durationMs, 0);

    this.runPhaseByIndex(0);

    this.sessionTicker = setInterval(() => {
      this.eventBus.emit(EVENTS.NEURO_BEAT_UPDATED, {
        phase: this.currentPhase,
        beatHz: this.currentBeatHz,
        rawTargetHz: this.currentBeatHz,
        arousalIndex: this.latestArousalIndex,
        phaseTimeRemainingSec: this.getPhaseTimeRemainingSec(),
        sessionProgressPercent: this.getSessionProgressPercent()
      });
    }, 1000);
  }

  runPhaseByIndex(index) {
    if (!this.sessionPlan || index >= this.sessionPlan.length) {
      this.finishSession();
      return;
    }

    const step = this.sessionPlan[index];
    this.phaseEndAtMs = performance.now() + step.durationMs;
    this.setPhase(step.phase);

    this.phaseTimer = setTimeout(() => {
      this.runPhaseByIndex(index + 1);
    }, step.durationMs);
  }

  stopSession() {
    if (this.phaseTimer) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }

    if (this.sessionTicker) {
      clearInterval(this.sessionTicker);
      this.sessionTicker = null;
    }

    this.stopSpeakerPulseLoop();

    this.phaseEndAtMs = null;
    this.sessionPlan = null;
    this.sessionStartedAtMs = null;
    this.sessionTotalMs = 0;

    this.setPhase("idle");
  }

  finishSession() {
    this.stopSession();

    this.eventBus.emit(EVENTS.NEURO_SESSION_COMPLETED, {
      completedAtMs: performance.now()
    });
  }

  getPhaseTimeRemainingSec() {
    if (!this.phaseEndAtMs) {
      return null;
    }

    return Math.max(0, (this.phaseEndAtMs - performance.now()) / 1000);
  }

  getSessionProgressPercent() {
    if (!this.sessionStartedAtMs || !this.sessionTotalMs) {
      return 0;
    }

    const elapsedMs = performance.now() - this.sessionStartedAtMs;
    return clamp((elapsedMs / this.sessionTotalMs) * 100, 0, 100);
  }
}
