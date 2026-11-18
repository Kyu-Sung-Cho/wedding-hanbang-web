"use client";

import { useId, useState, type ReactNode } from "react";
import {
  HOME_COPY,
  INVITATION_FIELD_COUNT,
  filledInvitationFieldCount,
  invitationBlankCount,
  type AmoraUpdate,
  type HomeModel,
} from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import InvitationCard from "./InvitationCard";
import { DecisionRows, PersonChips, withLeadDecision, type InvitationLeadDecision } from "./InvitationParts";
import InvitationTabBar, { type InvitationTabKey } from "./InvitationTabBar";
import {
  INVITATION_BACKDROP_SRC,
  INVITATION_SCREEN_ROOT,
  INVITATION_SCROLL_MIDDLE,
  cx,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationHomeProps = {
  model: HomeModel;
  resolveRoute: InvitationRouteResolver;
  /**
   * 떠 있는 하단 메뉴를 그린다(아티팩트 기본). 자기 메뉴를 가진 화면 틀 안에 넣을 때는 끈다.
   */
  tabBar?: boolean;
  /** 하단 메뉴 칸의 주소를 따로 줄 때(실제 커플의 "일정" 칸). `InvitationTabBar` 의 같은 이름 값. */
  tabHrefs?: Partial<Record<InvitationTabKey, string>>;
  /** 실제 커플의 첫 실행 안내가 가리킬 메뉴 칸. `InvitationTabBar` 의 `tutorialTargets`. */
  tabTutorialTargets?: Partial<Record<InvitationTabKey, string>>;
  /**
   * 실제 커플 화면의 알림 자리. 사진 머리 바로 아래, 아모라 소식 위에 온다(앱 홈과 같은 자리).
   * 할 말이 없으면 알림이 아무것도 그리지 않는다. 예시 커플은 넘기지 않는다.
   */
  notices?: ReactNode;
  /** 실제 커플 화면: "두 분이 정할 것" 맨 앞에 더하는 한 줄(조건이 비어 있을 때 첫 대화를 다시 연다). */
  leadDecision?: InvitationLeadDecision;
  /**
   * 실제 커플 화면: 소식과 할 일 자리에 넣는 상태 줄(할 일을 읽지 못함·정할 것이 없음). 할 일 목록 뒤에 온다.
   * 예시 커플은 넘기지 않아 아티팩트 모양 그대로다.
   */
  status?: ReactNode;
  /** 실제 커플 화면: 스크롤 칸 맨 아래(다른 화면으로 가는 링크, AI 서비스 고지). */
  footer?: ReactNode;
  className?: string;
};

/** 청첩장 빈칸 막대 다섯 개. 채운 칸은 흰색, 빈칸은 흰 40%. */
function BlankBars({ filled }: { filled: number }) {
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: INVITATION_FIELD_COUNT }, (_, index) => (
        <span
          key={index}
          data-filled={index < filled ? "true" : "false"}
          className={cx("h-[3px] w-[18px] rounded-[2px]", index < filled ? "bg-inv-white" : "bg-[rgba(255,255,255,0.4)]")}
        />
      ))}
    </div>
  );
}

