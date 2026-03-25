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
    <header className="sticky top-0 z-50 bg-white border-b border-[#EDEFF1]">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex items-center gap-4 h-12">
          {/* 왼쪽: 로고 */}
          <Link
            href="/"
            className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-lg font-medium text-[#1A1A1F] shrink-0"
          >
            웨딩한방
          </Link>

          {/* 가운데: 검색바 */}
          <div className="hidden sm:flex flex-1 max-w-xl mx-auto">
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#878A8C]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-4 py-1.5 text-sm bg-[#F6F7F8] border border-[#EDEFF1] rounded-full placeholder-[#878A8C] text-[#1A1A1F] focus:outline-none focus:border-[#0079D3] focus:bg-white transition-colors"
              />
            </div>
          </div>

          {/* 오른쪽: 글쓰기, 유저/로그인 */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/community/write"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A1A1F] border border-[#878A8C] rounded hover:bg-[#F6F7F8] transition-colors"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>

            {user ? (
              <Link
                href="/settings"
                className="w-8 h-8 rounded flex items-center justify-center text-[#878A8C] hover:bg-[#F6F7F8] transition-colors"
              >
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-1.5 text-sm font-semibold text-white bg-[#0079D3] rounded-full hover:bg-[#006CBD] transition-colors"
              >
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 */}
            <button
              type="button"
              className="sm:hidden p-2 text-[#878A8C] hover:text-[#1A1A1F] transition-colors rounded hover:bg-[#F6F7F8]"
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
        <div className="sm:hidden border-t border-[#EDEFF1] bg-white">
          <div className="mx-auto max-w-5xl px-4 py-3 flex flex-col gap-2">
            {/* 모바일 검색바 */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#878A8C]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-4 py-2 text-sm bg-[#F6F7F8] border border-[#EDEFF1] rounded-full placeholder-[#878A8C] text-[#1A1A1F] focus:outline-none focus:border-[#0079D3] focus:bg-white transition-colors"
              />
            </div>

            {/* 모바일 글쓰기 버튼 */}
            <Link
              href="/community/write"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-[#1A1A1F] border border-[#878A8C] rounded hover:bg-[#F6F7F8] transition-colors"
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
