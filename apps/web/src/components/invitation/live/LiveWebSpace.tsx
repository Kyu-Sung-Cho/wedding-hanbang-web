"use client";

import { useMemo, type ReactNode } from "react";
import {
  ACTIVITY_COPY,
  COMPARE_STATE_COPY,
  EXAMPLE_WEB_SPACE,
  FIRST_CHAT_COPY,
  HOME_STATE_COPY,
  JOURNEY_STATE_COPY,
  type InvitationFacts,
  type JourneyRow,
  type PlanCard,
  type WebSpaceModel,
} from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";
import { useChatStore } from "@/stores/chatStore";

import type { InvitationLeadDecision } from "../InvitationParts";
import InvitationWebSpace from "../InvitationWebSpace";
import { isJourneyResponse } from "./invitationGuards";
import { DemoExampleNote, LiveAmoraChat, LiveFooter, LiveNotice, LiveRetry } from "./LiveParts";
import { liveConditionsHref, livePhotoSrc, liveRoute } from "./liveRoutes";
import { DECISIONS_UNAVAILABLE, HALLS_LOAD_FAILED, HOME_LOAD_FAILED, loadFailedMessage } from "./liveStateCopy";
import { useInvitationHalls } from "./useInvitationHalls";
import { useInvitationActivity, useInvitationHome } from "./useInvitationHome";
import { useInvitationQuery } from "./useInvitationQuery";
import { useLiveIdentity } from "./useLiveIdentity";

/** 아직 아무것도 모를 때의 청첩장. 빈칸은 화면이 빈칸으로 그린다(짐작으로 채우지 않는다). */
const BLANK_FACTS: InvitationFacts = {
  firstName: null,
  secondName: null,
  year: null,
  month: null,
  day: null,
  timeLabel: null,
  venueName: null,
};

/** 준비 순서 아홉 단계를 웹 "준비 순서" 칸의 카드로. 이번 계획에서 뺀 단계는 넣지 않는다. */
export function journeyPlanCards(rows: readonly JourneyRow[]): PlanCard[] {
  return rows
    .filter((row) => !row.off)
    .map((row) => ({ number: row.number, title: row.title, sub: row.sub, now: row.state === "now" }));
}

function EmptyLine({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-2 py-2.5">
      <LiveNotice tone={onRetry ? "error" : "status"}>{children}</LiveNotice>
      {onRetry ? <LiveRetry onRetry={onRetry} /> : null}
    </div>
  );
}

/**
 * 웹 넓은 화면(`Web.dc`, 1024px 이상)의 실제 커플 화면. 왼쪽 칸은 실제 아모라 대화(`ChatSidePanel` 청첩장 모양),
 * 오른쪽은 실제 홈(청첩장 머리·두 분이 정할 것·오늘 한 일·웨딩홀 후보·준비 순서)이다. `/lounge` 와 `/chat` 이 같다.
 *
 *   - `notices`: 청첩장 사진 아래 알림 자리(라운지만 넘긴다).
 *   - `leadDecision`: 조건이 비어 있을 때 "두 분이 정할 것" 맨 앞의 조건 묻기 한 줄.
 *   - `chatTutorialTarget`: 첫 실행 안내의 아모라 단계가 가리킬 대화 칸 표시(라운지만 넘긴다).
 */
