"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { LETTER_COPY, type LetterModel, type LetterShare } from "@hanbang/shared/invitation";

import AmoraOrb from "@/components/ui/AmoraOrb";
import Button from "@/components/ui/Button";

import {
  INVITATION_TEXT_FLOW,
  cx,
  defaultInvitationPhotoSrc,
  type InvitationPhotoResolver,
  type InvitationRouteResolver,
} from "./invitationScreen";

type InvitationLetterSheetProps = {
  model: LetterModel;
  resolveRoute: InvitationRouteResolver;
  /** 편지와 함께 알려줄 정보 스위치. 값은 부모가 바꾼다. */
  onToggleShare: (key: LetterShare["key"]) => void;
  /** 있으면 보내기 단추가 이 일을 하고, 없으면 상담 확정 화면으로 가는 링크다. */
  onSend?: () => void;
  /** 있으면 "나중에 할게요"와 Esc 가 이 일을 하고, 없으면 비교 화면으로 가는 링크다. */
  onLater?: () => void;
  onEditText?: () => void;
  photoSrc?: InvitationPhotoResolver;
  /** 실제 커플: "문구 고치기"를 누른 뒤 편지 글 자리에 대신 그리는 글 고치기 칸. */
  editor?: ReactNode;
  /**
   * 실제 커플: 알려줄 정보 아래에 더 그릴 것(새 휴대폰 번호 칸, 누가 승인할지 고르는 칸, 승인·보내기 상태 한 줄,
   * 직접 보내기에서는 받는 곳마다 보낼 글). 예시 커플은 넘기지 않아 아티팩트 모양 그대로다.
   */
  extra?: ReactNode;
  /** 실제 커플: 이미 보냈거나 이 판을 이미 승인했으면 보내기를 잠근다. 보내는 중이면 기다림 표시를 한다. */
  sendDisabled?: boolean;
  sendBusy?: boolean;
  /**
   * 실제 커플(직접 보내기, D-83 1단계): 제목과 아래 단추의 글자를 바꾼다. 두 분이 폰에서 직접 보내므로
   * "보낼까요?"·"보내기"라고 묻지 않는다. 없으면 아티팩트 문구 그대로다.
   */
  title?: string;
  sendLabel?: string;
  /** 실제 커플(직접 보내기): 상대가 읽었다는 줄을 숨긴다. 그 줄의 "두 번 보내지 않아요" 약속을 직접 보낼 때는 지킬 수 없다. */
  hidePartnerRead?: boolean;
  className?: string;
};

/**
 * 스위치 줄. 켜면 먹색 길에 손잡이가 오른쪽, 끄면 돌빛 길에 왼쪽.
 * 아티팩트의 최소 높이 52px 는 아래 선 1px 을 뺀 값이라(content-box) 바깥 높이는 53px 이다.
 */
function ShareRow({ share, onToggle }: { share: LetterShare; onToggle: () => void }) {
  return (
    <div className="flex min-h-[53px] items-center justify-between border-b border-inv-row-line" data-share={share.key}>
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px]">{share.label}</span>
        <span className="text-[12px] text-inv-muted">{share.on ? share.value : LETTER_COPY.notShared}</span>
      </div>
      <Button
        role="switch"
        aria-checked={share.on}
        aria-label={LETTER_COPY.switchLabel(share.label)}
        variant={share.on ? "ink" : "plain"}
        size="pill-34"
        // 공유 버튼에 52×32 스위치가 없어서 길의 높이·반경·여백·손잡이 쪽만 덮는다.
        className={cx(
          "h-8! w-[52px] flex-none rounded-[16px]! p-[3px]",
          share.on ? "justify-end!" : "justify-start! bg-inv-switch-off!",
        )}
        onClick={onToggle}
      >
        <span className="size-[26px] rounded-[13px] bg-inv-white shadow-[0_1px_3px_rgba(0,0,0,0.18)]" />
      </Button>
    </div>
  );
}

/**
 * 보내기 전 편지 확인(`Approve.dc`, 390×960). 어두운 바탕에 홀 사진을 흐리게 깔고, 아래에서
 * 올라온 시트에 업체에 보낼 편지와 함께 알려줄 정보를 보인다. 보내기 전에 두 사람이 읽는
 * 확인 단계라서, 화면을 열면 시트로 초점을 옮기고 Esc 는 "나중에 할게요"와 같다.
 *
 * 아티팩트와 다른 점(이유): 넓은 화면에서 시트 폭을 480px 로 묶는다. 390 폭 폰에서는 같다.
 */
