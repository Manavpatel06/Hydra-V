import { clamp } from "../../core/utils.js";

export function buildCanonicalPose(width, height) {
  const cx = width * 0.5;
  return finalizePose({
    leftShoulder: { x: cx - width * 0.16, y: height * 0.255 },
    rightShoulder: { x: cx + width * 0.16, y: height * 0.255 },
    leftElbow: { x: cx - width * 0.21, y: height * 0.42 },
    rightElbow: { x: cx + width * 0.21, y: height * 0.42 },
    leftWrist: { x: cx - width * 0.23, y: height * 0.585 },
    rightWrist: { x: cx + width * 0.23, y: height * 0.585 },
    leftHip: { x: cx - width * 0.11, y: height * 0.485 },
    rightHip: { x: cx + width * 0.11, y: height * 0.485 },
    leftKnee: { x: cx - width * 0.105, y: height * 0.695 },
    rightKnee: { x: cx + width * 0.105, y: height * 0.695 },
    leftAnkle: { x: cx - width * 0.11, y: height * 0.915 },
    rightAnkle: { x: cx + width * 0.11, y: height * 0.915 }
  });
}

export function buildPoseFromLandmarks(landmarks, width, height) {
  if (!Array.isArray(landmarks) || landmarks.length < 29) {
    return null;
  }

  const toPoint = (idx) => {
    const p = landmarks[idx];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      return null;
    }
    return { x: p.x * width, y: p.y * height };
  };

  const pose = finalizePose({
    leftShoulder: toPoint(11),
    rightShoulder: toPoint(12),
    leftElbow: toPoint(13),
    rightElbow: toPoint(14),
    leftWrist: toPoint(15),
    rightWrist: toPoint(16),
    leftHip: toPoint(23),
    rightHip: toPoint(24),
    leftKnee: toPoint(25),
    rightKnee: toPoint(26),
    leftAnkle: toPoint(27),
    rightAnkle: toPoint(28)
  });

  if (!pose.leftShoulder || !pose.rightShoulder || !pose.leftHip || !pose.rightHip) {
    return null;
  }
  return pose;
}

