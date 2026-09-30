import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V40_AXIS_KEYS, V40_LETTER_LIST, axisInfo, letterInfo } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { compareCouple } from "@/lib/weddingCode/v40/couple";
import {
  V40_COPY,
  V40_COUPLE_SEND_EXTRA_COPY,
  V40_NOT_VALIDATED_PHRASE,
  coupleTagNote,
  legendLetterCell,
  letterBandCell,
  perspectiveChangedAnnouncement,
} from "@/lib/weddingCode/v40/copy";
import { V40_FIXTURES } from "@/lib/weddingCode/v40/fixtures";
import type { CoupleAxisRow, CoupleItemPair, CoupleResult as CoupleResultData, DecodedCode, Perspective } from "@/lib/weddingCode/v40/types";
import { CoupleResult, V40_EMBEDDED_BOTTOM_SPACE, type CoupleResultProps } from "./CoupleResult";
import { click, createHarness, isBefore, type Harness } from "./inputTestKit";
import type { ShareSentEvent } from "./shareActions";

const bank = WEDDING_CODE_V40_BANK;

function fixture(name: string): DecodedCode {
  const found = V40_FIXTURES.find((entry) => entry.name === name);
  if (!found) throw new Error(`없는 표본: ${name}`);
  return { formBit: found.formBit, responses: found.responses };
}

const SWUA = fixture("swua-example");
const PARTNER = fixture("couple-partner");

/** 실제 채점기가 만든 결과: 주제 네 줄이 다른 글자, 같은 글자, 다른 글자, 반반이에요이고 질문 목록이 각각 셋이다. */
const COUPLE = compareCouple(bank, SWUA, PARTNER);

function swapPair(item: CoupleItemPair): CoupleItemPair {
  return { ...item, firstValue: item.secondValue, secondValue: item.firstValue, firstText: item.secondText, secondText: item.firstText };
}

/** 두 사람의 자리를 바꾼 결과. */
function swapCouple(result: CoupleResultData): CoupleResultData {
  const axes = result.axes.map((row) => ({ ...row, first: row.second, second: row.first })) as unknown as CoupleResultData["axes"];
  return { axes, talk: result.talk.map(swapPair), similar: result.similar.map(swapPair) };
}

const row = (axis: CoupleAxisRow["axis"], tag: CoupleAxisRow["tag"], first: CoupleAxisRow["first"], second: CoupleAxisRow["second"], excluded = false): CoupleAxisRow => ({
  axis,
  tag,
  first,
  second,
  excluded,
});

const FORBIDDEN = /궁합|잘 ?맞|안 ?맞|점수|등급|퍼센트|백분율|%|스타일|성격|진단|정확|과학|어울리/u;

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

type Overrides = Partial<CoupleResultProps>;

async function renderResult(overrides: Overrides = {}): Promise<HTMLElement> {
  await harness.render(<CoupleResult result={COUPLE} detectedPerspective={null} idPrefix="t-couple" {...overrides} />);
  return harness.container;
}

const root = () => harness.container;
const text = () => root().textContent ?? "";
const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const axisItems = () => [...root().querySelectorAll<HTMLElement>('[data-part="axes"] li[data-axis]')];
const personLabels = (item: HTMLElement) => [...item.querySelectorAll("div > div > p:first-child")].map((p) => p.textContent);
const personCells = (item: HTMLElement) => [...item.querySelectorAll("div > div > p:nth-child(2)")].map((p) => p.textContent);
const heading = (label: string) => [...root().querySelectorAll("h1, h2, h3")].find((h) => h.textContent === label) ?? null;
const radios = () => [...root().querySelectorAll<HTMLInputElement>('input[type="radio"]')];

