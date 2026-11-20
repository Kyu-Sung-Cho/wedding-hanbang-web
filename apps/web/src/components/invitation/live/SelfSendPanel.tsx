"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { SELF_SEND_COPY, type LetterSelfSend, type LetterSelfSendMessage } from "@hanbang/shared/invitation";

import Button from "@/components/ui/Button";

import { cx } from "../invitationScreen";
import { liveConditionsHref, liveRoute } from "./liveRoutes";
import {
  browserSmsPlatform,
  copyText,
  hallSearchHref,
  shareText,
  smsHref,
  type ShareOutcome,
  type SmsPlatform,
} from "./selfSendActions";
import type { LetterConditionKey } from "./useInvitationLetter";

/**
 * 편지를 두 분 폰에서 직접 보내기(D-83 1단계, 2026-11-18). 편지 시트의 `extra` 칸에 그린다.
 *
 * 보낼 글은 서버가 저장한 판으로 엮어 준 글 그대로다. 화면은 글을 고쳐 쓰지 않고(고치려면 위 편지를 고쳐 다시
 * 저장한다), 아모라는 아무 데도 보내지 않는다. 단추는 복사, 공유 창, 문자 앱, 네이버 찾아보기까지만 한다. 그래서
 * 어느 줄도 보냈다고 말하지 않는다. 받는 번호와 업체 연락처는 아모라가 모르므로 사람이 넣는다.
 *
 * 글은 화면 글자로만 둔다. 오류 보고의 클릭 흔적이 싣는 이름표 속성(aria-label·title·alt·name)에는 넣지 않는다.
 * 문자 앱 주소(href)에는 들어가는데, 클릭 흔적은 그 속성을 적지 않는다.
 */

/** `copiedInstead`: 공유 창이 없거나 열리지 않아 대신 글을 복사했다(그냥 복사한 `copied` 와 말이 다르다). */
type FeedbackKind = "copied" | "copiedInstead" | "copyFailed" | "shareOpened" | "smsOpened";
type Feedback = { hallId: string; kind: FeedbackKind };

const FEEDBACK_TEXT: Readonly<Record<FeedbackKind, string>> = {
  copied: SELF_SEND_COPY.copied,
  copiedInstead: SELF_SEND_COPY.copiedInstead,
  copyFailed: SELF_SEND_COPY.copyFailed,
  shareOpened: SELF_SEND_COPY.shareOpened,
  smsOpened: SELF_SEND_COPY.smsOpened,
};

const noSubscribe = () => () => {};
const standardSmsPlatform = (): SmsPlatform => "other";

/** 문자 앱 주소 꼴. 서버 렌더에서는 표준 꼴이고, 브라우저에서는 그 기기의 꼴(iOS 는 따로)을 읽는다. */
function useSmsPlatform(): SmsPlatform {
  return useSyncExternalStore(noSubscribe, browserSmsPlatform, standardSmsPlatform);
}

/**
 * 문자 앱을 열 수 있는 기기(폰·태블릿)인가. 컴퓨터(`other`)에서 문자 앱 주소는 대개 아무것도 열지 않으므로, 그때는
 * "문자로 열기" 단추를 두지 않는다(열었다고 말할 수 없는 단추를 두지 않는다). 서버 렌더도 `other` 라 단추가 없다.
 */
function opensSmsApp(platform: SmsPlatform): boolean {
  return platform === "ios" || platform === "android";
}

