/**
 * Crops the scan square from the video and keeps only the garment:
 * the background is removed with a colour-tolerant flood fill from the
 * frame edges (so garment-coloured pixels in the middle survive), then the
 * result is trimmed to the garment's bounding box.
 */
type PosePoint = { x: number; y: number; visibility?: number };

export function captureGarment(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  pose?: PosePoint[],
  mirror = true
): {
  blob: Promise<Blob | null>;
  color: string;
  dataUrl: string;
} {
  let width = 0;
  let height = 0;
  if (source instanceof HTMLVideoElement) {
    width = source.videoWidth;
    height = source.videoHeight;
  } else if (source instanceof HTMLImageElement) {
    width = source.naturalWidth;
    height = source.naturalHeight;
  } else {
    width = source.width;
    height = source.height;
  }

  const cropRatio = source instanceof HTMLVideoElement ? 0.7 : 0.95;
  const size = Math.min(width, height) * cropRatio;
  const sx = (width - size) / 2;
  const sy = (height - size) / 2;

  const W = 512;
  const H = 512;
  const work = document.createElement("canvas");
  work.width = W;
  work.height = H;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  if (mirror) {
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, size, size, 0, 0, W, H);
  if (mirror) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;

  // When the garment is being worn, it commonly touches every side of the
  // scan frame. Edge flood-fill then mistakes the garment for the background.
  // Use the tracked shoulders/elbows/hips to isolate the worn torso instead.
  const poseIndices = [13, 11, 23, 24, 12, 14];
  const hasTorsoPose = poseIndices.every((index) => {
    const point = pose?.[index];
    return point && (point.visibility ?? 1) > 0.45;
  });

  if (hasTorsoPose && pose) {
    const points = poseIndices.map((index) => {
      const point = pose[index]!;
      return {
        x: W - ((point.x * width - sx) / size) * W,
        y: ((point.y * height - sy) / size) * H,
      };
    });
    const shoulderWidth = Math.abs(points[1]!.x - points[4]!.x);
    // Extend slightly beyond elbows and below hips so sleeves and hems remain.
    points[0]!.x += points[0]!.x < W / 2 ? -shoulderWidth * 0.12 : shoulderWidth * 0.12;
    points[5]!.x += points[5]!.x < W / 2 ? -shoulderWidth * 0.12 : shoulderWidth * 0.12;
    points[2]!.y += shoulderWidth * 0.18;
    points[3]!.y += shoulderWidth * 0.18;

    const mask = document.createElement("canvas");
    mask.width = W;
    mask.height = H;
    const mctx = mask.getContext("2d")!;
    mctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) mctx.moveTo(point.x, point.y);
      else mctx.lineTo(point.x, point.y);
    });
    mctx.closePath();
    mctx.filter = "blur(5px)";
    mctx.fillStyle = "#fff";
    mctx.fill();
    mctx.filter = "none";
    mctx.globalCompositeOperation = "source-in";
    mctx.drawImage(work, 0, 0);

    const bounds = points.reduce(
      (value, point) => ({
        minX: Math.min(value.minX, point.x),
        minY: Math.min(value.minY, point.y),
        maxX: Math.max(value.maxX, point.x),
        maxY: Math.max(value.maxY, point.y),
      }),
      { minX: W, minY: H, maxX: 0, maxY: 0 },
    );
    const bx = Math.max(0, bounds.minX - 10);
    const by = Math.max(0, bounds.minY - 10);
    const bw = Math.min(W - bx, bounds.maxX - bounds.minX + 20);
    const bh = Math.min(H - by, bounds.maxY - bounds.minY + 20);
    const out = document.createElement("canvas");
    out.width = W;
    out.height = H;
    const octx = out.getContext("2d")!;
    const scale = Math.min(W / Math.max(bw, 1), H / Math.max(bh, 1));
    const dw = bw * scale;
    const dh = bh * scale;
    octx.drawImage(mask, bx, by, bw, bh, (W - dw) / 2, (H - dh) / 2, dw, dh);

    let cr = 0;
    let cg = 0;
    let cb = 0;
    let count = 0;
    const torsoData = mctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < torsoData.length; i += 16) {
      if (torsoData[i + 3]! < 80) continue;
      cr += torsoData[i]!;
      cg += torsoData[i + 1]!;
      cb += torsoData[i + 2]!;
      count++;
    }
    const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");
    const color = count ? `#${hex(cr / count)}${hex(cg / count)}${hex(cb / count)}` : "#cccccc";
    return {
      color,
      dataUrl: out.toDataURL("image/png"),
      blob: new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png")),
    };
  }

  const TOL = 42; // colour distance that still counts as background
  const bgMask = new Uint8Array(W * H);
  const stack: number[] = [];

  const push = (p: number) => {
    if (!bgMask[p]) {
      bgMask[p] = 1;
      stack.push(p);
    }
  };

  // Seed the flood fill from every edge pixel.
  for (let x = 0; x < W; x++) {
    push(x);
    push((H - 1) * W + x);
  }
  for (let y = 0; y < H; y++) {
    push(y * W);
    push(y * W + W - 1);
  }

  const close = (a: number, b: number) => {
    const i = a * 4;
    const j = b * 4;
    return Math.hypot(d[i]! - d[j]!, d[i + 1]! - d[j + 1]!, d[i + 2]! - d[j + 2]!) < TOL;
  };

  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W;
    const y = (p / W) | 0;
    if (x > 0 && !bgMask[p - 1] && close(p, p - 1)) push(p - 1);
    if (x < W - 1 && !bgMask[p + 1] && close(p, p + 1)) push(p + 1);
    if (y > 0 && !bgMask[p - W] && close(p, p - W)) push(p - W);
    if (y < H - 1 && !bgMask[p + W] && close(p, p + W)) push(p + W);
  }

  // Drop isolated foreground specks (noise) with a small neighbour count pass.
  const solid = new Uint8Array(bgMask.length);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (bgMask[p]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (!bgMask[p + dy * W + dx]) n++;
      if (n >= 5) solid[p] = 1;
    }
  }

  let minX = W,
    minY = H,
    maxX = -1,
    maxY = -1;
  let cr = 0,
    cg = 0,
    cb = 0,
    kept = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const i = p * 4;
      if (!solid[p]) {
        d[i + 3] = 0;
        continue;
      }
      // Feather pixels that touch the background for a clean edge.
      const edge =
        x === 0 ||
        y === 0 ||
        x === W - 1 ||
        y === H - 1 ||
        !solid[p - 1] ||
        !solid[p + 1] ||
        !solid[p - W] ||
        !solid[p + W];
      if (edge) d[i + 3] = 170;
      cr += d[i]!;
      cg += d[i + 1]!;
      cb += d[i + 2]!;
      kept++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Trim to the garment, keeping a small margin and a square output.
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  if (kept > 500 && maxX > minX && maxY > minY) {
    const pad = 8;
    const bx = Math.max(0, minX - pad);
    const by = Math.max(0, minY - pad);
    const bw = Math.min(W - bx, maxX - minX + pad * 2);
    const bh = Math.min(H - by, maxY - minY + pad * 2);
    const side = Math.max(bw, bh);
    const scale = W / side;
    const dw = bw * scale;
    const dh = bh * scale;
    octx.drawImage(work, bx, by, bw, bh, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    octx.drawImage(work, 0, 0);
  }

  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  const color = kept ? `#${hex(cr / kept)}${hex(cg / kept)}${hex(cb / kept)}` : "#cccccc";

  return {
    color,
    dataUrl: out.toDataURL("image/png"),
    blob: new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png")),
  };
}
