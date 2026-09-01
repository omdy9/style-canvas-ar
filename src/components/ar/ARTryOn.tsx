import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { drawGarment } from "./drawImage";
import { captureGarment } from "./capture";
import { detectGarment, type ClothingCheck } from "./presence";
import { Upload, Sparkles, Loader2, SwitchCamera } from "lucide-react";
import { segmentClothingFromFile, isHFConfigured } from "./hfSegment";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  ANCHORS,
  ANCHOR_LABEL,
  addWardrobeItem,
  deleteWardrobeItem,
  listWardrobe,
  type Anchor,
  type WardrobeItem,
} from "@/lib/wardrobe";

type Status = "idle" | "loading" | "live" | "error";
type Mode = "wear" | "scan";
type Pending = { dataUrl: string; blob: Blob; color: string } | null;

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export default function ARTryOn() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<{
    detectForVideo: (v: HTMLVideoElement, t: number) => any;
    close: () => void;
  } | null>(null);
  const lastClassifyRef = useRef(0);
  const stableHitsRef = useRef(0);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const wornRef = useRef<WardrobeItem[]>([]);
  const modeRef = useRef<Mode>("wear");
  const pendingRef = useRef<Pending>(null);
  const latestPoseRef = useRef<Array<{ x: number; y: number; visibility?: number }> | null>(null);

  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [worn, setWorn] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("wear");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [tracking, setTracking] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [garmentCheck, setGarmentCheck] = useState<ClothingCheck | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAnchor, setDraftAnchor] = useState<Anchor>("torso");
  const [saving, setSaving] = useState(false);
  const [processingUpload, setProcessingUpload] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const isMobile = useIsMobile();
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const facingRef = useRef<"user" | "environment">("user");
  const mirrored = facing === "user";


  const wornItems = useMemo(() => items.filter((i) => worn.has(i.id)), [items, worn]);

  useEffect(() => {
    wornRef.current = wornItems;
  }, [wornItems]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const refresh = useCallback(async () => {
    try {
      setItems(await listWardrobe());
    } catch (err) {
      console.error(err);
      toast.error("Couldn't load your wardrobe.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Preload garment images for the overlay.
  useEffect(() => {
    for (const item of items) {
      if (!item.signedUrl || imageCache.current.has(item.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = item.signedUrl;
      imageCache.current.set(item.id, img);
    }
  }, [items]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const v = videoRef.current;
    (v?.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    stableHitsRef.current = 0;
    setGarmentCheck(null);
    setStatus("idle");
    setTracking(false);
  }, []);

  useEffect(() => stop, [stop]);

  const scan = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setScanning(true);
    try {
      const result = captureGarment(
        video,
        latestPoseRef.current ?? undefined,
        facingRef.current === "user",
      );
      const blob = await result.blob;
      if (!blob) return;
      setPending({ dataUrl: result.dataUrl, blob, color: result.color });
      setDraftName("");
    } finally {
      setScanning(false);
    }
  }, []);


  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessingUpload(true);
    const usingAI = isHFConfigured();
    const toastId = toast.loading(
      usingAI
        ? "AI is detecting and segmenting the garment…"
        : "Processing image and extracting garment…"
    );

    try {
      if (usingAI) {
        // ── AI path: Hugging Face SegFormer ─────────────────────────────
        const result = await segmentClothingFromFile(file);
        const blob = await result.blob;
        if (!blob) throw new Error("AI could not extract the garment.");

        const label = result.labels.length
          ? result.labels.map((l) => l.replace(/-/g, " ")).join(", ")
          : "garment";

        setPending({ dataUrl: result.dataUrl, blob, color: result.color });
        setDraftName(file.name.replace(/\.[^/.]+$/, ""));
        toast.success(`Detected: ${label}`, { id: toastId });
      } else {
        // ── Fallback path: colour flood-fill ────────────────────────────
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load image."));
        });
        const result = captureGarment(img, undefined, false);
        const blob = await result.blob;
        URL.revokeObjectURL(url);
        if (!blob) throw new Error("Could not extract garment from the image.");
        setPending({ dataUrl: result.dataUrl, blob, color: result.color });
        setDraftName(file.name.replace(/\.[^/.]+$/, ""));
        toast.success("Garment captured!", { id: toastId });
      }
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof Error ? err.message : "Failed to process image.",
        { id: toastId }
      );
    } finally {
      setProcessingUpload(false);
      e.target.value = "";
    }
  };

  const start = useCallback(async (which: "user" | "environment" = facingRef.current) => {
    setStatus("loading");
    setMessage("Warming up the mirror…");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          window.isSecureContext === false
            ? "Camera needs a secure (https) connection on mobile."
            : "This browser doesn't support camera access.",
        );
      }

      // Stop any stream still held from a previous session / camera flip.
      const prev = videoRef.current?.srcObject as MediaStream | null;
      prev?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
      const makeLandmarker = (delegate: "GPU" | "CPU") =>
        vision.PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: "VIDEO",
          numPoses: 1,
        });
      try {
        landmarkerRef.current = (await makeLandmarker("GPU")) as never;
      } catch (gpuErr) {
        // Many mobile browsers have no usable WebGPU/WebGL delegate.
        console.warn("GPU delegate unavailable, falling back to CPU", gpuErr);
        landmarkerRef.current = (await makeLandmarker("CPU")) as never;
      }

      facingRef.current = which;
      setFacing(which);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: which },
            width: { ideal: isMobile ? 720 : 1280 },
            height: { ideal: isMobile ? 1280 : 720 },
            frameRate: { ideal: isMobile ? 24 : 30 },
          },
          audio: false,
        });
      } catch {
        // Some phones reject resolution hints — retry with the bare minimum.
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      const video = videoRef.current!;
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      if (video.readyState < 1) {
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          video.addEventListener("loadedmetadata", done, { once: true });
          setTimeout(done, 4000);
        });
      }
      try {
        await video.play();
      } catch (playErr) {
        console.warn("Autoplay blocked, retrying", playErr);
        await video.play().catch(() => undefined);
      }
      setStatus("live");
      setMessage("");

      // Throttle pose inference on phones — every frame melts mid-range GPUs.
      const minFrameGap = isMobile ? 1000 / 20 : 0;
      let last = -1;
      let trackedNow = false;
      const loop = () => {
        const canvas = canvasRef.current;
        const lmk = landmarkerRef.current;
        if (!canvas || !lmk || video.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const ts = performance.now();
        if (modeRef.current === "wear" && ts - last >= minFrameGap && ts !== last) {
          last = ts;
          const pose = lmk.detectForVideo(video, ts)?.landmarks?.[0];
          latestPoseRef.current = pose ?? null;
          if (Boolean(pose) !== trackedNow) {
            trackedNow = Boolean(pose);
            setTracking(trackedNow);
          }

          if (pose) {
            const px = pose.map((p: { x: number; y: number; visibility?: number }) => ({
              x: p.x * canvas.width,
              y: p.y * canvas.height,
              visibility: p.visibility,
            }));
            for (const item of wornRef.current) {
              const img = imageCache.current.get(item.id);
              if (img?.complete && img.naturalWidth) {
                drawGarment(ctx, img as never, item.anchor, px);
              }
            }
          }
        } else if (
          modeRef.current === "scan" &&
          ts - lastClassifyRef.current > (isMobile ? 350 : 200)
        ) {
          lastClassifyRef.current = ts;
          latestPoseRef.current = lmk.detectForVideo(video, ts)?.landmarks?.[0] ?? null;
          const check = detectGarment(video);
          setGarmentCheck(check);

          if (check.isClothing) stableHitsRef.current += 1;
          else stableHitsRef.current = 0;

          // ~750ms of a stable clothing read, nothing pending review yet → auto-scan.
          if (stableHitsRef.current >= 3 && !pendingRef.current) {
            stableHitsRef.current = 0;
            void scan();
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setMessage(
        err instanceof DOMException
          ? "Camera access was blocked. Allow the camera and try again."
          : "Couldn't start the AR mirror on this device.",
      );
    }
  }, [scan, isMobile]);

  const savePending = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await addWardrobeItem({
        name: draftName.trim() || "Untitled piece",
        anchor: draftAnchor,
        color: pending.color,
        blob: pending.blob,
      });
      setPending(null);
      await refresh();
      toast.success("Added to your wardrobe");
      setMode("wear");
    } catch (err) {
      console.error(err);
      toast.error("Couldn't save that piece.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: WardrobeItem) => {
    try {
      await deleteWardrobeItem(item);
      imageCache.current.delete(item.id);
      setWorn((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      await refresh();
    } catch (err) {
      console.error(err);
      toast.error("Couldn't remove that piece.");
    }
  };

  const toggleWorn = (id: string) =>
    setWorn((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const capture = () => {
    const video = videoRef.current;
    const overlay = canvasRef.current;
    if (!video || !overlay || capturing) return;
    setCapturing(true);
    // Let the spinner paint before the (blocking) canvas export.
    requestAnimationFrame(() => {
      try {
        const out = document.createElement("canvas");
        out.width = overlay.width;
        out.height = overlay.height;
        const ctx = out.getContext("2d")!;
        if (mirrored) {
          ctx.translate(out.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, out.width, out.height);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(overlay, 0, 0);
        setShot(out.toDataURL(isMobile ? "image/jpeg" : "image/png", 0.9));
      } finally {
        setCapturing(false);
      }
    });
  };


  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="glass sticky top-2 z-20 grid w-full grid-cols-2 rounded-full p-1 sm:static sm:inline-flex sm:w-fit sm:grid-cols-none">
        {(["wear", "scan"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`min-h-11 rounded-full px-5 py-2 text-sm transition ${
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {m === "wear" ? "Try on" : "Scan clothes"}
          </button>
        ))}
      </div>


      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="glass relative aspect-[3/4] min-w-0 overflow-hidden rounded-3xl sm:aspect-video">

          <video
            ref={videoRef}
            playsInline
            autoPlay
            muted
            disablePictureInPicture
            className={`absolute inset-0 h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
          />
          <canvas
            ref={canvasRef}
            className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
          />

          {status === "live" && (
            <button
              onClick={() => void start(facing === "user" ? "environment" : "user")}
              className="glass absolute right-3 top-3 z-10 flex min-h-11 min-w-11 items-center justify-center rounded-full px-3 text-xs font-medium"
              aria-label="Switch camera"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          )}


          {status === "live" && mode === "scan" && !pending && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div
                className={`aspect-square h-[70%] rounded-2xl border-2 border-dashed transition-colors ${
                  garmentCheck?.isClothing ? "border-emerald-400" : "border-primary/70"
                }`}
              />
              <div className="glass rounded-full px-4 py-1.5 text-xs">
                {garmentCheck?.isClothing
                  ? "Garment detected · holding steady…"
                  : "Hold a garment steady in the frame"}
              </div>
            </div>
          )}

          {status !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-background/70 px-6 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                {status === "loading" || status === "error"
                  ? message
                  : mode === "scan"
                    ? "Start the mirror to scan automatically, or upload an image of the garment."
                    : "Start the mirror, then step back and try on what's saved."}
              </p>
              <div className="flex w-full max-w-sm flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
                <button
                  onClick={() => void start(facingRef.current)}
                  disabled={status === "loading"}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {status === "loading"
                    ? "Preparing…"
                    : status === "error"
                      ? "Try again"
                      : "Start AR mirror"}
                </button>
                {mode === "scan" && (
                  <label
                    className={`min-h-12 rounded-full border px-7 py-3 text-sm font-medium transition cursor-pointer flex items-center justify-center gap-2 ${
                      isHFConfigured()
                        ? "border-primary/60 bg-primary/10 text-primary hover:bg-primary/20"
                        : "border-border bg-background hover:bg-secondary"
                    } ${processingUpload ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    {processingUpload ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isHFConfigured() ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    <span>
                      {processingUpload
                        ? "Processing…"
                        : isHFConfigured()
                          ? "AI detect garment"
                          : "Upload garment image"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleImageUpload(e)}
                      className="hidden"
                      disabled={processingUpload}
                    />
                  </label>
                )}
              </div>

            </div>
          )}

          {status === "live" && (
            <>
              {mode === "wear" && (
                <div className="glass absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
                  <span
                    className={`h-2 w-2 rounded-full ${tracking ? "bg-primary" : "bg-muted-foreground"}`}
                  />
                  {tracking ? "Body tracked" : "Searching for you…"}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-3 flex flex-wrap items-center justify-center gap-2 px-3 sm:bottom-4 sm:gap-3 sm:px-4">
                {mode === "wear" ? (
                  <button
                    onClick={capture}
                    disabled={capturing}
                    className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60 sm:flex-none sm:px-6"
                  >
                    {capturing && <Loader2 className="h-4 w-4 animate-spin" />}
                    {capturing ? "Capturing…" : "Capture look"}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => void scan()}
                      disabled={scanning}
                      className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60 sm:flex-none sm:px-6"
                    >
                      {scanning && <Loader2 className="h-4 w-4 animate-spin" />}
                      {scanning ? "Scanning…" : "Scan now"}
                    </button>
                    <label
                      className={`glass min-h-12 flex-1 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium transition hover:bg-secondary cursor-pointer flex items-center justify-center gap-1.5 sm:flex-none sm:px-6 ${
                        processingUpload ? "opacity-60 pointer-events-none" : ""
                      }`}
                    >
                      {processingUpload ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : isHFConfigured() ? (
                        <Sparkles className="h-4 w-4" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      <span>
                        {processingUpload
                          ? "Processing…"
                          : isHFConfigured()
                            ? "AI detect"
                            : "Upload image"}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handleImageUpload(e)}
                        className="hidden"
                        disabled={processingUpload}
                      />
                    </label>
                  </>
                )}
                <button
                  onClick={stop}
                  className="glass min-h-12 w-full rounded-full px-6 py-2.5 text-sm font-medium transition hover:bg-secondary sm:w-auto"
                >
                  Stop
                </button>
              </div>

            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {pending ? (
            <div className="glass lux-fade rounded-3xl p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                New piece
              </h2>
              <img
                src={pending.dataUrl}
                alt="Scanned garment preview"
                className="mt-4 aspect-square w-full rounded-2xl bg-secondary/50 object-contain"
              />
              <label className="mt-4 block text-xs text-muted-foreground" htmlFor="piece-name">
                Name
              </label>
              <input
                id="piece-name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={60}
                placeholder="Ivory linen shirt"
                className="mt-1 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <label className="mt-3 block text-xs text-muted-foreground" htmlFor="piece-anchor">
                Wears on
              </label>
              <select
                id="piece-anchor"
                value={draftAnchor}
                onChange={(e) => setDraftAnchor(e.target.value as Anchor)}
                className="mt-1 w-full rounded-xl border border-border bg-secondary/50 px-3 py-2 text-sm outline-none focus:border-primary"
              >
                {ANCHORS.map((a) => (
                  <option key={a} value={a}>
                    {ANCHOR_LABEL[a]}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button
                  onClick={savePending}
                  disabled={saving}
                  className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Saving…" : "Save to wardrobe"}
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="min-h-12 rounded-full border border-border px-5 py-2.5 text-sm transition hover:bg-secondary"
                >
                  Retake
                </button>
              </div>
            </div>
          ) : (
            <div className="glass min-w-0 rounded-3xl p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Wardrobe · {items.length}
              </h2>
              {items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nothing saved yet. Switch to “Scan clothes”, hold a garment inside the frame — it's
                  detected automatically and captured, or tap “Scan now” to grab it manually.
                </p>
              ) : (
                <div className="touch-carousel -mx-1 mt-4 flex w-[calc(100%+0.5rem)] max-w-[calc(100%+0.5rem)] snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">

                  {items.map((item) => {
                    const on = worn.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`w-32 shrink-0 snap-start sm:w-36 rounded-2xl border p-2 transition ${
                          on ? "border-primary/70 bg-primary/10" : "border-border bg-secondary/40"
                        }`}
                      >
                        <button onClick={() => toggleWorn(item.id)} className="w-full touch-manipulation text-left">
                          <img
                            src={item.signedUrl}
                            alt={item.name}
                            loading="lazy"
                            className="aspect-square w-full rounded-xl object-contain"
                            style={{ backgroundColor: `${item.color}22` }}
                          />
                          <span className="mt-2 block truncate text-xs">{item.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {item.anchor} · {on ? "worn" : "tap to wear"}
                          </span>
                        </button>
                        <button
                          onClick={() => remove(item)}
                          className="mt-2 min-h-9 w-full rounded-lg py-1 text-[11px] text-muted-foreground transition hover:text-destructive"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {shot && (
            <div className="glass lux-fade rounded-3xl p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Last capture
              </h2>
              <img src={shot} alt="Captured AR outfit" className="mt-4 rounded-2xl" />
              <a
                href={shot}
                download="stylear-look.png"
                className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
              >
                Download look
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
