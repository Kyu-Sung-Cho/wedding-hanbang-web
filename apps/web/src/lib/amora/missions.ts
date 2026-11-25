import { CHECKLIST_MAP } from "@/constants/checklists";
import { groupChecklistItems } from "@hanbang/shared/constants";
import { sortAmoraActions, type AmoraActionItem } from "@/lib/amora/actions";
import { stripWeddingBasePath } from "@/lib/weddingPaths";
import type { ProgressItem } from "@/types/database.types";
import { getChecklistCounts, isStatusDeclared, mergeChecklist, resolveStatus } from "@/utils/checklist";
import { isValidScheduleYmd } from "@/utils/scheduleEvents";

// 단계 상태는 체크리스트에서 파생한다. 별도 완료 기록이나 선행 잠금은 만들지 않는다.
export const MISSION_GROUPS = [
  { id: "family", label: "상견례 준비", shortLabel: "상견례", categoryKeys: ["greeting", "meeting"] },
  { id: "contracts", label: "예산·업체 확정", shortLabel: "예산·업체", categoryKeys: ["venue", "studio", "dress", "makeup", "ring"] },
  { id: "invitations", label: "청첩장·하객", shortLabel: "청첩장", categoryKeys: ["invitation", "gift"] },
  { id: "ceremony", label: "촬영·본식 준비", shortLabel: "본식 준비", categoryKeys: ["snap", "shoes", "bouquet", "mc", "hanbok", "yedan", "ham", "pyebaek"] },
  { id: "newlywed", label: "신혼여행·혼인신고", shortLabel: "신혼 준비", categoryKeys: ["honeymoon", "houseware", "housing", "registration"] },
] as const;

export interface MissionGroup {
  id: string;
  label: string;
  shortLabel: string;
  done: number;
  total: number;
  declaredCompleted: number;
  completedCategories: number;
  applicableCategories: number;
  excludedCategories: number;
  categories: MissionCategory[];
  state: "done" | "current" | "upcoming" | "skipped" | "unknown";
  href: string;
}

export interface MissionCategory {
  key: string;
  label: string;
  status: ProgressItem["status"];
  declared: boolean;
  done: number;
  total: number;
  nextItem: string | null;
}

export interface AmoraMissionCard {
  id: string;
  kind: "action" | "checklist";
  title: string;
  description: string;
  dueDate?: string;
  categoryKey?: string;
  badge: string;
  counts: { done: number; total: number } | null;
  href: string;
  cta: string;
}

const CHAT_DRAFT_HREF = `/chat?source=amora_missions&prefill=${encodeURIComponent("함께 남긴 준비 할 일을 살펴보고 다음에 확인할 것을 정리해 줘.")}`;
const MISSION_DESTINATIONS = new Set(["/chat", "/chat/board", "/checklist", "/budget", "/schedule", "/vendors", "/lounge", "/quote-check"]);
/**
 * 2026-11-22 견적 확인을 커뮤니티 밖(`/wedding/quote-check`)으로 옮겼다. 그 전에 아모라가 저장한
 * 할 일 링크(`/wedding/community/quote-check`)도 새 주소로 읽는다.
 */
const LEGACY_MISSION_DESTINATIONS: ReadonlyMap<string, string> = new Map([
  ["/community/quote-check", "/quote-check"],
]);

export function getMissionActionHref(action: AmoraActionItem): string {
  const raw = action.href;
  if (raw && raw.startsWith("/") && !raw.startsWith("//") && !/[\\\u0000-\u0020]/u.test(raw)) {
    try {
      const url = new URL(raw, "https://hanbang.invalid");
      const storedRoute = stripWeddingBasePath(url.pathname);
      const route = LEGACY_MISSION_DESTINATIONS.get(storedRoute) ?? storedRoute;
      if (url.origin === "https://hanbang.invalid" && MISSION_DESTINATIONS.has(route)) {
        return `${route}${url.search}${url.hash}`;
      }
    } catch {
      // 오래된 저장 링크가 깨져 있어도 실제 준비 화면으로 이어 간다.
    }
  }
  if (action.categoryKey && CHECKLIST_MAP[action.categoryKey]) {
    return `/checklist?category=${encodeURIComponent(action.categoryKey)}`;
  }
  return CHAT_DRAFT_HREF;
}

function actionCard(action: AmoraActionItem): AmoraMissionCard {
  const href = getMissionActionHref(action);
  return {
    id: action.id,
    kind: "action",
    title: action.title,
    description: action.description || "함께 저장한 할 일이에요. 연결된 화면에서 내용을 확인하고 이어가세요.",
    ...(typeof action.dueDate === "string" && action.dueDate.trim() ? { dueDate: action.dueDate } : {}),
    categoryKey: action.categoryKey,
    badge: action.status === "done" ? "완료한 공유 할 일" : action.priority === "high" ? "중요한 공유 할 일" : "공유 할 일",
    counts: null,
    href,
    cta: href.startsWith("/chat?") ? "대화 초안 열기" : "이어서 확인하기",
  };
}