describe("CoupleResult: 구성과 순서", () => {
  it("제목 「우리 둘의 웨딩코드」와 고지가 맨 위에 있고 고지는 이 화면에서 한 번뿐이다", async () => {
    await renderResult();
    // 이 화면이 페이지의 첫 화면이면 제목이 h1 하나다.
    expect(root().querySelectorAll("h1")).toHaveLength(1);
    expect(root().querySelector("h1")?.textContent).toBe(V40_COPY.couple.title);
    expect(text()).toContain(V40_COPY.couple.notice);
    expect(countOf(text(), V40_NOT_VALIDATED_PHRASE)).toBe(1);
  });

  it("라운지 안(embedded)에서는 바깥 화면이 h1 을 가지므로 제목이 h2 다", async () => {
    await renderResult({ embedded: true });
    expect(root().querySelector("h1")).toBeNull();
    expect(root().querySelector("h2")?.textContent).toBe(V40_COPY.couple.title);
  });

  it("note 를 주면 제목과 고지 뒤에 붙고, 주지 않으면 없다", async () => {
    await renderResult({ note: <span>새로고침하면 사라져요</span> });
    const title = root().querySelector("h1") as Node;
    const notice = [...root().querySelectorAll("p")].find((p) => p.textContent === V40_COPY.couple.notice) as Node;
    const note = root().querySelector("[data-couple-note]") as Node;
    expect(isBefore(title, notice)).toBe(true);
    expect(isBefore(notice, note)).toBe(true);
    expect(note.textContent).toBe("새로고침하면 사라져요");
    await harness.unmount();
    harness = createHarness();
    await renderResult();
    expect(root().querySelector("[data-couple-note]")).toBeNull();
  });

  it("보내기 블록이 있어도 고지는 한 번이다", async () => {
    await renderResult({ send: { buildUrl: () => "https://example.test/x", onSent: () => undefined } });
    expect(countOf(text(), V40_NOT_VALIDATED_PHRASE)).toBe(1);
  });

  it("위에서 아래로: 제목, 나 기준, 글자 읽는 법, 주제별 나란히, 먼저 이야기해 볼 질문, 비슷하게 고른 질문, 보내기, 처음부터 해 보기", async () => {
    await renderResult({ send: { buildUrl: () => "https://example.test/x", onSent: () => undefined }, onStartOwn: () => undefined });
    const ordered = [
      root().querySelector("h1"),
      root().querySelector("fieldset legend"),
      heading(V40_COPY.legend.title),
      heading(V40_COUPLE_SEND_EXTRA_COPY.axesHeading),
      heading(V40_COPY.couple.talk.title),
      heading(V40_COPY.couple.similar.title),
      heading(V40_COPY.coupleSend.title),
      [...root().querySelectorAll("button")].find((button) => button.textContent === V40_COPY.couple.startOwnButton) ?? null,
    ];
    for (const node of ordered) expect(node).not.toBeNull();
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      expect(isBefore(ordered[index] as Node, ordered[index + 1] as Node), `${index}번째 다음 순서`).toBe(true);
    }
  });

  it("글자 읽는 법 표는 접히지 않고 한 번만 나온다", async () => {
    await renderResult();
    expect(root().querySelectorAll("table")).toHaveLength(1);
    expect(countOf(text(), V40_COPY.legend.title)).toBe(1);
    expect(root().querySelector("details")).toBeNull();
    const table = root().querySelector("table");
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(4);
    expect([...(table?.querySelectorAll("thead th") ?? [])].map((th) => th.textContent)).toEqual([
      V40_COPY.legend.topicColumn,
      V40_COPY.legend.frontColumn,
      V40_COPY.legend.backColumn,
    ]);
  });

  it("글자 여덟 개가 표에 정확히 한 번씩 나오고 각 글자의 이름과 영어 낱말이 붙는다", async () => {
    await renderResult();
    const table = root().querySelector("table")?.textContent ?? "";
    for (const letter of V40_LETTER_LIST) {
      expect(countOf(table, legendLetterCell(letter)), letter).toBe(1);
      expect(countOf(table, letterInfo(letter).english), letter).toBe(1);
    }
    for (const axis of V40_AXIS_KEYS) expect(table).toContain(axisInfo(axis).title);
  });

  it("두 사람 화면에는 「내 글자」 칸이 없고 세기 낱말 풀이 셋이 있다", async () => {
    await renderResult({ detectedPerspective: "first" });
    expect(text()).not.toContain(V40_COPY.legend.mineColumn);
    expect(text()).toContain(V40_COPY.legend.strengthGuide.clear);
    expect(text()).toContain(V40_COPY.legend.strengthGuide.lean);
    expect(text()).toContain(V40_COPY.legend.strengthGuide.even);
  });

  it("화면에 나오는 영문 낱글자는 여덟 글자뿐이다(B, M, N, 물음표가 글자로 나오지 않는다)", async () => {
    await renderResult({ detectedPerspective: "first" });
    const standalone = [...text().matchAll(/(?<![A-Za-z])[A-Z](?![A-Za-z])/gu)].map((match) => match[0]);
    for (const letter of standalone) expect(V40_LETTER_LIST as readonly string[]).toContain(letter);
    expect(text()).not.toMatch(/(?:^|\s)\?(?:\s|$)/u);
  });
});

