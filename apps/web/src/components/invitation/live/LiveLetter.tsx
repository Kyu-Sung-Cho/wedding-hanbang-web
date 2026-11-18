"use client";

import { useId, useState } from "react";
import {
  EXAMPLE_LETTER,
  FIRST_CHAT_COPY,
  LETTER_COPY,
  LETTER_STATE_COPY,
  type InquiryApproverMode,
  type InquiryApproverProposal,
  type InquiryApproverResponse,
  type LetterShare,
} from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";

import InvitationLetterSheet from "../InvitationLetterSheet";
import { DemoExampleNote, LiveLoadingScreen, LiveMessageScreen, LiveNotice, LiveColumn } from "./LiveParts";
import { livePhotoSrc, liveRoute } from "./liveRoutes";
import { LIVE_RETRY_LABEL, loadFailedMessage } from "./liveStateCopy";
import { useInvitationLetter, type InvitationLetterState } from "./useInvitationLetter";
import { useLiveIdentity } from "./useLiveIdentity";

const BACK_TO_HALLS = { href: liveRoute("compare"), label: FIRST_CHAT_COPY.back };

/** 체험 모드: 예시 커플의 편지. 스위치만 이 화면 안에서 바뀌고 보내기는 실제로 보내지 않는다(예시 화면 흐름). */
function DemoLetter() {
  const [shares, setShares] = useState<readonly LetterShare[]>(EXAMPLE_LETTER.shares);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DemoExampleNote />
      <InvitationLetterSheet
        model={{ ...EXAMPLE_LETTER, shares }}
        resolveRoute={liveRoute}
        onToggleShare={(key) =>
          setShares((current) => current.map((share) => (share.key === key ? { ...share, on: !share.on } : share)))}
        photoSrc={livePhotoSrc}
      />
    </div>
  );
}

/** 승인할 사람의 이름. 이름이 없으면 보는 사람은 "나", 상대는 "파트너"(배우자 될 사람)로 부른다. */
function memberLabel(member: InquiryApproverResponse["members"][number]): string {
  return member.name?.trim() || (member.isViewer ? "나" : "파트너");
}

/** 제안한 방식을 사람이 읽는 이름으로: "두 사람 모두" 또는 승인할 사람의 이름. 정하지 않음 제안은 이름이 없다. */
function proposalChoice(approver: InquiryApproverResponse, pending: InquiryApproverProposal): string | null {
  if (pending.mode === "both") return LETTER_STATE_COPY.approverBoth;
  if (pending.mode !== "designated") return null;
  const member = approver.members.find((candidate) => candidate.id === pending.designatedUserId);
  return member ? memberLabel(member) : null;
}

/**
 * 확인을 기다리는 승인 방식 제안(상대의 승인 권한을 줄이는 변경, D-76). 제안한 사람에게는 상대가 확인하면 바뀐다고만
 * 말한다(지금 방식을 다시 고르면 제안을 거둔다). 다른 회원에게는 누가 무엇으로 바꾸자고 했는지와 바꾸기·두기 단추를
 * 보인다. 확인 전까지는 지금 방식이 그대로 쓰인다.
 */
function ApproverProposal({ letter }: { letter: InvitationLetterState }) {
  const approver = letter.approver;
  const pending = approver?.pending ?? null;
  if (!approver || !pending) return null;
  if (!pending.viewerCanRespond) {
    return (
      <p role="status" className="text-[12px] leading-[1.5] text-inv-body" data-letter-approver-pending="waiting">
        {LETTER_STATE_COPY.approverPending}
      </p>
    );
  }
  const proposer = approver.members.find((member) => member.id === pending.proposedBy);
  const choice = proposalChoice(approver, pending);
  const sentence = choice
    ? LETTER_STATE_COPY.approverProposedBy(proposer ? memberLabel(proposer) : "파트너", choice)
    : letter.proposalLine;
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-inv-paper-soft p-3.5" data-letter-approver-pending="respond">
      {sentence ? <p className="text-[13px] leading-[1.55] text-inv-body">{sentence}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ink"
          size="pill-38"
          weight="bold"
          className="px-3.5"
          disabled={letter.busy}
          onClick={() => void letter.respondToProposal(true)}
        >
          {LETTER_STATE_COPY.approverConfirm}
        </Button>
        <Button
          variant="outline"
          size="pill-38"
          className="px-3.5"
          disabled={letter.busy}
          onClick={() => void letter.respondToProposal(false)}
        >
          {LETTER_STATE_COPY.approverDecline}
        </Button>
      </div>
    </div>
  );
}

/**
 * 누가 승인할지 고르는 작은 칸(D-76). 두 사람 각자와 "두 분 모두" 가운데 고른다. 고르기 전에는 한 분이 승인하면
 * 두 분 모두에게 알린다는 줄을 보인다. 바꾸면 앞 승인은 세지 않는다(서버가 판 번호를 올린다).
 *
 * 상대가 아직 들어오지 않았으면(회원이 한 명) 고를 수 없다고 말한다 — 서버도 그때는 바꾸기를 받지 않는다.
 * 확인을 기다리는 제안이 있으면 제안한 방식을 점선으로 두고 아래에 제안 칸을 보인다.
 */
