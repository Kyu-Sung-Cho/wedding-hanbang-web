"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";

export default function CategoryTabs() {
  const pathname = usePathname();

  const tabs = [
    { key: "all", label: "전체", href: "/community" },
    ...COMMUNITY_CATEGORIES.map((cat) => ({
      key: cat.key,
      label: cat.shortLabel,
      href: `/community/${cat.key}`,
    })),
  ];

  function isActive(tabHref: string) {
    if (tabHref === "/community") {
      return pathname === "/community";
    }
    return pathname.startsWith(tabHref);
  }

  return (
    <>
      {/* 데스크탑: 세로 사이드바 */}
      <nav className="hidden lg:block bg-white rounded-2xl border border-[#F0EFED] p-4">
        <h3 className="px-3 pb-3 text-sm font-medium text-[#B5ADA3] tracking-wide">
          카테고리
        </h3>
        <ul className="space-y-1">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  className={`block px-3 py-2.5 text-base rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-[#FAFAF8] text-[#1A1A1F] font-medium"
                      : "text-[#878680] hover:bg-[#FAFAF8] hover:text-[#1A1A1F]"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    {tab.label}
                    {active && (
                      <span className="w-2 h-2 rounded-full bg-[#C4967E]" />
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 모바일/태블릿: 가로 스크롤 */}
      <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
        <div className="flex items-center gap-2 min-w-max py-1">
          {tabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`px-4 py-2 text-base rounded-full whitespace-nowrap transition-all duration-200 ${
                  active
                    ? "bg-[#1A1A1F] text-white font-medium"
                    : "text-[#878680] bg-white border border-[#F0EFED] hover:bg-[#FAFAF8]"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
