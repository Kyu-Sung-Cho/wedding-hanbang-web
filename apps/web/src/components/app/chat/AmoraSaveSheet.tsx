"use client";

import type { ReactNode } from "react";
import { Check, CircleCheck, Info } from "lucide-react";
import AmoraSheetFrame from "./AmoraSheetFrame";

const CHANGE_DETAILS: Record<string, { category: string; effect: string }> = {
  update_budget: { category: "예산", effect: "준비 예산의 총금액을 바꿔요." },
  apply_budget_plan: { category: "예산", effect: "제안한 예산 배분을 한 번에 반영해요." },
  update_category_budget: { category: "예산", effect: "해당 항목의 예산 정보를 바꿔요." },
  add_custom_category: { category: "예산", effect: "새 예산 항목을 추가해요." },
  update_wedding_date: { category: "예식 준비", effect: "준비 정보의 결혼식 날짜를 바꿔요." },
  update_venue: { category: "예식 준비", effect: "준비 정보의 예식장 정보를 바꿔요. 예약을 대신 진행하지 않아요." },
  add_schedule_event: { category: "일정", effect: "준비 일정에 새 일정을 추가해요." },
  log_wedding_event: { category: "일정", effect: "준비 일정에 해당 내용을 기록해요." },
  update_schedule_event: { category: "일정", effect: "기존 일정의 내용을 바꿔요." },
  cancel_schedule_event: { category: "일정", effect: "준비 일정에서 해당 일정을 취소로 표시해요. 업체 예약을 취소하지 않아요." },
  restore_schedule_event: { category: "일정", effect: "취소로 표시한 준비 일정을 다시 복원해요." },
  update_task_status: { category: "체크리스트", effect: "해당 준비 항목의 진행 상태를 바꿔요." },
  toggle_checklist_item: { category: "체크리스트", effect: "해당 체크리스트 항목의 완료 여부를 바꿔요." },
  add_amora_action: { category: "준비 행동", effect: "다음에 할 일을 준비 행동으로 추가해요. 이미 끝낸 일로 표시하지 않아요." },
};

type AmoraSaveSheetProps = {
  confirmation: string;
  tool: string;
  carriedLabel?: string;
  disabled: boolean;
  busy: boolean;
  applyLabel: string;
  applyAriaLabel: string;
  notice?: string | null;
  error?: string | null;
  children?: ReactNode;
  onConfirm(): void;
  onClose(): void;
  onDefer(): void;
};

/** 확인된 제안만 표시한다. 원문 대화나 도구 입력을 편집·공유하는 창이 아니다. */
export default function AmoraSaveSheet({
  confirmation,
  tool,
  carriedLabel,
  disabled,
  busy,
  applyLabel,
  applyAriaLabel,
  notice,
  error,
  children,
  onConfirm,
  onClose,
  onDefer,
}: AmoraSaveSheetProps) {
  const details = CHANGE_DETAILS[tool] ?? {
    category: "준비 정보",
    effect: "지원 여부를 확인할 수 없는 변경은 반영할 수 없어요.",
  };

  return (
    <AmoraSheetFrame
      title="이 내용을 반영할까요?"
      description="함께 보는 준비 정보에 반영할 변경이에요. 아래 내용을 확인해 주세요."
      disabled={disabled}
      busy={busy}
      applyLabel={applyLabel}
      applyAriaLabel={applyAriaLabel}
      notice={notice}
      error={error}
      onConfirm={onConfirm}
      onClose={onClose}
      onDefer={onDefer}
    >

        <div className="mb-4">
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">확인할 내용</p>
          <p className="rounded-[11px] border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3.5 py-[13px] text-[14.5px] leading-[1.5] font-semibold whitespace-pre-wrap break-words">
            {confirmation}
          </p>
        </div>
        <div className="mb-4">
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">제안의 근거</p>
          <div className="rounded-[11px] bg-[var(--amora-warm)] px-3.5 py-3 text-[12.5px] leading-[1.6] text-[var(--amora-muted)]">
            {carriedLabel && <p className="mb-1 font-semibold text-[var(--amora-rose-deep)]">{carriedLabel}</p>}
            <p>아모라가 정리한 제안이에요. 대화에서 요청한 내용과 맞는지 확인해 주세요.</p>
          </div>
        </div>
        <div className="mb-4">
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">분야</p>
          <span className="inline-flex min-h-11 items-center gap-[7px] rounded-full bg-[var(--amora-ink)] px-4 text-[13.5px] font-semibold text-white">
            <Check className="size-3.5" aria-hidden="true" />
            {details.category}
          </span>
          <p className="mt-2 flex items-start gap-[7px] text-[11.5px] leading-[1.55] text-[var(--amora-muted)]">
            <Info className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
            <span>{details.effect}</span>
          </p>
        </div>

        {children}

        <div className="mb-[18px] flex items-start gap-2.5 rounded-xl border border-[var(--amora-line)] bg-[var(--amora-warm)] p-3.5 text-[12.5px] leading-[1.65] text-[var(--amora-soft)]">
          <CircleCheck className="mt-1 size-4 shrink-0 text-[var(--amora-rose-deep)]" aria-hidden="true" />
          <div>
            <p className="mb-1 font-semibold text-[var(--amora-ink)]">공개 범위 · 함께 보는 준비 정보</p>
            <p>확인한 변경은 함께 보는 준비 정보에 반영돼요. 나만 상담한 대화를 이 창에서 공유하지 않아요.</p>
          </div>
        </div>
    </AmoraSheetFrame>
  );
}
