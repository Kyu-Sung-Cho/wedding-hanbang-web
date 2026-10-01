"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { V40_AXIS_KEYS, V40_ESCAPES } from "@/constants/weddingCodeV40";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { letterGuessChoices } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import {
  V40_LETTER_GUESS_COPY,
  letterGuessCardText,
  letterGuessStorageNote,
  letterGuessTopicTitle,
} from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuess, LetterGuessStorageMode } from "@/lib/weddingCode/v40/letterGuess/types";
import type { ChoiceView, FormBit, Letter, ViewAnswer } from "@/lib/weddingCode/v40/types";
import { ChoiceInput } from "../ChoiceInput";
import { ActionBar, screenRootClass } from "../SectionCard";
import { bodyText, cx, itemIds, noteText, stemText } from "../styles";
import { useScreenFocus } from "../useScreenFocus";

export interface LetterGuessScreenProps {
  /** 이번 시도의 폼 비트. 글자 카드의 위아래 순서가 이것을 따른다(질문 화면과 같은 쪽으로 뒤집힌다). */
  readonly formBit: FormBit;
  /** 이미 골라 둔 것(이전 눌러 돌아왔거나 이 브라우저에 남아 있던 것). 없으면 null. */
  readonly initial: LetterGuess | null;
  /** 저장 안내 한 줄이 따르는 저장 상태. on 이 아니면 저장하지 않는다고 말한다. */
  readonly storageMode: LetterGuessStorageMode;
  /** 라운지(/preparation-style) 안에서 쓰는가. 제목 수준과 하단 여백이 달라진다. */
  readonly embedded?: boolean;
  /**
   * 화면이 뜬 직후 이 시간(밀리초) 안의 「결과 보기」와 「고르지 않고 결과 보기」 누름을 무시한다. 기본 300.
   * 마지막 질문의 「다음」과 이 화면의 주 단추는 같은 자리에 있어서 손가락이 두 번 닿으면 둘째 누름이 이 화면을 넘겨 버린다. 0 이면 끈다.
   */
  readonly turnGuardMs?: number;
  /** 결과 보기. 고른 것이 하나도 없으면 null. */
  readonly onContinue: (guess: LetterGuess | null) => void;
  /** 고르지 않고 결과 보기. */
  readonly onSkip: () => void;
  /**
   * 이전. 주면 단추를 그린다(마지막 질문으로 돌아간다). 지금까지 고른 것(없으면 null)을 함께 넘긴다:
   * 부모가 메모리에만 두었다가 이 화면이 다시 뜰 때 initial 로 돌려주면 이전을 눌러도 고른 것이 남는다(저장하지 않는다).
   */
  readonly onBack?: (guess: LetterGuess | null) => void;
}

/** 화면이 뜬 직후 두 번 눌림을 막는 시간(밀리초). 마지막 질문 화면의 값과 같다. */
const LETTER_GUESS_TURN_GUARD_MS = 300;
const ID_PREFIX = "wc40-letter-guess";

/** 주제 하나의 지금 상태: 글자를 골랐다, 「잘 모르겠어요」를 눌렀다, 아직 아무것도 안 눌렀다. */
type TopicPick = Letter | "none" | null;

function initialPicks(formBit: FormBit, initial: LetterGuess | null): readonly TopicPick[] {
  return V40_AXIS_KEYS.map((axis, index) => {
    const letter = initial?.[index] ?? null;
    return letter !== null && letterGuessChoices(formBit, axis).includes(letter) ? letter : null;
  });
}

/** 입력 컴포넌트가 알린 화면 답을 주제의 상태로 바꾼다. 「잘 모르겠어요」 카드는 고르지 않음(escape)으로 온다. */
function pickOf(answer: ViewAnswer, choices: readonly [Letter, Letter]): TopicPick {
  if (answer.fmt === "escape") return "none";
  if (answer.fmt === "instant") return choices[answer.option] ?? null;
  return null;
}

function valueOf(pick: TopicPick, choices: readonly [Letter, Letter]): ViewAnswer | null {
  if (pick === null) return null;
  if (pick === "none") return { fmt: "escape", which: "na" };
  return { fmt: "instant", option: pick === choices[0] ? 0 : 1 };
}

/** 고른 글자만 모은다. 「잘 모르겠어요」와 안 누른 주제는 null 이고, 하나도 안 골랐으면 전체가 null 이다. */
function guessOf(picks: readonly TopicPick[]): LetterGuess | null {
  const letterAt = (index: number): Letter | null => {
    const pick = picks[index];
    return pick === undefined || pick === "none" ? null : pick;
  };
  const letters: LetterGuess = [letterAt(0), letterAt(1), letterAt(2), letterAt(3)];
  return letters.every((letter) => letter === null) ? null : letters;
}

