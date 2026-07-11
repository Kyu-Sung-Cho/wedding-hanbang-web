"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import { CONTACT } from "@/lib/constants/contact";
import { weddingPath } from "@/lib/weddingPaths";

const SERVICE_LINKS = [
  { label: "아모라 채팅", href: weddingPath("/chat") },
  { label: "커뮤니티", href: weddingPath() },
  { label: "시세 정보", href: weddingPath("/market-prices") },
  { label: "내 즐겨찾기", href: weddingPath("/favorites") },
];

const POLICY_LINKS = [
  { label: "서비스 소개", href: "/about" },
  { label: "AI 정책", href: "/ai-policy" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "이용약관", href: "/terms" },
];

const CONTACT_LINKS = [
  { label: CONTACT.email, href: `mailto:${CONTACT.email}`, external: true },
  { label: CONTACT.instagramLabel, href: CONTACT.instagramHref, external: true },
];

export default function Footer() {
  return (
    <footer className="bg-noir-800 text-ivory-50 pt-20 pb-10 px-[clamp(20px,5vw,60px)]">
      <div className="max-w-[1200px] mx-auto">
        {/* 브랜드 + 링크 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.2fr] gap-10 lg:gap-12 mb-12">
          {/* 브랜드 */}
          <div>
            <Link href={weddingPath()} className="inline-block">
              <Logo size="sm" variant="white" />
            </Link>
            <p className="text-ivory-50/60 text-sm leading-relaxed mt-5 font-light max-w-[320px]">
              당신만의 AI 웨딩 플래너 &apos;아모라&apos;가 있는 곳.
            </p>
            <p className="text-ivory-50/40 text-xs mt-4">
              웨딩한방 운영자
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

        {/* 베타 운영 및 거래 범위 고지 */}
        <div className="pt-8 mt-8 border-t border-white/10 space-y-3">
          <p className="text-ivory-50/70 text-xs leading-relaxed">
            <span className="text-rose-light font-medium">문의 이메일</span> ·
            <a href={`mailto:${CONTACT.email}`} className="ml-1 underline hover:text-white">{CONTACT.email}</a>
          </p>
          <p className="text-ivory-50/50 text-xs leading-relaxed">
            현재 베타 계정 이용 범위에서는 웨딩 서비스의 결제나 계약을 체결·대행하지 않습니다. 업체 연결 기능은 준비 중이며
            현재 상담 요청이나 문의를 업체에 전송하지 않습니다. 공개된 가격·운영시간은 참고용이므로 최신 구성과
            변경·취소 조건은 업체의 공식 연락처로 직접 확인해 주세요. 정식 사업자 정보와 거래 고지는 사업 개시 전에 갱신합니다.
          </p>
        </div>

        {/* 카피라이트 + 확인 원칙 */}
        <div className="pt-6 mt-6 border-t border-white/5 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <p className="text-ivory-50/60 text-xs">
            &copy; 2026 Wedding Hanbang.
          </p>
          <p className="text-ivory-50/50 text-xs leading-relaxed">
            AI 답변·시세·견적 결과는 참고용이며, 중요한 결정은 원문과 업체를 직접 확인해 주세요.
          </p>
        </div>
      </div>
    </footer>
  );
}
