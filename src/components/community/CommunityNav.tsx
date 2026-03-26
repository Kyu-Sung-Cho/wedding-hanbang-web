"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { Search, PenSquare, Menu, X, User } from "lucide-react";

export default function CommunityNav() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") ?? "");

  // URL의 search 파라미터가 바뀌면 입력값도 동기화
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
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#F0EFED]">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-4 h-14">
          {/* 왼쪽: 로고 + 커뮤니티 */}
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/"
              className="font-[family-name:var(--font-serif-kr,_'Noto_Serif_KR',_serif)] text-lg text-[#1A1A1F] tracking-tight"
            >
              웨딩한방
            </Link>
            <span className="text-[#B5ADA3] text-sm">/</span>
            <span className="text-sm text-[#B5ADA3]">커뮤니티</span>
          </div>

          {/* 가운데: 검색바 */}
          <form
            onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
            className="hidden sm:flex flex-1 max-w-xl mx-auto"
          >
            <div className="relative w-full">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5ADA3] cursor-pointer"
                onClick={handleSearch}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-9 py-2 text-sm bg-[#FAFAF8] border border-[#F0EFED] rounded-xl placeholder-[#B5ADA3] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:shadow-[0_0_0_2px_rgba(196,150,126,0.1)] focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors"
                  aria-label="검색 초기화"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>

          {/* 오른쪽: 글쓰기, 유저/로그인 */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/community/post/write"
              className="hidden sm:flex items-center gap-2 px-4 py-2 text-sm text-[#1A1A1F] border border-[#F0EFED] rounded-xl hover:bg-[#FAFAF8] transition-all"
            >
              <PenSquare className="w-4 h-4" />
              글쓰기
            </Link>

            {user ? (
              <Link
                href="/settings"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAFAF8] hover:text-[#1A1A1F] transition-all"
              >
                <User className="w-5 h-5" />
              </Link>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium text-white bg-[#1A1A1F] rounded-xl hover:bg-[#2d2d30] transition-colors"
              >
                로그인
              </Link>
            )}

            {/* 모바일 햄버거 */}
            <button
              type="button"
              className="sm:hidden p-2 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors rounded-xl hover:bg-[#FAFAF8]"
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
        <div className="sm:hidden border-t border-[#F0EFED] bg-white">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8 py-4 flex flex-col gap-3">
            {/* 모바일 검색바 */}
            <form onSubmit={(e) => { e.preventDefault(); handleSearch(); }} className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5ADA3] cursor-pointer"
                onClick={handleSearch}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="커뮤니티 검색"
                className="w-full pl-9 pr-9 py-2 text-sm bg-[#FAFAF8] border border-[#F0EFED] rounded-xl placeholder-[#B5ADA3] text-[#1A1A1F] focus:outline-none focus:border-[#C4967E] focus:shadow-[0_0_0_2px_rgba(196,150,126,0.1)] focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B5ADA3] hover:text-[#1A1A1F] transition-colors"
                  aria-label="검색 초기화"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>

            {/* 모바일 글쓰기 버튼 */}
            <Link
              href="/community/post/write"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-2 px-4 py-2 text-sm text-[#1A1A1F] border border-[#F0EFED] rounded-xl hover:bg-[#FAFAF8] transition-all"
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
