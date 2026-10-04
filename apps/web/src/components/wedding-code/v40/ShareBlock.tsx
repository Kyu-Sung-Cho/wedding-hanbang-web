"use client";

import { Send } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import Button from "@/components/ui/Button";
import { V40_COPY, V40_COUPLE_SEND_EXTRA_COPY } from "@/lib/weddingCode/v40/copy";
import { browserShareEnv, sendLink, sentEventOf, type ShareEnv, type ShareOutcome, type ShareSentEvent } from "./shareActions";
import { bodyText, buttonFocusFix, card, cardSelected, cx, focusRing, noteText, noticeBox } from "./styles";

// ---------------------------------------------------------------------------
// 보내기 블록이 함께 쓰는 조각 (TwoPersonSendBlock 도 가져다 쓴다)
// ---------------------------------------------------------------------------

/** 화면 제목(레벨 2)과 절 제목(레벨 3)의 모양. */
const headingClass = {
  2: "text-xl font-semibold leading-snug text-[var(--hb-text-strong)]",
  3: "text-base font-semibold leading-snug text-[var(--hb-text-strong)]",
} as const;

export function SectionHeading({ level, id, children }: { readonly level: 2 | 3; readonly id: string; readonly children: ReactNode }) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className={headingClass[level]}>
      {children}
    </Tag>
  );
}

/** 링크를 보내려던 일의 지금 상태. idle 이면 안내 글이 비어 있다. */
export type SendStatus = "idle" | "linkFailed" | "shared" | "copied" | "revealed";

/** 상태에 맞는 한 줄. 공유 창을 마친 것과 클립보드에 복사한 것은 다르게 말한다. */
export function sendStatusText(status: SendStatus): string {
  switch (status) {
    case "linkFailed":
      return V40_COPY.send.linkFailed;
    case "shared":
      return V40_COUPLE_SEND_EXTRA_COPY.sharedSheet;
    case "copied":
      return V40_COPY.send.copied;
    case "revealed":
      return V40_COPY.send.manualCopy;
    default:
      return "";
  }
}

/**
 * 링크 보내기 한 번을 맡는 훅. 주소 만들기는 부르는 쪽이 하고(주소가 화면 글에 미리 들어가지 않게 누를 때만 만든다),
 * 여기서는 sendLink 를 부르고 결과를 상태 글과 주소 칸으로 바꾸며 부모에게 사건을 알린다.
 * 보내는 중에 다시 눌러도 한 번만 보낸다. 공유 창이 사용자 동작 직후에만 열려서, run 은 첫 await 이전에 sendLink 를 부른다.
 */
export function useLinkSender(onSent: (event: ShareSentEvent) => void, env?: ShareEnv) {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (url: string | null, text: string): Promise<void> => {
    if (busyRef.current) return;
    if (url === null || url === "") {
      setRevealedUrl(null);
      setStatus("linkFailed");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setStatus("idle");
    setRevealedUrl(null);
    let outcome: ShareOutcome;
    try {
      outcome = await sendLink({ url, text, title: V40_COPY.send.sheetTitle }, env ?? browserShareEnv());
    } catch {
      outcome = { kind: "revealed", reason: "failed" };
    }
    busyRef.current = false;
    setBusy(false);
    if (outcome.kind === "revealed") {
      setRevealedUrl(url);
      setStatus("revealed");
    } else if (outcome.kind === "cancelled") {
      setStatus("idle");
    } else {
      setStatus(outcome.kind);
    }
    const event = sentEventOf(outcome);
    if (event !== null) onSent(event);
  };

  /** 보낼 내용이 바뀌었을 때(라디오를 바꿈) 이전 결과와 주소 칸을 치운다. */
  const reset = () => {
    setStatus("idle");
    setRevealedUrl(null);
  };

  return { status, revealedUrl, busy, run, reset };
}

const focusWithinRing =
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--hb-focus-ring)] has-[:focus-visible]:ring-offset-2";

const fieldClass = cx(
  "mt-1 block w-full rounded-lg border border-paper-outline bg-[var(--hb-surface-raised)] px-3 py-2",
  "text-[16px] leading-relaxed text-[var(--hb-text-strong)]",
  focusRing,
);

/** 체크 한 줄. 진짜 체크 상자이고 글이 무엇에 동의하는지 그대로 말한다. 줄 전체가 눌리고 높이 44픽셀 이상이다. */
export function ConsentCheck({
  checked,
  onChange,
  inputRef,
  children,
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly children: ReactNode;
}) {
  return (
    <label className={cx(card, "flex min-h-11 cursor-pointer items-start gap-3 p-3", focusWithinRing)}>
      <input
        ref={inputRef}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]"
      />
      <span className={cx(bodyText, "min-w-0")}>{children}</span>
    </label>
  );
}

