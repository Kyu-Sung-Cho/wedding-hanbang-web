import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_SEGMENT_NAMES } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { buildPages, initialFlowState, createFlowReducer, progressSegments } from "@/lib/weddingCode/v40/flow";
import { present } from "@/lib/weddingCode/v40/present";
import type { ProgressSegment, QuestionsPage, SectionIndex } from "@/lib/weddingCode/v40/types";
import { IntroScreen } from "./IntroScreen";
import { createHarness, type Harness } from "./inputTestKit";
import { BoundaryFallbackScreen, BrokenLinkScreen, NoCompareScreen, PositionGateScreen, StorageNotice } from "./NoticeScreens";
import { QuestionScreen } from "./QuestionScreen";
import { ReceiverScreen } from "./ReceiverScreen";
import { RestCard } from "./RestCard";
import { SelfIntroCard } from "./SelfIntroCard";
import { hasDash, notValidatedCount } from "./startFlowTestKit";

/**
 * 시작과 질문 흐름 화면 전체의 화면 문구 위생. 주장으로 쓰지 않는 말(README 2절, 설계 부록 E)이 어느 화면 글에도 없어야 한다.
 * 이 목록은 소스 가드(규칙 2)가 훑는 소스에 둘 수 없어서 시험 파일 안에만 둔다. 가드는 소스의 문자열 리터럴을,
 * 이 시험은 실제로 그려진 글(문구 도우미가 이어 붙인 문장 포함)을 본다.
 */
const CLAIM_WORDS = ["검증된", "정확", "과학적", "진단", "점수", "등급", "궁합", "퍼센트", "%", "스타일", "동물", "캐릭터", "MBTI"] as const;

const bank = WEDDING_CODE_V40_BANK;
const noop = () => undefined;

function segments(current: SectionIndex | null): ProgressSegment[] {
  const totals = [16, 16, 16, 16, 4] as const;
  return ([0, 1, 2, 3, 4] as const).map((index) => ({
    index,
    name: V40_SEGMENT_NAMES[index],
    done: current === null ? 0 : index < current ? totals[index] : 0,
    total: totals[index],
    current: current === index,
  }));
}

function questionPages(): QuestionsPage[] {
  return buildPages(bank).filter((page): page is QuestionsPage => page.kind === "questions");
}

const started = createFlowReducer(bank)(initialFlowState(bank), { type: "start", formBit: 0 });

/** 고지 「검증을 마친 심리검사가 아니」가 몇 번이어야 하는가: 시작과 받는 사람 화면은 한 번, 나머지는 없다. */
interface Case {
  readonly name: string;
  readonly element: ReactElement;
  readonly notValidated: 0 | 1;
}

