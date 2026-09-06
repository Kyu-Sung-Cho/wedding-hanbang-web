"use client";

import Link from "next/link";
import { ClipboardList, LayoutDashboard, Sparkles, Users, Wallet } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";

const links = [
  { href: "/chat/missions", label: "아모라", icon: Sparkles },
  { href: "/lounge", label: "라운지", icon: LayoutDashboard },
  { href: "/checklist", label: "체크리스트", icon: ClipboardList },
  { href: "/budget", label: "예산", icon: Wallet },
  { href: "/community", label: "커뮤니티", icon: Users },
];

export default function AmoraBottomNav({ active = "amora" }: { active?: "amora" | "checklist" }) {
  return (
    <nav aria-label="모바일 주요 기능" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-[var(--amora-line)] bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {links.map(({ href, label, icon: Icon }, index) => (
        <Link key={href} {...weddingLinkProps(href)} aria-current={index === (active === "checklist" ? 2 : 0) ? "location" : undefined}
          className={`flex min-h-[74px] flex-col items-center justify-center gap-[6px] rounded-md text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--amora-accent)] ${index === (active === "checklist" ? 2 : 0) ? "font-semibold text-[var(--amora-ink)]" : "text-[var(--amora-muted)]"}`}>
          <Icon aria-hidden className="size-[19px]" strokeWidth={1.7} />{label}
        </Link>
      ))}
    </nav>
  );
}
