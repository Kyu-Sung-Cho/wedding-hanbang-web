import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_LETTERS, V40_SUFFIX, axisInfo } from "@/constants/weddingCodeV40";
import { V40_COPY, selfContrastSentence, type CodeLineEntry } from "@/lib/weddingCode/v40/copy";
import type { GateInfo, QualityNotes as QualityNotesData } from "@/lib/weddingCode/v40/types";
import { GatheredSentences } from "./GatheredSentences";
import { click, createHarness, type Harness } from "./inputTestKit";
import { GateNotice, QualityNotes, demotionHint, listedNotes } from "./QualityNotes";
import { codeLineEntries } from "./CodeLine";
import { SelfContrast } from "./SelfContrast";
import { TasteCard } from "./TasteCard";
import { buttonByText, hasButton, resultCase, standaloneCapitals, textOf } from "./resultTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

const CALM: QualityNotesData = {
  hintRhythm: false,
  hintSkip: false,
  demoted: false,
  hasOmitted: false,
  skippedCount: 0,
  notApplicableCount: 0,
  unusableAxes: [],
  provisionalAxes: [],
};

describe("GatheredSentences", () => {
  it("주제마다 문장 하나, 반반이에요 주제에는 한쪽으로 답했다는 말이 없다", async () => {
    const entries: readonly CodeLineEntry[] = [
      { axis: "money", letter: "S", band: "lean", provisional: false },
      { axis: "process", letter: "D", band: "even", provisional: false },
      { axis: "scope", letter: null, band: null, provisional: false },
      { axis: "support", letter: "H", band: "even", provisional: true },
    ];
    await harness.render(<GatheredSentences entries={entries} />);
    expect(harness.container.querySelector("h2")?.textContent).toBe(V40_COPY.collected.title);
    const cards = [...harness.container.querySelectorAll("li")];
    expect(cards.map((card) => card.firstElementChild?.textContent)).toEqual(entries.map((entry) => axisInfo(entry.axis).title));
    const lines = cards.map((card) => card.querySelector("[data-collected-axis]")?.textContent);
    expect(lines).toEqual([
      "돈은 남을 장면부터 그려 보는 쪽으로 답했어요.",
      "준비는 같이 하기와 나눠 하기 어느 쪽으로도 크게 기울지 않았어요.",
      V40_COPY.collected.sentences.scope.unusable,
      "지친 날에는 마음과 할 일 어느 쪽으로도 크게 기울지 않았어요.",
    ]);
    expect(lines[1]).not.toContain(V40_SUFFIX.answered.trim());
    expect(lines[3]).not.toContain(V40_SUFFIX.answered.trim());
    for (const letter of V40_LETTERS) {
      if (letter.letter === "S") continue;
      expect(lines.join(" ")).not.toContain(letter.answerSentence);
    }
  });
});

describe("SelfContrast", () => {
  it("대비가 하나도 없으면 아무것도 그리지 않는다", async () => {
    await harness.render(<SelfContrast axes={resultCase("swua-example").result.axes} />);
    expect(harness.container.innerHTML).toBe("");
  });

  it("대비가 있는 주제만 주제 이름과 문장으로 적고, 어느 쪽이 맞는지 정하지 않는다", async () => {
    const { result } = resultCase("self-contrast");
    await harness.render(<SelfContrast axes={result.axes} />);
    const items = [...harness.container.querySelectorAll("[data-contrast-axis]")];
    const withContrast = result.axes.filter((axis) => axis.contrast !== null);
    expect(items.map((item) => item.getAttribute("data-contrast-axis"))).toEqual(withContrast.map((axis) => axis.axis));
    withContrast.forEach((axis, index) => {
      expect(textOf(items[index])).toContain(selfContrastSentence(axis.contrast!));
    });
    const text = textOf(harness.container);
    expect(text).toContain("마지막에 직접 고른 쪽은");
    expect(text).toContain("둘이 이야기해 봐도 좋아요");
    expect(text).not.toMatch(/맞아요|틀렸|더 정확/);
    expect(harness.container.querySelector("h2")?.textContent).toBe("직접 고른 쪽");
  });

  it("뚜렷해요는 「뚜렷하게 모였어요」, 기울어요는 「대체로 모였어요」", async () => {
    const { result } = resultCase("self-contrast");
    await harness.render(<SelfContrast axes={result.axes} />);
    for (const axis of result.axes) {
      if (axis.contrast === null) continue;
      const item = harness.container.querySelector(`[data-contrast-axis="${axis.axis}"]`)!;
      expect(textOf(item)).toContain(axis.contrast.gatheredBand === "clear" ? "뚜렷하게 모였어요" : "대체로 모였어요");
    }
  });
});

