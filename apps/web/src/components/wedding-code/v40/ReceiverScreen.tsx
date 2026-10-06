"use client";

import { useId, useRef } from "react";
import Button from "@/components/ui/Button";
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  autosaveTurnOffWarning,
  receiveStorage,
  savedOnLine,
  type V40StorageMode,
} from "@/lib/weddingCode/v40/copy";
import { AutosaveToggle, fineText, type AutosavePreference } from "./IntroScreen";
import { StorageNotice } from "./NoticeScreens";
import { ActionBar, SectionCard, screenRootClass } from "./SectionCard";
import { ShareJourney } from "./ShareJourney";
import { bodyText, cx, noteText } from "./styles";
import { useScreenFocus } from "./useScreenFocus";

/**
 * 받는 사람 화면(설계 8절 표현 원칙 8번, 계약 문서 12.5절). 상대가 링크로 웨딩코드를 보냈을 때 첫 화면이다.
 *
 * 이 화면은 상대의 답을 받지 않는다. 링크 안에 상대의 답이 들어 있다는 사실만 말하고 내가 마치기 전에는 화면에 나오지 않게 한다
 * (props 에 상대의 답, 글자, 세기가 없다). 내 답을 마친 뒤의 두 사람 결과는 다른 화면이 그린다.
 * 화면은 데이터와 콜백을 props 로 받을 뿐 저장소, 통계, 주소를 만지지 않는다(주소의 뒷부분을 지우는 일은 클라이언트가 한다).
 * 「검증을 마친 심리검사가 아니」라는 고지는 이 화면에 정확히 한 번 있다(V40_COPY.receive.notice).
 */

export interface ReceiverSavedProgress {
  /** 이 브라우저에 하던 답을 저장한 시각(밀리초). 모르면 null. */
  readonly savedAt: number | null;
  /** 하던 답 이어서 하기. 상대가 보낸 링크의 답은 그대로 쓰인다(클라이언트가 지켜야 하는 약속이다: 카드 본문이 그렇게 말한다). */
  readonly onKeepMine: () => void;
  /** 받은 링크로 처음부터 하기. 하던 답은 지워진다(카드 본문이 미리 말한다). */
  readonly onUseLink: () => void;
}

export interface ReceiverScreenProps {
  readonly embedded?: boolean;
  readonly autosave: AutosavePreference;
  readonly onAutosaveChange: (next: AutosavePreference) => void;
  readonly autosaveNote?: "turnedOn" | "turnedOff" | null;
  /** 저장소 문제. unavailable 이면 자동 저장 단추를 그리지 않고 저장할 수 없다는 안내를 보인다. */
  readonly storageIssue?: "unavailable" | null;
  /**
   * 이 브라우저에 하던 답이 있으면 어느 쪽을 이어 할지 한 번 묻는다. 이때 「나도 답해 보기」 대신 이 카드의 두 단추가 나온다.
   * 없으면 「나도 답해 보기」.
   */
  readonly saved?: ReceiverSavedProgress | null;
  /** 이 브라우저에 이전 웨딩코드(v3.1) 저장이 있는가. 자동 저장을 끄면 함께 지워진다는 안내에만 쓴다. */
  readonly legacyPresent?: boolean;
  /**
   * 상대가 서로 짐작해 보기(4.1 단계 2)도 해 두었고 그 짐작이 링크에 들어 있다는 한 줄(문구는 부모가 준다. 이 화면은 트랙 폴더를 가져오지 않는다).
   * 상대의 내용은 어디에도 받지 않는다(사실 하나만 말한다). 링크에 짐작이 없거나 그 화면이 꺼져 있으면 주지 않는다.
   */
  readonly guessNote?: string;
  /** 나도 답해 보기(내 답 시작). */
  readonly onStart: () => void;
}

