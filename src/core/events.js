export const EVENTS = Object.freeze({
  BIOMETRIC_FRAME: "hydrav:biometric-frame",
  R_PEAK: "hydrav:r-peak",
  SESSION_CONTEXT: "hydrav:session-context",
  PROTOCOL_CONTEXT: "hydrav:protocol-context",

  AURA_SCAN_STATUS: "hydrav:aura-scan-status",
  AURA_SCAN_FRAME: "hydrav:aura-scan-frame",
  AURA_SCAN_COMPLETE: "hydrav:aura-scan-complete",
  THERMAL_SCAN_STATUS: "hydrav:thermal-scan-status",
  THERMAL_SCAN_FRAME: "hydrav:thermal-scan-frame",
  THERMAL_SCAN_COMPLETE: "hydrav:thermal-scan-complete",

  NEURAL_HANDSHAKE_STATUS: "hydrav:neural-handshake-status",
  NEURAL_HANDSHAKE_PROGRESS: "hydrav:neural-handshake-progress",

  CARDIAC_ENGINE_STATUS: "hydrav:cardiac-engine-status",
  CARDIAC_TRANSPORT_STATUS: "hydrav:cardiac-transport-status",
  CARDIAC_GATE_FIRED: "hydrav:cardiac-gate-fired",
  HYDRAWAV_MQTT_STATUS: "hydrav:hydrawav-mqtt-status",
  HYDRAWAV_MQTT_COMMAND: "hydrav:hydrawav-mqtt-command",

  PLASTICITY_SCORE_UPDATED: "hydrav:plasticity-score-updated",
  NEURO_PHASE_CHANGED: "hydrav:neuro-phase-changed",
  NEURO_BEAT_UPDATED: "hydrav:neuro-beat-updated",
  NEURO_SESSION_COMPLETED: "hydrav:neuro-session-completed",
  VOICE_NOTE_READY: "hydrav:voice-note-ready",
  WARNING: "hydrav:warning",
  LOG: "hydrav:log"
});

export class HydraEventBus {
  constructor(target = window) {
    this.target = target;
  }

  emit(eventName, detail = {}) {
    this.target.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  on(eventName, handler) {
    this.target.addEventListener(eventName, handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    this.target.removeEventListener(eventName, handler);
  }
}
