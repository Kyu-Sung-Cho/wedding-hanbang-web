"use client";

import { useId, type ReactNode } from "react";
import { JOURNEY_COPY, type JourneyModel, type JourneyRow } from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import { DoneCheckIcon } from "./InvitationIcons";
import { InvitationBackLink } from "./InvitationParts";
import {
  INVITATION_SCREEN_ROOT,
  INVITATION_SCROLL_MIDDLE,
  cx,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationJourneyProps = {
  model: JourneyModel;
  resolveRoute: InvitationRouteResolver;
  /** 넣고 빼는 단계(`optional`)의 빼기·다시 넣기. 값은 부모가 바꾼다. */
  onToggleStage: (key: string) => void;
  /** 반지와 예물·신혼집 준비 넣기. */
  onToggleAddOn: (key: string) => void;
  /** 있으면 "이 순서로 할게요"가 이 일을 하고(저장 뒤 이동 등), 없으면 홈으로 가는 링크다. */
  onConfirm?: () => void;
  /** 실제 커플: 저장 상태 한 줄(저장하지 못했어요 등). 아래 단추 묶음 맨 위에 온다. */
  notice?: ReactNode;
  className?: string;
};

/** 줄 모양. 지금 단계만 분홍 면을 깔고 좌우로 16px 내민다. 나머지는 아래 선으로 나눈다. */
function rowClass(row: JourneyRow): string {
  return cx(
    "flex items-center gap-4 rounded-[18px] py-[13px]",
    row.state === "now" ? "-mx-4 bg-inv-step-now px-4" : "border-b border-inv-row-line",
  );
}

function numberClass(row: JourneyRow): string {
  return cx(
    "w-[26px] flex-none font-inv-numeral text-[20px] font-medium",
    row.state === "done" ? "text-inv-done-number" : "text-inv-gold-ink",
  );
}

/** 뺀 단계는 흐리게 긋고, 끝난 단계는 흐린 글자, 지금은 굵게, 다음은 중간 굵기. */
function titleClass(row: JourneyRow): string {
  if (row.off) return "text-[15px] text-inv-off-text line-through";
  if (row.state === "done") return "text-[15px] text-inv-faint";
  return cx("text-[15px]", row.state === "now" ? "font-bold" : "font-medium");
}

/**
 * 준비 순서(`Journey.dc`, 390×960). 아홉 단계를 차례로 보이고, 넣고 뺄 수 있는 단계에는
 * 빼기·다시 넣기를 둔다. 순서와 상태는 모델이 정한다(`buildJourneyModel`).
 *
 * 아티팩트에 없는 것: 넣기 단추를 누른 뒤의 모습. 아티팩트의 넣기 단추는 눌러도 아무 일이
 * 없어서, 넣은 상태를 다른 고르기 칩처럼 먹색 채움과 눌림 상태로 보인다.
 */
export default function InvitationJourney({
  model,
  resolveRoute,
  onToggleStage,
  onToggleAddOn,
  onConfirm,
  notice,
  className,
}: InvitationJourneyProps) {
  const baseId = useId();
  const titleId = (key: string) => `${baseId}-${key}`;

  return (
    <div className={cx(INVITATION_SCREEN_ROOT, className)} data-invitation-screen="journey">
      <header className="flex shrink-0 items-center justify-between pt-4 pr-4 pl-2.5">
        <InvitationBackLink href={resolveRoute("home")} label={JOURNEY_COPY.back} />
        <AmoraOrb size={40} mood="calm" />
      </header>

      <div className="flex shrink-0 flex-col gap-2 px-[26px] pt-2 pb-5">
        <h1 className="font-inv-serif text-[28px] font-normal">{JOURNEY_COPY.title}</h1>
        <p className="text-[15px] leading-[1.65] text-inv-body">{JOURNEY_COPY.intro}</p>
      </div>

      <ol data-invitation-scroll className={cx("flex flex-col px-[26px]", INVITATION_SCROLL_MIDDLE)}>
        {model.rows.map((row) => (
          <li key={row.key} className={rowClass(row)} data-step={row.key} data-state={row.state} data-off={row.off}>
            <span className={numberClass(row)}>{row.number}</span>
            <div className="flex flex-1 flex-col gap-[3px]">
              <span id={titleId(row.key)} className={titleClass(row)}>
                {row.title}
              </span>
              <span className="text-[13px] text-inv-muted">{row.off ? JOURNEY_COPY.removedSub : row.sub}</span>
            </div>
            {row.optional ? (
              <Button
                variant="outline"
                size="pill-34"
                className="flex-none px-3.5"
                aria-describedby={titleId(row.key)}
                onClick={() => onToggleStage(row.key)}
              >
                {row.off ? JOURNEY_COPY.restore : JOURNEY_COPY.remove}
              </Button>
            ) : null}
            {row.state === "done" ? <DoneCheckIcon label={JOURNEY_COPY.done} /> : null}
          </li>
        ))}
      </ol>

      <div className="flex shrink-0 flex-col gap-2.5 px-[22px] pt-3 pb-[26px]">
        {notice}
        {model.addOns.length > 0 ? (
          <div className="flex gap-2">
            {model.addOns.map((addOn) => (
              <Button
                key={addOn.key}
                variant={addOn.added ? "ink" : "dashed"}
                size="pill-44"
                className="flex-1"
                aria-pressed={addOn.added}
                onClick={() => onToggleAddOn(addOn.key)}
              >
                {addOn.button}
              </Button>
            ))}
          </div>
        ) : null}
        {onConfirm ? (
          <Button variant="ink" size="pill-54" weight="bold" fullWidth onClick={onConfirm}>
            {JOURNEY_COPY.confirm}
          </Button>
        ) : (
          <Button href={resolveRoute("home")} variant="ink" size="pill-54" weight="bold" fullWidth>
            {JOURNEY_COPY.confirm}
          </Button>
        )}
      </div>
    </div>
  );
}
