"use client";

import AmoraAvatar from "@/components/ui/AmoraAvatar";

import { Loader2 } from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import { getAmoraVisibleText } from "@hanbang/shared/amora-visible-text";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";
import { CHAT_BUBBLE_TONES, INVITATION_CHAT_STYLES, type ChatPresentation } from "./chatBubbleStyles";

interface StreamingBubbleProps {
  /** 현재까지 확정적으로 도착한 텍스트. 도구 라운드가 시작되어 서버가 text_clear를
   * 보내면 빈 상태로 돌아가고 진행 안내를 표시한다. */
  content?: string;
  toolResults: ToolExecutionResult[];
  onSend?: (text: string) => void;
  /** 모양만 바꾼다. `invitation` 은 청첩장 디자인의 대화처럼 말풍선 없는 글줄로 그린다. */
  presentation?: ChatPresentation;
}

export default function StreamingBubble({
  content = "",
  toolResults,
  onSend,
  presentation = "default",
}: StreamingBubbleProps) {
  const visibleContent = getAmoraVisibleText(content, { streaming: true });
  const toolCards = toolResults.map((result, i) =>
    VENDOR_TOOL_NAMES.has(result.toolName) ? (
      <VendorToolCard key={i} result={result} onSend={onSend} disabled />
    ) : (
      <ActionCard key={i} result={result} />
    )
  );

  if (presentation === "invitation") {
    // 청첩장 디자인: 얼굴과 말풍선 없이 아모라 글줄 자리에 그대로 쓴다. 읽어 주는 방식은 기본 모양과 같다.
    return (
      <div>
        {toolCards}
        <div className={INVITATION_CHAT_STYLES.amoraText} aria-live="polite" aria-busy="true">
          <span className="sr-only">아모라</span>
          {visibleContent.trim() ? (
            <p className="whitespace-pre-wrap break-words">
              {visibleContent}
              <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" aria-hidden="true" />
            </p>
          ) : (
            <div className="flex items-center gap-2 text-[15px] text-inv-muted" role="status">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
              <span>답변을 정리하고 있어요…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 도구 실행 결과 카드 — 작업 진행 중임을 시각적으로 알림 */}
      {toolCards}

      {/* 도착한 텍스트는 바로 보여 주고, 아직 텍스트가 없을 때만 진행 안내를 표시한다. */}
      <div className="group/ai flex max-w-[90%] items-start gap-2 sm:max-w-[80%]">
        <AmoraAvatar sizeClassName="size-7 sm:size-8" />

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--amora-muted,#6E5A54)]">아모라</span>
          <div
            className={`rounded-[14px] rounded-bl-[4px] border px-[14px] py-[11px] ${CHAT_BUBBLE_TONES.amora}`}
            aria-live="polite"
            aria-busy="true"
          >
            {visibleContent.trim() ? (
              <p className="whitespace-pre-wrap break-words text-[13px] leading-[1.6] sm:text-[14px]">
                {visibleContent}
                <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-current align-middle" aria-hidden="true" />
              </p>
            ) : (
              <div className="flex items-center gap-2 py-0.5" role="status">
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                <span className="text-xs sm:text-sm">
                  답변을 정리하고 있어요…
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
