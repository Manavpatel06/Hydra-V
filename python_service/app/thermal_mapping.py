from __future__ import annotations

import base64
from statistics import median
from typing import Any

import cv2
import numpy as np


ZONE_DEFS = [
    {"zone_id": "left_shoulder", "zone": "shoulder", "side": "left", "landmark_index": 11},
    {"zone_id": "right_shoulder", "zone": "shoulder", "side": "right", "landmark_index": 12},
    {"zone_id": "left_hip", "zone": "hip", "side": "left", "landmark_index": 23},
    {"zone_id": "right_hip", "zone": "hip", "side": "right", "landmark_index": 24},
    {"zone_id": "left_knee", "zone": "knee", "side": "left", "landmark_index": 25},
    {"zone_id": "right_knee", "zone": "knee", "side": "right", "landmark_index": 26},
]

CHAIN_LINKS = {
    "left_shoulder": {"chain": "spiral_line", "linked_zone_id": "right_hip"},
    "right_shoulder": {"chain": "spiral_line", "linked_zone_id": "left_hip"},
    "left_hip": {"chain": "spiral_line", "linked_zone_id": "right_shoulder"},
    "right_hip": {"chain": "spiral_line", "linked_zone_id": "left_shoulder"},
    "left_knee": {"chain": "lateral_line", "linked_zone_id": "left_hip"},
    "right_knee": {"chain": "lateral_line", "linked_zone_id": "right_hip"},
}

DEFAULT_ZONE_ANCHORS = {
    "left_shoulder": (0.36, 0.28),
    "right_shoulder": (0.64, 0.28),
    "left_hip": (0.42, 0.53),
    "right_hip": (0.58, 0.53),
    "left_knee": (0.44, 0.74),
    "right_knee": (0.56, 0.74),
}

ZONE_RADIUS_MULTIPLIER = {
    "shoulder": 0.24,
    "hip": 0.28,
    "knee": 0.22,
}


def analyze_fascial_thermal(
    frames: list[dict[str, Any]],
    pose_frames: list[dict[str, Any]] | None = None,
    aura_context: dict[str, Any] | None = None,
    scan_duration_sec: float = 8.0,
) -> dict[str, Any]:
    decoded_frames: list[np.ndarray] = []
    for frame in frames:
        image_b64 = _extract_frame_b64(frame)
        if not image_b64:
            continue

        decoded = _decode_image(image_b64)
        if decoded is None:
            continue
        decoded_frames.append(_resize_if_needed(decoded, max_width=360))

    if len(decoded_frames) < 4:
        raise ValueError("At least 4 valid thermal frames are required.")

    grayscale_frames = [cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) for frame in decoded_frames]
    aligned_poses = _align_pose_frames(pose_frames or [], len(grayscale_frames))

    zone_series: dict[str, list[float]] = {zone["zone_id"]: [] for zone in ZONE_DEFS}
    zone_anchor_samples: dict[str, list[tuple[float, float]]] = {zone["zone_id"]: [] for zone in ZONE_DEFS}
    pose_frames_used = 0

    for idx in range(1, len(grayscale_frames)):
        prev_gray = grayscale_frames[idx - 1]
        next_gray = grayscale_frames[idx]
        h, w = next_gray.shape[:2]

        flow = cv2.calcOpticalFlowFarneback(prev_gray, next_gray, None, 0.5, 3, 15, 3, 5, 1.1, 0)
        magnitude = cv2.magnitude(flow[..., 0], flow[..., 1])

        global_var = float(np.var(magnitude)) + 1e-8
        global_mean = float(np.mean(magnitude)) + 1e-8

        landmarks = aligned_poses[idx]
        if not landmarks:
            continue

        pose_frames_used += 1
        body_scale = _estimate_body_scale(landmarks, w, h)

        for zone_def in ZONE_DEFS:
            zone_id = zone_def["zone_id"]
            point_px = _landmark_xy(landmarks, zone_def["landmark_index"], w, h)
            if point_px is None:
                continue

            radius = int(
                np.clip(
                    body_scale * ZONE_RADIUS_MULTIPLIER.get(zone_def["zone"], 0.24),
                    10,
                    min(h, w) * 0.18,
                )
            )
            roi = _extract_circle_roi(magnitude, point_px[0], point_px[1], radius)
            if roi.size < 48:
                continue

            relative_var = float(np.var(roi) / global_var)
            relative_mean = float(np.mean(roi) / global_mean)
            frame_value = relative_var * 0.72 + relative_mean * 0.28

            zone_series[zone_id].append(frame_value)
            zone_anchor_samples[zone_id].append((point_px[0] / w, point_px[1] / h))

    zone_records = _build_zone_records(zone_series, zone_anchor_samples)
    if not zone_records:
        raise ValueError("Unable to compute thermal zone metrics from provided scan.")

    _apply_cold_scores(zone_records)
    _blend_with_aura_context(zone_records, aura_context or {})
    _attach_chain_links(zone_records)

    ranked = sorted(zone_records, key=lambda item: item["cold_score"], reverse=True)
    _assign_ranks(ranked)

    primary = ranked[0]
    secondary = _pick_secondary_zone(primary, ranked)
    recommended_pads = _build_recommended_pads(primary, secondary, ranked)
    flagged_zones = _to_flagged_zones(ranked)

    overlay_zones = [
        {
            "zone_id": zone["zone_id"],
            "zone": zone["zone"],
            "side": zone["side"],
            "anchor": zone["anchor"],
            "cold_score": _round(zone["cold_score"], 3),
            "intensity": _round(zone["cold_score"], 3),
            "radius_norm": 0.11 if zone["zone"] == "hip" else 0.095,
        }
        for zone in ranked
    ]

    return {
        "algorithm": "python-farneback-thermal",
        "scan_duration_sec": float(scan_duration_sec),
        "zone_scores": [_serialize_zone(zone) for zone in ranked],
        "flagged_zones": flagged_zones,
        "recommended_pads": recommended_pads,
        "chain_targets": _extract_chain_targets(ranked),
        "overlay": {
            "zones": overlay_zones,
            "recommended_pads": [
                {"pad": "sun", **recommended_pads["sun"]},
                {"pad": "moon", **recommended_pads["moon"]},
            ],
        },
        "quality": {
            "frames_used": len(decoded_frames),
            "flow_pairs": max(len(decoded_frames) - 1, 0),
            "pose_frames_used": pose_frames_used,
            "pose_coverage": _round(pose_frames_used / max(len(decoded_frames) - 1, 1), 3),
        },
    }


