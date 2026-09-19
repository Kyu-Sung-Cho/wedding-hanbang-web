import { summarizeWeddingTaste } from "./summary";
import type { WeddingTasteDraft } from "./types";

export interface WeddingTasteComparisonRow {
  key: string;
  label: string;
  first: string;
  second: string;
  status: "same_selection" | "different_selection" | "needs_confirmation";
}
export function compareWeddingTastes(first: WeddingTasteDraft, second: WeddingTasteDraft): WeddingTasteComparisonRow[] {
  if (first.version !== second.version) throw new Error("같은 질문에 답한 취향만 비교할 수 있어요.");
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
