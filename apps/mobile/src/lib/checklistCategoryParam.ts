/**
 * 체크리스트를 **분야 하나로 바로 여는** 요청(`?category=venue`)을 읽는다.
 *
 * 웹 체크리스트는 이 쿼리로 그 분야 시트를 바로 연다(`ChecklistContent.tsx`). 앱 안 웹 화면
 * (예절 안내 편 끝의 「체크리스트에서 확인하기」 등)이 같은 주소로 링크하므로, 앱도 같은 값을
 * 받아 같은 분야를 연다.
 *
 * 받는 값은 **공유 체크리스트 분야 키뿐이다.** 주소는 누구나 만들 수 있으니 모르는 값·대소문자
 * 다른 값·예산 전용 분야(`reserve`)는 버리고 목록만 연다.
 */
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

const CATEGORY_KEYS: ReadonlySet<string> = new Set(
  CATEGORY_CHECKLISTS.map((category) => category.key),
);

/** 라우터 파라미터 한 칸을 분야 키로 읽는다. 여러 값이면 첫 값만 본다. 아니면 `null`. */
export function readChecklistCategoryParam(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && CATEGORY_KEYS.has(first) ? first : null;
}

/**
 * 웹 주소의 쿼리(`?category=…`)에서 분야 키를 읽는다. 깨진 퍼센트 인코딩은 React Native 의
 * `URLSearchParams` 가 던지므로 잡아서 `null` 로 둔다.
 */
export function checklistCategoryFromSearch(search: string): string | null {
  try {
    return readChecklistCategoryParam(new URLSearchParams(search).get("category"));
  } catch {
    return null;
  }
}

/** 앱 체크리스트 화면 주소. 분야가 있으면 그 분야 시트를 바로 연다. */
export function checklistRoute(category: string | null): string {
  return category ? `/checklist?category=${encodeURIComponent(category)}` : "/checklist";
}
