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
      {/* 데스크탑: 세로 네비게이션 */}
      <nav className="hidden xl:flex flex-col space-y-1">
        {/* 주요 네비 */}
        <Link
          href="/community"
          className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
            isActive("/community") && pathname === "/community"
              ? "bg-[#fff8ec] text-[#9d6f36] font-bold"
              : "text-[#5d6879] hover:bg-white hover:text-[#9d6f36]"
          }`}
        >
          <Home
            className={`mr-2.5 w-4 h-4 ${
              isActive("/community") && pathname === "/community"
                ? "opacity-80"
                : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-sm">전체</span>
        </Link>

        <Link
          href="/community?sort=hot"
          className="flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 text-[#5d6879] hover:bg-white hover:text-[#9d6f36]"
        >
          <Flame className="mr-2.5 w-4 h-4 opacity-60 group-hover:opacity-100" />
          <span className="text-sm">인기</span>
        </Link>

        {/* 카테고리 섹션 */}
        <div className="pt-3">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-[#5d6879] uppercase tracking-wider hover:text-[#9d6f36] transition-colors"
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
                  className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
                    active
                      ? "bg-[#fff8ec] text-[#9d6f36] font-bold"
                      : "text-[#5d6879] hover:bg-white hover:text-[#9d6f36]"
                  }`}
                >
                  <Icon
                    className={`mr-2.5 w-4 h-4 ${
                      active ? "opacity-80" : "opacity-60 group-hover:opacity-100"
                    }`}
                  />
                  <span className="text-sm">{cat.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="pt-3">
          <div className="px-3 py-2 text-xs font-medium text-[#5d6879] uppercase tracking-wider">
            내 활동
          </div>
          <Link
            href="/community/my/bookmarks"
            className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
              isActive("/community/my/bookmarks")
                ? "bg-[#fff8ec] text-[#9d6f36] font-bold"
                : "text-[#5d6879] hover:bg-white hover:text-[#9d6f36]"
            }`}
          >
            <Bookmark
              className={`mr-2.5 w-4 h-4 ${
                isActive("/community/my/bookmarks") ? "opacity-80" : "opacity-60 group-hover:opacity-100"
              }`}
            />
            <span className="text-sm">북마크</span>
          </Link>

          <Link
            href="/community/my/upvoted"
            className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
              isActive("/community/my/upvoted")
                ? "bg-[#fff8ec] text-[#9d6f36] font-bold"
                : "text-[#5d6879] hover:bg-white hover:text-[#9d6f36]"
            }`}
          >
            <ThumbsUp
              className={`mr-2.5 w-4 h-4 ${
                isActive("/community/my/upvoted") ? "opacity-80" : "opacity-60 group-hover:opacity-100"
              }`}
            />
            <span className="text-sm">좋아요</span>
          </Link>
        </div>
      </nav>

      {/* 모바일/태블릿: 가로 스크롤 칩 */}
      <div className="xl:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex items-center gap-2.5 min-w-max py-1">
          <Link
            href="/community"
            className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-all duration-200 ${
              pathname === "/community"
                ? "bg-[#9d6f36] text-white font-medium"
                : "text-[#5d6879] bg-white border border-[#eadfc9] hover:bg-[#fff8ec]"
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
                className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-all duration-200 ${
                  active
                    ? "bg-[#9d6f36] text-white font-medium"
                    : "text-[#5d6879] bg-white border border-[#eadfc9] hover:bg-[#fff8ec]"
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
