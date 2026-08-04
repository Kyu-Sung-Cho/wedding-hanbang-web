import Link from "next/link";

import { CONTACT } from "@/lib/constants/contact";
import { DISCLOSURE_SOURCE_URL, disclosureRoundLabel } from "@/lib/price/period";
import { weddingPath } from "@/lib/weddingPaths";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4 focus-visible:ring-offset-[#FBF8F2]";

const serviceLinks = [
  { label: "아모라 채팅", href: weddingPath("/chat") },
  { label: "할 일·일정", href: weddingPath("/schedule") },
  { label: "예산", href: weddingPath("/budget") },
  { label: "커뮤니티 준비 안내", href: "#community-bridge" },
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
          <span className="text-[22px] font-semibold tracking-[-0.02em]">웨딩한방</span>
          <p className="mt-5 max-w-sm text-[14px] leading-[1.85] text-[#36534E]/80">
            웨딩한방은 둘이 예산·할 일·일정을 함께 관리하는 결혼 준비 공간입니다.
            계정 베타에서는 아모라가 한 번에 한 가지 변경을 제안하고, 확인한 변경만 준비 기록에 반영합니다.
          </p>
          <a
            href={`mailto:${CONTACT.email}`}
            className={`mt-6 inline-flex min-h-11 items-center text-[13px] font-medium text-[#36534E] underline decoration-[#243832]/25 underline-offset-4 transition-colors hover:text-[#8F6662] ${focusRing}`}
          >
            서비스·업체 정보 문의 {CONTACT.email}
          </a>
        </div>
        <FooterColumn title="서비스" items={serviceLinks} />
        <FooterColumn title="정책" items={policyLinks} />
      </div>
      <div className={`${shell} border-t border-[#243832]/10 py-7 text-[12px] leading-6 text-[#4E6A62]`}>
        © 2026 Wedding Hanbang. 가격 자료 출처:{" "}
        <a
          href={DISCLOSURE_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex min-h-11 items-center underline decoration-[#243832]/25 underline-offset-4 hover:text-[#243832] ${focusRing}`}
        >
          한국소비자원 참가격
        </a>{" "}
        · {disclosureRoundLabel()} 게시 자료.
      </div>
    </footer>
  );
}

type FooterColumnProps = {
  title: string;
  items: ReadonlyArray<{ label: string; href: string }>;
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
              className={`inline-flex min-h-11 min-w-11 items-center text-[14px] text-[#36534E]/82 transition-colors hover:text-[#8F6662] ${focusRing}`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
