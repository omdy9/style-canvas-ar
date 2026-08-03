import type { ItemId } from "./items";

type P = { x: number; y: number; visibility?: number };

const lerp = (a: P, b: P, t: number): P => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);

/** Draws a stylised garment/accessory anchored to BlazePose landmarks (pixel space). */
export function drawItem(ctx: CanvasRenderingContext2D, id: ItemId, color: string, lm: P[]) {
  const nose = lm[0]!;
  const leftEye = lm[2]!;
  const rightEye = lm[5]!;
  const leftEar = lm[7]!;
  const rightEar = lm[8]!;
  const lSh = lm[11]!;
  const rSh = lm[12]!;
  const lElbow = lm[13]!;
  const rElbow = lm[14]!;
  const lWrist = lm[15]!;
  const rWrist = lm[16]!;
  const lHip = lm[23]!;
  const rHip = lm[24]!;

  const shoulderW = dist(lSh, rSh) || 1;
  const midSh = lerp(lSh, rSh, 0.5);
  const midHip = lerp(lHip, rHip, 0.5);
  const torsoAngle = ang(rSh, lSh);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  switch (id) {
    case "sunglasses": {
      const w = dist(leftEar, rightEar) * 1.02 || shoulderW * 0.7;
      const c = lerp(leftEye, rightEye, 0.5);
      const a = ang(rightEye, leftEye);
      ctx.translate(c.x, c.y);
      ctx.rotate(a);
      const lensW = w * 0.38;
      const lensH = w * 0.24;
      ctx.fillStyle = color;
      ctx.strokeStyle = "#C9A227";
      ctx.lineWidth = Math.max(1.5, w * 0.02);
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect((sx * w) / 4 - lensW / 2, -lensH / 2, lensW, lensH, lensH * 0.45);
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-w * 0.06, 0);
      ctx.lineTo(w * 0.06, 0);
      ctx.stroke();
      break;
    }
    case "cap": {
      const w = dist(leftEar, rightEar) * 1.35 || shoulderW * 0.9;
      const eyes = lerp(leftEye, rightEye, 0.5);
      const c = { x: eyes.x, y: eyes.y - w * 0.32 };
      const a = ang(rightEye, leftEye);
      ctx.translate(c.x, c.y);
      ctx.rotate(a);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.52, w * 0.42, 0, Math.PI, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, w * 0.02, w * 0.62, w * 0.14, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = "#C9A227";
      ctx.beginPath();
      ctx.arc(0, -w * 0.38, w * 0.04, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "necklace": {
      const neck = lerp(midSh, nose, 0.22);
      ctx.translate(neck.x, neck.y);
      ctx.rotate(torsoAngle);
      const w = shoulderW * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, shoulderW * 0.025);
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.5, w * 0.42, 0, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, w * 0.42, shoulderW * 0.035, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "watch": {
      const wristL = lWrist.visibility ?? 0;
      const wristR = rWrist.visibility ?? 0;
      const wrist = wristL >= wristR ? lWrist : rWrist;
      const elbow = wristL >= wristR ? lElbow : rElbow;
      const p = lerp(wrist, elbow, 0.18);
      const s = shoulderW * 0.16;
      ctx.translate(p.x, p.y);
      ctx.rotate(ang(elbow, wrist) + Math.PI / 2);
      ctx.fillStyle = "#2a2a2a";
      ctx.beginPath();
      ctx.roundRect(-s * 0.7, -s * 0.28, s * 1.4, s * 0.56, s * 0.2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#C9A227";
      ctx.lineWidth = Math.max(1.5, s * 0.1);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "tee":
    case "jacket": {
      const isJacket = id === "jacket";
      const w = shoulderW * (isJacket ? 1.3 : 1.2);
      const c = lerp(midSh, midHip, isJacket ? 0.42 : 0.36);
      const h = dist(midSh, midHip) * (isJacket ? 1.3 : 1.15) || w * 1.3;
      ctx.translate(c.x, c.y);
      ctx.rotate(torsoAngle);
      ctx.globalAlpha = 0.88;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.quadraticCurveTo(0, -h / 2 + h * 0.08, w / 2, -h / 2);
      ctx.lineTo(w * 0.46, h / 2);
      ctx.quadraticCurveTo(0, h / 2 + h * 0.06, -w * 0.46, h / 2);
      ctx.closePath();
      ctx.fill();
      // sleeves
      ctx.lineWidth = w * 0.2;
      ctx.strokeStyle = color;
      for (const [sh, el] of [
        [lSh, lElbow],
        [rSh, rElbow],
      ] as const) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 0.88;
        ctx.strokeStyle = color;
        ctx.lineWidth = shoulderW * 0.22;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(lerp(sh, el, isJacket ? 0.95 : 0.55).x, lerp(sh, el, isJacket ? 0.95 : 0.55).y);
        ctx.stroke();
        ctx.restore();
      }
      if (isJacket) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#C9A227";
        ctx.lineWidth = Math.max(1.5, w * 0.012);
        ctx.beginPath();
        ctx.moveTo(0, -h / 2 + h * 0.06);
        ctx.lineTo(0, h / 2);
        ctx.stroke();
      }
      break;
    }
    case "bag": {
      const sh = (lSh.visibility ?? 0) >= (rSh.visibility ?? 0) ? lSh : rSh;
      const hip = sh === lSh ? lHip : rHip;
      const p = lerp(sh, hip, 0.85);
      const s = shoulderW * 0.42;
      ctx.translate(p.x, p.y);
      ctx.rotate(torsoAngle);
      ctx.strokeStyle = "#3a2515";
      ctx.lineWidth = Math.max(2, s * 0.09);
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.4);
      ctx.lineTo(0, -s * 0.5);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s * 0.5, s, s * 0.9, s * 0.12);
      ctx.fill();
      ctx.strokeStyle = "#C9A227";
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath();
      ctx.roundRect(-s / 2, -s * 0.5, s, s * 0.9, s * 0.12);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}