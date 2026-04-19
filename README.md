# HYDRA-V

HYDRA-V is a hybrid web runtime for contactless intake, AR-guided recovery exercise, HydraWav hardware synchronization, and AI session analysis.

## Product Flow
1. App boots and auto-starts intake camera flow.
2. A 60-second intake scan computes heart rate, HRV, micro-saccades, symmetry, readiness, and flagged zones.
3. Body map and thermal mapping identify focus zones and Sun/Moon pad targets.
4. Recovery mode starts with HydraWav therapy command, cardiac gating, neural mirror priming, and neuroacoustic audio phases.
5. AR exercise runs with translucent anatomy overlays plus a bottom-left movement preview for the current action.
6. A 3D virtual game runs in the background and advances from real movement quality, reps, and progress.
7. Post-session recheck runs, then REA AI analysis shows real deltas and next protocol recommendation.

## Runtime Stack
- Frontend (`index.html`, `app.js`, `src/features/*`): camera layers, overlays, game loop, UI flow state.
- Node gateway (`server.js`): static host, HydraWav API proxy, ElevenLabs TTS proxy, Python analytics proxy.
- Python analytics (`python_service/`): Aura signal processing, RuView-style local fusion, thermal optical-flow analysis.

## Camera Layer Composition
- `virtual-game-canvas`: 3D motivation world during exercise.
- `aura-camera-canvas`: live camera feed.
- `thermal-overlay-canvas`: thermal/body mask overlays.
- `neural-ghost-canvas`: mirrored neural-handshake overlay.
- `game-overlay-canvas`: action HUD + movement preview + guidance.

## Core Output Contracts
- Intake metrics: `heartRateBpm`, `rrIntervalMs`, `hrvRmssdMs`, `microsaccadeHz`, `symmetryDeltaPct`, `readinessScore`, `flaggedZones`, `algorithm`, `vitalsSource`.
- Thermal metrics: `flaggedZones`, `zoneScores`, `chainTargets`, `recommendedPads.sun`, `recommendedPads.moon`, overlay anchors.
- Game metrics: `score`, `actionsCompleted`, `actionsTotal`, `movementMatchScore`, `motionSyncScore`, `vitalsScore`, summary averages.
- Session deltas: HRV/symmetry/micro/readiness deltas, ROM gain estimate, adaptive expected improvement and confidence.

## Prerequisites
- Node.js 18+ (Node 20+ recommended).
- Python 3.10+.
- Webcam permissions.
- Chrome/Edge recommended.

## Setup
1. Install Node dependencies.
```bash
npm install
```
2. Setup Python environment.
```bash
cd python_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```
3. Create `.env` from `.env.example` and fill required keys.

## Run
1. Start Python service.
```bash
cd python_service
.venv\Scripts\activate
python main.py
```
2. Start Node runtime in a second terminal.
```bash
cd ..
npm start
```
3. Open `http://localhost:3000`.

## Environment Variables
- `PORT=3000`
- `ELEVENLABS_API_KEY=...`
- `ELEVENLABS_VOICE_ID=...`
- `ELEVENLABS_MODEL_ID=...`
- `HYDRAWAV_API_BASE_URL=http://54.241.236.53:8080`
- `HYDRAWAV_USERNAME=testpractitioner`
- `HYDRAWAV_PASSWORD=1234`
- `PY_AURA_API_BASE_URL=http://127.0.0.1:8010`
- `AURA_USE_PYTHON_ANALYTICS=true`
- `THERMAL_USE_PYTHON_ANALYTICS=true`
- `AURA_PYTHON_TIMEOUT_MS=1500`
- `THERMAL_PYTHON_TIMEOUT_MS=9000`
- `RUVIEW_LOCAL_FUSION_ENABLED=true`

## HTTP APIs
- `GET /api/health`
- `POST /api/voice/elevenlabs/tts`
- `POST /api/device/hydrawav/login`
- `POST /api/device/hydrawav/publish`
- `POST /api/aura/reset`
- `POST /api/aura/analyze`
- `POST /api/thermal/analyze`

Python service endpoints:
- `GET /health`
- `POST /aura/reset`
- `POST /aura/analyze`
- `POST /thermal/analyze`

## Integration Bridge
`window.HydraVBridge` exposes runtime controls for camera, intake scan, thermal scan, neural handshake, cardiac gating, HydraWav API calls, neuro session, narration, and live snapshot retrieval.

## Troubleshooting
- Voice not playing: set `ELEVENLABS_API_KEY`, click once to prime browser audio, fallback browser speech is used if ElevenLabs fails.
- HydraWav errors: verify API base URL, credentials, topic, MAC, and check `/api/health`.
- Python analytics unavailable: verify service on `127.0.0.1:8010`; intake falls back to JS metrics when needed.

## Notes
- Wellness support software only, not diagnostic software.
- HydraWav publish payload must be a JSON string.
- Movement preview panel uses real exercise GIF demos from `src/assets/movements/demos/` (see `SOURCE.md`).

## Teammates
- Manav
- Deep Nayak
- Riya Attri
