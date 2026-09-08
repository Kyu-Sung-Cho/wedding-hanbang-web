"use client";

import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";

type AmoraSheetFrameProps = {
  title: string;
  description: string;
  disabled: boolean;
  busy: boolean;
  applyLabel: string;
  applyAriaLabel?: string;
  notice?: string | null;
  error?: string | null;
  children: ReactNode;
  onConfirm(): void;
  onClose(): void;
  onDefer(): void;
};

export default function AmoraSheetFrame({
  title, description, disabled, busy, applyLabel, applyAriaLabel,
  notice, error, children, onConfirm, onClose, onDefer,
}: AmoraSheetFrameProps) {
  const titleId = useId();
  const descriptionId = useId();
  const close = () => { if (!busy) onClose(); };
  const dialogRef = useAccessibleModal({
    open: true,
    onClose: close,
    initialFocusSelector: "[data-amora-sheet-title]",
    respectExistingScrollLock: true,
  });

  return createPortal(
    <div
      className="amora-workspace fixed inset-0 z-[140] flex items-end justify-center bg-[#26251f]/50 sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        data-amora-sheet
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-[var(--amora-surface)] px-5 pt-2.5 pb-[max(24px,env(safe-area-inset-bottom))] text-[var(--amora-ink)] shadow-[0_-14px_40px_rgba(38,37,31,0.22)] sm:w-[430px] sm:rounded-[22px] sm:pb-6"
      >
        <div aria-hidden="true" className="mx-auto mb-[18px] h-1 w-[38px] shrink-0 rounded-full bg-[var(--amora-line)]" />
        <button
          type="button"
          onClick={close}
          disabled={busy}
          aria-label="확인 창 닫기"
          className="absolute top-3 right-2 flex size-11 items-center justify-center rounded-full text-[var(--amora-muted)] hover:bg-[var(--amora-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-40"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        <h2 id={titleId} data-amora-sheet-title tabIndex={-1} className="shrink-0 pr-8 text-[18px] leading-7 font-semibold outline-none">
          {title}
        </h2>
        <div data-amora-sheet-content tabIndex={0} aria-label="확인할 내용" className="mt-1 min-h-0 overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--amora-accent)]">
          <p id={descriptionId} className="mb-[18px] text-[12.5px] leading-[1.6] text-[var(--amora-muted)]">
            {description}
          </p>
          {children}
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-[9px] [@media(max-height:500px)]:grid-cols-2">
          {(error || notice) && (
            <p role={error ? "alert" : "status"} className={`col-span-full max-h-[18dvh] overflow-y-auto rounded-xl px-3.5 py-3 text-[12.5px] leading-[1.6] ${error ? "bg-[#FFF2EF] text-[#8A3D31]" : "bg-[var(--amora-warm)] text-[var(--amora-soft)]"}`}>
              {error || notice}
            </p>
          )}
          <button
            type="button"
            data-amora-confirm
            onClick={onConfirm}
            disabled={disabled}
            aria-label={applyAriaLabel ?? applyLabel}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--amora-ink)] px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--amora-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {applyLabel}
          </button>
          <button
            type="button"
            onClick={onDefer}
            disabled={busy}
            className="min-h-[52px] rounded-xl border border-[var(--hb-outline-strong,#8F8A7A)] bg-white px-4 py-3 text-[15px] font-semibold text-[var(--amora-soft)] transition-colors hover:bg-[var(--amora-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-45"
          >
            나중에 정하기
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
