"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Flame,
  Camera,
  Building2,
  Receipt,
  Lightbulb,
  Plane,
  MessageCircleQuestion,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";
import { useState } from "react";

// 아이콘 매핑
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Camera,
  Building2,
  Receipt,
  Lightbulb,
  Plane,
  MessageCircleQuestion,
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
      {/* 데스크탑: 레딧 스타일 세로 네비게이션 */}
      <nav className="hidden lg:flex flex-col h-full">
        {/* 메인 메뉴 */}
        <div className="space-y-0.5 mb-6">
          <Link
            href="/community"
            className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-150 ${
              isActive("/community") && pathname === "/community"
                ? "bg-[#F0EFED] text-[#1A1A1F] font-medium"
                : "text-[#1A1A1F] hover:bg-[#F5F2ED]"
            }`}
          >
            <Home className="w-5 h-5 shrink-0" />
            <span className="text-[15px]">홈</span>
          </Link>
          <Link
            href="/community?sort=hot"
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-[#1A1A1F] hover:bg-[#F5F2ED] transition-all duration-150"
          >
            <Flame className="w-5 h-5 shrink-0" />
            <span className="text-[15px]">인기</span>
          </Link>
        </div>

        {/* 구분선 */}
        <div className="border-t border-[#F0EFED] mx-3 mb-4" />

        {/* 카테고리 섹션 */}
        <div>
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex items-center justify-between w-full px-4 py-2 text-xs font-medium text-[#B5ADA3] uppercase tracking-wider hover:text-[#878680] transition-colors"
          >
            <span>카테고리</span>
            <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${moreOpen ? "rotate-180" : ""}`} />
          </button>

          <div className={`space-y-0.5 overflow-hidden transition-all duration-200 ${moreOpen ? "max-h-0" : "max-h-[500px]"}`}>
            {COMMUNITY_CATEGORIES.map((cat) => {
              const href = `/community/${cat.key}`;
              const active = isActive(href);
              const Icon = ICON_MAP[cat.icon] || MessageSquare;

              return (
                <Link
                  key={cat.key}
                  href={href}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-150 ${
                    active
                      ? "bg-[#F0EFED] text-[#1A1A1F] font-medium"
                      : "text-[#1A1A1F] hover:bg-[#F5F2ED]"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0 text-[#878680]" />
                  <span className="text-[15px]">{cat.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* 모바일/태블릿: 가로 스크롤 칩 */}
      <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex items-center gap-2 min-w-max py-1">
          <Link
            href="/community"
            className={`flex items-center gap-1.5 px-4 py-2 text-[15px] rounded-full whitespace-nowrap transition-all duration-200 ${
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
                className={`flex items-center gap-1.5 px-4 py-2 text-[15px] rounded-full whitespace-nowrap transition-all duration-200 ${
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
