"use client";

import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import {
  BoundaryFallbackScreen,
  CoupleResult,
  IntroScreen,
  NoCompareScreen,
  QuestionScreen,
  ReceiverScreen,
  RestCard,
  ResultScreen,
  SelfIntroCard,
  ShareBlock,
  browserShareEnv,
  isRealClipboardCopy,
  screenRootClass,
  useScreenFocus,
  type AutosavePreference,
  type SaveState,
  type ShareEnv,
  type ShareSentEvent,
} from "@/components/wedding-code/v40";
import { CoupleGuessSection, GuessEntryCard, GuessSetFlow } from "@/components/wedding-code/v40/guess";
import { LetterGuessClosedCard, LetterGuessLines, LetterGuessScreen } from "@/components/wedding-code/v40/letterGuess";
import { V40_COUNTS, WEDDING_CODE_V40_VERSION, type Axis } from "@/constants/weddingCodeV40";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { buildQuestionOnlyUrl } from "@/lib/weddingCode/v40/codec";
import { V40_CLIENT_COPY, V40_COPY } from "@/lib/weddingCode/v40/copy";
import { compareCouple, detectPerspective } from "@/lib/weddingCode/v40/couple";
import {
  createFlowReducer,
  initialFlowState,
  placementOf,
  progressSegments,
  skippedReviewIds,
  snapshotOf,
  viewAnswerOf,
} from "@/lib/weddingCode/v40/flow";
import { compareGuesses } from "@/lib/weddingCode/v40/guess/guessCompare";
import { buildGatedShareUrlWithGuess } from "@/lib/weddingCode/v40/guess/guessLink";
import { V40_PAIR_GUESS_ENABLED, type GuessAnswers, type V40EntryGuess } from "@/lib/weddingCode/v40/guess/types";
import {
  V40_LETTER_GUESS_ENABLED,
  clearLetterGuess,
  hasLetterGuessLines,
  isLetterGuessEligible,
  letterGuessForAttempt,
  loadLetterGuess,
  saveLetterGuess,
  summarizeLetterGuess,
  type LetterGuess,
} from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import { present } from "@/lib/weddingCode/v40/present";
import { pickQuotes } from "@/lib/weddingCode/v40/quote";
import { buildResult, selfLine } from "@/lib/weddingCode/v40/score";
import {
  appendHistory,
  browserStorage,
  clearHistory,
  clearProgress,
  createExtraPort,
  probeLegacyV31Progress,
  purgeExpired,
  readAutosavePreference,
  readHistory,
  readProgress,
  writeAutosavePreference,
  writeProgress,
  type ExtraPort,
} from "@/lib/weddingCode/v40/storage";
import type {
  DecodedCode,
  FlowAction,
  FlowState,
  HistoryEntry,
  ItemId,
  Perspective,
  ProgressSnapshot,
  StorageLike,
  V40Result,
  ViewAnswer,
  WeddingCodeV40ClientProps,
} from "@/lib/weddingCode/v40/types";

import { weddingCodeDefaultsToV40, weddingCodeRestartSearch } from "./entry";
import {
  V40_TASTE_HREF,
  answerCounts,
  decodedFromSnapshot,
  historyEntryOf,
  linkOpenedState,
  planHistory,
  readLinkOpened,
  readOnlyStorage,
  sameHistoryResult,
  viewportPack,
  watchViewportPack,
  type LinkOpenedKind,
  type ResultArrival,
} from "./WeddingCodeV40Client.model";
import { isStagePending, stageAfterLetter, stageOnResult, useStage2, type StageFacts, type StageSwitches } from "./WeddingCodeV40Client.stage2";

/**
 * 웨딩코드 4.0 클라이언트(설계 6에서 9절, 계약 문서 9에서 14절).
 *
 * 링크 전용이라 서버 요청이 없다. 답은 주소의 # 뒤(링크)와 이 기기 저장소에만 있고, 통계에는 고지한 이벤트와 개수만 보낸다.
 * 화면은 모두 components/wedding-code/v40 의 화면이고 이 파일은 그 사이를 잇는다: 입구가 준 링크(빈 시작, 받은 링크, 두 사람 링크)를 읽고,
 * 순수 reducer(flow.ts)로 화면을 넘기고, 이 기기 저장(storage.ts)과 지난번 비교 기록을 다루고, 결과를 다시 계산해 그리고, 링크를 보낸다.
 *
 * 지키는 약속
 * - 받은 링크의 상대 답은 메모리에만 둔다. 읽은 즉시 주소의 # 뒤를 지운다(history.replaceState). 내 답을 마치기 전에는 어떤 화면에도 상대 답을 주지 않는다.
 * - 두 사람 결과 링크를 연 화면은 이 기기의 저장에 쓰지 않는다(읽기 전용 저장소로 「나」 표시만 알아본다). 지난번 비교 기록은 읽지도 않는다.
 * - 저장이 됐다는 말은 실제로 쓰고 다시 읽어 맞았을 때만 한다(저장 상태는 마지막 쓰기의 결과 그대로다). 자동 저장이 꺼져 있으면 아무것도 쓰지 않는다.
 * - 이용 통계 wedding_code_share_copied 는 링크를 실제로 클립보드에 복사했을 때만 보낸다(코드 복사와 공유 창 완료는 보내지 않는다).
 *
 * 4.1 단계 2(어두운 진입 뒤의 선택 화면 둘, 빌드 계획 2절): 결과 쪽에 들어설 때 reducer(flow.ts)는 모르는 단계 화면을 이 파일이 얹는다.
 * - 결과 전 글자 고르기(letter-guess): 혼자 쓰는 사람과 받는 사람이 결과 앞에서 한 번. 고른 글자는 메모리에 두고 자동 저장이 켜져 있을 때만 이 브라우저에도 둔다(링크에는 넣지 않는다).
 * - 서로 짐작하기(pair-guess): 받는 사람은 상대의 링크에 ga 가 있을 때 두 사람 결과 앞에서, 보내는 사람은 결과 화면의 카드로 연다. 고른 것은 메모리에만 있고 링크의 # 뒤(ga, gb)로만 나간다.
 * - 두 단계 모두 이용 통계, 서버, 아모라에 아무것도 보내지 않는다(통계 호출은 위 본체의 열 곳 그대로이고 단계 파일들은 통계를 가져오지 않는다).
 * - 단계 상태는 WeddingCodeV40Client.stage2.tsx 의 훅 하나가 쥔다. stagesDone 은 상태와 ref 가 한 쌍이다(렌더는 상태만, 핸들러는 ref 만 읽는다).
 * - deps.stages 로 켜고 끈다(기본은 각 기능의 켬 상수). 끄면 그 화면만 사라지고 꺼진 단계는 저장소도 링크도 건드리지 않는다.
 */

const bank = WEDDING_CODE_V40_BANK;
const reduce = createFlowReducer(bank);

// ---------------------------------------------------------------------------
// 밖에서 바꿔 끼울 수 있는 것 (시험용)
// ---------------------------------------------------------------------------

/** 시험이 저장소, 시계, 난수, 공유 창을 바꿔 끼우는 자리. 실제 화면은 아무것도 주지 않는다. storage 를 null 로 주면 저장을 쓸 수 없는 브라우저다. */
export interface WeddingCodeV40ClientDeps {
  readonly storage?: StorageLike | null;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly shareEnv?: ShareEnv;
  /**
   * 질문 화면으로 넘어온 직후, 아직 아무 답도 고르지 않았을 때 이 시간(밀리초) 안의 다음 누름을 무시한다. 기본 TURN_GUARD_MS.
   * 0 이면 끈다(시험이 빠르게 누를 때).
   */
  readonly turnGuardMs?: number;
  /**
   * 결과 앞뒤에 얹는 단계 화면(4.1 단계 2)을 켜고 끈다. 주지 않으면 각 기능의 켬 상수(V40_LETTER_GUESS_ENABLED, V40_PAIR_GUESS_ENABLED).
   * 끄면 그 화면만 사라지고 결과 계산, 링크 읽기, 저장은 그대로다(꺼진 단계는 저장소도 읽지 않는다). 시험 도구의 기본은 둘 다 꺼짐이다.
   */
  readonly stages?: { readonly letterGuess?: boolean; readonly pairGuess?: boolean };
}

/**
 * 화면을 넘긴 직후의 잘못된 두 번 누름을 막는 시간(밀리초). 시작하기, 이어서 하기, 다음 단추는 연이은 화면에서 같은 자리에 있어서,
 * 손가락이 두 번 닿으면 둘째 누름이 새 질문 화면의 다음 단추를 눌러 손대지 않은 질문에 「답하지 않은 질문이 있어요」가 뜨거나
 * (이미 답이 정해진 넘어간 질문 다시 보기에서는) 쪽 하나를 조용히 건너뛴다.
 * 사람이 두 번 두드리는 간격(대개 300밀리초 안쪽)만 거르도록 짧게 잡았고, 그 쪽에서 답을 하나라도 고른 뒤의 다음 누름과
 * 질문 화면이 아닌 카드(쉬는 카드, 마지막 정리)의 누름은 막지 않는다(자동 실행기와 빠른 사용자를 막지 않는다).
 */
