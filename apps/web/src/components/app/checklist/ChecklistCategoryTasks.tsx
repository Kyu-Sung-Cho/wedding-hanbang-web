"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ExternalLink,
  Lightbulb,
  RotateCcw,
} from "lucide-react";

import { CHECKLIST_MAP } from "@/constants/checklists";
import { getChecklistCategoryGuide } from "@hanbang/shared/checklist-guides";
import { getChecklistItemGuidance } from "@hanbang/shared/constants";
import { useAuthStore } from "@/stores/authStore";
import type { ChecklistItem, ProgressItem, WeddingJourney } from "@/types/database.types";
import {
  calculateStatus,
  getChecklistCounts,
  hasChecklistReviewEvidence,
  mergeChecklist,
} from "@/utils/checklist";
import type {
  PlanningChecklistAssignee,
  PlanningChecklistItemState,
} from "@hanbang/shared/utils";

const STATE_OPTIONS: ReadonlyArray<{
  value: PlanningChecklistItemState;
  label: string;
}> = [
  { value: "todo", label: "할 일" },
  { value: "in_progress", label: "진행 중" },
  { value: "waiting", label: "답변 기다림" },
  { value: "blocked", label: "막힘" },
  { value: "completed", label: "완료" },
  { value: "not_applicable", label: "해당 없음" },
];

const STATE_LABEL = Object.fromEntries(
  STATE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<PlanningChecklistItemState, string>;

function itemState(item: ChecklistItem): PlanningChecklistItemState {
  return item.state ?? (item.done ? "completed" : "todo");
}

function assigneeValue(assignee: PlanningChecklistAssignee | null | undefined) {
  if (!assignee) return "";
  if (assignee.kind === "couple") return "couple";
  if (assignee.kind === "external") return "external";
  return `member:${assignee.profileId}`;
}

function parseAssignee(value: string, externalLabel: string) {
  if (value === "couple") return { kind: "couple" } satisfies PlanningChecklistAssignee;
  if (value === "external") {
    const label = externalLabel.trim();
    return label ? { kind: "external", label } satisfies PlanningChecklistAssignee : undefined;
  }
  if (value.startsWith("member:")) {
    const profileId = value.slice("member:".length);
    return profileId
      ? { kind: "member", profileId } satisfies PlanningChecklistAssignee
      : undefined;
  }
  return undefined;
}

function completionActivity(
  item: ChecklistItem,
  viewer: { id: string; name: string } | null,
  partner: { id: string; name: string } | null,
) {
  if (!item.completedAt) return null;
  const date = new Date(item.completedAt);
  if (Number.isNaN(date.getTime())) return null;
  const completedBy = viewer && item.completedByProfileId === viewer.id
    ? viewer.name
    : partner && item.completedByProfileId === partner.id
      ? partner.name
      : "구성원";
  const safeName = completedBy.trim().replace(/님$/u, "") || "구성원";
  const displayDate = new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul",
  }).format(date);
  return `${safeName}님이 ${displayDate} 완료`;
}

