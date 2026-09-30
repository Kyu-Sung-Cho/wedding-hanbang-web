"use client";

import { useId, useRef } from "react";
import Button from "@/components/ui/Button";
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import {
  V40_COPY,
  autosaveTurnOffWarning,
  introBullets,
  introStorage,
  savedOnLine,
  type V40StorageMode,
} from "@/lib/weddingCode/v40/copy";
import { PreviousVersionCard } from "./PreviousVersionCard";
import { StorageNotice } from "./NoticeScreens";
import { ActionBar, SectionCard, screenRootClass } from "./SectionCard";
import { bodyText, cx, noteText, noticeBox, noticeText } from "./styles";
import { useScreenFocus } from "./useScreenFocus";

/**
 * 시작 화면(설계 6절 시작 화면, 문구는 모두 copy.ts 의 V40_COPY.intro 와 도우미).
 *
 * 화면은 데이터와 콜백을 props 로 받을 뿐 저장소, 통계, 주소를 만지지 않는다. 클라이언트가 저장소를 읽고 쓴 결과를 props 로 넘긴다.
 * 질문 수는 상수(V40_COUNTS.items)에서 읽는다. 소요 시간은 적지 않는다(내부에서 재기 전에는 적지 않는다는 설계 결정).
 * 「검증을 마친 심리검사가 아니」라는 고지는 이 화면에 정확히 한 번 있다(V40_COPY.intro.notice).
 */

export type AutosavePreference = "on" | "off";

/** 저장과 범위를 밝히는 작은 본문(읽어야 하는 글이라 흐린 색이 아니라 본문 색). */
export const fineText = "break-keep text-[13px] leading-relaxed text-[var(--hb-text-body)]";

export interface AutosaveToggleProps {
  readonly autosave: AutosavePreference;
  readonly onChange: (next: AutosavePreference) => void;
  /**
   * 방금 켜거나 끈 결과 안내. 클라이언트가 저장소에 실제로 쓴 뒤에만 준다(끈 안내는 저장된 답과 기록을 지웠다고 말하므로 지운 뒤에만 참이다).
   */
  readonly note?: "turnedOn" | "turnedOff" | null;
  /** 자동 저장이 켜져 있을 때 끄면 지워지는 것을 끄기 전에 알리는 한 줄(autosaveTurnOffWarning). */
  readonly warning?: string | null;
}

/**
 * 자동 저장 켜기와 끄기 단추와 지금 상태 한 줄. 단추 이름은 누르면 일어나는 일(끄기, 켜기)이고 상태는 aria-live 로 바뀔 때 읽힌다.
 * 꺼져 있으면 「나가면 답이 사라져요」를 상태 줄에 함께 보인다(시작 화면 둘째 줄이 저장을 약속하기 때문이다).
 */
