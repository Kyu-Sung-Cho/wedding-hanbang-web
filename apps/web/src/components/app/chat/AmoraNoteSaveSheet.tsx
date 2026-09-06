"use client";

import { useId, useState } from "react";
import { Bookmark, Info } from "lucide-react";
import AmoraSheetFrame from "./AmoraSheetFrame";

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
  const source = content.trim();
  const preview = source.slice(0, 4_000).replace(/[\uD800-\uDBFF]$/, "");

  return (
    <AmoraSheetFrame
      title="저장함에 담을까요?"
      description="두 분이 함께 보는 저장함에 이 답변과 메모를 보관해요. 저장할 내용을 확인해 주세요."
      disabled={busy || !preview || memo.length > 500}
      busy={busy}
      applyLabel={busy ? "저장하는 중…" : "저장함에 담기"}
      error={error}
      onConfirm={() => onSave(memo.trim())}
      onClose={onClose}
      onDefer={onClose}
    >
      <div className="mb-4">
        <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">저장할 답변</p>
        <div className="max-h-[28dvh] overflow-y-auto overscroll-contain rounded-[11px] border border-[var(--amora-line)] bg-[var(--amora-bg)] px-3.5 py-[13px] text-[14.5px] leading-[1.6] whitespace-pre-wrap break-words" tabIndex={0} aria-label="저장할 답변 원문">
          {preview}
        </div>
        {source.length > 4_000 && <p className="mt-1.5 text-[11.5px] text-[var(--amora-muted)]">긴 답변은 앞 4,000자까지 저장돼요.</p>}
      </div>
      <div className="mb-4">
        <p className="mb-[7px] text-[11.5px] text-[var(--amora-muted)]">보관 위치</p>
        <span className="inline-flex min-h-11 items-center gap-[7px] rounded-full bg-[var(--amora-ink)] px-4 text-[13.5px] font-semibold text-white">
          <Bookmark className="size-3.5" aria-hidden="true" />저장함
        </span>
        <p className="mt-2 flex items-start gap-[7px] text-[11.5px] leading-[1.55] text-[var(--amora-muted)]">
          <Info className="mt-0.5 size-[13px] shrink-0" aria-hidden="true" />
          <span>답변을 보관하는 기능이에요. 예산이나 일정, 준비 상태를 바꾸지 않아요.</span>
        </p>
      </div>
      <div className="mb-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor={memoId} className="text-[11.5px] text-[var(--amora-muted)]">함께 남길 메모 · 선택</label>
          <button type="button" onClick={() => setMemoExpanded(!memoExpanded)} disabled={busy} aria-expanded={memoExpanded} className="min-h-11 rounded-lg px-2 text-[12.5px] font-medium text-[var(--amora-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-45">
            {memoExpanded ? "메모 접기" : memo ? "메모 수정" : "메모 추가"}
          </button>
        </div>
        {memoExpanded && <>
        <textarea
          id={memoId}
          value={memo}
          onChange={event => setMemo(event.target.value)}
          maxLength={500}
          disabled={busy}
          rows={2}
          placeholder="다시 볼 때 기억할 내용을 적어 주세요."
          className="w-full resize-y rounded-[11px] border border-[var(--hb-outline-strong,#8F8A7A)] bg-[var(--amora-surface)] px-3.5 py-3 text-[13px] leading-[1.6] text-[var(--amora-ink)] placeholder:text-[var(--amora-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--amora-accent)] disabled:opacity-50"
        />
        <p className="mt-1 text-right text-[11.5px] text-[var(--amora-muted)]">{memo.length}/500</p>
        </>}
      </div>
      <div className="mb-[18px] rounded-xl border border-[var(--amora-line)] bg-[var(--amora-warm)] p-3.5 text-[12.5px] leading-[1.6] text-[var(--amora-soft)]">
        <p className="mb-1 font-semibold">공개 범위 · 두 분이 함께 보는 저장함</p>
        <p>이 답변과 내가 적은 메모도 함께 보여요. 나만 상담한 대화는 여기에 저장할 수 없어요.</p>
      </div>
    </AmoraSheetFrame>
  );
}
