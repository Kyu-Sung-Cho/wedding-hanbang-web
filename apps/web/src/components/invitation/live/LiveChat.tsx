"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { FIRST_CHAT_COPY, JOURNEY_COPY } from "@hanbang/shared/invitation";

import ChatContent from "@/components/app/chat/ChatContent";
import AmoraOrb from "@/components/ui/AmoraOrb";
import { personalActionContinuation } from "@/lib/amora/personalActionContinuation";
import { AMORA_PREPARATION_SOURCE_PARAM } from "@/lib/amora/preparationHandoff";
import { AMORA_COMPOSER_EXPAND_PARAM } from "@/lib/chat/composerExpandHandoff";
import { START_HERE_HANDOFF_QUERY_PARAM, readDemoAmoraPrefill } from "@/lib/chat/demoHandoff";
import { WEDDING_TASTE_CHAT_PARAM } from "@/lib/weddingCode/tasteHandoff";
import { useChatStore } from "@/stores/chatStore";

import { InvitationBackLink } from "../InvitationParts";
import { ASK_CONDITIONS_LEAD } from "./LiveLounge";
import { LiveAmoraChat, LiveLoadingScreen } from "./LiveParts";
import LiveWebSpace from "./LiveWebSpace";
import { liveRoute } from "./liveRoutes";
import { useInvitationConditions } from "./useInvitationHome";
import { useLiveIdentity, useWideScreen } from "./useLiveIdentity";

/**
 * 전체 화면 대화(`ChatContent`)만 아는 인계. 주소로 레인을 정해 들어오거나(`scope`), 다른 화면에서 질문을
 * 들고 오거나(`prefill`·준비 안내·웨딩코드·가입 인계), 작은 대화창을 넓혀 쓰던 글을 옮겨 오는(`amoraExpand`) 길이다.
 * 청첩장 대화 칸(`ChatSidePanel`)은 이 인계를 읽지 않는다. 그래서 이 길로 들어온 방문은 그 인계를 끝까지
 * 처리하는 전체 화면 대화를 그대로 연다(레인·안전 판단·초안 처리를 바꾸지 않기 위해서).
 */
export const FULL_CHAT_HANDOFF_PARAMS = [
  "scope",
  "prefill",
  AMORA_PREPARATION_SOURCE_PARAM,
  WEDDING_TASTE_CHAT_PARAM,
  START_HERE_HANDOFF_QUERY_PARAM,
  AMORA_COMPOSER_EXPAND_PARAM,
] as const;

/** 주소에 전체 화면 대화의 인계가 있는가. 주소만 보므로 서버와 브라우저가 같은 답을 낸다. */
export function hasFullChatHandoffParam(params: Pick<URLSearchParams, "has">): boolean {
  return FULL_CHAT_HANDOFF_PARAMS.some((key) => params.has(key));
}

/**
 * 브라우저에만 있는 인계(개인 할 일 이어가기·체험 초안)가 기다리는가. 저장소를 읽으므로 화면이 붙은 뒤에만 부른다 —
 * 첫 그림에서 읽으면 서버 그림과 달라진다.
 */
export function hasStoredFullChatHandoff(): boolean {
  if (personalActionContinuation.hasPending()) return true;
  try {
    return readDemoAmoraPrefill(window.sessionStorage) !== null;
  } catch {
    return false;
  }
}

/**
 * 아모라와 대화(`/chat`) 실제 커플 화면(2026-11-17 파운더 디자인 아티팩트).
 *
 *   - 1024px 이상: 웹 두 칸 화면(`Web.dc`). 라운지와 같다.
 *   - 그 아래: 청첩장 모양의 대화 칸을 화면 전체로. 머리는 첫 대화(`Chat.dc`)의 오브 64 와 "듣고 있어요".
 *   - 다른 화면의 인계를 들고 온 방문은 그 인계를 처리하는 전체 화면 대화를 연다(위 설명). 한 번 그렇게 열면
 *     인계가 주소에서 지워진 뒤에도 이 방문 동안은 그대로 둔다(쓰던 초안이 사라지지 않게).
 *   - 인계 없이 전체 화면 대화로 가는 길은 대화 칸의 "전체 화면으로 보기"다(쓰던 글을 옮겨 간다).
 *
 * 저장소에 있는 인계는 화면이 붙은 뒤에 읽는다. 읽기 전에는 대화 칸을 달지 않는다 — 달았다가 바꾸면 대화 칸이
 * 첫 인사·보관한 첫마디를 먼저 가져가 버린다.
 */
