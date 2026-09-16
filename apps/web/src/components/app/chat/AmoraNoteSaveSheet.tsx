"use client";

import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";

import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, CircleCheck, Info } from "lucide-react";
import AmoraSheetFrame from "./AmoraSheetFrame";
import { renderAiMarkdown } from "./renderAiMarkdown";

type AmoraNoteSaveSheetProps = {
  content: string;
  busy: boolean;
  error: string | null;
  onSave(memo: string): void;
  onClose(): void;
};

export default function AmoraNoteSaveSheet({ content, busy, error, onSave, onClose }: AmoraNoteSaveSheetProps) {
  const [memo, setMemo] = useState("");
  const [memoExpanded, setMemoExpanded] = useState(false);
  const memoId = useId();
  const memoPanelId = useId();
  const memoRef = useRef<HTMLTextAreaElement>(null);
  const memoToggleRef = useRef<HTMLButtonElement>(null);
  const source = content.trim();
  // 저장되는 원문과 같은 범위를 먼저 자른 뒤 내부 출력을 가린다.
  const excerpt = source.slice(0, 4_000).replace(/[\uD800-\uDBFF]$/, "");
  const preview = getAmoraVisibleText(excerpt);

  useEffect(() => {
    if (memoExpanded) memoRef.current?.focus();
  }, [memoExpanded]);

  const toggleMemo = () => {
    if (memoExpanded) memoToggleRef.current?.focus();
    setMemoExpanded(!memoExpanded);
  };

  return (
    <AmoraSheetFrame
      title="이 답변을 저장할까요?"
      description="결정 보드의 ‘저장한 답변’에 보관해요. 답변과 메모는 두 분이 함께 봐요."
      disabled={busy || !preview || memo.length > 500}
      busy={busy}
      applyLabel={busy ? "저장하는 중…" : "답변 저장"}
      error={error}
      onConfirm={() => onSave(memo.trim())}
      onClose={onClose}
      onDefer={onClose}
    >
      <div className="mb-4">
        <p className="mb-[7px] text-[12px] text-[var(--amora-muted)]">저장할 답변</p>
        <div className="max-h-[28dvh] overflow-y-auto overscroll-contain rounded-[11px] border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3.5 py-[13px] text-[14.5px] leading-[1.6] whitespace-pre-wrap break-words" tabIndex={0} aria-label="저장할 답변 원문">
          {renderAiMarkdown(preview)}
        </div>
        {source.length > 4_000 && <p className="mt-1.5 text-[12px] text-[var(--amora-muted)]">긴 답변은 앞 4,000자까지 저장돼요.</p>}
      </div>
      <div className="mb-4">
        <p className="mb-[7px] text-[12px] text-[var(--amora-muted)]">보관 위치</p>
        <span className="inline-flex min-h-11 items-center gap-[7px] rounded-full bg-[var(--amora-ink)] px-4 text-[13.5px] font-semibold text-white">
          <Bookmark className="size-3.5 shrink-0" aria-hidden="true" />결정 보드 · 저장한 답변
        </span>
        <p className="mt-2 flex items-start gap-[7px] text-[12px] leading-[1.55] text-[var(--amora-muted)]">
          <Info className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
          <span>답변을 보관하는 기능이에요. 예산이나 일정, 준비 상태를 바꾸지 않아요.</span>
        </p>
      </div>
      <div className="mb-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor={memoId} className="text-[12px] text-[var(--amora-muted)]">함께 남길 메모 · 선택</label>
          <button ref={memoToggleRef} type="button" onClick={toggleMemo} disabled={busy} aria-expanded={memoExpanded} aria-controls={memoPanelId} className="min-h-11 shrink-0 rounded-lg px-2 text-[12.5px] font-medium text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-45">
            {memoExpanded ? "메모 접기" : memo ? "메모 수정" : "메모 추가"}
          </button>
        </div>
        <div id={memoPanelId} hidden={!memoExpanded}>
          {memoExpanded && <>
            <textarea
              ref={memoRef}
              id={memoId}
              value={memo}
              onChange={event => setMemo(event.target.value)}
              maxLength={500}
              disabled={busy}
              rows={2}
              placeholder="다시 볼 때 기억할 내용을 적어 주세요."
              className="w-full resize-y rounded-[11px] border border-[var(--hb-outline-strong,#8E8377)] bg-[var(--amora-surface)] px-3.5 py-3 text-[16px] leading-[1.6] text-[var(--amora-ink)] placeholder:text-[var(--amora-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-50"
            />
            <p className="mt-1 text-right text-[12px] text-[var(--amora-muted)]">{memo.length}/500</p>
          </>}
        </div>
      </div>
      <div className="mb-[18px] flex items-start gap-2.5 rounded-xl border border-[var(--amora-line)] bg-[var(--amora-warm)] p-3.5 text-[12.5px] leading-[1.65] text-[var(--amora-soft)]">
        <CircleCheck className="mt-1 size-4 shrink-0 text-[var(--amora-rose-deep)]" aria-hidden="true" />
        <div>
          <p className="mb-1 font-semibold text-[var(--amora-ink)]">공개 범위 · 두 분이 함께 봐요</p>
          <p>이 답변과 내가 적은 메모도 함께 보여요. 나만 상담한 대화는 여기에 저장할 수 없어요.</p>
        </div>
      </div>
    </AmoraSheetFrame>
  );
}
