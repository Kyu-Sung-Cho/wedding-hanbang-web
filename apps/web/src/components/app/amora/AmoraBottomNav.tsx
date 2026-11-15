"use client";

import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { weddingLinkProps } from "@/lib/weddingPaths";

/**
 * 폰 폭 아래 탐색. 사이드바와 같이 둘만 둔다(2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라).
 * 체크리스트·일정·예산은 라운지와 아모라가 연다.
 */
const links = [
  { key: "lounge", href: "/lounge", label: "라운지", icon: LayoutDashboard },
  { key: "amora", href: "/chat", label: "아모라", icon: AmoraMark },
] as const;

export type AmoraBottomNavTab = (typeof links)[number]["key"];

export default function AmoraBottomNav({ active = "amora" }: { active?: AmoraBottomNavTab | null }) {
  return (
    <nav aria-label="모바일 주요 기능" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 border-t border-[var(--amora-line)] bg-white px-2 pb-[env(safe-area-inset-bottom)] md:hidden">
      {links.map(({ key, href, label, icon: Icon }) => (
        <Link key={href} {...weddingLinkProps(href)} aria-current={key === active ? "location" : undefined}
          className={`flex min-h-[74px] flex-col items-center justify-center gap-[6px] rounded-md text-[10.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--amora-accent)] ${key === active ? "font-semibold text-[var(--amora-selected-text)]" : "text-[var(--amora-muted)]"}`}>
          <Icon aria-hidden className="size-[19px]" strokeWidth={1.7} />{label}
        </Link>
      ))}
    </nav>
  );
}
