/**
 * Clothes scanner — built on MediaPipe's multiclass selfie segmenter, which
 * has a dedicated "clothes" class. It runs fully on-device (no API key), works
 * on worn garments and on garments held up to the camera, and returns a
 * transparent PNG trimmed to the garment.
 *
 * Category ids: 0 background, 1 hair, 2 body-skin, 3 face-skin, 4 clothes, 5 others
 */
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import { captureGarment } from "./capture";

const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";

const CLOTHES = 4;
const OUT = 512;

export type ScanResult = {
  dataUrl: string;
  blob: Promise<Blob | null>;
  color: string;
  coverage: number;
  source: "segmenter" | "fallback";
};

let segmenterPromise: Promise<ImageSegmenter | null> | null = null;

export function getSegmenter(): Promise<ImageSegmenter | null> {
  segmenterPromise ??= (async () => {
    const create = async (delegate: "GPU" | "CPU") => {
      const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
      return ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      });
    };
    try {
      return await create("GPU");
    } catch {
      try {
        return await create("CPU");
      } catch (error) {
        console.error("[scanner] segmenter unavailable", error);
        return null;
      }
    }
  })();
  return segmenterPromise;
}

function sourceSize(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) {
  if (source instanceof HTMLVideoElement) return { w: source.videoWidth, h: source.videoHeight };
  if (source instanceof HTMLImageElement) return { w: source.naturalWidth, h: source.naturalHeight };
  return { w: source.width, h: source.height };
}

/** Draws a centred square crop of the source into a fresh 512×512 canvas. */
function cropSquare(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  mirror: boolean,
  ratio: number,
) {
  const { w, h } = sourceSize(source);
  const size = Math.min(w, h) * ratio;
  const sx = (w - size) / 2;
  const sy = (h - size) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  if (mirror) {
    ctx.translate(OUT, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, size, size, 0, 0, OUT, OUT);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

/** Largest connected clothes blob → keeps one garment, drops stray patches. */
function largestBlob(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h);
  let best: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const blob: number[] = [];
    while (stack.length) {
      const p = stack.pop()!;
      blob.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) (seen[p - 1] = 1), stack.push(p - 1);
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) (seen[p + 1] = 1), stack.push(p + 1);
      if (y > 0 && mask[p - w] && !seen[p - w]) (seen[p - w] = 1), stack.push(p - w);
      if (y < h - 1 && mask[p + w] && !seen[p + w]) (seen[p + w] = 1), stack.push(p + w);
    }
    if (blob.length > best.length) best = blob;
  }
  return best;
}

/** Runs the segmenter and returns the clothes mask upscaled to OUT×OUT. */
async function clothesMask(canvas: HTMLCanvasElement): Promise<Uint8Array | null> {
  const segmenter = await getSegmenter();
  if (!segmenter) return null;
  let raw: Uint8Array | null = null;
  let mw = 0;
  let mh = 0;
  try {
    const result = segmenter.segment(canvas);
    const category = result.categoryMask;
    if (!category) return null;
    mw = category.width;
    mh = category.height;
    raw = new Uint8Array(category.getAsUint8Array());
    result.close();
  } catch (error) {
    console.error("[scanner] segment failed", error);
    return null;
  }

  const mask = new Uint8Array(OUT * OUT);
  for (let y = 0; y < OUT; y++) {
    const sy = Math.min(mh - 1, ((y * mh) / OUT) | 0);
    for (let x = 0; x < OUT; x++) {
      const sx = Math.min(mw - 1, ((x * mw) / OUT) | 0);
      if (raw[sy * mw + sx] === CLOTHES) mask[y * OUT + x] = 1;
    }
  }
  return mask;
}

/**
 * Scans a garment out of a camera frame, image or canvas.
 * Falls back to the edge flood-fill cutout if the model finds no clothing.
 */
