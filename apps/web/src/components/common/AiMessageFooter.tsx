import Link from "next/link";

interface AiMessageFooterProps {
  /** 답변 위험도. high면 전문가 검토 권장이 더 강조됨 */
  severity?: "low" | "medium" | "high";
  /** 자세히 보기 링크 표시 여부 (기본 true) */
  showPolicyLink?: boolean;
  /** 추가 클래스 */
  className?: string;
}

// AI 답변 메시지 단위 인라인 푸터 (캐논 v2 §5 법적 안전판).
// 모든 AI 답변에 "AI 생성 + 출처 + 전문가 검토 권장" 표시 의무.
// AI 기본법(2026.1.22 시행) 준수.
export default function AiMessageFooter({
  severity = "low",
  showPolicyLink = true,
  className = "",
}: AiMessageFooterProps) {
  const isHigh = severity === "high";

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-tight ${
        isHigh ? "text-[#9A6B62]" : "text-[#504444]/60"
      } ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isHigh ? "bg-[#9A6B62]" : "bg-[#795252]/40"
          }`}
        />
        AI 생성
      </span>
      <span className="text-[#B5ADA3]">·</span>
      <span>출처: 공정위 표준계약서 · 소비자원 참가격</span>
      <span className="text-[#B5ADA3]">·</span>
      <span className={isHigh ? "font-medium" : ""}>
        {isHigh ? "전문가 검토 강력 권장" : "전문가 검토 권장"}
      </span>
      {showPolicyLink && (
        <>
          <span className="text-[#B5ADA3]">·</span>
          <Link
            href="/ai-policy"
            className="underline decoration-dotted underline-offset-2 hover:text-[#795252] transition-colors"
          >
            AI 정책
          </Link>
        </>
      )}
    </div>
  );
}