describe("CoupleResult: 주제별 나란히 보기", () => {
  it("네 줄이 주제 순서로 나오고 태그와 두 사람의 글자 칸이 결과와 같다", async () => {
    await renderResult();
    const items = axisItems();
    expect(items.map((item) => item.dataset.axis)).toEqual([...V40_AXIS_KEYS]);
    COUPLE.axes.forEach((data, index) => {
      const item = items[index];
      expect(item.dataset.tag).toBe(data.excluded ? "excluded" : data.tag);
      expect(personCells(item)).toEqual([
        letterBandCell(data.first.letter, data.first.shownBand, data.first.provisional),
        letterBandCell(data.second.letter, data.second.shownBand, data.second.provisional),
      ]);
      if (!data.excluded) expect(item.textContent).toContain(V40_COPY.couple.tagLabels[data.tag]);
    });
  });

  it("태그 낱말은 세 개뿐이고 화면에 나오는 것은 그 셋 중에서만이다", async () => {
    await renderResult();
    const labels: readonly string[] = Object.values(V40_COPY.couple.tagLabels);
    expect(labels).toEqual(["같은 글자", "다른 글자", "한쪽 또는 둘 다 반반이에요"]);
    const shown = axisItems().flatMap((item) => [...item.querySelectorAll("span")].map((span) => span.textContent).filter((t) => labels.includes(t ?? "")));
    expect(shown).toEqual(COUPLE.axes.filter((data) => !data.excluded).map((data) => V40_COPY.couple.tagLabels[data.tag]));
  });

  it("다른 글자 줄마다 그 주제의 한 줄이 붙고, 같은 글자 안내는 같은 글자 줄 중 첫 줄에만 한 번 붙는다", async () => {
    const same = { letter: "W", shownBand: "clear", provisional: false } as const;
    const sameU = { letter: "U", shownBand: "lean", provisional: false } as const;
    const money = { letter: "S", shownBand: "lean", provisional: false } as const;
    const moneyOther = { letter: "V", shownBand: "clear", provisional: false } as const;
    const support = { letter: "A", shownBand: "even", provisional: false } as const;
    const supportOther = { letter: "H", shownBand: "lean", provisional: false } as const;
    const result: CoupleResultData = {
      axes: [row("money", "different", money, moneyOther), row("process", "same", same, same), row("scope", "same", sameU, sameU), row("support", "even", support, supportOther)],
      talk: [],
      similar: [],
    };
    await renderResult({ result });
    const items = axisItems();
    expect(countOf(text(), coupleTagNote("money", "same", false))).toBe(1);
    expect(items[1].textContent).toContain(coupleTagNote("process", "same", false));
    expect(items[2].textContent).not.toContain(coupleTagNote("scope", "same", false));
    expect(items[0].textContent).toContain(coupleTagNote("money", "different", false));
    expect(countOf(text(), V40_COPY.couple.evenTagNote)).toBe(1);
  });

  it("실제 결과에서도 다른 글자 줄 수만큼 그 주제의 다른 글자 안내가 있다", async () => {
    await renderResult();
    for (const data of COUPLE.axes) {
      const expected = data.tag === "different" && !data.excluded ? 1 : 0;
      expect(countOf(text(), `${axisInfo(data.axis).differentNote}.`), data.axis).toBe(expected);
    }
  });

  it("글자를 못 정한 주제는 태그 없이 비교에서 뺐다는 안내를 붙이고, 임시 글자에는 임시 표시가 붙는다", async () => {
    const unusable = compareCouple(bank, SWUA, fixture("unusable-axis"));
    const unusableRow = unusable.axes.find((data) => data.excluded);
    expect(unusableRow?.second.letter).toBeNull();
    await renderResult({ result: unusable });
    const item = axisItems().find((entry) => entry.dataset.axis === unusableRow?.axis);
    expect(item?.dataset.tag).toBe("excluded");
    expect(item?.textContent).toContain(V40_COPY.couple.excludedTagNote);
    expect(item?.textContent).toContain(V40_COPY.legend.notSetLabel);
    for (const label of Object.values(V40_COPY.couple.tagLabels)) expect(item?.textContent).not.toContain(label);

    const provisional = compareCouple(bank, SWUA, fixture("provisional-tie"));
    const provisionalRow = provisional.axes.find((data) => data.excluded);
    expect(provisionalRow?.second.provisional || provisionalRow?.first.provisional).toBe(true);
    await harness.unmount();
    harness = createHarness();
    await renderResult({ result: provisional });
    const provisionalItem = axisItems().find((entry) => entry.dataset.axis === provisionalRow?.axis);
    expect(provisionalItem?.textContent).toContain(V40_COPY.result.provisionalMark);
    expect(provisionalItem?.dataset.tag).toBe("excluded");
  });

  it("두 코드를 하나로 합치거나 같은 글자 개수를 세거나 점수로 바꾸지 않는다", async () => {
    await renderResult({ detectedPerspective: "first" });
    const chrome = text();
    expect(chrome).not.toMatch(FORBIDDEN);
    // 글자 네 개를 이어 붙인 코드가 화면에 없다.
    expect(chrome).not.toMatch(/(?<![A-Za-z])[VSWDUFHA·]{4}(?![A-Za-z])/u);
    // 몇 개가 같다는 식의 셈이 없다.
    expect(chrome).not.toMatch(/\d+\s*(?:개|곳|가지)\s*(?:주제)?\s*(?:가|는)?\s*(?:같|다르)/u);
  });
});

