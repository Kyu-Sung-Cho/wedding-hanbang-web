"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { V40_GUESS_SET, V40_GUESS_SET_ID } from "@/constants/weddingCodeV40Guess";
import { V40_GUESS_COPY } from "@/lib/weddingCode/v40/guess/guessCopy";
import { choiceAnswerOf, guessChoiceView, storedPickOf } from "@/lib/weddingCode/v40/guess/guessPresent";
import { GUESS_TURN_GUARD_MS } from "@/lib/weddingCode/v40/guess/types";
import type { GuessAnswers, GuessCard, GuessSlots } from "@/lib/weddingCode/v40/guess/types";
import type { ChoiceView, EscapeLabels, FormBit, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ChoiceInput } from "../ChoiceInput";
import { ActionBar, screenRootClass } from "../SectionCard";
import { bodyText, buttonFocusFix, captionText, cx, itemIds, noteText, stemText } from "../styles";
import { useScreenFocus } from "../useScreenFocus";

/**
 * 서로 짐작하기 세트 화면(빌드 계획 5.5, 트랙 F2). 첫 화면(안내와 시작), 장면 화면 여섯(화면당 장면 하나), 마치기.
 * 화면에는 번호, n/N, A/B 가 없다. ItemFrame 은 쓰지 않는다: ItemFrame 은 탈출구가 늘 둘이고 이름이 고정이며 누른 뒤 「계산에서 빼요」라고 말하는데,
 * 이 화면의 내 답에는 탈출구가 둘(제 상황과 안 맞아요, 지금은 넘어갈게요), 짐작에는 하나(잘 모르겠어요)이고 계산이 없다. 카드 둘에만 ChoiceInput 을 쓴다.
 *
 * 한 장면의 흐름: 장면 글, 내 답(카드 둘과 탈출구 둘), 내 답이 카드일 때만 짐작(카드 둘과 탈출구 하나). 내 답을 탈출구로 바꾸면 그 장면의 짐작을 지운다.
 * 카드 위아래는 내 폼 비트를 따른다(저장은 카드 기준이고 변환기는 guessPresent 한 쌍뿐이다). 한 장면의 두 물음은 같은 순서다.
 * 모든 화면 아래: 이전, 다음(마지막은 마치기), 고른 것 없이 나갈게요. 다음은 답 없이도 눌린다(선택이다).
 * 고른 것 없이 나갈게요는 고른 것을 버리고 나간다(onLeave: 부모는 짐작을 건드리지 않는다). 고른 것이 하나도 없이 마치면 onDone(null).
 *
 * 이 화면은 저장소, 주소, 통계를 만지지 않는다. 고른 것은 이 화면의 메모리에만 있고 부모가 onDone 으로만 받는다.
 * 첫 화면의 단추는 마운트 직후 turnGuardMs 안에 누른 것을 무시한다(앞 화면의 같은 자리 단추를 두 번 누른 것으로 본다).
 */

export interface GuessSetFlowProps {
  /** sender: 결과 화면의 「해 볼게요」, receiver: 받는 사람이 자기 답을 마친 뒤. 첫 화면 안내와 단추 무게가 다르다. */
  readonly role: "sender" | "receiver";
  /** 내 폼 비트. 카드 위아래를 정한다. */
  readonly formBit: FormBit;
  /** 이미 고른 것(고치기). 없으면 null. 마운트 때 한 번만 읽는다(고치려면 부모가 이 화면을 새로 그린다). */
  readonly initial: GuessAnswers | null;
  readonly embedded?: boolean;
  /** 첫 화면 단추의 두 번 누름 막기(밀리초). 0 이면 끈다. 기본 300. */
  readonly turnGuardMs?: number;
  /** 마치기. 고른 것이 하나도 없으면 null. */
  readonly onDone: (answers: GuessAnswers | null) => void;
  /** 고른 것 없이 나갈게요: 고른 것을 버리고 나간다. */
  readonly onLeave: () => void;
}

/** 내 답: 카드, 탈출구 둘, 아직 안 누름(null). */
type SelfState = GuessCard | "notmine" | "skip" | null;
/** 짐작: 카드, 탈출구, 아직 안 누름(null). */
type GuessState = GuessCard | "unsure" | null;
interface ScenePick {
  readonly self: SelfState;
  readonly guess: GuessState;
}

const SCENE_COUNT = V40_GUESS_SET.length;
const START_PAGE = 0;

/** 이미 고른 것에서 화면 상태를 만든다. 내 답이 없는 장면의 짐작은 묻지 않으므로 버린다(탈출구를 눌렀던 장면은 처음 상태로 돌아간다). */
function picksFrom(initial: GuessAnswers | null): readonly ScenePick[] {
  return V40_GUESS_SET.map((_, index): ScenePick => {
    const slot = initial?.slots[index];
    if (slot === undefined || slot.self === null) return { self: null, guess: null };
    return { self: slot.self, guess: slot.guess };
  });
}

