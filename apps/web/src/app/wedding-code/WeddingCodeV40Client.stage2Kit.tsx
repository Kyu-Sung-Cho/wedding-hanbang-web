import { click } from "@/components/wedding-code/v40/inputTestKit";
import type { Axis } from "@/constants/weddingCodeV40";
import { V40_GUESS_SET_ID } from "@/constants/weddingCodeV40Guess";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { storedPickOf } from "@/lib/weddingCode/v40/guess/guessPresent";
import type { GuessAnswers, GuessPick, GuessSlots } from "@/lib/weddingCode/v40/guess/types";
import { letterGuessChoices } from "@/lib/weddingCode/v40/letterGuess/letterGuess";
import type { FormBit, Letter } from "@/lib/weddingCode/v40/types";
import { mountClient, type ClientOverrides, type Mounted, type StageSkipLabels, type StageSwitches } from "./WeddingCodeV40Client.testKit";

/**
 * 웨딩코드 4.1 단계 2 의 단계 화면(결과 전 글자 고르기, 서로 짐작하기)을 켜고 조작하는 시험 도구(시험 파일이 아니다).
 * WeddingCodeV40Client.testKit 의 기본은 단계가 모두 꺼짐이라 옛 흐름이 그대로 돌고, 이 도구는 단계를 켠 시험이 쓴다.
 * 소스 가드가 훑는 파일이라 저장 키 이름, 통계, 주장 낱말, 외부 주소를 두지 않는다(그런 것은 *.test.tsx 안에만 둔다).
 * 화면 글은 문구 묶음(V40_COPY)에서 읽고 글자 카드의 위아래는 폼 비트로 뒤집히므로 순서는 도우미(letterGuessChoices, storedPickOf)로 정한다.
 */

export const STAGES_ALL_ON = { letterGuess: true, pairGuess: true } as const satisfies Required<StageSwitches>;
export const STAGES_LETTER_ONLY = { letterGuess: true, pairGuess: false } as const satisfies Required<StageSwitches>;
export const STAGES_PAIR_ONLY = { letterGuess: false, pairGuess: true } as const satisfies Required<StageSwitches>;

/** driveToEnd 의 skipStages: 단계 화면이 나오면 이 단추를 눌러 지나간다. */
export const SKIP_STAGE_LABELS: StageSkipLabels = {
  "letter-guess": V40_COPY.letterGuess.screen.skipButton,
  "pair-guess": V40_COPY.guess.leaveButton,
};

/** 단계를 기본으로 켜고 클라이언트를 그린다(부른 쪽이 stages 를 주면 그것을 따른다). */
export function mountStage2(overrides: ClientOverrides = {}): Promise<Mounted> {
  return mountClient({ ...overrides, deps: { ...overrides.deps, stages: { ...STAGES_ALL_ON, ...overrides.deps?.stages } } });
}

// ---------------------------------------------------------------------------
// 결과 전 글자 고르기 화면
// ---------------------------------------------------------------------------

/** 글자 고르기 화면의 주제 하나의 구역. */
export function letterAxisScope(container: ParentNode, axis: Axis): HTMLElement {
  const scope = container.querySelector<HTMLElement>(`[data-screen="letter-guess"] [data-letter-guess-axis="${axis}"]`);
  if (scope === null) throw new Error("글자 고르기 화면에 그 주제가 없어요");
  return scope;
}

function radiosOf(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[role="radio"]')];
}

/** 주제의 카드 하나(글자)를 누른다. 카드의 위아래는 폼 비트를 따르므로 letterGuessChoices 의 순서로 찾는다. */
export async function chooseLetter(container: ParentNode, axis: Axis, formBit: FormBit, letter: Letter): Promise<void> {
  const position = letterGuessChoices(formBit, axis).indexOf(letter);
  if (position < 0) throw new Error("이 주제의 글자가 아니에요");
  await click(radiosOf(letterAxisScope(container, axis))[position]);
}

/** 주제의 「잘 모르겠어요」 카드(카드 둘 다음의 셋째)를 누른다. */
export async function chooseNoLetter(container: ParentNode, axis: Axis): Promise<void> {
  await click(radiosOf(letterAxisScope(container, axis))[2]);
}

// ---------------------------------------------------------------------------
// 서로 짐작하기 세트 화면
// ---------------------------------------------------------------------------

/** 장면 하나의 고름. 번호는 화면의 위(0)와 아래(1)다(저장 카드는 폼 비트가 정한다). 탈출구를 고르면 그 장면의 짐작은 묻지 않는다. */
export interface ScenePick {
  readonly self: 0 | 1 | "notmine" | "skip";
  readonly guess?: 0 | 1 | "unsure" | null;
}

/** 시작 화면의 「시작」을 누른다. */
export async function startPairSet(container: ParentNode): Promise<void> {
  await click(container.querySelector('[data-screen="pair-guess"] [data-nav="start"]'));
}

/** 세트의 장면 여섯을 picks 대로 채우고 마지막 「마치기」까지 누른다. 시작 화면에서 「시작」을 이미 눌렀어야 한다. */
export async function fillPairScenes(container: ParentNode, picks: readonly ScenePick[]): Promise<void> {
  for (const pick of picks) {
    const root = container.querySelector('[data-screen="pair-guess"]');
    if (root === null) throw new Error("서로 짐작하기 화면이 아니에요");
    if (typeof pick.self === "number") {
      await click(radiosOf(root.querySelector('[data-question="self"]') as ParentNode)[pick.self]);
      const guess = pick.guess ?? null;
      if (typeof guess === "number") await click(radiosOf(root.querySelector('[data-question="guess"]') as ParentNode)[guess]);
      else if (guess === "unsure") await click(root.querySelector('[data-escape="unsure"]'));
    } else {
      await click(root.querySelector(`[data-escape="${pick.self}"]`));
    }
    await click(root.querySelector('[data-nav="next"]'));
  }
}

/** picks 로 만든 링크용 고름(저장 카드 기준). 화면 번호를 저장 카드로 바꾸는 것은 폼 비트가 정한다. */
export function expectedGuessAnswers(formBit: FormBit, picks: readonly ScenePick[]): GuessAnswers {
  const slots = picks.map((pick) => {
    const self: GuessPick = typeof pick.self === "number" ? storedPickOf(formBit, pick.self) : null;
    const guess: GuessPick = self !== null && typeof pick.guess === "number" ? storedPickOf(formBit, pick.guess) : null;
    return { self, guess };
  });
  return { set: V40_GUESS_SET_ID, slots: slots as unknown as GuessSlots };
}
