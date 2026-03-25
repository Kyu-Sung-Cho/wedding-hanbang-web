"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Search, PenSquare, Menu, X, User } from "lucide-react";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";

export default function CommunityNav() {
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? undefined } : null);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 카테고리 탭 데이터: "전체" + 각 카테고리
  const tabs = [
    { key: "all", label: "전체", href: "/community" },
    ...COMMUNITY_CATEGORIES.map((cat) => ({
      key: cat.key,
      label: cat.shortLabel,
      href: `/community/${cat.key}`,
    })),
  ];

  function isTabActive(tabHref: string) {
    if (tabHref === "/community") {
      return pathname === "/community";
    }
    return pathname.startsWith(tabHref);
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-[#F5F2ED]">
      <div className="mx-auto max-w-5xl px-4">
        {/* 상단 행: 로고, 검색, 글쓰기, 유저 */}
        <div className="flex items-center justify-between h-14">
          {/* 왼쪽: 로고 */}
          <Link
            href="/"
            className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-xl font-medium text-[#1A1A1F] shrink-0"
          >
            웨딩한방
          </Link>

          {/* 가운데: 데스크탑 카테고리 탭 */}
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                className={`px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                  isTabActive(tab.href)
                    ? "text-[#C4967E] bg-[#C4967E]/10"
                    : "text-[#928980] hover:text-[#1A1A1F] hover:bg-[#FAF8F5]"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>

          {/* 오른쪽: 검색, 글쓰기, 유저/로그인 */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="p-2 text-[#928980] hover:text-[#1A1A1F] transition-colors rounded-lg hover:bg-[#FAF8F5]"
              aria-label="검색"
            >
              <Search className="w-5 h-5" />
            </button>

            <Link
              href="/community/write"
              className="hidden sm:flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-xl transition-colors"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>

            {user ? (
              <Link
                href="/settings"
                className="w-8 h-8 rounded-full bg-[#F5F2ED] flex items-center justify-center text-[#928980] hover:bg-[#C4967E]/10 hover:text-[#C4967E] transition-colors"
              >
                <User className="w-4 h-4" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm font-medium text-[#C4967E] border border-[#C4967E] rounded-xl hover:bg-[#C4967E]/10 transition-colors"
              >
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 */}
            <button
              type="button"
              className="lg:hidden p-2 text-[#928980] hover:text-[#1A1A1F] transition-colors rounded-lg hover:bg-[#FAF8F5]"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="메뉴"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-[#F5F2ED] bg-white">
          <nav className="mx-auto max-w-5xl px-4 py-3 flex flex-col gap-1">
            {tabs.map((tab) => (
              <Link
                key={tab.key}
                href={tab.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  isTabActive(tab.href)
                    ? "text-[#C4967E] bg-[#C4967E]/10"
                    : "text-[#928980] hover:text-[#1A1A1F] hover:bg-[#FAF8F5]"
                }`}
              >
                {tab.label}
              </Link>
            ))}
            {/* 모바일 글쓰기 버튼 */}
            <Link
              href="/community/write"
              onClick={() => setMobileMenuOpen(false)}
              className="mt-2 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-white bg-[#C4967E] hover:bg-[#9A6B62] rounded-xl transition-colors"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
