import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { suggestOutfits, type StylistResult } from "@/lib/stylist.functions";
import { listWardrobe, type WardrobeItem } from "@/lib/wardrobe";

const IDEAS = ["Beach wedding", "First date", "Office day", "Concert night", "Brunch"];

export default function StylistSearch() {
  const run = useServerFn(suggestOutfits);
  const [occasion, setOccasion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<StylistResult | null>(null);
  const [pieces, setPieces] = useState<Record<string, WardrobeItem>>({});

  const search = async (value: string) => {
    const query = value.trim();
    if (!query || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const wardrobe = await listWardrobe();
      if (wardrobe.length === 0) {
        toast.error("Scan a few pieces into your wardrobe first.");
        return;
      }
      setPieces(Object.fromEntries(wardrobe.map((w) => [w.id, w])));
      setResult(
        await run({
          data: {
            occasion: query,
            wardrobe: wardrobe.map(({ id, name, anchor, color, style, formality }) => ({
              id,
              name: [name, style, formality].filter(Boolean).join(" · ").slice(0, 80),
              anchor,
              color,
            })),
          },
        }),
      );
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Couldn't style that occasion.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search(occasion);
        }}
        className="glass flex items-center gap-2 rounded-full p-2"
      >
        <input
          value={occasion}
          onChange={(e) => setOccasion(e.target.value)}
          maxLength={120}
          placeholder="Type an occasion — “rooftop dinner in Goa”"
          aria-label="Occasion"
          className="min-w-0 flex-1 bg-transparent px-4 py-2 text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {loading ? "Styling…" : "Style me"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {IDEAS.map((idea) => (
          <button
            key={idea}
            onClick={() => {
              setOccasion(idea);
              void search(idea);
            }}
            className="rounded-full border border-border px-4 py-1.5 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-foreground"
          >
            {idea}
          </button>
        ))}
      </div>

      {result && (
        <div className="lux-fade grid gap-4">
          {result.summary && <p className="text-sm text-muted-foreground">{result.summary}</p>}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {result.outfits.map((outfit) => (
              <article key={outfit.title} className="glass flex flex-col rounded-3xl p-5">
                <h3 className="text-base font-medium">{outfit.title}</h3>
                <div className="mt-4 flex gap-2">
                  {outfit.pieceIds.map((id) => {
                    const piece = pieces[id];
                    if (!piece) return null;
                    return (
                      <img
                        key={id}
                        src={piece.signedUrl}
                        alt={piece.name}
                        loading="lazy"
                        className="h-16 w-16 rounded-xl object-contain"
                        style={{ backgroundColor: `${piece.color}22` }}
                      />
                    );
                  })}
                </div>
                <dl className="mt-4 grid gap-2 text-xs text-muted-foreground">
                  <div>
                    <dt className="uppercase tracking-[0.18em]">Colour</dt>
                    <dd className="mt-1 text-foreground/80">{outfit.colorStory}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.18em]">Fit</dt>
                    <dd className="mt-1 text-foreground/80">{outfit.fitNotes}</dd>
                  </div>
                  {outfit.missingPiece && (
                    <div>
                      <dt className="uppercase tracking-[0.18em]">Add next</dt>
                      <dd className="mt-1 text-foreground/80">{outfit.missingPiece}</dd>
                    </div>
                  )}
                </dl>
                <a
                  href={outfit.pinterestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 text-sm text-primary underline-offset-4 hover:underline"
                >
                  Pinterest inspiration →
                </a>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
