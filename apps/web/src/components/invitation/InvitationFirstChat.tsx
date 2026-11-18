"use client";

import type { ReactNode } from "react";
import {
  FIRST_CHAT_COPY,
  FIRST_CHAT_INPUT_COPY,
  type FirstChatModel,
  type InvitationFacts,
  type PreparationStartStage,
} from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import InvitationCard from "./InvitationCard";
import { InvitationBackLink } from "./InvitationParts";
import {
  INVITATION_SCREEN_ROOT,
  INVITATION_SCROLL_MIDDLE,
  cx,
  type InvitationRouteResolver,
} from "./invitationScreen";

/**
 * 실제 커플의 지역·하객 수 고르기. 아티팩트는 예시 커플의 답("서울에서, 하객은 200명 정도요")만 그렸으므로,
 * 실제 커플에게는 그 말풍선 자리 앞에 아모라의 물음과 고르기 칩을 두고, 둘 다 고른 뒤에만 말풍선과
 * 초안의 마지막 줄을 그린다. 값은 부모가 든다.
 */
export type FirstChatPlacePicker = {
  regions: readonly string[];
  region: string | null;
  guests: number | null;
  onPickRegion: (region: string) => void;
  onPickGuests: (guests: number) => void;
};

type InvitationFirstChatProps = {
  model: FirstChatModel;
  /** 고른 준비 단계. 화면은 고르기만 알리고 값은 부모가 든다. 실제 커플이 아직 고르지 않았으면 null. */
  stage: PreparationStartStage | null;
  /** 고른 달(1~12). 아직 고르지 않았으면 null 이고 초안의 달은 빈칸으로 남는다. */
  month: number | null;
  onPickStage: (stage: PreparationStartStage) => void;
  onPickMonth: (month: number) => void;
  resolveRoute: InvitationRouteResolver;
  /** 뒤로 가기 주소. 없으면 홈으로 간다. */
  backHref?: string;
  /** 뒤로 가기를 누르면 이동하기 전에 할 일(실제 커플: 건너뛴 것을 기억한다). */
  onBack?: () => void;
  /** 있으면 "좋아요, 홀 찾아 주세요"가 이 일을 하고, 없으면 홈으로 가는 링크다. */
  onConfirm?: () => void;
  onEdit?: () => void;
  /**
   * 실제 커플: "나중에 할게요". 확인 단추 줄 아래에 조용한 단추로 둔다(앱 첫 대화와 같은 자리).
   * 이미 쓰던 커플이 새 질문에 갇히지 않게 홈으로 간다. 예시 커플은 넘기지 않아 아티팩트 모양 그대로다.
   */
  onLater?: () => void;
  /** 실제 커플: 지역·하객 수 고르기. 없으면(예시) 모델의 답을 그대로 그린다. */
  place?: FirstChatPlacePicker;
  /** 실제 커플: 아직 다 고르지 않았거나 저장하는 중이면 확인 단추를 잠근다. */
  confirmDisabled?: boolean;
  confirmBusy?: boolean;
  /** 실제 커플: 저장 상태 한 줄(저장하고 있어요·저장하지 못했어요). 아래 단추 바로 위에 온다. */
  notice?: ReactNode;
  /** 실제 커플: 스크롤 칸 맨 아래(다른 화면으로 가는 링크, AI 서비스 고지). */
  footer?: ReactNode;
  className?: string;
};

/**
 * 사람 말풍선(`Chat.dc`): 돌빛, 반경 20, 15px. 아티팩트의 최대 폭 260px 은 안쪽 여백을 뺀
 * 글자 칸 폭이라(상자 크기 계산이 content-box), 여백을 더한 바깥 폭은 292px 이다.
 */
const PERSON_BUBBLE =
  "max-w-[292px] self-end rounded-[20px] bg-inv-stone px-4 py-2.5 text-[15px] leading-[1.5]";

/** 아모라 말: 말풍선 없이 17px 글줄(아티팩트 메모의 말풍선 없는 대화). */
const AMORA_LINE = "text-[17px] leading-[1.65]";

