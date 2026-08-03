export type ItemId =
  | "sunglasses"
  | "cap"
  | "necklace"
  | "watch"
  | "tee"
  | "jacket"
  | "bag";

export type Item = {
  id: ItemId;
  name: string;
  anchor: string;
  kind: "accessory" | "garment";
  color: string;
};

export const ITEMS: Item[] = [
  { id: "sunglasses", name: "Aviator Shades", anchor: "Face", kind: "accessory", color: "#1b1b1b" },
  { id: "cap", name: "Wool Cap", anchor: "Head", kind: "accessory", color: "#111111" },
  { id: "necklace", name: "Gold Chain", anchor: "Neck", kind: "accessory", color: "#C9A227" },
  { id: "watch", name: "Chrono Watch", anchor: "Wrist", kind: "accessory", color: "#d8d8d8" },
  { id: "tee", name: "Essential Tee", anchor: "Torso", kind: "garment", color: "#f2efe6" },
  { id: "jacket", name: "Tailored Jacket", anchor: "Torso", kind: "garment", color: "#14161c" },
  { id: "bag", name: "Leather Tote", anchor: "Shoulder", kind: "accessory", color: "#6b4426" },
];