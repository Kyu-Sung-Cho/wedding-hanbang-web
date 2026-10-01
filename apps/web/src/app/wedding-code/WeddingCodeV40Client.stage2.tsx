import { useRef, useState, type MutableRefObject } from "react";

import type { GuessAnswers } from "@/lib/weddingCode/v40/guess/types";
import type { LetterGuess } from "@/lib/weddingCode/v40/letterGuess/types";

/**
 * 웨딩코드 4.1 단계 2 의 단계 층 상태(결과 앞뒤에 클라이언트가 얹는 화면 둘: 결과 전 글자 고르기, 서로 짐작하기).
 *
 * reducer(flow.ts)는 두 화면을 모른다. 이 파일은 클라이언트 본체가 단계 상태를 한곳에 모아 쓰도록 하는 작은 훅과 순수 판단 함수만 낸다.
 * 이 파일은 이용 통계, 저장소, 링크 코덱을 가져오지 않는다(소스 가드가 훑는 파일이다. 통계와 저장은 본체가 한다).
 *
 * 상태와 ref 를 한 쌍으로 두는 것은 stagesDone 하나뿐이다: 렌더(단추 이름, 두 사람 비교를 열었는지)는 상태만 읽고, send 와 핸들러는 ref 만 읽는다.
 * ref 는 바뀌어도 다시 그리지 않으므로 렌더가 ref 를 읽으면 단추 이름이 낡는다.
 */

/** 받는 사람이 자기 답을 마친 뒤의 서로 짐작하기(receiver)와 보내는 사람이 결과 카드에서 여는 것(sender). */
export type PairStage = "receiver" | "sender";

/** 두 단계를 켜고 끄는 값. 클라이언트가 deps.stages 와 기능 켬 상수에서 정한다. */
export interface StageSwitches {
  readonly letterGuess: boolean;
  readonly pairGuess: boolean;
}

/** 단계를 정하는 데 필요한 링크와 결과의 사실. 값만 받는 순수 판단이라 시험이 표로 돌린다. */
export interface StageFacts {
  readonly stages: StageSwitches;
  /** 두 사람 결과 링크를 연 화면(내 답을 묻지 않는다). */
  readonly both: boolean;
  /** 받은 링크(상대의 답이 메모리에 있다). */
  readonly partner: boolean;
  /** 받은 링크에 상대의 짐작(ga)이 들어 있다. */
  readonly partnerGuessed: boolean;
}

/** 결과 쪽에 막 들어섰을 때 다음에 열 단계. none 이면 곧장 결과다. */
export type NextStage = "letter" | "receiver" | "none";

/**
 * 글자 고르기를 연 뒤(또는 열지 않고) 이어서 받는 사람의 서로 짐작하기를 열지.
 * 받은 링크에 상대의 짐작이 있고 내 결과가 코드를 낼 수 있을 때만 연다(관문이 닫힌 사람은 두 사람 링크를 만들 수 없는데 묻는 일이 없게).
 */
export function stageAfterLetter(facts: StageFacts, codeable: boolean): "receiver" | "none" {
  return !facts.both && facts.stages.pairGuess && facts.partner && facts.partnerGuessed && codeable ? "receiver" : "none";
}

/**
 * 결과 쪽에 들어섰을 때 처음 열 단계. 글자 고르기는 혼자 쓰는 사람과 받는 사람이 열고(두 사람 결과 링크는 단계가 없다) 결과에 글자가 확정된 주제가 있을 때만이다.
 * 열지 않으면 곧바로 받는 사람의 서로 짐작하기를 따진다.
 */
export function stageOnResult(facts: StageFacts, letterEligible: boolean, codeable: boolean): NextStage {
  if (facts.stages.letterGuess && !facts.both && letterEligible) return "letter";
  return stageAfterLetter(facts, codeable);
}

/**
 * 마지막 질문의 단추가 아직 단계를 앞둔 「다음」인가. 단계가 켜져 있고 아직 끝나지 않았으면 그렇다(두 사람 결과 링크는 단계가 없다).
 * 글자 고르기가 켜져 있으면 늘 앞둔 것으로 본다. 결과에 글자가 확정된 주제가 없거나 관문이 닫혀 단계가 안 열리는 응답에서는 「다음」이 곧장 결과로 간다(가벼운 어긋남).
 */
export function isStagePending(facts: StageFacts, done: boolean): boolean {
  if (done || facts.both) return false;
  return facts.stages.letterGuess || (facts.stages.pairGuess && facts.partner && facts.partnerGuessed);
}

