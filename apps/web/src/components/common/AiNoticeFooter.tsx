import Link from "next/link";
import { CONTACT } from "@/lib/constants/contact";

type Variant = "light" | "dark";

interface AiNoticeFooterProps {
  variant?: Variant;
}

// AI 기본법 (2026.1.22 시행) compliance 고지 블록
// 모든 사이트 footer에 동일 문구로 노출 (변형: light/dark)
export default function AiNoticeFooter({ variant = "light" }: AiNoticeFooterProps) {
  const isDark = variant === "dark";

  const borderCls = isDark ? "border-white/10" : "border-[#e5dcdc]";
  const textCls = isDark ? "text-white/60" : "text-[#504444]";
  const iconBgCls = isDark
    ? "bg-white/10 text-white/80"
    : "bg-[#795252]/10 text-[#795252]";
  const labelCls = isDark ? "text-white/80" : "text-[#1b1c1c]";
  const linkHoverCls = isDark ? "hover:text-white" : "hover:text-[#795252]";

  return (
    <div className={`border-t ${borderCls} pt-6 mt-6 text-xs ${textCls}`}>
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 w-5 h-5 rounded-full ${iconBgCls} flex items-center justify-center text-[11px] font-medium`}
          aria-hidden
        >
          ⓘ
        </div>
        <div className="space-y-1 leading-relaxed">
          <p className={`font-medium ${labelCls}`}>AI 기반 서비스 고지</p>
          <p>
            웨딩한방의 AI 플래너 &#39;아모라&#39;는 OpenAI의 GPT 모델을 활용합니다.
            AI 생성 답변은 참고용이며, 중요한 의사결정은 반드시 본인이 확인하시기 바랍니다.
          </p>
          <p>
            본 서비스는 「인공지능 발전과 신뢰 기반 조성 등에 관한 기본법」(2026.1.22 시행)을 준수합니다.
            <Link href="/ai-policy" className={`underline ml-1 ${linkHoverCls} transition-colors`}>
              자세히
            </Link>
          </p>
          <p>
            문의:{" "}
            <a href={`mailto:${CONTACT.email}`} className={`underline ${linkHoverCls} transition-colors`}>
              {CONTACT.email}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
