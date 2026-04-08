"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Logo from "@/components/ui/Logo";

export default function B2BNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] px-[clamp(20px,5vw,60px)] h-[72px] flex items-center justify-between transition-all duration-300 ${
        scrolled
          ? "bg-noir-800/90 backdrop-blur-md border-b border-white/[0.06]"
          : "bg-transparent"
      }`}
    >
      <Link href="/business" className="flex items-center gap-2">
        <Logo size="sm" variant="white" />
      </Link>
      <div className="flex items-center gap-9 max-md:hidden">
        <Link
          href="/"
          className="text-[23px] text-white/60 hover:text-white transition-colors tracking-wide"
        >
          고객 페이지
        </Link>
        <button
          onClick={() => document.getElementById("partner-types")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="text-[23px] text-white/60 hover:text-white transition-colors tracking-wide"
        >
          파트너 설문
        </button>
        <Link
          href="/vendor/login"
          className="text-[23px] text-white/60 hover:text-white transition-colors tracking-wide"
        >
          업체 로그인
        </Link>
        <Link
          href="/vendor/service"
          className="px-6 py-2.5 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[25px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] hover:-translate-y-0.5 transition-all"
        >
          서비스 안내 & 업체 등록
        </Link>
      </div>
    </nav>
  );
}
