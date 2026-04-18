# HYDRA-V Python Aura Analytics

Optional high-performance analytics service for Feature 1 (Aura-Scan+).

## What it does
- Receives incremental rPPG + eye motion telemetry from the browser.
- Computes HR, RR interval, RMSSD HRV, micro-saccade frequency, readiness score.
- Optionally fuses RuView vitals (heart/breath rate) when `RUVIEW_API_BASE_URL` is set.

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
- `RUVIEW_API_BASE_URL` (optional)
- `RUVIEW_VITALS_PATH` (default `/api/v1/vital-signs`)
- `RUVIEW_TIMEOUT_MS` (default `1200`)