/** 고르기 칩 한 줄. 준비 단계 칩과 같은 42px 알약이다(고른 쪽은 먹색 채움). */
function ChoiceChips<T extends string | number>({
  label,
  options,
  selected,
  labelOf,
  onPick,
}: {
  label: string;
  options: readonly T[];
  selected: T | null;
  labelOf: (option: T) => string;
  onPick: (option: T) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span aria-hidden="true" className="text-[12px] text-inv-muted">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const on = option === selected;
          return (
            <Button
              key={String(option)}
              variant={on ? "ink" : "outline"}
              size="pill-42"
              weight={on ? "medium" : "regular"}
              className="px-4"
              aria-pressed={on}
              onClick={() => onPick(option)}
            >
              {labelOf(option)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** 실제 커플: 지역과 하객 수를 묻고 고르게 한다. 지역 목록은 공유 목록에서 온다. */
function PlacePicker({ place }: { place: FirstChatPlacePicker }) {
  return (
    <>
      <p className={AMORA_LINE}>{FIRST_CHAT_INPUT_COPY.askWhereAndGuests}</p>
      <ChoiceChips
        label={FIRST_CHAT_INPUT_COPY.regionLabel}
        options={place.regions}
        selected={place.region}
        labelOf={(region) => region}
        onPick={place.onPickRegion}
      />
      <ChoiceChips
        label={FIRST_CHAT_INPUT_COPY.guestsLabel}
        options={FIRST_CHAT_INPUT_COPY.guestChoices}
        selected={place.guests as (typeof FIRST_CHAT_INPUT_COPY.guestChoices)[number] | null}
        labelOf={FIRST_CHAT_INPUT_COPY.guestChoiceLabel}
        onPick={place.onPickGuests}
      />
    </>
  );
}

/**
 * 아모라와 첫 대화(`Chat.dc`, 390×960). 준비 단계와 예식 달을 고르면 청첩장 초안이
 * 그 달로 바뀐다. 고른 값은 부모가 들고(제어 컴포넌트), 저장은 부모가 한다.
 */
export default function InvitationFirstChat({
  model,
  stage,
  month,
  onPickStage,
  onPickMonth,
  resolveRoute,
  backHref,
  onBack,
  onConfirm,
  onEdit,
  onLater,
  place,
  confirmDisabled = false,
  confirmBusy = false,
  notice,
  footer,
  className,
}: InvitationFirstChatProps) {
  const answer = FIRST_CHAT_COPY.stages.find((option) => option.id === stage)?.answer ?? null;
  // 예시 커플은 모델의 답을, 실제 커플은 둘 다 고른 뒤의 답을 쓴다.
  const region = place ? place.region : model.region;
  const guests = place ? place.guests : model.guests;
  const placeAnswered = region !== null && guests !== null;
  const draft: InvitationFacts = {
    firstName: model.names.first,
    secondName: model.names.second,
    year: model.year,
    month,
    day: null,
    timeLabel: null,
    venueName: null,
  };
  const actions = (
    <>
      {onConfirm ? (
        <Button
          variant="ink"
          size="pill-54"
          weight="bold"
          className="flex-1"
          onClick={onConfirm}
          disabled={confirmDisabled}
          loading={confirmBusy}
        >
          {FIRST_CHAT_COPY.confirm}
        </Button>
      ) : (
        <Button href={resolveRoute("home")} variant="ink" size="pill-54" weight="bold" className="flex-1">
          {FIRST_CHAT_COPY.confirm}
        </Button>
      )}
      <Button variant="soft" size="pill-54" weight="medium" className="px-5" onClick={onEdit}>
        {FIRST_CHAT_COPY.edit}
      </Button>
    </>
  );

  return (
    <div className={cx(INVITATION_SCREEN_ROOT, className)} data-invitation-screen="chat">
      <header className="relative flex shrink-0 flex-col items-center px-5 pt-4 pb-2">
        <InvitationBackLink
          href={backHref ?? resolveRoute("home")}
          label={FIRST_CHAT_COPY.back}
          onClick={onBack}
          className="absolute top-4 left-2.5"
        />
        <AmoraOrb size={64} mood="calm" />
        <span className="mt-1 text-[12px] text-inv-muted">{FIRST_CHAT_COPY.listening}</span>
      </header>

      <div data-invitation-scroll className={cx("flex flex-col gap-[18px] px-[22px] py-3", INVITATION_SCROLL_MIDDLE)}>
        <p className={AMORA_LINE}>{FIRST_CHAT_COPY.greeting}</p>
        <div className="flex flex-wrap gap-2">
          {FIRST_CHAT_COPY.stages.map((option) => {
            const on = option.id === stage;
            return (
              <Button
                key={option.id}
                variant={on ? "ink" : "outline"}
                size="pill-42"
                weight={on ? "medium" : "regular"}
                className="px-4"
                aria-pressed={on}
                onClick={() => onPickStage(option.id)}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
        {answer ? <div className={PERSON_BUBBLE}>{answer}</div> : null}

        <p className={AMORA_LINE}>{FIRST_CHAT_COPY.askWhen}</p>
        <div className="flex flex-col gap-3.5 rounded-[24px] bg-inv-paper px-[18px] pt-[18px] pb-4 shadow-[inset_0_0_0_1px_#EEEAE6]">
          <div className="flex items-baseline justify-between">
            <span className="font-inv-numeral text-[30px] leading-none font-medium">{model.year}</span>
            <span className="text-[12px] text-inv-muted">{FIRST_CHAT_COPY.monthsNote}</span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {FIRST_CHAT_COPY.months.map((option) => {
              const on = option === month;
              return (
                <Button
                  key={option}
                  variant={on ? "ink" : "plain"}
                  size="pill-44"
                  weight={on ? "bold" : "regular"}
                  // 공유 버튼에 반경 14 알약이 없어서 반경만 덮는다(아티팩트 달 버튼).
                  className="rounded-[14px]!"
                  aria-pressed={on}
                  onClick={() => onPickMonth(option)}
                >
                  {FIRST_CHAT_COPY.monthLabel(option)}
                </Button>
              );
            })}
          </div>
        </div>
        {place ? <PlacePicker place={place} /> : null}
        {placeAnswered ? (
          <div className={PERSON_BUBBLE}>{FIRST_CHAT_COPY.regionGuestsAnswer(region, guests)}</div>
        ) : null}

        <p className={AMORA_LINE}>{FIRST_CHAT_COPY.draftIntro}</p>
        <InvitationCard
          facts={draft}
          variant="draft"
          draftLine={placeAnswered ? FIRST_CHAT_COPY.draftLine(region, guests) : null}
        />
        {notice}
        {footer}
      </div>

      {onLater ? (
        <div className="flex shrink-0 flex-col items-stretch gap-1 px-4 pt-3 pb-[14px]">
          <div className="flex gap-2">{actions}</div>
          <Button variant="plain" size="pill-44" className="self-center px-4" onClick={onLater}>
            {FIRST_CHAT_INPUT_COPY.later}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 gap-2 px-4 pt-3 pb-[26px]">{actions}</div>
      )}
    </div>
  );
}