/** 화면 상태를 링크용 고름으로. 고른 카드가 하나도 없으면 null. */
function answersFrom(picks: readonly ScenePick[]): GuessAnswers | null {
  const slots = picks.map((pick) => {
    const self = typeof pick.self === "number" ? pick.self : null;
    const guess = self !== null && typeof pick.guess === "number" ? pick.guess : null;
    return { self, guess };
  });
  if (!slots.some((slot) => slot.self !== null || slot.guess !== null)) return null;
  return { set: V40_GUESS_SET_ID, slots: slots as unknown as GuessSlots };
}

const escapeButtonClass = cx(
  "min-h-11! whitespace-normal! border border-paper-outline px-3! text-[13px]! font-normal!",
  buttonFocusFix,
);
const escapeButtonPressed = "border-[var(--hb-selected-line)]! bg-[var(--hb-selected-bg)]!";

interface EscapeButtonProps {
  readonly label: string;
  readonly pressed: boolean;
  readonly onPress: () => void;
  readonly kind: string;
}

/** 탈출구 단추. aria-pressed 이고 다시 눌러도 풀리지 않는다(푸는 길은 다른 답을 고르는 것이다). */
function EscapeButton({ label, pressed, onPress, kind }: EscapeButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      data-escape={kind}
      onClick={onPress}
      className={cx(escapeButtonClass, pressed && escapeButtonPressed)}
    >
      {pressed ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
      <span>{label}</span>
    </Button>
  );
}

export function GuessSetFlow({ role, formBit, initial, embedded = false, turnGuardMs = GUESS_TURN_GUARD_MS, onDone, onLeave }: GuessSetFlowProps): ReactElement {
  const uid = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const [page, setPage] = useState<number>(START_PAGE);
  const [picks, setPicks] = useState<readonly ScenePick[]>(() => picksFrom(initial));
  useScreenFocus(rootRef, `pair-guess:${page}`);

  // 마운트 시각은 효과에서 한 번 적고 누르는 핸들러에서만 읽는다(렌더 중에 시계와 ref 를 읽지 않는다).
  const mountedAt = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  const withinTurnGuard = (): boolean => {
    const at = mountedAt.current;
    return turnGuardMs > 0 && at !== null && Date.now() - at < turnGuardMs;
  };

  const copy = V40_GUESS_COPY;
  const escapes: EscapeLabels = { unsure: copy.unsureButton, notApplicable: copy.notMineButton };
  const onStartPage = page === START_PAGE;
  const sceneIndex = page - 1;
  const item = onStartPage ? null : V40_GUESS_SET[sceneIndex];
  const pick = onStartPage ? null : picks[sceneIndex];
  const headingId = `${uid}-heading`;
  // 이 화면이 한 페이지의 본문이면(라운지 안이 아니면) 제목은 그 페이지의 h1 이다(결과 전 글자 고르기 화면, 질문 화면과 같다). 라운지 안에서는 바깥 화면이 h1 을 가진다.
  const Title = embedded ? "h2" : "h1";

  const patch = (index: number, next: Partial<{ self: SelfState; guess: GuessState }>) => {
    setPicks((previous) => previous.map((entry, at) => (at === index ? { ...entry, ...next } : entry)));
  };
  const chooseSelfEscape = (index: number, which: "notmine" | "skip") => patch(index, { self: which, guess: null });

  const handleLeave = () => {
    if (onStartPage && withinTurnGuard()) return;
    onLeave();
  };
  const handleStart = () => {
    if (withinTurnGuard()) return;
    setPage(1);
  };
  const handleNext = () => {
    if (page >= SCENE_COUNT) onDone(answersFrom(picks));
    else setPage(page + 1);
  };
  const handlePrevious = () => setPage(Math.max(START_PAGE, page - 1));

  const startIsEqualWeight = role === "receiver";

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      data-screen="pair-guess"
      data-step={onStartPage ? "start" : "scene"}
      data-scene={item?.id}
      aria-labelledby={headingId}
      className={screenRootClass(embedded)}
    >
      {onStartPage ? (
        <div data-part="start">
          <Title id={headingId} className="text-xl font-semibold leading-snug text-[var(--hb-text-strong)]">
            {copy.title}
          </Title>
          <p className={cx(bodyText, "mt-3")}>{role === "receiver" ? copy.receiverIntro : copy.intro}</p>
          {/* 받는 사람은 결과 화면의 진입 카드(저장하지 않는다는 말이 있다)를 거치지 않고 이 화면으로 오므로 여기서 말한다. */}
          {role === "receiver" ? (
            <p className={cx(noteText, "mt-3")} data-receiver-storage="">
              {copy.receiverStorageNote}
            </p>
          ) : null}
          <p className={cx(noteText, "mt-3")}>{copy.skipNote}</p>
          <ActionBar embedded={embedded}>
            <div className="flex flex-col gap-3">
              <Button variant="primary" size="lg" fullWidth onClick={handleStart} data-nav="start">
                {copy.startButton}
              </Button>
              <Button variant={startIsEqualWeight ? "primary" : "secondary"} size="lg" fullWidth onClick={handleLeave} data-nav="leave">
                {copy.leaveButton}
              </Button>
            </div>
          </ActionBar>
        </div>
      ) : item !== null && pick !== null ? (
        <div key={item.id} data-part="scene">
          <Title id={headingId} className={captionText}>
            {item.caption}
          </Title>
          <p className={cx(stemText, "mt-1")}>{item.stem}</p>

          <SceneQuestion
            kind="self"
            idPrefix={`${uid}-self`}
            prompt={copy.prompts.self}
            note={null}
            view={guessChoiceView(item, formBit, escapes)}
            value={choiceAnswerOf(formBit, typeof pick.self === "number" ? pick.self : null)}
            onChoose={(option) => patch(sceneIndex, { self: storedPickOf(formBit, option) })}
            statusText={pick.self === "notmine" ? copy.escapeChosen.notmine : pick.self === "skip" ? copy.escapeChosen.skip : ""}
          >
            <EscapeButton kind="notmine" label={copy.notMineButton} pressed={pick.self === "notmine"} onPress={() => chooseSelfEscape(sceneIndex, "notmine")} />
            <EscapeButton kind="skip" label={copy.skipButton} pressed={pick.self === "skip"} onPress={() => chooseSelfEscape(sceneIndex, "skip")} />
          </SceneQuestion>

          {typeof pick.self === "number" ? (
            <SceneQuestion
              kind="guess"
              idPrefix={`${uid}-guess`}
              prompt={copy.prompts.guess}
              note={copy.guessNote}
              view={guessChoiceView(item, formBit, escapes)}
              value={choiceAnswerOf(formBit, typeof pick.guess === "number" ? pick.guess : null)}
              onChoose={(option) => patch(sceneIndex, { guess: storedPickOf(formBit, option) })}
              statusText={pick.guess === "unsure" ? copy.escapeChosen.unsure : ""}
            >
              <EscapeButton kind="unsure" label={copy.unsureButton} pressed={pick.guess === "unsure"} onPress={() => patch(sceneIndex, { guess: "unsure" })} />
            </SceneQuestion>
          ) : null}

          {/* 건너뛰기는 단추 줄(이전, 다음) 밖에 둔다: 줄이 한 줄 높이일 때만 문서의 아래쪽 스크롤 여백(초점이 가려지지 않음)이 맞는다. */}
          <div className="mt-6">
            <Button variant="ghost" size="md" fullWidth onClick={handleLeave} data-nav="leave" className={buttonFocusFix}>
              {copy.leaveButton}
            </Button>
          </div>

          <ActionBar embedded={embedded}>
            <div className="flex gap-3">
              <Button variant="secondary" size="lg" onClick={handlePrevious} data-nav="previous">
                <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
                {copy.previousButton}
              </Button>
              <Button variant="primary" size="lg" onClick={handleNext} data-nav="next" className="flex-1">
                {page >= SCENE_COUNT ? copy.finishButton : copy.nextButton}
                <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
              </Button>
            </div>
          </ActionBar>
        </div>
      ) : null}
    </section>
  );
}