describe("CoupleResult: 질문 목록", () => {
  it("먼저 이야기해 볼 질문과 이미 비슷하게 고른 질문이 결과의 항목 그대로 나온다", async () => {
    await renderResult({ detectedPerspective: "first" });
    const talk = root().querySelector('[data-list="talk"]');
    const similar = root().querySelector('[data-list="similar"]');
    expect(talk?.querySelectorAll("li")).toHaveLength(COUPLE.talk.length);
    expect(similar?.querySelectorAll("li")).toHaveLength(COUPLE.similar.length);
    expect(COUPLE.talk.length).toBeLessThanOrEqual(3);
    expect(COUPLE.similar.length).toBeLessThanOrEqual(3);
    for (const item of COUPLE.talk) {
      expect(talk?.textContent).toContain(item.caption);
      expect(talk?.textContent).toContain(item.firstText);
      expect(talk?.textContent).toContain(item.secondText);
    }
    for (const item of COUPLE.similar) expect(similar?.textContent).toContain(item.caption);
  });

  it("같은 쪽으로 고른 질문이 없으면 없었다고만 말한다", async () => {
    await renderResult({ result: { ...COUPLE, talk: [], similar: [] } });
    expect(text()).toContain(V40_COPY.couple.talk.none);
    expect(text()).toContain(V40_COPY.couple.similar.none);
  });

  it("값이나 차이 같은 숫자는 어느 목록에도 나오지 않는다", async () => {
    const plain: CoupleItemPair = { ...COUPLE.talk[0], caption: "첫 주말", firstText: "총액부터 정해요", secondText: "그날 모습부터 그려요" };
    await renderResult({ result: { ...COUPLE, talk: [plain], similar: [] }, detectedPerspective: "second" });
    expect(root().querySelector('[data-list="talk"]')?.textContent).not.toMatch(/\d/u);
  });
});