function SelfSendMessageCard({
  message,
  platform,
  feedback,
  onCopy,
  onShare,
  onSms,
}: {
  message: LetterSelfSendMessage;
  platform: SmsPlatform;
  feedback: FeedbackKind | null;
  onCopy: () => void;
  onShare: () => void;
  onSms: () => void;
}) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-2.5 rounded-[18px] bg-inv-paper-soft p-3.5"
      data-self-send-message={message.hallId}
    >
      <h2 id={headingId} className="text-[13px] text-inv-muted">
        {SELF_SEND_COPY.messageFor(message.name)}
      </h2>
      {/* 서버가 엮은 글 그대로. 줄을 지키고 고를 수 있게 둔다(길게 눌러 복사하는 사람도 있다). 드문 글자도 보이게 본문 글꼴로 쓴다. */}
      <p className="font-inv-sans text-[14px] leading-[1.7] whitespace-pre-wrap text-inv-ink select-text" data-self-send-text>
        {message.text}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="ink" size="pill-38" weight="bold" className="px-3.5" onClick={onCopy}>
          {SELF_SEND_COPY.copy}
        </Button>
        <Button variant="outline" size="pill-38" className="px-3.5" onClick={onShare}>
          {SELF_SEND_COPY.share}
        </Button>
        {opensSmsApp(platform) ? (
          <Button href={smsHref(message.text, platform)} variant="outline" size="pill-38" className="px-3.5" onClick={onSms}>
            {SELF_SEND_COPY.sms}
          </Button>
        ) : null}
        <Button
          href={hallSearchHref(message.name)}
          target="_blank"
          rel="noopener noreferrer"
          variant="text"
          size="pill-38"
          className="px-1.5 underline"
        >
          {SELF_SEND_COPY.findHall}
        </Button>
      </div>
      <p
        role="status"
        className={cx("text-[12px] leading-[1.5]", feedback === "copyFailed" ? "text-inv-warn" : "text-inv-body")}
        data-self-send-feedback
      >
        {feedback ? FEEDBACK_TEXT[feedback] : null}
      </p>
    </article>
  );
}

/**
 * 공유를 누른 결과 한 줄. `shareText` 가 "copied" 를 주는 것은 공유 창 대신 복사로 넘어갔을 때뿐이다(공유 창이 없거나
 * 열리지 않았거나 실패했다). 그때는 그냥 복사했다고 하지 않고 앱을 열지 못해 복사했다고 말한다. 공유 창이 끝까지
 * 갔거나 사람이 닫았으면 줄이 없다(`null`, 앱을 고르라는 줄을 거둔다).
 */
function shareFeedback(outcome: ShareOutcome): FeedbackKind | null {
  if (outcome === "copied") return "copiedInstead";
  if (outcome === "copyFailed") return "copyFailed";
  return null;
}

/**
 * 받는 곳마다 보낼 글과 단추. 단추가 한 일의 한 줄은 마지막으로 누른 곳 아래에만 보인다. 첫 줄(`introRef`)은 저장한 뒤
 * 글이 나타나면 초점을 받는 자리다(화면 읽기 프로그램이 글이 나왔다고 읽고, 잠긴 저장 단추에 초점이 남지 않는다).
 */
