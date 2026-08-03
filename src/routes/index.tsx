import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ARTryOn = lazy(() => import("@/components/ar/ARTryOn"));

const title = "StyleAR — See Your Style Before You Wear It";
const description =
  "Virtually try on clothing and accessories in real time with AR body tracking. Step in front of your camera and style your look instantly.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 opacity-60 [background:radial-gradient(60%_50%_at_50%_0%,oklch(0.75_0.12_85/0.16),transparent_70%)]" />
      <div className="relative mx-auto max-w-6xl px-5 py-10 sm:py-16">
        <header className="lux-fade flex items-center justify-between">
          <span className="text-lg font-semibold tracking-[0.3em]">
            STYLE<span className="gold-text">AR</span>
          </span>
          <span className="hidden text-xs uppercase tracking-[0.25em] text-muted-foreground sm:block">
            AR Try-On Prototype
          </span>
        </header>

        <section className="lux-fade mt-12 max-w-2xl">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            See your style
            <br />
            <span className="gold-text">before you wear it.</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            Hold a garment up to your camera and it's scanned into your wardrobe. Every saved piece
            joins the carousel below, ready to be worn on your body in real time with AR tracking.
          </p>
        </section>

        <section className="mt-10">
          <ClientOnly
            fallback={
              <div className="glass h-[520px] animate-pulse rounded-3xl" aria-hidden="true" />
            }
          >
            <Suspense
              fallback={
                <div className="glass h-[520px] animate-pulse rounded-3xl" aria-hidden="true" />
              }
            >
              <ARTryOn />
            </Suspense>
          </ClientOnly>
        </section>

        <footer className="mt-16 border-t border-border pt-6 text-xs text-muted-foreground">
          StyleAR — on-device pose tracking. No video ever leaves your browser.
        </footer>
      </div>
    </main>
  );
}
