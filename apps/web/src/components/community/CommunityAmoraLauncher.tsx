"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ArrowRight, LogIn, Sparkles, X } from "lucide-react";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import { useAuthStore } from "@/stores/authStore";
import { isPreviewStubMode } from "@/lib/previewStub";
import { stripWeddingBasePath } from "@/lib/weddingPaths";

const ChatSidePanel = dynamic(() => import("@/components/app/chat/ChatSidePanel"), {
  ssr: false,
});

export default function CommunityAmoraLauncher() {
  const pathname = usePathname();
  const { initialize } = useAuthStore();
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [loginPromptOpen, setLoginPromptOpen] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(false);
  const communityPath = stripWeddingBasePath(pathname);
  const isLauncherSuppressedRoute =
    communityPath === "/start-here" ||
    communityPath === "/community/post/write" ||
    communityPath === "/community/quote-check";
  const loginPromptRef = useAccessibleModal({
    open: loginPromptOpen && !isLauncherSuppressedRoute,
    onClose: () => setLoginPromptOpen(false),
  });

  useEffect(() => {
    if (!isLauncherSuppressedRoute) return;
    setChatPanelOpen(false);
    setLoginPromptOpen(false);
  }, [isLauncherSuppressedRoute]);

  async function handleOpenAmora() {
    if (checkingAuth) return;

    if (isPreviewStubMode()) {
      setLoginPromptOpen(true);
      return;
    }

    setCheckingAuth(true);
    try {
      if (document.cookie.includes("demo_mode=true")) {
        await initialize({ force: true });
        setChatPanelOpen(true);
        return;
      }

      const res = await fetch("/api/auth/me?guest_probe=1", {
        cache: "no-store",
        credentials: "include",
      });

      if (!res.ok) {
        setLoginPromptOpen(true);
        return;
      }

      const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
      if (!data?.user) {
        setLoginPromptOpen(true);
        return;
      }

      await initialize({ force: true });
      setChatPanelOpen(true);
    } finally {
      setCheckingAuth(false);
    }
  }

  if (isLauncherSuppressedRoute) return null;

  return (
    <>
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {!chatPanelOpen && (
        <button
          type="button"
          onClick={handleOpenAmora}
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--hb-hairline)] bg-[var(--hb-ivory)] text-[var(--hb-text-strong)] shadow-[var(--shadow-raised)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--hb-surface-hover)] disabled:cursor-wait disabled:opacity-70 md:bottom-6 md:right-6 md:h-14 md:w-14"
          title="아모라 AI 상담"
          aria-label="아모라 AI 상담"
          // 투어 타겟(landing-amora)은 2026-07-29에 랜딩의 아모라 블록으로 옮겼다.
          // 같은 이름이 두 곳에 있으면 스포트라이트가 어느 쪽을 잡을지 DOM 순서에
          // 달리게 되고, 첫 방문자에게는 작은 버튼보다 무엇을 해주는지 적힌 블록을
          // 비추는 편이 맞다.
          disabled={checkingAuth}
        >
          <Sparkles className={`h-5 w-5 md:h-6 md:w-6 ${checkingAuth ? "animate-pulse" : ""}`} />
        </button>
      )}

      {loginPromptOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#071629]/35 px-4 backdrop-blur-sm">
          <div
            ref={loginPromptRef}
            className="w-full max-w-[420px] rounded-[22px] border border-[var(--hb-hairline)] bg-[var(--hb-ivory)] p-5 shadow-[var(--shadow-overlay)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-amora-login-title"
            aria-describedby="community-amora-login-description"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef4ef] text-[var(--hb-text-strong)]">
                  <Sparkles className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[12px] font-semibold text-[var(--hb-primary)]">아모라 상담</p>
                  <h2 id="community-amora-login-title" className="font-serif-kr text-[24px] font-medium leading-tight text-[var(--hb-text-strong)]">
                    로그인 후 이용할 수 있어요.
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLoginPromptOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--hb-text-body)] transition-colors hover:bg-white text-[var(--hb-text-strong)]"
                aria-label="닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p id="community-amora-login-description" className="mt-4 text-[14px] font-medium leading-[1.75] text-[var(--hb-text-body)]">
              커뮤니티 글은 누구나 볼 수 있지만, 아모라 상담은 내 결혼식 날짜와 준비 정보를 바탕으로 답해야 해서 로그인이 필요해요.
            </p>

            <div className="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]">
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 py-3 text-[14px] font-semibold text-white shadow-[var(--shadow-raised)] transition-colors hover:bg-[#2f4944]"
              >
                <LogIn className="h-4 w-4" />
                로그인하기
                <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => setLoginPromptOpen(false)}
                className="inline-flex items-center justify-center rounded-[6px] border border-[var(--hb-hairline)] bg-white px-5 py-3 text-[14px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[var(--hb-surface-hover)]"
              >
                계속 둘러보기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
