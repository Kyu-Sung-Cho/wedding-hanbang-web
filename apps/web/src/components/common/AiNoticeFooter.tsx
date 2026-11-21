import Link from "next/link";
import { CONTACT } from "@/lib/constants/contact";

type Variant = "light" | "dark";

interface AiNoticeFooterProps {
  variant?: Variant;
}

// AI 제공 방식과 한계를 알리는 공통 고지 블록
// 모든 사이트 footer에 동일 문구로 노출 (변형: light/dark)
export default function AiNoticeFooter({ variant = "light" }: AiNoticeFooterProps) {
  const isDark = variant === "dark";

  const borderCls = isDark ? "border-white/10" : "border-[#e5dcdc]";
  const textCls = isDark ? "text-[var(--hb-on-primary)]" : "text-[var(--hb-text-body)]";
  // 어두운 변형은 모브 푸터(`--hb-primary`) 위에 놓인다. 흰 글리프를 반투명 흰 칩에 두면
  // 칩이 밝아져 4.07:1 에 그친다 — 눌림 단계(rose[700]) 칩 위 흰 글리프는 6.25:1 이다.
  const iconBgCls = isDark
    ? "bg-[var(--hb-primary-hover)] text-[var(--hb-on-primary)]"
    : "bg-[rgba(54,83,78,0.10)] text-[var(--hb-accent-hover)]";
  const labelCls = isDark ? "text-[var(--hb-on-primary)]" : "text-[var(--hb-text-strong)]";
  // 어두운 변형의 글자는 이미 불투명 흰색이라 색을 바꾸는 호버는 보이지 않는다. 밑줄을 굵힌다.
  const linkHoverCls = isDark ? "hover:decoration-2" : "hover:text-[var(--hb-accent-hover)]";

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
            웨딩한방의 AI 웨딩 비서 &#39;아모라&#39;는 OpenAI GPT-5.6 Luna·Terra를 활용합니다.
            AI 생성 답변은 참고용이며, 중요한 의사결정은 반드시 본인이 확인하시기 바랍니다.
          </p>
          <p>
            AI 제공 방식, 한계와 사용자 안내는 AI 정책에서 확인할 수 있습니다.
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
