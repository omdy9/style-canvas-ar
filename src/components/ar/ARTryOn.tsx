import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { drawGarment } from "./drawImage";
import { captureGarment } from "./capture";
import { loadClothingClassifier, evaluateClothing, type ClothingCheck } from "./classify";
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
  const classifierRef = useRef<Awaited<ReturnType<typeof loadClothingClassifier>> | null>(null);
  const lastClassifyRef = useRef(0);
  const stableHitsRef = useRef(0);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const wornRef = useRef<WardrobeItem[]>([]);
  const modeRef = useRef<Mode>("wear");
  const pendingRef = useRef<Pending>(null);

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
    classifierRef.current?.close();
    classifierRef.current = null;
    stableHitsRef.current = 0;
    setGarmentCheck(null);
    setStatus("idle");
    setTracking(false);
  }, []);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    setStatus("loading");
    setMessage("Warming up the mirror…");
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
      landmarkerRef.current = (await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      })) as never;
      classifierRef.current = await loadClothingClassifier(fileset);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setStatus("live");
      setMessage("");

      let last = -1;
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
        if (modeRef.current === "wear" && ts !== last) {
          last = ts;
          const pose = lmk.detectForVideo(video, ts)?.landmarks?.[0];
          setTracking(Boolean(pose));
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
          classifierRef.current &&
          ts - lastClassifyRef.current > 250
        ) {
          lastClassifyRef.current = ts;
          const result = classifierRef.current.classifyForVideo(video, ts);
          const check = evaluateClothing(result);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = async () => {
    const video = videoRef.current;
    if (!video) return;
    const result = captureGarment(video);
    const blob = await result.blob;
    if (!blob) return;
    setPending({ dataUrl: result.dataUrl, blob, color: result.color });
    setDraftName("");
  };

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
    if (!video || !overlay) return;
    const out = document.createElement("canvas");
    out.width = overlay.width;
    out.height = overlay.height;
    const ctx = out.getContext("2d")!;
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, out.width, out.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    setShot(out.toDataURL("image/png"));
  };

  return (
    <div className="grid gap-6">
      <div className="glass inline-flex w-fit rounded-full p-1">
        {(["wear", "scan"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-5 py-2 text-sm transition ${
              mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
            }`}
          >
            {m === "wear" ? "Try on" : "Scan clothes"}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="glass relative aspect-[3/4] overflow-hidden rounded-3xl sm:aspect-video">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
          />
          <canvas
            ref={canvasRef}
            className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1] object-cover"
          />

          {status === "live" && mode === "scan" && !pending && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div
                className={`aspect-square h-[70%] rounded-2xl border-2 border-dashed transition-colors ${
                  garmentCheck?.isClothing ? "border-emerald-400" : "border-primary/70"
                }`}
              />
              <div className="glass rounded-full px-4 py-1.5 text-xs">
                {garmentCheck?.isClothing
                  ? `Clothing detected · ${Math.round(garmentCheck.score * 100)}%`
                  : "Hold a garment steady in the frame"}
              </div>
            </div>
          )}

          {status !== "live" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-background/70 px-6 text-center">
              <p className="max-w-xs text-sm text-muted-foreground">
                {status === "loading" || status === "error"
                  ? message
                  : "Start the mirror, then scan a garment by holding it in the frame — or step back and try on what's saved."}
              </p>
              <button
                onClick={start}
                disabled={status === "loading"}
                className="rounded-full bg-primary px-7 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
              >
                {status === "loading"
                  ? "Preparing…"
                  : status === "error"
                    ? "Try again"
                    : "Start AR mirror"}
              </button>
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
              <div className="absolute inset-x-0 bottom-4 flex flex-wrap justify-center gap-3 px-4">
                {mode === "wear" ? (
                  <button
                    onClick={capture}
                    className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    Capture look
                  </button>
                ) : (
                  <button
                    onClick={scan}
                    className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                  >
                    Scan now
                  </button>
                )}
                <button
                  onClick={stop}
                  className="glass rounded-full px-6 py-2.5 text-sm font-medium transition hover:bg-secondary"
                >
                  Stop
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
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
              <div className="mt-4 flex gap-2">
                <button
                  onClick={savePending}
                  disabled={saving}
                  className="flex-1 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save to wardrobe"}
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="rounded-full border border-border px-5 py-2.5 text-sm transition hover:bg-secondary"
                >
                  Retake
                </button>
              </div>
            </div>
          ) : (
            <div className="glass rounded-3xl p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                Wardrobe · {items.length}
              </h2>
              {items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nothing saved yet. Switch to “Scan clothes”, hold a garment inside the frame — it's
                  detected automatically and captured, or tap “Scan now” to grab it manually.
                </p>
              ) : (
                <div className="-mx-1 mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2">
                  {items.map((item) => {
                    const on = worn.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`w-36 shrink-0 snap-start rounded-2xl border p-2 transition ${
                          on ? "border-primary/70 bg-primary/10" : "border-border bg-secondary/40"
                        }`}
                      >
                        <button onClick={() => toggleWorn(item.id)} className="w-full text-left">
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
                          className="mt-2 w-full rounded-lg py-1 text-[11px] text-muted-foreground transition hover:text-destructive"
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
