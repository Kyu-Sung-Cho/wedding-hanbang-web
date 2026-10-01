import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShareEnv } from "@/components/wedding-code/v40";
import { click, isBefore } from "@/components/wedding-code/v40/inputTestKit";
import { V40_STORAGE, WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_GUESS_SET } from "@/constants/weddingCodeV40Guess";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { buildGatedShareUrl, buildQuestionOnlyUrl, encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import { compareGuesses } from "@/lib/weddingCode/v40/guess/guessCompare";
import { decodeGuessCode, encodeGuessCode } from "@/lib/weddingCode/v40/guess/guessLink";
import { letterGuessLineText } from "@/lib/weddingCode/v40/letterGuess/letterGuessCopy";
import type { LetterGuess } from "@/lib/weddingCode/v40/letterGuess/types";
import { parseLetterGuessEnvelope, serializeLetterGuessEnvelope } from "@/lib/weddingCode/v40/letterGuess/letterGuessEnvelope";
import { buildResult } from "@/lib/weddingCode/v40/score";
import { writeAutosavePreference } from "@/lib/weddingCode/v40/storage";
import type { DecodedCode, V40EntryInitial } from "@/lib/weddingCode/v40/types";
import { parseWeddingCodeEntryHash } from "./entry";
import { isStagePending, stageAfterLetter, stageOnResult, type StageFacts } from "./WeddingCodeV40Client.stage2";
import {
  FakeStorage,
  NOW,
  DAY,
  answerScreenLikeFixture,
  bank,
  decodedOf,
  driveToEnd,
  fixture,
  hasButtonWithText,
  partialSnapshotOf,
  pressText,
  randomFor,
  resultSnapshotOf,
  screenName,
  seedProgress,
  settle,
  textOf,
  type Mounted,
} from "./WeddingCodeV40Client.testKit";
import {
  SKIP_STAGE_LABELS,
  STAGES_LETTER_ONLY,
  STAGES_PAIR_ONLY,
  chooseLetter,
  chooseNoLetter,
  expectedGuessAnswers,
  fillPairScenes,
  letterAxisScope,
  mountStage2,
  startPairSet,
  type ScenePick,
} from "./WeddingCodeV40Client.stage2Kit";
/**
 * 웨딩코드 4.1 단계 2 의 클라이언트 단계 층(결과 전 글자 고르기, 서로 짐작하기)의 통합 시험(빌드 계획 11.2의 S 계열 중 두 기능에 해당하는 것).
 * 단계를 켠 클라이언트(stage2Kit)를 입구가 읽은 링크와 함께 그려 화면이 열리고 닫히는 때, 저장소에 쓰는 것, 링크에 실리는 것, 통계가 도는 순서를 본다.
 * 시험이 오래 걸리지 않게 대부분 거의 끝까지 답해 둔 진행 저장에서 이어 한다(처음부터 끝까지 가는 길은 S1, S3c, S12, S18 이 본다).
 */

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);
const mounted: Mounted[] = [];
const ORIGIN = "https://hanbang.ai";
const V40 = WEDDING_CODE_V40_VERSION;
const LONG = 90_000;
/** 처음 질문 화면 40개(채점 문항)까지 답해 둔 저장: 이어 하면 마지막 정리와 자기 선택 문항만 남는다. */
const NEAR_END = 40;
const LETTER_KEY = V40_STORAGE.letterGuessKey;

/** 폼 비트 0, 코드 SWUA: 돈 S 기울어요, 준비 W 뚜렷해요, 정하는 사람 U 기울어요, 지쳤을 때 A 반반이에요(글자가 정해지지 않은 주제). */
const own = fixture("swua-example");
/** 폼 비트 1. 짝이 되는 상대의 표본(받는 사람 시험에서 링크의 상대). */
const partner = fixture("couple-partner");
const ownDecoded = decodedOf(own);
const partnerDecoded = decodedOf(partner);

const GA = "1148056W";
const GB = "1401384H";
const guessA = decodeGuessCode(GA)!;
const guessB = decodeGuessCode(GB)!;

const codeOf = (person: DecodedCode): string => encodeCode(bank, person.formBit, person.responses) as string;

/** 입구가 읽은 대로의 initial(링크의 해시를 입구의 읽기로 푼 값). */
function initialOf(hash: string): V40EntryInitial {
  const entry = parseWeddingCodeEntryHash(hash);
  if (entry?.kind !== "v40") throw new Error(`v4 링크가 아니에요: ${hash}`);
  return entry.initial;
}

const partnerLink = (ga?: string) => `#v=${V40}&a=${codeOf(partnerDecoded)}${ga === undefined ? "" : `&ga=${ga}`}`;
const bothLink = (ga?: string, gb?: string) =>
  `#v=${V40}&a=${codeOf(partnerDecoded)}${ga === undefined ? "" : `&ga=${ga}`}&b=${codeOf(ownDecoded)}${gb === undefined ? "" : `&gb=${gb}`}`;

async function open(overrides: Parameters<typeof mountStage2>[0] = {}): Promise<Mounted> {
  const view = await mountStage2({ shareOrigin: ORIGIN, ...overrides });
  mounted.push(view);
  return view;
}

function eventsNamed(name: string) {
  return capture.mock.calls.filter(([event]) => event === name);
}

/**
 * 거의 끝까지 답해 둔 진행 저장에서 이어 한 화면을 그린다. 이어 하기 단추까지 누른 상태다(받는 사람은 하던 답 카드의 「이어서 하기」).
 * 이어 한 흐름은 질문 도중이라 단계가 끝나지 않은 상태에서 시작한다(S3b).
 */
async function reachNearEnd(
  sample: ReturnType<typeof fixture>,
  storage: FakeStorage,
  overrides: Parameters<typeof mountStage2>[0] = {},
): Promise<Mounted> {
  seedProgress(storage, partialSnapshotOf(sample, NEAR_END), NOW - DAY);
  const view = await open({ ...overrides, deps: { storage, now: () => NOW, random: randomFor(sample), ...overrides.deps } });
  const receiver = overrides.initial?.partner != null;
  await pressText(view.container, receiver ? V40_COPY.intro.inviteConflict.keepMineButton : V40_COPY.intro.resume.continueButton);
  return view;
}

function checkboxes(container: ParentNode): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

interface FakeShare {
  readonly env: ShareEnv;
  readonly written: string[];
}

/** kind: clipboard = 클립보드에 쓰기만 됨(쓴 글을 모은다), none = 공유 창도 클립보드도 없어 주소 칸이 열린다. */
function fakeShare(kind: "clipboard" | "none"): FakeShare {
  const written: string[] = [];
  return { env: { writeText: kind === "none" ? undefined : async (text) => void written.push(text) }, written };
}

/** 클립보드에 쓴 글에서 링크만(보낼 말 아래 마지막 줄). */
const urlsOf = (share: FakeShare): string[] => share.written.map((text) => text.split("\n").pop() ?? "");

/** 혼자 결과의 보내기 블록에서 체크를 켜고 링크를 보낸다. */
async function sendSoloLink(container: ParentNode): Promise<void> {
  await click(checkboxes(container)[0]);
  await pressText(container, V40_COPY.send.sendButton);
  await settle(0);
}

/** 받는 사람의 두 사람 결과에서 체크 둘을 켜고 링크를 보낸다. */
async function sendCoupleLink(container: ParentNode): Promise<void> {
  for (const box of checkboxes(container)) await click(box);
  await pressText(container, V40_COPY.coupleSend.sendButton);
  await settle(0);
}

const addressField = (container: ParentNode) => container.querySelector<HTMLInputElement>("input[readonly]");

function beforeUnloadPrevented(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** 확인 창(alertdialog)의 단추를 이름으로 누른다. 창은 문서 맨 아래(portal)에 있다. */
async function confirmDialog(label: string): Promise<void> {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((entry) => textOf(entry) === label);
  if (button === undefined) throw new Error(`확인 창 단추가 없어요: ${label}`);
  await click(button);
}

/** 먼저 고른 글자: 돈은 같고(S), 준비와 정하는 사람은 결과와 다르며(D, F), 지쳤을 때는 결과 글자를 정하지 못한 주제라 줄이 없다(H). */
const LETTER_PICKS = { money: "S", process: "D", scope: "F", support: "H" } as const;

async function pickAllLetters(container: ParentNode, formBit: 0 | 1 = own.formBit): Promise<void> {
  await chooseLetter(container, "money", formBit, LETTER_PICKS.money);
  await chooseLetter(container, "process", formBit, LETTER_PICKS.process);
  await chooseLetter(container, "scope", formBit, LETTER_PICKS.scope);
  await chooseLetter(container, "support", formBit, LETTER_PICKS.support);
}

const LINE_PROCESS = letterGuessLineText({ axis: "process", guessed: "D", shown: "W" });
const LINE_SCOPE = letterGuessLineText({ axis: "scope", guessed: "F", shown: "U" });

/** 장면 여섯의 고름(화면 위 0, 아래 1). 어긋남이 여럿 생기도록 서로 다르게 섞었다. */
const PICKS: readonly ScenePick[] = [
  { self: 0, guess: 1 },
  { self: 1, guess: 0 },
  { self: "notmine" },
  { self: 0, guess: "unsure" },
  { self: "skip" },
  { self: 1, guess: 1 },
];

const letterLines = (container: ParentNode) => [...container.querySelectorAll('[data-result-section="letter-guess"] li')].map((item) => textOf(item));

beforeEach(() => {
  capture.mockClear();
  window.history.replaceState(null, "", "/wedding-code");
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.unmount();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "sendBeacon");
});

