"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, PenSquare, X } from "lucide-react";
import UserMenu from "@/components/community/UserMenu";
import Logo from "@/components/ui/Logo";
import { useAuthStore } from "@/stores/authStore";

const navItems = [
  { href: "/community#community-feed", label: "후기·질문" },
  { href: "/community/cohort", label: "동기방" },
  { href: "/dashboard", label: "준비실" },
];

export default function CommunityNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = useAuthStore((state) => state.profile);

  return (
    <header className="sticky top-0 z-30 border-b border-[#e7dad1]/80 bg-[#f8f3ed]/92 backdrop-blur-[14px]">
      <div className="flex h-[72px] w-full items-center justify-between px-5">
        <Link href="/" className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
          <Logo size="md" />
        </Link>

        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-[#2f2a26] md:flex">
          {navItems.map((item, index) => (
            <div key={item.href} className="flex items-center gap-6">
              {index > 0 && <span className="h-4 w-px bg-[#e7dad1]" aria-hidden />}
              <Link href={item.href} className="transition-colors hover:text-[#7a4e43]">
                {item.label}
              </Link>
            </div>
          ))}
          <Link
            href="/community/post/write"
            className="inline-flex items-center gap-2 rounded-full bg-[#2f2a26] px-6 py-3 text-[14px] font-semibold text-white shadow-[0_10px_24px_rgba(47,42,38,0.16)] transition-transform hover:-translate-y-0.5"
          >
            <PenSquare className="h-4 w-4" />
            글쓰기
          </Link>
          {profile ? (
            <UserMenu />
          ) : (
            <Link href="/login" className="text-[14px] font-semibold text-[#2f2a26] transition-colors hover:text-[#7a4e43]">
              로그인
            </Link>
          )}
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#e7dad1] text-[#2f2a26] md:hidden"
          aria-label="커뮤니티 메뉴"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-t border-[#e7dad1] bg-[#f8f3ed] md:hidden">
          <div className="flex w-full flex-col gap-2 px-5 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#2f2a26] hover:bg-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/community/post/write"
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-[#e7dad1] bg-white px-5 py-3 text-[14px] font-semibold text-[#7a4e43]"
            >
              <PenSquare className="h-4 w-4" />
              글쓰기
            </Link>
            {profile ? (
              <div className="flex justify-center py-2">
                <UserMenu />
              </div>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center justify-center rounded-full border border-[#e7dad1] bg-white px-5 py-3 text-[14px] font-semibold text-[#2f2a26]"
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