describe("CoupleResult: 나 기준으로 보기", () => {
  it("저장된 내 답이 먼저 답한 사람과 같다고 알려 주면 나가 먼저이고 자동 안내가 나온다", async () => {
    await renderResult({ detectedPerspective: "first" });
    expect(text()).toContain(V40_COPY.couple.perspective.autoNote);
    for (const item of axisItems()) {
      expect(personLabels(item)).toEqual([V40_COPY.couple.perspective.meLabel, V40_COPY.couple.perspective.partnerLabel]);
    }
    expect(radios().map((radio) => radio.checked)).toEqual([true, false]);
  });

  it("나중에 답한 사람과 같다고 알려 주면 그쪽의 글자가 나 칸에 먼저 나온다", async () => {
    await renderResult({ detectedPerspective: "second" });
    const first = axisItems()[0];
    expect(personLabels(first)).toEqual([V40_COPY.couple.perspective.meLabel, V40_COPY.couple.perspective.partnerLabel]);
    const data = COUPLE.axes[0];
    expect(personCells(first)).toEqual([
      letterBandCell(data.second.letter, data.second.shownBand, data.second.provisional),
      letterBandCell(data.first.letter, data.first.shownBand, data.first.provisional),
    ]);
  });

  it("맞는 것이 없으면 먼저 답한 사람, 나중에 답한 사람으로 부르고 누가 나인지 고르게 한다", async () => {
    const changes: Perspective[] = [];
    await renderResult({ detectedPerspective: null, onPerspectiveChange: (value) => changes.push(value) });
    expect(text()).toContain(V40_COPY.couple.perspective.askNote);
    expect(radios().map((radio) => radio.checked)).toEqual([false, false]);
    for (const item of axisItems()) {
      expect(personLabels(item)).toEqual([V40_COPY.couple.perspective.firstLabel, V40_COPY.couple.perspective.secondLabel]);
    }
    await click(radios()[1]);
    expect(changes).toEqual(["second"]);
    for (const item of axisItems()) {
      expect(personLabels(item)).toEqual([V40_COPY.couple.perspective.meLabel, V40_COPY.couple.perspective.partnerLabel]);
    }
    expect(text()).not.toContain(V40_COPY.couple.perspective.askNote);
    // 질문 목록도 같은 기준으로 바뀐다.
    const talkLine = root().querySelector('[data-list="talk"] li div p:first-child')?.textContent ?? "";
    expect(talkLine).toBe(V40_COPY.couple.perspective.meLabel);
  });

  it("부모가 이미 아는 기준(initialPerspective)이 있으면 안내 없이 그 기준으로 보인다", async () => {
    await renderResult({ detectedPerspective: null, initialPerspective: "second" });
    expect(text()).not.toContain(V40_COPY.couple.perspective.askNote);
    expect(personLabels(axisItems()[0])).toEqual([V40_COPY.couple.perspective.meLabel, V40_COPY.couple.perspective.partnerLabel]);
    expect(radios().map((radio) => radio.checked)).toEqual([false, true]);
  });

  it("자동으로 정한 뒤 사람이 다른 쪽을 고르면 그쪽이 이긴다", async () => {
    await renderResult({ detectedPerspective: "first" });
    await click(radios()[1]);
    const data = COUPLE.axes[0];
    expect(personCells(axisItems()[0])[0]).toBe(letterBandCell(data.second.letter, data.second.shownBand, data.second.provisional));
    expect(text()).not.toContain(V40_COPY.couple.perspective.autoNote);
  });
});

