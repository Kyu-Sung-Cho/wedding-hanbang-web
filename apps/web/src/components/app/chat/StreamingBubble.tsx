"use client";

import { Sparkles, Loader2 } from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";

interface StreamingBubbleProps {
  /** 스트리밍되는 텍스트는 의도적으로 표시하지 않음 — 도구 사용 시 text_clear로
   * 다시 시작되는 패턴이 사용자에게 미완성 느낌을 주기 때문에, 답변이 완성되면
   * (done 이벤트) 한 번에 ChatBubble로 렌더링한다. content prop은 호환성용으로
   * 받기만 하고 무시. */
  content?: string;
  toolResults: ToolExecutionResult[];
  onSend?: (text: string) => void;
}

export default function StreamingBubble({
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

      {/* 항상 thinking 인디케이터만 — 텍스트는 done 이벤트에서 한 번에 렌더 */}
      <div className="group/ai flex items-start gap-2 sm:gap-3 max-w-[94%] sm:max-w-[860px]">
        <div className="flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-base font-medium text-[#928980]">아모라</span>
          <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 sm:px-5 sm:py-4 border border-black/[0.06] shadow-sm">
            <div className="flex items-center gap-2 py-0.5">
              <Loader2 className="w-5 h-5 text-[#C4967E] animate-spin" />
              <span className="text-[13px] sm:text-[14px] text-[#928980]">
                답변을 정리하고 있어요…
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
