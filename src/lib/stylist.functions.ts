import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const PieceSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  anchor: z.string().max(20),
  color: z.string().max(9),
});

const InputSchema = z.object({
  occasion: z.string().min(2).max(120),
  wardrobe: z.array(PieceSchema).max(80),
});

export type StylistOutfit = {
  title: string;
  pieceIds: string[];
  colorStory: string;
  fitNotes: string;
  missingPiece: string;
  pinterestQuery: string;
  pinterestUrl: string;
};

export type StylistResult = {
  summary: string;
  outfits: StylistOutfit[];
};

const SYSTEM = `You are a senior fashion stylist. Given an occasion and a user's saved wardrobe
(each piece has an id, name, body anchor and dominant hex colour), compose 2-3 outfits using ONLY
the provided pieces. Judge colour harmony (complementary/analogous/neutral pairing), style coherence
and fit/silhouette balance. For each outfit also give one Pinterest search phrase that would surface
matching inspiration. Never invent piece ids.`;

export const suggestOutfits = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<StylistResult> => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("AI is not configured for this project.");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Occasion: ${data.occasion}\nWardrobe: ${JSON.stringify(data.wardrobe)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "outfit_suggestions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "outfits"],
              properties: {
                summary: { type: "string" },
                outfits: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "title",
                      "pieceIds",
                      "colorStory",
                      "fitNotes",
                      "missingPiece",
                      "pinterestQuery",
                    ],
                    properties: {
                      title: { type: "string" },
                      pieceIds: { type: "array", items: { type: "string" } },
                      colorStory: { type: "string" },
                      fitNotes: { type: "string" },
                      missingPiece: { type: "string" },
                      pinterestQuery: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Too many requests — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits are exhausted for this workspace.");
      console.error(`AI gateway failed [${res.status}]: ${body}`);
      throw new Error("The stylist is unavailable right now.");
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as StylistResult;
    const known = new Set(data.wardrobe.map((p) => p.id));

    return {
      summary: parsed.summary ?? "",
      outfits: (parsed.outfits ?? []).map((o) => ({
        ...o,
        pieceIds: (o.pieceIds ?? []).filter((id) => known.has(id)),
        pinterestUrl: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(
          o.pinterestQuery || `${data.occasion} outfit`,
        )}`,
      })),
    };
  });