function sortMissionOpenActions(actions: readonly AmoraActionItem[]): AmoraActionItem[] {
  const priorities = { high: 0, medium: 1, low: 2 };
  return actions.filter(action => action.status === "open").sort((a, b) => {
    const priority = priorities[a.priority] - priorities[b.priority];
    if (priority) return priority;
    const dateA = isValidScheduleYmd(a.dueDate) ? a.dueDate : null;
    const dateB = isValidScheduleYmd(b.dueDate) ? b.dueDate : null;
    // 자유 예정일은 해석하지 않는다. 날짜 유무를 먼저 묶어 모든 입력 순서에서 비교가 일관되게 한다.
    const dateGroup = Number(dateA === null) - Number(dateB === null);
    if (dateGroup) return dateGroup;
    const dateOrder = dateA !== null && dateB !== null ? dateA.localeCompare(dateB) : 0;
    if (dateOrder) return dateOrder;
    const createdA = Date.parse(a.createdAt);
    const createdB = Date.parse(b.createdAt);
    const createdOrder = (Number.isFinite(createdB) ? createdB : 0) - (Number.isFinite(createdA) ? createdA : 0);
    return createdOrder || a.id.localeCompare(b.id);
  });
}

export function buildAmoraMissionModel(
  progress: Readonly<Record<string, ProgressItem>> | null,
  actions: readonly AmoraActionItem[],
) {
  const categories = MISSION_GROUPS.flatMap((group) => group.categoryKeys.map((key) => {
    const template = CHECKLIST_MAP[key];
    const saved = progress?.[key];
    return {
      key, groupId: group.id, template,
      status: resolveStatus(template.items, saved),
      declared: isStatusDeclared(saved),
      items: mergeChecklist(template.items, saved?.checklist),
    };
  }));
  const activeCategories = categories.filter((item) => item.status === "in_progress" || item.status === "not_started");
  const nextCategory = activeCategories.find((item) => item.status === "in_progress") ?? activeCategories[0];
  const currentGroupId = progress ? nextCategory?.groupId ?? null : null;
  const groups: MissionGroup[] = MISSION_GROUPS.map((group) => {
    const members = categories.filter((item) => item.groupId === group.id);
    const applicable = members.filter((item) => item.status !== "not_applicable");
    const completedCategories = progress ? applicable.filter((item) => item.status === "completed").length : 0;
    const done = progress ? applicable.reduce((sum, item) => sum + getChecklistCounts(item.items).done, 0) : 0;
    const total = progress ? applicable.reduce((sum, item) => sum + item.items.length, 0) : 0;
    const target = applicable.find((item) => item.status === "in_progress")
      ?? applicable.find((item) => item.status === "not_started") ?? applicable[0];
    return {
      id: group.id, label: group.label, shortLabel: group.shortLabel, done, total,
      declaredCompleted: applicable.filter((item) => item.declared && item.status === "completed").length,
      completedCategories,
      applicableCategories: progress ? applicable.length : 0,
      excludedCategories: progress ? members.length - applicable.length : 0,
      categories: members.map((item) => ({
        key: item.key, label: item.template.label, status: item.status, declared: item.declared,
        done: progress ? getChecklistCounts(item.items).done : 0,
        total: progress ? item.items.length : 0,
        nextItem: progress && ["not_started", "in_progress"].includes(item.status)
          ? groupChecklistItems(item.key, item.items).flatMap((part) => part.items).find((entry) => !entry.done)?.label ?? null
          : null,
      })),
      state: !progress ? "unknown" : applicable.length === 0 ? "skipped" : completedCategories === applicable.length ? "done" : currentGroupId === group.id ? "current" : "upcoming",
      href: `/checklist?category=${target?.key ?? group.categoryKeys[0]}`,
    };
  });

  const sortedActions = sortAmoraActions([...actions]);
  const openActions = sortMissionOpenActions(actions);
  const coveredCategories = new Set(openActions.map((item) => item.categoryKey));
  const candidates = [...activeCategories]
    .filter((item) => !coveredCategories.has(item.key))
    .sort((a, b) => Number(b.status === "in_progress") - Number(a.status === "in_progress"));
  const cards = openActions.slice(0, progress && candidates.length ? 1 : 2).map(actionCard);
  if (progress) {
    for (const category of candidates) {
      if (cards.length >= 2) break;
      const nextItem = groupChecklistItems(category.key, category.items).flatMap((part) => part.items).find((item) => !item.done);
      cards.push({
        id: `checklist-${category.key}`, kind: "checklist", categoryKey: category.key,
        title: `${category.template.label} 준비 이어가기`,
        description: nextItem ? `다음에 확인할 항목: ${nextItem.label}` : category.template.tip,
        badge: category.declared ? "분야를 준비 중으로 표시" : "체크리스트에서 제안",
        counts: category.declared ? null : getChecklistCounts(category.items),
        href: `/checklist?category=${category.key}`, cta: "체크리스트 열기",
      });
    }
  }
  const doneActions = sortedActions.filter((item) => item.status === "done");
  return {
    hasChecklistData: progress !== null,
    groups, currentGroupId, cards,
    recommendation: progress && nextCategory ? {
      groupId: nextCategory.groupId, categoryKey: nextCategory.key,
      reason: nextCategory.status === "in_progress"
        ? "이미 진행 중인 분야부터 이어갈 수 있게 골랐어요."
        : "아직 시작하지 않은 분야 중 준비 순서상 앞선 곳이에요.",
    } : null,
    completedCard: doneActions[0] ? actionCard(doneActions[0]) : null,
    loadedDoneCount: doneActions.length,
  };
}
