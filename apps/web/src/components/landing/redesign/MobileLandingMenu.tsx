"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import TrackedLandingLink from "./TrackedLandingLink";
import { headerAuth } from "./landingContent";

type MobileLandingMenuProps = {
  items: ReadonlyArray<{
    label: string;
    href: string;
  }>;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2";
const navigationLinkClassName = `flex min-h-11 items-center px-4 py-3 text-[14px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:bg-[var(--color-paper-sheet)] hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`;

export default function MobileLandingMenu({ items }: MobileLandingMenuProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false;
    setIsOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !detailsRef.current?.open) return;
    event.preventDefault();
    closeMenu();
    summaryRef.current?.focus();
  };

  // Escape와 항목 선택으로는 닫히지만, 터치 사용자의 본능적인 동작인 "바깥을
  // 누르기"로는 닫히지 않아 패널이 콘텐츠 위에 계속 떠 있었다. 열려 있을 때만
  // 리스너를 건다. 포커스는 되돌리지 않는다 — 바깥을 누른 곳이 사용자의 의도다.
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = detailsRef.current;
      if (!root || !(event.target instanceof Node)) return;
      if (root.contains(event.target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <details
      ref={detailsRef}
      className="relative lg:hidden"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      onKeyDown={handleKeyDown}
    >
      <summary
        ref={summaryRef}
        aria-label={isOpen ? "주요 메뉴 닫기" : "주요 메뉴 열기"}
        aria-expanded={isOpen}
        aria-controls="landing-mobile-menu"
        title="메뉴"
        className={`flex h-11 w-11 cursor-pointer list-none items-center justify-center text-[var(--color-paper-ink)] [&::-webkit-details-marker]:hidden ${focusRing}`}
      >
        {isOpen ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Menu className="h-5 w-5" aria-hidden="true" />
        )}
      </summary>
      <nav
        id="landing-mobile-menu"
        aria-label="모바일 주요 메뉴"
        // `right-0`은 뷰포트가 아니라 이 버튼의 오른쪽 끝에 붙는다. 그 끝이 320px
        // 화면에서 x=211이라 224px 패널이 왼쪽으로 13px 밀려나 메뉴 글자가 잘렸다
        // (실측 -13..211). 360px 이상은 여유가 있어 그대로 두고, 그 아래에서만
        // 뷰포트에 붙여 항상 화면 안에 들어오게 한다.
        className="fixed inset-x-3 top-16 flex max-h-[calc(100dvh-90px)] flex-col overflow-y-auto overscroll-contain rounded-[6px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-2 shadow-overlay min-[360px]:absolute min-[360px]:inset-x-auto min-[360px]:right-0 min-[360px]:top-12 min-[360px]:w-56"
      >
        {items.map((item) => item.href.startsWith("#") ? (
          <Link
            key={item.href}
            href={item.href}
            onClick={closeMenu}
            className={navigationLinkClassName}
          >
            {item.label}
          </Link>
        ) : (
          <TrackedLandingLink key={item.href} href={item.href} source="landing_header" onClickCapture={closeMenu} className={navigationLinkClassName}>
            {item.label}
          </TrackedLandingLink>
        ))}
        <TrackedLandingLink
          href={headerAuth.signUp.href}
          source="landing_header"
          prefetch={false}
          onClickCapture={closeMenu}
          className={`flex min-h-11 items-center border-t border-[var(--color-paper-divider)] px-4 py-3 text-[14px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:bg-[var(--color-paper-sheet)] hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`}
        >
          {headerAuth.signUp.label}
        </TrackedLandingLink>
        <Link
          href={headerAuth.logIn.href}
          onClick={closeMenu}
          className={`flex min-h-11 items-center border-t border-[var(--color-paper-divider)] px-4 py-3 text-[14px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:bg-[var(--color-paper-sheet)] hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`}
        >
          로그인
        </Link>
      </nav>
    </details>
  );
}
