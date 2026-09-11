import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { weddingPath } from "@/lib/weddingPaths";

type PreparationDecisionCategory = {
  key: string;
  label: string;
  destination: { href: string; label: string } | null;
};

/** 결정의 저장 분류만 해석한다. 출처나 제목으로 체크리스트 분야를 추측하지 않는다. */
export const PREPARATION_DECISION_CATEGORIES: ReadonlyArray<PreparationDecisionCategory> = [
  ...CATEGORY_CHECKLISTS.map(({ key, label }) => ({
    key, label,
    destination: { href: weddingPath(`/checklist?category=${encodeURIComponent(key)}`), label: "분야 체크리스트 보기" },
  })),
  { key: "budget", label: "예산", destination: { href: weddingPath("/budget"), label: "예산 보기" } },
  { key: "schedule", label: "일정", destination: { href: weddingPath("/schedule"), label: "일정 보기" } },
  // 포괄적인 준비 기록에는 저장 분류만으로 특정 화면을 연결하지 않는다.
  { key: "plan", label: "준비 계획", destination: null },
  { key: "general", label: "일반 준비", destination: null },
];

export function preparationDecisionCategory(key: string | null | undefined) {
  return PREPARATION_DECISION_CATEGORIES.find(category => category.key === key);
}
