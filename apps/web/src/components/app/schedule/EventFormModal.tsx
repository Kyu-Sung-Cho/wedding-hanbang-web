"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Ban, CalendarDays } from "lucide-react";
import type {
  ScheduleEvent,
  ScheduleEventAssignee,
  ScheduleEventStatus,
} from "@/types/database.types";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import {
  getScheduleEventStatus,
  isValidScheduleProfileId,
  sanitizeUserFacingScheduleMemo,
  ScheduleEventCapacityError,
  ScheduleEventValidationError,
  SCHEDULE_EVENT_STRING_LIMITS,
  type ScheduleEventAssigneeContext,
} from "@/utils/scheduleEvents";

const CATEGORY_OPTIONS = [
  { key: "", label: "카테고리 선택 (선택사항)" },
  { key: "general", label: "일반 (모임, 상담 등)" },
  ...Object.entries(PLANNING_CATEGORY_LABELS)
    .filter(([key]) => key !== "reserve")
    .map(([key, label]) => ({ key, label })),
];

const INVALID_FIELD_MESSAGES: Record<string, string> = {
  date: "날짜를 다시 확인해 주세요.",
  time: "시간을 00:00~23:59 형식으로 다시 확인해 주세요.",
  title: "일정 제목을 다시 확인해 주세요.",
  memo: "메모는 2,000자 이내로 적어 주세요.",
  categoryKey: "관련 카테고리를 다시 선택해 주세요.",
  sourceKey: "일정 연결 정보를 다시 확인해 주세요.",
  momentType: "일정 종류를 다시 확인해 주세요.",
  status: "진행 상태를 다시 선택해 주세요.",
  completionCriteria: "완료 기준은 500자 이내의 한 줄로 적어 주세요.",
  assignee: "담당자를 다시 선택해 주세요.",
};

function getSaveErrorMessage(error: unknown, action: "save" | "cancel"): string {
  if (error instanceof ScheduleEventCapacityError) {
    return "일정 저장 한도에 도달했어요. 기존 일정을 정리한 뒤 다시 시도해 주세요.";
  }
  if (error instanceof ScheduleEventValidationError) {
    return INVALID_FIELD_MESSAGES[error.field]
      ?? "입력한 일정 내용을 다시 확인해 주세요.";
  }
  return action === "save"
    ? "일정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."
    : "일정 취소 요청을 보내지 못했어요. 잠시 후 다시 시도해 주세요.";
}

interface Props {
  isOpen: boolean;
  mode: "add" | "edit";
  event: ScheduleEvent | null;
  defaultDate: string | null;
  /**
   * 새 일정에 미리 채워 둘 분야. 「날짜를 정할 항목」에서 바로 날짜를 잡을 때 쓴다 —
   * 그 패널은 이미 어느 분야인지 알고 있으므로 사용자가 다시 고를 이유가 없다.
   */
  defaultCategoryKey?: string;
  assigneeContext?: ScheduleEventAssigneeContext;
  onSave: (data: {
    date: string;
    time?: string;
    title: string;
    memo?: string;
    categoryKey?: string;
    status: ScheduleEventStatus;
    completionCriteria?: string;
    assignee?: ScheduleEventAssignee;
  }) => Promise<void>;
  onCancel?: () => Promise<void>;
  onClose: () => void;
}

