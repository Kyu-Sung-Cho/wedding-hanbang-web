"use client";

import { useState, useEffect } from "react";
import Logo from "@/components/ui/Logo";

const infoLinks = [
  { label: "웨딩한방 소개", href: "/" },
  { label: "자주 묻는 질문", href: null },
  { label: "이용약관", href: null },
  { label: "개인정보처리방침", href: null },
  { label: "제휴 문의", href: "mailto:contact@hanbang.ai" },
];

export default function Footer() {
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  function handleComingSoon(e: React.MouseEvent) {
    e.preventDefault();
    setToast("준비 중인 페이지입니다");
  }

  return (
    <footer className="bg-noir-800 text-white pt-20 pb-10 px-[60px] max-md:px-5">
      <div className="grid grid-cols-[2fr_1fr] gap-[60px] max-w-[1500px] mx-auto mb-[60px] max-md:grid-cols-1 max-md:gap-8">
        {/* 브랜드 */}
        <div>
          <a href="/" className="no-underline">
            <Logo size="sm" variant="white" />
          </a>
          <p className="text-[23px] text-white/40 leading-relaxed mt-4 font-light max-w-[375px]">
            AI가 이끄는 새로운 결혼 준비의 시작.
            <br />
            웨딩 플래너 없이도 완벽한 결혼을 준비하세요.
          </p>
        </div>

        {/* 정보 */}
        <div>
          <h5 className="text-[38px] tracking-[0.15em] uppercase text-white/30 mb-5 font-medium">
            정보
          </h5>
          {infoLinks.map((link) =>
            link.href ? (
              <a
                key={link.label}
                href={link.href}
                className="block text-white/60 no-underline text-[23px] mb-3 font-light hover:text-rose-light transition-colors"
              >
                {link.label}
              </a>
            ) : (
              <button
                key={link.label}
                onClick={handleComingSoon}
                className="block text-white/60 text-[23px] mb-3 font-light hover:text-rose-light transition-colors cursor-pointer bg-transparent border-none p-0 text-left"
              >
                {link.label}
              </button>
            )
          )}
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto pt-10 border-t border-white/[0.06] flex justify-between items-center max-md:flex-col max-md:gap-4 max-md:text-center">
        <span className="text-[25px] text-white/30 font-light">
          &copy; 2026 웨딩한방. All rights reserved.
        </span>
        <div className="flex gap-4">
          {[
            { label: "IG", title: "Instagram" },
            { label: "KT", title: "KakaoTalk" },
            { label: "BL", title: "Blog" },
          ].map((social) => (
            <button
              key={social.label}
              title={social.title}
              onClick={handleComingSoon}
              className="w-9 h-9 rounded-full bg-white/[0.06] flex items-center justify-center text-white/40 text-[23px] hover:bg-rose-500/15 hover:text-rose-light transition-all cursor-pointer border-none"
            >
              {social.label}
            </button>
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 bg-noir-800 text-white text-[23px] rounded-full shadow-[0_8px_32px_rgba(0,0,0,0.3)] border border-white/10 animate-fade-in">
          {toast}
        </div>
      )}
    </footer>
  );
}
