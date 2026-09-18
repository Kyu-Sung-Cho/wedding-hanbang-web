"use client";

import type { ReactNode } from "react";
import { Check, CircleCheck, Info } from "lucide-react";
import {
  AMORA_CHANGE_REVIEW_COPY,
  describeAmoraChange,
  parseBudgetImpactPreview,
  type BudgetImpactPreview,
} from "@hanbang/shared";
import AmoraSheetFrame from "./AmoraSheetFrame";

// 도구별 분야·안내 표와 확인 창 문구는 앱 확인 시트와 같은 것을 쓴다 — `@hanbang/shared` 의
// `amoraChangeReview.ts` 한 곳에 있다(2026-09-18). 여기 따로 적으면 두 화면이 다시 갈라진다.

type AmoraSaveSheetProps = {
  confirmation: string;
  tool: string;
  inputDigest?: string;
  impactPreview?: BudgetImpactPreview | null;
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
  inputDigest,
  impactPreview,
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
  // 호출부는 저장된 제안의 revision을 검사한다. 여기서는 같은 입력인지 다시 확인하고,
  // 기존 0원 항목과 신규 항목을 구분할 수 없는 preview에는 추가·변경을 단정하지 않는다.
  const boundPreview = impactPreview && inputDigest
    ? parseBudgetImpactPreview(impactPreview, { tool, inputDigest, sourceRevision: impactPreview.sourceRevision })
    : null;
  const details = describeAmoraChange(tool, boundPreview);
  const copy = AMORA_CHANGE_REVIEW_COPY;

  return (
    <AmoraSheetFrame
      title={copy.title}
      description={copy.description}
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
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">{copy.confirmationLabel}</p>
          <p className="rounded-[11px] border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3.5 py-[13px] text-[14.5px] leading-[1.5] font-semibold whitespace-pre-wrap break-words">
            {confirmation}
          </p>
        </div>
        <div className="mb-4">
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">{copy.reasonLabel}</p>
          <div className="rounded-[11px] bg-[var(--amora-warm)] px-3.5 py-3 text-[12.5px] leading-[1.6] text-[var(--amora-muted)]">
            {carriedLabel && <p className="mb-1 font-semibold text-[var(--amora-rose-deep)]">{carriedLabel}</p>}
            <p>{copy.reason}</p>
          </div>
        </div>
        <div className="mb-4">
          <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">{copy.categoryLabel}</p>
          <span className="inline-flex min-h-11 items-center gap-[7px] rounded-full bg-[var(--amora-action)] px-4 text-[13.5px] font-semibold text-white">
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
            <p className="mb-1 font-semibold text-[var(--amora-ink)]">{copy.scopeTitle}</p>
            <p>{copy.scopeBody}</p>
          </div>
        </div>
    </AmoraSheetFrame>
  );
}
