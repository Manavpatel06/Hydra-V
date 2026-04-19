# HYDRA-V
## Feature 1-5 Runtime (Hybrid JS + Python)

This project now runs a hybrid architecture:
1. **Frontend (JS)** for real-time camera UI, pose overlay, neural ghost rendering, and session controls.
2. **Node runtime (`server.js`)** for secure API proxies (HydraWav + ElevenLabs + Python analytics bridge).
3. **Python analytics service** for higher-quality Aura-Scan signal processing, RuView-style local vitals fusion, and thermal mapping.

All 5 features remain integrated.

## Features

### Feature 1 - Aura-Scan+
- MediaPipe Pose + FaceMesh capture in browser.
- Forehead rPPG sampling and eye motion telemetry.
- Python analytics path (optional but enabled by default):
  - HR estimation (Welch + bandpass)
  - RR + RMSSD HRV
  - micro-saccade rate
  - readiness score
  - RuView-style local heart/breath fusion (no external API required)
- Automatic fallback to local JS metrics if Python service is unavailable.

### Feature 2 - Neural Handshake
- Records healthy-side motion and mirrors to injured side as glowing ghost.
- Auto-target from Aura-Scan flagged cold zone.

### Feature 3 - Cardiac Gating+
- T-wave pulse scheduling (`80-120 ms` offset).
- BLE transport support.
- HydraWav official login/publish API support.

### Feature 4 - Neuroacoustic Entrainment
- Adaptive binaural phases (`pre -> during -> post`).
- ElevenLabs narration integration.

### Feature 5 - Fascial Thermal Mapping
- 8-second camera scan captured from Aura camera canvas.
- Python OpenCV Farneback optical-flow variance analysis.
- Zone-level perfusion/cold scoring (`shoulder/hip/knee`, left/right).
- Myofascial chain linking and dual-pad recommendation output (`sun` + `moon`).
- AR-ready overlay anchors returned in API payload.

## Run

### 1) Node runtime
```bash
npm start
```
Or:
```bash
node server.js
```

### 2) Python analytics service (recommended)
```bash
cd python_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Default Python API: `http://127.0.0.1:8010`

### 3) Open app
- `http://localhost:3000`

## Env Variables

Set these in `.env`:

- `PORT=3000`
- `ELEVENLABS_API_KEY=...`
- `ELEVENLABS_VOICE_ID=...` (optional)
- `ELEVENLABS_MODEL_ID=...` (optional)
- `HYDRAWAV_API_BASE_URL=https://...`
- `HYDRAWAV_USERNAME=...` (required for auto-auth)
- `HYDRAWAV_PASSWORD=...` (required for auto-auth)

Hybrid analytics:
- `PY_AURA_API_BASE_URL=http://127.0.0.1:8010`
- `AURA_USE_PYTHON_ANALYTICS=true`
- `THERMAL_USE_PYTHON_ANALYTICS=true`
- `AURA_PYTHON_TIMEOUT_MS=1500`
- `THERMAL_PYTHON_TIMEOUT_MS=9000`

RuView local fusion:
- `RUVIEW_LOCAL_FUSION_ENABLED=true`

## Key Endpoints

Node:
- `GET /api/health`
- `POST /api/voice/elevenlabs/tts`
- `POST /api/device/hydrawav/login`
- `POST /api/device/hydrawav/publish`
- `POST /api/aura/reset` (proxy to Python)
- `POST /api/aura/analyze` (proxy to Python)
- `POST /api/thermal/analyze` (proxy to Python)

Python:
- `GET /health`
- `POST /aura/reset`
- `POST /aura/analyze`
- `POST /thermal/analyze`

## Bridge Contract

`window.HydraVBridge` still exposes the full control surface for Features 1-5 and is backward compatible with previous integration methods.

## Notes
- Wellness-support software only (no diagnosis claims).
- HydraWav payloads must be stringified JSON.
- If Python service is down, Aura-Scan still runs via JS fallback.
