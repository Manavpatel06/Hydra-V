import http from "http";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadDotEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HYDRAWAV_DEFAULT_BASE_URL = (process.env.HYDRAWAV_API_BASE_URL || "").trim();
const PY_AURA_API_BASE_URL = (process.env.PY_AURA_API_BASE_URL || "http://127.0.0.1:8010").trim();
const AURA_USE_PYTHON_ANALYTICS = (process.env.AURA_USE_PYTHON_ANALYTICS || "true").trim().toLowerCase() !== "false";
const THERMAL_USE_PYTHON_ANALYTICS = (process.env.THERMAL_USE_PYTHON_ANALYTICS || "true").trim().toLowerCase() !== "false";
const AURA_PYTHON_TIMEOUT_MS = Number(process.env.AURA_PYTHON_TIMEOUT_MS || 1500);
const THERMAL_PYTHON_TIMEOUT_MS = Number(process.env.THERMAL_PYTHON_TIMEOUT_MS || 9000);
let hydrawavCachedAccessToken = null;
let hydrawavCachedBaseUrl = HYDRAWAV_DEFAULT_BASE_URL;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        service: "HYDRA-V Feature 1-5 runtime",
        elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
        hydrawavApiBaseUrlConfigured: Boolean(HYDRAWAV_DEFAULT_BASE_URL),
        hydrawavTokenCached: Boolean(hydrawavCachedAccessToken),
        auraPythonEnabled: AURA_USE_PYTHON_ANALYTICS,
        thermalPythonEnabled: THERMAL_USE_PYTHON_ANALYTICS,
        auraPythonApiBaseUrl: PY_AURA_API_BASE_URL,
        thermalPythonTimeoutMs: THERMAL_PYTHON_TIMEOUT_MS
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/voice/elevenlabs/tts") {
      await handleElevenLabsTts(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/device/hydrawav/login") {
      await handleHydrawavLogin(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/device/hydrawav/publish") {
      await handleHydrawavPublish(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/aura/reset") {
      await handleAuraPythonProxy(req, res, "/aura/reset", null, AURA_USE_PYTHON_ANALYTICS, "Aura Python analytics is disabled.");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/aura/analyze") {
      await handleAuraPythonProxy(req, res, "/aura/analyze", null, AURA_USE_PYTHON_ANALYTICS, "Aura Python analytics is disabled.");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/thermal/analyze") {
      await handleAuraPythonProxy(req, res, "/thermal/analyze", THERMAL_PYTHON_TIMEOUT_MS, THERMAL_USE_PYTHON_ANALYTICS, "Thermal Python analytics is disabled.");
      return;
    }

    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed." });
      return;
    }

    await serveStaticOrIndex(url.pathname, res);
  } catch (error) {
    json(res, 500, {
      error: "Server runtime error.",
      details: error.message
    });
  }
});

server.listen(PORT, () => {
  console.log(`HYDRA-V runtime listening on http://localhost:${PORT}`);
});

