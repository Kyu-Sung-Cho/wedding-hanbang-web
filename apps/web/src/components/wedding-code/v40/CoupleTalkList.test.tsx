import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";
import type { CoupleItemPair, Perspective } from "@/lib/weddingCode/v40/types";
import { CoupleTalkList, type CoupleListKind } from "./CoupleTalkList";
import { createHarness, type Harness } from "./inputTestKit";

let harness: Harness;
beforeEach(() => {
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
});

/** 배치표의 실제 문항 id(형식: 이럴 때 내 마음은 process.search.1, 두 가지 중 고르기는 money.limit.1, 칸 나누기는 money.moment.1). */
const REACT_ID = "process.search.1";
const PAIR_ID = "money.limit.1";
const SPLIT_ID = "money.moment.1";

function pair(itemId: string, axis: CoupleItemPair["axis"], caption: string, firstText: string, secondText: string): CoupleItemPair {
  return { itemId, axis, facet: "limit", caption, firstValue: 6, secondValue: -6, gap: 12, firstText, secondText };
}

const PAIR_ITEM = pair(PAIR_ID, "money", "첫 주말의 대화", "총액부터 정해요", "그날 모습부터 그려요");
const SECOND_MONEY = pair(SPLIT_ID, "money", "남는 돈의 자리", "생활에 둬요", "그날에 써요");
const REACT_ITEM = pair(REACT_ID, "process", "주말 둘러보기 제안", "든든할 것 같아요", "부담될 것 같아요");

async function renderList(kind: CoupleListKind, items: readonly CoupleItemPair[], perspective: Perspective | null): Promise<HTMLElement> {
  await harness.render(<CoupleTalkList kind={kind} items={items} perspective={perspective} idPrefix="t-list" />);
  return harness.container;
}

const paragraphs = (root: HTMLElement) => [...root.querySelectorAll("li p")].map((p) => p.textContent);

