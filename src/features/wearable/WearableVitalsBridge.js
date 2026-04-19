import { clamp } from "../../core/utils.js";

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT = 0x2a37;

export class WearableVitalsBridge {
  constructor({ onFrame = null, onStatus = null } = {}) {
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.connected = false;
    this.lastFrame = null;

    this.handleDisconnected = this.handleDisconnected.bind(this);
    this.handleMeasurement = this.handleMeasurement.bind(this);
  }

  isSupported() {
    return !!(navigator?.bluetooth);
  }

  async tryAutoReconnect() {
    return this.connect({ interactive: false });
  }

  async connectInteractive() {
    return this.connect({ interactive: true });
  }

  async connect({ interactive = false } = {}) {
    try {
      if (!this.isSupported()) {
        this.emitStatus("unsupported", {
          message: "Web Bluetooth is unavailable in this browser."
        });
        return false;
      }

      if (this.connected && this.characteristic) {
        this.emitStatus("connected", {
          message: "Wearable already connected.",
          source: this.lastFrame?.source || this.device?.name || "ble-heart-rate"
        });
        return true;
      }

      let device = this.device;
      if (!device && !interactive) {
        const grantedDevices = await navigator.bluetooth.getDevices().catch(() => []);
        device = grantedDevices.find((item) => item?.gatt) || null;
      }

      if (!device && interactive) {
        device = await navigator.bluetooth.requestDevice({
          filters: [{ services: [HEART_RATE_SERVICE] }],
          optionalServices: [HEART_RATE_SERVICE]
        });
      }

      if (!device) {
        this.emitStatus("idle", {
          message: interactive
            ? "Wearable selection cancelled."
            : "No previously approved wearable found."
        });
        return false;
      }

      this.device = device;
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnected);

      this.emitStatus("connecting", {
        source: this.device.name || "ble-heart-rate"
      });

      this.server = await this.device.gatt.connect();
      const service = await this.server.getPrimaryService(HEART_RATE_SERVICE);
      this.characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
      await this.characteristic.startNotifications();
      this.characteristic.removeEventListener("characteristicvaluechanged", this.handleMeasurement);
      this.characteristic.addEventListener("characteristicvaluechanged", this.handleMeasurement);

      this.connected = true;
      this.emitStatus("connected", {
        source: this.device.name || "ble-heart-rate"
      });
      return true;
    } catch (error) {
      this.connected = false;
      this.server = null;
      this.characteristic = null;
      this.emitStatus("error", {
        message: error?.message || "Wearable connection failed."
      });
      return false;
    }
  }

  async disconnect() {
    if (this.characteristic) {
      try {
        this.characteristic.removeEventListener("characteristicvaluechanged", this.handleMeasurement);
        await this.characteristic.stopNotifications();
      } catch {
        // Ignore peripheral-side disconnect race.
      }
    }

    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.handleDisconnected();
  }

  handleDisconnected() {
    this.connected = false;
    this.server = null;
    this.characteristic = null;
    this.emitStatus("disconnected", {
      source: this.device?.name || this.lastFrame?.source || "ble-heart-rate"
    });
  }

  handleMeasurement(event) {
    const view = event?.target?.value;
    if (!view) {
      return;
    }

    const parsed = parseHeartRateMeasurement(view);
    if (!parsed) {
      return;
    }

    const timestampMs = performance.now();
    const source = this.device?.name || "ble-heart-rate";
    const confidence = estimateWearableConfidence({
      heartRateBpm: parsed.heartRateBpm,
      rrIntervalsMs: parsed.rrIntervalsMs,
      contactDetected: parsed.contactDetected,
      contactSupported: parsed.contactSupported
    });

    const frame = {
      timestampMs,
      wallClockMs: Date.now(),
      source,
      confidence,
      heartRateBpm: parsed.heartRateBpm,
      rrIntervalMs: parsed.rrIntervalsMs.length
        ? parsed.rrIntervalsMs[parsed.rrIntervalsMs.length - 1]
        : null,
      rrIntervalsMs: parsed.rrIntervalsMs,
      contactDetected: parsed.contactDetected,
      contactSupported: parsed.contactSupported
    };

    this.lastFrame = frame;
    if (typeof this.onFrame === "function") {
      this.onFrame(frame);
    }
  }

  emitStatus(status, detail = {}) {
    if (typeof this.onStatus === "function") {
      this.onStatus({
        status,
        ...detail
      });
    }
  }
}

function parseHeartRateMeasurement(valueView) {
  if (!(valueView instanceof DataView) || valueView.byteLength < 2) {
    return null;
  }

  const flags = valueView.getUint8(0);
  const heartRate16Bit = (flags & 0x01) !== 0;
  const contactStatusSupported = (flags & 0x04) !== 0;
  const contactDetected = (flags & 0x02) !== 0;
  const energyExpendedPresent = (flags & 0x08) !== 0;
  const rrPresent = (flags & 0x10) !== 0;

  let offset = 1;
  let heartRateBpm = null;

  if (heartRate16Bit) {
    if (offset + 1 >= valueView.byteLength) {
      return null;
    }
    heartRateBpm = valueView.getUint16(offset, true);
    offset += 2;
  } else {
    heartRateBpm = valueView.getUint8(offset);
    offset += 1;
  }

  if (energyExpendedPresent) {
    offset += 2;
  }

  const rrIntervalsMs = [];
  if (rrPresent) {
    while (offset + 1 < valueView.byteLength) {
      const rrRaw = valueView.getUint16(offset, true);
      offset += 2;
      rrIntervalsMs.push((rrRaw / 1024) * 1000);
    }
  }

  return {
    heartRateBpm: Number.isFinite(heartRateBpm) ? heartRateBpm : null,
    rrIntervalsMs: rrIntervalsMs.filter((value) => Number.isFinite(value) && value >= 250 && value <= 2000),
    contactDetected,
    contactSupported: contactStatusSupported
  };
}

function estimateWearableConfidence({
  heartRateBpm,
  rrIntervalsMs,
  contactDetected,
  contactSupported
}) {
  let confidence = 0.55;

  if (Number.isFinite(heartRateBpm) && heartRateBpm >= 38 && heartRateBpm <= 210) {
    confidence += 0.18;
  } else {
    confidence -= 0.25;
  }

  if (Array.isArray(rrIntervalsMs) && rrIntervalsMs.length > 0) {
    confidence += 0.16;
  }

  if (contactSupported) {
    confidence += contactDetected ? 0.11 : -0.28;
  }

  return clamp(confidence, 0, 1);
}
