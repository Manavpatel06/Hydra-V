from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque
from typing import Any

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, welch


@dataclass
class SessionState:
    ppg_ts: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_values: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_modes: deque[str] = field(default_factory=lambda: deque(maxlen=5000))

    eye_ts: deque[float] = field(default_factory=lambda: deque(maxlen=2500))
    eye_x: deque[float] = field(default_factory=lambda: deque(maxlen=2500))
    eye_y: deque[float] = field(default_factory=lambda: deque(maxlen=2500))

    flagged_zones: list[dict[str, Any]] = field(default_factory=list)
    symmetry_delta_pct: float | None = None


def update_state(state: SessionState, payload: dict[str, Any]) -> SessionState:
    for sample in payload.get("ppg_samples", []):
        ts = sample.get("timestamp_ms")
        val = sample.get("value")
        mode = sample.get("mode") or "green"
        if isinstance(ts, (int, float)) and isinstance(val, (int, float)):
            state.ppg_ts.append(float(ts))
            state.ppg_values.append(float(val))
            state.ppg_modes.append(str(mode))

    for sample in payload.get("eye_samples", []):
        ts = sample.get("timestamp_ms")
        x = sample.get("x")
        y = sample.get("y")
        if isinstance(ts, (int, float)) and isinstance(x, (int, float)) and isinstance(y, (int, float)):
            state.eye_ts.append(float(ts))
            state.eye_x.append(float(x))
            state.eye_y.append(float(y))

    pose_summary = payload.get("pose_summary") or {}
    if isinstance(pose_summary.get("symmetry_delta_pct"), (int, float)):
        state.symmetry_delta_pct = float(pose_summary["symmetry_delta_pct"])

    if isinstance(pose_summary.get("flagged_zones"), list):
        state.flagged_zones = pose_summary.get("flagged_zones") or []

    _trim_by_time(state)
    return state


def _trim_by_time(state: SessionState) -> None:
    if not state.ppg_ts:
        return

    latest_ppg = state.ppg_ts[-1]
    cutoff_ppg = latest_ppg - 90_000
    while state.ppg_ts and state.ppg_ts[0] < cutoff_ppg:
        state.ppg_ts.popleft()
        state.ppg_values.popleft()
        state.ppg_modes.popleft()

    if state.eye_ts:
        latest_eye = state.eye_ts[-1]
        cutoff_eye = latest_eye - 45_000
        while state.eye_ts and state.eye_ts[0] < cutoff_eye:
            state.eye_ts.popleft()
            state.eye_x.popleft()
            state.eye_y.popleft()


def compute_metrics(
    state: SessionState,
    local_metrics: dict[str, Any] | None = None,
    ruview: dict[str, Any] | None = None
) -> dict[str, Any] | None:
    if len(state.ppg_values) < 64:
        return local_metrics

    times_ms = np.array(state.ppg_ts, dtype=np.float64)
    values = np.array(state.ppg_values, dtype=np.float64)

    duration_sec = max((times_ms[-1] - times_ms[0]) / 1000.0, 1e-3)
    sampling_hz = len(values) / duration_sec
    if sampling_hz < 4:
        return local_metrics

    filtered = _bandpass(values, sampling_hz, 0.7, 3.2)

    heart_rate_bpm = _estimate_hr_welch(filtered, sampling_hz)
    rr_intervals_ms, hrv_rmssd_ms = _estimate_rr_hrv(filtered, times_ms, sampling_hz)
    rr_interval_ms = float(np.mean(rr_intervals_ms)) if len(rr_intervals_ms) else None

    microsaccade_hz = _estimate_microsaccade_hz(state)

    symmetry_delta = state.symmetry_delta_pct
    if symmetry_delta is None and local_metrics:
        symmetry_delta = _to_float(local_metrics.get("symmetry_delta_pct"))

    readiness_score = _compute_readiness_score(
        hrv_rmssd_ms if hrv_rmssd_ms is not None else (rr_interval_ms / 12 if rr_interval_ms else 20),
        symmetry_delta if symmetry_delta is not None else 8,
        microsaccade_hz
    )

    algorithm = _dominant_mode(list(state.ppg_modes))

    fused_hr, source = _fuse_heart_rate(heart_rate_bpm, ruview)

    result = {
        "algorithm": "python-fused" if ruview else f"python-{algorithm}",
        "heart_rate_bpm": _round(fused_hr, 1),
        "rr_interval_ms": _round(rr_interval_ms, 1),
        "hrv_rmssd_ms": _round(hrv_rmssd_ms, 1),
        "microsaccade_hz": _round(microsaccade_hz, 3),
        "symmetry_delta_pct": _round(symmetry_delta, 2),
        "flagged_zones": state.flagged_zones,
        "readiness_score": _round(readiness_score, 2),
        "cns_fatigue": bool(microsaccade_hz is not None and microsaccade_hz < 0.5),
        "breath_rate_per_min": None,
        "vitals_source": source
    }

    if ruview and isinstance(ruview.get("breath_rate_per_min"), (int, float)):
        result["breath_rate_per_min"] = _round(float(ruview["breath_rate_per_min"]), 1)

    if local_metrics:
        for key in ["flagged_zones", "symmetry_delta_pct", "microsaccade_hz"]:
            local_value = local_metrics.get(key)
            if result.get(key) is None and local_value is not None:
                result[key] = local_value

    return result


