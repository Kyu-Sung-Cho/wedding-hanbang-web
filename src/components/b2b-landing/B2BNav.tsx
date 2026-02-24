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
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-noir-800/90 backdrop-blur-md border-b border-white/[0.06]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/business" className="flex items-center gap-2">
          <Logo size="sm" variant="white" />
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="#partner-types"
            className="hidden sm:block px-4 py-2 text-[13px] text-white/60 hover:text-white transition-colors"
          >
            파트너 설문
          </Link>
          <Link
            href="/vendor/login"
            className="hidden sm:block px-4 py-2 text-[13px] text-white/60 hover:text-white transition-colors"
          >
            업체 로그인
          </Link>
          <Link
            href="/vendor/service"
            className="px-5 py-2.5 rounded-full bg-gradient-to-r from-rose-500 to-gold text-white text-[13px] font-medium hover:shadow-[0_4px_16px_rgba(196,150,126,0.3)] transition-all"
          >
            서비스 안내 & 업체 등록
          </Link>
        </div>
      </div>
    </nav>
  );
}