export default function EventFormModal({
  isOpen,
  mode,
  event,
  defaultDate,
  defaultCategoryKey,
  assigneeContext = {},
  onSave,
  onCancel,
  onClose,
}: Props) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [status, setStatus] = useState<ScheduleEventStatus>("planned");
  const [completionCriteria, setCompletionCriteria] = useState("");
  const [assigneeSelection, setAssigneeSelection] = useState("unassigned");
  const [externalAssigneeLabel, setExternalAssigneeLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setError("");
    setConfirmingCancel(false);
    if (mode === "edit" && event) {
      setTitle(event.title);
      setDate(event.date);
      setTime(event.time ?? "");
      setMemo(sanitizeUserFacingScheduleMemo(event.memo) ?? "");
      setCategoryKey(event.categoryKey ?? "");
      setStatus(getScheduleEventStatus(event));
      setCompletionCriteria(event.completionCriteria ?? "");
      setAssigneeSelection(
        event.assignee?.kind === "member"
          ? `member:${event.assignee.profileId}`
          : event.assignee?.kind ?? "unassigned",
      );
      setExternalAssigneeLabel(
        event.assignee?.kind === "external" ? event.assignee.label : "",
      );
    } else {
      setTitle("");
      setDate(defaultDate ?? "");
      setTime("");
      setMemo("");
      setCategoryKey(defaultCategoryKey ?? "");
      setStatus("planned");
      setCompletionCriteria("");
      setAssigneeSelection("unassigned");
      setExternalAssigneeLabel("");
    }
  }, [isOpen, mode, event, defaultDate, defaultCategoryKey]);

  const memberOptions = useMemo(() => {
    const options: Array<{ id: string; label: string }> = [];
    if (
      assigneeContext.viewer
      && isValidScheduleProfileId(assigneeContext.viewer.id)
    ) {
      options.push({
        id: assigneeContext.viewer.id,
        label: `${assigneeContext.viewer.name?.trim() || "나"} (나)`,
      });
    }
    if (
      assigneeContext.partner
      && isValidScheduleProfileId(assigneeContext.partner.id)
      && assigneeContext.partner.id !== assigneeContext.viewer?.id
    ) {
      options.push({
        id: assigneeContext.partner.id,
        label: `${assigneeContext.partner.name?.trim() || "파트너"} (파트너)`,
      });
    }

    const existingMemberId =
      event?.assignee?.kind === "member"
        ? event.assignee.profileId
        : null;
    if (
      existingMemberId
      && isValidScheduleProfileId(existingMemberId)
      && !options.some((option) => option.id === existingMemberId)
    ) {
      options.push({
        id: existingMemberId,
        label: "연결이 끊긴 기존 담당자",
      });
    }
    return options;
  }, [assigneeContext.partner, assigneeContext.viewer, event]);

  const buildAssignee = (): ScheduleEventAssignee | undefined => {
    if (assigneeSelection === "unassigned") return undefined;
    if (assigneeSelection === "couple") {
      if (
        !assigneeContext.partner
        || !isValidScheduleProfileId(assigneeContext.partner.id)
      ) {
        throw new Error("파트너 연결을 확인하지 못했어요. 담당자를 다시 선택해 주세요.");
      }
      return { kind: "couple" };
    }
    if (assigneeSelection === "external") {
      const label = externalAssigneeLabel.trim();
      if (
        !label
        || label.length > SCHEDULE_EVENT_STRING_LIMITS.externalAssigneeLabel
      ) {
        throw new Error("외부 담당은 80자 이내의 역할명으로 적어 주세요.");
      }
      return { kind: "external", label };
    }
    if (assigneeSelection.startsWith("member:")) {
      const profileId = assigneeSelection.slice("member:".length);
      if (
        !isValidScheduleProfileId(profileId)
        || !memberOptions.some((option) => option.id === profileId)
      ) {
        throw new Error("담당자 연결 정보를 확인하지 못했어요. 다시 선택해 주세요.");
      }
      return { kind: "member", profileId };
    }
    throw new Error("담당자를 다시 선택해 주세요.");
  };

  const handleSubmit = async () => {
    if (!title.trim() || !date) return;
    setError("");
    let assignee: ScheduleEventAssignee | undefined;
    try {
      assignee = buildAssignee();
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "담당자를 다시 선택해 주세요.",
      );
      return;
    }
    setSaving(true);
    try {
      await onSave({
        date,
        time: time || undefined,
        title: title.trim(),
        memo: memo.trim() || undefined,
        categoryKey: categoryKey || undefined,
        status,
        completionCriteria: completionCriteria.trim() || undefined,
        assignee,
      });
    } catch (saveError) {
      setError(getSaveErrorMessage(saveError, "save"));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!onCancel) return;
    setCancelling(true);
    setError("");
    try {
      await onCancel();
    } catch (cancelError) {
      setError(getSaveErrorMessage(cancelError, "cancel"));
    } finally {
      setCancelling(false);
    }
  };

  if (!isOpen) return null;

  if (mode === "edit" && event && getScheduleEventStatus(event) === "cancelled") {
    return (
      <>
        <div
          onClick={onClose}
          aria-hidden="true"
          className="fixed inset-0 z-50 bg-[#1A1A1F]/40 backdrop-blur-sm"
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancelled-event-edit-title"
          className="fixed inset-x-4 top-[18%] z-50 mx-auto max-w-[440px] rounded-2xl bg-white p-6 shadow-[0_20px_60px_rgb(0,0,0,0.15)]"
        >
          <h3 id="cancelled-event-edit-title" className="text-xl font-semibold text-[#243832]">
            취소된 일정은 바로 수정할 수 없어요
          </h3>
          <p className="mt-3 text-sm leading-6 text-[#5d6879]">
            일정 화면의 취소됨 구역에서 먼저 복원 요청한 뒤 수정해 주세요.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 min-h-11 w-full rounded-xl bg-[#36534E] px-4 py-2.5 text-sm font-semibold text-white"
          >
            확인
          </button>
        </section>
      </>
    );
  }

  return (
    <>
      <div
        onClick={saving || cancelling ? undefined : onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#1A1A1F]/40 backdrop-blur-sm z-50 animate-fade-in"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-event-form-title"
        className="fixed inset-x-4 top-[4%] mx-auto flex max-h-[92vh] max-w-[480px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgb(0,0,0,0.15)] z-50 animate-fade-in"
      >
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-[#795252]/10 flex items-center justify-center">
                <CalendarDays className="w-5 h-5 text-[#795252]" />
              </div>
              <h3
                id="schedule-event-form-title"
                className="font-serif-kr text-2xl font-light text-[#1A1A1F]"
              >
                {mode === "edit" ? "일정 수정" : "일정 추가"}
              </h3>
            </div>
            <button
              onClick={onClose}
              type="button"
              aria-label="일정 창 닫기"
              disabled={saving || cancelling}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-[#8f857b] transition-colors hover:bg-[#F6F3F2]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 폼 */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {/* 제목 */}
          <div>
            <label
              htmlFor="schedule-title"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              제목 <span className="text-[#795252]">*</span>
            </label>
            <input
              id="schedule-title"
              name="schedule-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={SCHEDULE_EVENT_STRING_LIMITS.title}
              placeholder="예: 드레스 입어보기, 친구들에게 초대장 전달"
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            />
          </div>

          {/* 날짜 */}
          <div>
            <label
              htmlFor="schedule-date"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              날짜 <span className="text-[#795252]">*</span>
            </label>
            <input
              id="schedule-date"
              name="schedule-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            />
          </div>

          {/* 시간 */}
          <div>
            <label
              htmlFor="schedule-time"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              시간
            </label>
            <input
              id="schedule-time"
              name="schedule-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              step={60}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            />
            <p className="mt-1.5 text-xs leading-5 text-[#7a746e]">
              선택 사항이며 입력한 현지 시각 그대로 표시해요.
            </p>
          </div>

          {/* 메모 */}
          <div>
            <label
              htmlFor="schedule-memo"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              메모
            </label>
            <textarea
              id="schedule-memo"
              name="schedule-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={SCHEDULE_EVENT_STRING_LIMITS.memo}
              placeholder="예: 강남 드레스샵 오후 2시, 참석자 지은/수현"
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all resize-none"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label
              htmlFor="schedule-category"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              관련 카테고리
            </label>
            <select
              id="schedule-category"
              name="schedule-category"
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="schedule-assignee"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              담당
            </label>
            <select
              id="schedule-assignee"
              name="schedule-assignee"
              value={assigneeSelection}
              onChange={(e) => {
                setAssigneeSelection(e.target.value);
                setError("");
              }}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            >
              <option value="unassigned">담당 미정</option>
              {memberOptions.map((option) => (
                <option key={option.id} value={`member:${option.id}`}>
                  {option.label}
                </option>
              ))}
              {assigneeContext.partner
                && isValidScheduleProfileId(assigneeContext.partner.id)
                && (
                <option value="couple">함께</option>
                )}
              <option value="external">외부 담당</option>
            </select>
            <p className="mt-1.5 text-xs leading-5 text-[#7a746e]">
              {assigneeSelection === "couple"
                || assigneeSelection === `member:${assigneeContext.partner?.id}`
                ? "담당 표시는 함께 보는 일정에 저장되며, 파트너의 수락을 대신하지 않아요."
                : "파트너를 연결하지 않아도 혼자 일정을 관리할 수 있어요."}
            </p>
          </div>

          {assigneeSelection === "external" && (
            <div>
              <label
                htmlFor="schedule-external-assignee"
                className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
              >
                외부 담당 역할
              </label>
              <input
                id="schedule-external-assignee"
                name="schedule-external-assignee"
                type="text"
                value={externalAssigneeLabel}
                onChange={(e) => setExternalAssigneeLabel(e.target.value)}
                maxLength={SCHEDULE_EVENT_STRING_LIMITS.externalAssigneeLabel}
                placeholder="예: 가족, 웨딩 플래너"
                className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="schedule-completion-criteria"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              완료 기준
            </label>
            <textarea
              id="schedule-completion-criteria"
              name="schedule-completion-criteria"
              value={completionCriteria}
              onChange={(e) => setCompletionCriteria(e.target.value)}
              maxLength={SCHEDULE_EVENT_STRING_LIMITS.completionCriteria}
              placeholder="예: 계약서를 확인하고 예약금 입금까지"
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] placeholder:text-[#B5ADA3] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all resize-none"
            />
          </div>

          <div>
            <label
              htmlFor="schedule-status"
              className="block text-sm uppercase tracking-widest text-[#B5ADA3] mb-1.5"
            >
              진행 상태
            </label>
            <select
              id="schedule-status"
              name="schedule-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ScheduleEventStatus)}
              className="w-full px-4 py-3 rounded-xl bg-[#F6F3F2] text-base text-[#1A1A1F] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#795252]/30 transition-all"
            >
              <option value="planned">예정</option>
              <option value="completed">완료</option>
            </select>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-[#E5B8B8] bg-[#FFF6F6] px-3 py-2 text-sm leading-5 text-[#8C3E3E]"
            >
              {error}
            </p>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="px-6 py-4 bg-[#FAFAF8] flex items-center justify-between">
          {mode === "edit" && onCancel ? (
            confirmingCancel ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[#36534E]">
                  일정 취소 요청
                </span>
                <button
                  onClick={handleCancel}
                  type="button"
                  disabled={cancelling || saving}
                  className="min-h-11 rounded-lg bg-[#36534E] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#2d4642] disabled:opacity-50"
                >
                  {cancelling ? "요청 중..." : "취소 요청 보내기"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  type="button"
                  disabled={cancelling || saving}
                  className="min-h-11 rounded-lg px-3 py-2 text-sm text-[#504444] hover:bg-[#F6F3F2] disabled:opacity-50"
                >
                  닫기
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingCancel(true)}
                type="button"
                disabled={cancelling || saving}
                className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-[#36534E] transition-colors hover:bg-[#f7f3ec] disabled:opacity-50"
              >
                <Ban className="h-4 w-4" />
                일정 취소 요청
              </button>
            )
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              type="button"
              disabled={saving || cancelling}
              className="min-h-11 px-4 py-2.5 rounded-xl text-base text-[#504444] hover:bg-[#F6F3F2] transition-colors"
            >
              취소
            </button>
            <button
              onClick={handleSubmit}
              type="button"
              disabled={saving || cancelling || !title.trim() || !date}
              className="min-h-11 px-5 py-2.5 rounded-xl text-base font-medium text-white bg-[#795252] hover:bg-[#946a6a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_16px_rgb(121,82,82,0.2)]"
            >
              {saving
                ? "저장 중..."
                : mode === "edit"
                ? "수정"
                : "추가"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
