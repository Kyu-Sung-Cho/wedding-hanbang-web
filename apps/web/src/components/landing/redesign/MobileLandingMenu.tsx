"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type MobileLandingMenuProps = {
  items: ReadonlyArray<{
    label: string;
    href: string;
  }>;
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]";

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
        className={`flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden ${focusRing}`}
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
        className="absolute right-0 top-12 flex w-56 flex-col rounded-[16px] border border-white/12 bg-[#243832] p-2 shadow-overlay"
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={closeMenu}
            className={`flex min-h-11 items-center px-4 py-3 text-[14px] font-semibold text-white/78 transition-colors duration-200 hover:bg-white/8 hover:text-white ${focusRing}`}
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/login"
          onClick={closeMenu}
          className={`flex min-h-11 items-center border-t border-white/12 px-4 py-3 text-[14px] font-semibold text-white/78 transition-colors duration-200 hover:bg-white/8 hover:text-white ${focusRing}`}
        >
          로그인
        </Link>
      </nav>
    </details>
  );
}
