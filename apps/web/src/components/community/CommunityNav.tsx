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
  { href: "/lounge", label: "웨딩 라운지" },
];

export default function CommunityNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = useAuthStore((state) => state.profile);

  return (
    <header className="bg-[#fcfaf6]">
      <div className="mx-auto flex h-[76px] w-[calc(100%_-_32px)] max-w-[1300px] items-center justify-between md:w-[calc(100%_-_48px)]">
        <Link href="/" className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
          <Logo size="lg" />
        </Link>

        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-[#071629] md:flex">
          {navItems.map((item, index) => (
            <div key={item.href} className="flex items-center gap-6">
              {index > 0 && <span className="h-4 w-px bg-[#eadfc9]" aria-hidden />}
              <Link href={item.href} className="transition-colors hover:text-[#b68a3a]">
                {item.label}
              </Link>
            </div>
          ))}
          <Link
            href="/community/post/write"
            className="inline-flex items-center gap-2 rounded-full bg-[#061a34] px-6 py-3 text-[14px] font-semibold text-[#ecd7a4] shadow-[0_10px_24px_rgba(6,26,52,0.16)] transition-transform hover:-translate-y-0.5"
          >
            <PenSquare className="h-4 w-4" />
            글쓰기
          </Link>
          {profile ? (
            <UserMenu />
          ) : (
            <Link href="/login" className="text-[14px] font-semibold text-[#071629] transition-colors hover:text-[#b68a3a]">
              로그인
            </Link>
          )}
        </nav>

        <button
          type="button"
          onClick={() => setMobileOpen((value) => !value)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#eadfc9] text-[#071629] md:hidden"
          aria-label="커뮤니티 메뉴"
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {mobileOpen && (
        <div className="border-t border-[#eadfc9] bg-[#fcfaf6] md:hidden">
          <div className="mx-auto flex w-[calc(100%_-_32px)] max-w-[1300px] flex-col gap-2 py-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className="rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#071629] hover:bg-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/community/post/write"
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[14px] font-semibold text-[#9d6f36]"
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
                className="inline-flex items-center justify-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[14px] font-semibold text-[#071629]"
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
