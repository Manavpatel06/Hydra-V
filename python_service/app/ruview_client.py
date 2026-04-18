import os
from dataclasses import dataclass, field
from typing import Any

import httpx


def _pick_number(payload: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


@dataclass
class RuViewClient:
    base_url: str = field(default_factory=lambda: os.getenv("RUVIEW_API_BASE_URL", "").strip())
    vitals_path: str = field(default_factory=lambda: os.getenv("RUVIEW_VITALS_PATH", "/api/v1/vital-signs").strip() or "/api/v1/vital-signs")
    timeout_ms: int = field(default_factory=lambda: int(os.getenv("RUVIEW_TIMEOUT_MS", "1200") or 1200))

    _last_fetch_ms: float = 0.0
    _cache: dict[str, Any] | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)

    async def fetch_vitals(self, now_ms: float) -> dict[str, Any] | None:
        if not self.enabled:
            return None

        if self._cache and now_ms - self._last_fetch_ms < 1000:
            return self._cache

        url = f"{self.base_url.rstrip('/')}/{self.vitals_path.lstrip('/')}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout_ms / 1000.0) as client:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()
        except Exception:
            return self._cache

        parsed = self._parse_payload(data)
        if parsed:
            self._cache = parsed
            self._last_fetch_ms = now_ms

        return self._cache

    def _parse_payload(self, payload: Any) -> dict[str, Any] | None:
        if isinstance(payload, list) and payload:
            payload = payload[0]

        if not isinstance(payload, dict):
            return None

        hr = _pick_number(payload, ["heart_rate", "heartRate", "hr", "hr_bpm", "pulse", "bpm"])
        breath = _pick_number(payload, ["breath_rate", "breathRate", "resp_rate", "respiratory_rate", "breathing_rate"])

        confidence = _pick_number(payload, ["confidence", "quality", "signal_quality", "hr_confidence"])
        breath_confidence = _pick_number(payload, ["breath_confidence", "resp_confidence", "resp_quality"])

        if hr is None and breath is None:
            return None

        return {
            "heart_rate_bpm": hr,
            "breath_rate_per_min": breath,
            "confidence": confidence if confidence is not None else 0.65,
            "breath_confidence": breath_confidence if breath_confidence is not None else 0.65
        }
