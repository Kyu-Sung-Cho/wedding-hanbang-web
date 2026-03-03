"use client";

import { Sparkles, Loader2 } from "lucide-react";
import type { ToolExecutionResult } from "@/types/database.types";
import ActionCard from "./ActionCard";
import VendorToolCard, { VENDOR_TOOL_NAMES } from "./VendorToolCard";

interface StreamingBubbleProps {
  content: string;
  toolResults: ToolExecutionResult[];
  onSend?: (text: string) => void;
}

export default function StreamingBubble({
  content,
  toolResults,
  onSend,
}: StreamingBubbleProps) {
  return (
    <div>
      {/* 도구 실행 결과 카드 */}
      {toolResults.map((result, i) =>
        VENDOR_TOOL_NAMES.has(result.toolName) ? (
          <VendorToolCard key={i} result={result} onSend={onSend} disabled />
        ) : (
          <ActionCard key={i} result={result} />
        )
      )}

      {/* 스트리밍 텍스트 또는 타이핑 인디케이터 */}
      <div className="flex items-start gap-3 max-w-[85%]">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-[#C4967E] to-[#C9A96E] flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4 text-white" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[#928980]">
            아리아
          </span>
          <div className="bg-white rounded-2xl rounded-tl-md px-4 py-3 border border-black/[0.06] shadow-sm min-w-[60px]">
            {content ? (
              <p className="text-sm text-[#1A1A1F] leading-relaxed whitespace-pre-wrap">
                {content}
                <span className="inline-block w-1.5 h-4 bg-[#C4967E] ml-0.5 animate-pulse rounded-sm" />
              </p>
            ) : (
              <div className="flex items-center gap-2 py-0.5">
                <Loader2 className="w-4 h-4 text-[#C4967E] animate-spin" />
                <span className="text-xs text-[#B5ADA3]">생각하는 중...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