/** 고쳐 쓸 수 있는 보낼 말. 글자 크기 16픽셀이라 휴대폰이 확대하지 않는다. */
export function MessageField({
  id,
  label,
  value,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className={cx(noteText, "font-medium")}>
        {label}
      </label>
      <textarea id={id} rows={5} value={value} onChange={(event) => onChange(event.target.value)} className={cx(fieldClass, "resize-y")} />
    </div>
  );
}

/**
 * 링크 보내기 단추. 막힌 동안에도 disabled 속성을 쓰지 않고 aria-disabled 와 이유 글(reasonId)로 알린다.
 * 막힌 채로 눌러도 아무것도 보내지 않는다(누르는 쪽 onClick 이 막힘을 확인한다).
 */
export function SendButton({
  label,
  blocked,
  busy,
  reasonId,
  onClick,
}: {
  readonly label: string;
  readonly blocked: boolean;
  readonly busy: boolean;
  readonly reasonId?: string;
  readonly onClick: () => void;
}) {
  return (
    <Button
      variant="primary"
      fullWidth
      aria-disabled={blocked}
      aria-busy={busy || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      onClick={onClick}
      className={cx(buttonFocusFix, "aria-disabled:cursor-not-allowed aria-disabled:opacity-60")}
    >
      <Send aria-hidden="true" className="size-4 shrink-0" />
      <span>{label}</span>
    </Button>
  );
}

/** 결과 한 줄. 처음부터 문서에 있어야 낭독기가 바뀐 글을 읽는다(비어 있어도 그린다). */
export function SendStatusLine({ id, status }: { readonly id: string; readonly status: SendStatus }) {
  const text = sendStatusText(status);
  return (
    <p id={id} role="status" aria-live="polite" className={cx(noteText, text !== "" && cx("mt-3", noticeBox, "font-medium text-[var(--hb-text-strong)]"))}>
      {text}
    </p>
  );
}

/**
 * 공유 창도 클립보드도 안 될 때 열리는 읽기 전용 주소 칸. 열리면 초점이 가고 글이 모두 선택돼 길게 눌러 복사할 수 있다.
 * 주소는 이 칸이 열릴 때만 화면에 나온다.
 */
export function AddressField({ id, url, describedBy }: { readonly id: string; readonly url: string; readonly describedBy?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, [url]);
  return (
    <div className="mt-3">
      <label htmlFor={id} className={cx(noteText, "font-medium")}>
        {V40_COPY.send.addressLabel}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        readOnly
        value={url}
        inputMode="url"
        spellCheck={false}
        autoCapitalize="off"
        aria-describedby={describedBy}
        onFocus={(event) => event.currentTarget.select()}
        className={fieldClass}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 혼자 결과의 상대에게 보내기
// ---------------------------------------------------------------------------

export type SendOption = "withAnswers" | "questionsOnly";

export interface ShareBlockSentEvent extends ShareSentEvent {
  /** 어느 라디오로 보냈나. */
  readonly option: SendOption;
}

export interface ShareBlockProps {
  /**
   * 라디오에 맞는 링크를 만든다(누를 때만 부른다). 만들 수 없으면 null(코드가 없는 응답 등).
   * 이 컴포넌트는 코덱도 window 도 모른다. 내 답과 함께 보내기는 답이 든 주소, 질문만 보내기는 답 없는 주소를 돌려준다.
   */
  readonly buildUrl: (option: SendOption) => string | null;
  /**
   * 링크를 실제로 보냈을 때 부른다. kind 는 shared(공유 창을 마침), copied(클립보드에 복사함), revealed(주소 칸을 열었음).
   * 사람이 공유 창을 닫은 경우는 부르지 않는다. 이용 통계 wedding_code_share_copied 는 kind 가 copied 일 때만 보낸다.
   */
  readonly onSent: (event: ShareBlockSentEvent) => void;
  /** 시험용 공유 환경. 없으면 지금 브라우저의 공유 창과 클립보드. */
  readonly env?: ShareEnv;
  /** 한 화면 안에서 겹치지 않는 접두어. 없으면 자동. */
  readonly idPrefix?: string;
  /** 제목 레벨. 기본 2. */
  readonly headingLevel?: 2 | 3;
  /**
   * 링크에 서로 짐작해 보기(4.1 단계 2)의 고른 쪽과 짐작이 든다는 한 줄. 「내 답과 함께 보내기」를 고른 동안에만 안내 묶음에 그린다
   * (「질문만 보내기」의 링크에는 짐작이 들지 않는다). 문구는 부모가 준다(이 화면은 트랙 폴더를 가져오지 않는다). 없으면 그리지 않는다.
   */
  readonly guessNote?: string;
}

const OPTIONS = [
  { value: "withAnswers", label: V40_COPY.send.withAnswersOption, help: V40_COPY.send.withAnswersHelp },
  { value: "questionsOnly", label: V40_COPY.send.questionsOnlyOption, help: V40_COPY.send.questionsOnlyHelp },
] as const;

/**
 * 상대에게 보내기(혼자 결과의 블록). 링크 단추는 하나뿐이고, 무엇이 가는지는 위의 라디오 둘이 고른다.
 * - 내 답과 함께 보내기(처음 골라져 있음): 체크를 켜기 전에는 단추가 aria-disabled 이고 이유 글이 보인다. 이 라디오의 도움말이
 *   상대가 두 사람 결과 링크를 다시 보내 줘야 나도 두 사람 결과를 볼 수 있다는 사실을 말한다(두 라디오의 도움말은 늘 보인다).
 *   링크를 되돌릴 수 없고 예전 링크가 남는다는 안내(withAnswersLinkInfo)도 이 선택에서만 보인다.
 * - 질문만 보내기: 답이 없어서 체크가 없고 되돌릴 수 없다는 안내도 없다.
 * - 보낼 말은 고쳐 쓸 수 있고 라디오마다 따로 남는다. 내 글자는 넣지 않는다.
 * - 공유 창이 안 되면 클립보드, 그것도 안 되면 읽기 전용 주소 칸이 열린다.
 * 서버 요청이 없다. 링크는 누를 때만 만들어져서 그 전에는 화면에 주소가 없다.
 */
export function ShareBlock({ buildUrl, onSent, env, idPrefix, headingLevel = 2, guessNote }: ShareBlockProps) {
  const uid = useId();
  const prefix = idPrefix ?? `wc40-share${uid}`;
  const ids = {
    title: `${prefix}-title`,
    message: `${prefix}-message`,
    reason: `${prefix}-reason`,
    status: `${prefix}-status`,
    address: `${prefix}-address`,
  } as const;

  const [option, setOption] = useState<SendOption>("withAnswers");
  const [consent, setConsent] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<SendOption, string>>>({
    withAnswers: V40_COPY.send.messageWithAnswers,
    questionsOnly: V40_COPY.send.messageQuestionsOnly,
  });
  const consentRef = useRef<HTMLInputElement>(null);
  const sender = useLinkSender((event) => onSent({ ...event, option }), env);
  const blocked = option === "withAnswers" && !consent;

  const chooseOption = (next: SendOption) => {
    if (next === option) return;
    setOption(next);
    sender.reset();
  };

  const send = () => {
    if (blocked) {
      consentRef.current?.focus();
      return;
    }
    let url: string | null;
    try {
      url = buildUrl(option);
    } catch {
      url = null;
    }
    void sender.run(url, drafts[option]);
  };

  return (
    <section aria-labelledby={ids.title} className={cx(card, "p-4")}>
      <SectionHeading level={headingLevel} id={ids.title}>
        {V40_COPY.send.title}
      </SectionHeading>

      <fieldset className="mt-3 min-w-0 border-0 p-0">
        <legend className={cx(noteText, "font-medium")}>{V40_COPY.send.groupLabel}</legend>
        <div className="mt-2 space-y-2">
          {OPTIONS.map((entry) => {
            const selected = entry.value === option;
            const helpId = `${prefix}-${entry.value}-help`;
            return (
              <label key={entry.value} className={cx(card, selected && cardSelected, "flex min-h-12 cursor-pointer items-start gap-3 p-3", focusWithinRing)}>
                <input
                  type="radio"
                  name={`${prefix}-option`}
                  value={entry.value}
                  checked={selected}
                  onChange={() => chooseOption(entry.value)}
                  aria-describedby={helpId}
                  className="mt-0.5 size-5 shrink-0 accent-[var(--hb-action)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--hb-text-strong)]">{entry.label}</span>
                  <span id={helpId} className={cx(noteText, "mt-0.5 block")}>
                    {entry.help}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {option === "withAnswers" ? (
        <div className="mt-3">
          <ConsentCheck inputRef={consentRef} checked={consent} onChange={setConsent}>
            {V40_COPY.send.consent}
          </ConsentCheck>
        </div>
      ) : null}

      <div className="mt-4">
        <MessageField
          id={ids.message}
          label={V40_COPY.send.messageLabel}
          value={drafts[option]}
          onChange={(value) => setDrafts((current) => ({ ...current, [option]: value }))}
        />
      </div>

      <div className={cx(noteText, "mt-4 space-y-1")}>
        <p>{V40_COPY.send.shareSheetInfo}</p>
        {option === "withAnswers" ? <p>{V40_COPY.send.withAnswersLinkInfo}</p> : null}
        {option === "withAnswers" && guessNote ? <p data-send-guess-note="">{guessNote}</p> : null}
      </div>

      <div className="mt-4">
        <SendButton label={V40_COPY.send.sendButton} blocked={blocked} busy={sender.busy} reasonId={ids.reason} onClick={send} />
        {blocked ? (
          <p id={ids.reason} className={cx(noteText, "mt-2")}>
            {V40_COPY.send.disabledReason}
          </p>
        ) : null}
      </div>

      <SendStatusLine id={ids.status} status={sender.status} />
      {sender.revealedUrl !== null ? <AddressField id={ids.address} url={sender.revealedUrl} describedBy={ids.status} /> : null}
    </section>
  );
}

export default ShareBlock;
