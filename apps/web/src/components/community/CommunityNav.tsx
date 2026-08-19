"use client";

import { useState } from "react";
import Link from "next/link";
import { Gavel, Menu, PenSquare, X } from "lucide-react";
import UserMenu from "@/components/community/UserMenu";
import Logo from "@/components/ui/Logo";
import { weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

const baseNavItems = [
  { linkProps: weddingLinkProps("/chat"), legacyPath: "/chat", label: "아모라" },
  { linkProps: weddingLinkProps("/schedule"), legacyPath: "/schedule", label: "할 일·일정" },
  { linkProps: weddingLinkProps("/budget"), legacyPath: "/budget", label: "예산" },
  // 예절 가이드는 이 네비를 쓰는 화면(`(community)/etiquette`)에 있으면서 정작
  // 여기 링크가 없었다 — 들어온 사람이 나갈 수는 있어도 찾아 들어올 수는 없었다.
  { linkProps: weddingLinkProps("/manners"), legacyPath: "/manners", label: "결혼 예절" },
  {
    linkProps: weddingLinkProps("/community?feed=all"),
    legacyPath: "/community",
    label: "커뮤니티",
  },
];

export default function CommunityNav({
  weddingCourtEnabled,
}: {
  weddingCourtEnabled: boolean;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const profile = useAuthStore((state) => state.profile);

  return (
    <header className="sticky top-0 z-50 border-b border-[#eadfc9] bg-[#fffdf7]/94 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] w-full max-w-[1320px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            {...weddingLinkProps()}
            className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap"
            aria-label="웨딩한방 홈으로 이동"
          >
            <Logo size="md" />
          </Link>
          <span className="hidden truncate border-l border-[#eadfc9] pl-4 text-[12px] font-semibold leading-none text-[#36534e] lg:inline">
            결혼 준비, 아모라와 처음부터 끝까지.
          </span>
        </div>

        <nav className="hidden items-center gap-6 text-[15px] font-semibold text-[#071629] md:flex">
          {baseNavItems.map((item, index) => (
            <div key={item.legacyPath} className="flex items-center gap-6">
              {index > 0 && <span className="h-4 w-px bg-[#eadfc9]" aria-hidden />}
              <Link
                {...item.linkProps}
                className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-[#b68a3a]"
              >
                {item.label}
              </Link>
            </div>
          ))}
          {weddingCourtEnabled && (
            <Link
              {...weddingLinkProps("/community/wedding-court")}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#eadfc9] text-[#36534e] transition-colors hover:border-[#a77b74] hover:text-[#8f6662]"
              aria-label="오늘의 웨딩 선택 법정"
              title="오늘의 웨딩 선택 법정"
            >
              <Gavel className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link
            {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#061a34] px-6 py-3 text-[14px] font-semibold text-[#ecd7a4] shadow-[0_10px_24px_rgba(6,26,52,0.16)] transition-transform hover:-translate-y-0.5"
          >
            고민 올리기
            <PenSquare className="h-4 w-4" />
          </Link>
          {profile ? (
            <UserMenu />
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-[14px] font-semibold text-[#071629] transition-colors hover:text-[#b68a3a]"
            >
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
            {baseNavItems.map((item) => (
              <Link
                key={item.legacyPath}
                {...item.linkProps}
                onClick={() => setMobileOpen(false)}
                className="rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#071629] hover:bg-white"
              >
                {item.label}
              </Link>
            ))}
            {weddingCourtEnabled && (
              <Link
                {...weddingLinkProps("/community/wedding-court")}
                onClick={() => setMobileOpen(false)}
                className="inline-flex items-center gap-2 rounded-[12px] px-3 py-3 text-[15px] font-semibold text-[#36534e] hover:bg-white"
              >
                <Gavel className="h-4 w-4" aria-hidden />
                오늘의 웨딩 선택 법정
              </Link>
            )}
            <Link
              {...weddingLinkProps("/community/post/write?prefill=community_question&category=is_normal")}
              onClick={() => setMobileOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[14px] font-semibold text-[#9d6f36]"
            >
              고민 올리기
              <PenSquare className="h-4 w-4" />
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
