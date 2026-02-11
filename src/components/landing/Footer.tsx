import Link from "next/link";

const serviceLinks = [
  { label: "AI 웨딩 플래너", href: "/chat" },
  { label: "가상 드레스 피팅", href: "/fitting" },
  { label: "예산 관리", href: "/budget" },
  { label: "일정 관리", href: "/schedule" },
];

const supportLinks = [
  { label: "자주 묻는 질문", href: "#" },
  { label: "이용약관", href: "#" },
  { label: "개인정보처리방침", href: "#" },
  { label: "제휴 문의", href: "#" },
];

const companyLinks = [
  { label: "웨딩한방 소개", href: "#" },
  { label: "채용", href: "#" },
  { label: "블로그", href: "#" },
  { label: "보도자료", href: "#" },
];

export default function Footer() {
  return (
    <footer className="bg-noir-800 px-5 pt-20 pb-10 text-white md:px-[60px]">
      <div className="mx-auto mb-15 grid max-w-[1200px] grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4 md:gap-15">
        {/* 브랜드 */}
        <div>
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-rose-500 to-gold text-base font-semibold text-white font-display tracking-[-0.5px]">
              한
            </div>
            <span className="text-lg font-medium font-serif tracking-[-0.5px] text-white">
              웨딩한방
            </span>
          </Link>
          <p className="mt-4 max-w-[300px] text-sm font-light leading-[1.7] text-white/40">
            AI가 이끄는 새로운 결혼 준비의 시작.
            <br />
            웨딩 플래너 없이도 완벽한 결혼을 준비하세요.
          </p>
        </div>

        {/* 서비스 */}
        <div>
          <h5 className="mb-5 text-xs font-medium uppercase tracking-[0.15em] text-white/30">서비스</h5>
          {serviceLinks.map((link) => (
            <Link key={link.label} href={link.href} className="mb-3 block text-sm font-light text-white/60 transition-colors hover:text-rose-light">
              {link.label}
            </Link>
          ))}
        </div>

        {/* 고객 지원 */}
        <div>
          <h5 className="mb-5 text-xs font-medium uppercase tracking-[0.15em] text-white/30">고객 지원</h5>
          {supportLinks.map((link) => (
            <a key={link.label} href={link.href} className="mb-3 block text-sm font-light text-white/60 transition-colors hover:text-rose-light">
              {link.label}
            </a>
          ))}
        </div>

        {/* 회사 */}
        <div>
          <h5 className="mb-5 text-xs font-medium uppercase tracking-[0.15em] text-white/30">회사</h5>
          {companyLinks.map((link) => (
            <a key={link.label} href={link.href} className="mb-3 block text-sm font-light text-white/60 transition-colors hover:text-rose-light">
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-4 border-t border-white/[0.06] pt-10 sm:flex-row">
        <span className="text-[13px] font-light text-white/30">
          © 2025 웨딩한방. All rights reserved.
        </span>
        <div className="flex gap-4">
          {[
            { label: "IG", title: "Instagram" },
            { label: "KT", title: "KakaoTalk" },
            { label: "BL", title: "Blog" },
          ].map((social) => (
            <a
              key={social.label}
              href="#"
              title={social.title}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.06] text-sm text-white/40 transition-all hover:bg-rose-500/15 hover:text-rose-light"
            >
              {social.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
