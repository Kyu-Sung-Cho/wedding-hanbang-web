"use client";

import { useEffect, useState } from "react";
import Logo from "@/components/ui/Logo";

const isComingSoonEnv = process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon";

interface CustomerNavProps {
  demoMode?: boolean;
}

export default function CustomerNav({ demoMode }: CustomerNavProps = {}) {
  const isComingSoon = demoMode ? false : isComingSoonEnv;
  const loginHref = demoMode ? "/demo/login" : "/login";
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
      className={`fixed top-0 left-0 right-0 z-[1000] px-[clamp(20px,5vw,60px)] h-[72px] flex items-center justify-between transition-all duration-500 ${
        scrolled
          ? "bg-ivory-50/92 backdrop-blur-[20px] backdrop-saturate-[180%] shadow-[0_1px_0_rgba(0,0,0,0.04)]"
          : ""
      }`}
    >
      <a href={demoMode ? "/demo" : "/"} className="no-underline">
        <Logo size="sm" />
      </a>

      <div className="flex gap-9 items-center max-md:hidden">
        {[
          { href: "#features", label: "기능" },
          { href: "#reviews", label: "이용 사례" },
          { href: "#cta", label: "시작하기" },
        ].map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(e) => handleClick(e, link.href)}
            className="relative text-charcoal text-[53px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
          >
            {link.label}
          </a>
        ))}
        <a
          href="/community"
          className="relative text-charcoal text-[53px] font-normal tracking-wide no-underline hover:text-noir-800 transition-colors after:content-[''] after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[1.5px] after:bg-rose-500 after:transition-[width] after:duration-300 hover:after:w-full"
        >
          커뮤니티
        </a>
        <a
          href={loginHref}
          className="px-6 py-2.5 bg-noir-800 text-white rounded-full text-[31px] font-medium tracking-wide no-underline hover:bg-noir-soft hover:-translate-y-0.5 transition-all"
        >
          {isComingSoon ? "미리 체험하기" : "무료 시작하기"}
        </a>
      </div>
    </nav>
  );
}