export default function LiveChat() {
  const searchParams = useSearchParams();
  const wide = useWideScreen();
  const handoffParam = hasFullChatHandoffParam(searchParams);
  const [fullChat, setFullChat] = useState(handoffParam);
  // null: 아직 읽지 않았다(서버 그림·첫 그림). 붙은 뒤 한 번 읽는다.
  const [storedHandoff, setStoredHandoff] = useState<boolean | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 브라우저 저장소는 붙은 뒤에만 읽는다(첫 그림을 서버와 같게)
    setStoredHandoff(hasStoredFullChatHandoff());
  }, []);

  useEffect(() => {
    // 이미 연 대화 칸에 새 인계가 오면(같은 주소 안의 이동) 그때부터 전체 화면 대화로 넘긴다.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 주소가 바뀐 뒤 한 번만 옮긴다(되돌리지 않는다)
    if (handoffParam) setFullChat(true);
  }, [handoffParam]);

  if (fullChat || handoffParam || storedHandoff) return <FullChat />;
  if (storedHandoff === null) return <LiveLoadingScreen />;
  return wide ? <LiveChatWebSpace /> : <LiveChatScreen />;
}

/** 넓은 화면의 대화. 라운지와 같은 두 칸이고, 조건이 비어 있으면 "두 분이 정할 것" 맨 앞에 조건 묻기 줄을 둔다. */
function LiveChatWebSpace() {
  const identity = useLiveIdentity();
  const checkConditions = !identity.isDemo && identity.onboardingCompleted;
  const conditions = useInvitationConditions(identity, checkConditions);
  const missing = Boolean(checkConditions && conditions.data && conditions.data.missing.length > 0);
  return <LiveWebSpace leadDecision={missing ? ASK_CONDITIONS_LEAD : undefined} />;
}

/** 좁은 화면의 대화. 첫 대화 머리(뒤로·오브 64·듣고 있어요) 아래에 실제 대화 칸을 채운다. */
function LiveChatScreen() {
  const streaming = useChatStore((state) => state.isStreaming);
  return (
    <div
      className="relative mx-auto flex min-h-0 w-full max-w-[480px] flex-1 flex-col overflow-hidden bg-inv-white font-inv-sans leading-[normal] text-inv-ink"
      data-invitation-screen="live-chat"
    >
      <header className="relative flex shrink-0 flex-col items-center px-5 pt-4 pb-2">
        <InvitationBackLink href={liveRoute("home")} label={FIRST_CHAT_COPY.back} className="absolute top-4 left-2.5" />
        <AmoraOrb size={64} mood={streaming ? "working" : "calm"} />
        <span className="mt-1 text-[12px] text-inv-muted">{FIRST_CHAT_COPY.listening}</span>
      </header>
      {/* 끼운 실제 대화는 앱 기본 글 흐름(낱말 단위 줄바꿈)을 그대로 쓴다(웹 대화 칸과 같다). */}
      <div className="flex min-h-0 flex-1 flex-col break-keep px-[22px] pb-3" data-invitation-chat-slot>
        <LiveAmoraChat />
      </div>
    </div>
  );
}

/**
 * 인계를 처리하는 전체 화면 대화. 옛 모양 그대로이고(그 화면의 색·글꼴이 걸린 틀 안), 위에 라운지로
 * 돌아가는 줄만 더한다.
 */
function FullChat() {
  return (
    <div className="hanbang-service-theme amora-workspace flex min-h-0 flex-1 flex-col bg-[var(--hb-surface-page)]" data-chat-surface="full">
      <div className="flex shrink-0 items-center px-2.5 pt-2">
        <InvitationBackLink href={liveRoute("home")} label={JOURNEY_COPY.back} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ChatContent />
      </div>
    </div>
  );
}
