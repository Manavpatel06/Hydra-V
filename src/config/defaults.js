export const DEFAULTS = Object.freeze({
  auraScan: {
    scanDurationSec: 60,
    autoStartCamera: false,
    usePythonAnalytics: true,
    analyticsIntervalMs: 1000,
    analyzeProxyUrl: "/api/aura/analyze",
    resetProxyUrl: "/api/aura/reset"
  },
  neuralHandshake: {
    recordDurationSec: 10,
    defaultZone: "shoulder",
    defaultInjuredSide: "left"
  },
  cardiac: {
    gateOffsetMs: 100,
    minOffsetMs: 80,
    maxOffsetMs: 120,
    ble: {
      deviceNamePrefix: "Hydrawav3",
      serviceUuid: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
      characteristicUuid: "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
    },
    mqtt: {
      apiBaseUrl: "",
      loginProxyUrl: "/api/device/hydrawav/login",
      publishProxyUrl: "/api/device/hydrawav/publish",
      topic: "HydraWav3Pro/config",
      mac: "74:4D:BD:A0:A3:EC",
      gateTopic: "HydraWav3Pro/gate",
      gatePublishEnabled: false,
      startTemplate: {
        sessionCount: 3,
        sessionPause: 30,
        sDelay: 0,
        cycle1: 1,
        cycle5: 1,
        edgeCycleDuration: 9,
        cycleRepetitions: [6, 6, 3],
        cycleDurations: [3, 3, 3],
        cyclePauses: [3, 3, 3],
        pauseIntervals: [3, 3, 3],
        leftFuncs: ["leftColdBlue", "leftHotRed", "leftColdBlue"],
        rightFuncs: ["rightHotRed", "rightColdBlue", "rightHotRed"],
        pwmValues: {
          hot: [90, 90, 90],
          cold: [250, 250, 250]
        },
        led: 1,
        hotDrop: 0.5,
        coldDrop: 0.3,
        vibMin: 15,
        vibMax: 222,
        totalDuration: 426
      }
    }
  },
  neuro: {
    carrierHz: 220,
    volume: 0.24,
    phaseDurationSec: {
      pre: 45,
      during: 120,
      post: 45
    }
  },
  voice: {
    enabled: false,
    proxyUrl: "/api/voice/elevenlabs/tts",
    voiceId: "EXAVITQu4vr4xnSDxMaL",
    modelId: "eleven_turbo_v2_5",
    voiceSettings: {
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.2,
      useSpeakerBoost: true
    }
  }
});
