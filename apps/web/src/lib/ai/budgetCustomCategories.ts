/**
 * 사용자가 직접 만든 예산 항목("차량 이동", "사진 촬영 공간" 같은 것)을 읽는다.
 *
 * 아모라는 이 항목들을 **어디서도 보지 못했다.** 프롬프트의 카테고리 현황도
 * `get_budget_summary` 도 고정 20개(`CATEGORY_LABELS`)만 훑었기 때문이다.
 * 그래서 "차량 이동 예산 50만원으로 잡아줘" 로 항목을 만든 바로 다음 턴에
 * "차량 이동 예산 얼마였지?" 라고 물으면 모른다고 답하는데, **예산 화면에는
 * 그 항목이 멀쩡히 보인다**(2026-08-24 감사).
 *
 * 키 형식이 두 가지라는 점이 중요하다.
 *
 * - 아모라가 만든 것: `custom_<md5 24자>` (`customCategoryKey`)
 * - 예산 화면에서 만든 것: `custom_<타임스탬프>` (`BudgetContent.handleAddCategory`)
 *
 * 둘 다 사용자에게는 똑같은 예산 항목이다. 한쪽만 읽으면 화면과 다른 말을 하게
 * 되므로 `custom_` 접두사와 라벨만 보고 고른다.
 *
 * `__hidden` 은 고정 분야만 숨긴다. 사용자 항목 삭제는 키/금액 제거로 저장되므로
 * 저장된 사용자 항목에 남은 숨김 표시로 화면과 다른 합계를 만들지 않는다.
 */

export interface CustomBudgetCategory {
  key: string;
  label: string;
  value: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCustomBudgetCategoryKey(key: string): boolean {
  return key.startsWith("custom_") && key.length > "custom_".length;
}

export function listCustomBudgetCategories(
  progress: unknown,
): CustomBudgetCategory[] {
  if (!isRecord(progress)) return [];
  return Object.entries(progress)
    .filter(([key]) => isCustomBudgetCategoryKey(key))
    .flatMap(([key, value]) => {
      if (!isRecord(value)) return [];
      const label = typeof value.label === "string" ? value.label.trim() : "";
      if (label.length === 0) return [];
      return [{ key, label, value }];
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