function ApproverPicker({ letter }: { letter: InvitationLetterState }) {
  const headingId = useId();
  const approver = letter.approver;
  if (!approver) return null;
  const { setting, members, pending } = approver;
  const heading = (
    <h2 id={headingId} className="text-[13px] text-inv-muted">
      {LETTER_STATE_COPY.approverHeading}
    </h2>
  );
  if (members.length < 2) {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-2" data-letter-approver="unavailable">
        {heading}
        <p className="text-[12px] leading-[1.5] text-inv-muted">{LETTER_STATE_COPY.approverUnavailable}</p>
      </section>
    );
  }
  const proposed = (mode: InquiryApproverMode, memberId: string | null) =>
    Boolean(pending && pending.mode === mode && (mode !== "designated" || pending.designatedUserId === memberId));
  const variantOf = (on: boolean, isProposed: boolean) => (on ? "ink" : isProposed ? "dashed" : "outline");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-letter-approver>
      {heading}
      <div className="flex flex-wrap gap-2">
        {members.map((member) => {
          const on = setting.mode === "designated" && setting.designatedUserId === member.id;
          return (
            <Button
              key={member.id}
              variant={variantOf(on, proposed("designated", member.id))}
              size="pill-38"
              className="px-3.5"
              aria-pressed={on}
              disabled={letter.busy}
              onClick={() => void letter.chooseApprover("designated", member.id)}
            >
              {LETTER_STATE_COPY.approverPerson(memberLabel(member))}
            </Button>
          );
        })}
        <Button
          variant={variantOf(setting.mode === "both", proposed("both", null))}
          size="pill-38"
          className="px-3.5"
          aria-pressed={setting.mode === "both"}
          disabled={letter.busy}
          onClick={() => void letter.chooseApprover("both")}
        >
          {LETTER_STATE_COPY.approverBoth}
        </Button>
      </div>
      {letter.approverLine ? <p className="text-[12px] leading-[1.5] text-inv-muted">{letter.approverLine}</p> : null}
      <ApproverProposal letter={letter} />
    </section>
  );
}

/** 알려줄 휴대폰 번호를 켰는데 저장된 번호가 없을 때 적는 칸. 서버는 가린 번호만 돌려준다. */
function PhoneField({ letter }: { letter: InvitationLetterState }) {
  const inputId = useId();
  return (
    <div className="flex flex-col gap-1.5" data-letter-phone>
      <label htmlFor={inputId} className="text-[13px] text-inv-muted">
        {LETTER_COPY.shares.phone}
      </label>
      <input
        id={inputId}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        maxLength={20}
        value={letter.phone}
        onChange={(event) => letter.setPhone(event.target.value)}
        className="h-11 rounded-[14px] border-none bg-inv-paper-soft px-4 text-[15px] text-inv-ink shadow-[inset_0_0_0_1px_#EEEAE6] outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]"
      />
    </div>
  );
}

/**
 * 보내기 전 편지 확인(`/halls/letter`) 실제 커플 화면(`Approve.dc`).
 *
 * 편지와 함께 알려줄 정보를 고치면 보내기 전에 새 판을 저장하고, 보내기는 그 판을 승인한다. 그 사이 다른 사람이
 * 편지를 바꿨으면(409) 바뀐 편지를 다시 읽어 다시 확인하게 한다. 문의 보내기가 꺼져 있으면 승인만 저장됐고 업체에
 * 가지 않았다고 사실대로 말한다.
 */
export default function LiveLetter() {
  const identity = useLiveIdentity();
  const letter = useInvitationLetter(identity);

  if (identity.isDemo) return <DemoLetter />;
  if (letter.loading) return <LiveLoadingScreen back={BACK_TO_HALLS} />;
  if (letter.failed) {
    return (
      <LiveColumn>
        <LiveMessageScreen
          back={BACK_TO_HALLS}
          tone="error"
          text={loadFailedMessage(letter.failure, LETTER_STATE_COPY.loadFailed)}
          action={{ label: LIVE_RETRY_LABEL, onClick: letter.reload }}
        />
      </LiveColumn>
    );
  }
  if (letter.needShortlist || !letter.model) {
    return (
      <LiveColumn>
        <LiveMessageScreen back={BACK_TO_HALLS} text={LETTER_STATE_COPY.needShortlist} />
      </LiveColumn>
    );
  }

  return (
    <InvitationLetterSheet
      model={letter.model}
      resolveRoute={liveRoute}
      onToggleShare={letter.toggleShare}
      onSend={() => void letter.send()}
      onEditText={letter.startEditing}
      photoSrc={livePhotoSrc}
      editor={
        letter.editing ? (
          <textarea
            aria-label={LETTER_COPY.editText}
            value={letter.body}
            maxLength={1000}
            rows={7}
            // 고치기를 누른 사람이 바로 쓸 수 있게 글 칸으로 초점을 옮긴다.
            autoFocus
            onChange={(event) => letter.setBody(event.target.value)}
            className="w-full resize-y rounded-[6px] border-none bg-inv-white/60 p-2 font-inv-serif text-[15px] leading-[1.85] text-inv-letter shadow-[inset_0_0_0_1px_#ECE6DF] outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)]"
          />
        ) : undefined
      }
      extra={
        <div className="flex flex-col gap-[18px]">
          {letter.needsPhone ? <PhoneField letter={letter} /> : null}
          <ApproverPicker letter={letter} />
          {letter.notice ? <LiveNotice tone={letter.notice.tone}>{letter.notice.text}</LiveNotice> : null}
        </div>
      }
      sendDisabled={!letter.canSend}
      sendBusy={letter.busy}
    />
  );
}
