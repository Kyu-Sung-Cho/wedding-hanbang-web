import Link from "next/link";

import { CONTACT } from "@/lib/constants/contact";
import { DISCLOSURE_SOURCE_URL, disclosureRoundLabel } from "@/lib/price/period";
import { weddingPath } from "@/lib/weddingPaths";

import { secondaryLink } from "./landingType";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-[#FBF8F2]";

// 본문은 이 세 화면을 "계정 베타"로만 설명하는데, 푸터만 경계 표시 없이 계정
// 라우트로 직접 보내고 있었다. 미로그인 방문자가 아무 예고 없이 계정 화면에
// 도착하지 않도록 같은 경계를 라벨에 붙인다.
const serviceLinks = [
  { label: "아모라 채팅", href: weddingPath("/chat"), note: "계정 베타" },
  { label: "할 일·일정", href: weddingPath("/schedule"), note: "계정 베타" },
  { label: "예산", href: weddingPath("/budget"), note: "계정 베타" },
  { label: "커뮤니티 준비 안내", href: "#community-bridge", note: "운영 공개 전" },
] as const;

const policyLinks = [
  { label: "이용약관", href: "/terms" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "AI 서비스 정책", href: "/ai-policy" },
] as const;

export default function LandingFooter() {
  return (
    <footer className="border-t border-[#243832]/10 bg-[#FBF8F2] text-[#243832]">
      <div className={`${shell} grid gap-12 py-16 md:grid-cols-[1.5fr_1fr_1fr] md:py-20`}>
        <div>
          <span className="text-[24px] font-semibold tracking-[-0.02em]">웨딩한방</span>
          <p className="mt-5 max-w-sm text-[14px] leading-[1.85] text-[#36534E]/80">
            웨딩한방은 둘이 예산·할 일·일정을 함께 관리하는 결혼 준비 공간입니다.
            계정 베타에서는 아모라가 한 번에 한 가지 변경을 제안하고, 확인한 변경만 준비 기록에 반영합니다.
          </p>
          <a
            href={`mailto:${CONTACT.email}`}
            className={`mt-6 ${secondaryLink} focus-visible:ring-offset-4 focus-visible:ring-offset-ivory-50`}
          >
            서비스·업체 정보 문의 {CONTACT.email}
          </a>
        </div>
        <FooterColumn title="서비스" items={serviceLinks} />
        <FooterColumn title="정책" items={policyLinks} />
      </div>
      {/* 출처 링크를 문장 밖 자기 줄로 뺀다. 문장 안에 두면 44px 터치 대상이
          line box를 벌리고, 대상을 줄이면 44px 보장을 잃는다. 줄을 나누면 둘 다 지킨다. */}
      <div className={`${shell} border-t border-[#243832]/10 py-7 text-[12px] leading-6 text-[#4E6A62]`}>
        <p>© 2026 Wedding Hanbang. · {disclosureRoundLabel()} 게시 자료.</p>
        <a
          href={DISCLOSURE_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-1 ${secondaryLink} ${focusRing}`}
        >
          가격 자료 출처 · 한국소비자원 참가격
        </a>
      </div>
    </footer>
  );
}

type FooterColumnProps = {
  title: string;
  /** `note`는 계정 베타·운영 공개 전처럼 이동 전에 알려야 하는 경계 표시다. */
  items: ReadonlyArray<{ label: string; href: string; note?: string }>;
};

function FooterColumn({ title, items }: FooterColumnProps) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <ul className="mt-4 flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className={`inline-flex min-h-11 min-w-11 items-center gap-2 text-[14px] text-[#36534E]/82 transition-colors duration-200 hover:text-[#8F6662] ${focusRing}`}
            >
              {item.label}
              {item.note ? (
                <span className="rounded-full border border-[#243832]/14 px-2 py-0.5 text-[12px] font-medium text-[#4E6A62]">
                  {item.note}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
