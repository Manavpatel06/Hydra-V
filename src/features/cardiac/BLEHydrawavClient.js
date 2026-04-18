import { EVENTS } from "../../core/events.js";
import { clamp, isFiniteNumber } from "../../core/utils.js";

export class BLEHydrawavClient {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.encoder = new TextEncoder();
    this.transportStats = {
      sentCount: 0,
      failedCount: 0,
      lastSentAtMs: null
    };
    this.config = null;

    this.onDisconnected = this.onDisconnected.bind(this);
  }

  isSupported() {
    return typeof navigator !== "undefined" && !!navigator.bluetooth;
  }

  isConnected() {
    return !!(this.server && this.server.connected && this.characteristic);
  }

  async connect(config) {
    if (!this.isSupported()) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    const deviceNamePrefix = config.deviceNamePrefix?.trim();
    const serviceUuid = config.serviceUuid?.trim();
    const characteristicUuid = config.characteristicUuid?.trim();

    if (!serviceUuid || !characteristicUuid) {
      throw new Error("BLE service and characteristic UUID are required.");
    }

    const request = {
      optionalServices: [serviceUuid]
    };

    if (deviceNamePrefix) {
      request.filters = [{ namePrefix: deviceNamePrefix }];
    } else {
      request.acceptAllDevices = true;
    }

    this.device = await navigator.bluetooth.requestDevice(request);
    this.device.addEventListener("gattserverdisconnected", this.onDisconnected);
    this.server = await this.device.gatt.connect();

    const service = await this.server.getPrimaryService(serviceUuid);
    this.characteristic = await service.getCharacteristic(characteristicUuid);

    this.config = {
      deviceNamePrefix,
      serviceUuid,
      characteristicUuid
    };

    this.emitStatus("connected", {
      deviceName: this.device.name || "Unnamed BLE Device",
      ...this.transportStats
    });
  }

  disconnect() {
    if (this.device) {
      this.device.removeEventListener("gattserverdisconnected", this.onDisconnected);
    }

    if (this.server?.connected) {
      this.server.disconnect();
    }

    this.characteristic = null;
    this.server = null;
    this.device = null;

    this.emitStatus("disconnected", {
      ...this.transportStats
    });
  }

  async sendGateSignal(payload) {
    if (!this.isConnected()) {
      throw new Error("Cannot send gate pulse because BLE is not connected.");
    }

    const body = {
      type: "gate",
      sequence: payload.sequence,
      rPeakTimestampMs: Math.round(payload.rPeakTimestampMs),
      gateTimestampMs: Math.round(payload.gateTimestampMs),
      gateOffsetMs: payload.offsetMs,
      heartRateBpm: isFiniteNumber(payload.heartRateBpm) ? clamp(payload.heartRateBpm, 25, 240) : null,
      rrIntervalMs: isFiniteNumber(payload.rrIntervalMs) ? clamp(payload.rrIntervalMs, 250, 2000) : null
    };

    const encoded = this.encoder.encode(JSON.stringify(body));

    if (typeof this.characteristic.writeValueWithoutResponse === "function") {
      await this.characteristic.writeValueWithoutResponse(encoded);
    } else {
      await this.characteristic.writeValue(encoded);
    }

    this.transportStats.sentCount += 1;
    this.transportStats.lastSentAtMs = performance.now();

    this.emitStatus("connected", {
      ...this.transportStats
    });
  }

  recordFailure(error) {
    this.transportStats.failedCount += 1;
    this.emitStatus("error", {
      message: error.message,
      ...this.transportStats
    });
  }

  onDisconnected() {
    this.characteristic = null;
    this.server = null;

    this.emitStatus("disconnected", {
      ...this.transportStats
    });
  }

  emitStatus(status, data = {}) {
    this.eventBus.emit(EVENTS.CARDIAC_TRANSPORT_STATUS, {
      status,
      ...data
    });
  }
}