const cases: readonly Case[] = [
  { name: "시작", element: <IntroScreen autosave="on" onAutosaveChange={noop} onStart={noop} />, notValidated: 1 },
  {
    name: "시작(모두 켠 상태)",
    element: (
      <IntroScreen
        autosave="off"
        onAutosaveChange={noop}
        onStart={noop}
        embedded
        notice="안내"
        autosaveNote="turnedOff"
        legacy={{ savedAt: Date.UTC(2026, 8, 20) }}
        resume={{ savedAt: Date.UTC(2026, 8, 28), onResume: noop, onStartOver: noop }}
        storageIssue="expired"
      />
    ),
    notValidated: 1,
  },
  {
    name: "시작(저장 불가)",
    element: <IntroScreen autosave="on" onAutosaveChange={noop} onStart={noop} storageIssue="unavailable" />,
    notValidated: 1,
  },
  { name: "받는 사람", element: <ReceiverScreen autosave="on" onAutosaveChange={noop} onStart={noop} />, notValidated: 1 },
  {
    name: "받는 사람(하던 답 있음)",
    element: (
      <ReceiverScreen
        autosave="off"
        onAutosaveChange={noop}
        onStart={noop}
        embedded
        legacyPresent
        saved={{ savedAt: Date.UTC(2026, 8, 28), onKeepMine: noop, onUseLink: noop }}
      />
    ),
    notValidated: 1,
  },
  { name: "쉬는 카드(저장됨)", element: <RestCard after={0} segments={segments(0)} saveState="saved" savedAt={Date.UTC(2026, 8, 29)} onContinue={noop} onBack={noop} />, notValidated: 0 },
  { name: "쉬는 카드(꺼짐)", element: <RestCard after={1} segments={segments(1)} saveState="off" onTurnOnAutosave={noop} onContinue={noop} />, notValidated: 0 },
  { name: "쉬는 카드(저장 불가)", element: <RestCard after={2} segments={segments(2)} saveState="unavailable" onContinue={noop} />, notValidated: 0 },
  { name: "쉬는 카드(어긋남)", element: <RestCard after={2} segments={segments(2)} saveState="conflict" onLoadSaved={noop} onKeepThis={noop} onContinue={noop} />, notValidated: 0 },
  { name: "마지막 정리 카드", element: <SelfIntroCard segments={segments(4)} onContinue={noop} onBack={noop} />, notValidated: 0 },
  { name: "깨진 링크", element: <BrokenLinkScreen onStart={noop} />, notValidated: 0 },
  { name: "관문(같은 위치)", element: <PositionGateScreen reason="rhythm" onRestart={noop} />, notValidated: 0 },
  { name: "관문(정보 없음)", element: <PositionGateScreen reason="noInformation" onRestart={noop} onReviewSkipped={noop} />, notValidated: 0 },
  { name: "두 사람 결과 불가", element: <NoCompareScreen onRestart={noop} />, notValidated: 0 },
  { name: "오류 대체", element: <BoundaryFallbackScreen onReload={noop} />, notValidated: 0 },
  { name: "저장 문제(저장 불가)", element: <StorageNotice problem="unavailable" />, notValidated: 0 },
  { name: "저장 문제(읽지 못함)", element: <StorageNotice problem="invalid" />, notValidated: 0 },
  { name: "저장 문제(기간 지남)", element: <StorageNotice problem="expired" />, notValidated: 0 },
  { name: "저장 문제(어긋남)", element: <StorageNotice problem="conflict" onLoadSaved={noop} onKeepThis={noop} />, notValidated: 0 },
];

describe("시작과 질문 흐름 화면의 화면 문구 위생", () => {
  let harness: Harness;
  beforeEach(() => {
    harness = createHarness();
  });
  afterEach(async () => {
    await harness.unmount();
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("%s: 주장으로 쓰지 않는 말과 줄표가 없다", async (_name, entry) => {
    await harness.render(entry.element);
    const text = harness.container.textContent ?? "";
    for (const word of CLAIM_WORDS) expect(text, word).not.toContain(word);
    expect(hasDash(text)).toBe(false);
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("%s: 검증 아님 고지가 정해진 횟수다", async (_name, entry) => {
    await harness.render(entry.element);
    expect(notValidatedCount(harness.container)).toBe(entry.notValidated);
  });

  it.each(cases.map((entry) => [entry.name, entry] as const))("%s: aria-label 에도 주장으로 쓰지 않는 말이 없다", async (_name, entry) => {
    await harness.render(entry.element);
    for (const element of harness.container.querySelectorAll("[aria-label], [aria-valuetext], [aria-describedby]")) {
      const spoken = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("aria-valuetext") ?? ""}`;
      for (const word of CLAIM_WORDS) expect(spoken, word).not.toContain(word);
    }
  });

  it("질문 화면 모두(받은 링크 안내와 저장 안내를 붙여): 주장으로 쓰지 않는 말과 줄표가 없고 고지도 없다", async () => {
    const pages = questionPages();
    expect(pages.length).toBe(42);
    for (const page of pages) {
      await harness.render(
        <QuestionScreen
          page={page}
          views={page.itemIds.map((id) => present(bank.byId.get(id)!, 0))}
          answers={{}}
          notice={{ kind: "incomplete", itemIds: [...page.itemIds] }}
          segments={progressSegments(bank, started)}
          canGoBack
          receivedNote
          saveState="off"
          onAnswer={vi.fn()}
          onNext={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      const text = harness.container.textContent ?? "";
      for (const word of CLAIM_WORDS) expect(text, `${page.key} ${word}`).not.toContain(word);
      expect(hasDash(text), page.key).toBe(false);
      expect(notValidatedCount(harness.container), page.key).toBe(0);
    }
  });
});
