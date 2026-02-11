"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] flex h-[72px] items-center justify-between px-5 transition-all duration-500 md:px-[60px] ${
        scrolled
          ? "bg-ivory-50/92 shadow-[0_1px_0_rgba(0,0,0,0.04)] backdrop-blur-[20px] backdrop-saturate-[180%]"
          : ""
      }`}
    >
      <Link href="/" className="flex items-center gap-2.5 no-underline">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-rose-500 to-gold text-base font-semibold text-white font-display tracking-[-0.5px]">
          한
        </div>
        <span className="text-lg font-medium font-serif tracking-[-0.5px] text-noir-800">
          웨딩한방
        </span>
      </Link>

      <div className="hidden items-center gap-9 md:flex">
        <a
          href="#features"
          className="group relative text-sm font-normal text-charcoal tracking-[0.02em] transition-colors hover:text-noir-800"
        >
          기능
          <span className="absolute -bottom-1 left-0 h-[1.5px] w-0 bg-rose-500 transition-all duration-300 group-hover:w-full" />
        </a>
        <a
          href="#fitting"
          className="group relative text-sm font-normal text-charcoal tracking-[0.02em] transition-colors hover:text-noir-800"
        >
          가상 피팅
          <span className="absolute -bottom-1 left-0 h-[1.5px] w-0 bg-rose-500 transition-all duration-300 group-hover:w-full" />
        </a>
        <a
          href="#how"
          className="group relative text-sm font-normal text-charcoal tracking-[0.02em] transition-colors hover:text-noir-800"
        >
          이용방법
          <span className="absolute -bottom-1 left-0 h-[1.5px] w-0 bg-rose-500 transition-all duration-300 group-hover:w-full" />
        </a>
        <a
          href="#reviews"
          className="group relative text-sm font-normal text-charcoal tracking-[0.02em] transition-colors hover:text-noir-800"
        >
          후기
          <span className="absolute -bottom-1 left-0 h-[1.5px] w-0 bg-rose-500 transition-all duration-300 group-hover:w-full" />
        </a>
        <Link
          href="/login"
          className="rounded-full border-[1.5px] border-platinum px-5 py-2 text-[13px] font-medium tracking-[0.03em] text-noir-800 transition-all hover:-translate-y-px hover:border-rose-500 hover:text-rose-500"
        >
          로그인
        </Link>
        <Link
          href="/login"
          className="rounded-full bg-noir-800 px-6 py-2.5 text-[13px] font-medium tracking-[0.03em] text-white transition-all hover:-translate-y-px hover:bg-noir-soft"
        >
          서비스 시작하기
        </Link>
      </div>
    </nav>
  );
}