// ---------------------------------------------------------------------------
// 결과 전 글자 고르기: 열리는 때와 닫히는 때
// ---------------------------------------------------------------------------

describe("S1 혼자: 결과 앞에 글자 고르기가 뜨고 고른 것이 결과에 나란히 놓인다", () => {
  it(
    "처음부터 끝까지 답하면 마지막 질문 단추는 「다음」이고 결과 대신 글자 고르기 화면이 뜬다. 고르면 결과에 다른 주제의 줄만 나온다",
    async () => {
      const storage = new FakeStorage();
      const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
      const nextLabels: string[] = [];
      const log = await driveToEnd(view.container, own, {
        onScreen: (name) => {
          if (name === "questions") nextLabels.push(textOf(view.container.querySelector('[data-nav="next"]')!));
        },
      });
      expect(log.last).toBe("letter-guess");
      expect(log.screens).not.toContain("result");
      // 결과 앞에 다른 화면이 끼므로 어떤 질문 화면의 단추도 「결과 보기」가 아니다.
      expect(new Set(nextLabels)).toEqual(new Set([V40_COPY.question.nextButton]));
      expect(view.container.querySelector("[data-code-letter]")).toBeNull();
      await pickAllLetters(view.container);
      await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
      expect(screenName(view.container)).toBe("result");
      // 같은 주제(돈)와 글자를 정하지 못한 주제(지쳤을 때)는 말하지 않고, 다른 주제 둘의 줄만 주제 순서로 나온다.
      expect(letterLines(view.container)).toEqual([LINE_PROCESS, LINE_SCOPE]);
      const section = view.container.querySelector('[data-result-section="letter-guess"]')!;
      expect(textOf(section)).toContain(V40_COPY.letterGuess.lines.heading);
      expect(textOf(section)).toContain(V40_COPY.letterGuess.lines.closing);
      // 고른 글자는 자동 저장이 켜져 있어서 이 브라우저에 남고, 폼 비트와 함께 읽힌다.
      expect(parseLetterGuessEnvelope(storage.data.get(LETTER_KEY) ?? null, NOW)).toEqual({
        status: "ready",
        guess: ["S", "D", "F", "H"],
        formBit: own.formBit,
        savedAt: NOW,
      });
      // 이 시도의 끝냄은 결과 앞에서 한 번 센다.
      expect(eventsNamed("wedding_code_completed")).toHaveLength(1);
    },
    LONG,
  );

  it("모두 같은 글자를 골랐으면 한 줄만, 고른 주제가 모두 글자를 정하지 못한 주제이면 그 한 줄만 나온다", async () => {
    const view = await reachNearEnd(own, new FakeStorage());
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    await chooseLetter(view.container, "money", own.formBit, "S");
    await chooseLetter(view.container, "process", own.formBit, "W");
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(letterLines(view.container)).toEqual([]);
    expect(textOf(view.container.querySelector('[data-result-section="letter-guess"]')!)).toContain(V40_COPY.letterGuess.lines.same);
    await view.unmount();
    mounted.pop();

    const second = await reachNearEnd(own, new FakeStorage());
    await driveToEnd(second.container, own, { start: false });
    await chooseLetter(second.container, "support", own.formBit, "H");
    await pressText(second.container, V40_COPY.letterGuess.screen.continueButton);
    expect(textOf(second.container.querySelector('[data-result-section="letter-guess"]')!)).toContain(V40_COPY.letterGuess.lines.unsettledOnly);
  }, LONG);

  it("S1b 건너뛴 질문이 있는 응답이 마지막 쪽의 다음으로 다시 보기를 닫아도 글자 고르기가 한 번 뜬다", async () => {
    const sample = fixture("unusable-axis");
    const view = await reachNearEnd(sample, new FakeStorage());
    const log = await driveToEnd(view.container, sample, { start: false });
    expect(log.screens.slice(-2)).toEqual(["skipped-review", "letter-guess"]);
    expect(eventsNamed("wedding_code_completed")).toHaveLength(1);
  }, LONG);

  it("S1c 같은 응답이 위쪽 나가기 단추로 닫아도 뜨고, 그 단추의 이름은 아래 「다음」과 다르다(이름이 같은 단추 둘이 없다). 결과에서 연 다시 보기를 닫는 길에서는 뜨지 않는다", async () => {
    const sample = fixture("unusable-axis");
    const view = await reachNearEnd(sample, new FakeStorage());
    // 다시 보기가 열릴 때까지 답한다.
    for (let step = 0; step < 40 && view.container.querySelector('[data-edit-mode="skipped"]') === null; step += 1) {
      const log = await driveToEndOneStep(view.container, sample);
      if (log === "stop") break;
    }
    const block = view.container.querySelector('[data-edit-mode="skipped"]');
    expect(block).not.toBeNull();
    // 위 단추는 결과를 약속하지 않고(그대로 결과 보기가 아니다) 아래 단추 「다음」(다음 넘어간 질문)과도 이름이 다르다.
    expect(hasButtonWithText(block!, V40_COPY.edit.skippedReviewSkipButton)).toBe(false);
    expect(hasButtonWithText(block!, V40_COPY.question.nextButton)).toBe(false);
    expect(hasButtonWithText(block!, V40_COPY.edit.skippedReviewFinishButton)).toBe(true);
    expect(V40_COPY.edit.skippedReviewFinishButton).not.toBe(V40_COPY.question.nextButton);
    // 화면 전체에서 「다음」이라는 이름의 단추는 아래 줄의 하나뿐이다(낭독기가 같은 이름을 두 번 읽는데 효과가 다르다).
    const root = view.container.querySelector('[data-screen="questions"]')!;
    const nextNamed = [...root.querySelectorAll<HTMLButtonElement>("button")].filter((button) => textOf(button) === V40_COPY.question.nextButton);
    expect(nextNamed).toHaveLength(1);
    expect(nextNamed[0]?.getAttribute("data-nav")).toBe("next");
    await pressText(block!, V40_COPY.edit.skippedReviewFinishButton);
    expect(screenName(view.container)).toBe("letter-guess");
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("result");
    // 결과에서 연 주제 다시 보기는 이미 결과를 본 뒤라 닫아도 글자 고르기가 다시 뜨지 않는다.
    const review = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => textOf(button) === V40_COPY.block.reviewAxisButton)!;
    await click(review);
    expect(screenName(view.container)).toBe("questions");
    await pressText(view.container, V40_COPY.edit.backToResultButton);
    expect(screenName(view.container)).toBe("result");
  }, LONG);

  it("S2 고르지 않고 결과 보기: 구역이 없고 이 브라우저에 아무것도 남지 않는다", async () => {
    const storage = new FakeStorage();
    const view = await reachNearEnd(own, storage);
    await driveToEnd(view.container, own, { start: false });
    await pickAllLetters(view.container);
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    expect(storage.writes().filter((entry) => entry.startsWith("set:") && entry.includes(LETTER_KEY))).toEqual([]);
  }, LONG);

  it("아무것도 안 고르고 「결과 보기」를 눌러도(고른 것이 없음) 구역도 보관본도 없다", async () => {
    const storage = new FakeStorage();
    const view = await reachNearEnd(own, storage);
    await driveToEnd(view.container, own, { start: false });
    await chooseNoLetter(view.container, "money");
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
    expect(storage.data.has(LETTER_KEY)).toBe(false);
  }, LONG);

  it("S4 이전을 누르면 마지막 질문으로 돌아가고, 다시 다음을 누르면 글자 고르기가 다시 뜬다", async () => {
    const view = await reachNearEnd(own, new FakeStorage());
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    await click(view.container.querySelector('[data-screen="letter-guess"] [data-nav="previous"]'));
    expect(screenName(view.container)).toBe("questions");
    expect(view.container.querySelector("[data-code-letter]")).toBeNull();
    await click(view.container.querySelector('[data-nav="next"]'));
    expect(screenName(view.container)).toBe("letter-guess");
    // 이전으로 나갔다 들어와도 이 시도를 다시 끝냈다고 세지 않는다(처음 도착에서 한 번뿐이다).
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("result");
    expect(eventsNamed("wedding_code_completed")).toHaveLength(1);
  }, LONG);

  it("S4b 이전을 눌렀다 돌아와도 고른 글자가 그대로 남는다(메모리뿐이다: 이전은 이 브라우저에 아무것도 쓰지 않는다)", async () => {
    const storage = new FakeStorage();
    const view = await reachNearEnd(own, storage);
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    await chooseLetter(view.container, "money", own.formBit, LETTER_PICKS.money);
    await chooseLetter(view.container, "process", own.formBit, LETTER_PICKS.process);
    const checkedPositions = (): Record<string, number[]> =>
      Object.fromEntries(
        (["money", "process", "scope", "support"] as const).map((axis) => [
          axis,
          [...letterAxisScope(view.container, axis).querySelectorAll<HTMLElement>('[role="radio"]')]
            .map((radio, position) => (radio.getAttribute("aria-checked") === "true" ? position : -1))
            .filter((position) => position >= 0),
        ]),
      );
    const before = checkedPositions();
    expect(before.money).toHaveLength(1);
    expect(before.process).toHaveLength(1);
    expect(before.scope).toEqual([]);
    expect(before.support).toEqual([]);

    await click(view.container.querySelector('[data-screen="letter-guess"] [data-nav="previous"]'));
    expect(screenName(view.container)).toBe("questions");
    // 이전은 아무것도 저장하지 않는다(저장은 「결과 보기」를 눌렀을 때뿐이다).
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    expect(storage.writes().filter((entry) => entry.startsWith("set:") && entry.includes(LETTER_KEY))).toEqual([]);

    await click(view.container.querySelector('[data-nav="next"]'));
    expect(screenName(view.container)).toBe("letter-guess");
    expect(checkedPositions()).toEqual(before);

    // 돌아와서 결과 보기를 누르면 그때 처음 이 브라우저에 남는다.
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(parseLetterGuessEnvelope(storage.data.get(LETTER_KEY) ?? null, NOW)).toMatchObject({ status: "ready", guess: ["S", "D", null, null] });
  }, LONG);

  it("S5 관문이 닫힌 응답은 글자 고르기도 서로 짐작하기도 열지 않고 곧바로 결과로 간다", async () => {
    const sample = fixture("rhythm-gate");
    expect(buildResult(bank, sample.formBit, sample.responses).code).toBeNull();
    const view = await reachNearEnd(sample, new FakeStorage());
    const log = await driveToEnd(view.container, sample, { start: false });
    expect(log.last).toBe("result");
    expect(log.screens).not.toContain("letter-guess");
    expect(view.container.querySelector('[data-section-card="pair-guess-entry"]')).toBeNull();
    expect(view.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
  }, LONG);

  it("글자가 정해진 주제가 없는 결과(모두 반반이에요)에서는 글자 고르기를 열지 않는다", async () => {
    const sample = fixture("all-even");
    const view = await reachNearEnd(sample, new FakeStorage());
    const log = await driveToEnd(view.container, sample, { start: false });
    expect(log.last).toBe("result");
    expect(log.screens).not.toContain("letter-guess");
  }, LONG);
});

