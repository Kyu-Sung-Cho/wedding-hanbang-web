"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { stripPlanningChecklistNotes } from "@hanbang/shared/utils";
import { useSearchParams, useRouter } from "next/navigation";
import { List, Calendar, Plus, Pencil, Ban, RotateCcw, CalendarDays, X } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@/constants/checklists";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import { mergeChecklist, calculateStatus, summarizePlanningChecklist } from "@/utils/checklist";
import {
  addEvent,
  cancelEvent,
  findCategoryScheduleEvent,
  getScheduleEventAssigneeLabel,
  getScheduleEventStatus,
  inspectScheduleEvents,
  sanitizeUserFacingScheduleMemo,
  restoreEvent,
  updateEvent,
  upsertCategoryEvent,
  type ScheduleEventAssigneeContext,
  type ScheduleEventDraft,
} from "@/utils/scheduleEvents";
import { getImminentCategories } from "@/utils/imminentChecklist";
import { planChangeMessage } from "@/lib/journey/planChangeError";
import TimelineView from "@/components/app/schedule/TimelineView";
import CalendarView from "@/components/app/schedule/CalendarView";
import PreparationTimeline, { ScheduleStageSummary } from "./PreparationTimeline";
import ScheduleProgress from "./ScheduleProgress";
import { FEATURE_SUMMARY_CLASS, SUMMARY_LABEL_CLASS, SUMMARY_VALUE_CLASS } from "@/components/ui/featureSummaryStyles";
import CategoryChecklistModal from "@/components/app/schedule/CategoryChecklistModal";
import ImminentAlerts from "@/components/app/schedule/ImminentAlerts";
import EventFormModal from "@/components/app/schedule/EventFormModal";
import { weddingPath } from "@/lib/weddingPaths";
import { ymdInKst } from "@/lib/utils/kstDate";
import { daysUntilWedding } from "@/lib/utils/weddingDate";
import type {
  ChecklistItem,
  ScheduleEvent,
  ProgressItem,
  WeddingJourney,
} from "@/types/database.types";

const DEMO_SCHEDULE_ACTOR_PROFILE_ID = "00000000-0000-4000-8000-000000000001";

const CATEGORY_LABELS: Record<string, string> = {
  ...PLANNING_CATEGORY_LABELS,
  general: "일반",
  etiquette: "결혼 예절 참고",
};

export const SCHEDULE_EVENT_REPAIR_MESSAGE =
  "저장된 일정 일부를 안전하게 읽지 못해 변경하지 않았어요. 새로고침 후에도 계속되면 고객센터에 문의해 주세요.";

export function getScheduleEventMutationBlockReason(
  progress: Record<string, unknown>,
): string | null {
  const inspection = inspectScheduleEvents(progress);
  const hasDuplicateId = new Set(inspection.events.map((event) => event.id)).size
    !== inspection.events.length;
  return inspection.malformedContainer
    || inspection.rejectedCount > 0
    || inspection.truncatedCount > 0
    || hasDuplicateId
    ? SCHEDULE_EVENT_REPAIR_MESSAGE
    : null;
}

interface PendingChecklistSchedule {
  categoryKey: string;
  itemId: string;
  itemLabel: string;
  categoryLabel: string;
  existingEvent?: ScheduleEvent;
}

function buildChecklistProgress(
  baseProgress: Record<string, unknown>,
  categoryKey: string,
  itemId: string,
  nextDone?: boolean
): Record<string, unknown> {
  const template = CHECKLIST_MAP[categoryKey];
  if (!template) return baseProgress;

  const existing = baseProgress[categoryKey] as ProgressItem | undefined;
  const merged = mergeChecklist(
    template.items,
    existing?.checklist,
    existing?.status
  );
  const current = merged.find((item) => item.id === itemId);
  if (!current) return baseProgress;

  const updated = merged.map((item) =>
    item.id === itemId
      ? { ...item, done: nextDone ?? !item.done }
      : item
  );
  const newStatus = calculateStatus(updated);

  return {
    ...baseProgress,
    [categoryKey]: {
      ...(existing ?? { category: categoryKey }),
      category: categoryKey,
      status: newStatus,
      // DB는 {id, label, done} 세 키만 받는다. 템플릿의 note를 그대로 보내면
      // 쓰기가 거절되므로(AMORA_ATOMIC_CHECKLIST_ITEM_INVALID) 저장 직전에 뗀다.
      checklist: stripPlanningChecklistNotes(updated),
    },
  };
}

interface ScheduleContentProps {
  /** 패널/오버레이 안에서 렌더되는지 여부. true면 풀스크린 chrome 제거. */
  embedded?: boolean;
}

