"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";

interface StreamingBubbleProps {
  content?: string;
  toolResults: ToolExecutionResult[];
  onSend?: (text: string) => void;
  onCancel?: () => void;
}

export default function StreamingBubble({
  content = "",
  toolResults,
  onSend,
  onCancel,
}: StreamingBubbleProps) {
  const [isTakingLonger, setIsTakingLonger] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsTakingLonger(true), 8_000);
    return () => window.clearTimeout(timer);
  }, []);

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

      <div className="group/ai flex items-start gap-2 sm:gap-3 max-w-[94%] sm:max-w-[53.75rem]">
        <div className="flex-shrink-0 w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
        </div>

        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          <span className="text-base font-medium text-[#928980]">아모라</span>
          <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 sm:px-5 sm:py-4 border border-black/[0.06] shadow-sm" aria-live="polite" aria-busy="true">
            {content ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A1F]">
                {content}
                <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse align-text-bottom bg-[#C4967E]" aria-hidden="true" />
              </p>
            ) : (
              <div className="flex items-center gap-2 py-0.5">
                <Loader2 className="w-5 h-5 text-[#C4967E] animate-spin motion-reduce:animate-none" />
                <span className="text-xs sm:text-sm text-[#6F665F]">
                  {isTakingLonger
                    ? "계약·비용 정보를 한 번 더 확인하고 있어요."
                    : "답변을 정리하고 있어요…"}
                </span>
              </div>
            )}
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 self-start rounded-full border border-black/10 bg-white px-4 text-xs font-medium text-[#6F665F] transition-colors hover:bg-[#FAF7F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252] focus-visible:ring-offset-2"
              aria-label="아모라 답변 생성 멈추기"
            >
              답변 멈추기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