function ChecklistItemEditor({
  item,
  categoryKey,
  disabled,
  viewer,
  partner,
  onSave,
}: {
  item: ChecklistItem;
  categoryKey: string;
  disabled: boolean;
  viewer: { id: string; name: string } | null;
  partner: { id: string; name: string } | null;
  onSave: (item: ChecklistItem) => void;
}) {
  const category = CHECKLIST_MAP[categoryKey];
  const categoryGuide = getChecklistCategoryGuide(categoryKey);
  const itemGuidance = getChecklistItemGuidance(item.id);
  const [state, setState] = useState<PlanningChecklistItemState>(itemState(item));
  const [assignee, setAssignee] = useState(assigneeValue(item.assignee));
  const [externalLabel, setExternalLabel] = useState(
    item.assignee?.kind === "external" ? item.assignee.label : "",
  );
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [note, setNote] = useState(item.note ?? "");

  const completionCriteria = itemGuidance?.completionCriteria
    ?? `${item.label}을 확인하고 두 사람이 결과나 증빙을 다시 찾을 수 있게 기록했어요.`;
  const tip = itemGuidance?.tip
    ?? categoryGuide?.tips[0]
    ?? category?.tip
    ?? "실제 일정과 계약 조건을 기준으로 확인하세요.";
  const caution = itemGuidance?.caution
    ?? categoryGuide?.cautions[0]
    ?? "가족·업체와 정한 실제 조건과 계약서가 기본 안내보다 우선해요.";
  const activity = completionActivity(item, viewer, partner);

  const save = () => {
    const done = state === "completed";
    const wasCompleted = itemState(item) === "completed";
    const next: ChecklistItem = {
      ...item,
      state,
      done,
    };
    if (!done) {
      next.completedAt = null;
      next.completedByProfileId = null;
    } else if (!wasCompleted) {
      const completedByProfileId = viewer?.id ?? null;
      next.completedAt = completedByProfileId ? new Date().toISOString() : null;
      next.completedByProfileId = completedByProfileId;
    }
    const nextAssignee = parseAssignee(assignee, externalLabel);
    next.assignee = nextAssignee ?? null;
    next.dueDate = dueDate || null;
    const trimmedNote = note
      .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
    next.note = trimmedNote;
    onSave(next);
  };

  return (
    <div className="border-t border-[#e7e0d5] bg-[#fcfaf5] px-4 py-5 sm:px-12" role="region" aria-label={`${item.label} 실행 정보`}>
      {activity && (
        <p className="mb-4 inline-flex rounded-full bg-[#eef4ed] px-3 py-1.5 text-[11.5px] font-semibold text-[#36534e]">
          {activity}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-[12px] font-semibold text-[#53615c]">
          상태
          <select
            value={state}
            disabled={disabled}
            onChange={(event) => setState(event.target.value as PlanningChecklistItemState)}
            aria-label={`${item.label} 상태`}
            className="mt-1.5 h-11 w-full rounded-[12px] border border-[#d9d1c2] bg-white px-3 text-[14px] font-medium text-[#243832] outline-none focus:border-[#36534e] focus:ring-2 focus:ring-[#36534e]/15 disabled:opacity-50"
          >
            {STATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>

        <label className="text-[12px] font-semibold text-[#53615c]">
          담당자
          <select
            value={assignee}
            disabled={disabled}
            onChange={(event) => setAssignee(event.target.value)}
            aria-label={`${item.label} 담당자`}
            className="mt-1.5 h-11 w-full rounded-[12px] border border-[#d9d1c2] bg-white px-3 text-[14px] font-medium text-[#243832] outline-none focus:border-[#36534e] focus:ring-2 focus:ring-[#36534e]/15 disabled:opacity-50"
          >
            <option value="">담당 미정</option>
            {viewer && <option value={`member:${viewer.id}`}>{viewer.name || "나"} (나)</option>}
            {partner && <option value={`member:${partner.id}`}>{partner.name || "파트너"} (파트너)</option>}
            {item.assignee?.kind === "member"
              && item.assignee.profileId !== viewer?.id
              && item.assignee.profileId !== partner?.id && (
                <option value={`member:${item.assignee.profileId}`}>연결된 구성원</option>
              )}
            <option value="couple">둘이 함께</option>
            <option value="external">외부 담당자</option>
          </select>
        </label>

        {assignee === "external" && (
          <label className="text-[12px] font-semibold text-[#53615c] sm:col-span-2">
            외부 담당 역할
            <input
              type="text"
              value={externalLabel}
              maxLength={80}
              disabled={disabled}
              onChange={(event) => setExternalLabel(event.target.value)}
              placeholder="예: 웨딩홀 담당자, 사회자"
              className="mt-1.5 h-11 w-full rounded-[12px] border border-[#d9d1c2] bg-white px-3 text-[14px] text-[#243832] outline-none focus:border-[#36534e] focus:ring-2 focus:ring-[#36534e]/15 disabled:opacity-50"
            />
          </label>
        )}

        <label className="text-[12px] font-semibold text-[#53615c] sm:col-span-2">
          항목 기한{partner ? " (파트너와 공유)" : ""}
          <input
            type="date"
            value={dueDate}
            disabled={disabled}
            onChange={(event) => setDueDate(event.target.value)}
            aria-label={`${item.label} 항목 기한`}
            className="mt-1.5 h-11 w-full rounded-[12px] border border-[#d9d1c2] bg-white px-3 text-[14px] text-[#243832] outline-none focus:border-[#36534e] focus:ring-2 focus:ring-[#36534e]/15 disabled:opacity-50 sm:max-w-[260px]"
          />
          <span className="mt-1.5 block font-normal leading-5 text-[#7a827e]">기본 D-day 안내와 별개로 우리에게 맞는 날짜를 정해요.</span>
        </label>

        <label className="text-[12px] font-semibold text-[#53615c] sm:col-span-2">
          {partner ? "둘이 보는 메모" : "메모 (파트너를 연결하면 함께 보여요)"}
          <textarea
            value={note}
            maxLength={1000}
            rows={3}
            disabled={disabled}
            onChange={(event) => setNote(event.target.value)}
            aria-label={`${item.label} 메모`}
            placeholder="결정한 내용, 확인할 사람, 계약서 위치를 적어두세요."
            className="mt-1.5 w-full resize-y rounded-[12px] border border-[#d9d1c2] bg-white px-3 py-2.5 text-[14px] leading-6 text-[#243832] outline-none focus:border-[#36534e] focus:ring-2 focus:ring-[#36534e]/15 disabled:opacity-50"
          />
        </label>
      </div>

      <dl className="mt-5 divide-y divide-[#e8e1d6] border-y border-[#e8e1d6]">
        <div className="grid gap-1.5 py-3 sm:grid-cols-[92px_1fr]">
          <dt className="text-[12px] font-semibold text-[#36534e]">완료 기준</dt>
          <dd className="text-[13px] leading-6 text-[#46534f]">{completionCriteria}</dd>
        </div>
        <div className="grid gap-1.5 py-3 sm:grid-cols-[92px_1fr]">
          <dt className="flex items-center gap-1.5 text-[12px] font-semibold text-[#8f6331]"><Lightbulb className="h-3.5 w-3.5" />실전 팁</dt>
          <dd className="text-[13px] leading-6 text-[#5f594f]">{tip}</dd>
        </div>
        <div className="grid gap-1.5 py-3 sm:grid-cols-[92px_1fr]">
          <dt className="flex items-center gap-1.5 text-[12px] font-semibold text-[#a15445]"><AlertTriangle className="h-3.5 w-3.5" />주의</dt>
          <dd className="text-[13px] leading-6 text-[#66544f]">{caution}</dd>
        </div>
      </dl>

      {itemGuidance?.sourceRefs && itemGuidance.sourceRefs.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-semibold text-[#36534e]">공식 근거</p>
          <ul className="mt-2 space-y-2">
            {itemGuidance.sourceRefs.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-start gap-1.5 text-[12.5px] font-semibold leading-5 text-[#36534e] underline decoration-[#36534e]/30 underline-offset-4"
                >
                  {source.title}
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                </a>
                <span className="ml-2 text-[11px] text-[#7a827e]">{source.checkedAt} 확인</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={disabled || (assignee === "external" && !externalLabel.trim())}
          onClick={save}
          className="inline-flex min-h-11 items-center rounded-full bg-[#36534e] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2b4541] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {disabled ? "저장 중" : "변경 내용 저장"}
        </button>
      </div>
    </div>
  );
}

export default function ChecklistCategoryTasks({ categoryKey }: { categoryKey: string }) {
  const { journey, profile, partner, updateJourney, refreshJourney, isDemo } = useAuthStore();
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);

  const template = CHECKLIST_MAP[categoryKey];
  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress],
  );
  const existing = progress[categoryKey];
  const mergedChecklist = useMemo(
    () => template
      ? mergeChecklist(template.items, existing?.checklist, existing?.status)
      : [],
    [existing?.checklist, existing?.status, template],
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(mergedChecklist);
  const canonicalChecklistRef = useRef(mergedChecklist);
  useEffect(() => {
    canonicalChecklistRef.current = mergedChecklist;
    setChecklist(mergedChecklist);
  }, [mergedChecklist]);
  useEffect(() => {
    const openHashTarget = () => {
      let hash = "";
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (!hash.startsWith("task-")) return;
      const itemId = hash.slice("task-".length);
      if (!mergedChecklist.some((item) => item.id === itemId)) return;
      setExpandedItemId(itemId);
      window.setTimeout(() => {
        document.getElementById(`task-toggle-${itemId}`)?.focus();
      }, 0);
    };
    openHashTarget();
    window.addEventListener("hashchange", openHashTarget);
    return () => window.removeEventListener("hashchange", openHashTarget);
  }, [mergedChecklist]);
  const isNotApplicable = existing?.status === "not_applicable";
  const isReviewed = hasChecklistReviewEvidence(existing);
  const { done, total } = getChecklistCounts(checklist);
  const percent = !isNotApplicable && total > 0 ? Math.round((done / total) * 100) : 0;
  const isSaving = savingCategory || savingItemId !== null;

  const persistCategory = useCallback(async (
    category: ProgressItem,
    expectedRevisionOverride?: number,
  ) => {
    if (isDemo) {
      return updateJourney({
        progress: {
          ...progress,
          [categoryKey]: category,
        },
      });
    }
    const expectedRevision = expectedRevisionOverride ?? journey?.state_revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision === undefined || expectedRevision < 0) {
      throw new Error("최신 준비 정보를 다시 불러온 뒤 저장해 주세요.");
    }
    const response = await fetch("/api/journey", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_revision: expectedRevision,
        progress_patch: { [categoryKey]: category },
      }),
    });
    const payload = await response.json().catch(() => null) as {
      status?: unknown;
      requestId?: unknown;
      summary?: unknown;
      journey?: unknown;
      error?: unknown;
    } | null;
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string"
        ? payload.error
        : "그 사이 준비 정보가 바뀌었어요. 최신 상태에서 다시 선택해 주세요.");
    }
    if (payload?.status === "pending_partner") {
      if (typeof payload.requestId !== "string" || typeof payload.summary !== "string") {
        throw new Error("파트너 확인 요청 결과를 안전하게 확인하지 못했어요.");
      }
      return {
        status: "pending_partner" as const,
        requestId: payload.requestId,
        summary: payload.summary,
      };
    }
    if (
      payload?.status !== "applied"
      || typeof payload.journey !== "object"
      || payload.journey === null
      || !("state_revision" in payload.journey)
      || typeof payload.journey.state_revision !== "number"
      || !Number.isSafeInteger(payload.journey.state_revision)
      || !("progress" in payload.journey)
      || typeof payload.journey.progress !== "object"
      || payload.journey.progress === null
    ) {
      throw new Error("저장 결과를 안전하게 확인하지 못했어요.");
    }
    const appliedJourney = payload.journey as WeddingJourney;
    await refreshJourney(profile?.id);
    return { status: "applied" as const, journey: appliedJourney };
  }, [categoryKey, isDemo, journey?.state_revision, profile?.id, progress, refreshJourney, updateJourney]);

  const saveChecklist = useCallback(async (
    nextChecklist: ChecklistItem[],
    itemId: string,
  ) => {
    if (savingRef.current || !template || isNotApplicable) return;
    savingRef.current = true;
    setChecklist(nextChecklist);
    const nextCategory: ProgressItem = {
      ...(existing ?? { category: categoryKey }),
      category: categoryKey,
      status: calculateStatus(nextChecklist),
      checklist: nextChecklist,
    };

    setSavingItemId(itemId);
    setError("");
    setNotice("");
    try {
      const result = await persistCategory(nextCategory);
      if (result.status === "pending_partner") {
        setChecklist(canonicalChecklistRef.current);
        setNotice("상대방에게 확인 요청을 보냈어요. 두 분이 확인하면 변경 내용이 반영돼요.");
      } else {
        canonicalChecklistRef.current = nextChecklist;
        setNotice("변경 내용을 저장했어요.");
      }
      return result;
    } catch (saveError) {
      setChecklist(canonicalChecklistRef.current);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
      return null;
    } finally {
      savingRef.current = false;
      setSavingItemId(null);
    }
  }, [categoryKey, existing, isNotApplicable, persistCategory, template]);

  const toggleItem = useCallback((itemId: string) => {
    if (savingRef.current) return;
    const now = new Date().toISOString();
    const nextChecklist = checklist.map((item) => {
      if (item.id !== itemId) return item;
      const completed = itemState(item) === "completed";
      return {
        ...item,
        done: !completed,
        state: completed ? "todo" : "completed",
        completedAt: !completed && profile?.id ? now : null,
        completedByProfileId: !completed && profile?.id ? profile.id : null,
      } satisfies ChecklistItem;
    });
    void saveChecklist(nextChecklist, itemId);
  }, [checklist, profile?.id, saveChecklist]);

  const saveItemDetails = useCallback(async (nextItem: ChecklistItem) => {
    if (savingRef.current) return;
    const currentItem = checklist.find((item) => item.id === nextItem.id);
    if (!currentItem) return;
    const assigneeChanged = JSON.stringify(currentItem.assignee ?? null)
      !== JSON.stringify(nextItem.assignee ?? null);
    const routineChanged = JSON.stringify([
      itemState(currentItem),
      currentItem.dueDate ?? null,
      currentItem.note ?? null,
    ]) !== JSON.stringify([
      itemState(nextItem),
      nextItem.dueDate ?? null,
      nextItem.note ?? null,
    ]);
    if (!assigneeChanged || !routineChanged || isDemo) {
      const nextChecklist = checklist.map((item) => item.id === nextItem.id ? nextItem : item);
      await saveChecklist(nextChecklist, nextItem.id);
      return;
    }

    // 상태·기한·메모와 상대 담당 지정은 서로 다른 신뢰 경계다. 먼저 일상 변경을
    // 확정하고, 서버가 반환한 정확한 새 revision에서 담당자 변경만 별도로 요청한다.
    const routineItem: ChecklistItem = { ...nextItem };
    if (currentItem.assignee) routineItem.assignee = currentItem.assignee;
    else delete routineItem.assignee;
    const routineChecklist = checklist.map((item) => item.id === nextItem.id ? routineItem : item);
    const routineResult = await saveChecklist(routineChecklist, nextItem.id);
    if (!routineResult || routineResult.status !== "applied" || !("journey" in routineResult)) return;

    const appliedCategory = routineResult.journey.progress[categoryKey];
    if (!appliedCategory) {
      setNotice("상태·기한·메모는 저장했어요. 담당자는 최신 화면에서 다시 선택해 주세요.");
      return;
    }
    const freshChecklist = mergeChecklist(
      template?.items ?? [],
      appliedCategory.checklist,
      appliedCategory.status,
    );
    const assignmentChecklist = freshChecklist.map((item) => {
      if (item.id !== nextItem.id) return item;
      const assigned: ChecklistItem = { ...item };
      if (nextItem.assignee) assigned.assignee = nextItem.assignee;
      else delete assigned.assignee;
      return assigned;
    });
    const assignmentCategory: ProgressItem = {
      ...appliedCategory,
      category: categoryKey,
      status: calculateStatus(assignmentChecklist),
      checklist: assignmentChecklist,
    };
    savingRef.current = true;
    setSavingItemId(nextItem.id);
    setError("");
    try {
      const assignmentResult = await persistCategory(
        assignmentCategory,
        routineResult.journey.state_revision ?? 0,
      );
      if (assignmentResult.status === "pending_partner") {
        canonicalChecklistRef.current = freshChecklist;
        setChecklist(freshChecklist);
        setNotice("상태·기한·메모는 저장했고, 담당자 변경은 파트너에게 확인 요청을 보냈어요.");
      } else {
        canonicalChecklistRef.current = assignmentChecklist;
        setChecklist(assignmentChecklist);
        setNotice("상태·기한·메모와 담당자를 저장했어요.");
      }
    } catch {
      canonicalChecklistRef.current = freshChecklist;
      setChecklist(freshChecklist);
      setNotice("상태·기한·메모는 저장했어요. 담당자는 최신 화면에서 다시 선택해 주세요.");
    } finally {
      savingRef.current = false;
      setSavingItemId(null);
    }
  }, [categoryKey, checklist, isDemo, persistCategory, saveChecklist, template?.items]);

  const markCategoryReviewed = useCallback(async () => {
    if (savingRef.current || !template || isNotApplicable) return;
    savingRef.current = true;
    setSavingCategory(true);
    setError("");
    setNotice("");
    const nextCategory: ProgressItem = {
      ...(existing ?? { category: categoryKey }),
      category: categoryKey,
      status: calculateStatus(checklist),
      checklist,
      checklistReviewedAt: new Date().toISOString(),
      checklistReviewedByProfileId: profile?.id ?? null,
      checklistReviewSource: "manual",
    };
    try {
      const result = await persistCategory(nextCategory);
      setNotice(result.status === "pending_partner"
        ? "상대방에게 확인 요청을 보냈어요. 승인 전에는 현재 상태가 유지돼요."
        : "이 분야가 우리 준비에 필요하다고 확인했어요.");
    } catch (saveError) {
      setError(saveError instanceof Error
        ? saveError.message
        : "검토 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      savingRef.current = false;
      setSavingCategory(false);
    }
  }, [categoryKey, checklist, existing, isNotApplicable, persistCategory, profile?.id, template]);

  const toggleNotApplicable = useCallback(async () => {
    if (savingRef.current || !template) return;
    savingRef.current = true;
    const nextStatus = isNotApplicable ? calculateStatus(checklist) : "not_applicable";
    const nextCategory: ProgressItem = {
      ...(existing ?? { category: categoryKey }),
      category: categoryKey,
      status: nextStatus,
      checklist,
      ...(!isNotApplicable
        ? {
            checklistReviewedAt: existing?.checklistReviewedAt ?? new Date().toISOString(),
            checklistReviewedByProfileId: existing?.checklistReviewedByProfileId ?? profile?.id ?? null,
            checklistReviewSource: existing?.checklistReviewSource ?? "manual" as const,
          }
        : {}),
    };

    setSavingCategory(true);
    setError("");
    setNotice("");
    try {
      const result = await persistCategory(nextCategory);
      if (result.status === "pending_partner") {
        setNotice("상대방에게 확인 요청을 보냈어요. 승인 전에는 현재 상태가 유지돼요.");
      } else {
        setNotice(
          isNotApplicable
            ? "다시 준비 목록에 넣었어요. 이전 체크 상태도 그대로 남아 있어요."
            : "이 분야를 전체 진행률과 기본 일정 알림에서 제외했어요.",
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "분야 상태를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      savingRef.current = false;
      setSavingCategory(false);
    }
  }, [categoryKey, checklist, existing, isNotApplicable, persistCategory, profile?.id, template]);

  if (!template) return null;

  return (
    <section id="checklist-tasks" aria-labelledby="checklist-tasks-heading" className="scroll-mt-24">
      <div className="flex flex-col gap-4 border-b border-[#e5dece] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-[#9d6f36]">SAVE YOUR PROGRESS</p>
          <h2 id="checklist-tasks-heading" className="mt-1.5 text-[23px] font-semibold text-[#172a27]">
            실제로 확인할 것
          </h2>
          <p className="mt-1 text-[13px] leading-6 text-[#65706d]">
            {isNotApplicable ? "우리 준비에서는 제외한 분야예요." : `${done}/${total}개 완료 · 항목을 열면 담당자와 기한도 정할 수 있어요.`}
          </p>
        </div>
        <strong className="text-[30px] font-semibold leading-none text-[#36534e]">
          {isNotApplicable ? "제외됨" : `${percent}%`}
        </strong>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-[#eee8dc]"
        role="progressbar"
        aria-label={`${template.label} 완료율`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-[#36534e] transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      {!isReviewed && !isNotApplicable && (
        <div className="mt-5 rounded-[16px] border border-[#dfd2bd] bg-[#fffaf0] px-4 py-4">
          <p className="text-[13px] font-semibold text-[#36534e]">이 분야가 우리 준비에 필요한가요?</p>
          <p className="mt-1 text-[12px] leading-5 text-[#6b675d]">목록을 살펴본 뒤 필요 여부를 정하면 검토 범위가 정확해져요.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void markCategoryReviewed()}
              className="inline-flex min-h-11 items-center rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              우리에게 필요한 준비예요
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => void toggleNotApplicable()}
              className="inline-flex min-h-11 items-center rounded-full border border-[#d9d1c2] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#5f625f] disabled:opacity-50"
            >
              필요 없는 준비예요
            </button>
          </div>
        </div>
      )}

      {isNotApplicable && (
        <div className="mt-5 flex gap-3 rounded-[16px] border border-[#d9d4ca] bg-[#f7f5f0] px-4 py-3.5">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-[#77736b]" />
          <p className="text-[13px] leading-6 text-[#5f625f]">
            진행률과 기본 일정 알림에서만 제외했어요. 이전에 체크한 내용은 지우지 않았습니다.
          </p>
        </div>
      )}

      <ul className="mt-5 divide-y divide-[#e9e3d8] border-y border-[#e9e3d8]">
        {checklist.map((item) => {
          const state = itemState(item);
          const isExpanded = expandedItemId === item.id;
          const itemDisabled = isSaving || isNotApplicable;
          return (
            <li key={item.id} id={`task-${item.id}`} className={state === "not_applicable" ? "opacity-60" : undefined}>
              <div className="flex min-h-[66px] items-start gap-3 px-1 py-3.5">
                <label className={`mt-0.5 shrink-0 ${itemDisabled || state === "not_applicable" ? "cursor-not-allowed" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={state === "completed"}
                    disabled={itemDisabled || state === "not_applicable"}
                    onChange={() => toggleItem(item.id)}
                    className="peer sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[#c9a96e]/60 peer-focus-visible:ring-offset-2 ${
                      state === "completed"
                        ? "border-[#36534e] bg-[#36534e] text-white"
                        : "border-[#aaa497] bg-white text-transparent hover:border-[#36534e]"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <span className="sr-only">{item.label} 완료</span>
                </label>

                <button
                  type="button"
                  id={`task-toggle-${item.id}`}
                  aria-label={`${item.label} 상세 ${isExpanded ? "닫기" : "열기"}`}
                  aria-expanded={isExpanded}
                  aria-controls={`task-details-${item.id}`}
                  onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                  className="group min-w-0 flex-1 rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#c9a96e]/60"
                >
                  <span className={`block text-[15px] leading-6 ${state === "completed" ? "text-[#8b8d88] line-through" : "text-[#243832]"}`}>
                    {item.label}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-[#747d78]">
                    <span className={state === "blocked" ? "font-semibold text-[#a15445]" : undefined}>{STATE_LABEL[state]}</span>
                    {item.dueDate && <span>{item.dueDate}</span>}
                    {item.assignee?.kind === "couple" && <span>둘이 함께</span>}
                    {item.assignee?.kind === "external" && <span>{item.assignee.label}</span>}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-2 pt-1">
                  {savingItemId === item.id && <span className="text-[11px] font-medium text-[#8f857b]">저장 중</span>}
                  <ChevronDown className={`h-4 w-4 text-[#8f8a81] transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden />
                </span>
              </div>

              {isExpanded && (
                <div id={`task-details-${item.id}`}>
                  <ChecklistItemEditor
                    key={JSON.stringify([
                      item.id,
                      item.state,
                      item.done,
                      item.assignee,
                      item.dueDate,
                      item.note,
                      item.completedAt,
                      item.completedByProfileId,
                    ])}
                    item={item}
                    categoryKey={categoryKey}
                    disabled={itemDisabled}
                    viewer={profile ? { id: profile.id, name: profile.name } : null}
                    partner={partner ? { id: partner.id, name: partner.name } : null}
                    onSave={saveItemDetails}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {(isReviewed || isNotApplicable) && (
        <button
          type="button"
          onClick={() => void toggleNotApplicable()}
          disabled={isSaving}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-[#d9d1c2] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#5f625f] transition-colors hover:border-[#8d877c] hover:bg-[#f8f6f0] disabled:cursor-wait disabled:opacity-50"
        >
          {isNotApplicable ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
          {isNotApplicable ? "다시 준비 목록에 넣기" : "우리에게는 필요 없는 준비예요"}
        </button>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-[#e3bcbc] bg-[#fff7f6] px-4 py-3 text-[13px] leading-6 text-[#8c3e3e]">
          {error}
        </p>
      )}
      <p className="mt-4 min-h-6 text-[12.5px] leading-6 text-[#5d746d]" role="status" aria-live="polite">
        {notice || (isSaving ? "변경 내용을 안전하게 저장하고 있어요." : "")}
      </p>
    </section>
  );
}
