"use client";

import Link from "next/link";
import { CalendarDays, ClipboardList, LayoutDashboard, Wallet } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { weddingLinkProps } from "@/lib/weddingPaths";

const links = [
  { href: "/lounge", label: "라운지", icon: LayoutDashboard },
  { href: "/chat", label: "아모라", icon: AmoraMark },
  { href: "/checklist", label: "체크리스트", icon: ClipboardList },
  { href: "/schedule", label: "일정", icon: CalendarDays },
  { href: "/budget", label: "예산", icon: Wallet },
];

export default function AmoraBottomNav({ active = "amora" }: { active?: "amora" | "checklist" | "lounge" | "schedule" | "budget" | null }) {
  const activeIndex = active === null ? -1 : active === "budget" ? 4 : active === "schedule" ? 3 : active === "checklist" ? 2 : active === "lounge" ? 0 : 1;
  return (
    <nav aria-label="모바일 주요 기능" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--amora-line)] bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {links.map(({ href, label, icon: Icon }, index) => (
        <Link key={href} {...weddingLinkProps(href)} aria-current={index === activeIndex ? "location" : undefined}
          className={`flex min-h-[74px] flex-col items-center justify-center gap-[6px] rounded-md text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--amora-accent)] ${index === activeIndex ? "font-semibold text-[var(--amora-selected-text)]" : "text-[var(--amora-muted)]"}`}>
          <Icon aria-hidden className="size-[19px]" strokeWidth={1.7} />{label}
        </Link>
      ))}
    </nav>
  );
}