describe("CoupleTalkList: 먼저 이야기해 볼 질문", () => {
  it("제목과 한 줄 안내가 있고, 항목마다 문항 제목과 각자 고른 원문이 그대로 나온다", async () => {
    const root = await renderList("talk", [PAIR_ITEM], null);
    expect(root.querySelector("h3")?.textContent).toBe(V40_COPY.couple.talk.title);
    expect(root.textContent).toContain(V40_COPY.couple.talk.lead);
    // 고른 문장의 「…해도」로 이어지는 부분은 상대를 탓하는 말이 아니라는 안내가 제목 아래에 한 번 있다.
    expect(root.querySelectorAll("[data-choice-cost-note]")).toHaveLength(1);
    expect(root.querySelector("[data-choice-cost-note]")?.textContent).toBe(V40_COPY.couple.choiceCostNote);
    expect(root.querySelectorAll("li")).toHaveLength(1);
    // 사람은 보기 원문 위의 이름표로 부르고 원문에 조사를 이어 붙이지 않는다.
    expect(paragraphs(root).slice(0, 5)).toEqual([
      "첫 주말의 대화",
      V40_COPY.couple.perspective.firstLabel,
      "총액부터 정해요",
      V40_COPY.couple.perspective.secondLabel,
      "그날 모습부터 그려요",
    ]);
  });

  it("보기 글이 명사로 끝나거나 남의 이야기여도 이름표를 이어 붙인 어색한 문장이 되지 않고 원문 그대로 나온다", async () => {
    const nounEnding = pair(
      PAIR_ID,
      "support",
      "지친 날의 저녁",
      "다음 날 아침 둘 다 녹초가 되었지만 상대가 밤늦도록 내 얘기를 들어 주던 순간 (아주 가까워요)",
      "얘기할 틈은 없었지만 상대가 내일 할 일 하나를 말없이 가져가 준 일이 아직도 고마운 순간",
    );
    const story = pair(SPLIT_ID, "money", "친구 커플 이야기", "둘이 고른 옷을 입은 커플이에요", "고른 곳에서 열린 지인의 행사에 가 본 커플이에요");
    for (const perspective of [null, "first", "second"] as const) {
      const root = await renderList("talk", [nounEnding, story], perspective);
      const lines = paragraphs(root);
      // 이름표 아래에 원문이 한 줄로 그대로 있다
      expect(lines).toContain(nounEnding.firstText);
      expect(lines).toContain(nounEnding.secondText);
      expect(lines).toContain(story.firstText);
      // 「나는 …순간」 「둘 다 …커플이에요」처럼 이름표가 원문 앞에 붙은 줄은 없다
      expect(lines.filter((line) => /^(나는|상대는|먼저 답한 사람은|나중에 답한 사람은) /u.test(line ?? ""))).toEqual([]);
      // 각 원문 바로 앞 줄이 이름표다
      const labels = [V40_COPY.couple.perspective.meLabel, V40_COPY.couple.perspective.partnerLabel, V40_COPY.couple.perspective.firstLabel, V40_COPY.couple.perspective.secondLabel];
      lines.forEach((line, index) => {
        if (line === nounEnding.firstText || line === nounEnding.secondText) expect(labels).toContain(lines[index - 1]);
      });
    }
  });

  it("기준을 알면 나가 먼저이고 나, 상대 이름표로 부른다", async () => {
    const first = await renderList("talk", [PAIR_ITEM], "first");
    expect(paragraphs(first).slice(1, 5)).toEqual(["나", "총액부터 정해요", "상대", "그날 모습부터 그려요"]);
    const second = await renderList("talk", [PAIR_ITEM], "second");
    expect(paragraphs(second).slice(1, 5)).toEqual(["나", "그날 모습부터 그려요", "상대", "총액부터 정해요"]);
  });

  it("비었으면 없었다고만 말하고 안내와 목록은 없다", async () => {
    const root = await renderList("talk", [], null);
    expect(root.textContent).toContain(V40_COPY.couple.talk.none);
    expect(root.textContent).not.toContain(V40_COPY.couple.talk.lead);
    expect(root.querySelector("ul")).toBeNull();
  });

  it("주제의 여는 질문은 그 주제가 처음 나온 항목 아래에 한 번만 붙는다", async () => {
    const root = await renderList("talk", [PAIR_ITEM, REACT_ITEM, SECOND_MONEY], null);
    const text = root.textContent ?? "";
    expect(text.split(V40_COPY.couple.talk.opening.money)).toHaveLength(2);
    expect(text.split(V40_COPY.couple.talk.opening.process)).toHaveLength(2);
    // 여는 질문은 처음 나온 항목 안에 있다.
    const items = [...root.querySelectorAll("li")];
    expect(items[0].textContent).toContain(V40_COPY.couple.talk.opening.money);
    expect(items[1].textContent).toContain(V40_COPY.couple.talk.opening.process);
    expect(items[2].textContent).not.toContain(V40_COPY.couple.talk.opening.money);
  });

  it("이럴 때 내 마음 질문이 있으면 상대는 각자 곁의 사람이라는 안내가 한 번, 없으면 없다", async () => {
    const withReact = await renderList("talk", [PAIR_ITEM, REACT_ITEM], null);
    expect((withReact.textContent ?? "").split(V40_COPY.couple.viewpointNote)).toHaveLength(2);
    const without = await renderList("talk", [PAIR_ITEM, SECOND_MONEY], null);
    expect(without.textContent).not.toContain(V40_COPY.couple.viewpointNote);
  });

  it("값이나 차이 같은 숫자를 내지 않는다", async () => {
    const root = await renderList("talk", [PAIR_ITEM, SECOND_MONEY, REACT_ITEM], "first");
    expect(root.textContent).not.toMatch(/\d/u);
  });
});

