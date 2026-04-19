# HYDRA-V Python Analytics (Aura + Thermal)

Optional high-performance analytics service for Feature 1 (Aura-Scan+) and Feature 5 (Fascial Thermal Mapping).

## What it does
- Receives incremental rPPG + eye motion telemetry from the browser.
- Computes HR, RR interval, RMSSD HRV, micro-saccade frequency, readiness score.
- Fuses RuView-style local vitals (heart/breath rate) on-device (no external RuView API).
- Receives short camera bursts for thermal mapping.
- Computes dense Farneback optical-flow variance, chain links, and Sun/Moon pad recommendations.

## Setup

1. Create virtual environment and install:
```bash
cd python_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

2. Run service:
```bash
python main.py
```

Default endpoint: `http://127.0.0.1:8010`

## Env Vars
- `AURA_PY_HOST` (default `127.0.0.1`)
- `AURA_PY_PORT` (default `8010`)
- `RUVIEW_LOCAL_FUSION_ENABLED` (default `true`)

## Endpoints
- `GET /health`
- `POST /aura/reset`
- `POST /aura/analyze`
- `POST /thermal/analyze`
