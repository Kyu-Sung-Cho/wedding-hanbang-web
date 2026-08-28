"use client";

import { Sparkles, Loader2 } from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";

interface StreamingBubbleProps {
  /** 현재까지 확정적으로 도착한 텍스트. 도구 라운드가 시작되어 서버가 text_clear를
   * 보내면 빈 상태로 돌아가고 진행 안내를 표시한다. */
  content?: string;
  toolResults: ToolExecutionResult[];
  onSend?: (text: string) => void;
}

export default function StreamingBubble({
  content = "",
  toolResults,
  onSend,
}: StreamingBubbleProps) {
  return (
    <div>
      {/* 도구 실행 결과 카드 — 작업 진행 중임을 시각적으로 알림 */}
      {toolResults.map((result, i) =>
        VENDOR_TOOL_NAMES.has(result.toolName) ? (
          <VendorToolCard key={i} result={result} onSend={onSend} disabled />
        ) : (
          <ActionCard key={i} result={result} />
        )
      )}

      {/* 도착한 텍스트는 바로 보여 주고, 아직 텍스트가 없을 때만 진행 안내를 표시한다. */}
      <div className="group/ai flex items-start gap-2 sm:gap-3 max-w-[94%] sm:max-w-[53.75rem]">
        <div className="flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-base font-medium text-[var(--hb-text-muted)]">아모라</span>
          <div
            className="bg-white rounded-2xl rounded-tl-md px-4 py-3 sm:px-5 sm:py-4 border border-black/[0.06] shadow-sm"
            aria-live="polite"
            aria-busy="true"
          >
            {content.trim() ? (
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-[var(--hb-text-strong)] sm:text-[0.9375rem]">
                {content}
                <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-[#C4967E] align-middle" aria-hidden="true" />
              </p>
            ) : (
              <div className="flex items-center gap-2 py-0.5" role="status">
                <Loader2 className="w-5 h-5 text-[#C4967E] animate-spin" aria-hidden="true" />
                <span className="text-xs sm:text-sm text-[var(--hb-text-muted)]">
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
