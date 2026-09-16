"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ArrowRight, LogIn, X } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import AmoraAvatar from "@/components/ui/AmoraAvatar";
import { AMORA_FAB_CLASS } from "@/components/ui/amoraActionStyles";
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
  const [authError, setAuthError] = useState<string | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const overlayWasOpen = useRef(false);
  const authRequestGeneration = useRef(0);
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
    const overlayOpen = chatPanelOpen || loginPromptOpen;
    // 인증 조회 중 disabled로 잃은 초점과 패널 뒤 다시 생긴 버튼을 모두 복구한다.
    if (overlayWasOpen.current && !overlayOpen) launcherRef.current?.focus();
    overlayWasOpen.current = overlayOpen;
  }, [chatPanelOpen, loginPromptOpen]);

  useEffect(() => {
    if (!isLauncherSuppressedRoute) return;
    authRequestGeneration.current += 1;
    setCheckingAuth(false);
    setAuthError(null);
    setChatPanelOpen(false);
    setLoginPromptOpen(false);
  }, [isLauncherSuppressedRoute]);

  useEffect(() => () => { authRequestGeneration.current += 1; }, []);

  async function handleOpenAmora() {
    if (checkingAuth) return;
    setAuthError(null);

    if (isPreviewStubMode()) {
      setLoginPromptOpen(true);
      return;
    }

    setCheckingAuth(true);
    const requestGeneration = ++authRequestGeneration.current;
    const isCurrentRequest = () => requestGeneration === authRequestGeneration.current;
    try {
      if (document.cookie.includes("demo_mode=true")) {
        await initialize({ force: true });
        if (!isCurrentRequest()) return;
        setChatPanelOpen(true);
        return;
      }

      const res = await fetch("/api/auth/me?guest_probe=1", {
        cache: "no-store",
        credentials: "include",
      });
      if (!isCurrentRequest()) return;

      if (!res.ok) {
        if (res.status === 401) {
          setLoginPromptOpen(true);
          return;
        }
        throw new Error("auth_check_failed");
      }

      const data = (await res.json().catch(() => null)) as { user?: unknown } | null;
      if (!isCurrentRequest()) return;
      if (!data?.user) {
        setLoginPromptOpen(true);
        return;
      }

      await initialize({ force: true });
      if (!isCurrentRequest()) return;
      setChatPanelOpen(true);
    } catch {
      if (isCurrentRequest()) setAuthError("연결을 확인하지 못했어요. 잠시 후 아모라 버튼을 다시 눌러 주세요.");
    } finally {
      if (isCurrentRequest()) setCheckingAuth(false);
    }
  }

  if (isLauncherSuppressedRoute) return null;

  return (
    <>
      <ChatSidePanel isOpen={chatPanelOpen} onClose={() => setChatPanelOpen(false)} />

      {authError && !chatPanelOpen && (
        <p
          id="community-amora-auth-error"
          role="alert"
          className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 max-w-[calc(100vw-2rem)] rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-ivory)] p-3 text-sm leading-relaxed text-[var(--hb-text-strong)] shadow-[var(--shadow-raised)] md:bottom-24 md:right-6 md:max-w-xs"
        >
          {authError}
        </p>
      )}

      {!chatPanelOpen && (
        <button
          ref={launcherRef}
          type="button"
          onClick={handleOpenAmora}
          className={`${AMORA_FAB_CLASS} fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-40 h-12 w-12 disabled:cursor-wait disabled:opacity-70 md:bottom-6 md:right-6 md:h-14 md:w-14`}
          title="아모라 AI 상담"
          aria-label="아모라 AI 상담"
          aria-describedby={authError ? "community-amora-auth-error" : undefined}
          // 투어 타겟(landing-amora)은 2026-07-29에 랜딩의 아모라 블록으로 옮겼다.
          // 같은 이름이 두 곳에 있으면 스포트라이트가 어느 쪽을 잡을지 DOM 순서에
          // 달리게 되고, 첫 방문자에게는 작은 버튼보다 무엇을 해주는지 적힌 블록을
          // 비추는 편이 맞다.
          disabled={checkingAuth}
        >
          <AmoraMark className={`h-5 w-5 md:h-6 md:w-6 ${checkingAuth ? "animate-pulse" : ""}`} />
        </button>
      )}

      {loginPromptOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#071629]/35 px-4 backdrop-blur-sm">
          <div
            ref={loginPromptRef}
            className="w-full max-w-[420px] rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-ivory)] p-5 shadow-[var(--shadow-overlay)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="community-amora-login-title"
            aria-describedby="community-amora-login-description"
            tabIndex={-1}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <AmoraAvatar sizeClassName="size-11" />
                <div>
                  <p className="text-[12px] font-semibold text-[var(--hb-text-strong)]">아모라 상담</p>
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
