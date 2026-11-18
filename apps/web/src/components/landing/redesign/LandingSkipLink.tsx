"use client";

import Link from "next/link";

export default function LandingSkipLink() {
  return (
    <Link
      href="#main-content"
      onNavigate={() => document.getElementById("main-content")?.focus({ preventScroll: true })}
      className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-[22px] bg-inv-white px-5 py-3 font-inv-sans text-[14px] font-medium text-inv-ink shadow-raised transition-transform duration-200 motion-reduce:transition-none focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[var(--hb-focus-ring)] focus:ring-offset-2"
    >
      본문 바로가기
    </Link>
  );
}
