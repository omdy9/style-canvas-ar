/**
 * Lightweight garment classifier built on MediaPipe's image classifier.
 * Runs against the live video feed so "Scan clothes" mode only fires
 * when something clothing-like is actually in frame.
 */
import type { ImageClassifier } from "@mediapipe/tasks-vision";

type WasmFileset = { wasmLoaderPath: string; wasmBinaryPath: string };

const MODEL =
  "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite";

// ImageNet class names (the model's training labels) that correspond to
// wearable clothing/accessories. Anything outside this set is rejected.
export const CLOTHING_LABELS = new Set([
  "jersey",
  "T-shirt",
  "cardigan",
  "sweatshirt",
  "kimono",
  "miniskirt",
  "sarong",
  "poncho",
  "jean",
  "trench coat",
  "fur coat",
  "lab coat",
  "academic gown",
  "bow tie",
  "bikini",
  "brassiere",
  "cloak",
  "gown",
  "hoopskirt",
  "maillot",
  "tank suit",
  "military uniform",
  "overskirt",
  "pajama",
  "sweater",
  "swimming trunks",
  "wool",
  "vestment",
  "abaya",
  "apron",
  "bulletproof vest",
  "cuirass",
  "diaper",
  "feather boa",
  "gasmask",
  "hair slide",
  "hard hat",
  "mask",
  "mitten",
  "sandal",
  "ski mask",
  "sock",
  "sombrero",
  "suit",
  "sunglasses",
  "sunglass",
  "sweatband",
  "wig",
  "bonnet",
  "bathing cap",
  "cowboy boot",
  "cowboy hat",
  "crash helmet",
  "football helmet",
  "handkerchief",
  "Loafer",
  "running shoe",
  "shoe",
]);

export type ClothingCheck = { isClothing: boolean; label: string; score: number };

/** Creates the classifier, reusing a fileset already loaded by the caller. */
export async function loadClothingClassifier(fileset: WasmFileset): Promise<ImageClassifier> {
  const vision = await import("@mediapipe/tasks-vision");
  try {
    return await vision.ImageClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
      maxResults: 5,
      runningMode: "VIDEO",
    });
  } catch {
    // Some devices have no working GPU delegate — fall back to CPU.
    return vision.ImageClassifier.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      maxResults: 5,
      runningMode: "VIDEO",
    });
  }
}

const SCORE_THRESHOLD = 0.12;

type ClassifierResult = {
  classifications: { categories: { categoryName?: string; score?: number }[] }[];
};

export function evaluateClothing(result: ClassifierResult | undefined): ClothingCheck {
  const categories = result?.classifications?.[0]?.categories ?? [];
  if (categories.length === 0) return { isClothing: false, label: "", score: 0 };
  // Any of the top predictions may be the garment, so scan them all.
  const match = categories.find(
    (c) => (c.score ?? 0) >= SCORE_THRESHOLD && CLOTHING_LABELS.has(c.categoryName ?? ""),
  );
  const chosen = match ?? categories[0]!;
  return {
    isClothing: Boolean(match),
    label: chosen.categoryName ?? "",
    score: chosen.score ?? 0,
  };
}
