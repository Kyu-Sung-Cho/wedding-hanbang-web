"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import { CONTACT } from "@/lib/constants/contact";
import { weddingPath } from "@/lib/weddingPaths";

const SERVICE_LINKS = [
  { label: "아모라 채팅", href: weddingPath("/chat") },
  { label: "커뮤니티", href: weddingPath() },
  { label: "공시 가격", href: weddingPath("/market-prices") },
  { label: "내 즐겨찾기", href: weddingPath("/favorites") },
];

const POLICY_LINKS = [
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
              당신만의 AI 동반자 &apos;아모라&apos;가 있는 곳.
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

        {/* 거래 기능을 열기 전 법률·사업 검토를 거쳐 확정할 정보 */}
        <div className="pt-8 mt-8 border-t border-white/10 space-y-3">
          <p className="text-ivory-50/70 text-xs leading-relaxed">
            <span className="text-rose-light font-medium">운영 문의</span> ·
            대표 이메일 <a href={`mailto:${CONTACT.email}`} className="underline hover:text-white">{CONTACT.email}</a>
          </p>
          <p className="text-ivory-50/50 text-xs leading-relaxed">
            현재 공개 화면은 정보 정리와 베타 기능을 제공합니다. 결제·중개 등 거래 기능을 제공하기 전 운영 주체, 사업자 정보, 책임 범위와 환불 기준을 법률 검토 후 별도로 고지합니다.
          </p>
        </div>

        {/* 카피라이트 + 법령 준수 */}
        <div className="pt-6 mt-6 border-t border-white/5 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <p className="text-ivory-50/60 text-xs">
            &copy; 2026 Hanbang Group. All rights reserved.
          </p>
          <p className="text-ivory-50/50 text-xs leading-relaxed">AI 답변은 참고 자료이며 계약·가격·법률 판단은 원문과 전문가를 통해 최종 확인해 주세요.</p>
        </div>
      </div>
    </footer>
  );
}
