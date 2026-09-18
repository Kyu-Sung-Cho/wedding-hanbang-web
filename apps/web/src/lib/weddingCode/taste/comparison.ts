import { summarizeWeddingTaste } from "./summary";
import type { WeddingTasteDraftV1 } from "./types";

export interface WeddingTasteComparisonRow {
  key: string;
  label: string;
  first: string;
  second: string;
  status: "same_selection" | "different_selection" | "needs_confirmation";
}
export function compareWeddingTastes(first: WeddingTasteDraftV1, second: WeddingTasteDraftV1): WeddingTasteComparisonRow[] {
  const a = summarizeWeddingTaste(first);
  const b = summarizeWeddingTaste(second);
  return a.map(row => {
    const other = b.find(item => item.key === row.key);
    return {
      key: row.key, label: row.label, first: row.value, second: other?.value ?? "답하지 않았어요",
      status: row.state !== "answered" || other?.state !== "answered" ? "needs_confirmation"
        : row.value === other.value ? "same_selection" : "different_selection",
    };
  });
}