/** 질문 화면이면 표본으로 답해 다음을 누르고, 쉬는 카드면 이어서 하기를 누른다. 다른 화면이면 멈춘다. */
async function driveToEndOneStep(container: HTMLElement, sample: ReturnType<typeof fixture>): Promise<"go" | "stop"> {
  const name = screenName(container);
  if (name === "questions") {
    await answerScreenLikeFixture(container, sample);
    await click(container.querySelector('[data-nav="next"]'));
    return "go";
  }
  if (name === "rest" || name === "self-intro") {
    await pressText(container, V40_COPY.rest.continueButton);
    return "go";
  }
  return "stop";
}

// ---------------------------------------------------------------------------
// 이어 하기와 낡은 보관본
// ---------------------------------------------------------------------------

describe("이어 하기와 결과 전에 고른 글자의 보관본", () => {
  const seedGuess = (storage: FakeStorage, guess: LetterGuess, formBit: 0 | 1, at: number = NOW) => {
    const raw = serializeLetterGuessEnvelope(guess, formBit, at);
    if (raw === null) throw new Error("보관본을 만들지 못했어요");
    storage.setItem(LETTER_KEY, raw);
  };

  it("S3 이어 하기로 결과에 도착하면 글자 고르기는 뜨지 않고, 이 시도의 보관본이 있으면 줄이 나온다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(letterLines(view.container)).toEqual([LINE_PROCESS, LINE_SCOPE]);
    // 이어 하기로 돌아온 결과는 처음 끝낸 것이 아니라서 끝냈다고 세지 않는다.
    expect(eventsNamed("wedding_code_completed")).toHaveLength(0);
  });

  it("S3 보관본이 다른 시도의 것(폼 비트가 다름)이면 줄이 없고 보관본은 지워진다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit === 0 ? 1 : 0, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
    expect(storage.data.has(LETTER_KEY)).toBe(false);
  });

  it("S3b 질문 도중에 이어 하면 보관본을 지우고, 끝낸 뒤 글자 고르기가 뜬다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(screenName(view.container)).toBe("questions");
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    const log = await driveToEnd(view.container, own, { start: false });
    expect(log.last).toBe("letter-guess");
    // 이전 시도에서 골라 둔 글자가 새로 뜬 화면에 미리 눌려 있지 않다.
    expect(letterAxisScope(view.container, "process").querySelector('[role="radio"][aria-checked="true"]')).toBeNull();
  }, LONG);

  it("S3c 이어 할 진행이 없는데 남은 보관본(고아)은 부팅에서 지워지고, 새 시도의 결과와 견줘지지 않는다", async () => {
    const storage = new FakeStorage();
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    const log = await driveToEnd(view.container, own);
    expect(log.last).toBe("letter-guess");
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
  }, LONG);

  it("읽을 수 없는 보관본과 기간이 지난 보관본은 이어 할 진행이 있어도 지워진다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    storage.setItem(LETTER_KEY, "{broken");
    const view = await open({ deps: { storage, now: () => NOW } });
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    await view.unmount();
    mounted.pop();
    const old = new FakeStorage();
    seedProgress(old, resultSnapshotOf(own), NOW - DAY);
    seedGuess(old, ["S", "D", "F", "H"], own.formBit, NOW - 40 * DAY);
    await open({ deps: { storage: old, now: () => NOW } });
    expect(old.data.has(LETTER_KEY)).toBe(false);
  });

  it("S6 자동 저장을 꺼 두면 고른 글자는 저장소에 쓰이지 않고 안내가 그렇게 말하며, 화면에는 그대로 나온다", async () => {
    const storage = new FakeStorage();
    expect(writeAutosavePreference(storage, "off").status).toBe("saved");
    const writesBefore = storage.writes().length;
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    expect(screenName(view.container)).toBe("letter-guess");
    expect(view.container.querySelector("[data-letter-guess-storage]")?.getAttribute("data-letter-guess-storage")).toBe("off");
    expect(textOf(view.container)).toContain(V40_COPY.letterGuess.screen.storageOff);
    await pickAllLetters(view.container);
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(letterLines(view.container)).toEqual([LINE_PROCESS, LINE_SCOPE]);
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    expect(storage.writes().slice(writesBefore).filter((entry) => entry.startsWith("set:"))).toEqual([]);
  }, LONG);

  it("저장소를 못 쓰는 브라우저에서는 안내가 그렇게 말하고, 고른 글자는 화면에만 있다", async () => {
    const blocked = await open({ deps: { storage: null, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(blocked.container, own);
    expect(blocked.container.querySelector("[data-letter-guess-storage]")?.getAttribute("data-letter-guess-storage")).toBe("blocked");
    await pickAllLetters(blocked.container);
    await pressText(blocked.container, V40_COPY.letterGuess.screen.continueButton);
    expect(letterLines(blocked.container)).toEqual([LINE_PROCESS, LINE_SCOPE]);
  }, LONG);

  it("S15 처음부터 다시 하기와 이 브라우저의 저장 지우기, 하던 답 지우고 처음부터가 고른 글자의 보관본과 화면의 줄을 함께 지운다", async () => {
    // (a) 처음부터 다시 하기
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    expect(letterLines(view.container)).toHaveLength(2);
    await pressText(view.container, V40_COPY.manage.restart.button);
    await confirmDialog(V40_COPY.manage.restart.confirmButton);
    expect(screenName(view.container)).toBe("intro");
    expect(storage.data.has(LETTER_KEY)).toBe(false);
    await view.unmount();
    mounted.pop();

    // (b) 이 브라우저의 저장 지우기: 화면의 줄도 사라진다.
    const second = new FakeStorage();
    seedProgress(second, resultSnapshotOf(own), NOW - DAY);
    seedGuess(second, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const cleared = await open({ deps: { storage: second, now: () => NOW } });
    await pressText(cleared.container, V40_COPY.intro.resume.continueButton);
    await pressText(cleared.container, V40_COPY.manage.clear.button);
    await confirmDialog(V40_COPY.manage.clear.confirmButton);
    await settle(0);
    expect(textOf(cleared.container)).toContain(V40_COPY.manage.clear.done);
    expect(second.data.has(LETTER_KEY)).toBe(false);
    expect(cleared.container.querySelector('[data-result-section="letter-guess"]')).toBeNull();
    await cleared.unmount();
    mounted.pop();

    // (c) 하던 답 지우고 처음부터
    const third = new FakeStorage();
    seedProgress(third, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    seedGuess(third, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const startOver = await open({ deps: { storage: third, now: () => NOW, random: randomFor(own) } });
    await pressText(startOver.container, V40_COPY.intro.resume.restartButton);
    expect(third.data.has(LETTER_KEY)).toBe(false);
  });

  it("S15 지우기가 실패하면(저장소가 막힘) 지웠다고 말하지 않는다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    await pressText(view.container, V40_COPY.intro.resume.continueButton);
    storage.failRemove = true;
    await pressText(view.container, V40_COPY.manage.clear.button);
    await confirmDialog(V40_COPY.manage.clear.confirmButton);
    await settle(0);
    expect(textOf(view.container)).toContain(V40_COPY.manage.clear.failed);
    expect(textOf(view.container)).not.toContain(V40_COPY.manage.clear.done);
  });

  it("S15 시작 화면에서 자동 저장을 끄면 고른 글자의 보관본도 지워진다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, resultSnapshotOf(own), NOW - DAY);
    seedGuess(storage, ["S", "D", "F", "H"], own.formBit, NOW - DAY);
    const view = await open({ deps: { storage, now: () => NOW } });
    expect(storage.data.has(LETTER_KEY)).toBe(true);
    await pressText(view.container, V40_COPY.autosave.turnOffButton);
    expect(storage.data.has(LETTER_KEY)).toBe(false);
  });

  it("S17 StrictMode 에서도 보관본은 한 번씩만 쓰고 지운다", async () => {
    const storage = new FakeStorage();
    const view = await open({ strict: true, deps: { storage, now: () => NOW, random: randomFor(own) } });
    await driveToEnd(view.container, own);
    await pickAllLetters(view.container);
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    expect(screenName(view.container)).toBe("result");
    const letterWrites = storage.writes().filter((entry) => entry.endsWith(LETTER_KEY));
    // 새 시도를 시작할 때 낡은 보관본을 한 번 지우고, 고른 글자를 한 번 쓴다.
    expect(letterWrites).toEqual([`remove:${LETTER_KEY}`, `set:${LETTER_KEY}`]);
  }, LONG);
});

// ---------------------------------------------------------------------------
// 서로 짐작하기: 보내는 사람
// ---------------------------------------------------------------------------

describe("서로 짐작하기: 보내는 사람의 결과 카드", () => {
  /** 글자 고르기는 건너뛰고 결과 화면까지 가서 보내기 블록이 있는 상태로 둔다. */
  async function soloResult(sample: ReturnType<typeof fixture>, overrides: Parameters<typeof mountStage2>[0] = {}): Promise<Mounted> {
    const view = await reachNearEnd(sample, new FakeStorage(), overrides);
    const log = await driveToEnd(view.container, sample, { start: false, skipStages: SKIP_STAGE_LABELS });
    expect(log.last).toBe("result");
    return view;
  }

  it.each([
    ["폼 비트 0", own],
    ["폼 비트 1", partner],
  ])("S7 결과 카드의 「해 볼게요」로 세트를 마치면 링크의 정규 순서 자리에 ga 가 실린다(%s)", async (_label, sample) => {
    const share = fakeShare("clipboard");
    const view = await soloResult(sample, { deps: { shareEnv: share.env } });
    const card = view.container.querySelector('[data-section-card="pair-guess-entry"]');
    expect(card).not.toBeNull();
    expect(textOf(card!)).toContain(V40_COPY.guess.entry.body);
    expect(hasButtonWithText(card!, V40_COPY.guess.entry.startButton)).toBe(true);
    // 카드는 「상대에게 보내기」 구역 안, 링크 보내기 블록 위에 있다.
    const send = view.container.querySelector('[data-result-section="send"]')!;
    expect(send.contains(card!)).toBe(true);
    expect(isBefore(card!, send.querySelector('input[type="radio"]')!)).toBe(true);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    expect(screenName(view.container)).toBe("pair-guess");
    expect(view.container.querySelector('[data-screen="pair-guess"]')?.getAttribute("data-step")).toBe("start");
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    expect(screenName(view.container)).toBe("result");
    expect(textOf(view.container.querySelector('[data-section-card="pair-guess-entry"]')!)).toContain(V40_COPY.guess.entry.doneNote);
    // 링크는 누를 때만 만들어지고, 짐작이 든다는 것을 보내기 직전에도 말한다.
    expect(view.container.querySelector("[data-send-guess-note]")?.textContent).toBe(V40_COPY.guess.shareInfo);
    await sendSoloLink(view.container);
    const expected = encodeGuessCode(expectedGuessAnswers(sample.formBit, PICKS));
    expect(expected).not.toBeNull();
    const base = buildGatedShareUrl(bank, ORIGIN, decodedOf(sample)) as string;
    expect(urlsOf(share)).toEqual([`${base}&ga=${expected}`]);
    expect(decodeGuessCode(expected)).toEqual(expectedGuessAnswers(sample.formBit, PICKS));
  }, LONG);

  it("S7 짐작을 하지 않으면 링크는 짐작을 모르던 때와 바이트까지 같고, 「질문만 보내기」의 링크에는 ga 가 없다", async () => {
    const share = fakeShare("clipboard");
    const view = await soloResult(own, { deps: { shareEnv: share.env } });
    expect(view.container.querySelector("[data-send-guess-note]")).toBeNull();
    await sendSoloLink(view.container);
    expect(urlsOf(share)).toEqual([buildGatedShareUrl(bank, ORIGIN, ownDecoded)]);
    await view.unmount();
    mounted.pop();

    const second = fakeShare("clipboard");
    const withGuess = await soloResult(own, { deps: { shareEnv: second.env } });
    await pressText(withGuess.container, V40_COPY.guess.entry.startButton);
    await startPairSet(withGuess.container);
    await fillPairScenes(withGuess.container, PICKS);
    // 「질문만 보내기」를 고르면 짐작이 든다는 줄이 사라지고 링크에도 들어가지 않는다.
    await click(withGuess.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1]);
    expect(withGuess.container.querySelector("[data-send-guess-note]")).toBeNull();
    await pressText(withGuess.container, V40_COPY.send.sendButton);
    await settle(0);
    expect(urlsOf(second)).toEqual([buildQuestionOnlyUrl(ORIGIN, { explicitVersion: true })]);
    expect(urlsOf(second)[0]).not.toContain("ga=");
  }, LONG);

  it("S7b 주소 칸을 연 뒤 「빼기」를 누르면 칸이 사라지고 새로 만든 링크에는 ga 가 없다", async () => {
    const share = fakeShare("none");
    const view = await soloResult(own, { deps: { shareEnv: share.env } });
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    await sendSoloLink(view.container);
    expect(addressField(view.container)?.value).toContain("&ga=");
    await pressText(view.container, V40_COPY.guess.entry.removeButton);
    expect(addressField(view.container)).toBeNull();
    expect(textOf(view.container.querySelector('[data-section-card="pair-guess-entry"]')!)).toContain(V40_COPY.guess.entry.removedNote);
    expect(hasButtonWithText(view.container, V40_COPY.guess.entry.startButton)).toBe(true);
    expect(view.container.querySelector("[data-send-guess-note]")).toBeNull();
    // 보내기 블록이 처음 상태로 돌아왔고(동의 체크 꺼짐) 새 링크는 짐작을 모르던 때와 같다.
    expect(checkboxes(view.container)[0].checked).toBe(false);
    await sendSoloLink(view.container);
    expect(addressField(view.container)?.value).toBe(buildGatedShareUrl(bank, ORIGIN, ownDecoded));
  }, LONG);

  it("S7c 「빼기」 뒤에 「해 볼게요」로 다시 열었다가 건너뛰고 돌아오면 「짐작을 뺐어요」 한 줄은 다시 나오지 않는다(이번에는 뺀 것이 없다)", async () => {
    const view = await soloResult(own);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    await pressText(view.container, V40_COPY.guess.entry.removeButton);
    const card = () => view.container.querySelector('[data-section-card="pair-guess-entry"]')!;
    expect(textOf(card())).toContain(V40_COPY.guess.entry.removedNote);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    expect(screenName(view.container)).toBe("pair-guess");
    await click(view.container.querySelector('[data-screen="pair-guess"] [data-nav="leave"]'));
    expect(screenName(view.container)).toBe("result");
    expect(textOf(card())).not.toContain(V40_COPY.guess.entry.removedNote);
    expect(hasButtonWithText(view.container, V40_COPY.guess.entry.startButton)).toBe(true);
  }, LONG);

  it("「고치기」는 고른 것이 미리 눌린 채로 세트를 다시 열고, 「짐작은 건너뛸게요」는 고른 것을 버리고 나가며 이미 끝낸 짐작은 그대로다", async () => {
    const view = await soloResult(own);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    await pressText(view.container, V40_COPY.guess.entry.editButton);
    await startPairSet(view.container);
    const firstSelf = view.container.querySelector('[data-question="self"]')!;
    expect(firstSelf.querySelectorAll('[role="radio"][aria-checked="true"]')).toHaveLength(1);
    // 둘째 화면에서 건너뛰면 결과 화면으로 돌아오고 카드는 아직 끝낸 상태다.
    await click(view.container.querySelector('[data-screen="pair-guess"] [data-nav="leave"]'));
    expect(screenName(view.container)).toBe("result");
    expect(hasButtonWithText(view.container, V40_COPY.guess.entry.editButton)).toBe(true);
    expect(textOf(view.container.querySelector('[data-section-card="pair-guess-entry"]')!)).toContain(V40_COPY.guess.entry.doneNote);
  }, LONG);

  it("「지금은 안 할게요」는 카드를 걷고, 세트를 닫고 돌아와서도 다시 그리지 않는다", async () => {
    const view = await soloResult(own);
    await pressText(view.container, V40_COPY.guess.entry.dismissButton);
    expect(view.container.querySelector('[data-section-card="pair-guess-entry"]')).toBeNull();
    // 결과 화면이 다시 그려져도(다시 보기를 열었다 닫음) 카드는 돌아오지 않는다.
    const review = [...view.container.querySelectorAll<HTMLButtonElement>("button")].find((button) => textOf(button) === V40_COPY.block.reviewAxisButton)!;
    await click(review);
    await pressText(view.container, V40_COPY.edit.backToResultButton);
    expect(screenName(view.container)).toBe("result");
    expect(view.container.querySelector('[data-section-card="pair-guess-entry"]')).toBeNull();
  }, LONG);

  it("S20 세트를 마치거나 건너뛰고 돌아오면 초점이 화면 맨 위가 아니라 카드의 제목에 있다", async () => {
    const view = await soloResult(own);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    // 초점은 한 박자 늦게(결과 화면 뿌리의 효과가 끝난 뒤) 카드 제목으로 간다.
    await settle(30);
    const heading = view.container.querySelector('[data-section-card="pair-guess-entry"] > h2');
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(heading?.textContent).toBe(V40_COPY.guess.entry.title);
    // 건너뛰고 돌아와도 같다.
    await pressText(view.container, V40_COPY.guess.entry.editButton);
    await click(view.container.querySelector('[data-screen="pair-guess"] [data-nav="leave"]'));
    await settle(30);
    expect(document.activeElement).toBe(view.container.querySelector('[data-section-card="pair-guess-entry"] > h2'));
  }, LONG);

  it("S20b 개발 서버처럼 StrictMode 로 그려도 초점은 결과 화면 뿌리가 아니라 카드의 제목에 남는다", async () => {
    const view = await soloResult(own, { strict: true });
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    await settle(30);
    const heading = view.container.querySelector('[data-section-card="pair-guess-entry"] > h2');
    expect(heading).not.toBeNull();
    expect(document.activeElement).toBe(heading);
    // 건너뛰고 돌아와도 같다.
    await pressText(view.container, V40_COPY.guess.entry.editButton);
    await click(view.container.querySelector('[data-screen="pair-guess"] [data-nav="leave"]'));
    await settle(30);
    expect(document.activeElement).toBe(view.container.querySelector('[data-section-card="pair-guess-entry"] > h2'));
  }, LONG);
});

// ---------------------------------------------------------------------------
// 서로 짐작하기: 받는 사람
// ---------------------------------------------------------------------------

describe("서로 짐작하기: 받는 사람", () => {
  const withGuessLink = () => ({ initial: initialOf(partnerLink(GA)) });

  it("S8 링크에 ga 가 있으면 받는 사람 화면이 한 줄로 알리고(내용은 없다), 글자 고르기 뒤에 세트 화면이 열린다. 마치면 돌려보내는 링크에 ga 와 gb 가 모두 실린다", async () => {
    const share = fakeShare("clipboard");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    const view = await open({ ...withGuessLink(), deps: { storage, now: () => NOW, random: randomFor(own), shareEnv: share.env } });
    expect(screenName(view.container)).toBe("receiver");
    expect(view.container.querySelector("[data-receive-guess-note]")?.textContent).toBe(V40_COPY.guess.receiverNote);
    expect(view.container.innerHTML).not.toContain(GA);
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    const log = await driveToEnd(view.container, own, { start: false });
    expect(log.last).toBe("letter-guess");
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    // 나도 같은 장면에서 내 답과 짐작을 고른다: 첫 화면은 받는 사람용 안내이고 「짐작은 건너뛸게요」가 같은 무게로 있다.
    expect(screenName(view.container)).toBe("pair-guess");
    expect(textOf(view.container)).toContain(V40_COPY.guess.receiverIntro);
    expect(textOf(view.container)).not.toContain(V40_COPY.guess.intro);
    // 받는 사람은 결과 화면의 진입 카드를 거치지 않으므로 이 화면이 저장하지 않는다고 말한다.
    expect(textOf(view.container)).toContain(V40_COPY.guess.receiverStorageNote);
    expect(hasButtonWithText(view.container, V40_COPY.guess.leaveButton)).toBe(true);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    expect(screenName(view.container)).toBe("couple");

    // 두 사람 결과의 「짐작과 답」: 어긋난 장면만, 상대(먼저 답한 사람)의 짐작과 내 고름을 견준 장면이다.
    const mine = expectedGuessAnswers(own.formBit, PICKS);
    const expectedScenes = compareGuesses(guessA, mine);
    expect(expectedScenes.kind).toBe("both");
    const sceneIds = (expectedScenes.kind === "both" ? expectedScenes.scenes : []).map((scene) => V40_GUESS_SET[scene.index].id);
    expect(sceneIds.length).toBeGreaterThan(0);
    const section = view.container.querySelector('[data-part="guess"]')!;
    expect([...section.querySelectorAll("li[data-scene]")].map((item) => item.getAttribute("data-scene"))).toEqual(sceneIds);
    expect(textOf(section)).toContain(V40_COPY.guess.title);

    // 돌려보내는 링크: 받은 상대의 a, ga 와 내 b, gb 가 정규 순서로 실린다. 짐작이 든다는 줄이 보내기 직전에도 있다.
    expect(view.container.querySelector("[data-send-guess-note]")?.textContent).toBe(V40_COPY.guess.coupleSendInfo);
    await sendCoupleLink(view.container);
    const gb = encodeGuessCode(mine);
    expect(urlsOf(share)).toEqual([`${ORIGIN}/wedding-code#v=${V40}&a=${codeOf(partnerDecoded)}&ga=${GA}&b=${codeOf(ownDecoded)}&gb=${gb}`]);
  }, LONG);

  it("세트 화면에서 「짐작은 건너뛸게요」를 누르면 바로 두 사람 결과가 열리고, 돌려보내는 링크에는 상대의 ga 만 실린다. 짐작과 답 구역은 그리지 않는다", async () => {
    const share = fakeShare("clipboard");
    const view = await reachNearEnd(own, new FakeStorage(), { ...withGuessLink(), deps: { shareEnv: share.env } });
    await driveToEnd(view.container, own, { start: false, skipStages: SKIP_STAGE_LABELS });
    expect(screenName(view.container)).toBe("couple");
    expect(view.container.querySelector('[data-part="guess"]')).toBeNull();
    // 링크에는 받은 상대의 짐작만 다시 실리므로 한 줄도 그것만 말한다(두 사람의 짐작이 읽힌다고 하지 않는다).
    const note = view.container.querySelector("[data-send-guess-note]")?.textContent;
    expect(note).toBe(V40_COPY.guess.coupleSendPartnerInfo);
    expect(note).not.toBe(V40_COPY.guess.coupleSendInfo);
    await sendCoupleLink(view.container);
    expect(urlsOf(share)).toEqual([`${ORIGIN}/wedding-code#v=${V40}&a=${codeOf(partnerDecoded)}&ga=${GA}&b=${codeOf(ownDecoded)}`]);
  }, LONG);

  it("링크에 ga 가 없으면 받는 사람 화면에 그 줄이 없고 세트 화면도 열리지 않는다(글자 고르기만 열린다)", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    const view = await open({ initial: initialOf(partnerLink()), deps: { storage, now: () => NOW, random: randomFor(own) } });
    expect(view.container.querySelector("[data-receive-guess-note]")).toBeNull();
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    const log = await driveToEnd(view.container, own, { start: false });
    expect(log.last).toBe("letter-guess");
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("couple");
  }, LONG);

  it("S8b 받는 사람의 결과가 관문이 닫혔으면 세트 화면도 글자 고르기도 열리지 않고 비교할 수 없다는 화면 그대로다", async () => {
    const sample = fixture("rhythm-gate");
    const view = await reachNearEnd(sample, new FakeStorage(), withGuessLink());
    const log = await driveToEnd(view.container, sample, { start: false });
    expect(log.last).toBe("no-compare");
    expect(log.screens).not.toContain("pair-guess");
    expect(log.screens).not.toContain("letter-guess");
  }, LONG);

  it("비교 불가 화면에서 다시 하면 받은 링크는 그대로 두고 단계도 처음으로 돌아가, 다시 답하면 글자 고르기와 서로 짐작하기가 다시 열린다", async () => {
    const closed = fixture("rhythm-gate");
    const storage = new FakeStorage();
    const view = await reachNearEnd(closed, storage, { ...withGuessLink() });
    const first = await driveToEnd(view.container, closed, { start: false });
    expect(first.last).toBe("no-compare");
    await pressText(view.container, V40_COPY.receive.noCompareRestartButton);
    expect(screenName(view.container)).toBe("receiver");
    // 받은 링크는 그대로라서 상대의 짐작이 있다는 한 줄도 그대로다.
    expect(view.container.querySelector("[data-receive-guess-note]")?.textContent).toBe(V40_COPY.guess.receiverNote);
    // 폼 비트가 같은 다른 표본(코드가 나오는 응답)으로 처음부터 다시 답한다.
    const second = await driveToEnd(view.container, partner);
    expect(second.last).toBe("letter-guess");
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("pair-guess");
    await pressText(view.container, V40_COPY.guess.leaveButton);
    expect(screenName(view.container)).toBe("couple");
  }, LONG);

  it("S19 두 사람 결과에서 먼저 고른 글자 카드는 닫힌 채 시작하고, 열기 전에는 줄이 문서에 없다. 가리면 다시 닫힌다", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), withGuessLink());
    await driveToEnd(view.container, own, { start: false });
    await pickAllLetters(view.container);
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    await pressText(view.container, V40_COPY.guess.leaveButton);
    expect(screenName(view.container)).toBe("couple");
    const card = view.container.querySelector('[data-letter-guess="closed-card"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-letter-guess-open")).toBe("false");
    expect(view.container.querySelector("li[data-letter-guess-axis]")).toBeNull();
    expect(view.container.innerHTML).not.toContain(LINE_PROCESS);
    await pressText(view.container, V40_COPY.letterGuess.closedCard.openButton);
    expect(letterLinesInCard(view.container)).toEqual([LINE_PROCESS, LINE_SCOPE]);
    await pressText(view.container, V40_COPY.letterGuess.closedCard.closeButton);
    expect(view.container.querySelector("li[data-letter-guess-axis]")).toBeNull();
  }, LONG);

  it("고른 글자가 없으면 두 사람 결과에 그 카드가 없다", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), withGuessLink());
    await driveToEnd(view.container, own, { start: false, skipStages: SKIP_STAGE_LABELS });
    expect(screenName(view.container)).toBe("couple");
    expect(view.container.querySelector('[data-letter-guess="closed-card"]')).toBeNull();
  }, LONG);

  it("S16 받는 사람이 글자 고르기와 서로 짐작하기 화면에 있는 동안 나가기 경고가 있고, 혼자 쓰는 사람의 글자 고르기에는 없다", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), withGuessLink());
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    expect(beforeUnloadPrevented()).toBe(true);
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("pair-guess");
    expect(beforeUnloadPrevented()).toBe(true);
    await pressText(view.container, V40_COPY.guess.leaveButton);
    expect(screenName(view.container)).toBe("couple");
    expect(beforeUnloadPrevented()).toBe(false);
    await view.unmount();
    mounted.pop();

    const solo = await reachNearEnd(own, new FakeStorage());
    await driveToEnd(solo.container, own, { start: false });
    expect(screenName(solo.container)).toBe("letter-guess");
    expect(beforeUnloadPrevented()).toBe(false);
  }, LONG);

  it("S12 단계 화면(글자 고르기, 서로 짐작하기)이 떠 있는 동안에는 두 사람 비교를 열었다고 세지 않고, 두 사람 결과가 뜬 뒤 한 번 센다", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), withGuessLink());
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    expect(eventsNamed("wedding_code_comparison_viewed")).toHaveLength(0);
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(view.container)).toBe("pair-guess");
    expect(eventsNamed("wedding_code_comparison_viewed")).toHaveLength(0);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    expect(screenName(view.container)).toBe("couple");
    expect(eventsNamed("wedding_code_comparison_viewed")).toHaveLength(1);
  }, LONG);
});

