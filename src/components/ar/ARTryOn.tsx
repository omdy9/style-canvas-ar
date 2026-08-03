import { useCallback, useEffect, useRef, useState } from "react";
import { ITEMS, type ItemId } from "./items";
import { drawItem } from "./draw";

type Status = "idle" | "loading" | "live" | "error";

const WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export default function ARTryOn() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const landmarkerRef = useRef<{ detectForVideo: (v: HTMLVideoElement, t: number) => any; close: () => void } | null>(null);
  const selectedRef = useRef<Set<ItemId>>(new Set(["sunglasses", "tee", "watch"]));

  const [selected, setSelected] = useState<Set<ItemId>>(new Set(["sunglasses", "tee", "watch"]));
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [tracking, setTracking] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const toggle = (id: ItemId) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
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
      const landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      landmarkerRef.current = landmarker as never;

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
        if (ts !== last) {
          last = ts;
          const res = lmk.detectForVideo(video, ts);
          const pose = res?.landmarks?.[0];
          setTracking(Boolean(pose));
          if (pose) {
            const px = pose.map((p: { x: number; y: number; visibility?: number }) => ({
              x: p.x * canvas.width,
              y: p.y * canvas.height,
              visibility: p.visibility,
            }));
            for (const item of ITEMS) {
              if (selectedRef.current.has(item.id)) drawItem(ctx, item.id, item.color, px);
            }
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
  }, []);

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
    ctx.drawImage(overlay, 0, 0);
    setShot(out.toDataURL("image/png"));
  };

  return (
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

        {status !== "live" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-background/70 px-6 text-center">
            <p className="max-w-xs text-sm text-muted-foreground">
              {status === "loading"
                ? message
                : status === "error"
                  ? message
                  : "Step back about two metres so your head and hips are in frame, then start the mirror."}
            </p>
            <button
              onClick={start}
              disabled={status === "loading"}
              className="rounded-full bg-primary px-7 py-3 text-sm font-medium tracking-wide text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {status === "loading" ? "Preparing…" : status === "error" ? "Try again" : "Start AR mirror"}
            </button>
          </div>
        )}

        {status === "live" && (
          <>
            <div className="glass absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${tracking ? "bg-primary" : "bg-muted-foreground"}`}
              />
              {tracking ? "Body tracked" : "Searching for you…"}
            </div>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
              <button
                onClick={capture}
                className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
              >
                Capture look
              </button>
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
        <div className="glass rounded-3xl p-5">
          <h2 className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Wardrobe
          </h2>
          <ul className="mt-4 grid gap-2">
            {ITEMS.map((item) => {
              const on = selected.has(item.id);
              return (
                <li key={item.id}>
                  <button
                    onClick={() => toggle(item.id)}
                    aria-pressed={on}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                      on
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-secondary/40 hover:bg-secondary"
                    }`}
                  >
                    <span
                      className="h-7 w-7 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="flex-1">
                      <span className="block text-sm">{item.name}</span>
                      <span className="block text-xs text-muted-foreground">{item.anchor}</span>
                    </span>
                    <span className={`text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>
                      {on ? "On" : "Off"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

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
  );
}