"use client";

import { useRouter } from "next/navigation";

import { useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";
import { weddingPath } from "@/lib/weddingPaths";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerNavProps {
  demoMode?: boolean;
  /**
   * 이 헤더가 **어두운 히어로 위에** 떠 있는가.
   *
   * 헤더는 스크롤 전에는 투명이라 뒤 페이지 색이 그대로 비친다. 그래서 로고와 메뉴
   * 글자가 밝아야 할지 어두워야 할지는 **페이지가 알고 헤더는 모른다.**
   *
   * 안 넘기면 `/beta` 처럼 어두운 페이지에서 어두운 글자가 어두운 바탕에 얹힌다 —
   * 2026-08-28 실측 대비 1.13:1 로 사실상 안 보였다. 스크롤해서 헤더가 밝아지면
   * 다시 어두운 글자로 돌아온다.
   */
  onDark?: boolean;
}

/**
 * 화면 안 앵커(`#cta`)를 못 찾았을 때 보낼 곳. 베타 신청 폼이 실제로 있는 화면이다.
 * `/about` 에도 같은 앵커가 있지만 신청의 정본은 `/beta` 다.
 */
const SCROLL_ANCHOR_HOME = "/beta";

export default function CustomerNav({ demoMode, onDark }: CustomerNavProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  /**
   * **데모 화면에서도 정품 로그인으로 보낸다.**
   *
   * 예전에는 `/demo/login` 으로 보냈다. 그 화면은 `/login` 의 복제본인데
   * 두 가지가 달랐다:
   *
   * 1. `INTERNAL DEV` 배지가 조건 없이 렌더된다 — 공개 화면에서 닿는 자리다.
   * 2. **"로그인 없이 체험하기" 입구가 없다.** 정품 `/login` 에는 있다
   *    (`handleDemo` → `/api/demo/start`).
   *
   * 즉 데모를 보러 온 사람을 데모를 **못 쓰는** 화면으로 보내고 있었다.
   * 정품으로 보내면 배지가 사라지고 체험 입구가 생긴다.
   */
  const loginHref = "/login";
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

  /**
   * 같은 화면 안 앵커로 스크롤한다. **타깃이 없으면 조용히 끝나지 않는다.**
   *
   * `preventDefault()` 를 이미 불렀기 때문에, 타깃을 못 찾고 그냥 반환하면 브라우저의
   * 기본 이동도 막힌 채로 **아무 일도 일어나지 않는다.** 실제로 `/demo` 와 `/beta` 의
   * "베타 신청" 이 그랬다 — `id="cta"` 는 `/about` 에만 있었다.
   *
   * 그래서 못 찾으면 그 앵커가 사는 화면으로 실제로 보낸다.
   */
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    setMenuOpen(false);
    const target = href.startsWith("#") ? document.querySelector(href) : null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    router.push(`${SCROLL_ANCHOR_HOME}${href}`);
  }

  const navLinks = [
    { href: weddingPath(), label: "커뮤니티", scroll: false },
    { href: weddingPath("/market-prices"), label: "공시 가격", scroll: false },
    { href: weddingPath("/manners"), label: "결혼 예절", scroll: false },
    { href: "/about", label: "소개", scroll: false },
    { href: "#cta", label: "베타 신청", scroll: true },
  ];

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-[1000] px-[clamp(16px,5vw,60px)] h-[72px] flex items-center justify-between transition-all duration-500 ${
          scrolled || menuOpen
            ? "bg-[var(--hb-surface-page)]/92 backdrop-blur-[20px] backdrop-saturate-[180%] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
            : ""
        }`}
      >
        <a href={demoMode ? "/demo" : "/"} className="no-underline">
          <Logo size="sm" variant={onDark && !(scrolled || menuOpen) ? "white" : "default"} />
        </a>

        {/* 데스크톱 메뉴 */}
        <div className="flex gap-9 items-center max-md:hidden">
          {navLinks.map((link) =>
            link.scroll ? (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => handleClick(e, link.href)}
                className={`relative ${onDark && !(scrolled || menuOpen) ? "text-[var(--hb-on-primary)]" : "text-charcoal"} text-[14px] font-normal tracking-wide no-underline hover:text-[var(--hb-text-strong)] transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full`}
              >
                {link.label}
              </a>
            ) : (
              <a
                key={link.href}
                href={link.href}
                className={`relative ${onDark && !(scrolled || menuOpen) ? "text-[var(--hb-on-primary)]" : "text-charcoal"} text-[14px] font-normal tracking-wide no-underline hover:text-[var(--hb-text-strong)] transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full`}
              >
                {link.label}
              </a>
            )
          )}
          <a
            href={loginHref}
            className="px-6 py-2.5 bg-gradient-to-br from-[#795252] to-[#946a6a] text-white rounded-full text-[13px] font-medium tracking-wide no-underline hover:-translate-y-0.5 transition-all shadow-[0_4px_14px_0_rgba(121,82,82,0.2)]"
          >
            {isComingSoon ? "미리 체험하기" : "시작하기"}
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
            className={`block w-5 h-[1.5px] bg-[var(--hb-primary)] transition-all duration-300 origin-center ${
              menuOpen ? "rotate-45 translate-y-[6.5px]" : ""
            }`}
          />
          <span
            className={`block w-5 h-[1.5px] bg-[var(--hb-primary)] transition-all duration-300 ${
              menuOpen ? "opacity-0 scale-x-0" : ""
            }`}
          />
          <span
            className={`block w-5 h-[1.5px] bg-[var(--hb-primary)] transition-all duration-300 origin-center ${
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
        className={`fixed top-[72px] left-0 right-0 z-[999] bg-[var(--hb-surface-page)]/98 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.08)] overflow-hidden transition-all duration-300 ease-in-out md:hidden ${
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
              className="flex items-center justify-between py-4 text-[16px] text-[var(--hb-text-strong)] font-medium no-underline border-b border-platinum/40 hover:text-rose-500 transition-colors"
            >
              {link.label}
              <svg className="w-4 h-4 text-[var(--hb-text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
              {isComingSoon ? "미리 체험하기" : "서비스 시작하기"}
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
