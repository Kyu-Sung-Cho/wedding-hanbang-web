"use client";

import { useId, useRef, useState } from "react";
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
import LoadStallHint from "@/components/wedding-code/LoadStallHint";
import { PreviousVersionCard } from "./PreviousVersionCard";
import { StorageNotice } from "./NoticeScreens";
import { ActionBar, PinBarSpacer, SectionCard, pinnedScreenRootClass } from "./SectionCard";
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
  /**
   * 이 브라우저의 저장 상태를 아직 읽지 못한 때. 서버가 그린 시작 화면과 하이드레이션 첫 그림이 이것이다.
   * 시작 단추는 누를 수 없고(저장 상태를 모르는 채 시작하면 저장된 답을 덮어쓸 수 있다), 자동 저장 단추는 그리지 않으며,
   * 저장 문구는 저장 상태가 무엇이어도 참인 갈래(blocked)로 쓴다. 서버가 그린 화면을 이어받은 인스턴스는 초점과 스크롤을 옮기지 않는다.
   */
  readonly pending?: boolean;
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
  /** 저장소 문제: invalid = 저장된 답을 읽지 못함, invalidClock = 저장 시각이 미래라 읽지 못함(폰 날짜 확인 안내가 붙는다), expired = 30일이 지나 지움, unavailable = 이 브라우저에서 저장 불가. */
  readonly storageIssue?: "invalid" | "invalidClock" | "expired" | "unavailable" | null;
  readonly onStart: () => void;
}

/**
 * 서버가 그린 대기 시작 화면이 문서에 아직 남아 있는가. 남아 있으면 지금 만드는 화면은 그 화면을 이어받거나(하이드레이션),
 * 이어받지 못해 그 위에 새로 그려 바꾸는 것이다(하이드레이션 불일치를 React 가 고치는 경우). 두 경우 모두 초점과 스크롤을 옮기면 안 된다.
 * 처음 한 번 읽을 뿐 그리는 내용에는 쓰지 않는다(서버 렌더에서는 문서가 없어 거짓이다).
 */
function serverIntroStillShown(): boolean {
  return typeof document !== "undefined" && document.querySelector('[data-screen="intro"][data-pending]') !== null;
}

export function IntroScreen({
  pending = false,
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
  // 서버가 그린 대기 화면을 이어받거나 바꿔 그리는 인스턴스는 초점도 스크롤도 옮기지 않는다: 읽던 사람이 그 순간 맨 위로 끌려가지 않게 한다.
  // 저장소를 읽고 대기가 풀려도 같은 인스턴스는 계속 건너뛴다(처음 한 번만 정한다). 브라우저에서 새로 만든 화면(다시 시작 등)은 대기 중이어도 옮긴다.
  const [replacesServerIntro] = useState(() => pending && serverIntroStillShown());
  useScreenFocus(rootRef, "intro", !replacesServerIntro);

  const copy = V40_COPY.intro;
  const unavailable = storageIssue === "unavailable";
  // 저장 문구는 저장 상태를 따른다: 자동 저장이 꺼져 있거나 브라우저가 저장을 막았으면 「저장돼요」라고 말하지 않는다.
  // 저장 상태를 아직 모르는 동안은 어느 상태에서도 참인 blocked 갈래만 쓴다(저장한다는 말도, 기간도 없다).
  const storageMode: V40StorageMode = pending || unavailable ? "blocked" : autosave === "off" ? "off" : "on";
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
      data-pending={pending ? "" : undefined}
      // 소개 글이 화면보다 짧은 동안(대기 화면)과 긴 뒤(저장소를 읽은 화면)에 시작 단추가 같은 자리, 곧 화면 아래에 있게 한다.
      // 짧은 동안 단추가 글 바로 밑에 떠 있다가 풀리는 순간 화면 아래로 내려가면, 풀리기를 기다려 누르려던 손가락이 자리를 놓친다.
      className={pinnedScreenRootClass(embedded)}
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

      {/* 대기 중에는 실제 자동 저장 선호를 모르므로 켜기와 끄기 단추를 그리지 않는다(눌러도 받을 쪽이 아직 없다). */}
      {unavailable || pending ? null : (
        <AutosaveToggle autosave={autosave} onChange={onAutosaveChange} note={autosaveNote} warning={warning} />
      )}

      {resume ? null : (
        <>
          {/* 소개 글이 화면보다 짧으면 남는 높이를 이 빈틈이 먹어 단추 줄이 화면 아래에 붙는다(저장소를 읽어 글이 길어진 뒤와 같은 자리). */}
          <PinBarSpacer embedded={embedded} />
          <ActionBar embedded={embedded}>
            {/* 안내는 단추 위에 둔다: 사라질 때 아래에 붙은 단추가 따라 내려가 누르려던 자리를 벗어나지 않게 한다. */}
            {pending ? (
              <>
                <p role="status" data-intro-pending="" className={cx(noteText, "mb-2 text-center")}>
                  {V40_COPY.common.loadingLabel}
                </p>
                {/* 화면 조각이 못 내려와 이 줄이 계속 남는 경우를 위한 보강: 12초 뒤에야 보이는 새로고침 한 줄(서버 HTML 에서부터 CSS 로). 풀리면 이 줄과 함께 사라진다. */}
                <LoadStallHint className={cx(fineText, "mb-2 text-center")} />
              </>
            ) : null}
            {/* 대기 중에는 진짜 disabled 로 내보낸다. 서버가 그린 단추는 하이드레이션 전에 눌러도 받는 쪽이 없어 누른 것이 사라진다. */}
            <Button variant="primary" size="lg" fullWidth onClick={onStart} loading={pending}>
              {copy.startButton}
            </Button>
          </ActionBar>
        </>
      )}
    </section>
  );
}

export default IntroScreen;
