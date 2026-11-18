"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ACTIVITY_COPY,
  ASK_CONDITIONS_COPY,
  EXAMPLE_HOME,
  FIRST_CHAT_INPUT_COPY,
  HOME_COPY,
  HOME_STATE_COPY,
  INVITATION_REGIONS,
  type FirstChatModel,
  type HomeModel,
  type InvitationActorLine,
  type InvitationHomeResponse,
  type PreparationStartStage,
} from "@hanbang/shared/invitation";

import { requestProactiveCare } from "@/lib/care/requestProactiveCare";
import { weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";

import InvitationFirstChat from "../InvitationFirstChat";
import InvitationHome from "../InvitationHome";
import type { InvitationLeadDecision } from "../InvitationParts";
import { rememberFirstChatLater, useFirstChatLater } from "./firstChatLater";
import {
  DemoExampleNote,
  LiveColumn,
  LiveFooter,
  LiveLoadingScreen,
  LiveMessageScreen,
  LiveNotice,
  LiveRetry,
} from "./LiveParts";
import LiveLoungeNotices, { AMORA_TUTORIAL_TARGET } from "./LiveLoungeNotices";
import LiveWebSpace from "./LiveWebSpace";
import { LIVE_CONDITIONS_PARAM, LIVE_SCHEDULE_PATH, liveConditionsHref, liveRoute } from "./liveRoutes";
import { CONDITIONS_SAVE_FAILED, HOME_LOAD_FAILED, LIVE_RETRY_LABEL } from "./liveStateCopy";
import { useInvitationConditions, useInvitationHome, type InvitationConditionsState } from "./useInvitationHome";
import { useLiveIdentity, useWideScreen } from "./useLiveIdentity";

/** 하단 메뉴의 "일정" 칸은 실제 커플의 일정 화면을 연다. */
const TAB_HREFS = { schedule: weddingPath(LIVE_SCHEDULE_PATH) } as const;

/** 첫 실행 안내의 아모라 단계는 좁은 화면에서 하단 메뉴의 아모라 칸을 가리킨다. */
const TAB_TUTORIAL_TARGETS = { chat: AMORA_TUTORIAL_TARGET } as const;

/** 지역은 공유 정본 목록(시·도)에서 고른다. 웨딩홀 자료의 지역과 글자 그대로 맞아야 비교가 된다. */
const REGION_CHOICES: readonly string[] = INVITATION_REGIONS;

/**
 * 조건(희망 달·지역·하객 수)이 비어 있는 동안 "두 분이 정할 것" 맨 앞에 두는 한 줄(함께). 누르면 첫 대화가 다시
 * 열린다(첫 대화를 "나중에 할게요"로 건너뛰었어도). 앱 홈의 같은 줄과 같다.
 */
export const ASK_CONDITIONS_LEAD: InvitationLeadDecision = {
  decision: {
    id: "ask-conditions",
    title: ASK_CONDITIONS_COPY.title,
    sub: ASK_CONDITIONS_COPY.sub,
    owner: { kind: "together" },
    target: "home",
  },
  href: liveConditionsHref(),
};

/**
 * "무엇을 했나요?" 목록에 누가 한 일인지 붙인다. 파일럿 동안 업체에 보내기와 답장 정리는 담당자(사람)가 하므로
 * 담당자의 일을 아모라의 일처럼 쓰지 않는다(`ACTIVITY_COPY.actorLabel`). 서버가 같은 줄·같은 순서로 준
 * `updateSteps` 의 주체만 쓰고, 줄이 맞지 않으면 그 줄은 그대로 둔다.
 */
export function homeWithStepActors(response: InvitationHomeResponse): HomeModel {
  const { home } = response;
  // 옛 서버(줄의 주체를 아직 안 주던 때)와 어긋난 배포 사이에도 깨지지 않게 배열인지 본다.
  const actorLines: readonly InvitationActorLine[] = Array.isArray(response.updateSteps) ? response.updateSteps : [];
  if (!home.update || actorLines.length === 0) return home;
  const steps = home.update.steps.map((step, index) => {
    const line = actorLines[index];
    if (!line || line.text !== step || !(line.actor in ACTIVITY_COPY.actorLabel)) return step;
    return `${ACTIVITY_COPY.actorLabel[line.actor]} · ${step}`;
  });
  return { ...home, update: { ...home.update, steps } };
}

/** 저장된 희망 연도가 없을 때 달 고르기 카드에 쓰는 해. 아티팩트(11월에 본 2027)처럼 다음 해다. */
function defaultHopedYear(now: Date = new Date()): number {
  const kstYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric" }).format(now));
  return kstYear + 1;
}

/**
 * 웨딩 라운지(`/lounge`) 실제 커플 화면(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해).
 *
 *   - 온보딩(역할·커플 연결·동의)을 마쳤는데 결혼 조건(희망 달·지역·하객 수)이 비어 있으면 첫 대화(`Chat.dc`).
 *     "나중에 할게요"(또는 뒤로)로 건너뛰면 이 브라우저에 사람마다 기억하고 홈을 연다. 홈의 "희망 시기와 지역 알려
 *     주기" 한 줄과 웨딩홀 비교의 "조건 알려 주기"가 `?conditions=1` 로 첫 대화를 다시 연다(2026-11-17 리드 지시:
 *     이미 쓰던 커플이 새 질문에 갇히지 않게).
 *   - 1024px 이상은 웹 두 칸 화면(`Web.dc`), 그 아래는 청첩장 홈(`Home.dc`). 둘 다 사진 머리 아래에 알림 자리가 있다.
 *   - 체험 모드는 서버를 부르지 않고 예시 커플을 보인다(업체·가격·사진이 예시라는 줄과 함께).
 */
export default function LiveLounge() {
  const identity = useLiveIdentity();
  const wide = useWideScreen();
  const router = useRouter();
  const reopenFirstChat = useSearchParams().get(LIVE_CONDITIONS_PARAM) === "1";
  const skippedFirstChat = useFirstChatLater(identity.owner);

  // 먼저 챙기는 케어 시동 — 로그인 후 첫 화면이 라운지라 옛 라운지가 하던 대로 여기서 한 번 깨운다.
  useEffect(() => {
    if (identity.isDemo || !identity.owner) return;
    void requestProactiveCare();
  }, [identity.isDemo, identity.owner]);

  const checkConditions = !identity.isDemo && identity.onboardingCompleted;
  const conditions = useInvitationConditions(identity, checkConditions);
  // 첫 대화를 저장하고 웨딩홀로 넘어가는 동안 첫 대화를 그대로 둔다(저장 직후 홈이 잠깐 비치지 않게).
  const [leavingFirstChat, setLeavingFirstChat] = useState(false);
  const conditionsMissing = Boolean(checkConditions && conditions.data && conditions.data.missing.length > 0);

  /** 건너뛴 것을 기억한다. 홈은 이 기억을 보고 첫 대화 대신 열린다. */
  function rememberSkip() {
    if (identity.owner) rememberFirstChatLater(identity.owner);
  }

  /** "나중에 할게요": 기억하고 홈을 연다. 다시 연 첫 대화였으면 주소의 표시도 지운다(뒤로는 링크가 홈으로 간다). */
  function skipFirstChat() {
    rememberSkip();
    if (reopenFirstChat) router.replace(liveRoute("home"));
  }

  if (checkConditions) {
    if (!conditions.data && conditions.loading) return <LiveLoadingScreen footer={<LiveFooter />} />;
    if (leavingFirstChat || (conditionsMissing && (reopenFirstChat || skippedFirstChat === false))) {
      return conditions.data ? (
        <LiveColumn>
          <LiveFirstChat
            conditions={conditions}
            onLeaving={setLeavingFirstChat}
            onBack={rememberSkip}
            onLater={skipFirstChat}
          />
        </LiveColumn>
      ) : (
        <LiveLoadingScreen footer={<LiveFooter />} />
      );
    }
    // 건너뛴 기록은 브라우저에서만 읽는다(서버 그림·하이드레이션 중에는 모른다). 무엇을 보일지 정해질 때까지 기다린다.
    if (conditionsMissing && skippedFirstChat === null) return <LiveLoadingScreen footer={<LiveFooter />} />;
  }

  const leadDecision = conditionsMissing ? ASK_CONDITIONS_LEAD : undefined;
  return wide ? (
    <LiveWebSpace notices={<LiveLoungeNotices />} leadDecision={leadDecision} chatTutorialTarget={AMORA_TUTORIAL_TARGET} />
  ) : (
    <LiveHome leadDecision={leadDecision} />
  );
}

/** 좁은 화면의 청첩장 홈. 두 분이 정할 것을 읽지 못하면 빈 목록으로 숨기지 않고 다시 불러오기를 준다. */
function LiveHome({ leadDecision }: { leadDecision?: InvitationLeadDecision }) {
  const identity = useLiveIdentity();
  const home = useInvitationHome(identity);

  if (identity.isDemo) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <DemoExampleNote />
        <LiveColumn>
          <InvitationHome model={EXAMPLE_HOME} resolveRoute={liveRoute} tabHrefs={TAB_HREFS} footer={<LiveFooter />} />
        </LiveColumn>
      </div>
    );
  }
  if (!home.data) {
    if (home.loading) return <LiveLoadingScreen footer={<LiveFooter />} />;
    return (
      <LiveColumn>
        <LiveMessageScreen
          tone="error"
          text={HOME_LOAD_FAILED}
          action={{ label: LIVE_RETRY_LABEL, onClick: home.reload }}
          footer={<LiveFooter />}
        />
      </LiveColumn>
    );
  }

  const model = homeWithStepActors(home.data);
  const heading = <h2 className="font-inv-serif text-[18px] font-bold">{HOME_COPY.decisionsHeading}</h2>;
  // 앞줄(조건 묻기)이 있으면 제목은 그 목록이 이미 그린다.
  const status = home.data.degraded.includes("decisions") ? (
    <section className="flex flex-col gap-2">
      {leadDecision ? null : heading}
      <LiveNotice tone="error">{HOME_STATE_COPY.decisionsUnavailable}</LiveNotice>
      <LiveRetry onRetry={home.reload} />
    </section>
  ) : model.decisions.length === 0 && !leadDecision ? (
    <section className="flex flex-col gap-1.5">
      {heading}
      <LiveNotice>{HOME_STATE_COPY.noDecisions}</LiveNotice>
    </section>
  ) : null;

  return (
    <LiveColumn>
      <InvitationHome
        model={model}
        resolveRoute={liveRoute}
        tabHrefs={TAB_HREFS}
        tabTutorialTargets={TAB_TUTORIAL_TARGETS}
        notices={<LiveLoungeNotices />}
        leadDecision={leadDecision}
        status={status}
        footer={<LiveFooter />}
      />
    </LiveColumn>
  );
}

