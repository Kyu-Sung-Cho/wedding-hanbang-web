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
import { stripWeddingBasePath, weddingPath } from "@/lib/weddingPaths";
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
  const currentPath = stripWeddingBasePath(pathname);
  const [moreOpen, setMoreOpen] = useState(true);

  function isActive(href: string) {
    if (href === "/community") {
      return currentPath === "/community";
    }
    return currentPath.startsWith(href);
  }

  return (
    <>
      {/* 데스크탑: 세로 네비게이션 */}
      <nav className="hidden xl:flex flex-col space-y-1">
        {/* 주요 네비 */}
        <Link
          href={weddingPath()}
          className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
            isActive("/community") && currentPath === "/community"
              ? "bg-[#f6efe5] text-[#36534E] font-bold"
              : "text-[#635b51] hover:bg-white hover:text-[#36534E]"
          }`}
        >
          <Home
            className={`mr-2.5 w-4 h-4 ${
              isActive("/community") && currentPath === "/community"
                ? "opacity-80"
                : "opacity-60 group-hover:opacity-100"
            }`}
          />
          <span className="text-sm">전체</span>
        </Link>

        <Link
          href={weddingPath("/community?sort=hot")}
          className="flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 text-[#635b51] hover:bg-white hover:text-[#36534E]"
        >
          <Flame className="mr-2.5 w-4 h-4 opacity-60 group-hover:opacity-100" />
          <span className="text-sm">인기</span>
        </Link>

        {/* 카테고리 섹션 */}
        <div className="pt-3">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-[#635b51] uppercase tracking-wider hover:text-[#36534E] transition-colors"
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
                  href={weddingPath(href)}
                  className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
                    active
                      ? "bg-[#f6efe5] text-[#36534E] font-bold"
                      : "text-[#635b51] hover:bg-white hover:text-[#36534E]"
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
          <div className="px-3 py-2 text-xs font-medium text-[#635b51] uppercase tracking-wider">
            내 활동
          </div>
          <Link
            href={weddingPath("/community/my/bookmarks")}
            className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
              isActive("/community/my/bookmarks")
                ? "bg-[#f6efe5] text-[#36534E] font-bold"
                : "text-[#635b51] hover:bg-white hover:text-[#36534E]"
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
            href={weddingPath("/community/my/upvoted")}
            className={`flex items-center px-3 py-2.5 rounded-lg group transition-colors duration-200 ${
              isActive("/community/my/upvoted")
                ? "bg-[#f6efe5] text-[#36534E] font-bold"
                : "text-[#635b51] hover:bg-white hover:text-[#36534E]"
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
            href={weddingPath()}
            className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-all duration-200 ${
              currentPath === "/community"
                ? "bg-[#36534E] text-white font-medium"
                : "text-[#635b51] bg-white border border-[#e5d8ca] hover:bg-[#f6efe5]"
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
                href={weddingPath(href)}
                className={`px-4 py-2 text-sm rounded-full whitespace-nowrap transition-all duration-200 ${
                  active
                    ? "bg-[#36534E] text-white font-medium"
                    : "text-[#635b51] bg-white border border-[#e5d8ca] hover:bg-[#f6efe5]"
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
