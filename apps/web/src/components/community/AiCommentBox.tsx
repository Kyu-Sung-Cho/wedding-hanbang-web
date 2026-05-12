import { Sparkles } from "lucide-react";
import type { AiComment } from "@/types/community.types";

interface AiCommentBoxProps {
  aiComment: AiComment;
}

export default function AiCommentBox({ aiComment }: AiCommentBoxProps) {
  const comparisonColor =
    aiComment.comparison === "below"
      ? "#22C55E"
      : aiComment.comparison === "average"
      ? "#C9A96E"
      : aiComment.comparison === "unknown"
      ? "#928980"
      : "#C4967E";

  const comparisonLabel =
    aiComment.comparison === "below"
      ? "평균 이하"
      : aiComment.comparison === "average"
      ? "평균"
      : aiComment.comparison === "unknown"
      ? "비교 기준 부족"
      : "평균 이상";
  const comparisonMeta =
    aiComment.comparison === "unknown" || aiComment.percentage <= 0
      ? comparisonLabel
      : `${comparisonLabel} · ${aiComment.percentage}%`;

  return (
    <div
      className="bg-[#FAF8F5] rounded-2xl p-5 border-l-4"
      style={{ borderLeftColor: "#C4967E" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-[#C4967E]" />
        <span
          className="text-sm font-medium text-[#1A1A1F]"
          style={{ fontFamily: "'Noto Serif KR', serif" }}
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
          {comparisonMeta}
        </span>
      </div>
      <p className="text-[15px] text-[#1A1A1F] leading-relaxed mb-3">
        {aiComment.text}
      </p>
      <p className="text-xs text-[#B5ADA3]">{aiComment.reference}</p>
    </div>
  );
}
