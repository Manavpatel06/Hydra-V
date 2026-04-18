import { DEFAULTS } from "../../config/defaults.js";

export class ElevenLabsClient {
  constructor({ proxyUrl, voiceId, modelId, voiceSettings } = {}) {
    this.proxyUrl = proxyUrl || DEFAULTS.voice.proxyUrl;
    this.voiceId = voiceId || DEFAULTS.voice.voiceId;
    this.modelId = modelId || DEFAULTS.voice.modelId;
    this.voiceSettings = {
      ...DEFAULTS.voice.voiceSettings,
      ...(voiceSettings || {})
    };
  }

  updateConfig({ proxyUrl, voiceId, modelId }) {
    if (proxyUrl) {
      this.proxyUrl = proxyUrl;
    }
    if (voiceId) {
      this.voiceId = voiceId;
    }
    if (modelId) {
      this.modelId = modelId;
    }
  }

  async synthesize(text) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) {
      throw new Error("Cannot synthesize empty narration text.");
    }

    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 25000);

    try {
      const response = await fetch(this.proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: trimmed,
          voiceId: this.voiceId,
          modelId: this.modelId,
          voiceSettings: this.voiceSettings
        }),
        signal: abort.signal
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Narration request failed (${response.status}): ${body || response.statusText}`);
      }

      return await response.blob();
    } finally {
      clearTimeout(timeout);
    }
  }
}