export default function LiveWebSpace({
  notices,
  leadDecision,
  chatTutorialTarget,
}: {
  notices?: ReactNode;
  leadDecision?: InvitationLeadDecision;
  chatTutorialTarget?: string;
} = {}) {
  const identity = useLiveIdentity();
  const home = useInvitationHome(identity);
  const activity = useInvitationActivity(identity);
  const halls = useInvitationHalls(identity, "total");
  const journey = useInvitationQuery("/journey", {
    owner: identity.owner,
    enabled: !identity.isDemo,
    refreshKey: identity.refreshKey,
    accept: isJourneyResponse,
  });
  const streaming = useChatStore((state) => state.isStreaming);

  const model = useMemo<WebSpaceModel>(() => {
    if (identity.isDemo) return { ...EXAMPLE_WEB_SPACE, orbCaption: FIRST_CHAT_COPY.listening };
    return {
      people: home.data?.home.people ?? [],
      orbCaption: FIRST_CHAT_COPY.listening,
      chat: [],
      suggestions: [],
      invitation: home.data?.home.invitation ?? BLANK_FACTS,
      decisions: home.data?.home.decisions ?? [],
      activity: activity.data?.activity ?? [],
      halls: halls.data?.compare?.halls ?? [],
      plan: journeyPlanCards(journey.data?.journey.rows ?? []),
    };
  }, [activity.data, halls.data, home.data, identity.isDemo, journey.data]);

  const emptyStates = identity.isDemo
    ? undefined
    : {
      // 홈 전체를 읽지 못했으면 홈 문구, 정할 것만 읽지 못했으면 그 문구. 조건 묻기 줄이 있으면 "정할 것이 없어요"는
      // 그 줄과 어긋나 빼 둔다(앱과 같다).
      decisions: home.failure ? (
        <EmptyLine onRetry={home.reload}>{HOME_LOAD_FAILED}</EmptyLine>
      ) : home.data?.degraded.includes("decisions") ? (
        <EmptyLine onRetry={home.reload}>{DECISIONS_UNAVAILABLE}</EmptyLine>
      ) : home.data && !leadDecision ? (
        <EmptyLine>{HOME_STATE_COPY.noDecisions}</EmptyLine>
      ) : null,
      // "오늘 한 일" 불러오기 실패에는 따로 정한 상태 문구가 없다. 이 칸은 청첩장 홈의 한 칸이라 홈 문구를 쓴다.
      activity: activity.failure ? (
        <EmptyLine onRetry={activity.reload}>{loadFailedMessage(activity.failure, HOME_LOAD_FAILED)}</EmptyLine>
      ) : activity.data ? (
        <EmptyLine>{ACTIVITY_COPY.empty}</EmptyLine>
      ) : null,
      halls: halls.failure ? (
        <EmptyLine onRetry={halls.reload}>{HALLS_LOAD_FAILED}</EmptyLine>
      ) : halls.data && !halls.data.compare ? (
        <div className="flex flex-col items-start gap-2 py-2.5">
          <LiveNotice>{COMPARE_STATE_COPY.needConditions}</LiveNotice>
          <Button href={liveConditionsHref()} variant="outline" size="pill-38" className="px-3.5">
            {COMPARE_STATE_COPY.needConditionsAction}
          </Button>
        </div>
      ) : halls.data ? (
        <div className="flex flex-col gap-1 py-2.5">
          <LiveNotice>{COMPARE_STATE_COPY.noHalls}</LiveNotice>
          <p className="text-[13px] leading-[1.6] text-inv-muted">{COMPARE_STATE_COPY.noHallsSub}</p>
        </div>
      ) : null,
      plan: journey.failure ? (
        <EmptyLine onRetry={journey.reload}>{loadFailedMessage(journey.failure, JOURNEY_STATE_COPY.loadFailed)}</EmptyLine>
      ) : null,
    };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-live-screen="web">
      {identity.isDemo ? <DemoExampleNote /> : null}
      <InvitationWebSpace
        model={model}
        resolveRoute={liveRoute}
        photoSrc={livePhotoSrc}
        orbMood={streaming ? "working" : "calm"}
        emptyStates={emptyStates}
        notices={identity.isDemo ? undefined : notices}
        leadDecision={identity.isDemo ? undefined : leadDecision}
        footer={<LiveFooter />}
      >
        <div className="flex min-h-0 flex-1 flex-col" data-tutorial-target={chatTutorialTarget}>
          <LiveAmoraChat />
        </div>
      </InvitationWebSpace>
    </div>
  );
}
