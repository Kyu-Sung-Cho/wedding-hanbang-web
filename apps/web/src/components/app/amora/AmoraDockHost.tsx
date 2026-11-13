"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import {
  buildAmoraFirstHello,
  FIRST_RUN_TUTORIAL_COMPLETED_EVENT,
  readPreparationStage,
  type AmoraFirstHello,
  type AmoraFirstHelloInput,
} from "@hanbang/shared";
import AmoraMark from "@/components/ui/AmoraMark";
import Button from "@/components/ui/Button";
import { AMORA_FAB_CLASS } from "@/components/ui/amoraActionStyles";
import ChatSidePanel from "@/components/app/chat/ChatSidePanel";
import {
  consumePendingAmoraFirstHello,
  dismissAmoraFirstHelloBubble,
  peekPendingAmoraFirstHello,
  rememberPendingAmoraFirstHello,
} from "@/lib/amora/pendingFirstHello";
import { useAuthStore } from "@/stores/authStore";
import AmoraDockResizer from "./AmoraDockResizer";
import {
  AMORA_DOCK_MEDIA_QUERY,
  AmoraDockContext,
  isWideAmoraDockRatio,
  nextAmoraDockToggleRatio,
  normalizeAmoraPrefill,
  readAmoraDockRatio,
  writeAmoraDockRatio,
  type AmoraDockApi,
  type AmoraOpenOptions,
  type AmoraPanelDraft,
} from "./amoraDock";

const AMORA_DOCK_PANE_ID = "amora-dock-pane";