/**
 * 결과 전 글자 고르기 화면(끼어들기 화면: 진행 막대가 없다). 마지막 질문 뒤, 결과 앞에 한 번 뜬다.
 *
 * 위에서 아래로: 제목, 안내, 저장 안내 한 줄, 주제 네 개, 「고르지 않고 결과 보기」, 단추 줄(이전, 결과 보기).
 * 주제마다 그 주제의 두 글자(글자 이름과 뜻 한 줄)와 「잘 모르겠어요」를 고르기 입력(ChoiceInput)으로 보여 준다. 두 글자의 위아래는 폼 비트를 따른다.
 * 아무것도 안 골라도 결과 보기가 된다. 이 화면에는 고지 문장이 없고(시작, 받는 사람, 결과, 두 사람 결과에만 있다) 결과 글자를 암시하는 말도 없다.
 * 저장, 통계, 링크를 만지지 않는다: 고른 것은 콜백으로만 나가고, 보관본을 쓰는 일은 부모(클라이언트)가 한다.
 */
export function LetterGuessScreen({
  formBit,
  initial,
  storageMode,
  embedded = false,
  turnGuardMs = LETTER_GUESS_TURN_GUARD_MS,
  onContinue,
  onSkip,
  onBack,
}: LetterGuessScreenProps) {
  const titleId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const mountedAtRef = useRef(0);
  useScreenFocus(rootRef, "letter-guess");
  useEffect(() => {
    mountedAtRef.current = Date.now();
  }, []);

  const [picks, setPicks] = useState<readonly TopicPick[]>(() => initialPicks(formBit, initial));
  const copy = V40_LETTER_GUESS_COPY;

  const tooSoon = (): boolean => turnGuardMs > 0 && Date.now() - mountedAtRef.current < turnGuardMs;
  const handleContinue = () => {
    if (tooSoon()) return;
    onContinue(guessOf(picks));
  };
  const handleSkip = () => {
    if (tooSoon()) return;
    onSkip();
  };
  const handleBack = () => {
    onBack?.(guessOf(picks));
  };
  const choose = (index: number, choices: readonly [Letter, Letter], answer: ViewAnswer) => {
    setPicks((current) => current.map((pick, position) => (position === index ? pickOf(answer, choices) : pick)));
  };

  const scrollMargin = embedded
    ? "scroll-mt-24 scroll-mb-[calc(14rem+env(safe-area-inset-bottom))]"
    : "scroll-mt-24 scroll-mb-[calc(11rem+env(safe-area-inset-bottom))]";
  const Title = embedded ? "h2" : "h1";

  return (
    <section
      ref={rootRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-screen="letter-guess"
      className={screenRootClass(embedded)}
    >
      <Title id={titleId} className="text-2xl font-semibold leading-snug text-balance text-[var(--hb-text-strong)]">
        {copy.screen.title}
      </Title>
      <p className={cx(bodyText, "mt-3")}>{copy.screen.lead}</p>
      <p className={cx(noteText, "mt-2")} data-letter-guess-storage={storageMode}>
        {letterGuessStorageNote(storageMode)}
      </p>

      <div className="mt-6">
        {V40_AXIS_KEYS.map((axis, index) => {
          const choices = letterGuessChoices(formBit, axis);
          const prefix = `${ID_PREFIX}-${axis}`;
          const ids = itemIds(prefix);
          const title = letterGuessTopicTitle(axis);
          const view: ChoiceView = {
            id: prefix,
            caption: title,
            stem: title,
            escapes: { unsure: V40_ESCAPES.unsure, notApplicable: V40_ESCAPES.notApplicable },
            fmt: "instant",
            options: [{ text: letterGuessCardText(choices[0]) }, { text: letterGuessCardText(choices[1]) }],
            noneLabel: V40_ESCAPES.unsure,
          };
          return (
            <div
              key={axis}
              data-letter-guess-axis={axis}
              className={cx(scrollMargin, index > 0 && "mt-8 border-t border-[var(--hb-hairline)] pt-8")}
            >
              <p id={ids.stem} className={stemText}>
                {title}
              </p>
              <div className="mt-3">
                <ChoiceInput
                  view={view}
                  value={valueOf(picks[index] ?? null, choices)}
                  onAnswer={(answer) => choose(index, choices, answer)}
                  idPrefix={prefix}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8">
        <Button variant="secondary" size="lg" fullWidth onClick={handleSkip} data-letter-guess-action="skip">
          {copy.screen.skipButton}
        </Button>
      </div>

      <ActionBar embedded={embedded}>
        <div className="flex gap-3">
          {onBack ? (
            <Button variant="secondary" size="lg" onClick={handleBack} data-nav="previous">
              <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
              {V40_COPY.question.previousButton}
            </Button>
          ) : null}
          <Button variant="primary" size="lg" onClick={handleContinue} data-nav="next" className="flex-1">
            {copy.screen.continueButton}
            <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
          </Button>
        </div>
      </ActionBar>
    </section>
  );
}

export default LetterGuessScreen;
