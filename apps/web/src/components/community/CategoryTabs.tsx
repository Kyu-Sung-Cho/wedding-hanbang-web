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
  const [moreOpen, setMoreOpen] = useState(true);

  function isActive(href: string) {
    if (href === "/community") {
      return pathname === "/community";
    }
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* 데스크탑: Atelier Hub 레퍼런스 세로 네비게이션 */}
      <nav className="hidden lg:flex flex-col flex-1 space-y-1 pr-2">
        {/* 주요 네비 */}
        <Link
          href="/community"
          className={`flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 ${
            isActive("/community") && pathname === "/community"
              ? "bg-[#f6f3f2] text-[#795252] font-bold"
              : "text-[#504444] hover:bg-white hover:text-[#795252]"
          }`}
        >
          <Home
            className={`mr-4 w-[22px] h-[22px] ${
              isActive("/community") && pathname === "/community"
                ? "opacity-80"
                : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-[17px] tracking-widest uppercase">전체</span>
        </Link>

        <Link
          href="/community?sort=hot"
          className="flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 text-[#504444] hover:bg-white hover:text-[#795252]"
        >
          <Flame className="mr-4 w-[22px] h-[22px] opacity-60 group-hover:opacity-100" />
          <span className="text-[17px] tracking-widest uppercase">인기</span>
        </Link>

        <Link
          href="/community/guestbook"
          className={`flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 ${
            isActive("/community/guestbook")
              ? "bg-[#f6f3f2] text-[#795252] font-bold"
              : "text-[#504444] hover:bg-white hover:text-[#795252]"
          }`}
        >
          <BookOpen
            className={`mr-4 w-[22px] h-[22px] ${
              isActive("/community/guestbook") ? "opacity-80" : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-[17px] tracking-widest uppercase">내 방명록</span>
        </Link>

        <Link
          href="/community/my/bookmarks"
          className={`flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 ${
            isActive("/community/my/bookmarks")
              ? "bg-[#f6f3f2] text-[#795252] font-bold"
              : "text-[#504444] hover:bg-white hover:text-[#795252]"
          }`}
        >
          <Bookmark
            className={`mr-4 w-[22px] h-[22px] ${
              isActive("/community/my/bookmarks") ? "opacity-80" : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-[17px] tracking-widest uppercase">북마크</span>
        </Link>

        <Link
          href="/community/my/upvoted"
          className={`flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 ${
            isActive("/community/my/upvoted")
              ? "bg-[#f6f3f2] text-[#795252] font-bold"
              : "text-[#504444] hover:bg-white hover:text-[#795252]"
          }`}
        >
          <ThumbsUp
            className={`mr-4 w-[22px] h-[22px] ${
              isActive("/community/my/upvoted") ? "opacity-80" : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-[17px] tracking-widest uppercase">좋아요</span>
        </Link>

        {/* 카테고리 섹션 */}
        <div className="pt-4">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center justify-between w-full px-4 py-2 text-sm font-medium text-[#504444] uppercase tracking-wider hover:text-[#795252] transition-colors"
          >
            <span>카테고리</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                moreOpen ? "" : "rotate-180"
              }`}
            />
          </button>

          <div
            className={`space-y-1 overflow-hidden transition-all duration-200 ${
              moreOpen ? "max-h-[600px]" : "max-h-0"
            }`}
          >
            {COMMUNITY_CATEGORIES.map((cat) => {
              const href = `/community/${cat.key}`;
              const active = isActive(href);
              const Icon = ICON_MAP[cat.icon] || MessageSquare;

              return (
                <Link
                  key={cat.key}
                  href={href}
                  className={`flex items-center px-5 py-4 rounded-r-full group hover:translate-x-1 transition-transform duration-200 ${
                    active
                      ? "bg-[#f6f3f2] text-[#795252] font-bold"
                      : "text-[#504444] hover:bg-white hover:text-[#795252]"
                  }`}
                >
                  <Icon
                    className={`mr-4 w-[22px] h-[22px] ${
                      active ? "opacity-80" : "opacity-60 group-hover:opacity-100"
                    }`}
                  />
                  <span className="text-[17px] tracking-widest uppercase">{cat.label}</span>
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
                ? "bg-[#795252] text-white font-medium"
                : "text-[#504444] bg-white border border-[#e4e2e1] hover:bg-[#f6f3f2]"
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
                    ? "bg-[#795252] text-white font-medium"
                    : "text-[#504444] bg-white border border-[#e4e2e1] hover:bg-[#f6f3f2]"
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
