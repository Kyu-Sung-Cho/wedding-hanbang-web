"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Sparkles, X } from "lucide-react";

const MAX_MEDIATION_SUMMARY_CHARS = 600;

interface MediationConsentDialogProps {
  onCancel: () => void;
  onConfirm: (requesterSummary: string) => void | Promise<void>;
}

/**
 * 구조화 중재 요청의 명시적 데이터 경계.
 *
 * 대화 원문을 자동 채우지 않고, 요청자가 이 창에 직접 적은 요약만 전달한다.
 * 취소는 callback 외에 어떤 저장/전송도 만들지 않는다.
 */
export default function MediationConsentDialog({
  onCancel,
  onConfirm,
}: MediationConsentDialogProps) {
  const [summary, setSummary] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedSummary = summary.trim();
  const canSubmit = trimmedSummary.length >= 4;

  useEffect(() => {
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey
        && (document.activeElement === first
          || !dialogRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey
        && (document.activeElement === last
          || !dialogRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    void onConfirm(trimmedSummary);
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/35 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md rounded-[6px] bg-white p-5 shadow-2xl"
      >
        <button
          type="button"
          onClick={onCancel}
          aria-label="조율 초안 요청 취소"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-[#8B817A] hover:bg-[#F6F3F1]"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="pr-9">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#F3E9E4] text-[var(--hb-accent-hover)]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <h2 id={titleId} className="text-lg font-semibold text-[var(--hb-text-strong)]">
            아모라에게 조율 초안을 요청할까요?
          </h2>
          <p
            id={descriptionId}
            className="mt-2 text-sm leading-relaxed text-[#5E5650]"
          >
            상대방에게 직접 보낸 메시지나 비공개 대화는 자동으로 가져오지
            않아요. 아래에 내가 직접 적은 요약만 조율 요청으로 추가돼요.
          </p>
        </div>

        <form className="mt-4" onSubmit={submit}>
          <label
            htmlFor={`${titleId}-summary`}
            className="text-sm font-medium text-[#2B2928]"
          >
            내가 전달할 상황 요약
          </label>
          <textarea
            ref={textareaRef}
            id={`${titleId}-summary`}
            value={summary}
            maxLength={MAX_MEDIATION_SUMMARY_CHARS}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="예: 결혼식장 예산 상한선을 두고 의견이 달라요."
            className="mt-2 min-h-28 w-full resize-y rounded-[6px] border border-[#D8CEC6] bg-white px-3.5 py-3 text-sm leading-relaxed text-[var(--hb-text-strong)] outline-none placeholder:text-[#A49B95] border-[var(--hb-accent)] focus:ring-2 focus:ring-[#795252]/15"
          />
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <p className="text-xs leading-relaxed text-[#746A63]">
              초안은 판결이 아니며, 두 사람이 각각 확인해야 공동 결정으로 남아요.
            </p>
            <span className="shrink-0 text-xs text-[#938A84]">
              {summary.length}/{MAX_MEDIATION_SUMMARY_CHARS}
            </span>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-[6px] border border-[#D8CEC6] bg-white px-4 text-sm font-medium text-[#514A45] hover:bg-[#F8F5F3]"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 flex-[1.4] rounded-[6px] bg-[var(--hb-action)] px-4 text-sm font-medium text-white hover:bg-[var(--hb-action-hover)] disabled:cursor-not-allowed disabled:opacity-45"
            >
              이 요약으로 초안 요청
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
