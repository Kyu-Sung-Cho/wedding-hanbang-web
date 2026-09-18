import { preparationDecisionCategory as sharedDecisionCategory, type PreparationDecisionDestination } from "@hanbang/shared/preparation-decisions";
import { weddingPath } from "@/lib/weddingPaths";

/**
 * 분야 목록과 해석은 공용 계약(`@hanbang/shared/preparation-decisions`)이 정본이다.
 * 이 파일은 경로 없는 목적지 종류를 웹 주소(`/wedding/...`)로 바꾸는 얇은 어댑터다.
 */
function destinationHref(destination: PreparationDecisionDestination) {
  if (destination.kind === "checklist") return weddingPath(`/checklist?category=${encodeURIComponent(destination.category)}`);
  return weddingPath(destination.kind === "budget" ? "/budget" : "/schedule");
}

/** 결정의 저장 분류만 해석한다. 출처나 제목으로 체크리스트 분야를 추측하지 않는다. */
export function preparationDecisionCategory(key: string | null | undefined) {
  const category = sharedDecisionCategory(key);
  if (!category) return undefined;
  return {
    key: category.key, label: category.label,
    destination: category.destination ? { href: destinationHref(category.destination), label: category.destination.label } : null,
  };
}