interface SceneQuestionProps {
  readonly kind: "self" | "guess";
  readonly idPrefix: string;
  readonly prompt: string;
  readonly note: string | null;
  readonly view: ChoiceView;
  readonly value: ViewAnswer | null;
  readonly onChoose: (screenOption: number) => void;
  /** 탈출구를 누른 뒤 한 줄(없으면 빈 문자열). 알림 자리는 늘 문서에 둔다. */
  readonly statusText: string;
  /** 탈출구 단추들. */
  readonly children: ReactNode;
}

/** 물음 하나: 물음 글, 안내 한 줄(짐작 물음만), 카드 둘, 탈출구 단추, 탈출구를 누른 뒤 알림 한 줄. */
function SceneQuestion({ kind, idPrefix, prompt, note, view, value, onChoose, statusText, children }: SceneQuestionProps) {
  const ids = itemIds(idPrefix);
  return (
    <div data-question={kind} className="mt-6">
      <p id={ids.stem} className={stemText}>
        {prompt}
      </p>
      {note !== null ? <p className={cx(noteText, "mt-1")}>{note}</p> : null}
      <div className="mt-3">
        <ChoiceInput
          view={view}
          value={value}
          idPrefix={idPrefix}
          onAnswer={(answer) => {
            if (answer.fmt === "instant") onChoose(answer.option);
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
      <p role="status" aria-live="polite" aria-atomic="true" className={cx(noteText, statusText !== "" && "mt-2")}>
        {statusText}
      </p>
    </div>
  );
}

export default GuessSetFlow;
