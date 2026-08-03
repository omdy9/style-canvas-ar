import { supabase } from "@/integrations/supabase/client";

export const ANCHORS = ["torso", "head", "face", "neck", "wrist", "legs"] as const;
export type Anchor = (typeof ANCHORS)[number];

export const ANCHOR_LABEL: Record<Anchor, string> = {
  torso: "Torso (tops, jackets)",
  head: "Head (hats, caps)",
  face: "Face (glasses)",
  neck: "Neck (chains, scarves)",
  wrist: "Wrist (watches, bands)",
  legs: "Legs (pants, skirts)",
};

export type WardrobeItem = {
  id: string;
  name: string;
  category: string;
  anchor: Anchor;
  color: string;
  image_url: string;
  created_at: string;
  signedUrl: string;
};

export async function listWardrobe(): Promise<WardrobeItem[]> {
  const { data, error } = await supabase
    .from("wardrobe_items")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage
    .from("wardrobe")
    .createSignedUrls(
      rows.map((r) => r.image_url),
      3600,
    );

  return rows.map((r, i) => ({
    ...(r as Omit<WardrobeItem, "signedUrl" | "anchor">),
    anchor: r.anchor as Anchor,
    signedUrl: signed?.[i]?.signedUrl ?? "",
  }));
}

export async function addWardrobeItem(input: {
  name: string;
  anchor: Anchor;
  color: string;
  blob: Blob;
}) {
  const path = `${crypto.randomUUID()}.png`;
  const up = await supabase.storage.from("wardrobe").upload(path, input.blob, {
    contentType: "image/png",
  });
  if (up.error) throw up.error;

  const { error } = await supabase.from("wardrobe_items").insert({
    name: input.name,
    category: input.anchor,
    anchor: input.anchor,
    color: input.color,
    image_url: path,
  });
  if (error) throw error;
}

export async function deleteWardrobeItem(item: WardrobeItem) {
  await supabase.storage.from("wardrobe").remove([item.image_url]);
  const { error } = await supabase.from("wardrobe_items").delete().eq("id", item.id);
  if (error) throw error;
}