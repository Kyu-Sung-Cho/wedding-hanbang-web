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
    <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
      <div className="flex items-center gap-6 min-w-max border-b border-[#F0EFED]">
        {tabs.map((tab) => {
          const active = isActive(tab.href);

          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`relative pb-3 text-sm whitespace-nowrap transition-colors duration-200 ${
                active
                  ? "text-[#1A1A1F] font-medium"
                  : "text-[#B5ADA3] hover:text-[#878680]"
              }`}
            >
              {tab.label}
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C4967E] rounded-full" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