describe("CoupleResult: 두 사람의 자리를 바꿔도 화면이 같다", () => {
  const part = (selector: string) => root().querySelector(selector)?.innerHTML ?? "";

  it("결과 자체가 대칭이다(compareCouple(나, 상대)를 뒤집으면 compareCouple(상대, 나))", () => {
    expect(compareCouple(bank, PARTNER, SWUA)).toEqual(swapCouple(COUPLE));
  });

  it("먼저 답한 사람이 나인 화면과, 자리를 바꾸고 나중에 답한 사람이 나인 화면의 주제 줄과 목록 두 곳이 글자 그대로 같다", async () => {
    await renderResult({ result: COUPLE, detectedPerspective: "first" });
    const original = ['[data-part="axes"]', '[data-list="talk"]', '[data-list="similar"]'].map(part);
    await harness.unmount();
    harness = createHarness();
    await renderResult({ result: compareCouple(bank, PARTNER, SWUA), detectedPerspective: "second" });
    const swapped = ['[data-part="axes"]', '[data-list="talk"]', '[data-list="similar"]'].map(part);
    expect(swapped).toEqual(original);
    expect(original.every((html) => html.length > 0)).toBe(true);
  });

  it("고른 기준이 있는 화면도 자리를 바꾸면 같다(손으로 뒤집은 결과)", async () => {
    await renderResult({ result: COUPLE, detectedPerspective: null, initialPerspective: "first" });
    const original = part('[data-part="axes"]') + part('[data-list="talk"]') + part('[data-list="similar"]');
    await harness.unmount();
    harness = createHarness();
    await renderResult({ result: swapCouple(COUPLE), detectedPerspective: null, initialPerspective: "second" });
    const swapped = part('[data-part="axes"]') + part('[data-list="talk"]') + part('[data-list="similar"]');
    expect(swapped).toBe(original);
  });

  it("기준을 모르면 자리를 바꾼 화면은 두 사람 칸의 순서만 바뀌고 같은 칸들이 나온다", async () => {
    await renderResult({ result: COUPLE, detectedPerspective: null });
    const original = axisItems().map((item) => [...personCells(item)].sort());
    await harness.unmount();
    harness = createHarness();
    await renderResult({ result: swapCouple(COUPLE), detectedPerspective: null });
    const swapped = axisItems().map((item) => [...personCells(item)].sort());
    expect(swapped).toEqual(original);
    expect(axisItems().map((item) => item.dataset.tag)).toEqual(COUPLE.axes.map((data) => (data.excluded ? "excluded" : data.tag)));
  });
});

