from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.ruview_client import RuViewClient
from app.signal_processing import SessionState, compute_metrics, update_state

load_dotenv()


class PpgSample(BaseModel):
    timestamp_ms: float
    value: float
    mode: str | None = "green"


class EyeSample(BaseModel):
    timestamp_ms: float
    x: float
    y: float


class PoseSummary(BaseModel):
    symmetry_delta_pct: float | None = None
    flagged_zones: list[dict[str, Any]] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    session_id: str
    timestamp_ms: float
    scan_duration_sec: float = 60.0
    ppg_samples: list[PpgSample] = Field(default_factory=list)
    eye_samples: list[EyeSample] = Field(default_factory=list)
    pose_summary: PoseSummary = Field(default_factory=PoseSummary)
    local_metrics: dict[str, Any] | None = None


class ResetRequest(BaseModel):
    session_id: str


@dataclass
class RuntimeStore:
    sessions: dict[str, SessionState]


store = RuntimeStore(sessions={})
ruview_client = RuViewClient()

app = FastAPI(title="HYDRA-V Python Aura Analytics", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
      "ok": True,
      "service": "HYDRA-V Python Aura Analytics",
      "ruview_enabled": ruview_client.enabled,
      "sessions": len(store.sessions)
    }


@app.post("/aura/reset")
async def aura_reset(payload: ResetRequest) -> dict[str, Any]:
    store.sessions[payload.session_id] = SessionState()
    return {
      "ok": True,
      "session_id": payload.session_id
    }


@app.post("/aura/analyze")
async def aura_analyze(payload: AnalyzeRequest) -> dict[str, Any]:
    if not payload.session_id:
        raise HTTPException(status_code=400, detail="session_id is required")

    state = store.sessions.get(payload.session_id)
    if state is None:
        state = SessionState()
        store.sessions[payload.session_id] = state

    update_state(state, {
      "ppg_samples": [sample.model_dump() for sample in payload.ppg_samples],
      "eye_samples": [sample.model_dump() for sample in payload.eye_samples],
      "pose_summary": payload.pose_summary.model_dump()
    })

    ruview_data = await ruview_client.fetch_vitals(payload.timestamp_ms)

    metrics = compute_metrics(
      state=state,
      local_metrics=payload.local_metrics,
      ruview=ruview_data
    )

    return {
      "ok": True,
      "session_id": payload.session_id,
      "metrics": metrics,
      "ruview": ruview_data,
      "python_analytics_enabled": True
    }


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("AURA_PY_HOST", "127.0.0.1")
    port = int(os.getenv("AURA_PY_PORT", "8010") or 8010)

    uvicorn.run("main:app", host=host, port=port, reload=False)
