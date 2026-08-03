/** Crops the scan square from the video and knocks out the flat background. */
export function captureGarment(video: HTMLVideoElement): {
  blob: Promise<Blob | null>;
  color: string;
  dataUrl: string;
} {
  const size = Math.min(video.videoWidth, video.videoHeight) * 0.7;
  const sx = (video.videoWidth - size) / 2;
  const sy = (video.videoHeight - size) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const w = canvas.width;
  const h = canvas.height;

  // Average the border pixels to estimate the background colour.
  let br = 0,
    bg = 0,
    bb = 0,
    n = 0;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    br += d[i]!;
    bg += d[i + 1]!;
    bb += d[i + 2]!;
    n++;
  };
  for (let x = 0; x < w; x += 4) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += 4) {
    sample(0, y);
    sample(w - 1, y);
  }
  br /= n;
  bg /= n;
  bb /= n;

  const TOL = 60;
  let cr = 0,
    cg = 0,
    cb = 0,
    kept = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!,
      g = d[i + 1]!,
      b = d[i + 2]!;
    const delta = Math.hypot(r - br, g - bg, b - bb);
    if (delta < TOL) {
      d[i + 3] = 0;
    } else {
      if (delta < TOL * 1.6) d[i + 3] = Math.round(255 * ((delta - TOL) / (TOL * 0.6)));
      cr += r;
      cg += g;
      cb += b;
      kept++;
    }
  }
  ctx.putImageData(image, 0, 0);

  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  const color = kept
    ? `#${hex(cr / kept)}${hex(cg / kept)}${hex(cb / kept)}`
    : "#cccccc";

  return {
    color,
    dataUrl: canvas.toDataURL("image/png"),
    blob: new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")),
  };
}