function subscribeDock(onChange: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(AMORA_DOCK_MEDIA_QUERY) : null;
  if (!query || typeof query.addEventListener !== "function") return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// 화면 폭을 모르는 환경(jsdom 등)은 좁은 화면으로 본다. 모르면 예전처럼 덮개로 연다.
function readDock() {
  return typeof window.matchMedia === "function" ? window.matchMedia(AMORA_DOCK_MEDIA_QUERY).matches : false;
}

function AmoraDockWidthToggle({ ratio, onChange }: { ratio: number; onChange: (ratio: number) => void }) {
  const wide = isWideAmoraDockRatio(ratio);
  const Icon = wide ? ChevronsRight : ChevronsLeft;
  const label = wide ? "아모라 창 좁게 보기" : "아모라 창 넓게 보기";
  return (
    <Button
      variant="icon"
      label={label}
      title={label}
      onClick={() => onChange(nextAmoraDockToggleRatio(ratio))}
      // 머리줄의 다른 단추(대화 정리·전체 화면)와 같은 모서리로 맞춘다.
      className="!rounded-[6px]"
    >
      <Icon className="h-4 w-4 text-[var(--hb-text-body)]" aria-hidden="true" />
    </Button>
  );
}

interface AmoraDockHostProps {
  /** 지금 화면의 본문(상단 바·본문). 큰 화면에서 아모라를 열면 이 칸이 왼쪽으로 밀린다. */
  children: ReactNode;
  /**
   * 오른쪽 아래 둥근 버튼과 첫마디 말풍선을 그릴까.
   *
   * 라운지·준비 화면은 본문에 아모라로 가는 길(본문 질문, 하단 탐색, 상단 바의 아모라 버튼)이 있고,
   * 고정 버튼이 목록을 덮으므로 끈다. 라운지의 첫마디는 라운지 본문(`LoungeFirstHello`)이 맡는다.
   */
  launcher: boolean;
  /** 모바일 하단 탐색이 있는 화면이면 둥근 버튼을 그 위로 올린다. */
  aboveBottomNav?: boolean;
}

/**
 * 아모라를 지금 화면 옆(큰 화면) 또는 위(작은 화면)에 여는 자리.
 *
 * 열림 상태는 이 컴포넌트가 들고 있고, `useAmoraDock()` 으로 상단 바·라운지가 연다. 이 자리는 앱 틀
 * 안에서 화면을 옮겨도 그대로 남아서, 라운지에서 아모라를 연 채로 예산 화면에 가도 아모라가 옆에 있다.
 *
 * ## 첫마디
 *
 * 첫 실행 안내가 끝나면 아모라가 **먼저** 말을 건다. 그 말은 모델이 쓰지 않고
 * `buildAmoraFirstHello`가 온보딩 입력만으로 결정적으로 만든다. 확인 안 된 사실을
 * 말하지 않고, 네트워크·토큰에 묶이지 않고, 두 사람이 같은 말을 받기 위해서다.
 * 이후의 진짜 대화는 평소대로 모델이 한다.
 *
 * 말풍선은 버튼을 누르거나 닫으면 사라지고 다시 뜨지 않는다.
 *
 * 첫마디를 `useState`에만 담아두면 새로고침 한 번에 사라진다. 그런데 안내를 끝냈다는
 * 사실은 이미 계정에 적혀 안내가 다시 뜨지 않으므로, 그 사람은 그 계정으로 첫마디를
 * **영영** 못 만난다. 그래서 만든 즉시 짧은 보관(`lib/amora/pendingFirstHello`)에 넣고,
 * 대화 화면이 가져가면 지운다. 앱도 같은 이유로 같은 모양의 보관을 쓴다.
 */
export default function AmoraDockHost({ children, launcher, aboveBottomNav = false }: AmoraDockHostProps) {
  const docked = useSyncExternalStore(subscribeDock, readDock, () => false);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const [draft, setDraft] = useState<AmoraPanelDraft | null>(null);
  const draftSequenceRef = useRef(0);
  // 렌더에 쓰이는 것은 열렸을 때뿐이고 서버는 늘 닫힌 채로 그리므로, 저장소를 처음에 읽어도
  // 서버 HTML 과 어긋나지 않는다.
  const [ratio, setRatio] = useState(() => readAmoraDockRatio());
  const rowRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [firstHello, setFirstHello] = useState<AmoraFirstHello | null>(null);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const { profile, journey, partner } = useAuthStore();
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelWasOpen = useRef(false);

  useEffect(() => {
    // 패널을 여는 동안 사라졌던 버튼은 닫을 때 새로 생기므로 새 요소에 초점을 돌린다.
    // 큰 화면에서는 이 버튼을 그리지 않으므로(md:hidden) 초점은 패널이 돌려준 자리에 남는다.
    if (panelWasOpen.current && !chatPanelOpen) launcherRef.current?.focus();
    panelWasOpen.current = chatPanelOpen;
  }, [chatPanelOpen]);

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
  // 주인(로그인한 사람)도 그 시점엔 아직 없을 수 있다. 렌더 중에 읽을 수도 없다.
  // 이 읽기는 다른 사람의 인사를 지우는 부수효과를 겸한다.
  useEffect(() => {
    if (!ownerId || !launcher) return;
    const pending = peekPendingAmoraFirstHello({ ownerId });
    if (!pending) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 주인이 정해진 뒤 1회 복원(위 근거)
    setFirstHello((previous) => previous ?? { preview: pending.preview, body: pending.body });
    // 말풍선을 이미 닫은 사람에게 다시 띄우지 않는다. 인사 자체는 대화 화면에 남는다.
    if (!pending.bubbleDismissed) setBubbleVisible(true);
  }, [launcher, ownerId]);

  useEffect(() => {
    helloInputRef.current = {
      weddingDate: journey?.wedding_date ?? null,
      preparationStage: readPreparationStage(journey?.progress),
      partnerLinked: Boolean(partner),
    };
  }, [journey?.progress, journey?.wedding_date, partner]);

  useEffect(() => {
    // 라운지에서는 라운지 본문(`LoungeFirstHello`)이 같은 이벤트로 인사를 만든다. 둘이 같이 들으면
    // 인사가 두 군데에 뜬다.
    if (!launcher) return;
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

    window.addEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, handleTutorialCompleted);
    return () => window.removeEventListener(FIRST_RUN_TUTORIAL_COMPLETED_EVENT, handleTutorialCompleted);
  }, [launcher]);

  // 이 자리에서 첫마디를 이미 건넸는가. 패널을 닫는 것은 "봤다"는 뜻이라, 다시 열었을
  // 때 같은 인사가 또 놓여 있으면 먼저 말을 건 것이 아니라 두 번 말한 것이 된다.
  // 보관을 가져가는 함수는 같은 페이지 로드에서 건넨 인사를 다시 돌려주므로, 저장소가 비었다는
  // 것만으로는 막히지 않는다.
  //
  // 실제로 건넨 때만 표시한다. 이 자리는 라운지와 다른 화면을 오가도 그대로 남는데, 인사가 생기기
  // 전에 한 번 열어 본 사람이 나중에 생긴 첫마디를 영영 못 받으면 안 된다.
  const helloDeliveredRef = useRef(false);

  const openPanel = useCallback((options?: AmoraOpenOptions) => {
    setBubbleVisible(false);
    if (!helloDeliveredRef.current) {
      // 대화 화면이 첫마디를 가져간다. 보관에서 지워 두 번 건네지지 않게 한다.
      const delivered = consumePendingAmoraFirstHello({ ownerId: ownerIdRef.current });
      if (delivered) {
        helloDeliveredRef.current = true;
        setFirstHello((previous) => previous ?? delivered);
      }
    }
    const prefill = normalizeAmoraPrefill(options?.prefill);
    if (prefill) {
      draftSequenceRef.current += 1;
      setDraft({ id: draftSequenceRef.current, text: prefill });
    }
    setChatPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setChatPanelOpen(false);
    // 첫마디는 한 번만 건넨다. 이 값은 대화 기록(chat_messages)에 저장되지 않는
    // 화면 전용 메시지라, 남겨두면 패널을 열 때마다 아모라가 같은 인사를 다시
    // 하는 것처럼 보인다. 앱은 이미 한 번만 보여주고 지운다. 두 플랫폼이 같아야 한다.
    setFirstHello(null);
  }, []);

  const commitRatio = useCallback((next: number) => {
    setRatio(next);
    writeAmoraDockRatio(next);
  }, []);

  const api = useMemo<AmoraDockApi>(() => ({
    isOpen: chatPanelOpen,
    docked,
    open: openPanel,
    close: closePanel,
    toggle: () => (chatPanelOpen ? closePanel() : openPanel()),
  }), [chatPanelOpen, closePanel, docked, openPanel]);

  const dockedOpen = docked && chatPanelOpen;
  const showBubble = launcher && bubbleVisible && firstHello !== null && !chatPanelOpen;

  return (
    <AmoraDockContext.Provider value={api}>
      <div
        ref={rowRef}
        data-amora-dock={dockedOpen ? "open" : docked ? "closed" : "overlay"}
        className={docked ? "flex items-start" : undefined}
      >
        <div className={docked ? "min-w-0 flex-1" : undefined}>{children}</div>
        {dockedOpen && (
          <AmoraDockResizer
            ratio={ratio}
            rowRef={rowRef}
            paneRef={paneRef}
            paneId={AMORA_DOCK_PANE_ID}
            onCommit={commitRatio}
          />
        )}
        {/* 같은 자리에 늘 같은 패널을 둔다. 화면 폭이 바뀌어 옆자리와 덮개를 오가도 쓰던 글이 남는다. */}
        <div
          ref={paneRef}
          id={AMORA_DOCK_PANE_ID}
          className={
            dockedOpen
              ? "sticky top-0 h-[100dvh] min-w-[340px] shrink-0 border-l border-[var(--amora-line)] bg-[var(--hb-surface-page)]"
              : docked ? "hidden" : "contents"
          }
          style={dockedOpen ? { width: `${ratio * 100}%` } : undefined}
        >
          <ChatSidePanel
            isOpen={chatPanelOpen}
            onClose={closePanel}
            firstHello={firstHello?.body ?? null}
            presentation={docked ? "docked" : "overlay"}
            draft={draft}
            headerActions={dockedOpen ? <AmoraDockWidthToggle ratio={ratio} onChange={commitRatio} /> : null}
          />
        </div>
      </div>

      {launcher && !chatPanelOpen && (
        <>
          {showBubble && (
            <div
              data-testid="amora-first-hello-bubble"
              className={`fixed ${aboveBottomNav ? "bottom-[calc(146px+env(safe-area-inset-bottom))]" : "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]"} right-[calc(1rem+env(safe-area-inset-right))] z-30 flex max-w-[17rem] items-start gap-2 rounded-[6px] border border-[var(--hb-hairline)] bg-white p-3 shadow-[var(--shadow-raised)] md:bottom-6 md:right-6`}
            >
              <button
                type="button"
                onClick={() => openPanel()}
                className="min-w-0 flex-1 text-left text-[13px] font-medium leading-[1.6] text-[var(--hb-text-strong)]"
              >
                {firstHello?.preview}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBubbleVisible(false);
                  // 말풍선은 알림이고 첫마디는 인사다. 닫기는 알림만 끈다.
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

          {/* 큰 화면에서는 상단 바의 아모라 버튼이 같은 일을 한다. 버튼 두 개를 두지 않는다. */}
          <button
            type="button"
            ref={launcherRef}
            onClick={() => openPanel()}
            data-tutorial-target="amora-fab"
            className={`${AMORA_FAB_CLASS} fixed ${aboveBottomNav ? "bottom-[calc(90px+env(safe-area-inset-bottom))]" : "bottom-[calc(1rem+env(safe-area-inset-bottom))]"} right-[calc(1rem+env(safe-area-inset-right))] z-30 h-12 w-12 md:hidden`}
            title="아모라 AI 상담"
            aria-label="아모라 AI 상담"
          >
            <AmoraMark className="h-5 w-5" />
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
    </AmoraDockContext.Provider>
  );
}
