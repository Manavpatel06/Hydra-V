from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.signal import firwin, lfilter

from app.signal_processing import SessionState


# RuView-inspired physiological bands:
# breathing: 0.1-0.5 Hz (6-30 /min)
# heart: 0.667-2.0 Hz (40-120 bpm)
BREATH_MIN_HZ = 0.1
BREATH_MAX_HZ = 0.5
HEART_MIN_HZ = 0.667
HEART_MAX_HZ = 2.0
CONFIDENCE_THRESHOLD = 2.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _next_pow2(value: int) -> int:
    if value <= 1:
        return 1
    return 1 << (value - 1).bit_length()


def _to_float_array(values: Any) -> np.ndarray:
    return np.array(values, dtype=np.float64)


def _estimate_sample_rate_hz(timestamps_ms: np.ndarray) -> float:
    if timestamps_ms.size < 2:
        return 0.0
    duration_sec = (timestamps_ms[-1] - timestamps_ms[0]) / 1000.0
    if duration_sec <= 0:
        return 0.0
    return float(timestamps_ms.size / duration_sec)


def _fir_bandpass(data: np.ndarray, low_hz: float, high_hz: float, fs_hz: float) -> np.ndarray:
    if data.size < 6 or fs_hz <= 0:
        return data

    nyquist = fs_hz / 2.0
    if nyquist <= 0:
        return data

    low = _clamp(low_hz / nyquist, 1e-5, 0.49)
    high = _clamp(high_hz / nyquist, low + 1e-5, 0.999)
    if not (0 < low < high < 1):
        return data

    low_norm_for_order = max(low_hz / max(fs_hz, 1e-6), 1e-4)
    order = int(np.ceil(3.0 / low_norm_for_order))
    order = int(_clamp(order, 5, 127))
    if order % 2 == 0:
        order += 1

    coeffs = firwin(numtaps=order, cutoff=[low, high], pass_zero=False, window="hamming")
    filtered = lfilter(coeffs, [1.0], data)
    return filtered


def _compute_band_peak_bpm(
    signal: np.ndarray,
    sample_rate_hz: float,
    min_hz: float,
    max_hz: float,
) -> tuple[float | None, float]:
    if signal.size < 4 or sample_rate_hz <= 0:
        return None, 0.0

    fft_len = _next_pow2(int(signal.size))
    padded = np.zeros(fft_len, dtype=np.float64)
    padded[: signal.size] = signal

    window = np.hanning(signal.size)
    padded[: signal.size] *= window

    spectrum = np.abs(np.fft.rfft(padded))
    if spectrum.size < 3:
        return None, 0.0

    freq_res = sample_rate_hz / float(fft_len)
    if freq_res <= 0:
        return None, 0.0

    min_bin = int(np.ceil(min_hz / freq_res))
    max_bin = int(np.floor(max_hz / freq_res))
    max_bin = min(max_bin, spectrum.size - 1)
    if min_bin >= max_bin or min_bin < 0:
        return None, 0.0

    band = spectrum[min_bin : max_bin + 1]
    if band.size == 0:
        return None, 0.0

    peak_rel = int(np.argmax(band))
    peak_bin = min_bin + peak_rel
    peak_mag = float(spectrum[peak_bin])
    band_mean = float(np.mean(band)) if band.size else 0.0
    if band_mean <= 1e-12:
        return None, 0.0

    peak_ratio = peak_mag / band_mean
    if peak_ratio >= CONFIDENCE_THRESHOLD:
        confidence = (peak_ratio - 1.0) / (CONFIDENCE_THRESHOLD * 2.0 - 1.0)
        confidence = _clamp(confidence, 0.0, 1.0)
    else:
        confidence = ((peak_ratio - 1.0) / (CONFIDENCE_THRESHOLD - 1.0)) * 0.5
        confidence = _clamp(confidence, 0.0, 0.5)

    peak_freq_hz = peak_bin * freq_res
    if min_bin < peak_bin < max_bin:
        alpha = float(spectrum[peak_bin - 1])
        beta = float(spectrum[peak_bin])
        gamma = float(spectrum[peak_bin + 1])
        denom = alpha - 2.0 * beta + gamma
        if abs(denom) > 1e-12:
            p = 0.5 * (alpha - gamma) / denom
            peak_freq_hz = (peak_bin + p) * freq_res

    bpm = peak_freq_hz * 60.0
    return (bpm if confidence > 0.05 else None), confidence


