"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PenSquare, X } from "lucide-react";
import UserMenu from "@/components/community/UserMenu";
import Logo from "@/components/ui/Logo";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

const baseNavItems = [
  { linkProps: weddingLinkProps("/chat"), legacyPath: "/chat", label: "아모라" },
  { linkProps: weddingLinkProps("/community/cohort"), legacyPath: "/community/cohort", label: "동기방" },
  { linkProps: weddingLinkProps("/lounge"), legacyPath: "/lounge", label: "웨딩 라운지" },
];

export default function CommunityNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const profile = useAuthStore((state) => state.profile);
  const currentPath = stripWeddingBasePath(pathname);
  const isCohortRoom = /^\/community\/cohort\/[^/]+/.test(currentPath);
  const navItems = isCohortRoom
    ? baseNavItems.map((item) =>
        item.legacyPath === "/community/cohort" ? { linkProps: weddingLinkProps(), legacyPath: "/community", label: "커뮤니티" } : item
      )
    : baseNavItems;

  return (
    <header className="sticky top-0 z-50 border-b border-[#eadfc9] bg-[#fffdf7]/94 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            {...weddingLinkProps()}
            className="inline-flex shrink-0 items-center whitespace-nowrap"
            aria-label="웨딩한방 홈으로 이동"
          >
            <Logo size="md" />
          </Link>
          <span className="hidden truncate border-l border-[#eadfc9] pl-4 text-[12px] font-semibold leading-none text-[#36534e] lg:inline">
            예비부부가 함께 나누는 결혼 준비 커뮤니티
          </span>
        </div>

        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-[#071629] md:flex">
          {navItems.map((item, index) => (
            <div key={item.legacyPath} className="flex items-center gap-6">
              {index > 0 && <span className="h-4 w-px bg-[#eadfc9]" aria-hidden />}
              <Link {...item.linkProps} className="transition-colors hover:text-[#b68a3a]">
                {item.label}
              </Link>
            </div>
          ))}
          <Link
            {...weddingLinkProps("/community/post/write")}
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
        <div className="border-t border-[#eadfc9] bg-[#fffdf7] md:hidden">
          <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-2 px-4 py-4 sm:px-6 lg:px-8">
            {navItems.map((item) => (
              <Link
                key={item.legacyPath}
                {...item.linkProps}
                onClick={() => setMobileOpen(false)}
                className="rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#071629] hover:bg-white"
              >
                {item.label}
              </Link>
            ))}
            <Link
              {...weddingLinkProps("/community/post/write")}
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
