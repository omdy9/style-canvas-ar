/**
 * Clothing segmentation using the official @huggingface/inference client.
 *
 * Model: mattmdjaga/segformer_b2_clothes
 * Detects 18 clothing categories: hat, hair, sunglasses, upper-clothes,
 * skirt, pants, dress, belt, shoe, bag, scarf, etc.
 *
 * Uses the official HF JS client which correctly handles browser CORS.
 */
import { HfInference } from "@huggingface/inference";

const HF_TOKEN = import.meta.env['VITE_HUGGING_FACE_TOKEN'] as string | undefined;
const MODEL_ID = "mattmdjaga/segformer_b2_clothes";

// Labels we treat as "clothing" (exclude background, skin, hair, face)
const GARMENT_LABELS = new Set([
  "hat",
  "sunglasses",
  "upper-clothes",
  "skirt",
  "pants",
  "dress",
  "belt",
  "left-shoe",
  "right-shoe",
  "scarf",
  "jacket",
  "bag",
]);

export type HFSegmentResult = {
  dataUrl: string;
  blob: Promise<Blob | null>;
  color: string;
  labels: string[];
};

/** Whether the HF token is configured */
export function isHFConfigured(): boolean {
  return Boolean(HF_TOKEN);
}

/**
 * Apply segmentation masks onto the source image,
 * making non-garment pixels transparent, and crop to tight bounding box.
 */
async function applyMasksToImage(
  src: HTMLImageElement,
  segments: { label: string; score: number; mask: Blob }[],
  W: number,
  H: number,
): Promise<{ canvas: HTMLCanvasElement; labels: string[]; color: string }> {
  const garmentSegs = segments.filter((s) => GARMENT_LABELS.has(s.label));
  const detectedLabels = garmentSegs.map((s) => s.label);

  // Draw source image onto working canvas
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);
  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = imageData.data;

  // Build combined garment mask
  const combinedMask = new Uint8Array(W * H);

  for (const seg of garmentSegs) {
    // The mask is returned as a Blob — draw it to read pixel data
    const maskUrl = URL.createObjectURL(seg.mask);
    const maskImg = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = maskUrl;
    });

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = W;
    maskCanvas.height = H;
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(maskImg, 0, 0, W, H);
    URL.revokeObjectURL(maskUrl);

    const maskData = mctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) {
      // Mask is grayscale — white (>128) = garment
      if (maskData[i * 4]! > 128) combinedMask[i] = 1;
    }
  }

  // Zero alpha for non-garment pixels; collect bounding box + dominant colour
  let minX = W, minY = H, maxX = 0, maxY = 0;
  let cr = 0, cg = 0, cb = 0, kept = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!combinedMask[i]) {
        pixels[i * 4 + 3] = 0;
      } else {
        cr += pixels[i * 4]!;
        cg += pixels[i * 4 + 1]!;
        cb += pixels[i * 4 + 2]!;
        kept++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  const color = kept
    ? `#${hex(cr / kept)}${hex(cg / kept)}${hex(cb / kept)}`
    : "#cccccc";

  // Crop to bounding box with padding, square 512×512 output
  const out = document.createElement("canvas");
  out.width = 512;
  out.height = 512;
  const octx = out.getContext("2d")!;

  if (kept > 100 && maxX > minX && maxY > minY) {
    const pad = 12;
    const bx = Math.max(0, minX - pad);
    const by = Math.max(0, minY - pad);
    const bw = Math.min(W - bx, maxX - minX + pad * 2);
    const bh = Math.min(H - by, maxY - minY + pad * 2);
    const side = Math.max(bw, bh);
    const scale = 512 / side;
    octx.drawImage(
      canvas,
      bx, by, bw, bh,
      (512 - bw * scale) / 2,
      (512 - bh * scale) / 2,
      bw * scale,
      bh * scale,
    );
  } else {
    octx.drawImage(canvas, 0, 0, W, H, 0, 0, 512, 512);
  }

  return { canvas: out, labels: detectedLabels, color };
}

/**
 * Main entry point — accepts a File from <input type="file">.
 * Sends it to the HF Inference API using the official JS client
 * (which handles browser CORS correctly).
 */
export async function segmentClothingFromFile(file: File): Promise<HFSegmentResult> {
  if (!HF_TOKEN) throw new Error("Hugging Face token is not configured.");

  const hf = new HfInference(HF_TOKEN);

  // Load image to get natural dimensions
  const objectUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = objectUrl;
  });
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  URL.revokeObjectURL(objectUrl);

  // Call HF image-segmentation via the official client
  const segments = await hf.imageSegmentation({
    model: MODEL_ID,
    inputs: file,
  });

  // Convert score-sorted segments into our format (masks returned as Blobs by the client)
  const segmentsWithBlobs = segments.map((s) => ({
    label: s.label,
    score: s.score,
    // The HF client returns the mask as a base64-encoded PNG string inside `mask`
    mask: s.mask,
  }));

  // Build mask blobs from base64 strings
  const processed = await Promise.all(
    segmentsWithBlobs
      .filter((s) => GARMENT_LABELS.has(s.label))
      .map(async (s) => {
        // Convert base64 mask to a Blob
        const res = await fetch(`data:image/png;base64,${s.mask}`);
        return { label: s.label, score: s.score, mask: await res.blob() };
      })
  );

  if (processed.length === 0) {
    throw new Error(
      "No clothing detected in this image. Try a photo with a clear garment against a different background."
    );
  }

  const { canvas, labels, color } = await applyMasksToImage(
    img,
    processed.map((p) => ({ ...p, score: p.score ?? 0 })),
    W,
    H,
  );

  return {
    dataUrl: canvas.toDataURL("image/png"),
    blob: new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png")),
    labels,
    color,
  };
}