const letterLinesInCard = (container: ParentNode) => [...container.querySelectorAll('[data-letter-guess="closed-card"] li')].map((item) => textOf(item));

// ---------------------------------------------------------------------------
// 서로 짐작하기: 두 사람 결과 링크를 그대로 연 화면
// ---------------------------------------------------------------------------

describe("서로 짐작하기: a 와 b 가 든 링크를 그대로 연 화면", () => {
  it("S9 링크에서 읽은 짐작만으로 「짐작과 답」을 그리고, 나 기준 전환이 줄의 이름표를 바꾸며, 이 브라우저에 아무것도 쓰지 않는다", async () => {
    const storage = new FakeStorage();
    const view = await open({ initial: initialOf(bothLink(GA, GB)), deps: { storage, now: () => NOW } });
    expect(screenName(view.container)).toBe("couple");
    const expected = compareGuesses(guessA, guessB);
    expect(expected.kind).toBe("both");
    const sceneIds = (expected.kind === "both" ? expected.scenes : []).map((scene) => V40_GUESS_SET[scene.index].id);
    expect(sceneIds.length).toBeGreaterThan(1);
    const scenes = () => [...view.container.querySelectorAll('[data-part="guess"] li[data-scene]')].map((item) => item.getAttribute("data-scene"));
    expect(scenes()).toEqual(sceneIds);

    // S9b 나 기준이 정해지지 않았으면 먼저 답한 사람, 나중에 답한 사람 꼴이다(어느 쪽이 나인지 고르기 전).
    const labels = V40_COPY.guess.rowLabels;
    const dirText = (direction: string) => textOf(view.container.querySelector(`[data-part="guess"] dl[data-direction="${direction}"]`)!);
    expect(dirText("firstGuessedSecond")).toContain(labels.firstGuessedSecond.guessLabel);
    expect(dirText("secondGuessedFirst")).toContain(labels.secondGuessedFirst.guessLabel);
    expect(view.container.innerHTML).not.toContain(labels.meGuessedPartner.guessLabel);

    const radios = [...view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    await click(radios[0]);
    expect(dirText("firstGuessedSecond")).toContain(labels.meGuessedPartner.guessLabel);
    expect(dirText("secondGuessedFirst")).toContain(labels.partnerGuessedMe.guessLabel);
    await click(radios[1]);
    expect(dirText("firstGuessedSecond")).toContain(labels.partnerGuessedMe.guessLabel);
    expect(dirText("secondGuessedFirst")).toContain(labels.meGuessedPartner.guessLabel);
    // 어느 쪽이어도 같은 장면이 같은 순서로 놓인다.
    expect(scenes()).toEqual(sceneIds);
    expect(storage.writes()).toEqual([]);
    // 두 사람 결과 링크를 연 화면은 글자 고르기의 보관본도 읽지 않는다(저장소 포트가 없다).
    expect(storage.log.filter((entry) => entry.includes(LETTER_KEY))).toEqual([]);
  });

  it("S10 한 사람의 짐작만 있거나 둘 다 없으면 아무것도 그리지 않는다", async () => {
    for (const [name, link] of [
      ["ga 만", bothLink(GA)],
      ["gb 만", bothLink(undefined, GB)],
      ["둘 다 없음", bothLink()],
    ] as const) {
      const view = await open({ initial: initialOf(link), deps: { storage: new FakeStorage(), now: () => NOW } });
      expect(screenName(view.container), name).toBe("couple");
      expect(view.container.querySelector('[data-part="guess"]'), name).toBeNull();
      expect(textOf(view.container), name).not.toContain(V40_COPY.guess.title);
      await view.unmount();
      mounted.pop();
    }
  });

  it("두 사람의 짐작이 서로의 답과 모두 같으면 나란히 놓을 것이 없다는 빈 상태 한 줄이고 장면 줄은 없다", async () => {
    // 먼저 답한 사람의 짐작이 나중에 답한 사람의 고름과, 나중에 답한 사람의 짐작이 먼저 답한 사람의 고름과 모든 장면에서 같은 한 쌍을 코덱으로 만든다.
    const sixSlots = (pick: (index: number) => { self: 0 | 1; guess: 0 | 1 }) => Array.from({ length: 6 }, (_, index) => pick(index));
    const selfOfFirst = (index: number): 0 | 1 => (index % 2 === 0 ? 0 : 1);
    const selfOfSecond = (index: number): 0 | 1 => (index % 3 === 0 ? 1 : 0);
    const first = { set: guessA.set, slots: sixSlots((index) => ({ self: selfOfFirst(index), guess: selfOfSecond(index) })) } as unknown as typeof guessA;
    const second = { set: guessA.set, slots: sixSlots((index) => ({ self: selfOfSecond(index), guess: selfOfFirst(index) })) } as unknown as typeof guessA;
    const ga = encodeGuessCode(first) as string;
    const gb = encodeGuessCode(second) as string;
    expect(compareGuesses(decodeGuessCode(ga), decodeGuessCode(gb))).toEqual({ kind: "both", scenes: [] });
    const view = await open({ initial: initialOf(bothLink(ga, gb)), deps: { storage: new FakeStorage(), now: () => NOW } });
    const section = view.container.querySelector('[data-part="guess"]')!;
    expect(section.querySelector("[data-guess-empty]")?.textContent).toBe(V40_COPY.guess.emptyState);
    expect(section.querySelectorAll("li[data-scene]")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 분석 없음, 네트워크 없음, 흔적 없음
// ---------------------------------------------------------------------------

describe("분석 없음과 흔적 없음", () => {
  async function receiverEvents(stagesOn: boolean): Promise<unknown[][]> {
    capture.mockClear();
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    const view = await open({
      initial: initialOf(partnerLink(GA)),
      deps: { storage, now: () => NOW, random: randomFor(own), stages: { letterGuess: stagesOn, pairGuess: stagesOn } },
    });
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    await driveToEnd(view.container, own, { start: false });
    if (stagesOn) {
      await pickAllLetters(view.container);
      await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
      await startPairSet(view.container);
      await fillPairScenes(view.container, PICKS);
    }
    expect(screenName(view.container)).toBe("couple");
    const calls = capture.mock.calls.map((call) => [...call]);
    await view.unmount();
    mounted.pop();
    return calls;
  }

  async function soloEvents(stagesOn: boolean): Promise<unknown[][]> {
    capture.mockClear();
    const storage = new FakeStorage();
    const share = fakeShare("clipboard");
    const view = await open({ deps: { storage, now: () => NOW, random: randomFor(own), shareEnv: share.env, stages: { letterGuess: stagesOn, pairGuess: stagesOn } } });
    await driveToEnd(view.container, own);
    if (stagesOn) {
      await pickAllLetters(view.container);
      await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
      await pressText(view.container, V40_COPY.guess.entry.startButton);
      await startPairSet(view.container);
      await fillPairScenes(view.container, PICKS);
      await pressText(view.container, V40_COPY.guess.entry.removeButton);
    }
    expect(screenName(view.container)).toBe("result");
    const calls = capture.mock.calls.map((call) => [...call]);
    await view.unmount();
    mounted.pop();
    return calls;
  }

  it("S12 글자 고르기와 서로 짐작하기를 모두 한 혼자 쓰는 경로의 통계 호출 열이 단계를 모르던 경로와 완전히 같다", async () => {
    const without = await soloEvents(false);
    const withStages = await soloEvents(true);
    expect(without.length).toBeGreaterThan(40);
    expect(withStages).toEqual(without);
  }, LONG);

  it("S12 받는 사람이 두 화면을 모두 거친 경로의 통계 호출 열도 단계를 모르던 경로와 완전히 같다", async () => {
    const without = await receiverEvents(false);
    const withStages = await receiverEvents(true);
    expect(without.map(([name]) => name)).toContain("wedding_code_comparison_viewed");
    expect(withStages).toEqual(without);
  }, LONG);

  it("S13 네트워크 요청이 없고, 단계가 끝난 뒤 문서와 기록 칸과 창 이름과 저장소에 ga, gb 글자와 고른 글자가 없다", async () => {
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    const view = await open({ initial: initialOf(partnerLink(GA)), deps: { storage, now: () => NOW, random: randomFor(own) } });
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    await driveToEnd(view.container, own, { start: false });
    await pickAllLetters(view.container);
    await pressText(view.container, V40_COPY.letterGuess.screen.continueButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    expect(screenName(view.container)).toBe("couple");
    const mine = expectedGuessAnswers(own.formBit, PICKS);
    const gb = encodeGuessCode(mine) as string;
    const traces = [document.documentElement.outerHTML, JSON.stringify(window.history.state), window.name, window.location.href, JSON.stringify([...storage.data.entries()])];
    for (const trace of traces) {
      expect(trace).not.toContain(GA);
      expect(trace).not.toContain(gb);
      expect(trace).not.toContain("ga=");
      expect(trace).not.toContain("gb=");
    }
    // 고른 글자(SDFH)는 이 브라우저에만 있고, 그 보관본 말고 어디에도 글자 넷 묶음이 없다.
    expect(JSON.stringify([...storage.data.entries()].filter(([key]) => key !== LETTER_KEY))).not.toContain("SDFH");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  }, LONG);

  it("S13 보내는 사람의 세트를 마친 뒤에도(링크를 만들기 전) 문서, 기록 칸, 창 이름, 저장소 어디에도 짐작과 고른 것이 없고 네트워크 요청도 없다", async () => {
    const fetchSpy = vi.fn();
    const beaconSpy = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchSpy);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconSpy });
    const storage = new FakeStorage();
    const view = await reachNearEnd(own, storage);
    await driveToEnd(view.container, own, { start: false, skipStages: SKIP_STAGE_LABELS });
    const writesBefore = storage.writes().length;
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    await fillPairScenes(view.container, PICKS);
    expect(screenName(view.container)).toBe("result");
    const gb = encodeGuessCode(expectedGuessAnswers(own.formBit, PICKS)) as string;
    expect(document.documentElement.outerHTML).not.toContain(gb);
    // 기록 칸은 이 화면이 한 번도 쓰지 않았고(혼자 쓰는 사람은 링크를 연 적이 없다), 창 이름도 비어 있다.
    expect(window.history.state).toBeNull();
    expect(window.name).toBe("");
    expect(window.location.href).not.toMatch(/g[ab]=/u);
    // 짐작은 이 브라우저에 저장하지 않는다: 세트를 하는 동안 저장소에 쓴 것이 없다.
    expect(storage.writes().slice(writesBefore)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(beaconSpy).not.toHaveBeenCalled();
  }, LONG);
});

// ---------------------------------------------------------------------------
// 단계를 끄면 옛 흐름 그대로
// ---------------------------------------------------------------------------

describe("S14 단계를 끄면 각 화면이 사라지고 나머지는 그대로다", () => {
  it("둘 다 끄면: 받는 사람 한 줄, 글자 고르기, 세트 화면, 결과 카드, 짐작과 답 구역이 모두 없고 저장소는 보관본 키를 건드리지 않는다", async () => {
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(own, NEAR_END), NOW - DAY);
    const share = fakeShare("clipboard");
    const view = await open({
      initial: initialOf(partnerLink(GA)),
      deps: { storage, now: () => NOW, random: randomFor(own), shareEnv: share.env, stages: { letterGuess: false, pairGuess: false } },
    });
    expect(view.container.querySelector("[data-receive-guess-note]")).toBeNull();
    await pressText(view.container, V40_COPY.intro.inviteConflict.keepMineButton);
    const log = await driveToEnd(view.container, own, { start: false });
    expect(log.last).toBe("couple");
    expect(log.screens).not.toContain("letter-guess");
    expect(log.screens).not.toContain("pair-guess");
    expect(view.container.querySelector('[data-part="guess"]')).toBeNull();
    // 상대의 ga 도 돌려보내는 링크에 싣지 않는다(꺼진 기능은 아무것도 싣지 않는다).
    await sendCoupleLink(view.container);
    expect(urlsOf(share)).toEqual([buildGatedShareUrl(bank, ORIGIN, partnerDecoded, ownDecoded)]);
    expect(storage.log.filter((entry) => entry.includes(LETTER_KEY))).toEqual([]);
  }, LONG);

  it("글자 고르기만 켜면 세트 화면과 카드가 없고, 세트만 켜면 글자 고르기가 없다", async () => {
    const letterOnly = await reachNearEnd(own, new FakeStorage(), { deps: { stages: STAGES_LETTER_ONLY } });
    const first = await driveToEnd(letterOnly.container, own, { start: false });
    expect(first.last).toBe("letter-guess");
    await pressText(letterOnly.container, V40_COPY.letterGuess.screen.skipButton);
    expect(screenName(letterOnly.container)).toBe("result");
    expect(letterOnly.container.querySelector('[data-section-card="pair-guess-entry"]')).toBeNull();
    await letterOnly.unmount();
    mounted.pop();

    const pairOnly = await reachNearEnd(own, new FakeStorage(), { deps: { stages: STAGES_PAIR_ONLY } });
    const pairOnlyLabels: string[] = [];
    const second = await driveToEnd(pairOnly.container, own, {
      start: false,
      onScreen: (name) => {
        if (name === "questions") pairOnlyLabels.push(textOf(pairOnly.container.querySelector('[data-nav="next"]')!));
      },
    });
    // 혼자 쓰는 사람에게 글자 고르기가 꺼져 있으면 결과 앞에 끼는 화면이 없어서 마지막 질문의 단추는 예전처럼 「결과 보기」다.
    expect(pairOnlyLabels.at(-1)).toBe(V40_COPY.question.resultButton);
    expect(second.last).toBe("result");
    expect(second.screens).not.toContain("letter-guess");
    expect(pairOnly.container.querySelector('[data-section-card="pair-guess-entry"]')).not.toBeNull();
  }, LONG);

  it("두 사람 결과 링크는 세트 화면이 꺼져 있으면 짐작과 답 구역을 그리지 않지만 링크 해독은 막히지 않는다(이미 나간 링크가 열린다)", async () => {
    const view = await open({ initial: initialOf(bothLink(GA, GB)), deps: { storage: new FakeStorage(), now: () => NOW, stages: { letterGuess: false, pairGuess: false } } });
    expect(screenName(view.container)).toBe("couple");
    expect(view.container.querySelector('[data-part="guess"]')).toBeNull();
  });

  it("S18 같은 표본을 단계를 끈 채로 끝까지 간 것과 켜고 건너뛰며 간 것은 지나간 화면과 도착한 화면이 같다", async () => {
    const sample = own;
    const off = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample), stages: { letterGuess: false, pairGuess: false } } });
    const offLog = await driveToEnd(off.container, sample);
    await off.unmount();
    mounted.pop();
    const on = await open({ deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(sample) } });
    const onLog = await driveToEnd(on.container, sample, { skipStages: SKIP_STAGE_LABELS });
    expect(onLog).toEqual(offLog);
    expect(onLog.last).toBe("result");
  }, LONG);

  it("S18 건너뛴 질문이 있는 표본, 모두 반반인 표본, 관문이 닫힌 표본도 마지막 구간에서 같은 화면에 같은 길로 도착한다", async () => {
    for (const name of ["unusable-axis", "all-even", "rhythm-gate"]) {
      const sample = fixture(name);
      const off = await reachNearEnd(sample, new FakeStorage(), { deps: { stages: { letterGuess: false, pairGuess: false } } });
      const offLog = await driveToEnd(off.container, sample, { start: false });
      await off.unmount();
      mounted.pop();
      const on = await reachNearEnd(sample, new FakeStorage());
      const onLog = await driveToEnd(on.container, sample, { start: false, skipStages: SKIP_STAGE_LABELS });
      await on.unmount();
      mounted.pop();
      expect(onLog, name).toEqual(offLog);
    }
  }, LONG);

  it("S18 받는 사람(ga 가 든 링크)도 단계를 끈 흐름과 켜고 건너뛰며 간 흐름이 같은 화면에 도착한다", async () => {
    const off = await open({ initial: initialOf(partnerLink(GA)), deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own), stages: { letterGuess: false, pairGuess: false } } });
    const offLog = await driveToEnd(off.container, own);
    await off.unmount();
    mounted.pop();
    const on = await open({ initial: initialOf(partnerLink(GA)), deps: { storage: new FakeStorage(), now: () => NOW, random: randomFor(own) } });
    const onLog = await driveToEnd(on.container, own, { skipStages: SKIP_STAGE_LABELS });
    expect(onLog).toEqual(offLog);
    expect(onLog.last).toBe("couple");
  }, LONG);
});

