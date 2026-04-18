# HYDRA-V MVP (Feature 6 + Feature 7)

HYDRA-V is a practitioner-first recovery intelligence layer for Hydrawav3.

This MVP ships two core modules:

- **Feature 6: Solace Digital Garden+**
- **Feature 7: Adaptive Protocol AI**
- **HydraWav MQTT Device Bridge (from hackathon API PDF)**

The app is fully browser-based, uses **IndexedDB** for local persistence, and does not require cloud storage for model training.

## 1. Brand-New Mac Setup (from zero)

Run these commands in Terminal, in order:

```bash
xcode-select --install
```

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

After Homebrew installation, add it to shell:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Install Node LTS:

```bash
brew install node
```

Verify:

```bash
node -v
npm -v
git --version
```

Optional quick check:

```bash
cd /Users/deepnayak/Desktop/Hydrawav3/hydra-v
./scripts/doctor.sh
```

## 2. Run This Project

```bash
cd /Users/deepnayak/Desktop/Hydrawav3/hydra-v
npm install
npm run dev
```

Open the local URL shown in terminal (usually `http://localhost:5173`).

## 3. Optional ElevenLabs Voice (Post-Session Note)

Create `.env.local` in project root:

```bash
VITE_ELEVENLABS_API_KEY=your_key_here
VITE_ELEVENLABS_VOICE_ID=your_voice_id_here
```

If env vars are missing, app falls back to browser speech synthesis.

## 4. Build for Demo

```bash
npm run build
npm run preview
```

## 5. What This MVP Includes

### Feature 6: Solace Digital Garden+

- React Three Fiber 3D garden scene
- Session-to-tree growth mapping with L-system grammar
- Species mapping:
  - Birch = photobiomodulation
  - Bamboo = resonance
  - Pine = thermal
  - Oak = balanced/high performance
- Frost visualization when residual asymmetry is elevated
- Blossom event when recent sessions hit HRV + symmetry milestones
- River biome unlock when symmetry delta reaches equilibrium threshold
- Rare species unlock at personal HRV best
- One-click garden image capture for social sharing workflow

### Feature 7: Adaptive Protocol AI

- Per-athlete N-of-1 modeling
- Gaussian Process regression over protocol parameter vectors
- Expected Improvement search for next protocol recommendation
- Confidence map per parameter
- Diminishing-return detection with concrete parameter-shift suggestions
- Practitioner override note that feeds the learning loop
- Local training/inference with IndexedDB-backed session history

### HydraWav MQTT Device Bridge

- Login endpoint wired: `POST /api/v1/auth/login`
- Publish endpoint wired: `POST /api/v1/mqtt/publish`
- Topic used: `HydraWav3Pro/config`
- Payload sent as **stringified JSON** exactly as document requires
- Control commands from UI:
  - Start (`playCmd=1`)
  - Pause (`playCmd=2`)
  - Stop (`playCmd=3`)
  - Resume (`playCmd=4`)
- Start-session payload is auto-derived from current protocol recommendation/sliders

## 6. Core Workflow

1. Review recommendation in **Adaptive Protocol AI** panel.
2. Tap **Apply AI Recommendation** (or manually tune sliders).
3. In **HydraWav Device Bridge**, login and send Start/Pause/Resume/Stop.
4. Complete session in **Outcome + Continuity Capture**.
5. Save session to update model and grow garden.
6. Open **Solace Garden+**, play voice note, capture share image.

## 7. Wellness Guardrails (Built-In)

- Messaging is positioned as recovery support, mobility, and performance support.
- No diagnosis or treatment claims are made.
- Recommendations are explainable in UI (rationale + confidence + warnings).

## 8. Project Structure

```txt
src/
  components/
    AdaptiveProtocolPanel.tsx
    DeviceBridgePanel.tsx
    OutcomeCapturePanel.tsx
    SolaceGardenPanel.tsx
    garden/
      GardenScene.tsx
      TreeMesh.tsx
  data/
    seedSessions.ts
  db/
    hydraDb.ts
  hooks/
    useHydraSessions.ts
  lib/
    adaptiveProtocol.ts
    gaussianProcess.ts
    gardenGrowth.ts
    hydrawavDeviceApi.ts
    math.ts
    scoring.ts
    voice.ts
  types/
    domain.ts
    hydrawav.ts
  App.tsx
  main.tsx
  index.css
```

## 9. Hackathon Notes

- This code is optimized for rapid demo clarity over deep medical-grade validation.
- You can extend this by wiring Hydrawav device commands (MQTT/BLE) into the session execution step.
- Keep judge flow tight: intake summary -> recommendation -> session complete -> garden growth -> next suggestion.
- The source PDF appears to have a likely typo in the command table (`Pause=3`) while explicit pause request shows `playCmd=2`; implementation follows explicit request examples.

## 10. If a Click Seems Not Working

- `Play Post-Session Voice Note`:
  - Needs browser audio output.
  - ElevenLabs requires env keys; without keys app uses browser speech synthesis fallback.
- `Device Bridge Login`:
  - Needs reachable backend base URL.
  - Browser must be allowed by backend CORS policy.
- `Start/Pause/Resume/Stop`:
  - Requires successful login token first.
  - Publishes to `/api/v1/mqtt/publish` and may fail if token or payload is rejected.
- `Capture Share Image`:
  - Works after 3D canvas finishes loading.