export function ReceiverScreen({
  embedded = false,
  autosave,
  onAutosaveChange,
  autosaveNote = null,
  storageIssue = null,
  saved = null,
  legacyPresent = false,
  guessNote,
  onStart,
}: ReceiverScreenProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "receiver");

  const copy = V40_COPY.receive;
  const conflict = V40_COPY.intro.inviteConflict;
  const savedOn = saved ? savedOnLine(saved.savedAt) : null;
  const unavailable = storageIssue === "unavailable";
  // 저장 문구는 저장 상태를 따른다: 자동 저장이 꺼져 있거나 브라우저가 저장을 막았으면 「저장돼요」라고 말하지 않는다.
  const storageMode: V40StorageMode = unavailable ? "blocked" : autosave === "off" ? "off" : "on";
  const warning = autosaveTurnOffWarning({ saved: saved !== null, legacy: legacyPresent });

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-screen="receiver"
      className={screenRootClass(embedded, "entry")}
    >
      {embedded ? (
        <p data-embedded-note="" className={cx(noteText, "mb-4")}>
          {V40_COPY.intro.embeddedNote}
        </p>
      ) : null}
      {unavailable ? <StorageNotice problem="unavailable" className="mb-4" /> : null}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(290px,0.75fr)] lg:gap-14">
        <div className="max-w-[660px] pt-5 lg:pt-10">
          <h1 id={titleId} className="break-keep text-[clamp(2.25rem,4.4vw,4.25rem)] font-semibold leading-[1.18] tracking-[-0.055em] text-[var(--hb-text-strong)]">
            {copy.title}
          </h1>
          <p className={cx(bodyText, "mt-6 break-keep text-[16px]! leading-[1.85]!")}>{copy.lead}</p>
        </div>
        <div className="space-y-0 lg:mt-8 lg:border-l lg:border-[var(--hb-hairline)] lg:pl-8">
          <ShareJourney label={copy.journeyLabel} steps={copy.journeySteps} />
          <p data-receive-own-note="" className={cx(bodyText, "break-keep py-5 lg:pt-0")}>
            {copy.ownAnswersNote}
          </p>
          <p data-receive-return-step="" className={cx(bodyText, "break-keep border-t border-[var(--hb-hairline)] py-5 font-medium! text-[var(--hb-text-strong)]!")}>
            {copy.returnStepNote}
          </p>
          {guessNote ? (
            <p data-receive-guess-note="" className={cx(bodyText, "break-keep border-t border-[var(--hb-hairline)] py-5")}>
              {guessNote}
            </p>
          ) : null}
        </div>
      </div>
      <p data-receive-honesty="" className="mt-10 max-w-[660px] break-keep border-t border-[var(--hb-hairline)] pt-6 text-sm font-medium leading-relaxed text-[var(--hb-text-strong)]">
        {copy.notice}
      </p>
      <p data-receive-storage="" className={cx(fineText, "mt-3 max-w-[660px]")}>
        {receiveStorage(storageMode, V40_COUNTS.items)}
      </p>
      <p data-receive-scope="" className={cx(fineText, "mt-3 max-w-[660px]")}>
        {copy.scope}
      </p>
      <p data-receive-reload="" className={cx(noteText, "mt-3 max-w-[660px] break-keep")}>
        {copy.reloadNote}
      </p>

      {unavailable ? null : (
        <AutosaveToggle autosave={autosave} onChange={onAutosaveChange} note={autosaveNote} warning={warning} />
      )}

      {saved ? (
        <SectionCard title={conflict.title} dataCard="invite-conflict" className="mt-8 max-w-[660px]">
          <p>{conflict.body}</p>
          {savedOn ? <p className="text-[var(--hb-text-muted)]">{savedOn}</p> : null}
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="primary" size="lg" fullWidth onClick={saved.onKeepMine}>
              {conflict.keepMineButton}
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={saved.onUseLink}>
              {conflict.useLinkButton}
            </Button>
          </div>
        </SectionCard>
      ) : (
        <ActionBar embedded={embedded}>
          <div className="max-w-[660px]">
            <Button variant="primary" size="lg" fullWidth onClick={onStart}>
              {copy.answerButton}
            </Button>
          </div>
        </ActionBar>
      )}
    </section>
  );
}

export default ReceiverScreen;
