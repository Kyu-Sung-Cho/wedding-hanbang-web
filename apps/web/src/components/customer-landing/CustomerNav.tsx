"use client";

import { useEffect, useRef, useState } from "react";
import Logo from "@/components/ui/Logo";
import { weddingPath } from "@/lib/weddingPaths";

interface CustomerNavProps {
  demoMode?: boolean;
  darkAtTop?: boolean;
}

const isComingSoon = process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full";
const ACCOUNT_HREF = isComingSoon ? "/beta" : "/login?mode=signup";
const ACCOUNT_LABEL = isComingSoon ? "사용자 연구 안내" : "베타 계정 만들기";
const EXAMPLE_APP_HREF = isComingSoon ? "/support" : "/demo/login";
const EXAMPLE_APP_LABEL = isComingSoon ? "지원 안내" : "예시 앱 체험";

export default function CustomerNav({ demoMode, darkAtTop = false }: CustomerNavProps = {}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [scrolled, setScrolled] = useState(false);
  // Native <details> owns whether the menu opens. State only mirrors it for
  // colors and explicit aria-expanded after React hydrates.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 50);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const detailsElement = detailsRef.current;
    if (!detailsElement) return;
    const details: HTMLDetailsElement = detailsElement;

    function syncOpenState() {
      const isOpen = Boolean(details?.open);
      setMenuOpen(isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !details.open) return;
      event.preventDefault();
      details.open = false;
      syncOpenState();
      details.querySelector("summary")?.focus();
    }

    syncOpenState();
    details.addEventListener("toggle", syncOpenState);
    document.addEventListener("keydown", handleEscape);
    return () => {
      details.removeEventListener("toggle", syncOpenState);
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, []);

  function closeMenu() {
    if (detailsRef.current) detailsRef.current.open = false;
    setMenuOpen(false);
  }

  function handleScrollLink(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    closeMenu();
    document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const navLinks = isComingSoon
    ? [
        { href: "/demo", label: "서비스 소개", scroll: false },
        { href: "/about", label: "운영 원칙", scroll: false },
        { href: "/privacy", label: "개인정보", scroll: false },
        { href: "/beta#cta", label: "사용자 연구", scroll: false },
      ]
    : [
        { href: weddingPath(), label: "커뮤니티", scroll: false },
        { href: weddingPath("/market-prices"), label: "시세 정보", scroll: false },
        { href: weddingPath("/etiquette"), label: "결혼 예절", scroll: false },
        { href: "/about", label: "소개", scroll: false },
        { href: demoMode ? "/demo#cta" : "/#cta", label: "시작하기", scroll: false },
      ];
  const useDarkColors = darkAtTop && !scrolled && !menuOpen;

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] px-[clamp(16px,5vw,60px)] h-[72px] flex items-center justify-between transition-all duration-500 ${
        scrolled || menuOpen
          ? "bg-ivory-50/98 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : ""
      }`}
    >
      <a href={demoMode ? "/demo" : "/"} className="no-underline">
        <Logo size="sm" variant={useDarkColors ? "white" : "default"} />
      </a>

      <div className="flex gap-7 items-center max-md:hidden">
        {navLinks.map((link) =>
          link.scroll ? (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => handleScrollLink(event, link.href)}
              className={`relative text-[14px] font-normal tracking-wide no-underline transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full ${useDarkColors ? "text-white/85 hover:text-white" : "text-charcoal hover:text-noir-800"}`}
            >
              {link.label}
            </a>
          ) : (
            <a
              key={link.href}
              href={link.href}
              className={`relative text-[14px] font-normal tracking-wide no-underline transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full ${useDarkColors ? "text-white/85 hover:text-white" : "text-charcoal hover:text-noir-800"}`}
            >
              {link.label}
            </a>
          )
        )}
        <a
          href={EXAMPLE_APP_HREF}
          className={`text-[13px] font-medium no-underline transition-colors ${useDarkColors ? "text-white/85 hover:text-white" : "text-[#36534E] hover:text-[#263832]"}`}
        >
          {EXAMPLE_APP_LABEL}
        </a>
        <a
          href={ACCOUNT_HREF}
          className="px-6 py-2.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[13px] font-medium tracking-wide no-underline hover:-translate-y-0.5 transition-all shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
        >
          {ACCOUNT_LABEL}
        </a>
      </div>

      <details ref={detailsRef} className="group md:hidden">
        <summary
          className="flex list-none flex-col justify-center items-center w-10 h-10 gap-[5px] bg-transparent border-none cursor-pointer [&::-webkit-details-marker]:hidden"
          aria-label={menuOpen ? "메뉴 닫기" : "메뉴 열기"}
          aria-expanded={menuOpen}
          aria-controls="customer-mobile-menu"
        >
          <span
            className={`block w-5 h-[1.5px] transition-all duration-300 origin-center group-open:rotate-45 group-open:translate-y-[6.5px] group-open:!bg-noir-800 ${useDarkColors ? "bg-white" : "bg-noir-800"}`}
          />
          <span
            className={`block w-5 h-[1.5px] transition-all duration-300 group-open:opacity-0 group-open:scale-x-0 group-open:!bg-noir-800 ${useDarkColors ? "bg-white" : "bg-noir-800"}`}
          />
          <span
            className={`block w-5 h-[1.5px] transition-all duration-300 origin-center group-open:-rotate-45 group-open:-translate-y-[6.5px] group-open:!bg-noir-800 ${useDarkColors ? "bg-white" : "bg-noir-800"}`}
          />
        </summary>

        <button
          type="button"
          tabIndex={-1}
          className="fixed inset-0 z-[998] cursor-default bg-transparent"
          onClick={closeMenu}
          aria-label="모바일 메뉴 닫기"
        />

        <div
          id="customer-mobile-menu"
          className="fixed top-[72px] left-0 right-0 z-[999] max-h-[calc(100vh-72px)] overflow-y-auto bg-ivory-50/98 px-6 py-4 opacity-100 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl"
        >
          <div className="flex flex-col">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={link.scroll
                  ? (event) => handleScrollLink(event, link.href)
                  : closeMenu}
                className="flex items-center justify-between py-4 text-[16px] text-noir-800 font-medium no-underline border-b border-platinum/40 hover:text-rose-500 transition-colors"
              >
                {link.label}
                <svg className="w-4 h-4 text-taupe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </a>
            ))}

            <div className="grid gap-3 pt-5 pb-2">
              <a
                href={EXAMPLE_APP_HREF}
                onClick={closeMenu}
                className="flex items-center justify-center w-full py-3.5 border border-[#36534E]/30 text-[#36534E] rounded-full text-[14px] font-medium no-underline"
              >
                {EXAMPLE_APP_LABEL}
              </a>
              <a
                href={ACCOUNT_HREF}
                onClick={closeMenu}
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[14px] font-medium no-underline shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
              >
                {ACCOUNT_LABEL}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </details>
    </nav>
  );
}
