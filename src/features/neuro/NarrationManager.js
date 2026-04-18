import { EVENTS } from "../../core/events.js";

export class NarrationManager {
  constructor({ eventBus, elevenLabsClient }) {
    this.eventBus = eventBus;
    this.elevenLabsClient = elevenLabsClient;
    this.enabled = false;

    this.audio = new Audio();
    this.queue = Promise.resolve();
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  async speak(text, metadata = {}) {
    if (!this.enabled) {
      return;
    }

    this.queue = this.queue.then(async () => {
      const audioBlob = await this.elevenLabsClient.synthesize(text);
      const audioUrl = URL.createObjectURL(audioBlob);

      try {
        await this.playAudio(audioUrl);
        this.eventBus.emit(EVENTS.VOICE_NOTE_READY, {
          text,
          metadata,
          delivered: true
        });
      } finally {
        URL.revokeObjectURL(audioUrl);
      }
    }).catch((error) => {
      this.eventBus.emit(EVENTS.WARNING, {
        scope: "narration",
        message: error.message
      });
    });

    return this.queue;
  }

  playAudio(audioUrl) {
    return new Promise((resolve, reject) => {
      this.audio.onended = () => resolve();
      this.audio.onerror = () => reject(new Error("Unable to play synthesized narration audio."));
      this.audio.src = audioUrl;
      this.audio.play().catch((error) => reject(error));
    });
  }
}
