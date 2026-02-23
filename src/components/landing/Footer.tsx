import Logo from "@/components/ui/Logo";

export default function Footer() {
  return (
    <footer className="bg-noir-800 text-white pt-20 pb-10 px-[60px] max-md:px-5">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-[60px] max-w-[1200px] mx-auto mb-[60px] max-lg:grid-cols-2 max-md:grid-cols-1 max-md:gap-8">
        {/* 브랜드 */}
        <div>
          <a href="/" className="no-underline">
            <Logo size="sm" variant="white" />
          </a>
          <p className="text-[14px] text-white/40 leading-relaxed mt-4 font-light max-w-[300px]">
            AI가 이끄는 새로운 결혼 준비의 시작.
            <br />
            웨딩 플래너 없이도 완벽한 결혼을 준비하세요.
          </p>
        </div>

        {/* 서비스 */}
        <div>
          <h5 className="text-[12px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            서비스
          </h5>
          <span className="block text-white/60 text-[14px] mb-3 font-light">AI 웨딩 플래너</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">AI 맞춤 업체 추천</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">예산 관리</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">일정 관리</span>
        </div>

        {/* 고객 지원 */}
        <div>
          <h5 className="text-[12px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            고객 지원
          </h5>
          <span className="block text-white/60 text-[14px] mb-3 font-light">자주 묻는 질문</span>
          <a href="/terms" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">이용약관</a>
          <a href="/privacy" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">개인정보처리방침</a>
          <a href="mailto:contact@hanbang.ai" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">제휴 문의</a>
        </div>

        {/* 회사 */}
        <div>
          <h5 className="text-[12px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            회사
          </h5>
          <span className="block text-white/60 text-[14px] mb-3 font-light">웨딩한방 소개</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">채용</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">블로그</span>
          <span className="block text-white/60 text-[14px] mb-3 font-light">보도자료</span>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto pt-10 border-t border-white/[0.06] flex justify-between items-center max-md:flex-col max-md:gap-4 max-md:text-center">
        <span className="text-[13px] text-white/30 font-light">
          © 2025 웨딩한방. All rights reserved.
        </span>
        <div className="flex gap-4">
          {[
            { label: "IG", title: "Instagram" },
            { label: "KT", title: "KakaoTalk" },
            { label: "BL", title: "Blog" },
          ].map((social) => (
            <span
              key={social.label}
              title={social.title}
              className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white/40 text-[14px] cursor-default"
            >
              {social.label}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
