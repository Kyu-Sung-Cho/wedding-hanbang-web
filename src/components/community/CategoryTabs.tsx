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
      <div className="flex items-center gap-2 min-w-max pb-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
              isActive(tab.href)
                ? "text-white bg-[#C4967E]"
                : "text-[#928980] bg-white border border-[#F5F2ED] hover:text-[#1A1A1F] hover:border-[#B5ADA3]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
