"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Menu, X } from "lucide-react";
import UserMenu from "@/components/community/UserMenu";
import Logo from "@/components/ui/Logo";
import { useAuthStore } from "@/stores/authStore";

const navItems = [
  { href: "/community", label: "커뮤니티" },
  { href: "/community/about", label: "커뮤니티 소개" },
  { href: "/dashboard", label: "서비스 소개" },
];

export default function CommunityNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = useAuthStore((state) => state.profile);

  return (
    <header className="sticky top-0 z-50 border-b border-[#eadcc9]/70 bg-[#fffdf9]/88 backdrop-blur-[18px]">
      <div className="mx-auto flex h-[76px] w-[calc(100%_-_48px)] max-w-[1300px] items-center justify-between">
        <Link href="/community" className="inline-flex items-center whitespace-nowrap">
          <Logo size="lg" />
        </Link>

        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-[#263832] md:flex">
          {navItems.map((item, index) => (
            <div key={item.href} className="flex items-center gap-6">
              {index > 0 && <span className="h-4 w-px bg-[#e5d8ca]" aria-hidden />}
              <Link href={item.href} className="transition-colors hover:text-[#36534E]">
                {item.label}
              </Link>
            </div>
          ))}
          <Link
            href="/chat"
            className="inline-flex items-center gap-2 rounded-full bg-[#36534E] px-6 py-3 text-[14px] font-semibold text-[#ffffff] shadow-[0_12px_28px_rgba(54,83,78,0.22)] transition-all hover:-translate-y-0.5 hover:bg-[#1f3d38]"
          >
            아모라 체험하기
            <ChevronRight className="h-4 w-4" />
          </Link>
          {profile ? (
            <UserMenu />
          ) : (
            <Link href="/login" className="text-[14px] font-semibold text-[#263832] transition-colors hover:text-[#36534E]">
              로그인
            </Link>
          )}
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#e5d8ca] text-[#263832] md:hidden"
          aria-label="커뮤니티 메뉴"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-t border-[#e5d8ca] bg-[#fffdf9] md:hidden">
          <div className="mx-auto flex w-[calc(100%_-_48px)] max-w-[1300px] flex-col gap-2 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#263832] hover:bg-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/chat"
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 py-3 text-[14px] font-semibold text-white"
            >
              아모라 체험하기
              <ChevronRight className="h-4 w-4" />
            </Link>
            {profile ? (
              <div className="flex justify-center py-2">
                <UserMenu />
              </div>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-[#e5d8ca] bg-white px-5 py-3 text-[14px] font-semibold text-[#263832]"
              >
                로그인
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
