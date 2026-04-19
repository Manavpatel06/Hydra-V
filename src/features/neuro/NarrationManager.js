import { EVENTS } from "../../core/events.js";

export class NarrationManager {
  constructor({ eventBus, elevenLabsClient }) {
    this.eventBus = eventBus;
    this.elevenLabsClient = elevenLabsClient;
    this.enabled = false;

    this.audio = new Audio();
    this.audio.preload = "auto";
    this.queue = Promise.resolve();
    this.primed = false;
    this.currentObjectUrl = null;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
  }

  async primeAudio() {
    if (this.primed) {
      return;
    }

    const silentWav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    try {
      this.audio.src = silentWav;
      this.audio.volume = 0;
      await this.audio.play();
      this.audio.pause();
      this.audio.currentTime = 0;
      this.audio.volume = 1;
      this.primed = true;
    } catch {
      // Autoplay policies may still block until a stronger gesture; we keep trying on next user action.
    }
  }

  async speak(text, metadata = {}) {
    if (!this.enabled) {
      return;
    }

    this.queue = this.queue.then(async () => {
      try {
        const audioBlob = await this.elevenLabsClient.synthesize(text);
        const audioUrl = URL.createObjectURL(audioBlob);
        this.currentObjectUrl = audioUrl;
        await this.playAudio(audioUrl);
        this.eventBus.emit(EVENTS.VOICE_NOTE_READY, {
          text,
          metadata,
          delivered: true
        });
      } catch (error) {
        await this.speakFallback(text);
        this.eventBus.emit(EVENTS.WARNING, {
          scope: "narration",
          message: `${error.message}. Switched to browser speech fallback.`
        });
      } finally {
        if (this.currentObjectUrl) {
          URL.revokeObjectURL(this.currentObjectUrl);
          this.currentObjectUrl = null;
        }
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

  speakFallback(text) {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
        reject(new Error("Browser speech synthesis is not available."));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.98;
      utterance.pitch = 1;
      utterance.onend = () => {
        this.eventBus.emit(EVENTS.VOICE_NOTE_READY, { text, delivered: true, fallback: true });
        resolve();
      };
      utterance.onerror = () => reject(new Error("Fallback speech synthesis failed."));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }
}
