import Link from "next/link";
import { CONTACT } from "@/lib/constants/contact";

type Variant = "light" | "dark";

interface AiNoticeFooterProps {
  variant?: Variant;
}

// 생성형 AI 사용 사실과 사용자 확인 원칙을 일관되게 알리는 고지 블록.
export default function AiNoticeFooter({ variant = "light" }: AiNoticeFooterProps) {
  const isDark = variant === "dark";

  const borderCls = isDark ? "border-white/10" : "border-[#e5dcdc]";
  const textCls = isDark ? "text-white/80" : "text-[#504444]";
  const iconBgCls = isDark
    ? "bg-white/10 text-white/80"
    : "bg-[#795252]/10 text-[#795252]";
  const labelCls = isDark ? "text-white/90" : "text-[#1b1c1c]";
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
            생성형 AI 사용 사실과 AI 생성 결과를 화면에 표시하며, 안전·개인정보 원칙을 계속 점검합니다.
            <Link href="/ai-policy" className={`ml-1 inline-flex min-h-11 items-center px-2 underline ${linkHoverCls} transition-colors`}>
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