// ---------------------------------------------------------------------------
// 두 번 누름 막기
// ---------------------------------------------------------------------------

describe("단계 화면의 두 번 누름 막기", () => {
  it("글자 고르기 화면이 뜬 직후의 첫 누름은 무시하고 막는 시간이 지나면 눌린다", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), { deps: { turnGuardMs: 300 } });
    await driveToEnd(view.container, own, { start: false });
    expect(screenName(view.container)).toBe("letter-guess");
    await click(view.container.querySelector('[data-screen="letter-guess"] [data-nav="next"]'));
    expect(screenName(view.container)).toBe("letter-guess");
    await settle(400);
    await click(view.container.querySelector('[data-screen="letter-guess"] [data-nav="next"]'));
    expect(screenName(view.container)).toBe("result");
  }, LONG);

  it("서로 짐작하기의 시작 화면도 같다(뜬 직후의 시작 누름은 무시한다)", async () => {
    const view = await reachNearEnd(own, new FakeStorage(), { deps: { turnGuardMs: 300 } });
    await driveToEnd(view.container, own, { start: false });
    await settle(400);
    await pressText(view.container, V40_COPY.letterGuess.screen.skipButton);
    await pressText(view.container, V40_COPY.guess.entry.startButton);
    await startPairSet(view.container);
    expect(view.container.querySelector('[data-screen="pair-guess"]')?.getAttribute("data-step")).toBe("start");
    await settle(400);
    await startPairSet(view.container);
    expect(view.container.querySelector('[data-screen="pair-guess"]')?.getAttribute("data-step")).toBe("scene");
  }, LONG);

  it("막는 시간을 주지 않은 시험 기본(0)은 아무것도 막지 않는다", async () => {
    const view = await reachNearEnd(own, new FakeStorage());
    await driveToEnd(view.container, own, { start: false });
    await click(view.container.querySelector('[data-screen="letter-guess"] [data-nav="next"]'));
    expect(screenName(view.container)).toBe("result");
  }, LONG);
});

