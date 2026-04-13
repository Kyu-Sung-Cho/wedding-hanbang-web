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
    { href: "#features", label: "주요 기능", scroll: true },
    { href: "#reviews", label: "이용 사례", scroll: true },
    { href: "/community", label: "커뮤니티", scroll: false },
    { href: "/market-prices", label: "시세 정보", scroll: false },
    { href: "/etiquette", label: "예절 가이드", scroll: false },
    { href: "#cta", label: "시작하기", scroll: true },
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
            className="px-6 py-2.5 bg-noir-800 text-white rounded-full text-[13px] font-medium tracking-wide no-underline hover:bg-noir-soft hover:-translate-y-0.5 transition-all"
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

      {/* 모바일 풀스크린 메뉴 */}
      <div
        className={`fixed inset-0 z-[999] bg-ivory-50/98 backdrop-blur-xl flex flex-col pt-[72px] transition-all duration-400 md:hidden ${
          menuOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex-1 flex flex-col px-8 py-6 overflow-y-auto">
          {/* 메인 링크 */}
          <div className="flex flex-col gap-1">
            {navLinks.map((link, i) => (
              <a
                key={link.href}
                href={link.href}
                onClick={link.scroll ? (e) => handleClick(e, link.href) : () => setMenuOpen(false)}
                className="flex items-center justify-between py-4 text-[18px] text-noir-800 font-medium no-underline border-b border-platinum/50 hover:text-rose-500 transition-colors"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                {link.label}
                <svg className="w-4 h-4 text-taupe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </a>
            ))}
          </div>

          {/* 구분선 + 부가 링크 */}
          <div className="mt-6 flex flex-col gap-1">
            <a
              href="/vendors"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 py-3 text-[15px] text-taupe-500 no-underline hover:text-noir-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.015a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72l1.189-1.19A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72M6.75 18h3.75a.75.75 0 0 0 .75-.75V13.5a.75.75 0 0 0-.75-.75H6.75a.75.75 0 0 0-.75.75v3.75c0 .414.336.75.75.75Z" />
              </svg>
              업체 탐색
            </a>
            <a
              href="/vendor/login"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 py-3 text-[15px] text-taupe-500 no-underline hover:text-noir-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 0 0 .75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 0 0-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0 1 12 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 0 1-.673-.38m0 0A2.18 2.18 0 0 1 3 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 0 1 3.413-.387m7.5 0V5.25A2.25 2.25 0 0 0 13.5 3h-3a2.25 2.25 0 0 0-2.25 2.25v.894m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              업체 회원 로그인
            </a>
          </div>

          {/* CTA 버튼 */}
          <div className="mt-auto pt-8 pb-6">
            <a
              href={loginHref}
              onClick={() => setMenuOpen(false)}
              className="flex items-center justify-center gap-2 w-full py-4 bg-noir-800 text-white rounded-full text-[15px] font-medium no-underline hover:bg-noir-soft transition-all"
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
