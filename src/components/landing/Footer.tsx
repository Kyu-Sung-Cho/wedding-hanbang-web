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
    <footer className="bg-gray-900 px-6 pt-16 pb-10">
      <div className="mx-auto mb-12 grid max-w-7xl grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4 md:gap-12">
        {/* 브랜드 */}
        <div>
          <Link href="/" className="text-lg font-bold tracking-tight text-white no-underline">
            웨딩한방
          </Link>
          <p className="mt-4 max-w-[300px] text-sm leading-relaxed text-gray-500">
            AI가 이끄는 새로운 결혼 준비의 시작.
            <br />
            웨딩 플래너 없이도 완벽한 결혼을 준비하세요.
          </p>
        </div>

        {/* 서비스 */}
        <div>
          <h5 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">서비스</h5>
          {serviceLinks.map((link) => (
            <Link key={link.label} href={link.href} className="mb-2.5 block text-sm text-gray-400 transition-colors hover:text-white">
              {link.label}
            </Link>
          ))}
        </div>

        {/* 고객 지원 */}
        <div>
          <h5 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">고객 지원</h5>
          {supportLinks.map((link) => (
            <a key={link.label} href={link.href} className="mb-2.5 block text-sm text-gray-400 transition-colors hover:text-white">
              {link.label}
            </a>
          ))}
        </div>

        {/* 회사 */}
        <div>
          <h5 className="mb-4 text-xs font-semibold uppercase tracking-widest text-gray-500">회사</h5>
          {companyLinks.map((link) => (
            <a key={link.label} href={link.href} className="mb-2.5 block text-sm text-gray-400 transition-colors hover:text-white">
              {link.label}
            </a>
          ))}
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-gray-800 pt-8 sm:flex-row">
        <span className="text-sm text-gray-600">
          © 2025 웨딩한방. All rights reserved.
        </span>
        <div className="flex gap-3">
          {[
            { label: "IG", title: "Instagram" },
            { label: "KT", title: "KakaoTalk" },
            { label: "BL", title: "Blog" },
          ].map((social) => (
            <a
              key={social.label}
              href="#"
              title={social.title}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800 text-xs text-gray-500 transition-colors hover:bg-gray-700 hover:text-white"
            >
              {social.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