const TURN_GUARD_MS = 300;

export type WeddingCodeV40ClientCoreProps = WeddingCodeV40ClientProps & { readonly deps?: WeddingCodeV40ClientDeps };

// ---------------------------------------------------------------------------
// 상태 모양
// ---------------------------------------------------------------------------

interface LinkContext {
  readonly partner: DecodedCode | null;
  readonly both: { readonly first: DecodedCode; readonly second: DecodedCode } | null;
  /** 링크의 서로 짐작하기(ga, gb)를 푼 것. 링크에 g 가 없으면 null. 메모리에만 두고 이 브라우저에 저장하지 않는다. */
  readonly guess: V40EntryGuess | null;
}

interface SavedProgress {
  readonly snapshot: ProgressSnapshot;
  readonly savedAt: number;
  readonly raw: string;
}

type StorageIssue = "invalid" | "expired" | "unavailable";

interface BootReady {
  readonly status: "ready";
  /** 이 기기 저장소 핸들. 브라우저가 막았으면 null. */
  readonly storage: StorageLike | null;
  readonly pref: AutosavePreference;
  readonly issue: StorageIssue | null;
  /** 이 기기에 이어 할 수 있는 v4 진행 저장(자동 저장이 켜져 있을 때만 읽는다). */
  readonly saved: SavedProgress | null;
  /** 이 기기에 이전 웨딩코드(v3.1) 진행 저장이 있는가. */
  readonly legacy: { readonly savedAt: number | null } | null;
  /** 두 사람 결과에서 이 기기에 저장된 본인 답이 가리키는 쪽. */
  readonly detected: Perspective | null;
  /**
   * 결과 전에 고른 글자(4.1 단계 2)의 저장 포트. 그 화면이 꺼져 있거나 저장소를 못 쓰거나 두 사람 결과 링크를 연 화면이면 null 이다
   * (저장소를 건드리지 않는다). 자동 저장을 따르는 규칙은 포트가 지킨다(꺼져 있으면 쓰지 않는다).
   */
  readonly letterPort: ExtraPort | null;
}

type Boot = { readonly status: "pending" } | BootReady;

const PENDING: Boot = { status: "pending" };

const loadingClass = "mx-auto flex min-h-[60vh] w-full max-w-[680px] items-center justify-center px-5 text-sm text-[var(--hb-text-body)]";

// 서버 렌더와 하이드레이션 첫 그림이 끝났는가. 서버 값(false)은 그 두 번의 그림에서만 쓰이고, 브라우저에서 새로 만든 본체는 처음부터 true 다.
const noSubscription = (): (() => void) => () => undefined;
const settledInBrowser = (): boolean => true;
const unsettledOnServer = (): boolean => false;

/** 지금 결과 화면인가(전체 흐름의 결과 쪽. 답 다시 보기 필터 흐름은 결과가 아니다). */
function isResultView(state: FlowState): boolean {
  return state.started && state.filter === null && state.pages[state.pageIndex]?.kind === "result";
}

/**
 * 주소의 # 뒤를 지운다. 답이 주소창과 브라우저 기록에 남지 않게 하고, 새로고침해도 같은 판이 열리게 판 이름만 남긴다(답은 넣지 않는다).
 * opened 를 주면 받은 링크를 열었다는 표시(partner, both) 하나를 이 탭의 브라우저 기록 칸에 남긴다: 새로고침한 화면이 무슨 일이 있었는지 말할 수 있게 하려는
 * 것이고 답은 담지 않는다(WeddingCodeV40Client.model.ts). null 이면 표시 없이 지운다(다시 시작).
 */
function clearAddressTail(opened: LinkOpenedKind | null): void {
  try {
    window.history.replaceState(linkOpenedState(window.history.state, opened), "", `${window.location.pathname}${weddingCodeRestartSearch("v40")}`);
  } catch {
    // 주소를 못 바꾸는 환경이면 그대로 둔다.
  }
}

/**
 * 이번 시도가 남긴 지난번 비교 기록(가장 최근 건, 시각 attemptAt)을 고친 결과로 바꿔 쓴다. 기록에는 바꿔 쓰는 함수가 없어 비우고 오래된 것부터 다시 쌓는다
 * (그 사이에 실패하면 오래된 건을 잃을 수 있다. 최선 노력이고 드물다).
 */
function replaceAttemptEntry(storage: StorageLike, entries: readonly HistoryEntry[], entry: HistoryEntry, attemptAt: number, at: number): void {
  if (clearHistory(storage).status !== "cleared") return;
  for (const older of entries.slice(1).reverse()) appendHistory(storage, older, at);
  appendHistory(storage, { ...entry, at: attemptAt }, at);
}

/** 이 탭의 브라우저 기록 칸에 받은 링크를 열었다는 표시가 남아 있는가(새로고침해도 남는다). */
function readOpenedMark(): LinkOpenedKind | null {
  try {
    return readLinkOpened(window.history.state);
  } catch {
    return null;
  }
}

/** 화면 뿌리 안에서 초점을 받을 수 있는 제목(tabIndex 를 준 h1 또는 h2). 없으면 null. */
function screenTitleOf(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>("h1[tabindex], h2[tabindex]");
}