/**
 * 첫 대화(조건 묻기). 준비 단계·희망 달·지역·하객 수를 고르고 "좋아요, 홀 찾아 주세요"를 누르면
 * PATCH `/api/invitation/conditions` 로 저장하고 웨딩홀 비교로 간다. "고칠게요"는 고른 달·지역·하객 수를 비워
 * 다시 고르게 한다. 고른 값은 누르기 전까지 어디에도 저장하지 않는다.
 *
 * 로그인한 사람의 첫 대화라 뒤로 가기는 로그아웃 화면(랜딩)이 아니라 홈으로 가고, "나중에 할게요"와 같이 건너뛴 것을
 * 기억한다(기억하지 않으면 홈이 다시 첫 대화를 연다). 맨 아래에는 옛 화면으로 가는 링크와 AI 서비스 고지를 둔다.
 */
function LiveFirstChat({
  conditions,
  onLeaving,
  onBack,
  onLater,
}: {
  conditions: InvitationConditionsState;
  onLeaving: (leaving: boolean) => void;
  onBack: () => void;
  onLater: () => void;
}) {
  const router = useRouter();
  const viewerName = useAuthStore((state) => state.profile?.name ?? null);
  const partnerName = useAuthStore((state) => state.partner?.name ?? null);
  const stored = conditions.data?.conditions ?? null;
  const [stage, setStage] = useState<PreparationStartStage | null>(stored?.startStage ?? null);
  const [month, setMonth] = useState<number | null>(stored?.hopedMonth ?? null);
  const [region, setRegion] = useState<string | null>(stored?.region ?? null);
  const [guests, setGuests] = useState<number | null>(stored?.guestCount ?? null);
  const [notice, setNotice] = useState<{ tone: "status" | "error"; text: string } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [year] = useState(() => stored?.hopedYear ?? defaultHopedYear());

  const model: FirstChatModel = {
    year,
    // 지역과 하객 수는 아래 고르기(`place`)가 그린다. 모델 값은 쓰이지 않는다.
    region: region ?? "",
    guests: guests ?? 0,
    names: { first: viewerName, second: partnerName },
  };
  const ready = month !== null && region !== null && guests !== null;

  async function confirm() {
    if (!ready || conditions.saving) return;
    setNotice({ tone: "status", text: FIRST_CHAT_INPUT_COPY.saving });
    onLeaving(true);
    const result = await conditions.save({
      hopedYear: year,
      hopedMonth: month,
      region,
      guestCount: guests,
      ...(stage ? { startStage: stage } : {}),
    });
    if (result.ok) {
      router.push(liveRoute("compare"));
      return;
    }
    onLeaving(false);
    setNotice({ tone: "error", text: CONDITIONS_SAVE_FAILED });
  }

  function edit() {
    setMonth(null);
    setRegion(null);
    setGuests(null);
    setNotice(null);
    rootRef.current?.querySelector("[data-invitation-scroll]")?.scrollTo?.({ top: 0 });
  }

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <InvitationFirstChat
        model={model}
        stage={stage}
        month={month}
        onPickStage={setStage}
        onPickMonth={setMonth}
        resolveRoute={liveRoute}
        backHref={liveRoute("home")}
        onBack={onBack}
        onConfirm={() => void confirm()}
        onEdit={edit}
        onLater={onLater}
        place={{ regions: REGION_CHOICES, region, guests, onPickRegion: setRegion, onPickGuests: setGuests }}
        confirmDisabled={!ready}
        confirmBusy={conditions.saving}
        notice={notice ? <LiveNotice tone={notice.tone}>{notice.text}</LiveNotice> : null}
        footer={<LiveFooter />}
      />
    </div>
  );
}