/** 단계 화면이 닫힌 뒤 초점을 돌려줄 구역. 결과 화면이 다시 그려지므로 핸들러가 적어 두고 효과가 읽는다. */
export type StageFocusTarget = "pair";

export interface Stage2 {
  /** 단계가 모두 끝났는가(렌더용). 핸들러는 doneRef 를 읽는다. */
  readonly done: boolean;
  readonly doneRef: MutableRefObject<boolean>;
  readonly letterGate: boolean;
  readonly letterGuess: LetterGuess | null;
  readonly pairStage: PairStage | null;
  /** 이 브라우저에 저장하지 않는 서로 짐작하기의 내 고름(메모리뿐이다). */
  readonly ownGuess: GuessAnswers | null;
  /** 방금 짐작을 뺐다(진입 카드가 뺐다는 한 줄을 말한다). */
  readonly guessRemoved: boolean;
  /** 진입 카드의 「지금은 안 할게요」를 눌렀다(결과 화면이 다시 그려져도 카드를 다시 그리지 않는다). */
  readonly guessCardHidden: boolean;
  /** 단계 화면이 닫힌 뒤 초점을 돌려줄 구역. 읽고 비우는 것은 takeFocusTarget. */
  readonly focusTargetRef: MutableRefObject<StageFocusTarget | null>;
  setDone(value: boolean): void;
  openLetterGate(): void;
  closeLetterGate(): void;
  setLetterGuess(guess: LetterGuess | null): void;
  openPair(stage: PairStage): void;
  closePair(): void;
  setOwnGuess(guess: GuessAnswers | null, removed?: boolean): void;
  hideGuessCard(): void;
  /** 새 시도의 시작과 다시 하기에서 모든 단계 상태를 처음으로 돌린다(보관본 지우기는 부르는 쪽이 한다). */
  reset(): void;
  /** 이어 받은 흐름이 질문 도중일 때: 단계를 처음 상태로 돌리되 서로 짐작하기의 고름은 그대로 둔다. */
  resetForQuestions(): void;
}

/**
 * 단계 상태 한 벌. 모두 useState 이고(효과 안에서 상태를 바꾸지 않는다), ref 는 stagesDone 쌍과 초점 대상뿐이다.
 * 반환 객체의 함수는 매 렌더 새로 만들어지지만 안에서 쓰는 setState 와 ref 는 안정적이라 오래된 클로저가 불러도 같은 일을 한다.
 */
export function useStage2(): Stage2 {
  const [done, setDoneState] = useState(false);
  const doneRef = useRef(false);
  const [letterGate, setLetterGate] = useState(false);
  const [letterGuess, setLetterGuess] = useState<LetterGuess | null>(null);
  const [pairStage, setPairStage] = useState<PairStage | null>(null);
  const [ownGuess, setOwnGuessState] = useState<GuessAnswers | null>(null);
  const [guessRemoved, setGuessRemoved] = useState(false);
  const [guessCardHidden, setGuessCardHidden] = useState(false);
  const focusTargetRef = useRef<StageFocusTarget | null>(null);

  const setDone = (value: boolean): void => {
    doneRef.current = value;
    setDoneState(value);
  };

  return {
    done,
    doneRef,
    letterGate,
    letterGuess,
    pairStage,
    ownGuess,
    guessRemoved,
    guessCardHidden,
    focusTargetRef,
    setDone,
    openLetterGate: () => setLetterGate(true),
    closeLetterGate: () => setLetterGate(false),
    setLetterGuess,
    // 세트를 다시 열면 「뺐어요」 한 줄은 낡은 말이다(다시 열고 건너뛰어 돌아와도 이번에는 뺀 것이 없다).
    openPair: (stage) => {
      setPairStage(stage);
      setGuessRemoved(false);
    },
    closePair: () => {
      setPairStage(null);
    },
    setOwnGuess: (guess, removed = false) => {
      setOwnGuessState(guess);
      setGuessRemoved(removed);
    },
    hideGuessCard: () => setGuessCardHidden(true),
    reset: () => {
      setDone(false);
      setLetterGate(false);
      setLetterGuess(null);
      setPairStage(null);
      setOwnGuessState(null);
      setGuessRemoved(false);
      setGuessCardHidden(false);
      focusTargetRef.current = null;
    },
    resetForQuestions: () => {
      setDone(false);
      setLetterGate(false);
      setLetterGuess(null);
      setPairStage(null);
    },
  };
}