def _extract_frame_b64(frame: dict[str, Any]) -> str:
    if not isinstance(frame, dict):
        return ""

    candidate = frame.get("image_base64") or frame.get("image_b64") or frame.get("frame")
    if not isinstance(candidate, str):
        return ""
    return candidate.strip()


def _decode_image(image_b64: str) -> np.ndarray | None:
    try:
        payload = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
        data = base64.b64decode(payload)
        array = np.frombuffer(data, dtype=np.uint8)
        decoded = cv2.imdecode(array, cv2.IMREAD_COLOR)
        if decoded is None or decoded.size == 0:
            return None
        return decoded
    except Exception:
        return None


def _resize_if_needed(image: np.ndarray, max_width: int = 360) -> np.ndarray:
    h, w = image.shape[:2]
    if w <= max_width:
        return image
    ratio = max_width / max(w, 1)
    resized_h = max(int(h * ratio), 1)
    return cv2.resize(image, (max_width, resized_h), interpolation=cv2.INTER_AREA)


def _align_pose_frames(pose_frames: list[dict[str, Any]], frame_count: int) -> list[list[dict[str, Any]] | None]:
    aligned: list[list[dict[str, Any]] | None] = [None] * frame_count
    if not pose_frames:
        return aligned

    clean = [frame for frame in pose_frames if isinstance(frame, dict) and isinstance(frame.get("landmarks"), list)]
    if not clean:
        return aligned

    for idx in range(frame_count):
        source = clean[min(idx, len(clean) - 1)]
        aligned[idx] = source.get("landmarks")

    return aligned


def _landmark_xy(landmarks: list[dict[str, Any]], index: int, width: int, height: int) -> tuple[int, int] | None:
    if index >= len(landmarks):
        return None

    landmark = landmarks[index]
    if not isinstance(landmark, dict):
        return None

    x_norm = _to_float(landmark.get("x"))
    y_norm = _to_float(landmark.get("y"))
    if x_norm is None or y_norm is None:
        return None

    visibility = _to_float(landmark.get("visibility"))
    if visibility is not None and visibility < 0.2:
        return None

    x_px = int(np.clip(x_norm * width, 0, max(width - 1, 1)))
    y_px = int(np.clip(y_norm * height, 0, max(height - 1, 1)))
    return x_px, y_px


