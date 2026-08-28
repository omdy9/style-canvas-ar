import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ARTryOn = lazy(() => import("@/components/ar/ARTryOn"));

export const Route = createFileRoute("/mobile-check")({
  head: () => ({
    meta: [
      { title: "Mobile layout check — StyleAR" },
      { name: "description", content: "Internal mobile layout harness for the AR try-on screen." },
      { property: "og:title", content: "Mobile layout check — StyleAR" },
      { property: "og:description", content: "Internal mobile layout harness." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
        <ClientOnly fallback={null}>
          <Suspense fallback={null}>
            <ARTryOn />
          </Suspense>
        </ClientOnly>
      </div>
    </main>
  ),
});
