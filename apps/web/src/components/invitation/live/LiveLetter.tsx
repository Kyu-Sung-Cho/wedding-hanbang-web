"use client";

import { useId, useState } from "react";
import {
  EXAMPLE_LETTER,
  FIRST_CHAT_COPY,
  LETTER_COPY,
  LETTER_STATE_COPY,
  SELF_SEND_COPY,
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
import SelfSendPanel from "./SelfSendPanel";
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
 * 직접 보내기(D-83 1단계)의 시트 글자. 두 분이 폰에서 보내므로 "보낼까요?" 대신 직접 보내 달라고 하고, 아래 단추는
 * 판을 저장만 한다. 상대가 읽었다는 줄(같은 편지를 두 번 보내지 않는다는 약속)은 숨긴다. "저장하고 있어요"는
 * 저장하는 동안만이다(승인 방식 제안에 답하는 동안에는 저장한다고 말하지 않는다).
 */
function selfSendSheetText(letter: InvitationLetterState) {
  return {
    title: SELF_SEND_COPY.title(letter.model?.recipients.length ?? 0),
    sendLabel: letter.preparing ? SELF_SEND_COPY.saving : SELF_SEND_COPY.save,
    hidePartnerRead: true,
  };
}

/**
 * 보내기 전 편지 확인(`/halls/letter`) 실제 커플 화면(`Approve.dc`).
 *
 * 편지와 함께 알려줄 정보를 고치면 보내기 전에 새 판을 저장하고, 보내기는 그 판을 승인한다. 그 사이 다른 사람이
 * 편지를 바꿨으면(409) 바뀐 편지를 다시 읽어 다시 확인하게 한다. 문의 보내기가 꺼져 있으면 승인만 저장됐고 업체에
 * 가지 않았다고 사실대로 말한다.
 *
 * 커플이 직접 보내기(D-83 1단계)가 켜진 서버(편지 응답에 `selfSend` 칸이 있다)에서는 승인 칸을 그리지 않고, 아래 단추가
 * 판을 저장만 한다. 저장한 판의 보낼 글과 복사·공유·문자 단추는 `SelfSendPanel` 이 그린다. 다만 이 단계 전에 상대가 낸
 * 승인 방식 제안이 남아 있고 내가 답할 수 있으면 그 제안의 바꾸기·두기만 그린다(서버는 확인·거절 길을 열어 둔다. 상대의
 * 알림이 답할 곳 없는 화면으로 오지 않게). 칸이 없으면 예전 그대로다.
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

  const selfSendMode = letter.selfSendMode;
  return (
    <InvitationLetterSheet
      model={letter.model}
      resolveRoute={liveRoute}
      onToggleShare={letter.toggleShare}
      onSend={selfSendMode ? () => void letter.prepare() : () => void letter.send()}
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
          {selfSendMode ? (
            <SelfSendPanel
              selfSend={letter.selfSend}
              dirty={letter.dirty}
              hasSavedLetter={Boolean(letter.state?.letterId)}
              missingConditions={letter.missingConditions}
              // 저장하거나 아래 제안에 답하는 동안에도 같은 줄을 둔다(앱과 같다). 저장할 수 없는 편지에는 그 사이에도 없다.
              canSave={letter.needsSave}
              preparedCount={letter.preparedCount}
            />
          ) : (
            <ApproverPicker letter={letter} />
          )}
          {selfSendMode && letter.approver?.pending?.viewerCanRespond ? <ApproverProposal letter={letter} /> : null}
          {letter.notice ? <LiveNotice tone={letter.notice.tone}>{letter.notice.text}</LiveNotice> : null}
        </div>
      }
      sendDisabled={selfSendMode ? !letter.canPrepare : !letter.canSend}
      // 직접 보내기의 기다림 표시는 저장하는 동안만이다(위 `selfSendSheetText` 와 같은 까닭). 꺼진 서버는 예전 그대로다.
      sendBusy={selfSendMode ? letter.preparing : letter.busy}
      {...(selfSendMode ? selfSendSheetText(letter) : {})}
    />
  );
}
