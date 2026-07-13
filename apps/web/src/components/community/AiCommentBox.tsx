import { Sparkles } from "lucide-react";
import type { AiComment } from "@/types/community.types";

interface AiCommentBoxProps {
  aiComment: AiComment;
}

export default function AiCommentBox({ aiComment }: AiCommentBoxProps) {
  const comparisonColor = "#928980";

  return (
    <div
      className="bg-[#FAF8F5] rounded-2xl p-5 border-l-4"
      style={{ borderLeftColor: "#36534E" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-[#36534E]" />
        <span
          className="text-sm font-medium text-[#1A1A1F]"
          style={{ fontFamily: "'Paperlogy', sans-serif" }}
        >
          아모라 AI 코멘트
        </span>
        <span
          className="ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: `${comparisonColor}20`,
            color: comparisonColor,
          }}
        >
          AI 참고 의견
        </span>
      </div>
      <p className="text-[15px] text-[#1A1A1F] leading-relaxed mb-3">
        {aiComment.text}
      </p>
      <p className="text-xs text-[#B5ADA3]">{aiComment.reference}</p>
    </div>
  );
}
