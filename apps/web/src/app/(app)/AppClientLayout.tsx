"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  readPreparationStage,
  type AmoraFirstHello,
  type AmoraFirstHelloInput,
} from "@hanbang/shared";
import AiNoticeFooter from "@/components/common/AiNoticeFooter";
import {
  consumePendingAmoraFirstHello,
  dismissAmoraFirstHelloBubble,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
} from "@/lib/amora/pendingFirstHello";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import Sidebar from "@/components/app/Sidebar";
import TopNav from "@/components/app/TopNav";
import { useAuthSessionSync } from "@/hooks/useAuthSessionSync";
import { stripWeddingBasePath } from "@/lib/weddingPaths";
import { isAnalyticsSuppressedLocation } from "@/lib/analyticsPrivacy";
import { useAuthStore } from "@/stores/authStore";

/**
 * 아모라 버튼과 그 옆 말풍선.
 *
 * ## 왜 첫마디를 여기서 만드는가
 *
 * 첫 실행 안내가 끝나면 아모라가 **먼저** 말을 건다. 그 말은 모델이 쓰지 않고
 * `buildAmoraFirstHello`가 온보딩 입력만으로 결정적으로 만든다 — 확인 안 된 사실을
 * 말하지 않고, 네트워크·토큰에 묶이지 않고, 두 사람이 같은 말을 받기 위해서다.
 * 이후의 진짜 대화는 평소대로 모델이 한다.
 *
 * 말풍선은 버튼을 누르거나 닫으면 사라지고 다시 뜨지 않는다.
 *
 * ## 왜 화면 상태만으로는 부족한가
 *
 * 첫마디를 `useState`에만 담아두면 새로고침 한 번에 사라진다. 그런데 안내를 끝냈다는
 * 사실은 이미 계정에 적혀 안내가 다시 뜨지 않으므로, 그 사람은 그 계정으로 첫마디를
 * **영영** 못 만난다. 그래서 만든 즉시 짧은 보관(`lib/amora/pendingFirstHello`)에 넣고,
 * 대화 화면이 가져가면 지운다. 앱도 같은 이유로 같은 모양의 보관을 쓴다.
 */
function GlobalChatAssistant() {
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [firstHello, setFirstHello] = useState<AmoraFirstHello | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const { profile, journey, partner } = useAuthStore();

  // 이벤트 핸들러는 한 번만 등록하고 값은 여기서 최신으로 읽는다. 온보딩 값이
  // 늦게 도착해도 첫마디가 옛 값으로 굳지 않게 하려고.
  const helloInputRef = useRef<Omit<AmoraFirstHelloInput, "now">>({});
  // 보관의 주인. 한 번만 등록하는 이벤트 핸들러가 최신 값을 읽어야 한다.
  const ownerIdRef = useRef<string | null>(null);
  const ownerId = profile?.id ?? null;
  useEffect(() => {
    ownerIdRef.current = ownerId;
  }, [ownerId]);

  // 새로고침으로 돌아온 사람에게도 첫마디는 그대로 있어야 한다.
  //
  // 초기 상태로 넣을 수 없다: 저장소는 서버에 없어 첫 렌더에 쓰면 서버 HTML과 어긋나고,
  // 주인(로그인한 사람)도 그 시점엔 아직 없을 수 있다. 렌더 중에 읽을 수도 없다 —
  // 이 읽기는 다른 사람의 인사를 지우는 부수효과를 겸한다.
  useEffect(() => {
    if (!ownerId) return;
    const pending = peekPendingAmoraFirstHello({ ownerId });
    if (!pending) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 주인이 정해진 뒤 1회 복원(위 근거)
    setFirstHello((previous) => previous ?? { preview: pending.preview, body: pending.body });
    // 말풍선을 이미 닫은 사람에게 다시 띄우지 않는다. 인사 자체는 대화 화면에 남는다.
    if (!pending.bubbleDismissed) setBubbleVisible(true);
  }, [ownerId]);

  useEffect(() => {
    helloInputRef.current = {
      weddingDate: journey?.wedding_date ?? null,
      preparationStage: readPreparationStage(journey?.progress),
      partnerLinked: Boolean(partner),
    };
  }, [journey?.progress, journey?.wedding_date, partner]);

  useEffect(() => {
    const handleTutorialCompleted = () => {
      const hello = buildAmoraFirstHello({
        ...helloInputRef.current,
        now: Date.now(),
      });
      // 화면 상태보다 먼저 보관에 넣는다. 안내 직후 새로고침하거나 사이드바로
      // 전체 페이지 대화에 들어가도 같은 인사를 만나야 한다.
      rememberPendingAmoraFirstHello(hello, { ownerId: ownerIdRef.current });
      setFirstHello((previous) => previous ?? hello);
      setBubbleVisible(true);
    };

    window.addEventListener(
      FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
      handleTutorialCompleted,
    );
    return () =>
      window.removeEventListener(
        FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
        handleTutorialCompleted,
      );
  }, []);

  // 이 화면에서 첫마디를 이미 건넸는가. 패널을 닫는 것은 "봤다"는 뜻이라, 다시 열었을
  // 때 같은 인사가 또 놓여 있으면 먼저 말을 건 것이 아니라 두 번 말한 것이 된다.
  const helloDeliveredRef = useRef(false);

  const openPanel = () => {
    setBubbleVisible(false);
    if (!helloDeliveredRef.current) {
      helloDeliveredRef.current = true;
      // 대화 화면이 첫마디를 가져간다. 보관에서 지워 두 번 건네지지 않게 한다.
      const delivered = consumePendingAmoraFirstHello({ ownerId: ownerIdRef.current });
      if (delivered) setFirstHello((previous) => previous ?? delivered);
    }
    setChatPanelOpen(true);
  };

  const showBubble = bubbleVisible && firstHello !== null && !chatPanelOpen;

  return (
    <>
      <ChatSidePanel
        isOpen={chatPanelOpen}
        onClose={() => {
          setChatPanelOpen(false);
          // 첫마디는 한 번만 건넨다. 이 값은 대화 기록(chat_messages)에 저장되지 않는
          // 화면 전용 메시지라, 남겨두면 패널을 열 때마다 아모라가 같은 인사를 다시
          // 하는 것처럼 보인다. 앱은 이미 한 번만 보여주고 지운다 — 두 플랫폼이 같아야 한다.
          setFirstHello(null);
        }}
        firstHello={firstHello?.body ?? null}
      />

      {!chatPanelOpen && (
        <>
          {showBubble && (
            <div
              data-testid="amora-first-hello-bubble"
              className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-30 flex max-w-[17rem] items-start gap-2 rounded-2xl border border-[var(--hb-hairline)] bg-white p-3 shadow-[var(--shadow-raised)] md:bottom-[6.5rem] md:right-6"
            >
              <button
                type="button"
                onClick={openPanel}
                className="min-w-0 flex-1 text-left text-[13px] font-medium leading-[1.6] text-[var(--hb-text-strong)]"
              >
                {firstHello?.preview}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBubbleVisible(false);
                  // 말풍선은 알림이고 첫마디는 인사다. 닫기는 알림만 끈다 —
                  // 대화를 열면 첫마디는 그대로 놓여 있다.
                  dismissAmoraFirstHelloBubble({ ownerId: ownerIdRef.current });
                }}
                className="shrink-0 rounded-full px-1.5 text-[13px] font-semibold text-[var(--hb-text-body)] hover:text-[var(--hb-text-strong)]"
                aria-label="아모라 인사 닫기"
              >
                ×
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={openPanel}
            data-tutorial-target="amora-fab"
            className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--hb-primary)] text-white shadow-[var(--shadow-raised)] transition-transform hover:-translate-y-0.5 md:bottom-6 md:right-6 md:h-14 md:w-14"
            title="아모라 AI 상담"
            aria-label="아모라 AI 상담"
          >
            <Sparkles className="h-5 w-5 md:h-6 md:w-6" />
            {/* 읽지 않음 표시는 점만으로는 화면 낭독기에 들리지 않는다. */}
            {showBubble && <span className="sr-only">읽지 않은 인사 1개</span>}
            {showBubble && (
              <span
                data-testid="amora-first-hello-dot"
                className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-[#c0392b]"
                aria-hidden="true"
              />
            )}
          </button>
        </>
      )}
    </>
  );
}