def _bandpass(signal: np.ndarray, fs: float, low: float, high: float) -> np.ndarray:
    nyquist = max(fs / 2.0, 1e-6)
    low_n = max(low / nyquist, 1e-4)
    high_n = min(high / nyquist, 0.999)

    if high_n <= low_n:
        return signal - np.mean(signal)

    b, a = butter(3, [low_n, high_n], btype="bandpass")
    centered = signal - np.mean(signal)

    try:
        return filtfilt(b, a, centered)
    except Exception:
        return centered


def _estimate_hr_welch(signal: np.ndarray, fs: float) -> float | None:
    if len(signal) < 32:
        return None

    nperseg = min(len(signal), 256)
    freqs, pxx = welch(signal, fs=fs, nperseg=nperseg)

    mask = (freqs >= 0.7) & (freqs <= 3.2)
    if not np.any(mask):
        return None

    focus_freqs = freqs[mask]
    focus_pxx = pxx[mask]
    best_idx = int(np.argmax(focus_pxx))
    return float(focus_freqs[best_idx] * 60.0)


def _estimate_rr_hrv(signal: np.ndarray, times_ms: np.ndarray, fs: float) -> tuple[np.ndarray, float | None]:
    if len(signal) < 32:
        return np.array([]), None

    prominence = max(np.std(signal) * 0.18, 0.01)
    min_distance = max(int(fs * 0.28), 1)

    peaks, _ = find_peaks(signal, distance=min_distance, prominence=prominence)
    if len(peaks) < 2:
        return np.array([]), None

    peak_times_sec = times_ms[peaks] / 1000.0
    rr_sec = np.diff(peak_times_sec)

    rr_sec = rr_sec[(rr_sec >= 0.25) & (rr_sec <= 2.0)]
    if len(rr_sec) < 2:
        rr_ms = rr_sec * 1000.0
        return rr_ms, None

    rr_ms = rr_sec * 1000.0
    diffs = np.diff(rr_ms)
    rmssd = float(np.sqrt(np.mean(np.square(diffs)))) if len(diffs) else None

    return rr_ms, rmssd


def _estimate_microsaccade_hz(state: SessionState) -> float | None:
    if len(state.eye_ts) < 8:
        return None

    ts = np.array(state.eye_ts, dtype=np.float64)
    x = np.array(state.eye_x, dtype=np.float64)
    y = np.array(state.eye_y, dtype=np.float64)

    dt = np.diff(ts) / 1000.0
    dt = np.clip(dt, 1e-3, None)

    dx = np.diff(x)
    dy = np.diff(y)
    speed = np.sqrt(dx * dx + dy * dy) / dt

    if not len(speed):
        return None

    threshold = 0.18
    bursts = np.sum((speed[1:] > threshold) & (speed[:-1] <= threshold))

    span_sec = max((ts[-1] - ts[0]) / 1000.0, 1.0)
    return float(bursts / span_sec)


def _compute_readiness_score(hrv_rmssd_ms: float, symmetry_delta_pct: float, microsaccade_hz: float | None) -> float:
    hrv_norm = np.clip((hrv_rmssd_ms - 15) / (80 - 15), 0, 1)
    symmetry_norm = 1 - np.clip(symmetry_delta_pct / 30, 0, 1)

    if microsaccade_hz is None:
        micro_norm = 0.4
    elif microsaccade_hz <= 0.5:
        micro_norm = 0.1
    elif microsaccade_hz >= 1.8:
        micro_norm = 1.0
    else:
        micro_norm = np.clip((microsaccade_hz - 0.5) / (1.8 - 0.5), 0, 1)

    score = (hrv_norm * 0.45 + symmetry_norm * 0.35 + micro_norm * 0.2) * 10
    return float(np.clip(score, 0, 10))


def _dominant_mode(modes: list[str]) -> str:
    if not modes:
        return "green"

    green = sum(1 for mode in modes if mode == "green")
    pos = len(modes) - green
    return "pos" if pos > green else "green"


def _fuse_heart_rate(local_hr: float | None, ruview: dict[str, Any] | None) -> tuple[float | None, str]:
    if ruview is None:
        return local_hr, "python"

    ru_hr = _to_float(ruview.get("heart_rate_bpm"))
    if local_hr is None:
        return ru_hr, "ruview"
    if ru_hr is None:
        return local_hr, "python"

    ru_conf = _to_float(ruview.get("confidence"))
    ru_conf = min(max(ru_conf if ru_conf is not None else 0.65, 0.2), 1.0)

    py_conf = 0.72

    if abs(local_hr - ru_hr) <= 8:
        fused = (local_hr * py_conf + ru_hr * ru_conf) / (py_conf + ru_conf)
        return fused, "python+ruview"

    return (local_hr, "python") if py_conf >= ru_conf else (ru_hr, "ruview")


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _round(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)