describe("CoupleResult: 이 결과를 상대에게도 보내기", () => {
  it("send 를 주지 않으면 보내기 블록도 체크도 없다", async () => {
    await renderResult();
    expect(heading(V40_COPY.coupleSend.title)).toBeNull();
    expect(root().querySelector('input[type="checkbox"]')).toBeNull();
    expect(text()).not.toContain(V40_COPY.coupleSend.help);
  });

  it("send 를 주면 절 제목 아래에 체크 둘과 단추가 나오고, 체크 둘을 켜야 보낼 수 있다", async () => {
    const writeText = vi.fn(async () => undefined);
    const buildUrl = vi.fn<() => string | null>(() => "https://example.test/both");
    const events: ShareSentEvent[] = [];
    await renderResult({ send: { buildUrl, onSent: (event) => events.push(event), env: { writeText } } });
    expect(heading(V40_COPY.coupleSend.title)?.tagName).toBe("H2");
    const boxes = [...root().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(2);
    const button = [...root().querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.includes(V40_COPY.coupleSend.sendButton));
    expect(button?.getAttribute("aria-disabled")).toBe("true");
    await click(button);
    expect(buildUrl).not.toHaveBeenCalled();
    for (const box of boxes) await click(box);
    await click(button);
    expect(buildUrl).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${V40_COPY.coupleSend.message}\nhttps://example.test/both`);
    expect(events).toEqual([{ kind: "copied" }]);
  });

  it("처음부터 해 보기 단추는 onStartOwn 을 줄 때만 나온다", async () => {
    await renderResult();
    expect([...root().querySelectorAll("button")].some((button) => button.textContent === V40_COPY.couple.startOwnButton)).toBe(false);
    expect(text()).not.toContain(V40_COPY.couple.startOwnNote);
    await harness.unmount();
    harness = createHarness();
    const onStartOwn = vi.fn();
    await renderResult({ onStartOwn });
    const button = [...root().querySelectorAll("button")].find((entry) => entry.textContent === V40_COPY.couple.startOwnButton);
    // 누르면 이 결과 화면이 닫힌다는 것을 단추 이름 옆 글이 알리고, 단추 설명으로 이어진다.
    expect(text()).toContain(V40_COPY.couple.startOwnNote);
    const describedBy = button?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect([...root().querySelectorAll("[id]")].find((element) => element.id === describedBy)?.textContent).toBe(V40_COPY.couple.startOwnNote);
    await click(button);
    expect(onStartOwn).toHaveBeenCalledTimes(1);
  });
});

describe("CoupleResult: 라운지 안(embedded)", () => {
  it("embedded 이면 하단 탭 막대가 가리지 않게 맨 아래에 여백을 남긴다", async () => {
    await renderResult({ embedded: true });
    const section = root().querySelector("section");
    for (const token of V40_EMBEDDED_BOTTOM_SPACE.split(" ")) expect(section?.className).toContain(token);
    expect(section?.getAttribute("data-embedded")).toBe("true");
  });

  it("embedded 가 아니면 여백 클래스가 없다", async () => {
    await renderResult();
    const section = root().querySelector("section");
    for (const token of V40_EMBEDDED_BOTTOM_SPACE.split(" ")) expect(section?.className).not.toContain(token);
    expect(section?.getAttribute("data-embedded")).toBeNull();
  });
});

describe("CoupleResult: 말씨와 서버 없음", () => {
  it("평가하거나 주장하는 낱말이 없고 번호 라벨이 없다", async () => {
    await renderResult({ detectedPerspective: "first", send: { buildUrl: () => null, onSent: () => undefined } });
    const chrome = text();
    expect(chrome).not.toMatch(FORBIDDEN);
    expect(chrome).not.toMatch(/\d\s*\/\s*\d/u);
    expect(chrome).not.toMatch(/번째/u);
    expect(chrome).not.toMatch(/(?:^|\s)[A-Z][.)]\s/u);
    expect(root().querySelector("ol")).toBeNull();
  });

  it("질문 목록을 비우면 화면 어디에도 숫자와 백분율 기호가 없다", async () => {
    await renderResult({ result: { ...COUPLE, talk: [], similar: [] }, detectedPerspective: "first" });
    expect(text()).not.toMatch(/[\d%]/u);
  });

  it("그리기와 보내기 전 과정에서 요청을 보내지 않고 이 기기의 저장소를 읽거나 쓰지 않는다", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const writeText = vi.fn(async () => undefined);
    await renderResult({ detectedPerspective: null, send: { buildUrl: () => "https://example.test/both", onSent: () => undefined, env: { writeText } } });
    await click(radios()[0]);
    for (const box of root().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await click(box);
    const button = [...root().querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.includes(V40_COPY.coupleSend.sendButton));
    await click(button);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("제목에 초점을 줄 수 있다(부모가 화면이 바뀐 뒤 옮긴다)", async () => {
    await renderResult();
    expect(root().querySelector("h1")?.getAttribute("tabindex")).toBe("-1");
  });
});

describe("CoupleResult: 제목 수준(제목 다음에 한 단계씩만 내려간다)", () => {
  it("제목 h1, 구역 제목 h2, 주제 줄 제목 h3 이고 h1 다음에 h3 이 바로 오는 건너뜀이 없다", async () => {
    await renderResult({ send: { buildUrl: () => "https://example.test/x", onSent: () => undefined } });
    const levels = [...root().querySelectorAll("h1, h2, h3, h4, h5")].map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    levels.forEach((level, index) => {
      if (index > 0) expect(level, `${index}번째 제목`).toBeLessThanOrEqual(levels[index - 1] + 1);
    });
    expect([...root().querySelectorAll("h2")].map((node) => node.textContent)).toEqual([
      V40_COPY.legend.title,
      V40_COUPLE_SEND_EXTRA_COPY.axesHeading,
      V40_COPY.couple.talk.title,
      V40_COPY.couple.similar.title,
      V40_COPY.coupleSend.title,
    ]);
    expect(root().querySelectorAll("[data-part='axes'] h3")).toHaveLength(4);
    expect(root().querySelector("h4")).toBeNull();
  });

  it("라운지 안(embedded)에서는 제목 h2, 구역 제목 h3, 주제 줄 제목 h4 로 한 단계씩 아래다", async () => {
    await renderResult({ embedded: true, send: { buildUrl: () => "https://example.test/x", onSent: () => undefined } });
    const levels = [...root().querySelectorAll("h1, h2, h3, h4, h5")].map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(2);
    levels.forEach((level, index) => {
      if (index > 0) expect(level, `${index}번째 제목`).toBeLessThanOrEqual(levels[index - 1] + 1);
    });
    expect(root().querySelectorAll("[data-part='axes'] h4")).toHaveLength(4);
    expect(root().querySelector("h1")).toBeNull();
  });
});

describe("CoupleResult: 링크를 보내 준 상대가 결과를 보려면 내가 다시 보내야 한다는 말", () => {
  const send = { buildUrl: () => "https://example.test/x", onSent: () => undefined };

  it("보내기 블록이 있으면 제목과 고지 아래에 그 사정과 보내는 곳으로 가는 단추가 있다", async () => {
    await renderResult({ send });
    const step = root().querySelector("[data-couple-return-step]")!;
    expect(step.textContent).toContain(V40_COPY.couple.returnStepNote);
    expect([...step.querySelectorAll("button")].map((button) => button.textContent)).toEqual([V40_COPY.couple.returnStepButton]);
    const notice = [...root().querySelectorAll("p")].find((p) => p.textContent === V40_COPY.couple.notice) as Node;
    expect(isBefore(notice, step)).toBe(true);
    // 검증 아님 고지는 여전히 한 번이다
    expect(countOf(text(), V40_NOT_VALIDATED_PHRASE)).toBe(1);
  });

  it("보내기 블록이 없는 화면(두 사람 답이 든 링크를 연 화면)에는 이 말도 단추도 없다", async () => {
    await renderResult();
    expect(root().querySelector("[data-couple-return-step]")).toBeNull();
    expect(text()).not.toContain(V40_COPY.couple.returnStepNote);
  });

  it("단추를 누르면 보내기 블록으로 초점과 스크롤이 옮겨 간다", async () => {
    await renderResult({ send });
    const region = root().querySelector<HTMLElement>("section[tabindex='-1'][aria-labelledby]")!;
    expect(region.querySelector("h2")?.textContent).toBe(V40_COPY.coupleSend.title);
    const scroll = vi.fn();
    region.scrollIntoView = scroll;
    const button = [...root().querySelectorAll("button")].find((each) => each.textContent === V40_COPY.couple.returnStepButton)!;
    await click(button);
    expect(document.activeElement).toBe(region);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});

describe("CoupleResult: 나 기준을 고르면 낭독기에 바뀐 사실을 알린다", () => {
  it("알림 자리는 늘 문서에 있고 처음에는 비어 있으며, 고를 때마다 고른 것을 말한다", async () => {
    await renderResult();
    const status = () => root().querySelector("[data-perspective-status]")!;
    expect(status().getAttribute("role")).toBe("status");
    expect(status().textContent).toBe("");
    await click(radios()[0]);
    expect(status().textContent).toBe(perspectiveChangedAnnouncement("first"));
    await click(radios()[1]);
    expect(status().textContent).toBe(perspectiveChangedAnnouncement("second"));
    expect(perspectiveChangedAnnouncement("first")).not.toBe(perspectiveChangedAnnouncement("second"));
    expect(status().className).toContain("sr-only");
  });
});