async function handleElevenLabsTts(req, res) {
  if (!process.env.ELEVENLABS_API_KEY) {
    json(res, 500, {
      error: "ELEVENLABS_API_KEY is not configured on the server."
    });
    return;
  }

  const body = await readJson(req);
  const text = typeof body.text === "string" ? body.text.trim() : "";

  if (!text) {
    json(res, 400, { error: "Text is required." });
    return;
  }

  if (text.length > 1400) {
    json(res, 400, {
      error: "Text payload too large. Keep narration under 1400 characters."
    });
    return;
  }

  const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  const modelId = body.modelId || process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  const voiceSettings = body.voiceSettings || {
    stability: 0.45,
    similarityBoost: 0.8,
    style: 0.2,
    useSpeakerBoost: true
  };

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`;

  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg"
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings
    })
  });

  if (!upstream.ok) {
    const errorBody = await upstream.text();
    json(res, upstream.status, {
      error: "ElevenLabs upstream error.",
      details: errorBody || upstream.statusText
    });
    return;
  }

  const audioBuffer = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store"
  });
  res.end(audioBuffer);
}

async function handleHydrawavLogin(req, res) {
  try {
    const body = await readJson(req);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const rememberMe = body.rememberMe !== false;

    if (!username || !password) {
      json(res, 400, { error: "HydraWav username and password are required." });
      return;
    }

    const baseUrl = resolveHydrawavBaseUrl(body.apiBaseUrl);
    if (!baseUrl) {
      json(res, 400, { error: "HydraWav API base URL is required." });
      return;
    }

    const upstream = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password,
        rememberMe
      })
    });

    const upstreamBody = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      json(res, upstream.status, {
        error: "HydraWav login failed.",
        details: upstreamBody?.message || upstreamBody?.error || upstream.statusText
      });
      return;
    }

    const rawAccessToken = upstreamBody?.JWT_ACCESS_TOKEN || upstreamBody?.accessToken || "";
    const accessToken = normalizeBearerToken(rawAccessToken);

    if (!accessToken) {
      json(res, 502, {
        error: "HydraWav login response missing access token.",
        details: "Expected JWT_ACCESS_TOKEN in response body."
      });
      return;
    }

    hydrawavCachedAccessToken = accessToken;
    hydrawavCachedBaseUrl = baseUrl;

    json(res, 200, {
      ok: true,
      apiBaseUrl: baseUrl,
      accessToken
    });
  } catch (error) {
    json(res, 500, {
      error: "Failed to authenticate with HydraWav API.",
      details: error.message
    });
  }
}

async function handleHydrawavPublish(req, res) {
  try {
    const body = await readJson(req);
    const topic = typeof body.topic === "string" ? body.topic.trim() : "";
    const payload = body.payload;
    const baseUrl = resolveHydrawavBaseUrl(body.apiBaseUrl || hydrawavCachedBaseUrl);
    const token = normalizeBearerToken(body.accessToken || hydrawavCachedAccessToken);

    if (!baseUrl) {
      json(res, 400, { error: "HydraWav API base URL is required." });
      return;
    }

    if (!token) {
      json(res, 401, { error: "HydraWav access token missing. Login first." });
      return;
    }

    if (!topic) {
      json(res, 400, { error: "MQTT topic is required." });
      return;
    }

    if (typeof payload !== "string") {
      json(res, 400, { error: "HydraWav payload must be a stringified JSON string." });
      return;
    }

    const upstream = await fetch(`${baseUrl}/api/v1/mqtt/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token
      },
      body: JSON.stringify({
        topic,
        payload
      })
    });

    const upstreamBody = await upstream.json().catch(async () => {
      const asText = await upstream.text().catch(() => "");
      return { raw: asText };
    });

    if (!upstream.ok) {
      json(res, upstream.status, {
        error: "HydraWav MQTT publish failed.",
        details: upstreamBody?.message || upstreamBody?.error || upstreamBody?.raw || upstream.statusText
      });
      return;
    }

    json(res, 200, {
      ok: true,
      topic,
      accepted: true,
      upstream: upstreamBody
    });
  } catch (error) {
    json(res, 500, {
      error: "Failed to publish HydraWav MQTT command.",
      details: error.message
    });
  }
}

async function handleAuraPythonProxy(req, res, endpointPath, timeoutOverrideMs = null, enabled = true, disabledMessage = "Python analytics is disabled.") {
  if (!enabled) {
    json(res, 503, {
      error: disabledMessage,
      details: "Set the corresponding *_USE_PYTHON_ANALYTICS variable to true to enable."
    });
    return;
  }

  try {
    const body = await readJson(req);
    const targetUrl = `${PY_AURA_API_BASE_URL.replace(/\/+$/, "")}${endpointPath}`;
    const controller = new AbortController();
    const timeoutMs = Math.max(Number(timeoutOverrideMs || AURA_PYTHON_TIMEOUT_MS), 500);
    const timeoutId = setTimeout(() => {
      controller.abort(new Error("Aura Python request timed out."));
    }, timeoutMs);

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const upstreamBody = await upstream.json().catch(async () => {
      const raw = await upstream.text().catch(() => "");
      return { raw };
    });

    if (!upstream.ok) {
      json(res, upstream.status, {
        error: "Aura Python analytics request failed.",
        details: upstreamBody?.detail || upstreamBody?.error || upstreamBody?.raw || upstream.statusText
      });
      return;
    }

    json(res, 200, upstreamBody);
  } catch (error) {
    json(res, 502, {
      error: "Unable to reach Aura Python analytics service.",
      details: error.message
    });
  }
}

async function serveStaticOrIndex(pathname, res) {
  const safePath = normalizePath(pathname);
  if (!safePath) {
    json(res, 400, { error: "Invalid request path." });
    return;
  }

  const relativePath = safePath === "/" ? "index.html" : safePath.slice(1);
  const filePath = path.join(__dirname, relativePath);
  const normalizedRoot = path.resolve(__dirname);
  const normalizedFile = path.resolve(filePath);

  if (!normalizedFile.startsWith(normalizedRoot)) {
    json(res, 403, { error: "Path traversal blocked." });
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
    return;
  }

  const indexPath = path.join(__dirname, "index.html");
  const indexData = await fsp.readFile(indexPath);
  res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
  res.end(indexData);
}

function normalizePath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = path.posix.normalize(decoded);

  if (normalized.includes("..")) {
    return null;
  }

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15_000_000) {
        reject(new Error("Request payload too large."));
      }
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON payload."));
      }
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

function resolveHydrawavBaseUrl(input) {
  const candidate = typeof input === "string" ? input.trim() : "";
  const selected = candidate || HYDRAWAV_DEFAULT_BASE_URL;
  return selected ? selected.replace(/\/+$/, "") : "";
}

function normalizeBearerToken(token) {
  if (typeof token !== "string") {
    return "";
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith("Bearer ") ? trimmed : `Bearer ${trimmed}`;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
