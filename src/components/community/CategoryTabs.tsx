"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Camera,
  Building2,
  Receipt,
  Lightbulb,
  Plane,
  MessageCircleQuestion,
  MessageSquare,
} from "lucide-react";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";

// 카테고리 color 문자열 → 활성 탭 스타일 매핑
const ACTIVE_TAB_STYLES: Record<string, string> = {
  all: "bg-[#1c1c1e] text-white",
  "rose-600": "bg-rose-50 text-rose-700 border border-rose-200",
  "amber-600": "bg-amber-50 text-amber-700 border border-amber-200",
  "emerald-600": "bg-emerald-50 text-emerald-700 border border-emerald-200",
  "yellow-600": "bg-yellow-50 text-yellow-700 border border-yellow-200",
  "sky-600": "bg-sky-50 text-sky-700 border border-sky-200",
  "violet-600": "bg-violet-50 text-violet-700 border border-violet-200",
  "slate-600": "bg-slate-50 text-slate-700 border border-slate-200",
};

// 아이콘 이름 → 컴포넌트 매핑
const ICON_MAP: Record<string, typeof Camera> = {
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

  // color 문자열에서 "text-" 접두사 제거 → ACTIVE_TAB_STYLES 키로 사용
  function colorKey(color: string) {
    return color.replace("text-", "");
  }

  const tabs = [
    {
      key: "all",
      label: "전체",
      href: "/community",
      icon: LayoutGrid,
      colorKey: "all",
    },
    ...COMMUNITY_CATEGORIES.map((cat) => ({
      key: cat.key,
      label: cat.shortLabel,
      href: `/community/${cat.key}`,
      icon: ICON_MAP[cat.icon] || LayoutGrid,
      colorKey: colorKey(cat.color),
    })),
  ];

  function isActive(tabHref: string) {
    if (tabHref === "/community") {
      return pathname === "/community";
    }
    return pathname.startsWith(tabHref);
  }

  return (
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
      <div className="flex items-center gap-2 min-w-max py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          const activeStyle =
            ACTIVE_TAB_STYLES[tab.colorKey] || ACTIVE_TAB_STYLES.all;

          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs whitespace-nowrap rounded-full transition-all duration-200 ${
                active
                  ? `${activeStyle} font-medium`
                  : "text-[#6B7280] hover:bg-[#F4F6F8]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