export function drawAnatomyFigure(ctx, pose, options = {}) {
  if (!ctx || !pose) {
    return;
  }

  const alpha = Number.isFinite(options.alpha) ? clamp(options.alpha, 0, 1) : 1;
  const bodyFill = options.bodyFill || "rgba(184, 188, 193, 0.9)";
  const bodyStroke = options.bodyStroke || "rgba(246, 248, 250, 0.38)";
  const detailStroke = options.detailStroke || "rgba(245, 248, 250, 0.42)";
  const shadowColor = options.shadowColor || null;
  const shadowBlur = Number.isFinite(options.shadowBlur) ? options.shadowBlur : 0;

  const shoulderSpan = distance(pose.leftShoulder, pose.rightShoulder);
  const hipSpan = distance(pose.leftHip, pose.rightHip);
  const shoulderCenter = pose.shoulderCenter;
  const hipCenter = pose.hipCenter;
  const torsoCenter = pose.torsoCenter;

  const headRadiusX = clamp(shoulderSpan * 0.24, 10, 80);
  const headRadiusY = headRadiusX * 1.26;
  const headCenter = {
    x: shoulderCenter.x,
    y: shoulderCenter.y - headRadiusY * 1.35
  };

  const neckWidth = shoulderSpan * 0.23;
  const neckHeight = shoulderSpan * 0.19;

  const upperArmW = clamp(shoulderSpan * 0.18, 8, 58);
  const foreArmW = upperArmW * 0.72;
  const thighW = clamp(Math.max(hipSpan * 0.3, upperArmW * 0.95), 8, 64);
  const calfW = thighW * 0.72;

  const leftRib = pushOut(lerp(pose.leftShoulder, pose.leftHip, 0.45), torsoCenter, 1.18);
  const rightRib = pushOut(lerp(pose.rightShoulder, pose.rightHip, 0.45), torsoCenter, 1.18);
  const leftHipOut = pushOut(pose.leftHip, torsoCenter, 1.14);
  const rightHipOut = pushOut(pose.rightHip, torsoCenter, 1.14);
  const leftShoulderOut = pushOut(pose.leftShoulder, torsoCenter, 1.15);
  const rightShoulderOut = pushOut(pose.rightShoulder, torsoCenter, 1.15);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shadowColor && shadowBlur > 0) {
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur;
  }

  ctx.fillStyle = bodyFill;
  ctx.strokeStyle = bodyStroke;
  ctx.lineWidth = clamp(shoulderSpan * 0.014, 1.1, 3.8);

  drawTaperedLimb(ctx, pose.leftShoulder, pose.leftElbow, upperArmW, upperArmW * 0.86, bodyFill);
  drawTaperedLimb(ctx, pose.leftElbow, pose.leftWrist, foreArmW, foreArmW * 0.72, bodyFill);
  drawTaperedLimb(ctx, pose.rightShoulder, pose.rightElbow, upperArmW, upperArmW * 0.86, bodyFill);
  drawTaperedLimb(ctx, pose.rightElbow, pose.rightWrist, foreArmW, foreArmW * 0.72, bodyFill);
  drawTaperedLimb(ctx, pose.leftHip, pose.leftKnee, thighW, thighW * 0.82, bodyFill);
  drawTaperedLimb(ctx, pose.leftKnee, pose.leftAnkle, calfW, calfW * 0.66, bodyFill);
  drawTaperedLimb(ctx, pose.rightHip, pose.rightKnee, thighW, thighW * 0.82, bodyFill);
  drawTaperedLimb(ctx, pose.rightKnee, pose.rightAnkle, calfW, calfW * 0.66, bodyFill);

  ctx.beginPath();
  ctx.moveTo(leftShoulderOut.x, leftShoulderOut.y);
  ctx.lineTo(rightShoulderOut.x, rightShoulderOut.y);
  ctx.lineTo(rightRib.x, rightRib.y);
  ctx.lineTo(rightHipOut.x, rightHipOut.y);
  ctx.lineTo(leftHipOut.x, leftHipOut.y);
  ctx.lineTo(leftRib.x, leftRib.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(headCenter.x, headCenter.y, headRadiusX, headRadiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(shoulderCenter.x - neckWidth * 0.5, shoulderCenter.y - neckHeight * 0.28);
  ctx.lineTo(shoulderCenter.x + neckWidth * 0.5, shoulderCenter.y - neckHeight * 0.28);
  ctx.lineTo(shoulderCenter.x + neckWidth * 0.27, shoulderCenter.y + neckHeight * 0.45);
  ctx.lineTo(shoulderCenter.x - neckWidth * 0.27, shoulderCenter.y + neckHeight * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  drawHand(ctx, pose.leftWrist, upperArmW * 0.45, bodyFill, bodyStroke);
  drawHand(ctx, pose.rightWrist, upperArmW * 0.45, bodyFill, bodyStroke);
  drawFoot(ctx, pose.leftAnkle, thighW * 0.56, bodyFill, bodyStroke);
  drawFoot(ctx, pose.rightAnkle, thighW * 0.56, bodyFill, bodyStroke);

  if (options.details !== false) {
    drawMuscleLines(ctx, pose, {
      stroke: detailStroke,
      lineWidth: clamp(shoulderSpan * 0.008, 0.8, 2.4),
      headCenter,
      headRadiusX
    });
  }

  ctx.restore();
}

export function drawZoneHighlight(ctx, pose, zone, side, score = 8, options = {}) {
  if (!ctx || !pose) {
    return;
  }
  const anchor = resolveZoneAnchor(pose, zone, side);
  if (!anchor) {
    return;
  }

  const severity = clamp(Number(score) / 20, 0.1, 1);
  const baseRadius = Number.isFinite(options.baseRadius) ? options.baseRadius : 18;
  const radius = baseRadius * (0.7 + severity * 0.8);
  const label = options.label || `${side} ${zone}`;
  const showLabel = options.showLabel !== false;
  const hueWarm = score > 12;
  const inner = hueWarm ? "rgba(238, 97, 39, 0.74)" : "rgba(244, 165, 62, 0.72)";
  const outer = hueWarm ? "rgba(238, 97, 39, 0.06)" : "rgba(244, 165, 62, 0.05)";
  const ring = hueWarm ? "rgba(255, 130, 74, 0.9)" : "rgba(255, 195, 82, 0.9)";

  ctx.save();
  const g = ctx.createRadialGradient(anchor.x, anchor.y, radius * 0.16, anchor.x, anchor.y, radius);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(anchor.x, anchor.y, radius * 0.92, radius * 1.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(anchor.x, anchor.y, radius * 0.64, radius * 0.76, 0, 0, Math.PI * 2);
  ctx.stroke();

  if (showLabel) {
    ctx.font = "600 10px JetBrains Mono";
    const text = `${label} ${Math.round(score)}%`;
    const pad = 5;
    const tw = ctx.measureText(text).width;
    const bx = anchor.x - tw * 0.5 - pad;
    const by = anchor.y - radius - 16;
    roundRect(ctx, bx, by, tw + pad * 2, 14, 6);
    ctx.fillStyle = "rgba(12, 28, 36, 0.78)";
    ctx.fill();
    ctx.strokeStyle = "rgba(184, 226, 239, 0.45)";
    ctx.stroke();
    ctx.fillStyle = "#f8f0de";
    ctx.fillText(text, bx + pad, by + 10.5);
  }
  ctx.restore();
}

function finalizePose(pose) {
  if (!pose.leftShoulder || !pose.rightShoulder || !pose.leftHip || !pose.rightHip) {
    return pose;
  }
  const shoulderCenter = midpoint(pose.leftShoulder, pose.rightShoulder);
  const hipCenter = midpoint(pose.leftHip, pose.rightHip);
  return {
    ...pose,
    shoulderCenter,
    hipCenter,
    torsoCenter: midpoint(shoulderCenter, hipCenter)
  };
}

function drawMuscleLines(ctx, pose, options) {
  const stroke = options.stroke;
  const lineWidth = options.lineWidth;
  const shoulderCenter = pose.shoulderCenter;
  const hipCenter = pose.hipCenter;
  const torsoCenter = pose.torsoCenter;
  const shoulderSpan = distance(pose.leftShoulder, pose.rightShoulder);
  const hipSpan = distance(pose.leftHip, pose.rightHip);

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(shoulderCenter.x, shoulderCenter.y + shoulderSpan * 0.03);
  ctx.lineTo(hipCenter.x, hipCenter.y + hipSpan * 0.33);
  ctx.stroke();

  for (let i = 1; i <= 4; i += 1) {
    const t = i / 5;
    const y = lerpY(shoulderCenter.y + shoulderSpan * 0.12, hipCenter.y + hipSpan * 0.06, t);
    const width = shoulderSpan * (0.25 - t * 0.11);
    ctx.beginPath();
    ctx.moveTo(torsoCenter.x - width, y);
    ctx.lineTo(torsoCenter.x + width, y);
    ctx.stroke();
  }

  drawCurve(ctx, pose.leftShoulder, torsoCenter, pose.leftHip);
  drawCurve(ctx, pose.rightShoulder, torsoCenter, pose.rightHip);

  drawInnerLimbLine(ctx, pose.leftShoulder, pose.leftElbow, pose.leftWrist);
  drawInnerLimbLine(ctx, pose.rightShoulder, pose.rightElbow, pose.rightWrist);
  drawInnerLimbLine(ctx, pose.leftHip, pose.leftKnee, pose.leftAnkle);
  drawInnerLimbLine(ctx, pose.rightHip, pose.rightKnee, pose.rightAnkle);

  const headCenter = options.headCenter;
  const headRadiusX = options.headRadiusX;
  ctx.beginPath();
  ctx.moveTo(headCenter.x - headRadiusX * 0.22, headCenter.y + headRadiusX * 0.72);
  ctx.lineTo(headCenter.x + headRadiusX * 0.22, headCenter.y + headRadiusX * 0.72);
  ctx.stroke();

  ctx.restore();
}

function drawCurve(ctx, p1, pc, p2) {
  if (!p1 || !pc || !p2) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.quadraticCurveTo(pc.x, pc.y, p2.x, p2.y);
  ctx.stroke();
}

function drawInnerLimbLine(ctx, a, b, c) {
  if (!a || !b || !c) {
    return;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.stroke();
}

function drawTaperedLimb(ctx, start, end, startWidth, endWidth, color) {
  if (!start || !end) {
    return;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) {
    return;
  }

  const nx = -dy / len;
  const ny = dx / len;

  const aL = { x: start.x + nx * (startWidth * 0.5), y: start.y + ny * (startWidth * 0.5) };
  const aR = { x: start.x - nx * (startWidth * 0.5), y: start.y - ny * (startWidth * 0.5) };
  const bL = { x: end.x + nx * (endWidth * 0.5), y: end.y + ny * (endWidth * 0.5) };
  const bR = { x: end.x - nx * (endWidth * 0.5), y: end.y - ny * (endWidth * 0.5) };

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(aL.x, aL.y);
  ctx.lineTo(bL.x, bL.y);
  ctx.lineTo(bR.x, bR.y);
  ctx.lineTo(aR.x, aR.y);
  ctx.closePath();
  ctx.fill();
}

function drawHand(ctx, wrist, radius, fill, stroke) {
  if (!wrist) {
    return;
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.ellipse(wrist.x, wrist.y + radius * 0.2, radius * 0.65, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawFoot(ctx, ankle, length, fill, stroke) {
  if (!ankle) {
    return;
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.ellipse(ankle.x, ankle.y + length * 0.26, length * 0.55, length * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function resolveZoneAnchor(pose, zone, side) {
  const s = side === "right" ? "right" : "left";
  const key = `${s}-${zone || "hip"}`;
  const map = {
    "left-shoulder": pose.leftShoulder,
    "right-shoulder": pose.rightShoulder,
    "left-hip": pose.leftHip,
    "right-hip": pose.rightHip,
    "left-knee": pose.leftKnee,
    "right-knee": pose.rightKnee
  };
  return map[key] || pose.torsoCenter || null;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function lerpY(a, b, t) {
  return a + (b - a) * t;
}

function pushOut(point, center, factor) {
  return {
    x: center.x + (point.x - center.x) * factor,
    y: center.y + (point.y - center.y) * factor
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