describe("QualityNotes", () => {
  it("안내가 없으면 세 자리 모두 아무것도 그리지 않는다", async () => {
    for (const placement of ["top", "list", "all"] as const) {
      await harness.render(<QualityNotes key={placement} notes={CALM} placement={placement} />);
      expect(harness.container.innerHTML, placement).toBe("");
    }
  });

  it("위치 반복과 건너뜀 힌트가 함께 걸려도 한 줄만 나오고 위치 반복이 먼저다", () => {
    const both: QualityNotesData = { ...CALM, hintRhythm: true, hintSkip: true, demoted: true };
    expect(demotionHint(both)).toEqual({ kind: "rhythm", text: V40_COPY.quality.rhythmHint });
    expect(demotionHint({ ...CALM, hintSkip: true, demoted: true })).toEqual({ kind: "skip", text: V40_COPY.quality.skipHint });
    expect(demotionHint(CALM)).toBeNull();
  });

  it("top 은 세기를 낮춘 한 줄만, list 는 그 밖의 안내만", async () => {
    const notes: QualityNotesData = {
      ...CALM,
      hintSkip: true,
      demoted: true,
      hasOmitted: true,
      unusableAxes: ["scope"],
      provisionalAxes: ["support"],
    };
    await harness.render(<QualityNotes notes={notes} placement="top" />);
    expect(textOf(harness.container)).toBe(V40_COPY.quality.skipHint);
    expect(harness.container.querySelector("h2")).toBeNull();
    await harness.render(<QualityNotes key="list" notes={notes} placement="list" />);
    const lines = [...harness.container.querySelectorAll("li")].map((node) => node.textContent);
    expect(lines).toEqual([V40_COPY.quality.omitted, V40_COPY.quality.unusableAxis, V40_COPY.quality.provisional]);
    expect(harness.container.querySelector("h2")?.textContent).toBe(V40_COPY.quality.title);
    expect(listedNotes(notes)).toHaveLength(3);
  });

  it("all 은 힌트를 목록 맨 앞에 함께 적는다", async () => {
    await harness.render(<QualityNotes notes={{ ...CALM, hintRhythm: true, demoted: true, hasOmitted: true }} />);
    expect([...harness.container.querySelectorAll("li")].map((node) => node.textContent)).toEqual([
      V40_COPY.quality.rhythmHint,
      V40_COPY.quality.omitted,
    ]);
  });

  it("넘어간 질문 다시 보기 단추는 부모가 줄 때만, 안내 목록이 있을 때만 나온다", async () => {
    const onReviewSkipped = vi.fn();
    const notes: QualityNotesData = { ...CALM, hasOmitted: true };
    await harness.render(<QualityNotes notes={notes} placement="list" />);
    expect(hasButton(harness.container, V40_COPY.quality.reviewSkippedButton)).toBe(false);
    await harness.render(<QualityNotes key="with" notes={notes} placement="list" onReviewSkipped={onReviewSkipped} />);
    await click(buttonByText(harness.container, V40_COPY.quality.reviewSkippedButton));
    expect(onReviewSkipped).toHaveBeenCalledTimes(1);
    await harness.render(<QualityNotes key="empty" notes={CALM} placement="list" onReviewSkipped={onReviewSkipped} />);
    expect(harness.container.innerHTML).toBe("");
  });

  it("비난하는 말, 숫자, 퍼센트가 없다", () => {
    const lines = [
      V40_COPY.quality.rhythmHint,
      V40_COPY.quality.skipHint,
      V40_COPY.quality.omitted,
      V40_COPY.quality.unusableAxis,
      V40_COPY.quality.provisional,
    ].join(" ");
    expect(lines).not.toMatch(/\d|%|잘못|불성실|대충|성의/);
  });
});

