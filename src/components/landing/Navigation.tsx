"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 50);
    }
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-[1000] px-[60px] h-[90px] flex items-center justify-between transition-all duration-500 max-md:px-5 ${
        scrolled
          ? "bg-ivory-50/92 backdrop-blur-[20px] backdrop-saturate-[180%] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : ""
      }`}
    >
      <a href="#" className="no-underline">
        <Logo size="sm" />
      </a>

      <div className="flex gap-9 items-center max-md:hidden">
        {[
          { href: "#features", label: "기능" },
          { href: "#fitting", label: "가상 피팅" },
          { href: "#how", label: "이용방법" },
          { href: "#reviews", label: "후기" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(e) => handleClick(e, link.href)}
            className="relative text-charcoal text-[23px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
          >
            {link.label}
          </a>
        ))}
        <a
          href="/business"
          className="relative text-charcoal text-[23px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
        >
          업체 파트너
        </a>
        <a
          href="#cta"
          onClick={(e) => handleClick(e, "#cta")}
          className="px-6 py-2.5 bg-noir-800 text-white rounded-full text-[25px] font-medium tracking-wide no-underline hover:bg-noir-soft hover:-translate-y-0.5 transition-all"
        >
          사전 등록하기
        </a>
      </div>
    </nav>
  );
}