function HomeAmoraUpdate({ update, resolveRoute }: { update: AmoraUpdate; resolveRoute: InvitationRouteResolver }) {
  const [open, setOpen] = useState(false);
  const stepsId = useId();
  const hasSteps = update.steps.length > 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <AmoraOrb size={36} mood={update.mood} />
        <span className="text-[13px] text-inv-muted">{update.timeLabel}</span>
      </div>
      <p className="text-[17px] leading-[1.65]">{update.text}</p>
      {hasSteps ? (
        <ol
          id={stepsId}
          hidden={!open}
          className="flex list-decimal flex-col gap-2 rounded-[18px] bg-inv-paper-soft py-3.5 pr-4 pl-[34px] text-[14px] leading-[1.55] text-inv-body"
        >
          {update.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}
      {update.primary || hasSteps ? (
        <div className="flex items-center gap-2">
          {update.primary ? (
            <Button
              href={resolveRoute(update.primary.target)}
              variant="ink"
              size="pill-46"
              weight="bold"
              className="px-[22px]"
            >
              {update.primary.label}
            </Button>
          ) : null}
          {hasSteps ? (
            <Button
              variant="plain"
              size="pill-46"
              className="px-4"
              aria-expanded={open}
              aria-controls={stepsId}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? HOME_COPY.fold : HOME_COPY.whatDidYouDo}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 청첩장 홈(`Home.dc`, 390×1000). 보케 사진 위에 빈칸이 있는 청첩장을 띄우고, 그 아래에
 * 아모라 소식과 두 분이 정할 것을 둔다. 값은 아티팩트의 인라인 스타일 그대로다.
 *
 * 아티팩트처럼 높이가 정해진 세로 단이다. 사진 머리는 위에 붙어 있고, 그 아래 칸만 스크롤한다
 * (아티팩트는 넘친 내용을 자른다). 하단 메뉴는 틀 바닥에 떠 있다.
 *
 * 다른 점(이유): 아래 여백 110px 과 하단 메뉴 위치에 아이폰 홈 막대 높이를 더한다.
 */
export default function InvitationHome({
  model,
  resolveRoute,
  tabBar = true,
  tabHrefs,
  tabTutorialTargets,
  notices,
  leadDecision,
  status,
  footer,
  className,
}: InvitationHomeProps) {
  const filled = filledInvitationFieldCount(model.invitation);
  const blanks = invitationBlankCount(model.invitation);
  const decisions = withLeadDecision(model.decisions, leadDecision);

  return (
    <div className={cx(INVITATION_SCREEN_ROOT, className)} data-invitation-screen="home">
      <section className="relative h-[470px] flex-none overflow-hidden rounded-b-[36px]">
        {/* eslint-disable-next-line @next/next/no-img-element -- 화면 바탕 사진이라 원본 크기 그대로 쓴다 */}
        <img src={INVITATION_BACKDROP_SRC} alt="" className="absolute inset-0 h-full! w-full object-cover" />
        <div className="absolute inset-x-[18px] top-[18px] flex items-center justify-between">
          <span className="font-inv-numeral text-[26px] font-medium italic text-inv-white">{HOME_COPY.wordmark}</span>
          <PersonChips people={model.people} variant="home" />
        </div>
        <InvitationCard facts={model.invitation} variant="home" className="absolute inset-x-[34px] top-[78px]" />
        <div className="absolute inset-x-[34px] bottom-[22px] flex items-center justify-between text-inv-white">
          <span className="text-[13px] font-medium">{HOME_COPY.blanksLeft(blanks)}</span>
          <BlankBars filled={filled} />
        </div>
      </section>

      <div
        data-invitation-scroll
        className={cx(
          "flex flex-col gap-6 px-[22px] pt-[22px]",
          INVITATION_SCROLL_MIDDLE,
          tabBar ? "pb-[calc(110px_+_env(safe-area-inset-bottom))]" : "pb-[22px]",
        )}
      >
        {notices}
        {model.update ? <HomeAmoraUpdate update={model.update} resolveRoute={resolveRoute} /> : null}
        {decisions.length > 0 ? (
          <section className="flex flex-col">
            <h2 className="mb-1.5 font-inv-serif text-[18px] font-bold">{HOME_COPY.decisionsHeading}</h2>
            <DecisionRows decisions={decisions} variant="home" resolveRoute={resolveRoute} lead={leadDecision} />
          </section>
        ) : null}
        {status}
        {footer}
      </div>

      {tabBar ? (
        <InvitationTabBar
          active="home"
          resolveRoute={resolveRoute}
          hrefs={tabHrefs}
          tutorialTargets={tabTutorialTargets}
        />
      ) : null}
    </div>
  );
}
