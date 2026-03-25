"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { Search, PenSquare, Menu, X, User } from "lucide-react";

export default function CommunityNav() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-[#E5E7EB]">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex items-center gap-4 h-14">
          {/* 왼쪽: 로고 */}
          <Link
            href="/"
            className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-lg font-semibold text-[#1c1c1e] shrink-0 tracking-tight"
          >
            웨딩한방
          </Link>

          {/* 가운데: 검색바 */}
          <div className="hidden sm:flex flex-1 max-w-xl mx-auto">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-4 py-2 text-sm bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg placeholder-[#6B7280] text-[#1c1c1e] focus:outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)] focus:bg-white transition-all"
              />
            </div>
          </div>

          {/* 오른쪽: 글쓰기, 유저/로그인 */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/community/write"
              className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#1c1c1e] border border-[#E5E7EB] rounded-lg hover:bg-[#F4F6F8] hover:border-[#D1D5DB] transition-all"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>

            {user ? (
              <Link
                href="/settings"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-[#6B7280] hover:bg-[#F4F6F8] hover:text-[#1c1c1e] transition-all"
              >
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors"
              >
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 */}
            <button
              type="button"
              className="sm:hidden p-2 text-[#6B7280] hover:text-[#1c1c1e] transition-colors rounded-lg hover:bg-[#F4F6F8]"
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
        <div className="sm:hidden border-t border-[#E5E7EB] bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3 flex flex-col gap-2.5">
            {/* 모바일 검색바 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-[#F4F6F8] border border-[#E5E7EB] rounded-lg placeholder-[#6B7280] text-[#1c1c1e] focus:outline-none focus:border-[#2563EB] focus:shadow-[0_0_0_2px_rgba(37,99,235,0.1)] focus:bg-white transition-all"
              />
            </div>

            {/* 모바일 글쓰기 버튼 */}
            <Link
              href="/community/write"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#1c1c1e] border border-[#E5E7EB] rounded-lg hover:bg-[#F4F6F8] transition-all"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
