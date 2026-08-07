/**
 * Clothing segmentation using the Hugging Face Inference API.
 *
 * Model: mattmdjaga/segformer_b2_clothes
 * Detects 18 clothing categories: hat, hair, sunglasses, top, skirt, pants,
 * dress, belt, shoe, bag, scarf, jacket, etc.
 *
 * Returns a cropped, background-removed PNG blob + dominant colour.
 */

const HF_TOKEN = import.meta.env.VITE_HUGGING_FACE_TOKEN as string | undefined;
const MODEL_ID = "mattmdjaga/segformer_b2_clothes";
const HF_API_URL = `https://api-inference.huggingface.co/models/${MODEL_ID}`;

// Labels we consider "clothing" (exclude background, skin, hair, face, etc.)
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

/** Convert a canvas/image blob to base64 data URI */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Call the Hugging Face Inference API with the given image blob.
 * Returns an array of segment objects: { label, score, mask }.
 */
async function callHFSegmentation(
  imageBlob: Blob,
): Promise<{ label: string; score: number; mask: string }[]> {
  if (!HF_TOKEN) throw new Error("VITE_HUGGING_FACE_TOKEN is not set.");

  const response = await fetch(HF_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      "Content-Type": imageBlob.type || "image/png",
    },
    body: imageBlob,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HF API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<{ label: string; score: number; mask: string }[]>;
}

/**
 * Given the source image element and the HF segmentation output,
 * composite all garment-category masks onto a transparent canvas and
 * crop to the tightest bounding box.
 */
function applyMasksToImage(
  src: HTMLImageElement,
  segments: { label: string; score: number; mask: string }[],
  W: number,
  H: number,
): { canvas: HTMLCanvasElement; labels: string[]; color: string } {
  const garmentSegs = segments.filter((s) => GARMENT_LABELS.has(s.label));
  const detectedLabels = garmentSegs.map((s) => s.label);

  // Start with the full source image on a canvas
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(src, 0, 0, W, H);
  const imageData = ctx.getImageData(0, 0, W, H);
  const pixels = imageData.data;

  // Build a combined garment mask across all garment segments
  const combinedMask = new Uint8Array(W * H);

  for (const seg of garmentSegs) {
    // The mask is a grayscale PNG encoded as base64 data URI
    const maskImg = new Image();
    maskImg.src = `data:image/png;base64,${seg.mask}`;

    // Draw the mask to a temporary canvas to read pixel data
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = W;
    maskCanvas.height = H;
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(maskImg, 0, 0, W, H);
    const maskData = mctx.getImageData(0, 0, W, H).data;

    for (let i = 0; i < W * H; i++) {
      // Mask is grayscale; white (255) = garment present
      if (maskData[i * 4]! > 128) {
        combinedMask[i] = 1;
      }
    }
  }

  // Apply mask: zero out alpha for non-garment pixels
  let minX = W,
    minY = H,
    maxX = 0,
    maxY = 0;
  let cr = 0,
    cg = 0,
    cb = 0,
    kept = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!combinedMask[i]) {
        pixels[i * 4 + 3] = 0; // transparent
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

  // Crop to the bounding box with 8px padding, square output
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
    octx.drawImage(canvas, bx, by, bw, bh, (512 - bw * scale) / 2, (512 - bh * scale) / 2, bw * scale, bh * scale);
  } else {
    octx.drawImage(canvas, 0, 0, W, H, 0, 0, 512, 512);
  }

  return { canvas: out, labels: detectedLabels, color };
}

/**
 * Main entry point.
 * Accepts a File (from <input type="file">) and returns the segmented garment.
 */
export async function segmentClothingFromFile(file: File): Promise<HFSegmentResult> {
  // 1. Load the image to get natural dimensions
  const objectUrl = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = objectUrl;
  });

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // 2. Convert image to a PNG blob for the API call
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = W;
  tempCanvas.height = H;
  tempCanvas.getContext("2d")!.drawImage(img, 0, 0);
  const pngBlob = await new Promise<Blob | null>((r) =>
    tempCanvas.toBlob(r, "image/png"),
  );
  URL.revokeObjectURL(objectUrl);

  if (!pngBlob) throw new Error("Failed to convert image to PNG.");

  // 3. Call the HF API
  const segments = await callHFSegmentation(pngBlob);

  // 4. Apply the garment masks
  const { canvas, labels, color } = applyMasksToImage(img, segments, W, H);

  const dataUrl = canvas.toDataURL("image/png");
  const blob = new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));

  return { dataUrl, blob, labels, color };
}

/** Whether the HF token is configured */
export function isHFConfigured(): boolean {
  return Boolean(HF_TOKEN);
}