export default function InvitationLetterSheet({
  model,
  resolveRoute,
  onToggleShare,
  onSend,
  onLater,
  onEditText,
  photoSrc = defaultInvitationPhotoSrc,
  editor,
  extra,
  sendDisabled = false,
  sendBusy = false,
  title,
  sendLabel,
  hidePartnerRead = false,
  className,
}: InvitationLetterSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const laterRef = useRef<HTMLAnchorElement>(null);
  const count = model.recipients.length;
  const backdrop = model.backdropPhoto ? photoSrc(model.backdropPhoto) : null;
  const sendText = sendLabel ?? LETTER_COPY.send(count);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (onLater) onLater();
    else laterRef.current?.click();
  }

  return (
    <div
      className={cx(
        "relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden bg-inv-sheet-backdrop font-inv-sans leading-[normal] text-inv-ink",
        INVITATION_TEXT_FLOW,
        className,
      )}
      data-invitation-screen="letter"
    >
      {backdrop ? (
        // eslint-disable-next-line @next/next/no-img-element -- 흐리게 까는 바탕 사진이라 원본을 그대로 쓴다
        <img src={backdrop} alt="" className="absolute inset-0 h-full! w-full object-cover opacity-55" />
      ) : null}

      <section
        ref={dialogRef}
        role="dialog"
        aria-label={LETTER_COPY.dialogLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-invitation-scroll
        className="scrollbar-hide relative mx-auto flex min-h-0 w-full max-w-[480px] flex-col gap-[18px] overflow-y-auto rounded-t-[34px] bg-inv-white px-[22px] pt-2.5 pb-6 outline-none"
      >
        <span aria-hidden="true" className="h-[5px] w-[38px] self-center rounded-[3px] bg-inv-chip-line" />
        <div className="flex items-center gap-3">
          <AmoraOrb size={44} mood="calm" />
          <h1 className="text-[18px] leading-[1.45] font-bold">{title ?? LETTER_COPY.title(count)}</h1>
        </div>

        <article className="flex flex-col gap-3 rounded-[6px] bg-inv-paper px-[22px] pt-[22px] pb-[18px] shadow-[0_1px_2px_rgba(30,28,34,0.06),0_10px_28px_rgba(30,28,34,0.08)]">
          <div className="flex items-baseline justify-between">
            <span className="font-inv-serif text-[15px]">{LETTER_COPY.to(model.recipients)}</span>
            <span className="font-inv-numeral text-[16px] text-inv-gold-ink italic">{model.dateLabel}</span>
          </div>
          {editor ?? <p className="font-inv-serif text-[15px] leading-[1.85] text-inv-letter">{model.body}</p>}
          <div className="flex items-center justify-between border-t border-inv-letter-rule pt-2.5">
            <span className="font-inv-serif text-[14px]">{model.signature}</span>
            <Button
              variant="plain"
              size="pill-34"
              weight="medium"
              // 공유 버튼에 36px 글자 단추가 없어서 높이와 금빛 글자만 덮는다.
              className="h-9! px-0.5 text-inv-gold-ink! underline"
              onClick={onEditText}
            >
              {LETTER_COPY.editText}
            </Button>
          </div>
        </article>

        <div className="flex flex-col">
          <span className="pb-0.5 text-[13px] text-inv-muted">{LETTER_COPY.sharesHeading}</span>
          {model.shares.map((share) => (
            <ShareRow key={share.key} share={share} onToggle={() => onToggleShare(share.key)} />
          ))}
        </div>

        {extra}

        {model.partnerApprovedName && !hidePartnerRead ? (
          <p className="text-[13px] leading-[1.6] text-inv-body">{LETTER_COPY.partnerRead(model.partnerApprovedName)}</p>
        ) : null}

        <div className="flex flex-col gap-1">
          {onSend ? (
            <Button
              variant="ink"
              size="pill-56"
              weight="bold"
              fullWidth
              onClick={onSend}
              disabled={sendDisabled}
              loading={sendBusy}
            >
              {sendText}
            </Button>
          ) : (
            <Button href={resolveRoute("status")} variant="ink" size="pill-56" weight="bold" fullWidth>
              {sendText}
            </Button>
          )}
          {onLater ? (
            <Button variant="text" size="pill-44" fullWidth onClick={onLater}>
              {LETTER_COPY.later}
            </Button>
          ) : (
            <Button ref={laterRef} href={resolveRoute("compare")} variant="text" size="pill-44" fullWidth>
              {LETTER_COPY.later}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
