import { EVENTS } from "../../core/events.js";

export class HydrawavMqttClient {
  constructor(eventBus, { loginProxyUrl, publishProxyUrl } = {}) {
    this.eventBus = eventBus;
    this.loginProxyUrl = loginProxyUrl || "/api/device/hydrawav/login";
    this.publishProxyUrl = publishProxyUrl || "/api/device/hydrawav/publish";
    this.accessToken = null;
    this.apiBaseUrl = "";
  }

  setProxyUrls({ loginProxyUrl, publishProxyUrl } = {}) {
    if (loginProxyUrl) {
      this.loginProxyUrl = loginProxyUrl;
    }

    if (publishProxyUrl) {
      this.publishProxyUrl = publishProxyUrl;
    }
  }

  hasToken() {
    return typeof this.accessToken === "string" && this.accessToken.length > 8;
  }

  async login({ apiBaseUrl, username, password, rememberMe = true } = {}) {
    try {
      const payload = {
        apiBaseUrl,
        username,
        password,
        rememberMe
      };

      const response = await fetch(this.loginProxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || body.details || "HydraWav login failed.");
      }

      this.accessToken = body.accessToken || null;
      this.apiBaseUrl = body.apiBaseUrl || apiBaseUrl || this.apiBaseUrl;

      this.eventBus.emit(EVENTS.HYDRAWAV_MQTT_STATUS, {
        status: "authenticated",
        apiBaseUrl: this.apiBaseUrl,
        hasToken: this.hasToken()
      });

      return body;
    } catch (error) {
      this.eventBus.emit(EVENTS.HYDRAWAV_MQTT_STATUS, {
        status: "error",
        apiBaseUrl: this.apiBaseUrl || apiBaseUrl || "",
        hasToken: this.hasToken(),
        message: error.message
      });
      throw error;
    }
  }

  async publish({ topic, payload, accessToken, apiBaseUrl } = {}) {
    if (!topic || typeof topic !== "string") {
      throw new Error("MQTT topic is required.");
    }

    if (typeof payload !== "string") {
      throw new Error("HydraWav payload must be a stringified JSON string.");
    }

    const tokenToUse = accessToken || this.accessToken;
    if (!tokenToUse) {
      throw new Error("No HydraWav access token found. Login first.");
    }

    try {
      const response = await fetch(this.publishProxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          apiBaseUrl: apiBaseUrl || this.apiBaseUrl || undefined,
          topic,
          payload,
          accessToken: tokenToUse
        })
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body.error || body.details || "HydraWav publish failed.");
      }

      this.eventBus.emit(EVENTS.HYDRAWAV_MQTT_COMMAND, {
        topic,
        payload,
        apiBaseUrl: apiBaseUrl || this.apiBaseUrl || null,
        ok: true,
        response: body
      });

      return body;
    } catch (error) {
      this.eventBus.emit(EVENTS.HYDRAWAV_MQTT_STATUS, {
        status: "error",
        apiBaseUrl: this.apiBaseUrl || apiBaseUrl || "",
        hasToken: this.hasToken(),
        message: error.message
      });
      throw error;
    }
  }

  async sendControlCommand({ topic, mac, playCmd, extra = {}, accessToken, apiBaseUrl } = {}) {
    if (!mac) {
      throw new Error("Device MAC is required for HydraWav control commands.");
    }

    if (!Number.isInteger(playCmd)) {
      throw new Error("playCmd must be an integer.");
    }

    const command = {
      mac,
      ...extra,
      playCmd
    };

    return await this.publish({
      topic,
      payload: JSON.stringify(command),
      accessToken,
      apiBaseUrl
    });
  }

  async sendGatePulse({ topic, mac, sequence, rrIntervalMs, heartRateBpm, offsetMs, gateTimestampMs } = {}) {
    if (!mac) {
      throw new Error("Device MAC is required for gate pulse telemetry.");
    }

    const gatePayload = {
      mac,
      syncSource: "rppg",
      sequence,
      rrIntervalMs,
      heartRateBpm,
      gateOffsetMs: offsetMs,
      gateTimestampMs
    };

    return await this.publish({
      topic,
      payload: JSON.stringify(gatePayload)
    });
  }

  clearToken() {
    this.accessToken = null;
    this.eventBus.emit(EVENTS.HYDRAWAV_MQTT_STATUS, {
      status: "disconnected",
      apiBaseUrl: this.apiBaseUrl,
      hasToken: false
    });
  }
}
