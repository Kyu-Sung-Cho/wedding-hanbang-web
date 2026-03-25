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
      <div className="flex items-center gap-2 min-w-max py-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`px-3 py-1 text-xs whitespace-nowrap rounded-full transition-all duration-200 ${
              isActive(tab.href)
                ? "bg-[#1c1c1e] text-white font-medium"
                : "text-[#6B7280] hover:bg-[#F4F6F8]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