function SelfSendMessages({ selfSend, introRef }: { selfSend: LetterSelfSend; introRef: RefObject<HTMLParagraphElement | null> }) {
  const platform = useSmsPlatform();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const show = (hallId: string, kind: FeedbackKind) => setFeedback({ hallId, kind });
  // 공유 창이 닫힌 뒤(보냈든 닫았든)에는 앱을 고르라는 줄을 거둔다. 그 사이 다른 단추를 눌렀으면 그 줄은 둔다.
  const clearShareLine = (hallId: string) =>
    setFeedback((current) => (current?.hallId === hallId && current.kind === "shareOpened" ? null : current));

  const copy = (message: LetterSelfSendMessage) => {
    void copyText(message.text).then(
      (outcome) => show(message.hallId, outcome),
      () => show(message.hallId, "copyFailed"),
    );
  };
  const share = (message: LetterSelfSendMessage) => {
    // 공유 창은 누른 순간에만 열린다. 기다리는 일 없이 이 자리에서 연다.
    const started = shareText(message.text);
    if (started.sheetOpened) show(message.hallId, "shareOpened");
    void started.outcome.then(
      (outcome: ShareOutcome) => {
        const kind = shareFeedback(outcome);
        if (kind) show(message.hallId, kind);
        else clearShareLine(message.hallId);
      },
      () => show(message.hallId, "copyFailed"),
    );
  };

  return (
    <div className="flex flex-col gap-3.5" data-self-send>
      <p ref={introRef} tabIndex={-1} className="text-[13px] leading-[1.6] text-inv-body outline-none" data-self-send-intro>
        {SELF_SEND_COPY.intro}
      </p>
      {selfSend.messages.map((message) => (
        <SelfSendMessageCard
          key={message.hallId}
          message={message}
          platform={platform}
          feedback={feedback?.hallId === message.hallId ? feedback.kind : null}
          onCopy={() => copy(message)}
          onShare={() => share(message)}
          onSms={() => show(message.hallId, "smsOpened")}
        />
      ))}
      {selfSend.phoneOmitted ? (
        <p className="text-[12px] leading-[1.5] text-inv-muted" data-self-send-phone-omitted>
          {SELF_SEND_COPY.phoneOmitted}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 업체 답이 오면 상담 화면에 붙여 넣으라는 줄과 상담 화면 링크. 웹에서 붙여 넣기 화면으로 가는 길은 이 링크뿐이라,
 * 편지를 한 번이라도 저장했으면 고치는 중이거나 담은 웨딩홀이 바뀌어 다시 저장해야 할 때도 보인다. 한 칸에 한 번만 그린다.
 */
function AfterSendNotice() {
  return (
    <div className="flex flex-col items-start gap-2" data-self-send-after>
      <p className="text-[13px] leading-[1.6] text-inv-body">{SELF_SEND_COPY.afterSend}</p>
      <Button href={liveRoute("status")} variant="outline" size="pill-38" className="px-3.5">
        {SELF_SEND_COPY.openConsultation}
      </Button>
    </div>
  );
}

/** 비어 있는 조건만 묻는다. 이미 알려 준 것(예: 희망 시기)을 다시 묻지 않는다. 둘 다 비었을 때만 둘을 함께 묻는다. */
function missingConditionsText(missing: readonly LetterConditionKey[]): string {
  const month = missing.includes("month");
  const guests = missing.includes("guests");
  if (month && guests) return SELF_SEND_COPY.missingConditions;
  return month ? SELF_SEND_COPY.missingMonth : SELF_SEND_COPY.missingGuests;
}

/**
 * 편지 글에 넣을 희망 시기·하객 수가 비어 있다. 첫 대화(조건 묻기)를 다시 연다. 판을 저장한 뒤에는 조건이 바뀌어도
 * 편지 글이 다시 만들어지지 않으므로, 저장한 판이 없을 때만 묻는다. 막지는 않는다(그대로 저장할 수 있다).
 */
function MissingConditionsNotice({ missing }: { missing: readonly LetterConditionKey[] }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[18px] bg-inv-paper-soft p-3.5" data-self-send-missing>
      <p className="text-[13px] leading-[1.55] text-inv-body">{missingConditionsText(missing)}</p>
      <Button href={liveConditionsHref()} variant="outline" size="pill-38" className="px-3.5">
        {SELF_SEND_COPY.missingConditionsAction}
      </Button>
    </div>
  );
}

type SelfSendPanelProps = {
  /** 지금 보이는 판으로 엮은 보낼 글. 저장 전이거나 판이 다르면 null 이다. */
  selfSend: LetterSelfSend | null;
  /** 화면의 편지를 고쳤고 아직 저장하지 않았다. 이때는 보낼 글 대신 먼저 저장하라고 말한다. */
  dirty: boolean;
  /**
   * 편지를 한 번이라도 저장했다(편지가 있다). 처음 쓰는 초안일 때만 비어 있는 조건을 먼저 묻는다. 서버는 저장한 편지가
   * 없을 때만 조건으로 초안 글을 다시 만들고, 담은 웨딩홀이 바뀌어 판이 내려간 편지는 저장한 글을 그대로 쓴다. 그때 조건을
   * 알려 줘도 글에 들어가지 않으므로 묻지 않는다. 저장한 편지가 있으면 상담 화면으로 가는 줄은 늘 보인다.
   */
  hasSavedLetter: boolean;
  missingConditions: readonly LetterConditionKey[];
  /**
   * 저장해야 보낼 글이 나오는 편지다(`needsSave`). 보낼 글이 없고 고친 것도 없는데 저장할 수 있으면(저장한 판이 없거나
   * 담은 웨딩홀이 바뀌어 다시 저장해야 하면) 저장하면 보낼 글이 나온다고 말한다. 대기열에 넣은 옛 편지처럼 저장할 수
   * 없으면 그 줄을 보이지 않는다. 저장하거나 승인 방식 제안에 답하는 동안에도 값이 그대로라 줄이 깜박이지 않는다.
   */
  canSave: boolean;
  /**
   * 이 화면에서 저장한 횟수(`preparedCount`). 늘면(저장이 끝나 보낼 글이 나타나면) 보낼 글의 첫 줄로 초점을 옮긴다.
   * 처음 그릴 때와 고친 것을 되돌려 글이 다시 보일 때는 옮기지 않는다.
   */
  preparedCount: number;
};

/** 보낼 글 자리. 고치는 중이면 먼저 저장하라고, 글이 있으면 글을, 저장할 수 있으면 저장하면 글이 나온다고 말한다. */
function panelBody(
  selfSend: LetterSelfSend | null,
  dirty: boolean,
  canSave: boolean,
  introRef: RefObject<HTMLParagraphElement | null>,
): ReactNode {
  if (dirty) {
    return (
      <p className="text-[13px] leading-[1.6] text-inv-body" data-self-send-save-first>
        {SELF_SEND_COPY.saveFirst}
      </p>
    );
  }
  if (selfSend) return <SelfSendMessages selfSend={selfSend} introRef={introRef} />;
  if (!canSave) return null;
  return (
    <p className="text-[13px] leading-[1.6] text-inv-body" data-self-send-before-save>
      {SELF_SEND_COPY.beforeSave}
    </p>
  );
}

/**
 * 저장이 끝나 보낼 글이 나타나면 글의 첫 줄로 초점을 옮긴다. 저장 단추는 저장한 뒤 잠기므로 초점이 그 자리에 남지 않게
 * 하고, 화면 읽기 프로그램이 글이 나왔다고 읽게 한다. 저장 횟수가 늘 때만 옮긴다.
 */
function useFocusAfterSave(preparedCount: number): RefObject<HTMLParagraphElement | null> {
  const introRef = useRef<HTMLParagraphElement>(null);
  const focusedFor = useRef(preparedCount);
  useEffect(() => {
    if (focusedFor.current === preparedCount) return;
    focusedFor.current = preparedCount;
    introRef.current?.focus();
  }, [preparedCount]);
  return introRef;
}

/** 직접 보내기 칸 전체. 보일 것이 없으면(조건도 다 있고 보낼 글도 저장할 것도 저장한 편지도 없으면) 아무것도 그리지 않는다. */
export default function SelfSendPanel({ selfSend, dirty, hasSavedLetter, missingConditions, canSave, preparedCount }: SelfSendPanelProps) {
  const introRef = useFocusAfterSave(preparedCount);
  const askConditions = missingConditions.length > 0 && !hasSavedLetter;
  const body = panelBody(selfSend, dirty, canSave, introRef);
  const showAfterSend = hasSavedLetter || selfSend !== null;
  if (!askConditions && !body && !showAfterSend) return null;
  return (
    <div className="flex flex-col gap-[18px]">
      {askConditions ? <MissingConditionsNotice missing={missingConditions} /> : null}
      {body}
      {showAfterSend ? <AfterSendNotice /> : null}
    </div>
  );
}