// ---------------------------------------------------------------------------
// 단계를 정하는 순수 판단(stage2.tsx)
// ---------------------------------------------------------------------------

describe("단계를 정하는 순수 판단", () => {
  const facts = (over: Partial<StageFacts> = {}): StageFacts => ({
    stages: { letterGuess: true, pairGuess: true },
    both: false,
    partner: false,
    partnerGuessed: false,
    ...over,
  });

  it("stageOnResult: 혼자는 글자가 정해진 주제가 있을 때만 글자 고르기, 두 사람 링크는 아무 단계도 없고, 받는 사람은 글자 고르기 뒤 서로 짐작하기다", () => {
    // 혼자
    expect(stageOnResult(facts(), true, true)).toBe("letter");
    expect(stageOnResult(facts(), false, true)).toBe("none");
    expect(stageOnResult(facts(), true, false)).toBe("letter");
    // 두 사람 결과 링크: 어떤 단계도 열지 않는다(상대의 짐작이 있어도)
    expect(stageOnResult(facts({ both: true, partnerGuessed: true, partner: true }), true, true)).toBe("none");
    // 받는 사람
    expect(stageOnResult(facts({ partner: true }), true, true)).toBe("letter");
    expect(stageOnResult(facts({ partner: true }), false, true)).toBe("none");
    expect(stageOnResult(facts({ partner: true, partnerGuessed: true }), true, true)).toBe("letter");
    expect(stageOnResult(facts({ partner: true, partnerGuessed: true }), false, true)).toBe("receiver");
    expect(stageOnResult(facts({ partner: true, partnerGuessed: true }), false, false)).toBe("none");
    // 켬 상수: 글자 고르기가 꺼져 있으면 곧장 서로 짐작하기, 서로 짐작하기가 꺼져 있으면 글자 고르기만이다
    expect(stageOnResult(facts({ partner: true, partnerGuessed: true, stages: { letterGuess: false, pairGuess: true } }), true, true)).toBe("receiver");
    expect(stageOnResult(facts({ partner: true, partnerGuessed: true, stages: { letterGuess: true, pairGuess: false } }), false, true)).toBe("none");
    expect(stageOnResult(facts({ stages: { letterGuess: false, pairGuess: false } }), true, true)).toBe("none");
  });

  it("stageAfterLetter: 받은 링크에 상대의 짐작이 있고 내 결과가 코드를 낼 때만 서로 짐작하기다", () => {
    expect(stageAfterLetter(facts({ partner: true, partnerGuessed: true }), true)).toBe("receiver");
    expect(stageAfterLetter(facts({ partner: true, partnerGuessed: true }), false)).toBe("none");
    expect(stageAfterLetter(facts({ partner: true }), true)).toBe("none");
    expect(stageAfterLetter(facts({ partnerGuessed: true }), true)).toBe("none");
    expect(stageAfterLetter(facts({ partner: true, partnerGuessed: true, stages: { letterGuess: true, pairGuess: false } }), true)).toBe("none");
  });

  it("isStagePending: 마지막 질문의 단추가 「다음」이어야 하는 때(단계가 아직 끼어들 수 있을 때)", () => {
    expect(isStagePending(facts(), false)).toBe(true);
    expect(isStagePending(facts(), true)).toBe(false);
    expect(isStagePending(facts({ both: true }), false)).toBe(false);
    expect(isStagePending(facts({ stages: { letterGuess: false, pairGuess: true } }), false)).toBe(false);
    expect(isStagePending(facts({ partner: true, stages: { letterGuess: false, pairGuess: true } }), false)).toBe(false);
    expect(isStagePending(facts({ partner: true, partnerGuessed: true, stages: { letterGuess: false, pairGuess: true } }), false)).toBe(true);
    expect(isStagePending(facts({ stages: { letterGuess: false, pairGuess: false } }), false)).toBe(false);
  });
});