def _estimate_body_scale(landmarks: list[dict[str, Any]], width: int, height: int) -> float:
    left_shoulder = _landmark_xy(landmarks, 11, width, height)
    right_shoulder = _landmark_xy(landmarks, 12, width, height)
    left_hip = _landmark_xy(landmarks, 23, width, height)
    right_hip = _landmark_xy(landmarks, 24, width, height)

    shoulder_span = _distance(left_shoulder, right_shoulder)
    hip_span = _distance(left_hip, right_hip)

    torso = None
    if left_shoulder and right_shoulder and left_hip and right_hip:
        shoulder_mid = ((left_shoulder[0] + right_shoulder[0]) / 2, (left_shoulder[1] + right_shoulder[1]) / 2)
        hip_mid = ((left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2)
        torso = _distance(shoulder_mid, hip_mid)

    fallback = min(width, height) * 0.36
    weighted = np.mean([value for value in [shoulder_span, hip_span, torso, fallback] if value is not None])
    return float(np.clip(weighted, min(width, height) * 0.18, min(width, height) * 0.58))


def _distance(a: tuple[float, float] | None, b: tuple[float, float] | None) -> float | None:
    if a is None or b is None:
        return None
    return float(np.hypot(a[0] - b[0], a[1] - b[1]))


def _extract_circle_roi(matrix: np.ndarray, cx: int, cy: int, radius: int) -> np.ndarray:
    h, w = matrix.shape[:2]
    x0 = max(cx - radius, 0)
    x1 = min(cx + radius, w - 1)
    y0 = max(cy - radius, 0)
    y1 = min(cy + radius, h - 1)

    roi = matrix[y0 : y1 + 1, x0 : x1 + 1]
    if roi.size == 0:
        return np.array([])

    yy, xx = np.ogrid[: roi.shape[0], : roi.shape[1]]
    mask = (xx - (cx - x0)) ** 2 + (yy - (cy - y0)) ** 2 <= radius * radius
    return roi[mask]


def _build_zone_records(
    zone_series: dict[str, list[float]], zone_anchor_samples: dict[str, list[tuple[float, float]]]
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for zone_def in ZONE_DEFS:
        zone_id = zone_def["zone_id"]
        samples = zone_series.get(zone_id, [])
        if len(samples) < 2:
            continue

        sample_array = np.array(samples, dtype=np.float64)
        perfusion_index = float(np.mean(sample_array))
        temporal_variance = float(np.var(sample_array))
        combined_index = perfusion_index * 0.7 + temporal_variance * 0.3

        anchors = zone_anchor_samples.get(zone_id) or [DEFAULT_ZONE_ANCHORS[zone_id]]
        anchor = (
            float(np.mean([point[0] for point in anchors])),
            float(np.mean([point[1] for point in anchors])),
        )

        records.append(
            {
                "zone_id": zone_id,
                "zone": zone_def["zone"],
                "side": zone_def["side"],
                "sample_count": int(len(samples)),
                "perfusion_index": perfusion_index,
                "temporal_variance": temporal_variance,
                "combined_index": combined_index,
                "anchor": anchor,
                "cold_score": 0.5,
                "rank": None,
            }
        )

    return records


def _apply_cold_scores(records: list[dict[str, Any]]) -> None:
    values = np.array([record["combined_index"] for record in records], dtype=np.float64)
    low = float(np.min(values))
    high = float(np.max(values))
    scale = max(high - low, 1e-8)

    for record in records:
        perfusion_norm = (record["combined_index"] - low) / scale
        record["perfusion_norm"] = float(np.clip(perfusion_norm, 0.0, 1.0))
        record["cold_score"] = float(np.clip(1.0 - record["perfusion_norm"], 0.0, 1.0))


def _blend_with_aura_context(records: list[dict[str, Any]], aura_context: dict[str, Any]) -> None:
    flagged = aura_context.get("flagged_zones")
    if not isinstance(flagged, list):
        return

    aura_scores: dict[str, float] = {}
    for zone in flagged:
        if not isinstance(zone, dict):
            continue
        name = zone.get("zone")
        side = zone.get("side")
        score = _to_float(zone.get("score"))
        if not isinstance(name, str) or not isinstance(side, str):
            continue
        key = f"{side.strip().lower()}_{name.strip().lower()}"
        aura_scores[key] = float(np.clip((score or 0.0) / 22.0, 0.0, 1.0))

    for record in records:
        key = f"{record['side']}_{record['zone']}"
        aura_bonus = aura_scores.get(key, 0.0)
        blended = record["cold_score"] * 0.86 + aura_bonus * 0.14
        record["cold_score"] = float(np.clip(blended, 0.0, 1.0))


def _attach_chain_links(records: list[dict[str, Any]]) -> None:
    by_id = {record["zone_id"]: record for record in records}
    for record in records:
        mapping = CHAIN_LINKS.get(record["zone_id"])
        if not mapping:
            record["chain"] = None
            record["linked_zone_id"] = None
            record["linked_zone"] = None
            continue

        linked = by_id.get(mapping["linked_zone_id"])
        record["chain"] = mapping["chain"]
        record["linked_zone_id"] = mapping["linked_zone_id"]
        record["linked_zone"] = (
            {"zone": linked["zone"], "side": linked["side"], "zone_id": linked["zone_id"]}
            if linked
            else None
        )


def _assign_ranks(ranked_records: list[dict[str, Any]]) -> None:
    for idx, record in enumerate(ranked_records):
        record["rank"] = idx + 1


def _pick_secondary_zone(primary: dict[str, Any], ranked: list[dict[str, Any]]) -> dict[str, Any]:
    linked_zone_id = primary.get("linked_zone_id")
    if linked_zone_id:
        for zone in ranked:
            if zone["zone_id"] == linked_zone_id:
                return zone

    for zone in ranked:
        if zone["zone_id"] != primary["zone_id"]:
            return zone

    return primary


def _build_recommended_pads(
    primary: dict[str, Any], secondary: dict[str, Any], ranked: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    cold_scores = [record["cold_score"] for record in ranked]
    baseline = median(cold_scores) if cold_scores else 0.5

    sun_conf = float(np.clip(0.62 + (primary["cold_score"] - baseline), 0.35, 0.99))
    moon_conf = float(np.clip(0.56 + (secondary["cold_score"] - baseline) * 0.7, 0.3, 0.95))

    return {
        "sun": {
            "zone_id": primary["zone_id"],
            "zone": primary["zone"],
            "side": primary["side"],
            "chain": primary.get("chain"),
            "anchor": primary["anchor"],
            "confidence": _round(sun_conf, 3),
            "cold_score": _round(primary["cold_score"], 3),
            "reason": "Primary low-variance fascial zone",
        },
        "moon": {
            "zone_id": secondary["zone_id"],
            "zone": secondary["zone"],
            "side": secondary["side"],
            "chain": secondary.get("chain"),
            "anchor": secondary["anchor"],
            "confidence": _round(moon_conf, 3),
            "cold_score": _round(secondary["cold_score"], 3),
            "reason": "Myofascial chain-linked support zone",
        },
    }


def _to_flagged_zones(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    flagged = [
        {
            "zone": zone["zone"],
            "side": zone["side"],
            "score": _round(zone["cold_score"] * 100.0, 2),
            "zone_id": zone["zone_id"],
            "chain": zone.get("chain"),
        }
        for zone in ranked
        if zone["cold_score"] >= 0.54
    ]

    if flagged:
        return flagged[:4]

    top = ranked[0]
    return [
        {
            "zone": top["zone"],
            "side": top["side"],
            "score": _round(top["cold_score"] * 100.0, 2),
            "zone_id": top["zone_id"],
            "chain": top.get("chain"),
        }
    ]


def _extract_chain_targets(ranked: list[dict[str, Any]]) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for zone in ranked:
        if not zone.get("linked_zone"):
            continue
        targets.append(
            {
                "source_zone_id": zone["zone_id"],
                "source_zone": zone["zone"],
                "source_side": zone["side"],
                "chain": zone.get("chain"),
                "linked_zone": zone["linked_zone"],
            }
        )
    return targets


def _serialize_zone(zone: dict[str, Any]) -> dict[str, Any]:
    return {
        "rank": zone["rank"],
        "zone_id": zone["zone_id"],
        "zone": zone["zone"],
        "side": zone["side"],
        "sample_count": zone["sample_count"],
        "perfusion_index": _round(zone["perfusion_index"], 6),
        "temporal_variance": _round(zone["temporal_variance"], 6),
        "combined_index": _round(zone["combined_index"], 6),
        "perfusion_norm": _round(zone["perfusion_norm"], 4),
        "cold_score": _round(zone["cold_score"], 4),
        "chain": zone.get("chain"),
        "linked_zone_id": zone.get("linked_zone_id"),
        "linked_zone": zone.get("linked_zone"),
        "anchor": zone["anchor"],
    }


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _round(value: float, digits: int) -> float:
    return round(float(value), digits)
