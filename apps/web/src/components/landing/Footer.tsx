"use client";

import Link from "next/link";
import Logo from "@/components/ui/Logo";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import { weddingPath } from "@/lib/weddingPaths";

const SERVICE_LINKS = [
  { label: "아모라 채팅", href: weddingPath("/chat") },
  { label: "커뮤니티", href: weddingPath() },
  { label: "시세 정보", href: weddingPath("/market-prices") },
];

const COMING_SOON_LINKS = [
  { label: "서비스 소개", href: "/demo" },
  { label: "사용자 연구 안내", href: "/beta" },
  { label: "운영 원칙", href: "/about" },
  { label: "고객 지원", href: "/support" },
];

const POLICY_LINKS = [
  { label: "서비스 소개", href: "/about" },
  { label: "AI 정책", href: "/ai-policy" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "이용약관", href: "/terms" },
];

const CONTACT_LINKS = [
  { label: "문의 접수 상태", href: "/support" },
];

export default function Footer() {
  const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full";
  const serviceLinks = isComingSoon ? COMING_SOON_LINKS : SERVICE_LINKS;
  return (
    <footer className="bg-noir-800 text-ivory-50 pt-20 pb-10 px-[clamp(20px,5vw,60px)]">
      <div className="max-w-[1200px] mx-auto">
        {/* 브랜드 + 링크 그리드 */}
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1.2fr] gap-10 lg:gap-12 mb-12">
          {/* 브랜드 */}
          <div>
            <Link href={isComingSoon ? "/demo" : weddingPath()} className="inline-block">
              <Logo size="sm" variant="white" />
            </Link>
            <p className="text-ivory-50/80 text-sm leading-relaxed mt-5 font-light max-w-[320px]">
              당신만의 AI 웨딩 플래너 &apos;아모라&apos;가 있는 곳.
            </p>
            <p className="text-ivory-50/70 text-xs mt-4">
              웨딩한방 운영자
            </p>
          </div>

          {/* 서비스 */}
          <div>
            <h2 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              서비스
            </h2>
            <ul className="space-y-3">
              {serviceLinks.map((link) => (
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
            <h2 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              정책
            </h2>
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
            <h2 className="text-rose-light text-xs uppercase tracking-[0.15em] mb-5 font-medium">
              연락
            </h2>
            <ul className="space-y-3">
              {CONTACT_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-ivory-50/80 hover:text-white text-sm font-light transition-colors break-all"
                  >
                    {link.label}
                  </Link>
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
            <span className="text-rose-light font-medium">문의</span> ·
            <Link href="/support" className="ml-1 underline hover:text-white">공개 문의 접수 점검 중</Link>
          </p>
          <p className="text-ivory-50/80 text-xs leading-relaxed">
            {isComingSoon
              ? "정식 베타 공개 전 사용자 연구 계획을 안내하고 있습니다. 현재 접수 가능 여부와 개인정보 조건은 사용자 연구 안내 페이지에서 확인해 주세요. 아직 로그인·앱 기능은 제공하지 않습니다."
              : "현재 베타 계정 이용 범위에서는 웨딩 서비스의 결제나 계약을 체결·대행하지 않습니다. 업체 연결 기능은 제공하지 않으며 재개 여부와 시점도 정해지지 않았습니다. 상담 요청이나 문의는 업체에 전송하지 않습니다. 공개 조사 가격은 시장 참고용이므로 최신 구성과 변경·취소 조건은 업체의 공식 연락처로 직접 확인해 주세요. 정식 사업자 정보와 거래 고지는 사업 개시 전에 갱신합니다."}
          </p>
        </div>

        {/* 카피라이트 + 확인 원칙 */}
        <div className="pt-6 mt-6 border-t border-white/5 flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
          <p className="text-ivory-50/80 text-xs">
            &copy; 2026 Wedding Hanbang.
          </p>
          <p className="text-ivory-50/80 text-xs leading-relaxed">
            AI 답변·공개 시세·커뮤니티 경험은 참고용이며, 중요한 결정은 업체 원문을 직접 확인해 주세요.
          </p>
        </div>
      </div>
    </footer>
  );
}
