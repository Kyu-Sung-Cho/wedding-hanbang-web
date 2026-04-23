"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerNavProps {
  demoMode?: boolean;
}

export default function CustomerNav({ demoMode }: CustomerNavProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  const loginHref = demoMode ? "/demo/login" : "/login";
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 50);
    }
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 메뉴 열릴 때 스크롤 잠금
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  const navLinks = [
    { href: "/community", label: "커뮤니티", scroll: false },
    { href: "/market-prices", label: "시세 정보", scroll: false },
    { href: "/etiquette", label: "결혼 예절", scroll: false },
    { href: "/about", label: "소개", scroll: false },
    { href: "#cta", label: "베타 신청", scroll: true },
  ];

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-[1000] px-[clamp(16px,5vw,60px)] h-[72px] flex items-center justify-between transition-all duration-500 ${
          scrolled || menuOpen
            ? "bg-ivory-50/92 backdrop-blur-[20px] backdrop-saturate-[180%] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
            : ""
        }`}
      >
        <a href={demoMode ? "/demo" : "/"} className="no-underline">
          <Logo size="sm" />
        </a>

        {/* 데스크톱 메뉴 */}
        <div className="flex gap-9 items-center max-md:hidden">
          {navLinks.map((link) =>
            link.scroll ? (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleClick(e, link.href)}
                className="relative text-charcoal text-[14px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
              >
                {link.label}
              </a>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className="relative text-charcoal text-[14px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
              >
                {link.label}
              </a>
            )
          )}
          <a
            href={loginHref}
            className="px-6 py-2.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[13px] font-medium tracking-wide no-underline hover:-translate-y-0.5 transition-all shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
          >
            {isComingSoon ? "미리 체험하기" : "무료 시작하기"}
          </a>
        </div>

        {/* 모바일 햄버거 버튼 */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden flex flex-col justify-center items-center w-10 h-10 gap-[5px] bg-transparent border-none cursor-pointer"
          aria-label="메뉴"
        >
          <span
            className={`block w-5 h-[1.5px] bg-noir-800 transition-all duration-300 origin-center ${
              menuOpen ? "rotate-45 translate-y-[6.5px]" : ""
            }`}
          />
          <span
            className={`block w-5 h-[1.5px] bg-noir-800 transition-all duration-300 ${
              menuOpen ? "opacity-0 scale-x-0" : ""
            }`}
          />
          <span
            className={`block w-5 h-[1.5px] bg-noir-800 transition-all duration-300 origin-center ${
              menuOpen ? "-rotate-45 -translate-y-[6.5px]" : ""
            }`}
          />
        </button>
      </nav>

      {/* 모바일 백드롭 (클릭 시 메뉴 닫기) */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[998] md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* 모바일 슬라이드 다운 메뉴 */}
      <div
        className={`fixed top-[72px] left-0 right-0 z-[999] bg-ivory-50/98 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 ease-in-out md:hidden ${
          menuOpen
            ? "max-h-[calc(100vh-72px)] opacity-100"
            : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col px-6 py-4">
          {/* 메인 링크 */}
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={link.scroll ? (e) => handleClick(e, link.href) : () => setMenuOpen(false)}
              className="flex items-center justify-between py-4 text-[16px] text-noir-800 font-medium no-underline border-b border-platinum/40 hover:text-rose-500 transition-colors"
            >
              {link.label}
              <svg className="w-4 h-4 text-taupe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </a>
          ))}

          {/* CTA 버튼 */}
          <div className="pt-4 pb-2">
            <a
              href={loginHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-center gap-2 w-full py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[14px] font-medium no-underline transition-all shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
            >
              {isComingSoon ? "미리 체험하기" : "무료로 시작하기"}
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
