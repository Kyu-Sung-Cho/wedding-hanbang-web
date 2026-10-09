"use client";

import Link from "next/link";

export default function LandingSkipLink() {
  return (
    <Link
      href="#main-content"
      onNavigate={() => document.getElementById("main-content")?.focus({ preventScroll: true })}
      className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-[6px] bg-[var(--color-paper-card)] px-5 py-3 text-[14px] font-semibold text-[var(--color-paper-ink)] shadow-raised transition-transform duration-200 motion-reduce:transition-none focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--color-paper-pen)] focus:ring-offset-2"
    >
      본문 바로가기
    </Link>
  );
}