describe("CoupleTalkList: 이미 비슷하게 고른 질문", () => {
  it("제목과 같은 쪽으로 골랐다는 안내가 나오고 여는 질문은 없다", async () => {
    const root = await renderList("similar", [PAIR_ITEM, REACT_ITEM], null);
    expect(root.querySelector("h3")?.textContent).toBe(V40_COPY.couple.similar.title);
    expect(root.textContent).toContain(V40_COPY.couple.similar.lead);
    for (const line of Object.values(V40_COPY.couple.talk.opening)) expect(root.textContent).not.toContain(line);
    expect(root.textContent).not.toContain(V40_COPY.couple.talk.lead);
  });

  it("비었으면 뚜렷하게 같은 쪽으로 고른 질문이 없었다고만 말한다", async () => {
    const root = await renderList("similar", [], "first");
    expect(root.textContent).toContain(V40_COPY.couple.similar.none);
    expect(root.querySelector("li")).toBeNull();
  });

  it("이럴 때 내 마음 질문이 있으면 여기에도 각자 곁의 사람이라는 안내가 붙는다", async () => {
    const root = await renderList("similar", [REACT_ITEM], null);
    expect(root.textContent).toContain(V40_COPY.couple.viewpointNote);
  });

  it("다른 형식의 질문이라도 고른 보기 글에 「상대」가 들어 있으면 같은 안내가 한 번 붙는다(「나는 …, 상대는 …상대는 …」로 읽히는 혼동)", async () => {
    const withPartnerWord = pair(PAIR_ID, "money", "첫 주말의 대화", "상대에게 먼저 물어봐요", "제가 먼저 정해요");
    const talk = await renderList("talk", [withPartnerWord], "first");
    expect((talk.textContent ?? "").split(V40_COPY.couple.viewpointNote)).toHaveLength(2);
    const similar = await renderList("similar", [withPartnerWord], null);
    expect((similar.textContent ?? "").split(V40_COPY.couple.viewpointNote)).toHaveLength(2);
    // 「상대」가 어디에도 없으면 붙지 않는다.
    const without = await renderList("similar", [PAIR_ITEM], null);
    expect(without.textContent).not.toContain(V40_COPY.couple.viewpointNote);
  });

  it("두 사람이 같은 보기를 골랐으면 같은 글을 두 번 읽히지 않고 「둘 다」 한 줄로 말한다", async () => {
    const same = pair(PAIR_ID, "money", "첫 주말의 대화", "총액부터 정해요", "총액부터 정해요");
    const root = await renderList("similar", [same], "first");
    const lines = paragraphs(root);
    expect(lines.filter((line) => line?.includes("총액부터 정해요"))).toEqual(["총액부터 정해요"]);
    expect(lines.slice(1, 3)).toEqual([V40_COPY.couple.bothTopic, "총액부터 정해요"]);
    expect(root.querySelector("[data-both-same]")).not.toBeNull();
    // 서로 다르면 지금처럼 각자 이름표와 함께 나온다.
    const different = await renderList("similar", [PAIR_ITEM], "first");
    expect(different.querySelector("[data-both-same]")).toBeNull();
    expect(paragraphs(different).slice(1, 5)).toEqual(["나", "총액부터 정해요", "상대", "그날 모습부터 그려요"]);
  });

  it("같은 보기를 다른 세기로 골랐으면(아주 가까워요 덧말만 다르다) 같은 보기 글을 두 번 읽히지 않고 「둘 다」 한 줄로 말한다", async () => {
    const strongAndMild = pair(PAIR_ID, "money", "첫 주말의 대화", "총액부터 정해요 (아주 가까워요)", "총액부터 정해요");
    const root = await renderList("similar", [strongAndMild], "first");
    const lines = paragraphs(root);
    expect(lines.filter((line) => line?.includes("총액부터 정해요"))).toEqual(["총액부터 정해요"]);
    expect(lines.slice(1, 3)).toEqual([V40_COPY.couple.bothTopic, "총액부터 정해요"]);
    expect(root.querySelector("[data-both-same]")).not.toBeNull();
    // 덧말이 붙지 않은 글 하나로 적는다(세기는 여기서 말하지 않는다)
    expect(root.textContent).not.toContain("아주 가까워요");
    // 이럴 때 내 마음의 덧말(조금 가까워요)도 같다
    const reactPair = pair(REACT_ID, "process", "주말 둘러보기 제안", "든든할 것 같아요", "든든할 것 같아요 (조금 가까워요)");
    const react = await renderList("similar", [reactPair], null);
    expect(paragraphs(react).filter((line) => line?.includes("든든할 것 같아요"))).toEqual(["든든할 것 같아요"]);
    // 다른 보기는 덧말이 있어도 같은 보기가 아니다
    const different = pair(PAIR_ID, "money", "첫 주말의 대화", "총액부터 정해요 (아주 가까워요)", "그날 모습부터 그려요");
    const notSame = await renderList("similar", [different], "first");
    expect(notSame.querySelector("[data-both-same]")).toBeNull();
    expect(paragraphs(notSame).slice(1, 5)).toEqual(["나", "총액부터 정해요 (아주 가까워요)", "상대", "그날 모습부터 그려요"]);
  });
});

describe("CoupleTalkList: 말씨", () => {
  it("평가하는 말이 없다", async () => {
    const root = await renderList("talk", [PAIR_ITEM, REACT_ITEM], "first");
    expect(root.textContent).not.toMatch(/궁합|잘 ?맞|안 ?맞|점수|등급|퍼센트|백분율|%|맞지 않|틀렸/u);
  });

  it("목록은 번호를 매기지 않는 ul 이다", async () => {
    const root = await renderList("talk", [PAIR_ITEM, REACT_ITEM], null);
    expect(root.querySelector("ol")).toBeNull();
    expect(root.querySelector("ul")?.getAttribute("role")).toBe("list");
  });
});
