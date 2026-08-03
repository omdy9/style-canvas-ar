import type { Anchor } from "@/lib/wardrobe";

type P = { x: number; y: number; visibility?: number };

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);

/** Places a stored garment photo onto the tracked body at the given anchor. */
export function drawGarment(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  anchor: Anchor,
  lm: P[],
) {
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
  const lAnkle = lm[27]!;
  const rAnkle = lm[28]!;

  const shoulderW = dist(lSh, rSh) || 1;
  const headW = dist(leftEar, rightEar) || shoulderW * 0.6;
  const midSh = lerp(lSh, rSh, 0.5);
  const midHip = lerp(lHip, rHip, 0.5);
  const midAnkle = lerp(lAnkle, rAnkle, 0.5);
  const eyes = lerp(leftEye, rightEye, 0.5);
  const headAngle = ang(rightEye, leftEye);
  const torsoAngle = ang(rSh, lSh);

  let center: P;
  let width: number;
  let rotation: number;

  switch (anchor) {
    case "head":
      center = { x: eyes.x, y: eyes.y - headW * 0.55 };
      width = headW * 1.6;
      rotation = headAngle;
      break;
    case "face":
      center = eyes;
      width = headW * 1.15;
      rotation = headAngle;
      break;
    case "neck":
      center = lerp(midSh, eyes, 0.18);
      width = shoulderW * 0.7;
      rotation = torsoAngle;
      break;
    case "wrist": {
      const useLeft = (lWrist.visibility ?? 0) >= (rWrist.visibility ?? 0);
      const wrist = useLeft ? lWrist : rWrist;
      const elbow = useLeft ? lElbow : rElbow;
      center = lerp(wrist, elbow, 0.18);
      width = shoulderW * 0.3;
      rotation = ang(elbow, wrist) + Math.PI / 2;
      break;
    }
    case "legs":
      center = lerp(midHip, midAnkle, 0.45);
      width = shoulderW * 1.05;
      rotation = ang(rHip, lHip);
      break;
    case "torso":
    default:
      center = lerp(midSh, midHip, 0.42);
      width = shoulderW * 1.55;
      rotation = torsoAngle;
      break;
  }

  const ratio = img.height / img.width || 1;
  const height = width * ratio;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(rotation);
  ctx.globalAlpha = 0.94;
  ctx.drawImage(img, -width / 2, -height / 2, width, height);
  ctx.restore();
}