"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import {
  User,
  Users,
  Activity,
  ShieldAlert,
  Settings,
  LogOut,
  Ban,
} from "lucide-react";
import CommunityReplyNotifications from "@/components/community/CommunityReplyNotifications";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

interface MenuItem {
  linkProps?: ReturnType<typeof weddingLinkProps>;
  onClick?: () => void;
  label: string;
  sub: string;
  Icon: React.ComponentType<{ className?: string }>;
}

/**
 * 로그인된 사용자용 드롭다운 메뉴.
 * 현재 MVP의 커뮤니티 활동, 동기방, 설정, 로그아웃을 한 곳에서 제공한다.
 * - 외부 클릭 / Esc 키로 닫힘
 * - 모바일에서도 동일 데스크탑 UI (모바일 메뉴는 별도 처리)
 */
export default function UserMenu() {
  const router = useRouter();
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const resetAuthState = useAuthStore((state) => state.reset);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(async () => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { error } = await supabase.auth.signOut();
    if (error) return;
    resetAuthState();
    router.push(weddingPath());
    router.refresh();
  }, [resetAuthState, router]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const items: MenuItem[] = [
    { linkProps: weddingLinkProps("/community/my"), label: "내 활동", sub: "내가 쓴 글·답변·투표", Icon: Activity },
    { linkProps: weddingLinkProps("/community/cohort"), label: "동기방", sub: "같은 시기 예비부부", Icon: Users },
    { linkProps: weddingLinkProps("/community/moderation"), label: "운영 알림", sub: "조치 사유·이의제기", Icon: ShieldAlert },
    { linkProps: weddingLinkProps("/community/my/blocks"), label: "차단 관리", sub: "숨긴 회원 확인·해제", Icon: Ban },
    { linkProps: weddingLinkProps("/settings"), label: "설정", sub: "프로필·알림·계정", Icon: Settings },
    { onClick: handleLogout, label: "로그아웃", sub: "", Icon: LogOut },
  ];

  return (
    <div className="flex items-center gap-1">
      {ownerId ? <CommunityReplyNotifications ownerId={ownerId} /> : null}
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="내 메뉴"
          aria-expanded={open}
          className="h-11 w-11 rounded-full flex items-center justify-center text-[var(--hb-text-muted)] hover:bg-[#FAFAF8] hover:text-[var(--hb-text-strong)] transition-all"
        >
          <User className="w-5 h-5" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-2 w-64 bg-white border border-[#F0EFED] rounded-[6px] shadow-[var(--shadow-raised)] overflow-hidden z-50 animate-fade-in"
          >
            <div className="py-1.5">
              {items.map((item) => {
                const Icon = item.Icon;
                const inner = (
                  <div className="flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#FAFAF8] transition-colors">
                    <Icon className="w-4 h-4 text-[var(--hb-text-strong)] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-[var(--hb-text-strong)] leading-tight">
                        {item.label}
                      </div>
                      {item.sub && (
                        <div className="text-[11px] text-[var(--hb-text-muted)] mt-0.5 leading-tight">
                          {item.sub}
                        </div>
                      )}
                    </div>
                  </div>
                );
                if (item.linkProps) {
                  return (
                    <Link
                      key={item.label}
                      {...item.linkProps}
                      onClick={() => setOpen(false)}
                      className="block"
                    >
                      {inner}
                    </Link>
                  );
                }
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      item.onClick?.();
                    }}
                    className="w-full block"
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
