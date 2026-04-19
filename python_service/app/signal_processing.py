from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.signal import butter, filtfilt, find_peaks, welch


@dataclass
class SessionState:
    ppg_ts: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_values: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_modes: deque[str] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_r: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_g: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_b: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    ppg_quality: deque[float] = field(default_factory=lambda: deque(maxlen=5000))

    eye_ts: deque[float] = field(default_factory=lambda: deque(maxlen=2500))
    eye_x: deque[float] = field(default_factory=lambda: deque(maxlen=2500))
    eye_y: deque[float] = field(default_factory=lambda: deque(maxlen=2500))

    wearable_hr_ts: deque[float] = field(default_factory=lambda: deque(maxlen=3000))
    wearable_hr_values: deque[float] = field(default_factory=lambda: deque(maxlen=3000))
    wearable_hr_conf: deque[float] = field(default_factory=lambda: deque(maxlen=3000))

    wearable_rr_ts: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    wearable_rr_values: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    wearable_rr_conf: deque[float] = field(default_factory=lambda: deque(maxlen=5000))
    wearable_source: str | None = None

    flagged_zones: list[dict[str, Any]] = field(default_factory=list)
    symmetry_delta_pct: float | None = None


def update_state(state: SessionState, payload: dict[str, Any]) -> SessionState:
    for sample in payload.get("ppg_samples", []):
        ts = sample.get("timestamp_ms")
        val = sample.get("value")
        mode = sample.get("mode") or "green"
        if not isinstance(ts, (int, float)) or not isinstance(val, (int, float)):
            continue

        rgb = _extract_rgb(sample.get("rgb"))
        quality = _to_float(sample.get("quality"))
        if quality is None:
            quality = 0.62 if mode == "green" else 0.56

        r = np.nan
        g = np.nan
        b = np.nan
        if rgb is not None:
            r, g, b = rgb
        elif mode == "green":
            g = float(val)

        state.ppg_ts.append(float(ts))
        state.ppg_values.append(float(val))
        state.ppg_modes.append(str(mode))
        state.ppg_r.append(float(r))
        state.ppg_g.append(float(g))
        state.ppg_b.append(float(b))
        state.ppg_quality.append(_clamp(float(quality), 0.0, 1.0))

    for sample in payload.get("eye_samples", []):
        ts = sample.get("timestamp_ms")
        x = sample.get("x")
        y = sample.get("y")
        if isinstance(ts, (int, float)) and isinstance(x, (int, float)) and isinstance(y, (int, float)):
            state.eye_ts.append(float(ts))
            state.eye_x.append(float(x))
            state.eye_y.append(float(y))

    for sample in payload.get("wearable_samples", []):
        ts = _to_float(sample.get("timestamp_ms"))
        if ts is None:
            continue
        conf = _clamp(_to_float(sample.get("confidence")) or 0.65, 0.0, 1.0)
        source = sample.get("source")
        if isinstance(source, str) and source.strip():
            state.wearable_source = source.strip()

        hr = _to_float(sample.get("heart_rate_bpm"))
        if hr is not None and 30 <= hr <= 240:
            state.wearable_hr_ts.append(ts)
            state.wearable_hr_values.append(hr)
            state.wearable_hr_conf.append(conf)

        rr_single = _to_float(sample.get("rr_interval_ms"))
        if rr_single is not None and 250 <= rr_single <= 2200:
            state.wearable_rr_ts.append(ts)
            state.wearable_rr_values.append(rr_single)
            state.wearable_rr_conf.append(conf)

        rr_list = sample.get("rr_intervals_ms")
        if isinstance(rr_list, list):
            for rr in rr_list:
                rr_val = _to_float(rr)
                if rr_val is None or rr_val < 250 or rr_val > 2200:
                    continue
                state.wearable_rr_ts.append(ts)
                state.wearable_rr_values.append(rr_val)
                state.wearable_rr_conf.append(conf)

    pose_summary = payload.get("pose_summary") or {}
    if isinstance(pose_summary.get("symmetry_delta_pct"), (int, float)):
        state.symmetry_delta_pct = float(pose_summary["symmetry_delta_pct"])

    if isinstance(pose_summary.get("flagged_zones"), list):
        state.flagged_zones = pose_summary.get("flagged_zones") or []

    _trim_by_time(state)
    return state


def _trim_by_time(state: SessionState) -> None:
    if state.ppg_ts:
        latest_ppg = state.ppg_ts[-1]
        cutoff_ppg = latest_ppg - 90_000
        while state.ppg_ts and state.ppg_ts[0] < cutoff_ppg:
            state.ppg_ts.popleft()
            state.ppg_values.popleft()
            state.ppg_modes.popleft()
            state.ppg_r.popleft()
            state.ppg_g.popleft()
            state.ppg_b.popleft()
            state.ppg_quality.popleft()

    if state.eye_ts:
        latest_eye = state.eye_ts[-1]
        cutoff_eye = latest_eye - 45_000
        while state.eye_ts and state.eye_ts[0] < cutoff_eye:
            state.eye_ts.popleft()
            state.eye_x.popleft()
            state.eye_y.popleft()

    if state.wearable_hr_ts:
        latest_hr = state.wearable_hr_ts[-1]
        cutoff_hr = latest_hr - 180_000
        while state.wearable_hr_ts and state.wearable_hr_ts[0] < cutoff_hr:
            state.wearable_hr_ts.popleft()
            state.wearable_hr_values.popleft()
            state.wearable_hr_conf.popleft()

    if state.wearable_rr_ts:
        latest_rr = state.wearable_rr_ts[-1]
        cutoff_rr = latest_rr - 180_000
        while state.wearable_rr_ts and state.wearable_rr_ts[0] < cutoff_rr:
            state.wearable_rr_ts.popleft()
            state.wearable_rr_values.popleft()
            state.wearable_rr_conf.popleft()


