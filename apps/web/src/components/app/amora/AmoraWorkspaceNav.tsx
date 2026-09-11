"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock, MessagesSquare, PanelsTopLeft } from "lucide-react";
import { stripWeddingBasePath, weddingLinkProps } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

export interface AmoraChatNavigationControls {
  activeScope: "shared" | "private";
  onScopeChange: (scope: "shared" | "private") => void;
  disabled: boolean;
  privateDisabled: boolean;
  sharedCount?: number;
  privateCount?: number;
  privateHint?: string;
}

const scopeItems = [
  { key: "shared", href: "/chat?scope=shared", label: "함께 대화", icon: MessagesSquare },
  { key: "private", href: "/chat?scope=private", label: "나만 (상담)", icon: Lock },
] as const;

function itemClass(active: boolean) {
  return `inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--amora-accent)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${active ? "bg-[var(--amora-selected-bg)] text-[var(--amora-selected-text)] ring-1 ring-inset ring-[var(--amora-selected-line)]" : "text-[var(--amora-soft)] hover:bg-[var(--amora-low)] hover:text-[var(--amora-ink)]"}`;
}

function Navigation({ controls, boardActive = false, privateUnavailable = false }: {
  controls?: AmoraChatNavigationControls;
  boardActive?: boolean;
  privateUnavailable?: boolean;
}) {
  return (
    <nav aria-label="아모라 화면" className="grid w-full grid-cols-3 gap-1 rounded-[11px] border border-[var(--amora-line)] bg-white p-1 xl:w-auto">
      <div role="group" aria-label="대화 공개 범위" className="contents">
        {scopeItems.map(({ key, href, label, icon: Icon }) => {
          const active = controls?.activeScope === key;
          const blocked = Boolean(controls?.disabled || (key === "private" && (controls?.privateDisabled || privateUnavailable)));
          const content = <><Icon aria-hidden className="hidden size-4 shrink-0 sm:block" />{label}</>;
          return controls ? (
            <button key={key} type="button" aria-pressed={active} disabled={blocked}
              title={key === "private" ? controls.privateHint : undefined}
              onClick={() => controls.onScopeChange(key)} className={itemClass(active)}>{content}</button>
          ) : blocked ? (
            <span key={key} aria-disabled="true" title="계정 이용 시 나만 상담을 사용할 수 있어요"
              className={`${itemClass(false)} cursor-not-allowed opacity-50`}>{content}</span>
          ) : <Link key={key} {...weddingLinkProps(href)} className={itemClass(false)}>{content}</Link>;
        })}
      </div>
      {controls?.disabled ? (
        <span aria-disabled="true" className={`${itemClass(false)} cursor-not-allowed opacity-50`}>결정 보드</span>
      ) : (
        <Link {...weddingLinkProps("/chat/board")} aria-current={boardActive ? "page" : undefined} className={itemClass(boardActive)}>
          <PanelsTopLeft aria-hidden className="hidden size-4 shrink-0 sm:block" />결정 보드
        </Link>
      )}
    </nav>
  );
}

function PageNavigation() {
  const pathname = stripWeddingBasePath(usePathname());
  const isDemo = useAuthStore((state) => state.isDemo);
  return <Navigation boardActive={pathname === "/chat/board"} privateUnavailable={isDemo} />;
}

/** 대화 안에서는 실제 범위와 전송 잠금을 사용하고, 다른 화면에서는 명시적인 진입 링크를 사용한다. */
export default function AmoraWorkspaceNav({ chatControls }: { chatControls?: AmoraChatNavigationControls }) {
  return chatControls ? <Navigation controls={chatControls} /> : <PageNavigation />;
}