export default function AppClientLayout({
  children,
  banner = null,
  initialDemo = false,
}: {
  children: React.ReactNode;
  // 체험 고지처럼 본문 흐름 밖에서 항상 보여야 하는 서버 렌더 알림.
  // children으로 넣으면 채팅의 100dvh 고정 레이아웃 안으로 들어가 화면을 누른다.
  banner?: React.ReactNode;
  // 서버가 demo_session HMAC까지 검증한 결과다. 클라이언트 쿠키만 신뢰하지 않는다.
  initialDemo?: boolean;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const appPathname = stripWeddingBasePath(pathname);
  const isChatPage = appPathname === "/chat";
  const { initialize, isInitialized, isLoading, isDemo } = useAuthStore();

  const analyticsSuppressed = isAnalyticsSuppressedLocation(pathname, searchParams);
  const vendorAdminPreview = (
    pathname === "/wedding/vendors" || pathname.startsWith("/wedding/vendors/")
  ) && searchParams.get("preview") === "1";

  // 첫 hydration에서는 Zustand가 아직 isDemo=false다. 서버가 검증한 데모라면
  // 이 순간에도 Supabase 세션 구독을 만들지 않아야 INITIAL_SESSION 이벤트가
  // 데모 상태를 지우고 원격 Auth 대기로 되돌리는 경쟁 조건이 생기지 않는다.
  useAuthSessionSync(!initialDemo && !isDemo);

  useEffect(() => {
    if (!isInitialized) void initialize({ initialDemo });
  }, [initialize, initialDemo, isInitialized]);

  if (!isInitialized || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-[var(--hb-primary)] border-t-transparent" />
          <p className="text-[13px] font-medium text-[var(--hb-text-muted)]">웨딩 라운지를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${analyticsSuppressed ? "ph-no-capture " : ""}${
        isChatPage
          // iOS 사파리는 100vh가 주소창 높이를 포함해 입력창이 화면 밖으로 밀린다 → dvh
          ? "hanbang-service-theme h-[100dvh] overflow-hidden bg-[var(--hb-surface-page)]"
          : "hanbang-service-theme min-h-screen bg-[var(--hb-surface-page)]"
      }`}
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className={isChatPage ? "flex h-[100dvh] flex-col md:ml-[16rem]" : "md:ml-[16rem]"}>
        <TopNav onMenuToggle={() => setSidebarOpen(true)} />
        {banner}
        {isChatPage ? (
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
        ) : (
          <>
            <main className="p-6 max-md:p-4">
              <div className="mx-auto max-w-[1120px]">{children}</div>
            </main>
            <div className="px-6 pb-10 max-md:px-4">
              <div className="mx-auto max-w-[1120px]">
                <AiNoticeFooter variant="light" />
              </div>
            </div>
          </>
        )}
      </div>

      {!isChatPage && !vendorAdminPreview && (
        <GlobalChatAssistant />
      )}
    </div>
  );
}