def compute_metrics(
    state: SessionState,
    local_metrics: dict[str, Any] | None = None,
    ruview: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    local_metrics = local_metrics or {}

    symmetry_delta = state.symmetry_delta_pct
    if symmetry_delta is None:
        symmetry_delta = _to_float(local_metrics.get("symmetry_delta_pct"))

    pose_quality = _to_float(local_metrics.get("pose_quality"))
    motion_artifact = _to_float(local_metrics.get("motion_artifact_score"))
    if motion_artifact is None:
        motion_artifact = 0.0

    wearable = _estimate_wearable_metrics(state)
    camera = _estimate_camera_metrics(state)

    camera_signal_quality = _to_float(local_metrics.get("camera_signal_quality"))
    if camera_signal_quality is None:
        camera_signal_quality = camera.get("signal_quality")
    elif camera.get("signal_quality") is not None:
        camera_signal_quality = _clamp(camera_signal_quality * 0.55 + camera["signal_quality"] * 0.45, 0.0, 1.0)

    camera_hr = camera.get("heart_rate_bpm")
    camera_hr_conf = camera.get("heart_rate_confidence", 0.0)
    rr_interval_ms = camera.get("rr_interval_ms")
    camera_rr_conf = camera.get("rr_confidence", 0.0)
    camera_hrv = camera.get("hrv_rmssd_ms")
    camera_breath = camera.get("breath_rate_per_min")
    camera_breath_conf = camera.get("breath_confidence", 0.0)
    camera_algorithm = camera.get("algorithm") or _dominant_mode(list(state.ppg_modes))

    microsaccade_hz = _estimate_microsaccade_hz(state)

    ru_hr = _to_float(ruview.get("heart_rate_bpm")) if isinstance(ruview, dict) else None
    ru_breath = _to_float(ruview.get("breath_rate_per_min")) if isinstance(ruview, dict) else None
    ru_conf = _to_float(ruview.get("confidence")) if isinstance(ruview, dict) else None
    ru_signal_quality = _to_float(ruview.get("signal_quality")) if isinstance(ruview, dict) else None
    if ru_conf is None:
        ru_conf = 0.0
    if ru_signal_quality is None:
        ru_signal_quality = 0.0
    ru_conf = _clamp(ru_conf * (0.35 + 0.65 * ru_signal_quality), 0.0, 1.0)
    ru_breath_conf = _clamp((_to_float(ruview.get("breath_confidence")) or 0.0) * (0.35 + 0.65 * ru_signal_quality), 0.0, 1.0) if isinstance(ruview, dict) else 0.0

    camera_conf = _combine_camera_confidence(
        spectral_conf=camera_hr_conf,
        rr_conf=camera_rr_conf,
        signal_quality=_clamp(camera_signal_quality or 0.0, 0.0, 1.0),
        pose_quality=_clamp((pose_quality if pose_quality is not None else 0.65), 0.0, 1.0),
        motion_artifact=_clamp(motion_artifact, 0.0, 1.0),
    )

    if ru_hr is not None and camera_hr is not None and abs(ru_hr - camera_hr) > 18:
        if ru_conf < camera_conf:
            ru_conf *= 0.82
        else:
            camera_conf *= 0.82

    fused_hr, hr_source, hr_confidence = _fuse_heart_rate_candidates(
        [
            {"name": "python", "hr": camera_hr, "confidence": camera_conf},
            {
                "name": str(ruview.get("source") or "ruview-local") if isinstance(ruview, dict) else "ruview-local",
                "hr": ru_hr,
                "confidence": ru_conf,
            },
            {"name": wearable["source"], "hr": wearable["heart_rate_bpm"], "confidence": wearable["confidence"]},
        ]
    )

    rr_interval_final, hrv_final, rr_source = _fuse_rr_hrv(
        camera_rr=rr_interval_ms,
        camera_hrv=camera_hrv,
        camera_conf=camera_conf,
        wearable_rr=wearable["rr_interval_ms"],
        wearable_hrv=wearable["hrv_rmssd_ms"],
        wearable_conf=wearable["confidence"],
    )

    breath_rate, breath_source, breath_confidence = _fuse_breath_rate(
        [
            {"name": "python", "rate": camera_breath, "confidence": camera_breath_conf * camera_conf},
            {
                "name": str(ruview.get("source") or "ruview-local") if isinstance(ruview, dict) else "ruview-local",
                "rate": ru_breath,
                "confidence": ru_breath_conf,
            },
            {"name": "local", "rate": _to_float(local_metrics.get("breath_rate_per_min")), "confidence": 0.18},
        ]
    )

    readiness_score = _compute_readiness_score(
        hrv_final,
        symmetry_delta,
        microsaccade_hz,
    )

    if fused_hr is None and rr_interval_final is None and hrv_final is None and breath_rate is None:
        if local_metrics:
            return local_metrics
        return None

    source_parts = [part for part in [hr_source, rr_source, breath_source] if part]
    vitals_source = "+".join(_dedupe(source_parts)) if source_parts else "python"

    algorithm = "python-fused" if (ruview or wearable["heart_rate_bpm"] is not None) else f"python-{camera_algorithm}"
    result = {
        "algorithm": algorithm,
        "camera_algorithm": camera_algorithm,
        "heart_rate_bpm": _round(fused_hr, 1),
        "heart_rate_confidence": _round(hr_confidence, 3),
        "rr_interval_ms": _round(rr_interval_final, 1),
        "hrv_rmssd_ms": _round(hrv_final, 1),
        "microsaccade_hz": _round(microsaccade_hz, 3),
        "symmetry_delta_pct": _round(symmetry_delta, 2),
        "flagged_zones": state.flagged_zones or local_metrics.get("flagged_zones") or [],
        "readiness_score": _round(readiness_score, 2),
        "cns_fatigue": (microsaccade_hz < 0.5) if microsaccade_hz is not None else None,
        "breath_rate_per_min": _round(breath_rate, 1),
        "breath_rate_confidence": _round(breath_confidence, 3),
        "vitals_source": vitals_source,
        "camera_signal_quality": _round(camera_signal_quality, 3),
        "pose_quality": _round(pose_quality, 3),
        "camera_confidence": _round(camera_conf, 3),
        "ruview_confidence": _round(ru_conf, 3),
        "wearable_confidence": _round(wearable["confidence"], 3),
    }

    for key in ["flagged_zones", "symmetry_delta_pct", "microsaccade_hz"]:
        if result.get(key) is None and local_metrics.get(key) is not None:
            result[key] = local_metrics.get(key)

    return result


def _estimate_camera_metrics(state: SessionState) -> dict[str, Any]:
    if len(state.ppg_values) < 72:
        return _empty_camera_metrics()

    times_ms = np.array(state.ppg_ts, dtype=np.float64)
    values = np.array(state.ppg_values, dtype=np.float64)
    qualities = np.array(state.ppg_quality, dtype=np.float64) if state.ppg_quality else np.array([])

    uniform_t, values_uniform, sampling_hz = _resample_uniform(times_ms, values)
    if values_uniform.size < 96 or sampling_hz < 6.0:
        signal_quality = float(np.mean(np.clip(qualities, 0.0, 1.0))) if qualities.size else 0.0
        return {
            **_empty_camera_metrics(),
            "signal_quality": _clamp(signal_quality * 0.7, 0.0, 1.0),
        }

    values_uniform = _hampel_filter(values_uniform, window_size=5, n_sigmas=3.0)
    values_uniform = values_uniform - np.mean(values_uniform)

    sample_quality = float(np.mean(np.clip(qualities[-220:], 0.0, 1.0))) if qualities.size else 0.62
    rgb_coverage = _estimate_rgb_coverage(state, len(values))

    candidates: list[tuple[str, np.ndarray]] = []

    green_series = _select_green_series(state, values)
    _, green_uniform, _ = _resample_uniform(times_ms, green_series, target_fs=sampling_hz)
    candidates.append(("green", green_uniform))

    if rgb_coverage >= 0.48:
        rgb_uniform = _resample_rgb_uniform(state, times_ms, sampling_hz, fallback=values)
        if rgb_uniform is not None:
            pos_signal = _extract_pos_signal(rgb_uniform, sampling_hz)
            chrom_signal = _extract_chrom_signal(rgb_uniform)
            if pos_signal.size >= 96:
                candidates.append(("pos", pos_signal))
            if chrom_signal.size >= 96:
                candidates.append(("chrom", chrom_signal))

    evaluations = []
    for name, signal in candidates:
        eval_result = _evaluate_candidate_signal(
            name=name,
            signal=signal,
            times_sec=uniform_t,
            fs=sampling_hz,
            sample_quality=sample_quality,
            rgb_coverage=rgb_coverage,
        )
        if eval_result is not None:
            evaluations.append(eval_result)

    if not evaluations:
        return _empty_camera_metrics()

    evaluations.sort(key=lambda item: item["score"], reverse=True)
    best = evaluations[0]

    if len(evaluations) > 1:
        second = evaluations[1]
        hr_a = best.get("heart_rate_bpm")
        hr_b = second.get("heart_rate_bpm")
        if hr_a is not None and hr_b is not None and abs(hr_a - hr_b) <= 8:
            wa = best["heart_rate_confidence"] + 1e-8
            wb = second["heart_rate_confidence"] + 1e-8
            best["heart_rate_bpm"] = (hr_a * wa + hr_b * wb) / (wa + wb)
            best["heart_rate_confidence"] = _clamp(
                best["heart_rate_confidence"] * 0.78 + second["heart_rate_confidence"] * 0.22,
                0.0,
                1.0,
            )
            best["signal_quality"] = _clamp(best["signal_quality"] * 0.8 + second["signal_quality"] * 0.2, 0.0, 1.0)

    return {
        "algorithm": best["algorithm"],
        "heart_rate_bpm": best["heart_rate_bpm"],
        "heart_rate_confidence": best["heart_rate_confidence"],
        "rr_interval_ms": best["rr_interval_ms"],
        "hrv_rmssd_ms": best["hrv_rmssd_ms"],
        "rr_confidence": best["rr_confidence"],
        "breath_rate_per_min": best["breath_rate_per_min"],
        "breath_confidence": best["breath_confidence"],
        "signal_quality": best["signal_quality"],
    }


def _empty_camera_metrics() -> dict[str, Any]:
    return {
        "algorithm": _dominant_mode([]),
        "heart_rate_bpm": None,
        "heart_rate_confidence": 0.0,
        "rr_interval_ms": None,
        "hrv_rmssd_ms": None,
        "rr_confidence": 0.0,
        "breath_rate_per_min": None,
        "breath_confidence": 0.0,
        "signal_quality": 0.0,
    }


def _select_green_series(state: SessionState, fallback_values: np.ndarray) -> np.ndarray:
    g_values = np.array(state.ppg_g, dtype=np.float64) if state.ppg_g else np.array([])
    if g_values.size != fallback_values.size:
        return fallback_values
    coverage = np.mean(np.isfinite(g_values)) if g_values.size else 0.0
    if coverage < 0.35:
        return fallback_values
    return _fill_nan_series(g_values, fallback_values)


def _resample_rgb_uniform(
    state: SessionState,
    times_ms: np.ndarray,
    target_fs: float,
    fallback: np.ndarray,
) -> np.ndarray | None:
    r = np.array(state.ppg_r, dtype=np.float64) if state.ppg_r else np.array([])
    g = np.array(state.ppg_g, dtype=np.float64) if state.ppg_g else np.array([])
    b = np.array(state.ppg_b, dtype=np.float64) if state.ppg_b else np.array([])

    if r.size != fallback.size or g.size != fallback.size or b.size != fallback.size:
        return None

    r = _fill_nan_series(r, fallback)
    g = _fill_nan_series(g, fallback)
    b = _fill_nan_series(b, fallback)

    _, r_u, _ = _resample_uniform(times_ms, r, target_fs=target_fs)
    _, g_u, _ = _resample_uniform(times_ms, g, target_fs=target_fs)
    _, b_u, _ = _resample_uniform(times_ms, b, target_fs=target_fs)

    if not (r_u.size == g_u.size == b_u.size) or r_u.size < 96:
        return None

    rgb = np.column_stack([r_u, g_u, b_u])
    if not np.all(np.isfinite(rgb)):
        return None
    return rgb


def _estimate_rgb_coverage(state: SessionState, expected_size: int) -> float:
    if not state.ppg_r or not state.ppg_g or not state.ppg_b:
        return 0.0
    r = np.array(state.ppg_r, dtype=np.float64)
    g = np.array(state.ppg_g, dtype=np.float64)
    b = np.array(state.ppg_b, dtype=np.float64)
    if r.size != expected_size or g.size != expected_size or b.size != expected_size:
        return 0.0
    return float(np.mean(np.isfinite(r) & np.isfinite(g) & np.isfinite(b)))


def _evaluate_candidate_signal(
    name: str,
    signal: np.ndarray,
    times_sec: np.ndarray,
    fs: float,
    sample_quality: float,
    rgb_coverage: float,
) -> dict[str, Any] | None:
    if signal.size < 96:
        return None

    if times_sec.size != signal.size:
        n = min(times_sec.size, signal.size)
        if n < 96:
            return None
        signal = signal[:n]
        times_sec = times_sec[:n]

    centered = signal - np.mean(signal)
    filtered = _bandpass(centered, fs, 0.7, 3.2)
    if filtered.size < 96:
        return None

    hr_welch, welch_conf, peak_hz, peak_ratio = _estimate_hr_welch(filtered, fs)
    hr_auto, auto_conf = _estimate_hr_autocorr(filtered, fs)

    hr_bpm = None
    hr_conf = 0.0
    if hr_welch is not None and hr_auto is not None:
        if abs(hr_welch - hr_auto) <= 11:
            w = welch_conf + auto_conf + 1e-8
            hr_bpm = (hr_welch * welch_conf + hr_auto * auto_conf) / w
            hr_conf = _clamp(max(welch_conf, auto_conf) * 0.6 + min(welch_conf, auto_conf) * 0.4, 0.0, 1.0)
        else:
            if welch_conf >= auto_conf:
                hr_bpm = hr_welch
                hr_conf = welch_conf * 0.88
            else:
                hr_bpm = hr_auto
                hr_conf = auto_conf * 0.88
    elif hr_welch is not None:
        hr_bpm = hr_welch
        hr_conf = welch_conf
    elif hr_auto is not None:
        hr_bpm = hr_auto
        hr_conf = auto_conf

    rr_intervals_ms, hrv_rmssd_ms, rr_conf = _estimate_rr_hrv(filtered, times_sec, fs)
    rr_interval_ms = float(np.mean(rr_intervals_ms)) if rr_intervals_ms.size else None

    breath_rate, breath_conf = _estimate_band_rate(centered, fs, 0.1, 0.5)
    signal_quality = _estimate_signal_quality(filtered, fs, peak_hz, peak_ratio, sample_quality)

    algorithm_bonus = 0.0
    if name == "pos":
        algorithm_bonus = 0.06 if rgb_coverage >= 0.65 else 0.02
    elif name == "chrom":
        algorithm_bonus = 0.045 if rgb_coverage >= 0.65 else 0.015
    elif name == "green":
        algorithm_bonus = 0.045 if rgb_coverage < 0.45 else 0.02

    combined_conf = _clamp(
        hr_conf * 0.46
        + rr_conf * 0.25
        + signal_quality * 0.29
        + algorithm_bonus,
        0.0,
        1.0,
    )

    score = combined_conf * (0.72 + 0.28 * signal_quality)
    return {
        "algorithm": name,
        "heart_rate_bpm": hr_bpm,
        "heart_rate_confidence": combined_conf,
        "rr_interval_ms": rr_interval_ms,
        "hrv_rmssd_ms": hrv_rmssd_ms,
        "rr_confidence": rr_conf,
        "breath_rate_per_min": breath_rate,
        "breath_confidence": breath_conf,
        "signal_quality": signal_quality,
        "score": score,
    }


def _extract_pos_signal(rgb_uniform: np.ndarray, fs: float) -> np.ndarray:
    if rgb_uniform.ndim != 2 or rgb_uniform.shape[1] != 3 or rgb_uniform.shape[0] < 64:
        return np.array([])

    eps = 1e-6
    n = rgb_uniform.shape[0]
    win = int(np.clip(fs * 1.6, 24, 240))
    projection = np.array([[0.0, 1.0, -1.0], [-2.0, 1.0, 1.0]], dtype=np.float64)
    out = np.zeros(n, dtype=np.float64)

    rgb = np.clip(rgb_uniform.astype(np.float64), 1.0, 255.0)
    rgb = rgb / np.mean(rgb, axis=0, keepdims=True)

    for end in range(win, n):
        start = end - win + 1
        window_rgb = rgb[start : end + 1, :]
        normalized = (window_rgb / (np.mean(window_rgb, axis=0, keepdims=True) + eps)).T
        s = projection @ normalized
        s1 = s[0]
        s2 = s[1]
        alpha = np.std(s1) / (np.std(s2) + eps)
        h = s1 + alpha * s2
        h = h - np.mean(h)
        out[start : end + 1] += h

    out = out - np.mean(out)
    return out


def _extract_chrom_signal(rgb_uniform: np.ndarray) -> np.ndarray:
    if rgb_uniform.ndim != 2 or rgb_uniform.shape[1] != 3 or rgb_uniform.shape[0] < 64:
        return np.array([])

    eps = 1e-6
    rgb = np.clip(rgb_uniform.astype(np.float64), 1.0, 255.0)
    rgb = rgb / (np.mean(rgb, axis=0, keepdims=True) + eps)

    x_comp = 3.0 * rgb[:, 0] - 2.0 * rgb[:, 1]
    y_comp = 1.5 * rgb[:, 0] + rgb[:, 1] - 1.5 * rgb[:, 2]
    alpha = np.std(x_comp) / (np.std(y_comp) + eps)
    chrom = x_comp - alpha * y_comp
    chrom = chrom - np.mean(chrom)
    return chrom


def _resample_uniform(times_ms: np.ndarray, values: np.ndarray, target_fs: float | None = None) -> tuple[np.ndarray, np.ndarray, float]:
    if times_ms.size < 2 or values.size < 2:
        return np.array([]), np.array([]), 0.0

    clean_t, clean_v = _prepare_time_series(times_ms, values)
    if clean_t.size < 2 or clean_v.size < 2:
        return np.array([]), np.array([]), 0.0

    t_sec = (clean_t - clean_t[0]) / 1000.0
    dt = np.diff(t_sec)
    dt = dt[np.isfinite(dt) & (dt > 1e-4)]
    if not dt.size:
        return np.array([]), np.array([]), 0.0

    if target_fs is None:
        fs_est = float(1.0 / np.median(dt))
        fs_hz = float(np.clip(fs_est, 8.0, 60.0))
    else:
        fs_hz = float(np.clip(target_fs, 8.0, 60.0))

    start = float(t_sec[0])
    end = float(t_sec[-1])
    if end - start < 2.0:
        return np.array([]), np.array([]), 0.0

    uniform_t = np.arange(start, end, 1.0 / fs_hz, dtype=np.float64)
    uniform_values = np.interp(uniform_t, t_sec, clean_v)
    return uniform_t, uniform_values, fs_hz


def _prepare_time_series(times_ms: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask = np.isfinite(times_ms) & np.isfinite(values)
    t = times_ms[mask]
    v = values[mask]
    if t.size < 2:
        return np.array([]), np.array([])

    order = np.argsort(t)
    t = t[order]
    v = v[order]

    unique_t, unique_idx = np.unique(t, return_index=True)
    v = v[unique_idx]
    return unique_t, v


def _fill_nan_series(series: np.ndarray, fallback: np.ndarray | None = None) -> np.ndarray:
    if series.size == 0:
        return series
    values = series.astype(np.float64, copy=True)
    valid = np.isfinite(values)
    if valid.sum() == values.size:
        return values

    if valid.sum() == 0:
        if fallback is not None and fallback.size == values.size:
            return fallback.astype(np.float64, copy=True)
        return np.zeros_like(values)

    idx = np.arange(values.size)
    values[~valid] = np.interp(idx[~valid], idx[valid], values[valid])
    return values


def _hampel_filter(signal: np.ndarray, window_size: int = 5, n_sigmas: float = 3.0) -> np.ndarray:
    if signal.size < 9:
        return signal
    x = signal.copy()
    k = max(int(window_size), 1)
    for i in range(signal.size):
        left = max(i - k, 0)
        right = min(i + k + 1, signal.size)
        window = signal[left:right]
        median = np.median(window)
        mad = np.median(np.abs(window - median))
        sigma = 1.4826 * mad + 1e-8
        if abs(signal[i] - median) > n_sigmas * sigma:
            x[i] = median
    return x


def _bandpass(signal: np.ndarray, fs: float, low: float, high: float) -> np.ndarray:
    if signal.size < 16 or fs <= 0:
        return signal

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


def _estimate_hr_welch(signal: np.ndarray, fs: float) -> tuple[float | None, float, float | None, float]:
    if signal.size < 64:
        return None, 0.0, None, 0.0

    nperseg = min(signal.size, 512)
    freqs, pxx = welch(signal, fs=fs, nperseg=nperseg, noverlap=nperseg // 2)
    mask = (freqs >= 0.7) & (freqs <= 3.2)
    if not np.any(mask):
        return None, 0.0, None, 0.0

    focus_freqs = freqs[mask]
    focus_pxx = pxx[mask]
    best_idx = int(np.argmax(focus_pxx))
    peak = float(focus_pxx[best_idx])
    floor = float(np.median(focus_pxx)) + 1e-8
    peak_ratio = peak / floor
    confidence = _clamp((peak_ratio - 1.25) / 5.4, 0.0, 1.0)

    hr_hz = float(focus_freqs[best_idx])
    if 0 < best_idx < focus_pxx.size - 1:
        alpha = float(focus_pxx[best_idx - 1])
        beta = float(focus_pxx[best_idx])
        gamma = float(focus_pxx[best_idx + 1])
        denom = alpha - 2.0 * beta + gamma
        if abs(denom) > 1e-12:
            p = 0.5 * (alpha - gamma) / denom
            freq_step = float(focus_freqs[1] - focus_freqs[0]) if focus_freqs.size > 1 else 0.0
            hr_hz = hr_hz + p * freq_step

    hr_bpm = hr_hz * 60.0
    if hr_bpm < 35 or hr_bpm > 220:
        return None, 0.0, None, 0.0
    return hr_bpm, confidence, hr_hz, peak_ratio


def _estimate_hr_autocorr(signal: np.ndarray, fs: float) -> tuple[float | None, float]:
    if signal.size < 64 or fs <= 0:
        return None, 0.0

    centered = signal - np.mean(signal)
    denom = np.std(centered) + 1e-8
    centered = centered / denom

    acf = np.correlate(centered, centered, mode="full")
    acf = acf[acf.size // 2 :]
    if acf.size < 3:
        return None, 0.0
    acf = acf / (acf[0] + 1e-8)

    min_lag = max(int(fs * 60.0 / 220.0), 1)
    max_lag = min(int(fs * 60.0 / 40.0), acf.size - 1)
    if min_lag >= max_lag:
        return None, 0.0

    segment = acf[min_lag : max_lag + 1]
    idx = int(np.argmax(segment))
    lag = min_lag + idx
    peak = float(segment[idx])
    hr_bpm = 60.0 * fs / lag
    if hr_bpm < 35 or hr_bpm > 220:
        return None, 0.0
    confidence = _clamp((peak - 0.1) / 0.62, 0.0, 1.0)
    return hr_bpm, confidence


def _estimate_rr_hrv(signal: np.ndarray, times_sec: np.ndarray, fs: float) -> tuple[np.ndarray, float | None, float]:
    if signal.size < 64 or times_sec.size != signal.size:
        return np.array([]), None, 0.0

    prominence = max(float(np.std(signal)) * 0.26, 0.01)
    min_distance = max(int(fs * 0.28), 1)
    peaks, props = find_peaks(signal, distance=min_distance, prominence=prominence)
    if peaks.size < 3:
        return np.array([]), None, 0.0

    peak_times = times_sec[peaks]
    rr_sec = np.diff(peak_times)
    rr_sec = rr_sec[(rr_sec >= 0.28) & (rr_sec <= 1.9)]
    if rr_sec.size < 2:
        rr_ms = rr_sec * 1000.0
        return rr_ms, None, 0.0

    rr_sec = _mad_filter(rr_sec, sigma=3.2, absolute_guard=0.08)
    rr_ms = rr_sec * 1000.0
    if rr_ms.size < 2:
        return rr_ms, None, 0.0

    diffs = np.diff(rr_ms)
    rmssd = float(np.sqrt(np.mean(np.square(diffs)))) if diffs.size else None

    median_rr = float(np.median(rr_ms))
    mad = float(np.median(np.abs(rr_ms - median_rr))) + 1e-8
    cv = float(np.std(rr_ms) / max(np.mean(rr_ms), 1e-6))
    stability = _clamp(1.0 - cv / 0.18, 0.0, 1.0)
    robust_stability = _clamp(1.0 - mad / max(median_rr * 0.16, 1e-6), 0.0, 1.0)
    count_score = _clamp(rr_ms.size / 28.0, 0.0, 1.0)
    prom = props.get("prominences")
    prom_score = _clamp(float(np.median(prom)) / (np.std(signal) + 1e-6), 0.0, 1.0) if prom is not None and prom.size else 0.35

    confidence = _clamp(stability * 0.33 + robust_stability * 0.28 + count_score * 0.24 + prom_score * 0.15, 0.0, 1.0)
    return rr_ms, rmssd, confidence


def _estimate_band_rate(signal: np.ndarray, fs: float, min_hz: float, max_hz: float) -> tuple[float | None, float]:
    if signal.size < 72 or fs <= 0:
        return None, 0.0

    filtered = _bandpass(signal, fs, min_hz, max_hz)
    nperseg = min(filtered.size, 512)
    freqs, pxx = welch(filtered, fs=fs, nperseg=nperseg, noverlap=nperseg // 2)
    mask = (freqs >= min_hz) & (freqs <= max_hz)
    if not np.any(mask):
        return None, 0.0

    focus_freqs = freqs[mask]
    focus_pxx = pxx[mask]
    best_idx = int(np.argmax(focus_pxx))
    peak = float(focus_pxx[best_idx])
    floor = float(np.median(focus_pxx)) + 1e-8
    ratio = peak / floor
    conf = _clamp((ratio - 1.2) / 3.2, 0.0, 1.0)

    bpm = float(focus_freqs[best_idx] * 60.0)
    if bpm < min_hz * 60.0 or bpm > max_hz * 60.0:
        return None, 0.0
    return bpm, conf


def _estimate_signal_quality(
    filtered_signal: np.ndarray,
    fs: float,
    peak_hz: float | None,
    peak_ratio: float,
    sample_quality: float,
) -> float:
    if filtered_signal.size < 64:
        return 0.0

    centered = filtered_signal - np.mean(filtered_signal)
    std = float(np.std(centered))
    abs_mean = float(np.mean(np.abs(centered))) + 1e-8
    amplitude_score = _clamp((std / abs_mean - 0.6) / 1.9, 0.0, 1.0)

    spectral_score = _clamp((peak_ratio - 1.15) / 5.0, 0.0, 1.0)

    _, ac_conf = _estimate_hr_autocorr(filtered_signal, fs)
    periodicity_score = _clamp(ac_conf, 0.0, 1.0)

    if peak_hz is not None:
        total_power = float(np.sum(centered * centered)) + 1e-8
        diff = np.diff(centered, prepend=centered[0])
        hf_noise = float(np.sum(diff * diff)) / max(total_power, 1e-8)
        smoothness_score = _clamp(1.0 - hf_noise / 8.0, 0.0, 1.0)
    else:
        smoothness_score = 0.2

    return _clamp(
        amplitude_score * 0.25
        + spectral_score * 0.31
        + periodicity_score * 0.23
        + smoothness_score * 0.11
        + _clamp(sample_quality, 0.0, 1.0) * 0.10,
        0.0,
        1.0,
    )


def _mad_filter(values: np.ndarray, sigma: float = 3.0, absolute_guard: float = 0.08) -> np.ndarray:
    if values.size < 4:
        return values
    med = float(np.median(values))
    mad = float(np.median(np.abs(values - med))) + 1e-8
    threshold = sigma * 1.4826 * mad + absolute_guard
    filtered = values[np.abs(values - med) <= threshold]
    return filtered if filtered.size >= 2 else values


def _estimate_microsaccade_hz(state: SessionState) -> float | None:
    if len(state.eye_ts) < 10:
        return None

    ts = np.array(state.eye_ts, dtype=np.float64)
    x = np.array(state.eye_x, dtype=np.float64)
    y = np.array(state.eye_y, dtype=np.float64)

    dt = np.diff(ts) / 1000.0
    valid = np.isfinite(dt) & (dt >= 1e-3) & (dt <= 0.25)
    if not np.any(valid):
        return None

    dx = np.diff(x)[valid]
    dy = np.diff(y)[valid]
    dt = dt[valid]

    speed = np.sqrt(dx * dx + dy * dy) / dt
    if speed.size < 6:
        return None

    median_speed = float(np.median(speed))
    mad_speed = float(np.median(np.abs(speed - median_speed))) + 1e-8
    threshold = max(0.12, median_speed + 4.2 * 1.4826 * mad_speed)

    bursts = np.sum((speed[1:] > threshold) & (speed[:-1] <= threshold))
    span_sec = max((ts[-1] - ts[0]) / 1000.0, 1.0)
    return float(bursts / span_sec)


def _combine_camera_confidence(
    spectral_conf: float,
    rr_conf: float,
    signal_quality: float,
    pose_quality: float,
    motion_artifact: float,
) -> float:
    conf = (
        _clamp(spectral_conf, 0.0, 1.0) * 0.36
        + _clamp(rr_conf, 0.0, 1.0) * 0.27
        + _clamp(signal_quality, 0.0, 1.0) * 0.25
        + _clamp(pose_quality, 0.0, 1.0) * 0.12
    )
    penalty = _clamp(motion_artifact, 0.0, 1.0) * 0.28
    return _clamp(conf - penalty, 0.0, 1.0)


def _estimate_wearable_metrics(state: SessionState) -> dict[str, Any]:
    hr = np.array(state.wearable_hr_values, dtype=np.float64) if state.wearable_hr_values else np.array([])
    hr_conf = np.array(state.wearable_hr_conf, dtype=np.float64) if state.wearable_hr_conf else np.array([])
    rr = np.array(state.wearable_rr_values, dtype=np.float64) if state.wearable_rr_values else np.array([])
    rr_conf = np.array(state.wearable_rr_conf, dtype=np.float64) if state.wearable_rr_conf else np.array([])

    hr_value = None
    hrv_value = None
    rr_value = None
    hr_confidence = 0.0
    rr_confidence = 0.0

    if hr.size:
        weights = hr_conf if hr_conf.size == hr.size else np.ones_like(hr) * 0.65
        weights = np.clip(weights, 0.1, 1.0)
        filtered_hr = _mad_filter(hr, sigma=3.0, absolute_guard=6.0)
        if filtered_hr.size:
            hr_value = float(np.average(filtered_hr, weights=np.ones_like(filtered_hr)))
        else:
            hr_value = float(np.average(hr, weights=weights))
        spread = float(np.std(hr))
        stability = _clamp(1.0 - (spread / 20.0), 0.0, 1.0)
        hr_confidence = _clamp(float(np.mean(weights)) * 0.58 + stability * 0.42, 0.0, 1.0)

    if rr.size >= 2:
        rr = _mad_filter(rr, sigma=3.2, absolute_guard=80.0)
        rr_value = float(np.mean(rr))
        diffs = np.diff(rr)
        hrv_value = float(np.sqrt(np.mean(np.square(diffs)))) if diffs.size else None
        weights = rr_conf if rr_conf.size == rr.size else np.ones_like(rr) * 0.65
        median_rr = float(np.median(rr))
        mad = float(np.median(np.abs(rr - median_rr))) + 1e-6
        stability = _clamp(1.0 - (mad / max(median_rr * 0.16, 1e-6)), 0.0, 1.0)
        rr_confidence = _clamp(float(np.mean(np.clip(weights, 0.1, 1.0))) * 0.52 + stability * 0.48, 0.0, 1.0)

    confidence = max(hr_confidence, rr_confidence * 0.9)

    if hr_value is None and rr_value is not None:
        hr_value = 60000.0 / rr_value

    return {
        "heart_rate_bpm": hr_value if hr_value is not None and 35 <= hr_value <= 220 else None,
        "rr_interval_ms": rr_value,
        "hrv_rmssd_ms": hrv_value,
        "confidence": confidence,
        "source": state.wearable_source or "wearable",
    }


def _fuse_heart_rate_candidates(candidates: list[dict[str, Any]]) -> tuple[float | None, str, float]:
    valid = []
    for item in candidates:
        hr = _to_float(item.get("hr"))
        conf = _to_float(item.get("confidence"))
        name = str(item.get("name") or "unknown")
        if hr is None or conf is None:
            continue
        if hr < 35 or hr > 220 or conf <= 0:
            continue
        valid.append({"name": name, "hr": hr, "confidence": _clamp(conf, 0.0, 1.0)})

    if not valid:
        return None, "python", 0.0

    if len(valid) == 1:
        only = valid[0]
        return only["hr"], only["name"], only["confidence"]

    total_weight = sum(item["confidence"] for item in valid) + 1e-8
    best_cluster = [valid[0]]
    best_support = -1.0

    for center in valid:
        cluster = [item for item in valid if abs(item["hr"] - center["hr"]) <= 10.0]
        support = sum(item["confidence"] for item in cluster)
        if support > best_support:
            best_support = support
            best_cluster = cluster

    cluster_weight = sum(item["confidence"] for item in best_cluster) + 1e-8
    fused_hr = sum(item["hr"] * item["confidence"] for item in best_cluster) / cluster_weight
    fused_conf = _clamp(
        (best_support / total_weight) * 0.62 + max(item["confidence"] for item in best_cluster) * 0.38,
        0.0,
        1.0,
    )
    source = "+".join(_dedupe([item["name"] for item in best_cluster]))
    return fused_hr, source, fused_conf


def _fuse_rr_hrv(
    camera_rr: float | None,
    camera_hrv: float | None,
    camera_conf: float,
    wearable_rr: float | None,
    wearable_hrv: float | None,
    wearable_conf: float,
) -> tuple[float | None, float | None, str]:
    rr = None
    hrv = None
    source = ""

    camera_conf = _clamp(camera_conf, 0.0, 1.0)
    wearable_conf = _clamp(wearable_conf, 0.0, 1.0)

    if wearable_rr is not None and camera_rr is not None:
        if wearable_conf >= camera_conf + 0.08:
            rr = wearable_rr
            source = "wearable"
        elif abs(wearable_rr - camera_rr) <= 90:
            w = wearable_conf + camera_conf + 1e-8
            rr = ((wearable_rr * wearable_conf) + (camera_rr * camera_conf)) / w
            source = "python+wearable"
        else:
            rr = camera_rr if camera_conf >= wearable_conf else wearable_rr
            source = "python" if camera_conf >= wearable_conf else "wearable"
    else:
        if camera_rr is not None:
            rr = camera_rr
            source = "python"
        elif wearable_rr is not None:
            rr = wearable_rr
            source = "wearable"

    if wearable_hrv is not None and camera_hrv is not None:
        if wearable_conf >= camera_conf + 0.08:
            hrv = wearable_hrv
        elif abs(wearable_hrv - camera_hrv) <= 18:
            w = wearable_conf + camera_conf + 1e-8
            hrv = ((wearable_hrv * wearable_conf) + (camera_hrv * camera_conf)) / w
        else:
            hrv = camera_hrv if camera_conf >= wearable_conf else wearable_hrv
    else:
        hrv = camera_hrv if camera_hrv is not None else wearable_hrv

    return rr, hrv, source


def _fuse_breath_rate(candidates: list[dict[str, Any]]) -> tuple[float | None, str, float]:
    valid: list[dict[str, float | str]] = []
    for item in candidates:
        rate = _to_float(item.get("rate"))
        conf = _to_float(item.get("confidence"))
        if rate is None or conf is None:
            continue
        if rate < 4 or rate > 40 or conf <= 0:
            continue
        valid.append({
            "name": str(item.get("name") or "unknown"),
            "rate": rate,
            "confidence": _clamp(conf, 0.0, 1.0),
        })

    if not valid:
        return None, "", 0.0

    if len(valid) == 1:
        one = valid[0]
        return float(one["rate"]), str(one["name"]), float(one["confidence"])

    total_weight = sum(float(item["confidence"]) for item in valid) + 1e-8
    best_cluster = [valid[0]]
    best_support = -1.0
    for center in valid:
        cluster = [item for item in valid if abs(float(item["rate"]) - float(center["rate"])) <= 3.0]
        support = sum(float(item["confidence"]) for item in cluster)
        if support > best_support:
            best_support = support
            best_cluster = cluster

    cluster_weight = sum(float(item["confidence"]) for item in best_cluster) + 1e-8
    rate = sum(float(item["rate"]) * float(item["confidence"]) for item in best_cluster) / cluster_weight
    confidence = _clamp((best_support / total_weight) * 0.7 + max(float(item["confidence"]) for item in best_cluster) * 0.3, 0.0, 1.0)
    source = "+".join(_dedupe([str(item["name"]) for item in best_cluster]))
    return rate, source, confidence


def _compute_readiness_score(
    hrv_rmssd_ms: float | None,
    symmetry_delta_pct: float | None,
    microsaccade_hz: float | None,
) -> float | None:
    if hrv_rmssd_ms is None or symmetry_delta_pct is None or microsaccade_hz is None:
        return None

    hrv_norm = np.clip((hrv_rmssd_ms - 15) / (80 - 15), 0, 1)
    symmetry_norm = 1 - np.clip(symmetry_delta_pct / 30, 0, 1)

    if microsaccade_hz <= 0.5:
        micro_norm = 0.1
    elif microsaccade_hz >= 1.8:
        micro_norm = 1.0
    else:
        micro_norm = np.clip((microsaccade_hz - 0.5) / (1.8 - 0.5), 0, 1)

    score = (hrv_norm * 0.45 + symmetry_norm * 0.35 + micro_norm * 0.2) * 10
    return float(np.clip(score, 0, 10))


def _extract_rgb(rgb: Any) -> tuple[float, float, float] | None:
    if not isinstance(rgb, (list, tuple)) or len(rgb) < 3:
        return None
    r = _to_float(rgb[0])
    g = _to_float(rgb[1])
    b = _to_float(rgb[2])
    if r is None or g is None or b is None:
        return None
    if not (0 <= r <= 255 and 0 <= g <= 255 and 0 <= b <= 255):
        return None
    return float(r), float(g), float(b)


def _dominant_mode(modes: list[str]) -> str:
    if not modes:
        return "green"
    green = sum(1 for mode in modes if mode == "green")
    pos = len(modes) - green
    return "pos" if pos > green else "green"


def _dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _round(value: float | None, digits: int) -> float | None:
    if value is None:
        return None
    return round(float(value), digits)