export default function ScheduleContent({ embedded = false }: ScheduleContentProps = {}) {
  const { journey, updateJourney, profile, partner, isDemo } = useAuthStore();
  // 기본은 달력이다.
  //
  // 타임라인은 체크리스트 화면과 **같은 것**을 그린다 — 같은 상수(`CATEGORY_CHECKLISTS`),
  // 같은 병합 함수, 같은 토글 핸들러를 쓰고 D-day 구간으로 묶기만 한다. 일정 화면이
  // 체크리스트를 한 번 더 그릴 이유가 없다.
  //
  // 타임라인을 지우지는 않았다. 그 573 줄에는 "어느 화면이 무엇을 그려야 하는가"를
  // 고정하는 계약 테스트 두 개가 걸려 있어서, 출시 주에 손댈 일이 아니다. 기본값만
  // 옮기면 되돌리는 것도 이 한 줄이다.
  const [viewMode, setViewMode] = useState<"timeline" | "calendar">("calendar");
  /** 복원 요청을 보내는 중인 일정. 버튼 자리에 표시를 남기려고 둔다. */
  const [restoringEventId, setRestoringEventId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // 이벤트 CRUD 상태
  const [eventFormMode, setEventFormMode] = useState<"add" | "edit" | null>(null);
  /** 「날짜를 정할 항목」에서 바로 날짜를 잡을 때 폼에 미리 채울 분야. */
  const [eventFormCategoryKey, setEventFormCategoryKey] = useState<string>("");
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDateForAdd, setSelectedDateForAdd] = useState<string | null>(null);
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null);
  const [pendingChecklistSchedule, setPendingChecklistSchedule] =
    useState<PendingChecklistSchedule | null>(null);
  const [journeyNotice, setJourneyNotice] = useState("");
  const [journeyError, setJourneyError] = useState("");

  const saveJourney = useCallback(
    async (
      updates: Partial<
        Pick<
          WeddingJourney,
          "wedding_date" | "total_budget" | "venue" | "progress"
        >
      >,
      notices?: {
        pending: string;
        applied: string;
      },
    ) => {
      setJourneyError("");
      setJourneyNotice("");
      try {
        const result = await updateJourney(updates);
        setJourneyNotice(
          result.status === "pending_partner"
            ? `${result.summary} ${
                notices?.pending
                  ?? "상대방에게 확인 요청을 보냈어요. 두 분 확인 전에는 반영되지 않습니다."
              }`
            : notices?.applied
              ?? (partner
                ? "일정 변경을 저장했어요. 함께 보는 일정에 반영됐어요."
                : "일정 변경을 저장했어요.")
        );
        return result;
      } catch (error) {
        // 서버가 아는 사유를 말했다면 그것을 보여준다. "잠시 후 다시 시도" 는
        // 상대가 거절했거나 화면이 낡은 경우에는 **틀린 안내**다 — 다시 눌러도 같다.
        setJourneyError(
          planChangeMessage(error)
            ?? "일정 변경을 저장하지 못했어요. 최신 화면을 다시 불러온 뒤 다시 시도해 주세요.",
        );
        throw error;
      }
    },
    [partner, updateJourney],
  );

  const progress = useMemo(
    () => (journey?.progress ?? {}) as Record<string, ProgressItem>,
    [journey?.progress]
  );
  const weddingDateValue = journey?.wedding_date;
  const weddingDate = useMemo(
    () => (weddingDateValue ? new Date(weddingDateValue) : null),
    [weddingDateValue]
  );

  // 일정 데이터가 일부라도 손상되었거나 잘렸다면, 유효한 항목만 다시 저장해
  // 나머지를 지우는 대신 모든 일정 쓰기를 중단한다.
  const eventInspection = useMemo(
    () => inspectScheduleEvents(progress as Record<string, unknown>),
    [progress],
  );
  const events = eventInspection.events;
  const activeEvents = useMemo(
    () => events.filter((event) => getScheduleEventStatus(event) !== "cancelled"),
    [events],
  );
  const cancelledEvents = useMemo(
    () => events.filter((event) => getScheduleEventStatus(event) === "cancelled"),
    [events],
  );
  const assigneeContext = useMemo<ScheduleEventAssigneeContext>(
    () => ({
      viewer: profile
        ? { id: profile.id, name: profile.name }
        : null,
      partner: partner
        ? { id: partner.id, name: partner.name }
        : null,
    }),
    [partner, profile],
  );
  const eventMutationBlockReason = useMemo(
    () => getScheduleEventMutationBlockReason(
      progress as Record<string, unknown>,
    ),
    [progress],
  );
  const blockUnsafeEventMutation = useCallback(() => {
    if (!eventMutationBlockReason) return false;
    setJourneyNotice("");
    setJourneyError(eventMutationBlockReason);
    return true;
  }, [eventMutationBlockReason]);

  // 다가오는 일정
  // toISOString() 은 브라우저에서도 UTC 라, 한국 새벽 0~9시에는 어제가 기준이 되어
  // **이미 지난 일정이 "다가오는 일정"에 남았다.**
  const todayStr = ymdInKst();
  const upcomingEvents = useMemo(() => {
    return activeEvents
      .filter(
        (event) =>
          event.date >= todayStr
          && getScheduleEventStatus(event) === "planned",
      )
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  }, [activeEvents, todayStr]);

  // 임박 카테고리
  const imminentCategories = useMemo(
    () => getImminentCategories(progress, weddingDate, activeEvents),
    [progress, weddingDate, activeEvents]
  );

  // 전체 체크리스트 완료 수
  const checklistSummary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, progress);
  const totalDone = checklistSummary.done;
  const totalItems = checklistSummary.total;

  // **한국 새벽 0~9시에 하루가 더 나왔다.**
  //
  // `new Date("YYYY-MM-DD")` 는 UTC 자정으로 파싱되고 `new Date()` 는 지금 이 순간이다.
  // KST 0~9시는 UTC 로 전날 15~24시라 차이가 온전한 일수보다 조금 크고, `Math.ceil`
  // 이 그걸 올려 하루를 더한다. 예식 당일 새벽에 "D-1" 이 뜨는 종류다.
  //
  // `daysUntilWedding` 은 예식일과 오늘을 **둘 다 KST 자정으로** 맞춘 뒤 비교한다.
  const dday = daysUntilWedding(weddingDateValue);

  const handleCategoryClick = useCallback((key: string) => {
    setSelectedCategory(key);
  }, []);

  /**
   * 「날짜를 정할 항목」에서 날짜를 잡는다.
   *
   * 이 패널은 이름이 약속하는 것을 할 수 없었다 — 행을 누르면 체크리스트 창이 열려서,
   * 날짜를 잡으려면 화면 위 `일정 추가`로 가 분야를 처음부터 다시 고르는 수밖에 없었다.
   * 패널은 이미 어느 분야인지 아니까 그대로 폼에 넘긴다.
   */
  const handleScheduleCategory = useCallback((key: string) => {
    setEditingEvent(null);
    setSelectedDateForAdd(null);
    setEventFormCategoryKey(key);
    setEventFormMode("add");
  }, []);

  // 타임라인 인라인 체크리스트 토글
  const handleToggleChecklistItem = useCallback(
    async (categoryKey: string, itemId: string) => {
      if (!journey) return;

      const newProgress = buildChecklistProgress(
        progress as unknown as Record<string, unknown>,
        categoryKey,
        itemId
      );

      await saveJourney({ progress: newProgress as unknown as Record<string, ProgressItem> });
    },
    [journey, progress, saveJourney]
  );

  const handleChecklistItemClick = useCallback(
    async (categoryKey: string, item: ChecklistItem) => {
      if (item.done) {
        await handleToggleChecklistItem(categoryKey, item.id);
        return;
      }

      const categoryLabel = CATEGORY_LABELS[categoryKey] ?? categoryKey;
      const existingEvent = findCategoryScheduleEvent(activeEvents, categoryKey, categoryLabel);
      setPendingChecklistSchedule({
        categoryKey,
        itemId: item.id,
        itemLabel: item.label,
        categoryLabel,
        existingEvent,
      });
    },
    [activeEvents, handleToggleChecklistItem]
  );

  const completeChecklistWithSchedule = useCallback(
    async (data: { date?: string; memo?: string }) => {
      if (!journey || !pendingChecklistSchedule) return;
      if (data.date && blockUnsafeEventMutation()) return;

      // 일정과 체크를 **한 번에** 보내면 DB가 통째로 거절한다.
      // `__events`가 바뀐 저장은 아모라 수동 일정 공정성 검사를 타는데, 그 검사는 같은
      // 저장에 `__events` 밖의 변경이 섞여 있으면 AMORA_MANUAL_SCHEDULE_MIXED_DELTA_DENIED로
      // 막는다(20260802140000 마이그레이션). 그래서 일정 → 체크 두 번에 나눠 보낸다.
      // 순서가 중요하다 — 일정이 실패하면 체크도 하지 않아야 화면과 저장이 어긋나지 않는다.
      // 날짜 저장이 "상대 확인 대기"로 끝났는지 기억한다.
      //
      // 두 번의 저장은 각각 안내 문구를 세우는데, 두 번째가 첫 번째를 덮는다.
      // 그래서 날짜는 대기 중인데 화면에는 "저장했어요" 만 남았다 — 사용자는 날짜가
      // 반영된 줄 알고 화면을 떠나고, 어디에도 날짜가 없는 것을 나중에 발견한다.
      let datePending = false;
      try {
        if (data.date) {
          const upserted = upsertCategoryEvent(
            progress as unknown as Record<string, unknown>,
            {
              date: data.date,
              title: pendingChecklistSchedule.categoryLabel,
              memo:
                sanitizeUserFacingScheduleMemo(data.memo)?.trim()
                || pendingChecklistSchedule.itemLabel,
              categoryKey: pendingChecklistSchedule.categoryKey,
            },
            pendingChecklistSchedule.categoryLabel
          );
          const dateResult = await saveJourney({
            progress: upserted.newProgress as unknown as Record<string, ProgressItem>,
          });
          datePending = dateResult?.status === "pending_partner";
        }

        // 첫 저장이 그대로 반영됐다면 스토어의 progress는 이미 `__events`를 담고 있다.
        // 낡은 `progress`로 두 번째 패치를 만들면 방금 넣은 일정을 되돌리는 변경이 섞여
        // 같은 이유로 다시 거절당한다. 상대 확인 대기로 끝났다면 스토어는 그대로이므로,
        // 어느 쪽이든 최신값에서 다시 만드는 것이 맞다.
        const latestProgress = (useAuthStore.getState().journey?.progress
          ?? progress) as unknown as Record<string, unknown>;

        await saveJourney(
          {
            progress: buildChecklistProgress(
              latestProgress,
              pendingChecklistSchedule.categoryKey,
              pendingChecklistSchedule.itemId,
              true
            ) as unknown as Record<string, ProgressItem>,
          },
          datePending
            ? {
                pending:
                  "확인 표시와 날짜 모두 상대방 확인을 기다리고 있어요. 두 분 확인 전에는 반영되지 않습니다.",
                applied:
                  "확인 표시는 저장했어요. 날짜는 상대방이 확인해야 일정에 반영돼요.",
              }
            : undefined,
        );
        setPendingChecklistSchedule(null);
      } catch {
        // saveJourney가 이미 오류 문구를 세팅했다. 창을 닫지 않아 다시 시도할 수 있다.
      }
    },
    [
      blockUnsafeEventMutation,
      journey,
      pendingChecklistSchedule,
      progress,
      saveJourney,
    ]
  );

  // 이벤트 CRUD
  const handleAddEvent = useCallback((date: string) => {
    if (blockUnsafeEventMutation()) return;
    setSelectedDateForAdd(date);
    setEditingEvent(null);
    // 패널에서 한 번 고른 분야가 다음 일반 추가에 남지 않게 비운다.
    setEventFormCategoryKey("");
    setEventFormMode("add");
  }, [blockUnsafeEventMutation]);

  const handleAddEventQuick = useCallback(() => {
    if (blockUnsafeEventMutation()) return;
    setSelectedDateForAdd(null);
    setEditingEvent(null);
    setEventFormCategoryKey("");
    setEventFormMode("add");
  }, [blockUnsafeEventMutation]);

  // 대시보드에서 ?new=1 진입 시 자동으로 일정 추가 모달 오픈 (단 1회)
  const searchParams = useSearchParams();
  const router = useRouter();
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (searchParams.get("new") === "1") {
      autoOpenedRef.current = true;
      const timer = window.setTimeout(() => {
        handleAddEventQuick();
      }, 0);
      // URL에서 query 제거 (모달 닫고 새로고침해도 다시 안 열리도록)
      router.replace(weddingPath("/schedule"));
      return () => window.clearTimeout(timer);
    }
  }, [searchParams, router, handleAddEventQuick]);

  const handleEditEvent = useCallback((event: ScheduleEvent) => {
    if (blockUnsafeEventMutation()) return;
    if (getScheduleEventStatus(event) === "cancelled") {
      setJourneyError("취소된 일정은 먼저 복원한 뒤 수정해 주세요.");
      return;
    }
    setEditingEvent(event);
    setSelectedDateForAdd(null);
    setEventFormMode("edit");
  }, [blockUnsafeEventMutation]);

  const handleSaveEvent = useCallback(
    async (data: ScheduleEventDraft) => {
      if (!journey) return;
      if (blockUnsafeEventMutation()) return;

      const progressObj = progress as Record<string, unknown>;

      if (eventFormMode === "edit" && editingEvent) {
        await saveJourney({
          progress: updateEvent(
            progressObj,
            editingEvent.id,
            data,
          ) as unknown as Record<string, ProgressItem>,
        });
      } else if (data.categoryKey && data.categoryKey !== "general") {
        const { newProgress } = upsertCategoryEvent(
          progressObj,
          data,
          CATEGORY_LABELS[data.categoryKey]
        );
        await saveJourney({
          progress: newProgress as unknown as Record<string, ProgressItem>,
        });
      } else {
        const { newProgress } = addEvent(progressObj, data);
        await saveJourney({
          progress: newProgress as unknown as Record<string, ProgressItem>,
        });
      }

      setEventFormMode(null);
      setEditingEvent(null);
      setSelectedDateForAdd(null);
    },
    [
      blockUnsafeEventMutation,
      journey,
      progress,
      eventFormMode,
      editingEvent,
      saveJourney,
    ]
  );

  const handleCancelEvent = useCallback(
    async (eventId: string) => {
      if (!journey || !profile) return;
      if (blockUnsafeEventMutation()) return;

      const progressObj = progress as Record<string, unknown>;
      const cancelledAt = new Date().toISOString();

      await saveJourney({
        progress: cancelEvent(
          progressObj,
          eventId,
          {
            cancelledAt,
            cancelledByProfileId: isDemo
              ? DEMO_SCHEDULE_ACTOR_PROFILE_ID
              : profile.id,
          },
        ) as unknown as Record<string, ProgressItem>,
      }, {
        pending: "파트너 승인 전 기존 일정 유지 상태입니다.",
        applied: "일정을 취소됨으로 옮겼어요. 기록은 남아 있고 언제든 복원 요청할 수 있어요.",
      });

      setEventFormMode(null);
      setEditingEvent(null);
    },
    [blockUnsafeEventMutation, isDemo, journey, profile, progress, saveJourney]
  );

  const handleRestoreEvent = useCallback(
    async (eventId: string) => {
      if (!journey) return;
      if (blockUnsafeEventMutation()) return;
      // 누른 자리에 표시를 남긴다. 결과 배너는 화면 맨 위에 있고 이 버튼은
      // 달력 아래라, 표시가 없으면 눌렸는지조차 알 수 없다.
      setRestoringEventId(eventId);
      try {
      await saveJourney({
        progress: restoreEvent(
          progress as Record<string, unknown>,
          eventId,
          new Date().toISOString(),
        ) as unknown as Record<string, ProgressItem>,
      }, {
        pending: "파트너 승인 전에는 취소됨 상태가 유지됩니다.",
        applied: "일정을 예정 상태로 복원했어요.",
      });
      } finally {
        setRestoringEventId(null);
      }
    },
    [blockUnsafeEventMutation, journey, progress, saveJourney],
  );

  // 날짜 포맷
  function formatEventDate(dateString: string): string {
    const d = new Date(dateString + "T00:00:00");
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
  }

  // D-day
  //
  // 예식일과 같은 이유로 새벽에 하루가 어긋났다. `new Date(ymd + "T00:00:00")` 는
  // **브라우저 시간대**의 자정이라 KST 기기에서는 맞지만, 서버 렌더나 다른 시간대
  // 기기에서는 어긋난다. 예식일 쪽과 같은 도우미를 쓴다.
  function getDaysUntil(dateString: string): string {
    const diff = daysUntilWedding(dateString);
    if (diff === null) return "";
    if (diff === 0) return "오늘";
    if (diff === 1) return "내일";
    if (diff < 0) return `${Math.abs(diff)}일 전`;
    return `${diff}일 후`;
  }

  const progressPct = totalItems > 0 ? Math.round((totalDone / totalItems) * 100) : 0;

  // 모바일은 다가오는 일정과 달력을 먼저, 기본 확인 항목을 그 아래에 둔다.
  const hasUpcoming = upcomingEvents.length > 0;
  const needsScheduleCount = imminentCategories.filter((item) => !item.hasScheduledEvent).length;
  const upcomingCount = activeEvents.filter((event) => event.date >= todayStr && getScheduleEventStatus(event) === "planned").length;

  const imminentPanel =
    imminentCategories.length > 0 ? (
  <div className="rounded-[16px] border border-[var(--amora-line)] bg-white px-[18px] py-[17px]">
    <h3 className="mb-3 text-[14px] font-semibold text-[var(--amora-ink)]">
      기본 일정 확인
    </h3>
    <ImminentAlerts
      items={imminentCategories}
      onCategoryClick={handleCategoryClick}
      onScheduleClick={handleScheduleCategory}
    />
  </div>
    ) : null;

  const upcomingPanel = (
    <div className="rounded-[16px] border border-[var(--amora-line)] bg-white px-[18px] py-[17px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-[var(--amora-ink)]">
          다가오는 일정
        </h3>
        <button
          onClick={handleAddEventQuick}
          className="tap-area flex shrink-0 items-center gap-1 rounded-full border border-[var(--amora-line)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)]"
        >
          <Plus className="w-4 h-4" />
          추가
        </button>
      </div>

      {upcomingEvents.length === 0 ? (
        <p className="text-[14px] font-medium text-[var(--hb-text-body)]">예정된 일정이 없어요</p>
      ) : (
        <div className="divide-y divide-[var(--amora-line)]">
          {upcomingEvents.map((evt) => (
            <div
              key={evt.id}
              className="group grid grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 py-3"
            >
              <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[var(--amora-rose-pale)] text-[var(--amora-rose-deep)]">
                <CalendarDays className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="break-words text-[13px] font-semibold leading-[1.5] text-[var(--amora-ink)]">
                  {evt.title}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="text-[10.5px] text-[var(--amora-muted)]">
                    {formatEventDate(evt.date)}{evt.time ? ` ${evt.time}` : ""}
                  </p>
                  {evt.categoryKey && (
                    <span className="max-w-full truncate text-[10.5px] text-[var(--amora-muted)]">
                      {CATEGORY_LABELS[evt.categoryKey] ?? evt.categoryKey}
                    </span>
                  )}
                  <span className="max-w-full truncate text-[10.5px] text-[var(--amora-muted)]">
                    {getScheduleEventAssigneeLabel(
                      evt.assignee,
                      assigneeContext,
                    )}
                  </span>
                </div>
                {evt.completionCriteria && (
                  <p className="mt-1.5 break-words text-[10.5px] leading-[1.6] text-[var(--amora-soft)]">
                    완료 기준 · {evt.completionCriteria}
                  </p>
                )}
              </div>
              <div className={`flex shrink-0 flex-col items-end gap-1 ${pendingCancelId === evt.id ? "col-span-2 col-start-2" : ""}`}>
                <span className="text-[11px] text-[var(--amora-rose-deep)]">
                  {getDaysUntil(evt.date)}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {pendingCancelId === evt.id ? (
                    <>
                      <span className="sr-only">일정 취소 요청</span>
                      <button
                        type="button"
                        onClick={() => {
                          void handleCancelEvent(evt.id)
                            .then(() => setPendingCancelId(null))
                            .catch(() => undefined);
                        }}
                        className="min-h-11 rounded-xl bg-[var(--amora-action,var(--hb-action))] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[var(--amora-action-hover,var(--hb-action-hover))]"
                      >
                        취소 요청 보내기
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCancelId(null)}
                        className="min-h-11 rounded-xl bg-[var(--hb-surface-hover)] px-3 py-2 text-xs font-semibold text-[var(--hb-text-body)] transition-colors hover:bg-[var(--amora-low)]"
                      >
                        닫기
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleEditEvent(evt)}
                        aria-label={`${evt.title} 일정 수정`}
                        className="tap-area flex h-9 w-9 items-center justify-center rounded-lg text-[var(--amora-muted)] transition-colors hover:bg-[var(--amora-warm)]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingCancelId(evt.id)}
                        aria-label={`${evt.title} 일정 취소 요청`}
                        className="tap-area flex h-9 w-9 items-center justify-center rounded-lg text-[var(--amora-muted)] transition-colors hover:bg-[var(--amora-warm)]"
                      >
                        <Ban className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className={embedded ? "bg-[var(--hb-surface-hover)]" : ""}>
      <div
        className={
          embedded
            ? "mx-auto w-full max-w-[1440px] space-y-3.5 px-[18px] py-4 md:px-9 lg:space-y-6 lg:py-[30px]"
            : "mx-auto w-full max-w-[1440px] space-y-3.5 px-[18px] py-4 md:px-9 lg:space-y-6 lg:py-[30px]"
        }
      >
        {journeyNotice && (
          <div
            role="status"
            className="rounded-xl border border-[#B9D5C8] bg-[#F2F8F5] px-4 py-3 text-sm leading-6 text-[#315B49]"
          >
            {journeyNotice}
          </div>
        )}
        {(eventMutationBlockReason || journeyError) && (
          <div
            role="alert"
            className="rounded-xl border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-sm leading-6 text-[#8C3E3E]"
          >
            {eventMutationBlockReason ?? journeyError}
          </div>
        )}

        <div className={`${FEATURE_SUMMARY_CLASS} hidden items-center gap-[30px] px-7 py-[22px] lg:flex`}>
          <div className="min-w-0 flex-1">
            <p className={SUMMARY_LABEL_CLASS}>기본 일정 확인</p>
            <h1 className="planning-display mt-1.5 text-[24px] leading-[1.4] text-[var(--amora-ink)]">{needsScheduleCount ? `날짜를 정할 항목 ${needsScheduleCount}건이 있어요` : "우리의 준비 일정을 모아봐요"}</h1>
            <p className="mt-2 text-[12px] leading-[1.8] text-[var(--amora-muted)]">기본 확인 시점이 지났거나 60일 안에 다가오는 항목을 확인해요.<br />업체나 가족과 정한 실제 날짜가 우선입니다.</p>
          </div>
          <div className="flex shrink-0 items-start divide-x divide-[var(--hb-summary-line,#DEC9BA)]">
            <div className="pr-5"><p className={SUMMARY_LABEL_CLASS}>D-day</p><p className={`${SUMMARY_VALUE_CLASS} mt-2`}>{dday !== null ? (dday >= 0 ? dday : `+${Math.abs(dday)}`) : "—"}</p><p className="mt-2 text-[12px] text-[var(--amora-muted)]">{dday === null ? "날짜 미정" : dday > 0 ? "일 남음" : dday === 0 ? "결혼식 당일" : "일 지남"}</p></div>
            <div className="px-5"><p className={SUMMARY_LABEL_CLASS}>체크리스트 진행률</p><p className={`${SUMMARY_VALUE_CLASS} mt-2`}>{progressPct}%</p><p className="mt-2 text-[12px] text-[var(--amora-muted)]">{totalDone}/{totalItems} 완료</p></div>
            <div className="pl-5"><p className={SUMMARY_LABEL_CLASS}>다가오는 일정</p><p className={`${SUMMARY_VALUE_CLASS} mt-2`}>{upcomingCount}</p><p className="mt-2 text-[12px] text-[var(--amora-muted)]">등록한 일정 기준</p></div>
          </div>
        </div>
        <div className={`${FEATURE_SUMMARY_CLASS} grid grid-cols-2 lg:hidden`}>
          <div className="border-r border-[var(--hb-summary-line,#DEC9BA)] px-[15px] py-3.5">
            <p className={SUMMARY_LABEL_CLASS}>D-day</p>
            <p className={`${SUMMARY_VALUE_CLASS} mt-1.5`}>{dday !== null ? (dday >= 0 ? dday : `+${Math.abs(dday)}`) : "—"}</p>
            <p className="mt-1.5 text-[12px] text-[var(--amora-muted)]">{dday === null ? "날짜 미정" : dday > 0 ? "일 남음" : dday === 0 ? "결혼식 당일" : "일 지남"}</p>
          </div>
          <div className="px-[15px] py-3.5">
            <p className={SUMMARY_LABEL_CLASS}>다가오는 일정</p>
            <p className={`${SUMMARY_VALUE_CLASS} mt-1.5`}>{upcomingCount}</p>
            <p className="mt-1.5 text-[12px] text-[var(--amora-muted)]">등록한 일정 기준</p>
          </div>
          <div className="col-span-2 border-t border-[var(--hb-summary-line,#DEC9BA)] px-[15px] py-3.5">
            <div className="flex items-end justify-between gap-3"><div><p className={SUMMARY_LABEL_CLASS}>체크리스트 진행률</p><p className={`${SUMMARY_VALUE_CLASS} mt-1.5`}>{progressPct}%</p></div><p className="text-[12px] text-[var(--amora-muted)]">{totalDone}/{totalItems} 완료</p></div>
            <ScheduleProgress value={progressPct} label="체크리스트 진행률" className="mt-2.5" />
          </div>
        </div>
        <p className="text-[11px] leading-[1.7] text-[var(--amora-muted)] lg:hidden">기본 체크리스트와 확인 시점은 시작을 돕는 예시이며, 업체나 가족과 정한 실제 일정이 우선입니다.</p>

        <div className={`grid grid-cols-1 gap-6 ${viewMode === "calendar" ? "lg:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
          {viewMode === "calendar" && <div className="hidden min-w-0 lg:block"><PreparationTimeline events={activeEvents} items={imminentCategories} today={todayStr} weddingDate={weddingDateValue} assigneeContext={assigneeContext} onAddEvent={handleAddEventQuick} onEditEvent={handleEditEvent} onCategoryClick={handleCategoryClick} onScheduleClick={handleScheduleCategory} mutationBlocked={Boolean(eventMutationBlockReason)} /></div>}
          <div className="min-w-0 space-y-3.5 lg:space-y-5">
          {hasUpcoming && <div className="lg:hidden">{upcomingPanel}</div>}

          {/* Left: View toggle + Timeline/Calendar (2 cols) */}
          <div className="overflow-hidden rounded-[16px] border border-[var(--amora-line)] bg-white">
            {/* View toggle header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] pb-1 pt-[17px]">
              <div className="inline-flex gap-1 rounded-full bg-[var(--amora-warm)] p-1">
                <button
                  type="button"
                  aria-pressed={viewMode === "timeline"}
                  onClick={() => setViewMode("timeline")}
                  className={`tap-area inline-flex items-center rounded-full px-2.5 py-1.5 text-[10.5px] font-medium transition-colors ${
                    viewMode === "timeline"
                      ? "bg-white text-[var(--amora-ink)] shadow-sm"
                      : "text-[var(--hb-text-body)]"
                  }`}
                >
                  <List className="mr-1 h-3 w-3" />
                  단계별 준비
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "calendar"}
                  onClick={() => setViewMode("calendar")}
                  className={`tap-area inline-flex items-center rounded-full px-2.5 py-1.5 text-[10.5px] font-medium transition-colors ${
                    viewMode === "calendar"
                      ? "bg-white text-[var(--amora-ink)] shadow-sm"
                      : "text-[var(--hb-text-body)]"
                  }`}
                >
                  <Calendar className="mr-1 h-3 w-3" />
                  캘린더
                </button>
              </div>
              <button
                onClick={handleAddEventQuick}
                disabled={Boolean(eventMutationBlockReason)}
                className="tap-area inline-flex items-center gap-1 rounded-full border border-[var(--amora-line)] px-2.5 py-1.5 text-[10.5px] font-medium text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                일정 추가
              </button>
            </div>

            {/* Timeline or Calendar content */}
            <div className="px-[18px] pb-[17px] pt-3">
              {viewMode === "timeline" ? (
                <TimelineView
                  progress={progress}
                  onToggleChecklistItem={handleChecklistItemClick}
                  events={activeEvents}
                  onEditEvent={handleEditEvent}
                  onCancelEvent={handleCancelEvent}
                  onAddEvent={handleAddEventQuick}
                  assigneeContext={assigneeContext}
                />
              ) : (
                <CalendarView
                  weddingDate={weddingDate}
                  events={activeEvents}
                  onAddEvent={handleAddEvent}
                  onEditEvent={handleEditEvent}
                  assigneeContext={assigneeContext}
                />
              )}
            </div>
          </div>

          <div className="lg:hidden">{imminentPanel}</div>
          {viewMode === "calendar" && <div className="hidden lg:block"><ScheduleStageSummary items={imminentCategories} /></div>}
          </div>
        </div>

        {cancelledEvents.length > 0 && (
          <section
            aria-labelledby="cancelled-schedule-heading"
            className="rounded-xl border border-[var(--amora-line)] bg-[var(--hb-surface-page)] p-4 shadow-[var(--shadow-raised)] md:p-5"
          >
            <div className="mb-3">
              <h3
                id="cancelled-schedule-heading"
                className="text-[var(--hb-text-strong)]"
              >
                취소됨
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-[var(--hb-text-body)]">
                완전 삭제하지 않고 변경 기록을 보관합니다. 필요하면 예정 상태로 복원 요청할 수 있어요.
              </p>
            </div>
            <div className="space-y-2">
              {cancelledEvents.map((event) => (
                <article
                  key={`cancelled-${event.id}`}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--amora-line)] bg-white px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-[var(--hb-text-strong)]">
                      {event.title}
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--hb-text-body)]">
                      기존 날짜 {event.date}{event.time ? ` ${event.time}` : ""}
                      {event.cancellation
                        ? ` · 취소 시각 ${ymdInKst(new Date(event.cancellation.cancelledAt))}`
                        : ""}
                    </p>
                    {event.cancellation?.reason && (
                      <p className="mt-1 text-[12px] leading-5 text-[var(--hb-text-body)]">
                        사유 · {event.cancellation.reason}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestoreEvent(event.id).catch(() => undefined)}
                    disabled={restoringEventId !== null}
                    aria-busy={restoringEventId === event.id}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--amora-action,var(--hb-action))] px-4 py-2 text-[13px] font-semibold text-[var(--amora-action,var(--hb-action))] transition-colors hover:bg-[var(--amora-action-hover,var(--hb-action-hover))] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {restoringEventId === event.id ? "요청 보내는 중..." : "복원 요청"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 체크리스트 모달 */}
        <CategoryChecklistModal
          categoryKey={selectedCategory ?? ""}
          isOpen={!!selectedCategory}
          onClose={() => setSelectedCategory(null)}
        />

        <ChecklistSchedulePrompt
          pending={pendingChecklistSchedule}
          onClose={() => setPendingChecklistSchedule(null)}
          onComplete={completeChecklistWithSchedule}
          scheduleMutationBlockReason={eventMutationBlockReason}
          saveError={journeyError}
        />

        {/* 이벤트 추가/수정 모달 */}
        <EventFormModal
          isOpen={eventFormMode !== null}
          mode={eventFormMode ?? "add"}
          event={editingEvent}
          defaultDate={selectedDateForAdd}
          defaultCategoryKey={eventFormCategoryKey}
          assigneeContext={assigneeContext}
          onSave={handleSaveEvent}
          onCancel={editingEvent ? () => handleCancelEvent(editingEvent.id) : undefined}
          onClose={() => {
            setEventFormMode(null);
            setEditingEvent(null);
            setSelectedDateForAdd(null);
            setEventFormCategoryKey("");
          }}
        />
      </div>
    </div>
  );
}

export function ChecklistSchedulePrompt({
  pending,
  onClose,
  onComplete,
  scheduleMutationBlockReason,
  saveError,
}: {
  pending: PendingChecklistSchedule | null;
  onClose: () => void;
  onComplete: (data: { date?: string; memo?: string }) => Promise<void>;
  scheduleMutationBlockReason?: string | null;
  /** 저장 실패 문구. 창 밖 배너는 이 오버레이에 가려 보이지 않으므로 여기서도 보여준다. */
  saveError?: string;
}) {
  const [date, setDate] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pending) return;
    setDate(pending.existingEvent?.date ?? "");
    setMemo(
      sanitizeUserFacingScheduleMemo(pending.existingEvent?.memo)
      ?? pending.itemLabel,
    );
  }, [pending]);

  if (!pending) return null;

  const saveWithDate = async () => {
    if (!date || saving) return;
    setSaving(true);
    try {
      await onComplete({
        date,
        memo: sanitizeUserFacingScheduleMemo(memo),
      });
    } finally {
      setSaving(false);
    }
  };

  const completeOnly = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onComplete({});
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-50 animate-fade-in bg-[var(--amora-ink)]/40 backdrop-blur-sm"
      />
      <section role="dialog" aria-modal="true" aria-labelledby="checklist-schedule-prompt-title" className="fixed inset-x-4 top-[5dvh] z-50 mx-auto flex max-h-[90dvh] max-w-[540px] flex-col overflow-hidden rounded-[18px] border border-[var(--amora-line)] bg-white shadow-[var(--shadow-overlay)] animate-fade-in">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-5 py-5 sm:px-6">
          <div>
            <p className="text-[12px] font-semibold text-[var(--hb-text-strong)]">
              체크리스트 일정 연결
            </p>
            <h3 id="checklist-schedule-prompt-title" className="planning-display mt-1 text-[20px] leading-[1.4] text-[var(--amora-ink)]">
              {pending.categoryLabel} 날짜도 정할까요?
            </h3>
            <p className="mt-2 text-[13px] font-medium leading-[1.6] text-[var(--hb-text-body)]">
              {pending.itemLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="일정 연결 닫기"
            className="tap-area flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--amora-muted)] transition-colors hover:bg-[var(--amora-warm)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <label htmlFor="checklist-schedule-date" className="mb-1.5 block text-[12px] font-semibold text-[var(--amora-soft)]">
              날짜
            </label>
            <input
              id="checklist-schedule-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="w-full rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3 text-[15px] font-medium text-[var(--hb-text-strong)] outline-none transition-all focus:border-[var(--hb-primary)] focus:bg-white focus:ring-2 focus:ring-[var(--hb-primary)]/15"
            />
          </div>
          <div>
            <label htmlFor="checklist-schedule-memo" className="mb-1.5 block text-[12px] font-semibold text-[var(--amora-soft)]">
              메모
            </label>
            <textarea
              id="checklist-schedule-memo"
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-4 py-3 text-[14px] font-medium leading-[1.65] text-[var(--hb-text-strong)] outline-none transition-all focus:border-[var(--hb-primary)] focus:bg-white focus:ring-2 focus:ring-[var(--hb-primary)]/15"
            />
          </div>
          {pending.existingEvent && (
            <p className="rounded-xl bg-[var(--hb-primary)]/10 px-4 py-3 text-[13px] font-medium leading-[1.55] text-[var(--hb-text-strong)]">
              이미 등록된 {pending.categoryLabel} 일정이 있어요. 저장하면 새로 만들지 않고 기존 일정 날짜를 바꿉니다.
            </p>
          )}
          {(scheduleMutationBlockReason || saveError) && (
            <p
              role="alert"
              className="rounded-xl border border-[#E5B8B8] bg-[#FFF6F6] px-4 py-3 text-[13px] font-medium leading-[1.55] text-[#8C3E3E]"
            >
              {scheduleMutationBlockReason ?? saveError}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--hb-hairline)] bg-[var(--hb-surface-page)] px-6 py-4 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={completeOnly}
            disabled={saving}
            className="rounded-xl border border-[var(--hb-hairline)] bg-white px-4 py-2.5 text-[13px] font-semibold text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-warm)] disabled:opacity-50"
          >
            날짜 없이 완료
          </button>
          <button
            type="button"
            onClick={saveWithDate}
            disabled={saving || !date || Boolean(scheduleMutationBlockReason)}
            className="rounded-xl bg-[var(--amora-action,var(--hb-action))] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--amora-action-hover,var(--hb-action-hover))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending.existingEvent ? "일정 수정하고 완료" : "일정 저장하고 완료"}
          </button>
        </div>
      </section>
    </>
  );
}
