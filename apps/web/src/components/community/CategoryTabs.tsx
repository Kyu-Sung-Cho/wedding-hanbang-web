"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Flame,
  HelpCircle,
  Camera,
  Lightbulb,
  GraduationCap,
  MessageSquare,
  ChevronDown,
  BookOpen,
  Bookmark,
  ThumbsUp,
} from "lucide-react";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";
import { useState } from "react";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  HelpCircle,
  Camera,
  Lightbulb,
  GraduationCap,
  MessageSquare,
};

export default function CategoryTabs() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/community") {
      return pathname === "/community";
    }
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* 데스크탑: 에디토리얼 세로 네비게이션 */}
      <nav className="hidden lg:flex flex-col h-full">
        <div className="space-y-0.5 mb-8">
          <Link
            href="/community"
            className={`flex items-center gap-4 px-5 py-3 transition-all duration-200 ${
              isActive("/community") && pathname === "/community"
                ? "bg-[#F6F3F2] text-[#C4967E] font-bold rounded-r-full"
                : "text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1"
            } transition-transform`}
          >
            <Home className="w-5 h-5 shrink-0" />
            <span className="text-sm tracking-wide uppercase">홈</span>
          </Link>
          <Link
            href="/community?sort=hot"
            className="flex items-center gap-4 px-5 py-3 text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1 transition-all duration-200"
          >
            <Flame className="w-5 h-5 shrink-0" />
            <span className="text-sm tracking-wide uppercase">인기</span>
          </Link>
          <Link
            href="/community/guestbook"
            className="flex items-center gap-4 px-5 py-3 text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1 transition-all duration-200"
          >
            <BookOpen className="w-5 h-5 shrink-0" />
            <span className="text-sm tracking-wide uppercase">내 방명록</span>
          </Link>
          <Link
            href="/community/my/bookmarks"
            className={`flex items-center gap-4 px-5 py-3 transition-all duration-200 ${
              isActive("/community/my/bookmarks")
                ? "bg-[#F6F3F2] text-[#C4967E] font-bold rounded-r-full"
                : "text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1"
            } transition-transform`}
          >
            <Bookmark className="w-5 h-5 shrink-0" />
            <span className="text-sm tracking-wide uppercase">북마크</span>
          </Link>
          <Link
            href="/community/my/upvoted"
            className={`flex items-center gap-4 px-5 py-3 transition-all duration-200 ${
              isActive("/community/my/upvoted")
                ? "bg-[#F6F3F2] text-[#C4967E] font-bold rounded-r-full"
                : "text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1"
            } transition-transform`}
          >
            <ThumbsUp className="w-5 h-5 shrink-0" />
            <span className="text-sm tracking-wide uppercase">좋아요</span>
          </Link>
        </div>

        {/* 구분: 넓은 여백 대신 미세한 배경 전환 */}
        <div className="h-px bg-[#F0EFED]/60 mx-5 mb-6" />

        <div>
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center justify-between w-full px-5 py-2.5 text-[11px] font-medium text-[#B5ADA3] uppercase tracking-[0.15em] hover:text-[#878680] transition-colors"
          >
            <span>카테고리</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`} />
          </button>

          <div className={`space-y-0.5 overflow-hidden transition-all duration-200 ${moreOpen ? "max-h-0" : "max-h-[600px]"}`}>
            {COMMUNITY_CATEGORIES.map((cat) => {
              const href = `/community/${cat.key}`;
              const active = isActive(href);
              const Icon = ICON_MAP[cat.icon] || MessageSquare;

              return (
                <Link
                  key={cat.key}
                  href={href}
                  className={`flex items-center gap-4 px-5 py-3 transition-all duration-200 ${
                    active
                      ? "bg-[#F6F3F2] text-[#C4967E] font-bold rounded-r-full"
                      : "text-[#504444] hover:bg-[#FDFCFA] hover:text-[#C4967E] rounded-r-full hover:translate-x-1"
                  } transition-transform`}
                >
                  <Icon className="w-5 h-5 shrink-0 opacity-60" />
                  <span className="text-sm tracking-wide uppercase">{cat.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* 모바일/태블릿: 가로 스크롤 칩 */}
      <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex items-center gap-2.5 min-w-max py-1">
          <Link
            href="/community"
            className={`px-5 py-2.5 text-base rounded-full whitespace-nowrap transition-all duration-200 ${
              pathname === "/community"
                ? "bg-[#1A1A1F] text-white font-medium"
                : "text-[#878680] bg-white border border-[#F0EFED] hover:bg-[#FAFAF8]"
            }`}
          >
            전체
          </Link>
          {COMMUNITY_CATEGORIES.map((cat) => {
            const href = `/community/${cat.key}`;
            const active = isActive(href);
            return (
              <Link
                key={cat.key}
                href={href}
                className={`px-5 py-2.5 text-base rounded-full whitespace-nowrap transition-all duration-200 ${
                  active
                    ? "bg-[#1A1A1F] text-white font-medium"
                    : "text-[#878680] bg-white border border-[#F0EFED] hover:bg-[#FAFAF8]"
                }`}
              >
                {cat.shortLabel}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
