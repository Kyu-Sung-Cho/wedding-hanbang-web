import { describe, expect, it } from "vitest";

import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { parseContent, type ParsedBlock, type ParsedItem } from "../EtiquetteClient";

/**
 * 2026-08-19에 25파트 코퍼스와 렌더러를 되살리면서 파서 버그 5건을 고쳤다.
 * 이 테스트는 소스 문자열이 아니라 **실제 25파트를 통과시킨 결과**를 본다 —
 * 그래야 코퍼스가 바뀌어도 같은 사고가 다시 나는지 잡힌다.
 */
const ALL_BLOCKS: { part: string; block: ParsedBlock }[] = ETIQUETTE_PARTS.flatMap((part) =>
  parseContent(part.content).flatMap((section) =>
    section.blocks.map((block) => ({ part: part.title, block })),
  ),
);

const allItems = (predicate: (item: ParsedItem, block: ParsedBlock) => boolean) =>
  ALL_BLOCKS.flatMap(({ block }) => block.items.filter((item) => predicate(item, block)));

describe("etiquette corpus parser", () => {
  it("parses every part without throwing", () => {
    expect(ETIQUETTE_PARTS).toHaveLength(25);
    // 25파트가 실제로 만들어내는 블록 수. 코퍼스를 손대면 여기가 먼저 움직인다.
    expect(ALL_BLOCKS).toHaveLength(181);
    expect(ETIQUETTE_PARTS.every((part) => parseContent(part.content).length > 0)).toBe(true);
  });

  // 버그 1 — 제목에 "가이드·분담·기준"이 있으면 checklist가 돼서 축의금 금액과
  // 성별 혼수 분담이 체크박스 할 일로 렌더됐다.
  it("routes reference tables to `reference`, never `checklist`", () => {
    const misrouted = ALL_BLOCKS.filter(
      ({ block }) =>
        block.type === "checklist" &&
        /가이드|분담|분류|구성/.test(block.title ?? "") &&
        !/체크/.test(block.title ?? ""),
    ).map(({ part, block }) => `${part} / ${block.title}`);

    expect(misrouted, `참고 표가 체크리스트로 렌더된다: ${misrouted.join(", ")}`).toEqual([]);

    const references = ALL_BLOCKS.filter(({ block }) => block.type === "reference");
    expect(references.length).toBe(8);
    expect(references.map(({ block }) => block.title ?? "").some((t) => t.includes("관계별 축의금 참고 범위"))).toBe(true);
    expect(references.map(({ block }) => block.title)).toContain("전통적 분담 기준");
  });

  // 버그 2 — group-title 분기가 `**화자:**`를 먼저 삼켜서 dialogue-speaker가 죽은
  // 코드였다. 대사가 본문 텍스트로 흘러내렸다.
  it("parses dialogue speakers instead of leaking them as body text", () => {
    const speakers = allItems((item) => item.type === "dialogue-speaker");
    expect(speakers.length).toBeGreaterThan(40);
    expect(speakers.map((item) => item.text)).toContain("혼주에게 인사");

    // 화자 표기가 group-title로 새지 않는다.
    const leaked = allItems((item) => item.type === "group-title" && item.text.endsWith(":"));
    expect(leaked.map((item) => item.text)).toEqual([]);
  });

  // 버그 3 — 파서에 `|` 분기가 없어 Part 25 비용표가 파이프 문자로 노출됐다.
  it("parses markdown tables into cells", () => {
    const rows = allItems((item) => item.type === "table-row");
    expect(rows.length).toBe(10); // 11줄 중 |---| 구분선 1줄은 헤더 승격에 쓰이고 사라진다
    expect(rows.filter((row) => row.isHeader)).toHaveLength(1);
    expect(rows.every((row) => (row.cells?.length ?? 0) >= 2)).toBe(true);

    // 파이프 문자가 본문 텍스트로 남지 않는다.
    const rawPipes = allItems((item) => item.type === "text" && item.text.startsWith("|"));
    expect(rawPipes.map((item) => item.text)).toEqual([]);
  });

  // 버그 4 — `- ✅ …` 74줄이 렌더된 체크 표시 옆에 ✅를 한 번 더 찍었다.
  it("strips leading check glyphs from list items", () => {
    const doubled = allItems((item) => item.type === "list-item" && /^[✅☑✔✓]/.test(item.text));
    expect(doubled.map((item) => item.text)).toEqual([]);
  });

  // 버그 5 — Part 23만 description이 빈 문자열이다. 렌더러가 빈 줄을 그리지 않는지는
  // 컴포넌트 쪽 가드가 보고, 여기서는 그 파트가 여전히 하나뿐인지만 고정해 둔다.
  it("still has exactly one part with an empty description", () => {
    const empty = ETIQUETTE_PARTS.filter((part) => !part.description.trim()).map((part) => part.number);
    expect(empty).toEqual([23]);
  });
});
