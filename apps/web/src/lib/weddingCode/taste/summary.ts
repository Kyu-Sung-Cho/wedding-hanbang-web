import { TASTE_AVOID_OPTIONS, TASTE_DOMAIN_OPTIONS, TASTE_DOMAIN_QUESTIONS, TASTE_MOOD_OPTIONS, TASTE_NEGOTIABILITY_OPTIONS } from "./constants";
import { parseWeddingTasteDraft } from "./validation";
import type { TasteSelection, WeddingTasteDraftV1, WeddingTasteSummaryRow } from "./types";

const STATUS_TEXT = { undecided: "아직 모르겠어요", no_preference: "어느 쪽도 괜찮아요", not_applicable: "이번 계획에는 없어요", skipped: "이번에 확인하지 않았어요" } as const;
function selectionText(selection: TasteSelection, options: readonly { value: string; label: string }[]): string {
  if (selection.status !== "answered") return STATUS_TEXT[selection.status];
  return options.filter(option => selection.values.includes(option.value)).map(option => option.label).join(" · ");
}
export function summarizeWeddingTaste(input: WeddingTasteDraftV1): WeddingTasteSummaryRow[] {
  const draft = parseWeddingTasteDraft(input);
  if (!draft) throw new Error("선택한 취향의 형식을 확인하지 못했어요.");
  const row = (key: string, label: string, response: TasteSelection, options: readonly { value: string; label: string }[]): WeddingTasteSummaryRow =>
    ({ key, label, value: selectionText(response, options), state: response.status });
  const rows = [
    row("priorityDomains", "특히 중요하게 이야기할 것", draft.priorityDomains, TASTE_DOMAIN_OPTIONS),
    row("mood", "원하는 분위기", draft.mood, TASTE_MOOD_OPTIONS),
    ...TASTE_DOMAIN_OPTIONS.map(domain => row("detail:" + domain.value, domain.value === "guests" ? "내가 원하는 규모" : domain.label, draft.details[domain.value] ?? { status: "skipped" }, TASTE_DOMAIN_QUESTIONS[domain.value].options)),
    row("avoids", "피하고 싶은 것", draft.avoids, TASTE_AVOID_OPTIONS),
  ];
  if (draft.avoids.status === "no_preference") rows[rows.length - 1].value = "특별히 피하고 싶은 것은 없어요";
  if (draft.priorityDomains.status === "no_preference") rows[0].value = "지금 우선순위를 나누지 않았어요";
  for (const domain of TASTE_DOMAIN_OPTIONS) {
    const value = draft.negotiability[domain.value];
    const label = TASTE_NEGOTIABILITY_OPTIONS.find(option => option.value === value)?.label;
    rows.push({ key: "negotiability:" + domain.value, label: domain.label + " · 맞춰볼 범위", value: label ?? "이번에 확인하지 않았어요", state: value === undefined ? "skipped" : value === "undecided" ? "undecided" : "answered" });
  }
  return rows;
}
export function buildWeddingTasteAmoraText(draft: WeddingTasteDraftV1): string {
  const rows = summarizeWeddingTaste(draft).filter(row => row.state !== "skipped");
  return [
    "내가 방금 고른 결혼식 취향이에요. 내 선택이며 두 사람의 공동 합의는 아니에요.",
    ...rows.map(row => row.label + ": " + row.value + "."),
    "중요한 항목은 더 지출하겠다는 뜻이 아니고, 다른 안을 함께 보는 것은 양보 약속이 아니에요.",
    "아직 확인하지 않은 취향은 추측하지 말고, 다음에 둘이 확인할 질문 하나를 도와주세요. 예산이나 일정은 지금 변경하지 마세요.",
  ].join("\n");
}
