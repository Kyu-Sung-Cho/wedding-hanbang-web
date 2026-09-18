import { TASTE_AVOID_OPTIONS, TASTE_DOMAIN_OPTIONS, TASTE_DOMAIN_QUESTIONS, TASTE_MOOD_OPTIONS, TASTE_NEGOTIABILITY_OPTIONS } from "./constants";
import { parseWeddingTasteDraft } from "./validation";
import type { TasteSelection, WeddingTasteDraftV1, WeddingTasteSummaryRow } from "./types";

const STATUS_TEXT = { undecided: "아직 모르겠어요", no_preference: "어느 쪽도 괜찮아요", not_applicable: "이번 계획에는 없어요", skipped: "답하지 않았어요" } as const;
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
    row("priorityDomains", "먼저 이야기하고 싶은 것", draft.priorityDomains, TASTE_DOMAIN_OPTIONS),
    row("mood", "원하는 분위기", draft.mood, TASTE_MOOD_OPTIONS),
    ...TASTE_DOMAIN_OPTIONS.map(domain => row("detail:" + domain.value, domain.value === "guests" ? "원하는 하객 규모" : domain.label, draft.details[domain.value] ?? { status: "skipped" }, TASTE_DOMAIN_QUESTIONS[domain.value].options)),
    row("avoids", "피하고 싶은 것", draft.avoids, TASTE_AVOID_OPTIONS),
  ];
  if (draft.avoids.status === "no_preference") rows[rows.length - 1].value = "특별히 피하고 싶은 것은 없어요";
  if (draft.priorityDomains.status === "no_preference") rows[0].value = "딱히 없어요";
  for (const domain of TASTE_DOMAIN_OPTIONS) {
    const value = draft.negotiability[domain.value];
    const label = TASTE_NEGOTIABILITY_OPTIONS.find(option => option.value === value)?.label;
    rows.push({ key: "negotiability:" + domain.value, label: domain.label + " 의견이 다르면", value: label ?? "답하지 않았어요", state: value === undefined ? "skipped" : value === "undecided" ? "undecided" : "answered" });
  }
  return rows;
}
export function buildWeddingTasteAmoraText(draft: WeddingTasteDraftV1): string {
  const rows = summarizeWeddingTaste(draft).filter(row => row.state !== "skipped");
  return [
    "방금 고른 결혼식 취향이에요. 제가 고른 거고, 둘이 같이 정한 건 아니에요.",
    ...rows.map(row => row.label + ": " + row.value + "."),
    "먼저 이야기하고 싶다고 고른 게 돈을 더 쓰겠다는 뜻은 아니에요. 다른 안도 볼 수 있다고 한 것도 양보하겠다는 말은 아니고요.",
    "안 고른 부분은 넘겨짚지 말고, 다음에 둘이 얘기해 볼 질문을 하나 추천해 주세요. 예산이나 일정은 아직 바꾸지 말아 주세요.",
  ].join("\n");
}