/** 화면이 바뀔 때 초점과 스크롤을 받는 결과류 화면의 뿌리. 질문류 화면은 자기 뿌리에서 이 일을 한다. */
function ScreenSection({
  label,
  focusKey,
  embedded,
  children,
}: {
  /** 이름을 주면 그 이름의 구역(landmark)이 된다. 안쪽 화면이 이미 같은 이름의 구역이면 주지 않는다(같은 이름의 구역이 둘이 되지 않게). */
  readonly label?: string;
  readonly focusKey: string;
  readonly embedded: boolean;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // 이름을 주지 않은 뿌리는 이름 없는 덩어리라서 낭독기가 화면 이름을 못 읽는다. 그런 화면은 안쪽 화면 제목(초점을 받을 수 있게 tabIndex 가 있다)으로 초점을 보낸다.
  useScreenFocus(ref, focusKey, true, label === undefined ? screenTitleOf : undefined);
  if (label === undefined) {
    return (
      <div
        ref={(node) => {
          ref.current = node;
        }}
        tabIndex={-1}
        data-screen={focusKey}
        className={screenRootClass(embedded)}
      >
        {children}
      </div>
    );
  }
  return (
    <section ref={ref} tabIndex={-1} aria-label={label} data-screen={focusKey} className={screenRootClass(embedded)}>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------------

export function WeddingCodeV40Core({ shareOrigin, initial, resolved, embedded = false, onRestart, initialNotice = "", deps }: WeddingCodeV40ClientCoreProps) {
  const [injected] = useState(deps);
  const [initialFlow] = useState(() => initialFlowState(bank));
  const [flow, setFlow] = useState<FlowState>(initialFlow);
  const flowRef = useRef<FlowState>(initialFlow);
  const [context, setContext] = useState<LinkContext>(() => ({ partner: initial.partner, both: initial.both, guess: initial.guess ?? null }));
  const contextRef = useRef(context);
  const [boot, setBoot] = useState<Boot>(PENDING);
  const bootRef = useRef<Boot>(PENDING);
  const [saveState, setSaveStateValue] = useState<SaveState | null>(null);
  const saveStateRef = useRef<SaveState | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [autosaveNote, setAutosaveNote] = useState<"turnedOn" | "turnedOff" | null>(null);
  const [previousEntry, setPreviousEntry] = useState<HistoryEntry | null>(null);
  const [unsaved, setUnsavedState] = useState(false);
  const [noticeText, setNoticeText] = useState(initialNotice);
  /**
   * 받은 링크를 열었다가 새로고침해서 링크의 답이 화면에서 사라진 채 다시 열린 화면이면 그 링크의 종류(partner, both). 아니면 null.
   * 이 안내가 없으면 새로고침한 화면은 링크를 연 적이 없는 화면과 똑같아 보여서 두 사람 결과가 왜 없는지 알 수 없었다.
   */
  const [linkLost, setLinkLost] = useState<LinkOpenedKind | null>(null);
  /** 진행 저장에 마지막으로 쓴(또는 읽은) 원문. 다음 쓰기가 다른 창이 바꾼 값을 덮어쓰지 않았는지 이것과 견준다. */
  const expectedRawRef = useRef<string | null>(null);
  /** 이번 시도의 결과를 이미 기록에 남겼는가. */
  const resultRecordedRef = useRef(false);
  /** 이 화면이 이번 시도로 남긴 지난번 비교 기록의 시각. 남기지 않았으면 null. */
  const attemptAtRef = useRef<number | null>(null);
  const lastSceneRef = useRef<string | null>(null);
  const introSentRef = useRef(false);
  const comparisonSentRef = useRef(false);
  /** 화면을 마지막으로 넘긴 때(실제 시각). 넘긴 직후의 잘못된 두 번 누름을 거르는 데 쓴다. */
  const lastTurnAtRef = useRef(0);
  /** 마지막으로 화면을 넘긴 뒤 답을 하나라도 골랐는가. 골랐으면 다음 누름은 두 번 눌림이 아니다. */
  const answeredSinceTurnRef = useRef(false);
  /** 저장하지 않은 답이 있는가(unsaved 상태의 ref 사본). 화면을 떠날 때(pagehide) 저장할지 정한다. */
  const unsavedRef = useRef(false);

  const clock = (): number => injected?.now?.() ?? Date.now();
  const hasPartnerLink = context.partner !== null || context.both !== null;

  // -- 결과 앞뒤의 단계 화면(4.1 단계 2) ------------------------------------------------
  // reducer(flow.ts)는 두 화면을 모른다. 클라이언트가 결과 쪽에 들어설 때 열고(send), 끝나면 stagesDone 으로 표시한다.
  // stages 는 deps(바뀌지 않는다)와 기능 켬 상수에서 정해져서 렌더가 달라도 같다(오래된 클로저가 불러도 같은 값이다).
  const stages: StageSwitches = {
    letterGuess: injected?.stages?.letterGuess ?? V40_LETTER_GUESS_ENABLED,
    pairGuess: injected?.stages?.pairGuess ?? V40_PAIR_GUESS_ENABLED,
  };
  const stage = useStage2();
  const factsOf = (ctx: LinkContext): StageFacts => ({
    stages,
    both: ctx.both !== null,
    partner: ctx.partner !== null,
    partnerGuessed: ctx.guess?.first != null,
  });

  // -- 상태를 바꾸는 작은 도우미 ------------------------------------------------

  const updateBoot = (patch: Partial<BootReady>): void => {
    const current = bootRef.current;
    if (current.status !== "ready") return;
    const next: BootReady = { ...current, ...patch };
    bootRef.current = next;
    setBoot(next);
  };

  const setSave = (value: SaveState | null, at: number | null = null): void => {
    saveStateRef.current = value;
    setSaveStateValue(value);
    if (at !== null) setSavedAt(at);
  };

  const setUnsaved = (value: boolean): void => {
    unsavedRef.current = value;
    setUnsavedState(value);
  };

  const updateContext = (next: LinkContext): void => {
    contextRef.current = next;
    setContext(next);
  };

  // -- 이 기기에 저장 ------------------------------------------------------------

  /** 지금 상태를 진행 저장에 쓴다. 쓴 결과를 그대로 저장 상태로 삼는다. */
  const persist = (state: FlowState): void => {
    const current = bootRef.current;
    if (current.status !== "ready" || contextRef.current.both !== null) return;
    if (!state.started || Object.keys(state.responses).length === 0) return;
    if (current.storage === null) {
      setSave("unavailable");
      return;
    }
    if (current.pref === "off") {
      setSave("off");
      return;
    }
    if (saveStateRef.current === "conflict") return;
    const snapshot = snapshotOf(bank, state);
    if (snapshot === null) return;
    const at = clock();
    const write = writeProgress(current.storage, bank, snapshot, expectedRawRef.current, at);
    if (write.status === "saved") {
      expectedRawRef.current = write.raw;
      setUnsaved(false);
      setSave("saved", at);
    } else if (write.status === "conflict") {
      setSave("conflict");
    } else if (write.status === "off") {
      // 다른 탭에서 자동 저장을 끈 경우: 이 탭의 선호가 낡았을 뿐 저장소가 막힌 것이 아니다.
      setSave("off");
    } else {
      setSave("unavailable");
    }
  };

  /** 결과 화면에 들어설 때 한 번: 지난번 기록을 읽어 비교할 것을 정하고, 처음 끝낸 것이면 이번 결과를 남기고 끝까지 갔다고 알린다. */
  const arrive = (state: FlowState, arrival: ResultArrival): void => {
    resultRecordedRef.current = true;
    const result = buildResult(bank, state.formBit, state.responses);
    const current = bootRef.current;
    let previous: HistoryEntry | null = null;
    if (current.status === "ready" && current.storage !== null) {
      const at = clock();
      const entry = historyEntryOf(result, at);
      const entries = readHistory(current.storage, at).entries;
      // 이어 하기로 결과에 돌아왔는데 가장 최근 기록이 지금 결과와 같으면 그 기록이 이 시도의 것이다(새로고침하면서 이 화면은 남긴 시각을 잊었다).
      // 이어받아 두면 이어서 답을 고칠 때 이 시도의 기록을 바꿔 쓸 수 있고, 고치기 전 결과를 「지난번」이라며 견주지 않는다.
      if (arrival === "return" && attemptAtRef.current === null && entries[0] !== undefined && sameHistoryResult(entries[0], entry)) {
        attemptAtRef.current = entries[0].at;
      }
      const plan = planHistory(entries, entry, arrival, attemptAtRef.current);
      previous = plan.previous;
      if (result.code !== null && current.pref === "on") {
        if (plan.append) {
          if (appendHistory(current.storage, entry, at).status === "saved") attemptAtRef.current = at;
        } else if (plan.replace && attemptAtRef.current !== null) {
          // 답을 고쳐 결과가 달라졌다: 이번 시도의 기록을 고친 결과로 바꿔 쓴다.
          replaceAttemptEntry(current.storage, entries, entry, attemptAtRef.current, at);
        }
      }
    }
    setPreviousEntry(previous);
    if (arrival === "fresh") {
      const counts = answerCounts(bank, state.responses);
      captureWeddingCodeEvent("wedding_code_completed", {
        version: WEDDING_CODE_V40_VERSION,
        scene_total: V40_COUNTS.screens,
        answered_count: counts.answered,
        skipped_count: counts.skipped,
        result_kind: contextRef.current.partner !== null ? "couple" : "solo",
        placement: "result",
      });
    }
  };

  /**
   * 답 다시 보기 도중(결과 화면에 돌아오기 전)에 화면을 넘길 때, 이번 시도가 남긴 지난번 비교 기록을 지금 답으로 계산한 결과에 맞춰 둔다.
   * 그러지 않으면 다시 보기를 하다 새로고침했을 때 이어 하기로 돌아온 결과 화면이 고치기 전 결과를 「지난번」이라며 견준다(같은 시도의 고치기 전과 후를 견주는 셈이다).
   * 결과가 그대로이면 아무것도 쓰지 않는다. 코드가 나오지 않는 결과(관문)이면 기록을 그대로 둔다.
   */
  const syncAttemptHistory = (state: FlowState): void => {
    const current = bootRef.current;
    const attemptAt = attemptAtRef.current;
    if (attemptAt === null || current.status !== "ready" || current.storage === null || current.pref !== "on" || contextRef.current.both !== null) return;
    const result = buildResult(bank, state.formBit, state.responses);
    if (result.code === null) return;
    const at = clock();
    const entries = readHistory(current.storage, at).entries;
    const latest = entries[0];
    if (latest === undefined || latest.at !== attemptAt) return;
    const entry = historyEntryOf(result, at);
    if (sameHistoryResult(latest, entry)) return;
    replaceAttemptEntry(current.storage, entries, entry, attemptAt, at);
  };

  // -- 결과 앞의 단계 화면과 결과 전에 고른 글자의 보관본(4.1 단계 2) ------------------------

  /** 보관본 포트. 그 화면이 꺼져 있거나 저장소를 못 쓰거나 두 사람 결과 링크를 연 화면이면 null(저장소를 건드리지 않는다). */
  const letterPortOf = (): ExtraPort | null => {
    const current = bootRef.current;
    return current.status === "ready" ? current.letterPort : null;
  };

  /** 보관본을 지운다. 포트가 없으면 지울 것이 없으니 참, 저장소 접근이 막혔으면 거짓. */
  const wipeLetterStorage = (): boolean => {
    const port = letterPortOf();
    return port === null ? true : clearLetterGuess(port);
  };

  /**
   * 이어 받은 흐름이 결과 쪽일 때 보관본을 화면에 올린다(폼 비트가 이어 받은 흐름과 같을 때만). 맞지 않는 보관본은 다른 시도의 낡은 것이라 지운다.
   * 자동 저장이 꺼져 있으면 읽지 않는다.
   */
  const restoreLetterGuess = (restored: FlowState): void => {
    const port = letterPortOf();
    const current = bootRef.current;
    if (port === null || current.status !== "ready" || current.pref !== "on") {
      stage.setLetterGuess(null);
      return;
    }
    const load = loadLetterGuess(port, clock());
    const guess = letterGuessForAttempt(load, restored.formBit);
    stage.setLetterGuess(guess);
    if (guess === null && (load.status === "ready" || load.status === "invalid")) clearLetterGuess(port);
  };

  /** 이어 받은 흐름에 단계를 맞춘다: 결과 쪽이면 단계는 끝난 것이고(보관본이 맞으면 줄을 올린다), 질문 도중이면 끝낸 뒤 다시 열리도록 처음 상태로 돌린다. */
  const settleStagesForResumed = (restored: FlowState): void => {
    if (isResultView(restored)) {
      stage.setDone(true);
      restoreLetterGuess(restored);
    } else {
      stage.resetForQuestions();
      wipeLetterStorage();
    }
  };

  /** 글자 고르기를 열지 않거나 끝낸 뒤: 받는 사람의 서로 짐작하기를 열거나 단계를 끝낸다. */
  const afterLetter = (result: V40Result): void => {
    if (stageAfterLetter(factsOf(contextRef.current), result.code !== null) === "receiver") stage.openPair("receiver");
    else stage.setDone(true);
  };

  /** 결과 쪽에 들어섰을 때(arrive 뒤): 단계가 끝나지 않았으면 첫 단계를 연다. 액션 종류는 보지 않는다(stagesDone 이 거짓인 채 결과 쪽에 들어섰다는 것이 곧 처음 도착이다). */
  const enterResult = (state: FlowState): void => {
    if (stage.doneRef.current) return;
    const result = buildResult(bank, state.formBit, state.responses);
    const first = stageOnResult(factsOf(contextRef.current), isLetterGuessEligible(result), result.code !== null);
    if (first === "letter") stage.openLetterGate();
    else if (first === "receiver") stage.openPair("receiver");
    else stage.setDone(true);
  };

  /** 흐름을 한 걸음 옮긴다. 화면을 넘길 때 저장하고, 결과에 들어서면 기록을 남긴다. */
  const send = (action: FlowAction): void => {
    const previous = flowRef.current;
    // 질문 화면으로 넘어온 바로 뒤, 아직 답을 하나도 고르지 않고 누른 다음은 같은 자리에 온 새 화면의 단추를 잘못 누른 것이다(두 번 눌림). 무시한다.
    if (
      action.type === "next" &&
      previous.pages[previous.pageIndex]?.kind === "questions" &&
      !answeredSinceTurnRef.current &&
      Date.now() - lastTurnAtRef.current < (injected?.turnGuardMs ?? TURN_GUARD_MS)
    ) {
      return;
    }
    const next = reduce(previous, action);
    if (next === previous) return;
    flowRef.current = next;
    setFlow(next);
    if (action.type === "answer") {
      setUnsaved(true);
      answeredSinceTurnRef.current = true;
    }
    const turned = next.started && (!previous.started || next.pageIndex !== previous.pageIndex || next.filter !== previous.filter);
    const userTurn = action.type === "start" || action.type === "next" || action.type === "back" || action.type === "closeFilter" || action.type === "openFilter";
    if (turned && userTurn) {
      lastTurnAtRef.current = Date.now();
      answeredSinceTurnRef.current = false;
    }
    if (turned && (action.type === "start" || action.type === "next" || action.type === "back" || action.type === "closeFilter")) {
      persist(next);
      if (next.filter !== null) syncAttemptHistory(next);
    }
    if (isResultView(next) && !isResultView(previous)) {
      arrive(next, resultRecordedRef.current ? "return" : "fresh");
      enterResult(next);
    }
  };

  // -- 시작, 이어 하기, 다시 하기 ---------------------------------------------------

  const handleStart = (): void => {
    if (flowRef.current.started) return;
    const random = injected?.random ?? Math.random;
    resultRecordedRef.current = false;
    attemptAtRef.current = null;
    // 새 시도: 앞 시도의 단계 상태와 결과 전에 고른 글자의 보관본이 이 시도의 결과와 견줘지지 않게 지운다.
    stage.reset();
    wipeLetterStorage();
    setAutosaveNote(null);
    setNoticeText("");
    send({ type: "start", formBit: random() < 0.5 ? 0 : 1 });
    captureWeddingCodeEvent("wedding_code_started", {
      version: WEDDING_CODE_V40_VERSION,
      scene_total: V40_COUNTS.screens,
      has_partner_link: contextRef.current.partner !== null,
    });
  };

  const handleResume = (): void => {
    const current = bootRef.current;
    if (current.status !== "ready" || current.saved === null) return;
    const saved = current.saved;
    const next = initialFlowState(bank, { pack: viewportPack(), snapshot: saved.snapshot });
    flowRef.current = next;
    setFlow(next);
    lastTurnAtRef.current = Date.now();
    answeredSinceTurnRef.current = false;
    expectedRawRef.current = saved.raw;
    setSave("saved", saved.savedAt);
    setUnsaved(false);
    setAutosaveNote(null);
    setNoticeText("");
    updateBoot({ saved: null });
    resultRecordedRef.current = false;
    attemptAtRef.current = null;
    if (isResultView(next)) arrive(next, "return");
    settleStagesForResumed(next);
  };

  /** 저장된 답을 지우고 처음부터 시작한다(하던 답 카드가 미리 알린 대로). 지난번 비교 기록은 남긴다. */
  const handleStartOver = (): void => {
    const current = bootRef.current;
    if (current.status !== "ready") return;
    let issue = current.issue;
    if (current.storage !== null) {
      const cleared = clearProgress(current.storage);
      if (cleared.status === "cleared") expectedRawRef.current = null;
      else issue = "unavailable";
    }
    updateBoot({ saved: null, issue });
    captureWeddingCodeEvent("wedding_code_restarted", { version: WEDDING_CODE_V40_VERSION });
    handleStart();
  };

  const handleAutosaveChange = (next: AutosavePreference): void => {
    const current = bootRef.current;
    if (current.status !== "ready" || current.storage === null) return;
    const written = writeAutosavePreference(current.storage, next);
    if (written.status === "saved") {
      expectedRawRef.current = null;
      setAutosaveNote(next === "on" ? "turnedOn" : "turnedOff");
      if (next === "off") {
        updateBoot({ pref: "off", saved: null, legacy: null, issue: null });
        setSave("off");
      } else {
        updateBoot({ pref: "on" });
        setSave(null);
        persist(flowRef.current);
      }
      return;
    }
    // 저장을 바꾸지 못했다: 끄려던 것이면 적어도 더 쓰지 않는다. 지웠다고는 말하지 않는다.
    setAutosaveNote(null);
    updateBoot({ pref: next === "off" ? "off" : current.pref, issue: "unavailable" });
    setSave("unavailable");
  };

  /** 처음부터 다시 하기(확인은 결과 화면의 확인 창이 이미 받았다). 이 기기의 진행 저장을 지우고 입구에 알린다. */
  const handleRestart = (): void => {
    const current = bootRef.current;
    let message = "";
    if (current.status === "ready" && current.storage !== null && contextRef.current.both === null) {
      if (clearProgress(current.storage).status !== "cleared") message = V40_COPY.manage.clear.failed;
    }
    // onRestart 가 주어지면 입구가 화면을 새로 만들고 resetLocally 를 거치지 않으므로 보관본은 여기서(onRestart 를 부르기 앞에서) 지운다.
    if (!wipeLetterStorage()) message = V40_COPY.manage.clear.failed;
    expectedRawRef.current = null;
    captureWeddingCodeEvent("wedding_code_restarted", { version: WEDDING_CODE_V40_VERSION });
    if (onRestart) {
      onRestart(message === "" ? undefined : message);
      return;
    }
    resetLocally(message, false);
  };

  /** 입구의 도움 없이 이 화면 안에서 처음으로 돌아간다. keepPartner 이면 받은 링크는 그대로 둔다(내 답만 다시). */
  const resetLocally = (message: string, keepPartner: boolean): void => {
    const next = initialFlowState(bank, { pack: viewportPack() });
    flowRef.current = next;
    setFlow(next);
    lastTurnAtRef.current = 0;
    answeredSinceTurnRef.current = false;
    resultRecordedRef.current = false;
    attemptAtRef.current = null;
    lastSceneRef.current = null;
    introSentRef.current = false;
    comparisonSentRef.current = false;
    expectedRawRef.current = null;
    stage.reset();
    setPreviousEntry(null);
    setUnsaved(false);
    setAutosaveNote(null);
    setNoticeText(message);
    setSave(null);
    updateBoot({ saved: null, issue: null });
    if (!keepPartner) {
      updateContext({ partner: null, both: null, guess: null });
      setLinkLost(null);
      clearAddressTail(null);
    }
  };

  /** 받은 링크로 열어 답을 마쳤는데 글자를 정하지 못한 사람이 다시 하기를 누른다. 받은 링크는 그대로 둔다. */
  const handleRestartKeepingPartner = (): void => {
    const current = bootRef.current;
    const lettersCleared = wipeLetterStorage();
    if ((current.status === "ready" && current.storage !== null && clearProgress(current.storage).status !== "cleared") || !lettersCleared) {
      resetLocally(V40_COPY.manage.clear.failed, true);
    } else {
      resetLocally("", true);
    }
    captureWeddingCodeEvent("wedding_code_restarted", { version: WEDDING_CODE_V40_VERSION });
  };

  const handleClearStorage = (): boolean => {
    const current = bootRef.current;
    if (current.status !== "ready" || current.storage === null) return false;
    const cleared = clearProgress(current.storage).status === "cleared" && clearHistory(current.storage).status === "cleared";
    // 결과 전에 고른 글자도 같이 지운다(저장소와 화면 둘 다). 셋 모두 지워졌을 때만 지웠다고 말한다.
    const lettersCleared = wipeLetterStorage();
    if (cleared) {
      expectedRawRef.current = null;
      setPreviousEntry(null);
      setSave(null);
    }
    if (lettersCleared) stage.setLetterGuess(null);
    return cleared && lettersCleared;
  };

  // -- 창끼리 저장이 어긋났을 때 ---------------------------------------------------------

  /** 다른 창이 저장한 답으로 이어 한다. 불러올 것이 없으면 이 창의 답을 그대로 저장한다. */
  const handleLoadSaved = (): void => {
    const current = bootRef.current;
    if (current.status !== "ready" || current.storage === null) return;
    const read = readProgress(current.storage, bank, clock());
    if (read.status === "ready") {
      const next = initialFlowState(bank, { pack: viewportPack(), snapshot: read.snapshot });
      flowRef.current = next;
      setFlow(next);
      lastTurnAtRef.current = Date.now();
      answeredSinceTurnRef.current = false;
      expectedRawRef.current = read.raw;
      setSave("saved", read.savedAt);
      setUnsaved(false);
      resultRecordedRef.current = false;
      attemptAtRef.current = null;
      if (isResultView(next)) arrive(next, "return");
      settleStagesForResumed(next);
      return;
    }
    expectedRawRef.current = read.raw;
    setSave(null);
    persist(flowRef.current);
  };

  /** 이 창의 답으로 다시 저장한다. 다른 창이 저장한 답은 사라진다(단추를 누른 것이 그 확인이다). */
  const handleKeepThis = (): void => {
    const current = bootRef.current;
    if (current.status !== "ready" || current.storage === null) return;
    expectedRawRef.current = readProgress(current.storage, bank, clock()).raw;
    setSave(null);
    persist(flowRef.current);
  };

  // -- 결과 화면의 동작 ---------------------------------------------------------------

  const handleCopyCode = async (text: string): Promise<boolean> => {
    const write = (injected?.shareEnv ?? browserShareEnv()).writeText;
    if (write === undefined) return false;
    try {
      await write(text);
      return true;
    } catch {
      return false;
    }
  };

  const handleLinkSent = (event: ShareSentEvent): void => {
    if (isRealClipboardCopy(event)) captureWeddingCodeEvent("wedding_code_share_copied", { version: WEDDING_CODE_V40_VERSION, placement: "link" });
  };

  const handleOpenTaste = (): void => {
    captureWeddingCodeEvent("wedding_code_taste_clicked", { version: WEDDING_CODE_V40_VERSION, placement: "result" });
  };

  const handleStartOwn = (): void => {
    if (onRestart) onRestart();
    else resetLocally("", false);
  };

  // -- 단계 화면의 동작(4.1 단계 2). 통계도 링크도 만지지 않는다: 고른 것은 메모리, 글자 고르기는 자동 저장이 켜졌을 때만 이 브라우저에도 둔다 -----------------------

  const currentResult = (): V40Result => buildResult(bank, flowRef.current.formBit, flowRef.current.responses);

  /** 결과 보기: 고른 글자를 메모리에 두고(자동 저장이 켜져 있을 때만 이 브라우저에도. 고른 것이 하나도 없으면 이전 보관본을 지운다) 다음 단계로 간다. */
  const handleLetterContinue = (guess: LetterGuess | null): void => {
    stage.setLetterGuess(guess);
    saveLetterGuess(letterPortOf(), guess, flowRef.current.formBit, clock());
    stage.closeLetterGate();
    afterLetter(currentResult());
  };

  /** 고르지 않고 결과 보기: 메모리와 이 브라우저의 이전 보관본을 비우고 다음 단계로 간다. */
  const handleLetterSkip = (): void => {
    stage.setLetterGuess(null);
    saveLetterGuess(letterPortOf(), null, flowRef.current.formBit, clock());
    stage.closeLetterGate();
    afterLetter(currentResult());
  };

  /**
   * 이전: 단계만 닫는다. 끝난 것으로 치지 않아서 마지막 질문에서 다시 다음을 누르면 이 화면이 다시 뜬다.
   * 지금까지 고른 것은 메모리에만 둔다(이 브라우저에 쓰지 않는다: 쓰는 것은 「결과 보기」를 눌렀을 때뿐이다). 화면이 다시 뜨면 그대로 돌려준다.
   */
  const handleLetterBack = (guess: LetterGuess | null): void => {
    stage.setLetterGuess(guess);
    stage.closeLetterGate();
    send({ type: "back" });
  };

  /** 받는 사람의 서로 짐작하기를 끝냈다(마치기 또는 건너뛰기): 내 고름은 메모리에만 두고 두 사람 결과로 간다. */
  const handlePairReceiverDone = (answers: GuessAnswers | null): void => {
    stage.setOwnGuess(answers);
    stage.closePair();
    stage.setDone(true);
  };

  /** 보내는 사람이 결과 화면의 카드로 연 서로 짐작하기를 닫는다. 결과 화면이 다시 그려지므로 닫은 뒤 초점은 카드 제목으로 돌아간다. */
  const handlePairSenderDone = (answers: GuessAnswers | null): void => {
    stage.setOwnGuess(answers);
    stage.focusTargetRef.current = "pair";
    stage.closePair();
  };

  /** 고른 것 없이 나갈게요: 고른 것을 버리고 나간다(이미 끝낸 짐작이 있으면 그것은 그대로다). */
  const handlePairLeave = (): void => {
    if (stage.pairStage === "receiver") {
      stage.setOwnGuess(null);
      stage.closePair();
      stage.setDone(true);
      return;
    }
    stage.focusTargetRef.current = "pair";
    stage.closePair();
  };

  // -- 부팅: 주소 해석이 끝난 뒤 저장소를 읽는다 --------------------------------------------

  // 입구는 주소의 # 뒤를 하이드레이션 뒤에야 읽는다. 그 전에 저장소를 읽거나 시작 화면을 봤다고 알리면 링크를 연 사람을 링크 없는 사람으로 세게 된다.
  // 입구가 이 값을 바꿔 넘기면 늦게 불러오는 경계가 서버 화면을 이어받지 못하므로, 본체가 스스로 하이드레이션이 끝났는지 안다.
  const settled = useSyncExternalStore(noSubscription, settledInBrowser, unsettledOnServer);
  useEffect(() => {
    if (!resolved || !settled || bootRef.current.status === "ready") return;
    const linked = contextRef.current;
    if (linked.partner !== null || linked.both !== null) clearAddressTail(linked.both !== null ? "both" : "partner");
    else setLinkLost(readOpenedMark());
    const at = clock();
    const handle = injected?.storage !== undefined ? injected.storage : browserStorage();
    let next: BootReady;
    if (handle === null) {
      next = { status: "ready", storage: null, pref: "on", issue: "unavailable", saved: null, legacy: null, detected: null, letterPort: null };
    } else if (linked.both !== null) {
      // 두 사람 결과: 저장에 쓰지 않는다. 읽기만 되는 저장소로 「나」 표시만 알아본다.
      const readable = readOnlyStorage(handle);
      let detected: Perspective | null = null;
      if (readAutosavePreference(readable) === "on") {
        const read = readProgress(readable, bank, at);
        if (read.status === "ready") detected = detectPerspective(bank, decodedFromSnapshot(read.snapshot), linked.both.first, linked.both.second);
      }
      next = { status: "ready", storage: handle, pref: "on", issue: null, saved: null, legacy: null, detected, letterPort: null };
    } else {
      const pref = readAutosavePreference(handle);
      const probe = probeLegacyV31Progress(handle, at);
      let saved: SavedProgress | null = null;
      let issue: StorageIssue | null = null;
      if (pref === "on") {
        const read = readProgress(handle, bank, at);
        // 읽기는 아무것도 쓰지 않는다. 기간이 지난 저장(진행과 기록)은 여기서 실제로 지우고, 지웠을 때만 지웠다고 알린다.
        const purged = purgeExpired(handle, bank, at);
        expectedRawRef.current = read.status === "expired" && purged.progress ? null : read.raw;
        if (read.status === "ready") saved = { snapshot: read.snapshot, savedAt: read.savedAt, raw: read.raw };
        else if (read.status === "expired") issue = purged.progress ? "expired" : null;
        else if (read.status === "invalid" || read.status === "unavailable") issue = read.status;
      }
      // 결과 전에 고른 글자(4.1 단계 2): 그 화면이 켜져 있을 때만 포트를 만든다(꺼져 있으면 저장소를 읽지도 쓰지도 않는다). 기간이 지난 것은 읽으며 지우고,
      // 이어 할 진행이 없는데 보관본만 남은 것(고아)과 읽을 수 없는 것은 지운다. 이어 할 진행이 있으면 이어 하기 때 결과 쪽일 때만 화면에 올린다.
      let letterPort: ExtraPort | null = null;
      if (stages.letterGuess) {
        letterPort = createExtraPort(handle, "letterGuess", { honorAutosave: true });
        if (pref === "on") {
          const load = loadLetterGuess(letterPort, at);
          if (load.status === "invalid" || (load.status === "ready" && saved === null)) clearLetterGuess(letterPort);
        }
      }
      next = { status: "ready", storage: handle, pref, issue, saved, legacy: probe.present ? { savedAt: probe.savedAt } : null, detected: null, letterPort };
    }
    bootRef.current = next;
    setBoot(next);
    if (handle === null) setSave("unavailable");
    // 주소 해석이 끝난 때(resolved 이고 하이드레이션이 끝난 때) 한 번만 읽는다. 시계와 시험용 저장소는 마운트 때 정해져 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, settled]);

  // -- 화면 크기에 맞는 묶음 ---------------------------------------------------------------

  const bootStatus = boot.status;
  useEffect(() => {
    if (bootStatus !== "ready") return;
    send({ type: "repack", pack: viewportPack() });
    return watchViewportPack((pack) => send({ type: "repack", pack }));
    // send 는 매번 새로 만들어지지만 refs 로만 일하므로 한 번 거는 것으로 충분하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootStatus]);

  // -- 그릴 것을 계산 ------------------------------------------------------------------------------

  const page = flow.pages[flow.pageIndex];
  // 문항 뷰는 쪽의 문항 목록으로 정한다. 쪽 key(q:<첫 문항>)로 정하면 안 된다: 화면이 낮아졌다 높아지면(repack) 문항 하나짜리 쪽과 문항 둘짜리 쪽이
  // 같은 key 를 가져서, 뷰가 첫 문항 것만 남고 둘째 문항이 화면에서 사라진다(다음은 그 문항이 비었다고 하는데 화면에는 없다).
  const itemsKey = page?.kind === "questions" ? page.itemIds.join(",") : null;
  const views = useMemo(() => {
    if (itemsKey === null || page?.kind !== "questions") return [];
    return page.itemIds.flatMap((id) => {
      const item = bank.byId.get(id);
      return item === undefined ? [] : [present(item, flow.formBit)];
    });
    // page 는 itemsKey 로 정해진다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, flow.formBit]);

  const ownFinished = flow.started && isResultView(flow);
  const ownDecoded = useMemo<DecodedCode | null>(
    () => (ownFinished ? { formBit: flow.formBit, responses: flow.responses } : null),
    [ownFinished, flow.formBit, flow.responses],
  );
  const ownResult = useMemo(() => (ownDecoded === null ? null : buildResult(bank, ownDecoded.formBit, ownDecoded.responses)), [ownDecoded]);
  const quotes = useMemo(
    () => (ownDecoded === null || ownResult === null ? [] : ownResult.axes.map((axis) => pickQuotes(bank, ownDecoded.responses, axis))),
    [ownDecoded, ownResult],
  );
  const selfLines = useMemo(
    () => (ownDecoded === null || ownResult === null ? [] : ownResult.axes.map((axis) => selfLine(bank, ownDecoded.responses, axis))),
    [ownDecoded, ownResult],
  );
  const coupleResult = useMemo(() => {
    if (context.both !== null) return compareCouple(bank, context.both.first, context.both.second);
    if (context.partner !== null && ownDecoded !== null && ownResult !== null && ownResult.code !== null) return compareCouple(bank, context.partner, ownDecoded);
    return null;
  }, [context.both, context.partner, ownDecoded, ownResult]);

  // -- 이용 통계: 고지한 이벤트와 개수만 ---------------------------------------------------------

  const showsIntro = boot.status === "ready" && !flow.started && context.both === null;
  // 두 사람 비교를 연 것으로 세는 때: 받는 사람이 글자 고르기나 서로 짐작하기 화면에 있는 동안은 아직 비교 화면이 아니다(깔때기 지표의 정의가 바뀌지 않게).
  const showsCouple = boot.status === "ready" && coupleResult !== null && !stage.letterGate && stage.pairStage !== "receiver";

  useEffect(() => {
    if (!showsIntro || introSentRef.current) return;
    introSentRef.current = true;
    captureWeddingCodeEvent("wedding_code_intro_viewed", {
      version: WEDDING_CODE_V40_VERSION,
      scene_total: V40_COUNTS.screens,
      has_partner_link: hasPartnerLink,
      placement: "intro",
    });
  }, [showsIntro, hasPartnerLink]);

  const questionPage = boot.status === "ready" && flow.started && page?.kind === "questions" ? page : null;
  useEffect(() => {
    if (questionPage === null) return;
    // 화면(scene) 하나에 한 번. 세로가 짧은 화면은 한 화면의 문항 둘을 쪽 둘로 나누지만 화면 번호는 같으므로 쪽 key 가 아니라 화면 번호로 센다
    // (그렇지 않으면 같은 사람이 같은 질문을 풀어도 기기 높이에 따라 scene_reached 개수가 달라진다).
    const key = `${flow.filter === null ? "flow" : "edit"}:${questionPage.screen}`;
    if (lastSceneRef.current === key) return;
    lastSceneRef.current = key;
    captureWeddingCodeEvent("wedding_code_scene_reached", {
      version: WEDDING_CODE_V40_VERSION,
      scene_index: questionPage.screen + 1,
      scene_total: V40_COUNTS.screens,
      has_partner_link: hasPartnerLink,
      placement: placementOf(flow),
    });
  }, [questionPage, flow, hasPartnerLink]);

  useEffect(() => {
    if (!showsCouple || comparisonSentRef.current) return;
    comparisonSentRef.current = true;
    captureWeddingCodeEvent("wedding_code_comparison_viewed", { version: WEDDING_CODE_V40_VERSION, scene_total: V40_COUNTS.screens });
  }, [showsCouple]);

  // -- 나가기 경고: 지금 나가면 잃는 것이 있을 때만 --------------------------------------------------

  const savedShown: SaveState | null = boot.status !== "ready" ? null : boot.storage === null ? "unavailable" : boot.pref === "off" ? "off" : saveState;
  const midFlow =
    boot.status === "ready" &&
    context.both === null &&
    flow.started &&
    (page?.kind === "questions" || page?.kind === "rest" || page?.kind === "selfIntro") &&
    Object.keys(flow.responses).length + Object.keys(flow.drafts).length > 0;
  // 받은 링크의 상대 답은 메모리에만 있어서 새로고침하면 사라진다. 저장돼 있어도 경고한다.
  // 받는 사람이 단계 화면(글자 고르기, 서로 짐작하기)에 있는 동안에도 같다(midFlow 의 정의는 그대로이고 단계 화면은 질문 쪽이 아니라서 따로 넓힌다).
  const receiverInStage = context.partner !== null && (stage.letterGate || stage.pairStage === "receiver");
  const warnOnLeave = (midFlow || receiverInStage) && (context.partner !== null || savedShown !== "saved" || unsaved);
  useEffect(() => {
    if (!warnOnLeave) return;
    const listener = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [warnOnLeave]);

  // beforeunload 는 iOS 사파리와 대부분의 앱 안 브라우저(카카오톡 등)에서 불리지 않는다. 그런 곳에서는 다른 앱으로 넘어가거나 창을 닫을 때
  // 지금 쪽에서 고른 답(다음을 누르기 전이라 아직 쓰지 않은 답)이 조용히 사라졌다. 화면이 숨겨질 때(visibilitychange)와 쪽을 떠날 때(pagehide)
  // 저장하지 않은 답이 있으면 한 번 더 쓴다. 자동 저장이 꺼져 있거나 저장이 막혔으면 persist 가 아무것도 쓰지 않는다.
  useEffect(() => {
    if (!midFlow) return;
    const flushUnsaved = (): void => {
      if (unsavedRef.current) persist(flowRef.current);
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flushUnsaved();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flushUnsaved);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flushUnsaved);
    };
    // persist 는 refs 로만 일하므로 midFlow 가 바뀔 때만 다시 건다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midFlow]);

  // 서로 짐작하기를 닫고 결과 화면이 다시 그려진 뒤: 초점이 화면 맨 위로 떨어지지 않게 진입 카드의 제목으로 돌려준다(핸들러가 적어 두고 여기서 읽는다).
  // 상태를 바꾸지 않는다(DOM 초점과 스크롤뿐). 단계 화면이 닫히는 순간 한 번만 돈다.
  // 한 박자 늦게 옮긴다: 새로 그려진 결과 화면 뿌리가 자기 효과로 초점을 가져가는데 개발 서버(StrictMode)에서는 그 효과가 한 번 더 돌아
  // 이 효과가 먼저 옮긴 초점을 다시 뿌리로 가져가 버린다. 둘이 다 끝난 뒤에 옮기면 어느 쪽에서도 초점은 카드 제목에 남는다.
  const pairStageOpen = stage.pairStage !== null;
  const focusTargetRef = stage.focusTargetRef;
  useEffect(() => {
    if (pairStageOpen || focusTargetRef.current === null) return;
    focusTargetRef.current = null;
    const timer = window.setTimeout(() => {
      const heading = document.querySelector<HTMLElement>('[data-section-card="pair-guess-entry"] > h2, [data-section-card="pair-guess-entry"] > h3');
      if (heading === null) return;
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
      heading.scrollIntoView?.({ block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pairStageOpen, focusTargetRef]);

  // -- 그리기 -----------------------------------------------------------------------------------------

  if (boot.status !== "ready") {
    // 링크 없이 연 입구(서버가 그리는 모든 경우)는 저장소를 읽기 전에도 시작 화면을 그린다. 서버 HTML 에 제목과 소개 글이 들어가는 까닭이다.
    // 저장 상태를 모르는 동안 시작 단추는 누를 수 없고(pending), 서버와 하이드레이션 첫 그림이 같은 화면이다. 저장소를 읽으면 같은 화면이 속성만 바꿔 이어진다.
    // 받은 링크와 두 사람 결과 링크는 주소의 # 뒤에 있어서 서버가 볼 수 없다. 그 갈래는 하이드레이션 뒤에 새로 만들어지고 읽는 동안 불러오는 중 글을 보인다.
    if (!hasPartnerLink) {
      return (
        <IntroScreen
          pending
          embedded={embedded}
          notice={noticeText !== "" ? noticeText : null}
          autosave="on"
          // 이 화면은 두 단추를 누를 수 없게 그리므로 아래 콜백은 불리지 않는다.
          onAutosaveChange={() => undefined}
          onStart={() => undefined}
        />
      );
    }
    return (
      <p role="status" data-v40-loading="" className={loadingClass}>
        {V40_COPY.common.loadingLabel}
      </p>
    );
  }

  const resumeCard = boot.saved === null ? null : { savedAt: boot.saved.savedAt, onResume: handleResume, onStartOver: handleStartOver };

  // 두 사람 결과 화면의 구역 제목 수준(CoupleResult 안의 구역과 같다: 라운지 안에서는 한 단계 아래).
  const coupleSectionLevel = embedded ? 3 : 2;
  /** 「짐작과 답」 구역(서로 짐작하기). 비교는 링크가 정한 먼저/나중 답한 사람 순서대로 하고, 나 기준 전환은 이름표만 바꾼다. 꺼진 화면이면 그리지 않는다. */
  const guessSectionFor = (first: GuessAnswers | null, second: GuessAnswers | null) =>
    stages.pairGuess
      ? (perspective: Perspective | null) => (
          <CoupleGuessSection
            comparison={compareGuesses(first, second)}
            perspective={perspective}
            headingLevel={coupleSectionLevel}
            idPrefix="wc40-couple-guess"
          />
        )
      : undefined;

  // 두 사람 결과 링크: 내 답을 묻지 않고 바로 나란히 보여 준다.
  if (context.both !== null && coupleResult !== null) {
    // 바깥 구역에는 이름을 주지 않는다: 안쪽 CoupleResult 가 같은 이름(우리 둘의 웨딩코드)의 구역이라 이름이 겹친다.
    // 새로고침 안내는 제목과 고지 뒤에 CoupleResult 안에서 붙는다(경고가 제목보다 먼저 읽히지 않게).
    // 짐작과 답은 링크에서 읽은 값만으로 그린다(이 화면은 이 브라우저에 아무것도 쓰지 않는다).
    return (
      <ScreenSection focusKey="couple" embedded={embedded}>
        <CoupleResult
          result={coupleResult}
          detectedPerspective={boot.detected}
          onStartOwn={handleStartOwn}
          embedded={embedded}
          note={<span data-couple-reload-note="">{V40_CLIENT_COPY.coupleReloadNote}</span>}
          guessSection={guessSectionFor(context.guess?.first ?? null, context.guess?.second ?? null)}
        />
      </ScreenSection>
    );
  }

  if (!flow.started) {
    if (context.partner !== null) {
      return (
        <ReceiverScreen
          embedded={embedded}
          autosave={boot.pref}
          onAutosaveChange={handleAutosaveChange}
          autosaveNote={autosaveNote}
          storageIssue={boot.issue === "unavailable" ? "unavailable" : null}
          legacyPresent={boot.legacy !== null}
          saved={boot.saved === null ? null : { savedAt: boot.saved.savedAt, onKeepMine: handleResume, onUseLink: handleStartOver }}
          guessNote={stages.pairGuess && context.guess?.first != null ? V40_COPY.guess.receiverNote : undefined}
          onStart={handleStart}
        />
      );
    }
    return (
      <IntroScreen
        embedded={embedded}
        notice={noticeText !== "" ? noticeText : linkLost !== null ? V40_CLIENT_COPY.linkLost.intro[linkLost] : null}
        autosave={boot.pref}
        onAutosaveChange={handleAutosaveChange}
        autosaveNote={autosaveNote}
        legacy={boot.legacy}
        resume={resumeCard}
        storageIssue={boot.issue}
        onStart={handleStart}
      />
    );
  }

  if (page === undefined) return null;
  const segments = progressSegments(bank, flow);

  if (page.kind === "questions") {
    const firstQuestion = flow.pages.findIndex((entry) => entry.kind === "questions");
    const answers: Record<ItemId, ViewAnswer | null> = {};
    for (const id of page.itemIds) answers[id] = viewAnswerOf(bank, flow, id);
    // 필터 흐름의 첫 쪽에서도 이전이 있다: 사람이 결과에서 연 것이면 결과로, 결과 앞에서 저절로 열린 넘어간 질문 다시 보기이면 마지막 질문 화면으로 돌아간다(리듀서가 정한다).
    const canGoBack = flow.filter !== null ? true : flow.pageIndex > firstQuestion;
    // 결과 앞에 단계 화면(글자 고르기, 받는 사람의 서로 짐작하기)이 아직 끼어들 수 있으면 마지막 질문의 단추는 「결과 보기」가 아니라 「다음」이다.
    // 결과 쪽 필터(넘어간 질문 다시 보기)에서도 같고, 그때는 「그대로 결과 보기」 단추의 이름을 「다시 보기 마치기」로 바꾼다.
    // 아래 단추의 이름 「다음」을 그대로 쓰면 한 화면에 이름이 같은 단추 둘이 생긴다(위는 다시 보기를 끝내고 아래는 다음 넘어간 질문으로 간다).
    const stagesPending = isStagePending(factsOf(context), stage.done);
    const nextIsResult =
      (flow.filter !== null ? flow.pageIndex >= flow.pages.length - 1 : flow.pages[flow.pageIndex + 1]?.kind === "result") && !stagesPending;
    return (
      <QuestionScreen
        page={page}
        views={views}
        answers={answers}
        notice={flow.notice}
        segments={segments}
        filter={flow.filter}
        canGoBack={canGoBack}
        nextIsResult={nextIsResult}
        leaveEditLabel={stagesPending && flow.filter?.kind === "skipped" ? V40_COPY.edit.skippedReviewFinishButton : undefined}
        embedded={embedded}
        saveState={savedShown}
        receivedNote={context.partner !== null && flow.filter === null && flow.pageIndex === firstQuestion}
        onAnswer={(itemId, answer) => send({ type: "answer", itemId, answer })}
        onNext={() => send({ type: "next" })}
        onBack={() => send({ type: "back" })}
        onLeaveEdit={flow.filter === null ? undefined : () => send({ type: "closeFilter" })}
        onLoadSaved={handleLoadSaved}
        onKeepThis={handleKeepThis}
      />
    );
  }

  if (page.kind === "rest") {
    return (
      <RestCard
        after={page.after}
        segments={segments}
        saveState={savedShown}
        savedAt={savedAt}
        embedded={embedded}
        onContinue={() => send({ type: "next" })}
        onBack={() => send({ type: "back" })}
        onTurnOnAutosave={() => handleAutosaveChange("on")}
        onLoadSaved={handleLoadSaved}
        onKeepThis={handleKeepThis}
      />
    );
  }

  if (page.kind === "selfIntro") {
    return <SelfIntroCard segments={segments} embedded={embedded} onContinue={() => send({ type: "next" })} onBack={() => send({ type: "back" })} />;
  }

  if (page.kind !== "result" || ownResult === null) return null;

  // 결과 앞에 얹는 단계 화면(4.1 단계 2). 질문·쉼·정리 쪽 뒤, 결과 앞에 그린다. 두 화면의 뿌리는 data-screen 이름(letter-guess, pair-guess)을 가진다.
  if (stage.letterGate) {
    return (
      <LetterGuessScreen
        formBit={flow.formBit}
        initial={stage.letterGuess}
        storageMode={boot.storage === null || boot.issue === "unavailable" ? "blocked" : boot.pref === "off" ? "off" : "on"}
        embedded={embedded}
        turnGuardMs={injected?.turnGuardMs}
        onContinue={handleLetterContinue}
        onSkip={handleLetterSkip}
        onBack={handleLetterBack}
      />
    );
  }
  if (stage.pairStage !== null) {
    return (
      <GuessSetFlow
        role={stage.pairStage}
        formBit={flow.formBit}
        initial={stage.pairStage === "receiver" ? null : stage.ownGuess}
        embedded={embedded}
        turnGuardMs={injected?.turnGuardMs}
        onDone={stage.pairStage === "receiver" ? handlePairReceiverDone : handlePairSenderDone}
        onLeave={handlePairLeave}
      />
    );
  }

  // 결과 전에 먼저 고른 글자를 이 결과와 나란히 놓은 요약(고른 것이 없거나 견줄 수 없으면 none 이라 아무것도 그리지 않는다).
  const letterSummary = summarizeLetterGuess(ownResult, stage.letterGuess);

  // 받은 링크로 열어 내 답을 마쳤다.
  if (context.partner !== null) {
    if (coupleResult === null) return <NoCompareScreen embedded={embedded} onRestart={handleRestartKeepingPartner} />;
    const partner = context.partner;
    // 상대의 짐작은 오늘 상대의 a 가 실려 가는 것처럼 두 사람 링크에 다시 실려 간다. 서로 짐작하기 화면이 꺼져 있으면 아무 g 도 싣지 않는다.
    const partnerGuess = stages.pairGuess ? (context.guess?.first ?? null) : null;
    const ownGuess = stages.pairGuess ? stage.ownGuess : null;
    return (
      <ScreenSection focusKey="couple" embedded={embedded}>
        <CoupleResult
          result={coupleResult}
          detectedPerspective={null}
          initialPerspective="second"
          embedded={embedded}
          note={<span data-couple-reload-note="">{V40_COPY.receive.reloadNote}</span>}
          send={{
            buildUrl: () =>
              ownDecoded === null
                ? null
                : buildGatedShareUrlWithGuess(bank, shareOrigin, { code: partner, guess: partnerGuess }, { code: ownDecoded, guess: ownGuess }),
            onSent: handleLinkSent,
            env: injected?.shareEnv,
            // 링크에 실리는 짐작에 맞는 한 줄: 둘 다 있으면 두 사람의 것, 내가 건너뛰어 받은 상대의 것만 다시 실리면 그것만 말한다.
            // (내 것만 있는 경우는 받는 사람에게 없다: 상대의 짐작이 있어야 서로 짐작하기가 열린다. 그래도 있다면 내 것만 말한다.)
            guessNote:
              partnerGuess !== null && ownGuess !== null
                ? V40_COPY.guess.coupleSendInfo
                : partnerGuess !== null
                  ? V40_COPY.guess.coupleSendPartnerInfo
                  : ownGuess !== null
                    ? V40_COPY.guess.shareInfo
                    : undefined,
          }}
          guessSection={guessSectionFor(partnerGuess, ownGuess)}
          ownLetterGuessSlot={
            hasLetterGuessLines(letterSummary) ? (
              <LetterGuessClosedCard summary={letterSummary} headingLevel={coupleSectionLevel} idPrefix="wc40-couple-letter-guess" />
            ) : undefined
          }
        />
      </ScreenSection>
    );
  }

  // 혼자 보는 결과
  const openReview = skippedReviewIds(bank, flow.responses).length > 0;
  return (
    <ScreenSection label={V40_COPY.result.title} focusKey="result" embedded={embedded}>
      <ResultScreen
        result={ownResult}
        quotes={quotes}
        selfLines={selfLines}
        previous={previousEntry}
        onCopyCode={handleCopyCode}
        onReviewAxis={(axis: Axis) => send({ type: "openFilter", filter: { kind: "axis", axis } })}
        onReviewSkipped={
          openReview
            ? () => send({ type: "openFilter", filter: { kind: "skipped", itemIds: skippedReviewIds(bank, flowRef.current.responses) } })
            : undefined
        }
        onRestart={handleRestart}
        onClearStorage={handleClearStorage}
        onOpenTaste={handleOpenTaste}
        tasteHref={V40_TASTE_HREF}
        embedded={embedded}
        linkLostNote={linkLost === null ? undefined : V40_CLIENT_COPY.linkLost.result[linkLost]}
        letterGuessSlot={hasLetterGuessLines(letterSummary) ? <LetterGuessLines summary={letterSummary} headingLevel={2} /> : undefined}
        sendSlot={
          ownResult.code === null ? undefined : (
            <>
              {stages.pairGuess && !stage.guessCardHidden ? (
                <div className="mb-4">
                  <GuessEntryCard
                    state={stage.ownGuess === null ? "idle" : "done"}
                    removed={stage.guessRemoved}
                    onStart={() => stage.openPair("sender")}
                    onEdit={() => stage.openPair("sender")}
                    onRemove={() => stage.setOwnGuess(null, true)}
                    onDismiss={stage.hideGuessCard}
                  />
                </div>
              ) : null}
              {/* 짐작을 더하거나 빼면 링크 내용이 달라지므로 보내기 블록을 새로 그린다(주소 칸이 열려 있었다면 옛 링크가 남지 않게, 동의 체크와 초안도 처음으로). */}
              <ShareBlock
                key={stage.ownGuess === null ? "n" : "g"}
                env={injected?.shareEnv}
                onSent={handleLinkSent}
                guessNote={stage.ownGuess === null ? undefined : V40_COPY.guess.shareInfo}
                buildUrl={(option) =>
                  option === "withAnswers"
                    ? buildGatedShareUrlWithGuess(bank, shareOrigin, { code: { formBit: flow.formBit, responses: flow.responses }, guess: stage.ownGuess })
                    : buildQuestionOnlyUrl(shareOrigin, { explicitVersion: !weddingCodeDefaultsToV40() })
                }
              />
            </>
          )
        }
      />
    </ScreenSection>
  );
}

// ---------------------------------------------------------------------------
// 오류 경계와 바깥 틀
// ---------------------------------------------------------------------------

/**
 * 화면 그리기가 실패해도 빈 화면이 되지 않게 한다. 오류 내용은 어디에도 보내지 않는다(내용에 답이 섞일 수 있다).
 * 새로고침하면 받은 링크의 상대 답은 사라지므로 대체 화면 본문이 링크를 다시 열라고 말한다.
 */
class WeddingCodeV40Boundary extends Component<{ readonly embedded: boolean; readonly children: ReactNode }, { readonly failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return <BoundaryFallbackScreen embedded={this.props.embedded} onReload={() => window.location.reload()} />;
    return this.props.children;
  }
}

/** 시험에서 저장소, 시계, 난수, 공유 창을 바꿔 끼울 수 있는 틀(deps). 실제 화면은 아래 default export 를 쓴다. */
export function WeddingCodeV40ClientWithDeps(props: WeddingCodeV40ClientCoreProps) {
  const Root = props.embedded ? "div" : "main";
  return (
    <Root data-wedding-code-v40="" data-embedded={props.embedded ? "true" : "false"}>
      <WeddingCodeV40Boundary embedded={props.embedded === true}>
        <WeddingCodeV40Core {...props} />
      </WeddingCodeV40Boundary>
    </Root>
  );
}

export default function WeddingCodeV40Client(props: WeddingCodeV40ClientProps) {
  return <WeddingCodeV40ClientWithDeps {...props} />;
}