def _compute_signal_quality(raw_values: np.ndarray, fill_factor: float) -> float:
    if raw_values.size < 4:
        return 0.0

    centered = raw_values - np.mean(raw_values)
    abs_mean = float(np.mean(np.abs(centered))) + 1e-6
    std = float(np.std(centered))
    cv = std / abs_mean

    if cv < 0.01:
        quality = (cv / 0.01) * 0.3
    elif cv < 0.3:
        quality = 0.3 + 0.7 * max(0.0, 1.0 - abs((cv - 0.15) / 0.15))
    else:
        quality = _clamp(1.0 - (cv - 0.3) / 0.7, 0.1, 0.5)

    return _clamp(quality * (0.3 + 0.7 * fill_factor), 0.0, 1.0)


@dataclass
class RuViewClient:
    """
    Local RuView-style vital-sign estimator.

    This ports the core ideas from RuView's published vital-sign logic:
    - physiology-constrained bandpass filtering
    - FFT dominant-peak detection
    - peak-to-band-mean confidence scoring
    """

    enabled: bool = True
    mode: str = "local"
    timeout_ms: int = 0

    _last_fetch_ms: float = 0.0
    _cache: dict[str, Any] | None = None

    def __init__(self) -> None:
        enabled_env = os.getenv("RUVIEW_LOCAL_FUSION_ENABLED", "true").strip().lower()
        self.enabled = enabled_env not in {"0", "false", "no"}
        self.mode = "local" if self.enabled else "disabled"
        self.timeout_ms = 0
        self._last_fetch_ms = 0.0
        self._cache = None

    async def fetch_vitals(self, now_ms: float, state: SessionState | None = None) -> dict[str, Any] | None:
        if not self.enabled or state is None:
            return None

        if self._cache and now_ms - self._last_fetch_ms < 350:
            return self._cache

        if len(state.ppg_values) < 48:
            return self._cache

        values = _to_float_array(state.ppg_values)
        timestamps_ms = _to_float_array(state.ppg_ts)
        if values.size != timestamps_ms.size:
            return self._cache

        fs_hz = _estimate_sample_rate_hz(timestamps_ms)
        if fs_hz < 4.0:
            return self._cache

        breath_signal = _fir_bandpass(values, BREATH_MIN_HZ, BREATH_MAX_HZ, fs_hz)
        heart_signal = _fir_bandpass(values, HEART_MIN_HZ, HEART_MAX_HZ, fs_hz)

        breath_bpm, breath_conf = _compute_band_peak_bpm(breath_signal, fs_hz, BREATH_MIN_HZ, BREATH_MAX_HZ)
        heart_bpm, heart_conf = _compute_band_peak_bpm(heart_signal, fs_hz, HEART_MIN_HZ, HEART_MAX_HZ)

        # Weight confidence toward heart extraction for fusion.
        combined_conf = _clamp(heart_conf * 0.72 + breath_conf * 0.28, 0.0, 1.0)

        duration_sec = max((timestamps_ms[-1] - timestamps_ms[0]) / 1000.0, 0.0)
        fill_factor = _clamp(duration_sec / 30.0, 0.0, 1.0)
        signal_quality = _compute_signal_quality(values, fill_factor)

        result = {
            "heart_rate_bpm": float(heart_bpm) if heart_bpm is not None else None,
            "breath_rate_per_min": float(breath_bpm) if breath_bpm is not None else None,
            "confidence": combined_conf,
            "breath_confidence": breath_conf,
            "signal_quality": signal_quality,
            "source": "ruview-local",
            "sample_rate_hz": fs_hz,
        }

        self._cache = result
        self._last_fetch_ms = now_ms
        return result
