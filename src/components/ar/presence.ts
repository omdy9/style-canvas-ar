/**
 * Camera-based garment presence check.
 *
 * The ImageNet classifier was far too strict (most real garments never match
 * one of its 1000 labels), so detection now uses the same background flood
 * fill that the capture step uses: if a solid, reasonably large object is
 * held inside the scan square, we treat it as a garment.
 */
export type ClothingCheck = { isClothing: boolean; label: string; score: number };

const N = 96; // downscaled working size — fast enough for every frame
const TOL = 42;

let work: HTMLCanvasElement | null = null;

export function detectGarment(video: HTMLVideoElement): ClothingCheck {
  if (!video.videoWidth || !video.videoHeight) {
    return { isClothing: false, label: "", score: 0 };
  }
  const size = Math.min(video.videoWidth, video.videoHeight) * 0.7;
  const sx = (video.videoWidth - size) / 2;
  const sy = (video.videoHeight - size) / 2;

  work ??= document.createElement("canvas");
  work.width = N;
  work.height = N;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, size, size, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;

  const bg = new Uint8Array(N * N);
  const stack: number[] = [];
  const push = (p: number) => {
    if (!bg[p]) {
      bg[p] = 1;
      stack.push(p);
    }
  };
  for (let i = 0; i < N; i++) {
    push(i);
    push((N - 1) * N + i);
    push(i * N);
    push(i * N + N - 1);
  }
  const close = (a: number, b: number) => {
    const i = a * 4;
    const j = b * 4;
    return Math.hypot(d[i]! - d[j]!, d[i + 1]! - d[j + 1]!, d[i + 2]! - d[j + 2]!) < TOL;
  };
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % N;
    const y = (p / N) | 0;
    if (x > 0 && !bg[p - 1] && close(p, p - 1)) push(p - 1);
    if (x < N - 1 && !bg[p + 1] && close(p, p + 1)) push(p + 1);
    if (y > 0 && !bg[p - N] && close(p, p - N)) push(p - N);
    if (y < N - 1 && !bg[p + N] && close(p, p + N)) push(p + N);
  }

  // Foreground coverage, ignoring speckle.
  let kept = 0;
  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const p = y * N + x;
      if (bg[p]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) if (!bg[p + dy * N + dx]) n++;
      if (n >= 6) kept++;
    }
  }

  const coverage = kept / (N * N);
  // Too little = nothing held up; too much = camera is looking at a wall/person.
  const isClothing = coverage > 0.1 && coverage < 0.92;
  return {
    isClothing,
    label: isClothing ? "Garment" : "",
    score: Math.min(1, coverage / 0.5),
  };
}
