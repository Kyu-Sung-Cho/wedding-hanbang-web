"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";

const SERVICE_LINKS = [
  { label: "아모라 채팅", href: "/chat" },
  { label: "업체 탐색", href: "/vendors" },
  { label: "시세 정보", href: "/market-prices" },
  { label: "커뮤니티", href: "/community" },
];

const POLICY_LINKS = [
  { label: "운영원칙", href: "/principles" },
  { label: "AI 정책", href: "/ai-policy" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "이용약관", href: "/terms" },
];

const CONTACT_LINKS = [
  { label: "ceo@hanbang.ai", href: "mailto:ceo@hanbang.ai", external: true },
  { label: "010-5067-6279", href: "tel:01050676279", external: true },
  { label: "Instagram @wedding_hanbang", href: "https://instagram.com/wedding_hanbang", external: true },
];

export default function Footer() {
  return (
    <footer className="bg-noir-800 text-ivory-50 pt-20 pb-10 px-[clamp(20px,5vw,60px)]">
      <div className="max-w-[1200px] mx-auto">
        {/* 브랜드 + 링크 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.2fr] gap-10 lg:gap-12 mb-12">
          {/* 브랜드 */}
          <div>
            <Link href="/" className="inline-block">
              <Logo size="sm" variant="white" />
            </Link>
            <p className="text-ivory-50/60 text-sm leading-relaxed mt-5 font-light max-w-[320px]">
              당신만의 AI 웨딩 플래너 &apos;아모라&apos;가 있는 곳.
            </p>
            <p className="text-ivory-50/40 text-xs mt-4">
              웨딩한방 · 한방그룹
            </p>
          </div>

          {/* 서비스 */}
          <div>
            <h5 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              서비스
            </h5>
            <ul className="space-y-3">
              {SERVICE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-ivory-50/80 hover:text-white text-sm font-light transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 정책 */}
          <div>
            <h5 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              정책
            </h5>
            <ul className="space-y-3">
              {POLICY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-ivory-50/80 hover:text-white text-sm font-light transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 연락 */}
          <div>
            <h5 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              연락
            </h5>
            <ul className="space-y-3">
              {CONTACT_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-ivory-50/80 hover:text-white text-sm font-light transition-colors break-all"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* AI 고지 */}
        <AiNoticeFooter variant="dark" />

        {/* 카피라이트 + 법령 준수 */}
        <div className="pt-8 mt-8 border-t border-white/10 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <p className="text-ivory-50/60 text-xs">
            &copy; 2026 Hanbang Group. All rights reserved.
          </p>
          <p className="text-ivory-50/50 text-xs leading-relaxed">
            AI 기본법 (2026.1.22) · 가격표시제 (2025.11) · 표준계약서 (2025.4) 준수
          </p>
        </div>
      </div>
    </footer>
  );
}
