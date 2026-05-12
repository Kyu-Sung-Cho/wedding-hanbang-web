"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { FileSearch, Search, PenSquare, Menu, X, User } from "lucide-react";
import MyToolsWidget from "@/components/community/MyToolsWidget";

export default function CommunityNav() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") ?? "");

  useEffect(() => {
    setSearchQuery(searchParams.get("search") ?? "");
  }, [searchParams]);

  const handleSearch = () => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    router.push(`/community?search=${encodeURIComponent(trimmed)}`);
    setMobileMenuOpen(false);
  };

  const clearSearch = () => {
    setSearchQuery("");
    router.push("/community");
  };

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
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#F0EFED]">
      <div className="mx-auto max-w-[1920px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 sm:gap-4 h-14 sm:h-16">
          {/* 왼쪽: 로고 + 커뮤니티 */}
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/"
              className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-xl sm:text-[22px] text-[#1A1A1F]"
            >
              웨딩한방
            </Link>
            <span className="hidden sm:inline text-[#B5ADA3]">/</span>
            <Link href="/community" className="hidden sm:inline text-base text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors">
              커뮤니티
            </Link>
          </div>

          {/* 가운데: 검색바 */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
            className="hidden sm:flex flex-1 max-w-xl mx-auto"
          >
            <div className="relative w-full">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5ADA3] cursor-pointer"
                onClick={handleSearch}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="견적, 업체명, 계약조건 검색"
                className="w-full pl-11 pr-11 py-2.5 text-sm bg-[#FAFAF8] border border-[#F0EFED] rounded-full placeholder-[#B5ADA3] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:shadow-[0_0_0_2px_rgba(196,150,126,0.1)] focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors"
                  aria-label="검색 초기화"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>

          {/* 오른쪽: 준비 도구 + 글쓰기 + 유저/로그인 */}
          <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
            {user && <MyToolsWidget variant="nav" />}

            <Link
              href="/community/quote-check"
              className="hidden md:flex items-center gap-2 rounded-full bg-[#795252]/10 px-4 py-2 text-sm font-medium text-[#795252] transition-colors hover:bg-[#795252]/15"
            >
              <FileSearch className="w-4 h-4" />
              견적진단
            </Link>

            <Link
              href="/community/post/write"
              className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-[#1A1A1F] border border-[#F0EFED] rounded-full hover:bg-[#FAFAF8] transition-all"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>

            {user ? (
              <Link
                href="/settings"
                className="w-9 h-9 rounded-full flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAFAF8] hover:text-[#1A1A1F] transition-all"
              >
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium text-white bg-[#795252] rounded-full hover:bg-[#946a6a] transition-colors"
              >
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 */}
            <button
              type="button"
              className="sm:hidden p-2.5 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors rounded-full hover:bg-[#FAFAF8]"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="메뉴"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-[#F0EFED] bg-white">
          <div className="mx-auto max-w-[1600px] px-4 py-4 flex flex-col gap-3">
            <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="relative">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B5ADA3] cursor-pointer"
                onClick={handleSearch}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="견적, 업체명, 계약조건 검색"
                className="w-full pl-11 pr-11 py-3 text-base bg-[#FAFAF8] border border-[#F0EFED] rounded-full placeholder-[#B5ADA3] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors"
                  aria-label="검색 초기화"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </form>

            {user && <MyToolsWidget variant="sidebar" />}

            <Link
              href="/community/quote-check"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-2 px-5 py-3 text-base font-medium text-[#795252] bg-[#795252]/10 rounded-full hover:bg-[#795252]/15 transition-all"
            >
              <FileSearch className="w-5 h-5" />
              견적진단
            </Link>

            <Link
              href="/community/post/write"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-2 px-5 py-3 text-base text-[#1A1A1F] border border-[#F0EFED] rounded-full hover:bg-[#FAFAF8] transition-all"
            >
              <PenSquare className="w-5 h-5" />
              글쓰기
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
