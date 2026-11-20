"use client";

import type { ReactNode } from "react";
import { STATUS_COPY, type AmoraUpdate, type ConsultationModel } from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import { InvitationBackLink, UpdateActionPill } from "./InvitationParts";
import {
  INVITATION_BUTTON_TEXT,
  INVITATION_SCREEN_ROOT,
  INVITATION_SCROLL_MIDDLE,
  cx,
  defaultInvitationPhotoSrc,
  type InvitationPhotoResolver,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationConsultationProps = {
  model: ConsultationModel;
  resolveRoute: InvitationRouteResolver;
  photoSrc?: InvitationPhotoResolver;
  /** 사진 위 "캘린더에 있어요". */
  onOpenCalendar?: () => void;
  /** 사진 위 "준호 님과 공유". 상대 이름이 없으면 단추가 없다. */
  onShareWithPartner?: () => void;
  /** 아모라 소식 아래 단추(`updateActions`)의 몇 번째를 눌렀는지. */
  onUpdateAction?: (index: number) => void;
  /**
   * 실제 커플: 사진 위 첫 칩을 대신한다. 아직 일정에 없으면 "일정에 넣기"(커플이 누를 때만 넣는다),
   * 넣었으면 "일정에 넣었어요"·"캘린더에 있어요". 없으면(예시) 아티팩트의 "캘린더에 있어요" 그대로다.
   */
  calendarAction?: { label: string; onClick?: () => void; disabled?: boolean; busy?: boolean };
  /** 실제 커플: 일정 넣기 실패 같은 상태 한 줄. 스크롤 칸 맨 위에 온다. */
  notice?: ReactNode;
  className?: string;
};

function ConsultationUpdate({
  update,
  actions,
  onAction,
}: {
  update: AmoraUpdate;
  actions: ConsultationModel["updateActions"];
  onAction?: (index: number) => void;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <AmoraOrb size={40} mood={update.mood} />
        <span className="text-[13px] text-inv-muted">{update.timeLabel}</span>
      </div>
      <p className="text-[17px] leading-[1.65]">{update.text}</p>
      {actions.length > 0 ? (
        <div className="flex gap-2">
          {actions.map((action, index) => (
            <UpdateActionPill
              key={action.label}
              label={action.label}
              tone={action.tone}
              onClick={onAction ? () => onAction(index) : undefined}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 답장과 상담 확정(`Status.dc`, 390×1000). 홀 사진 위에 확정된 상담 카드를 띄우고, 아래에
 * 다른 홀의 답장 소식과 상담에서 물어볼 것을 둔다. 값은 아티팩트의 인라인 스타일 그대로다.
 */
export default function InvitationConsultation({
  model,
  resolveRoute,
  photoSrc = defaultInvitationPhotoSrc,
  onOpenCalendar,
  onShareWithPartner,
  onUpdateAction,
  calendarAction,
  notice,
  className,
}: InvitationConsultationProps) {
  const hero = model.photo ? photoSrc(model.photo) : null;

  return (
    <div className={cx(INVITATION_SCREEN_ROOT, className)} data-invitation-screen="status">
      <section className="relative h-[430px] flex-none overflow-hidden rounded-b-[36px]">
        {hero ? (
          // eslint-disable-next-line @next/next/no-img-element -- 화면 머리 사진이라 원본을 그대로 쓴다
          <img src={hero} alt="" className="absolute inset-0 h-full! w-full object-cover" />
        ) : null}
        <InvitationBackLink
          href={resolveRoute("home")}
          label={STATUS_COPY.back}
          iconSize={20}
          className="absolute top-3.5 left-3 rounded-[22px] bg-[rgba(255,255,255,0.85)]"
        />
        <article className="absolute inset-x-10 top-[76px] rounded-[6px] bg-inv-white p-2 shadow-[0_18px_40px_rgba(30,50,30,0.22)]">
          <div className="flex flex-col items-center gap-1.5 border border-inv-gold-line px-4 pt-6 pb-5 text-center">
            <span className="text-[11px] tracking-[0.18em] text-inv-gold-ink">{STATUS_COPY.eyebrow}</span>
            <span className="font-inv-numeral text-[52px] leading-[1.05] font-medium tracking-[0.03em]">
              {model.dateLabel}
            </span>
            <span className="font-inv-serif text-[15px]">{model.timeLabel}</span>
            <span aria-hidden="true" className="my-2 h-px w-6 bg-inv-gold-rule" />
            <span className="font-inv-serif text-[18px] font-bold">{model.venue}</span>
            <span className="text-[12px] text-inv-muted">{model.place}</span>
          </div>
        </article>
        <div className="absolute inset-x-0 bottom-5 flex justify-center gap-2">
          <Button
            variant="glass"
            size="pill-40"
            weight="medium"
            className={cx("px-4", INVITATION_BUTTON_TEXT)}
            onClick={calendarAction ? calendarAction.onClick : onOpenCalendar}
            disabled={calendarAction?.disabled}
            loading={calendarAction?.busy}
          >
            {calendarAction?.label ?? STATUS_COPY.inCalendar}
          </Button>
          {model.partnerName ? (
            <Button
              variant="glass"
              size="pill-40"
              weight="medium"
              className={cx("px-4", INVITATION_BUTTON_TEXT)}
              onClick={onShareWithPartner}
            >
              {STATUS_COPY.shareWith(model.partnerName)}
            </Button>
          ) : null}
        </div>
      </section>

      <div data-invitation-scroll className={cx("flex flex-col gap-[22px] px-[22px] pt-[22px] pb-6", INVITATION_SCROLL_MIDDLE)}>
        {notice}
        {model.update ? (
          <ConsultationUpdate update={model.update} actions={model.updateActions} onAction={onUpdateAction} />
        ) : null}

        {model.questions.length > 0 ? (
          <section className="flex flex-col gap-3 rounded-[24px] bg-inv-paper-soft p-5">
            <h2 className="font-inv-serif text-[17px] font-bold">{STATUS_COPY.questionsHeading(model.venue)}</h2>
            <ol className="flex flex-col gap-2.5 text-[15px] leading-[1.5]">
              {model.questions.map((question, index) => (
                <li key={question} className="flex gap-3">
                  <span className="w-3.5 font-inv-numeral text-[17px] text-inv-gold-ink">{index + 1}</span>
                  {question}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  );
}
