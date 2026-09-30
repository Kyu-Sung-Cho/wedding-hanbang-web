"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { buttonFocusFix, cx, noteText } from "./styles";

export interface ResultHeaderProps {
  /**
   * 코드 복사로 나가는 글(copy.codeCopyText 의 결과). 코드가 없는 결과(관문)이면 null이고 복사 단추를 그리지 않는다.
   * 글자와 뜻과 세기만 담고 답과 고지 문장은 담지 않는다.
   */
  readonly copyText: string | null;
  /**
   * 코드 복사. 글을 받아 클립보드에 넣고 실제로 복사했는지 돌려준다(true 일 때만 성공으로 말한다).
   * false 가 오거나 던지면 복사하지 못했다고 알리고 직접 복사할 수 있게 글을 보여 준다. 이용 통계(복사 성공일 때만)는 부모가 한다.
   */
  readonly onCopyCode: (text: string) => boolean | Promise<boolean>;
  /** 제목 수준. 라운지 안(embedded)에서는 바깥 화면의 제목 아래라서 2를 준다. 기본 1. */
  readonly headingLevel?: 1 | 2;
  /**
   * 제목 아래 고지 문장. 기본은 결과 화면의 고지(글자가 달라질 수 있다는 말이 든다). 글자가 없는 결과(관문)에서는 그 말이 맞지 않아서
   * 부모가 받는 사람 화면의 고지(글자 이야기가 없는 같은 뜻의 문장)를 준다. 어느 쪽이든 「검증을 마친 심리검사가 아니」가 한 번 든다.
   */
  readonly notice?: string;
}

type CopyState = "idle" | "pending" | "copied" | "failed";

/**
 * 결과 맨 위: 제목 「웨딩코드 · 내 결과」, 오른쪽 위 작은 「코드 복사」, 제목 바로 아래에 「검증을 마친 심리검사가 아니」라는 고지 한 문장(이 화면에서 한 번).
 * 복사 단추 아래에 글자와 뜻, 세기만 복사하고 상대가 답하기 전에는 보내지 않는 게 좋다는 안내가 붙는다.
 * 복사했다는 말은 부모가 true 를 돌려준 뒤에만 나온다. 부모가 false 를 주면 복사가 안 됐다고 말하고 복사할 글을 읽기 전용 칸에 보여 준다.
 */
export function ResultHeader({ copyText, onCopyCode, headingLevel = 1, notice = V40_COPY.result.notice }: ResultHeaderProps) {
  const [state, setState] = useState<CopyState>("idle");
  const mounted = useRef(true);
  const ids = useId();
  const hintId = `${ids}-hint`;
  const statusId = `${ids}-status`;
  const Heading = headingLevel === 1 ? "h1" : "h2";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function copy() {
    if (copyText === null || state === "pending") return;
    setState("pending");
    let copied = false;
    try {
      copied = (await onCopyCode(copyText)) === true;
    } catch {
      copied = false;
    }
    if (mounted.current) setState(copied ? "copied" : "failed");
  }

  const status = state === "copied" ? V40_COPY.copyCode.copied : state === "failed" ? V40_COPY.copyCode.failed : "";

  return (
    <header data-result-section="header">
      <div className="flex items-start justify-between gap-3">
        <Heading className="min-w-0 flex-1 break-keep text-xl font-semibold leading-snug text-[var(--hb-text-strong)]">
          {V40_COPY.result.title}
        </Heading>
        {copyText !== null ? (
          <Button
            variant="secondary"
            size="sm"
            aria-describedby={hintId}
            // 복사하는 동안 단추를 끄지 않는다(끄면 초점을 받은 단추가 초점을 잃고 키보드 사용자는 자리를 잃는다). 중복 누름은 copy() 가 막는다.
            aria-busy={state === "pending"}
            onClick={() => void copy()}
            className={cx("shrink-0", buttonFocusFix)}
          >
            {V40_COPY.copyCode.button}
          </Button>
        ) : null}
      </div>
      <p data-result-notice className="mt-2 text-sm leading-relaxed text-[var(--hb-text-body)]">
        {notice}
      </p>
      {copyText !== null ? (
        <p id={hintId} className={cx(noteText, "mt-2")}>
          {V40_COPY.copyCode.hint}
        </p>
      ) : null}
      <p id={statusId} role="status" aria-live="polite" aria-atomic="true" data-copy-status={state} className={cx(noteText, status !== "" && "mt-2 font-medium")}>
        {status}
      </p>
      {state === "failed" && copyText !== null ? (
        <textarea
          readOnly
          rows={3}
          value={copyText}
          aria-labelledby={statusId}
          onFocus={(event) => event.currentTarget.select()}
          className="mt-2 w-full resize-none rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)]"
        />
      ) : null}
    </header>
  );
}

export default ResultHeader;
