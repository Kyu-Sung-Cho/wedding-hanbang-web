import Logo from "@/components/ui/Logo";

export default function Footer() {
  return (
    <footer className="bg-noir-800 text-white pt-20 pb-10 px-[60px] max-md:px-5">
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-[60px] max-w-[1200px] mx-auto mb-[60px] max-lg:grid-cols-2 max-md:grid-cols-1 max-md:gap-8">
        {/* 브랜드 */}
        <div>
          <a href="#" className="no-underline">
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
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">AI 웨딩 플래너</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">가상 드레스 피팅</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">예산 관리</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">일정 관리</a>
        </div>

        {/* 고객 지원 */}
        <div>
          <h5 className="text-[12px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            고객 지원
          </h5>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">자주 묻는 질문</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">이용약관</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">개인정보처리방침</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">제휴 문의</a>
        </div>

        {/* 회사 */}
        <div>
          <h5 className="text-[12px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            회사
          </h5>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">웨딩한방 소개</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">채용</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">블로그</a>
          <a href="#" className="block text-white/60 no-underline text-[14px] mb-3 font-light hover:text-rose-light transition-colors">보도자료</a>
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
            <a
              key={social.label}
              href="#"
              title={social.title}
              className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white/40 no-underline text-[14px] hover:bg-rose-500/15 hover:text-rose-light transition-all"
            >
              {social.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