export async function scanGarment(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  options: { mirror?: boolean } = {},
): Promise<ScanResult> {
  const mirror = options.mirror ?? false;
  const isVideo = source instanceof HTMLVideoElement;
  const work = cropSquare(source, mirror, isVideo ? 0.92 : 1);
  const mask = await clothesMask(work);

  const fallback = (): ScanResult => {
    const result = captureGarment(source, undefined, mirror);
    return { ...result, coverage: 0, source: "fallback" };
  };

  if (!mask) return fallback();

  const blob = largestBlob(mask, OUT, OUT);
  const coverage = blob.length / (OUT * OUT);
  if (coverage < 0.015) return fallback();

  // Rebuild a clean mask from the winning blob, softened for a natural edge.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = OUT;
  maskCanvas.height = OUT;
  const mctx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
  const image = mctx.createImageData(OUT, OUT);
  let minX = OUT;
  let minY = OUT;
  let maxX = 0;
  let maxY = 0;
  for (const p of blob) {
    image.data[p * 4 + 3] = 255;
    const x = p % OUT;
    const y = (p / OUT) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  mctx.putImageData(image, 0, 0);

  const soft = document.createElement("canvas");
  soft.width = OUT;
  soft.height = OUT;
  const sctx = soft.getContext("2d", { willReadFrequently: true })!;
  sctx.filter = "blur(2px)";
  sctx.drawImage(maskCanvas, 0, 0);
  sctx.filter = "none";
  sctx.globalCompositeOperation = "source-in";
  sctx.drawImage(work, 0, 0);

  // Average garment colour.
  const pixels = sctx.getImageData(0, 0, OUT, OUT).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    if (pixels[i + 3]! < 200) continue;
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    n++;
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const color = n ? `#${hex(r / n)}${hex(g / n)}${hex(b / n)}` : "#cccccc";

  // Trim to the garment and centre it in a square output.
  const pad = 8;
  const bx = Math.max(0, minX - pad);
  const by = Math.max(0, minY - pad);
  const bw = Math.min(OUT - bx, maxX - minX + pad * 2);
  const bh = Math.min(OUT - by, maxY - minY + pad * 2);
  const out = document.createElement("canvas");
  out.width = OUT;
  out.height = OUT;
  const octx = out.getContext("2d")!;
  const scale = Math.min(OUT / Math.max(bw, 1), OUT / Math.max(bh, 1));
  const dw = bw * scale;
  const dh = bh * scale;
  octx.drawImage(soft, bx, by, bw, bh, (OUT - dw) / 2, (OUT - dh) / 2, dw, dh);

  return {
    color,
    coverage,
    source: "segmenter",
    dataUrl: out.toDataURL("image/png"),
    blob: new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png")),
  };
}

/** Lightweight live check: is a garment currently visible in the scan frame? */
export type GarmentPresence = { isClothing: boolean; label: string; score: number };

export async function detectGarmentLive(video: HTMLVideoElement): Promise<GarmentPresence> {
  if (!video.videoWidth) return { isClothing: false, label: "", score: 0 };
  const segmenter = await getSegmenter();
  if (!segmenter) return { isClothing: false, label: "", score: 0 };

  const N = 192;
  const size = Math.min(video.videoWidth, video.videoHeight) * 0.92;
  const sx = (video.videoWidth - size) / 2;
  const sy = (video.videoHeight - size) / 2;
  const canvas = document.createElement("canvas");
  canvas.width = N;
  canvas.height = N;
  canvas.getContext("2d")!.drawImage(video, sx, sy, size, size, 0, 0, N, N);

  try {
    const result = segmenter.segment(canvas);
    const category = result.categoryMask;
    if (!category) return { isClothing: false, label: "", score: 0 };
    const data = category.getAsUint8Array();
    let clothes = 0;
    for (let i = 0; i < data.length; i++) if (data[i] === CLOTHES) clothes++;
    result.close();
    const coverage = clothes / data.length;
    const isClothing = coverage > 0.05;
    return {
      isClothing,
      label: isClothing ? "Garment" : "",
      score: Math.min(1, coverage / 0.35),
    };
  } catch {
    return { isClothing: false, label: "", score: 0 };
  }
}