export function AutosaveToggle({ autosave, onChange, note = null, warning = null }: AutosaveToggleProps) {
  const warningId = useId();
  const on = autosave === "on";
  const showWarning = on && warning !== null && warning !== "";
  return (
    <div data-autosave-toggle="" data-autosave={autosave} className="mt-6">
      <Button
        variant="secondary"
        size="md"
        aria-describedby={showWarning ? warningId : undefined}
        onClick={() => onChange(on ? "off" : "on")}
      >
        {on ? V40_COPY.autosave.turnOffButton : V40_COPY.autosave.turnOnButton}
      </Button>
      {showWarning ? (
        <p id={warningId} data-autosave-warning="" className={cx(noteText, "mt-2")}>
          {warning}
        </p>
      ) : null}
      <div role="status" aria-live="polite" className="mt-2 space-y-1">
        <p data-autosave-status="" className={noteText}>
          {on ? V40_COPY.autosave.statusOn : V40_COPY.autosave.statusOff}
        </p>
        {note !== null ? (
          <p data-autosave-note={note} className={noteText}>
            {note === "turnedOn" ? V40_COPY.autosave.turnedOnNote : V40_COPY.autosave.turnedOffNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export interface IntroResume {
  /** 하던 답을 저장한 시각(밀리초). 모르면 null. */
  readonly savedAt: number | null;
  readonly onResume: () => void;
  /** 처음부터 다시 하기. 저장된 답이 지워진다(카드 본문이 미리 말한다). */
  readonly onStartOver: () => void;
}

export interface IntroScreenProps {
  /** 라운지 안이면 위에 한 줄(로그인한 상태여도 이 웨딩코드의 답은 계정에 저장되지 않아요)을 보이고 단추 줄을 하단 탭 위에 붙인다. */
  readonly embedded?: boolean;
  /** 화면 위에 한 번 보여 줄 안내(예: 링크를 읽지 못했어요). */
  readonly notice?: string | null;
  readonly autosave: AutosavePreference;
  readonly onAutosaveChange: (next: AutosavePreference) => void;
  readonly autosaveNote?: "turnedOn" | "turnedOff" | null;
  /** 이 브라우저에 이전 웨딩코드(v3.1) 진행 저장이 있으면 읽기만 하는 카드를 위에 놓는다. */
  readonly legacy?: { readonly savedAt: number | null } | null;
  /** 이 브라우저에 v4 진행 저장이 있으면 하던 답 카드를 놓고 시작하기 대신 이어서 하기와 처음부터 다시 하기를 준다. */
  readonly resume?: IntroResume | null;
  /** 저장소 문제: invalid = 저장된 답을 읽지 못함, expired = 30일이 지나 지움, unavailable = 이 브라우저에서 저장 불가. */
  readonly storageIssue?: "invalid" | "expired" | "unavailable" | null;
  readonly onStart: () => void;
}

export function IntroScreen({
  embedded = false,
  notice = null,
  autosave,
  onAutosaveChange,
  autosaveNote = null,
  legacy = null,
  resume = null,
  storageIssue = null,
  onStart,
}: IntroScreenProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  useScreenFocus(rootRef, "intro");

  const copy = V40_COPY.intro;
  const unavailable = storageIssue === "unavailable";
  // 저장 문구는 저장 상태를 따른다: 자동 저장이 꺼져 있거나 브라우저가 저장을 막았으면 「저장돼요」라고 말하지 않는다.
  const storageMode: V40StorageMode = unavailable ? "blocked" : autosave === "off" ? "off" : "on";
  const bullets = introBullets(storageMode, V40_COUNTS.items);
  const storage = introStorage(storageMode);
  const resumeSavedOn = resume ? savedOnLine(resume.savedAt) : null;
  const warning = autosaveTurnOffWarning({ saved: resume !== null, legacy: legacy !== null });

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-screen="intro"
      className={screenRootClass(embedded)}
    >
      {notice ? (
        <p role="status" data-intro-notice="" className={cx(noticeBox, noticeText, "mb-4")}>
          {notice}
        </p>
      ) : null}
      {embedded ? (
        <p data-embedded-note="" className={cx(noteText, "mb-4")}>
          {copy.embeddedNote}
        </p>
      ) : null}
      {storageIssue !== null ? <StorageNotice problem={storageIssue} className="mb-4" /> : null}
      {legacy ? <PreviousVersionCard savedAt={legacy.savedAt} className="mb-4" /> : null}
      {resume ? (
        <SectionCard title={copy.resume.title} dataCard="resume" className="mb-4">
          <p>{copy.resume.body}</p>
          {resumeSavedOn ? <p className="text-[var(--hb-text-muted)]">{resumeSavedOn}</p> : null}
          <div className="flex flex-col gap-2 pt-1">
            <Button variant="primary" size="lg" fullWidth onClick={resume.onResume}>
              {copy.resume.continueButton}
            </Button>
            <Button variant="secondary" size="lg" fullWidth onClick={resume.onStartOver}>
              {copy.resume.restartButton}
            </Button>
          </div>
        </SectionCard>
      ) : null}

      <p className="text-xs font-semibold tracking-wide text-[var(--hb-text-muted)]">{copy.brandLabel}</p>
      <h1 id={titleId} className="mt-3 break-keep text-[26px] font-semibold leading-snug text-[var(--hb-text-strong)] sm:text-3xl">
        {copy.title}
      </h1>
      <p className={cx(bodyText, "mt-4 break-keep")}>{copy.lede}</p>
      <ul role="list" className="mt-5 list-disc space-y-2 pl-5 text-sm leading-relaxed text-[var(--hb-text-body)] marker:text-[var(--hb-text-muted)]">
        {bullets.map((line) => (
          <li key={line} className="break-keep">
            {line}
          </li>
        ))}
      </ul>

      <p data-intro-honesty="" className="mt-6 break-keep text-sm font-medium leading-relaxed text-[var(--hb-text-strong)]">
        {copy.notice}
      </p>
      <p data-intro-storage="" className={cx(fineText, "mt-3")}>
        {storage.before}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          // 글 속 링크라 줄 높이는 그대로 두고, 위아래 안쪽 여백으로 눌리는 면만 넓힌다(글자 높이 15픽셀이라 손가락으로 맞추기 어려웠다).
          className="py-2 font-semibold text-[var(--hb-text-strong)] underline underline-offset-4"
        >
          {storage.linkLabel}
        </a>
        {storage.after}
      </p>
      <p data-intro-scope="" className={cx(fineText, "mt-3")}>
        {copy.scope}
      </p>

      {unavailable ? null : (
        <AutosaveToggle autosave={autosave} onChange={onAutosaveChange} note={autosaveNote} warning={warning} />
      )}

      {resume ? null : (
        <ActionBar embedded={embedded}>
          <Button variant="primary" size="lg" fullWidth onClick={onStart}>
            {copy.startButton}
          </Button>
        </ActionBar>
      )}
    </section>
  );
}

export default IntroScreen;