describe("GateNotice", () => {
  const rhythm: GateInfo = { closed: true, reason: "rhythm" };
  const empty: GateInfo = { closed: true, reason: "noInformation" };

  it("열려 있으면 아무것도 그리지 않는다", async () => {
    await harness.render(<GateNotice gate={{ closed: false, reason: null }} />);
    expect(harness.container.innerHTML).toBe("");
  });

  it("이유에 맞는 비난 없는 문구와 링크를 만들지 않았다는 안내", async () => {
    await harness.render(<GateNotice gate={rhythm} />);
    const section = harness.container.querySelector("section")!;
    expect(section.querySelector("h2")?.textContent).toBe(V40_COPY.gate.title);
    expect(textOf(section)).toContain(V40_COPY.gate.rhythmBody);
    expect(textOf(section)).toContain(V40_COPY.gate.noLinkNote);
    expect(section.getAttribute("data-gate-reason")).toBe("rhythm");
    // 넘어간 질문 다시 보기 단추가 있으면 그것을 권하는 문장, 없으면(「제 상황과 안 맞아요」로만 넘어갔을 때) 없는 단추를 권하지 않는 문장이다.
    await harness.render(<GateNotice key="empty" gate={empty} onReviewSkipped={() => undefined} />);
    expect(textOf(harness.container)).toContain(V40_COPY.gate.noInformationBody);
    expect(textOf(harness.container)).not.toContain(V40_COPY.gate.rhythmBody);
    await harness.render(<GateNotice key="empty-no-review" gate={empty} />);
    expect(textOf(harness.container)).toContain(V40_COPY.gate.noInformationBodyRestartOnly);
    expect(textOf(harness.container)).not.toContain(V40_COPY.gate.noInformationBody);
    expect(textOf(harness.container)).not.toContain("넘어간 질문을 다시 보거나");
  });

  it("넘어간 질문 다시 보기는 정보가 없어서 닫힌 관문에서만 나온다", async () => {
    const onReviewSkipped = vi.fn();
    await harness.render(<GateNotice gate={rhythm} onReviewSkipped={onReviewSkipped} />);
    expect(hasButton(harness.container, V40_COPY.gate.reviewSkippedButton)).toBe(false);
    await harness.render(<GateNotice key="empty" gate={empty} onReviewSkipped={onReviewSkipped} />);
    await click(buttonByText(harness.container, V40_COPY.gate.reviewSkippedButton));
    expect(onReviewSkipped).toHaveBeenCalledTimes(1);
    await harness.render(<GateNotice key="empty2" gate={empty} />);
    expect(hasButton(harness.container, V40_COPY.gate.reviewSkippedButton)).toBe(false);
  });
});

describe("TasteCard", () => {
  it("코드와 분리한 선택이라는 제목과 안내, 단추 하나", async () => {
    const onOpen = vi.fn();
    await harness.render(<TasteCard onOpen={onOpen} />);
    expect(harness.container.querySelector("h2")?.textContent).toBe(V40_COPY.taste.title);
    expect(textOf(harness.container)).toContain(V40_COPY.taste.body);
    expect(harness.container.querySelectorAll("button, a")).toHaveLength(1);
    await click(buttonByText(harness.container, V40_COPY.taste.button));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("주소를 주면 링크로 그리고 눌렀다는 사실도 알린다", async () => {
    const onOpen = vi.fn();
    await harness.render(<TasteCard onOpen={onOpen} href="/wedding-code/taste" />);
    const link = harness.container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/wedding-code/taste");
    // 새 탭에서 열린다는 말이 낭독기에만 읽히게 뒤에 붙는다(자세한 시험은 TasteCard.test.tsx).
    expect(link.textContent).toBe(`${V40_COPY.taste.button} (${V40_COPY.taste.newTabHint})`);
    expect(harness.container.querySelector("button")).toBeNull();
    link.addEventListener("click", (event) => event.preventDefault());
    await click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("코드나 글자를 섞지 않는다", async () => {
    await harness.render(<TasteCard onOpen={vi.fn()} />);
    expect(standaloneCapitals(harness.container)).toEqual([]);
    expect(textOf(harness.container)).not.toMatch(/코드에 넣|링크에 넣/);
  });
});

describe("codeLineEntries 를 쓰는 화면들이 같은 요약을 본다", () => {
  it("표본 결과에서 만든 요약을 GatheredSentences 가 그대로 문장으로 옮긴다", async () => {
    const { result } = resultCase("mixed-bands");
    await harness.render(<GatheredSentences entries={codeLineEntries(result)} />);
    expect(harness.container.querySelectorAll("li")).toHaveLength(4);
  });
});
