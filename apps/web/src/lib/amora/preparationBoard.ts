import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import type { AmoraActionItem, AmoraActionSource, AmoraActionStatus } from "./actions";
import { weddingPath } from "@/lib/weddingPaths";

export const PREPARATION_COLUMNS: ReadonlyArray<{ status: AmoraActionStatus; label: string; rule: string; dot: string }> = [
  { status: "done", label: "완료", rule: "완료로 표시한 할 일이에요.", dot: "bg-[var(--amora-sage)]" },
  { status: "open", label: "진행 중", rule: "아직 완료하지 않은 할 일이에요. 준비가 끝나면 완료로 표시해 주세요.", dot: "bg-[var(--amora-rose)]" },
  { status: "dismissed", label: "보류·숨김", rule: "숨겨 둔 할 일이에요. 필요할 때 다시 진행 중으로 옮길 수 있어요.", dot: "bg-[var(--amora-danger)]" },
];

export const PREPARATION_SOURCES: Record<AmoraActionSource, string> = {
  chat: "대화에서 추가된 할 일", quote: "견적 확인에서 추가된 할 일", schedule: "일정에서 추가된 할 일",
  budget: "예산에서 추가된 할 일", guardrail: "준비 점검에서 추가된 할 일", manual: "직접 추가한 할 일",
};

/** 명시적인 체험 모드에서만 사용한다. API 실패의 대체 데이터가 아니다. */
export const DEMO_PREPARATION_ACTIONS: AmoraActionItem[] = ([
  { id: "demo-board-budget", title: "예식장 예산 상한을 정리하기", description: "식대와 대관료를 예산표에 나눠 적었어요.", status: "done", categoryKey: "venue", source: "budget", href: "/budget" },
  { id: "demo-board-meeting", title: "양쪽 부모님 첫 식사 장소 확인하기", description: "참석 인원과 이동 거리를 확인하고 장소를 정리했어요.", status: "done", categoryKey: "meeting", source: "manual", href: "/checklist?category=meeting" },
  { id: "demo-board-makeup", title: "이른 시간·출장 추가 비용 확인하기", description: "업체에 서면으로 물어보고, 답변이 오면 다시 살펴보기로 했어요.", status: "open", categoryKey: "makeup", source: "chat", href: "/chat" },
  { id: "demo-board-unsorted", title: "친구에게 사회를 부탁할지 이야기하기", description: "부탁할 사람과 진행 방식을 먼저 맞춰 보려고 해요.", status: "open", source: "chat", href: "/chat" },
  { id: "demo-board-honeymoon", title: "신혼여행 후보와 예산 범위 정리하기", description: "예식장 일정이 정해진 뒤 다시 이야기하기로 했어요.", status: "dismissed", categoryKey: "honeymoon", source: "manual", href: "/checklist?category=honeymoon" },
  { id: "demo-board-invitation", title: "종이 초대장을 보낼 분들 정리하기", description: "하객 명단이 정리되면 다시 꺼내 볼 할 일이에요.", status: "dismissed", categoryKey: "invitation", source: "manual", href: "/checklist?category=invitation" },
] satisfies Array<Omit<AmoraActionItem, "priority" | "createdAt" | "updatedAt">>)
  .map((action) => ({ ...action, priority: "medium", createdAt: "2026-08-29T00:00:00Z", updatedAt: "2026-08-29T00:00:00Z" }));

export function preparationCategory(key: string | undefined) {
  return CATEGORY_CHECKLISTS.find((category) => category.key === key);
}

export function filterPreparationActions(actions: AmoraActionItem[], category: string, query: string) {
  const needle = query.trim().toLocaleLowerCase("ko");
  return actions.filter((action) => {
    const template = preparationCategory(action.categoryKey);
    if (category === "unsorted" ? !!template : category !== "all" && template?.key !== category) return false;
    return !needle || [action.title, action.description, template?.label].some((text) => text?.toLocaleLowerCase("ko").includes(needle));
  });
}

export function preparationActionHref(href: string | undefined): string | null {
  // 레거시 기록도 렌더링하므로 API의 저장 시 검증만 믿지 않는다.
  if (!href || !href.startsWith("/") || href.startsWith("//") || /[\\\u0000-\u0020]/u.test(href)) return null;
  return weddingPath(href);
}

export function preparationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(date);
}
