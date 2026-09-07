"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

/** 화면 이동만 담당한다. 상담 범위 변경과 승인 여부는 채팅의 기존 경계가 판단한다. */
export default function AmoraWorkspaceNav() {
  const pathname = stripWeddingBasePath(usePathname());
  const isDemo = useAuthStore((state) => state.isDemo);
  const links = [
    { href: "/chat/missions", label: "오늘의 미션" },
    { href: "/chat", label: "함께 대화" },
    { href: "/chat?scope=private", label: "나만 상담" },
    { href: "/chat/board", label: "결정 보드" },
  ];
  return (
    <nav aria-label="아모라 화면" className="flex items-center gap-1 text-[13px]">
      {links.map((link) => (
        isDemo && link.href.includes("scope=private") ? <span key={link.href} aria-disabled="true" className="inline-flex min-h-11 items-center px-3 text-[var(--amora-muted)]" title="계정 이용 시 나만 상담을 사용할 수 있어요">나만 상담</span> : <Link key={link.href} {...weddingLinkProps(link.href)}
          aria-current={pathname === link.href ? "page" : undefined}
          className={`inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-t-[9px] border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)] ${pathname === link.href ? "border-[var(--amora-line)] bg-[var(--amora-bg)] text-[var(--amora-ink)]" : "border-transparent text-[var(--amora-muted)] hover:text-[var(--amora-ink)]"}`}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
