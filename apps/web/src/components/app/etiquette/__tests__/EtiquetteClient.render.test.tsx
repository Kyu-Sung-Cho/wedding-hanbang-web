// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ isDemo: false, user: { id: "u" }, journey: null, updateJourney: vi.fn() }),
}));
vi.mock("@/utils/scheduleEvents", () => ({
  getEvents: () => [],
  addEvent: vi.fn(),
  updateEvent: vi.fn(),
}));

import { ETIQUETTE_PARTS } from "@/constants/etiquetteData";
import { BlockRenderer, parseContent, type ParsedBlock } from "../EtiquetteClient";

/**
 * 렌더 단계 회귀 가드.
 *
 * 파서가 블록 타입을 맞게 줘도 렌더러가 그 타입에 체크박스를 붙이면 같은 사고가 난다 —
 * 2026-08-19 이전에는 "관계별 축의금 금액 가이드"(금액)와 "전통적 분담 기준"(성별 혼수
 * 분담)이 실제로 **체크박스 달린 할 일**로 그려졌다.
 *
 * 섹션 선택 UI를 거치지 않고 블록을 직접 렌더한다. 화면 이동 경로가 아니라 "이 블록이
 * 어떻게 그려지는가"가 검사 대상이기 때문이다.
 */
const blockByTitle = (partNumber: number, titleFragment: string): ParsedBlock => {
  const part = ETIQUETTE_PARTS.find((p) => p.number === partNumber);
  if (!part) throw new Error(`Part ${partNumber} 없음`);
  const block = parseContent(part.content)
    .flatMap((section) => section.blocks)
    .find((b) => (b.title ?? "").includes(titleFragment));
  if (!block) throw new Error(`Part ${partNumber}에 "${titleFragment}" 블록 없음`);
  return block;
};

let container: HTMLDivElement;
let root: Root;

const renderBlock = async (block: ParsedBlock) => {
  await act(async () => {
    root.render(
      <BlockRenderer
        block={block}
        blockId="test"
        checkedItems={new Set()}
        itemMemos={{}}
        onToggleCheck={vi.fn()}
        onOpenSchedule={vi.fn()}
        onOpenMemo={vi.fn()}
      />,
    );
  });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const checkboxes = () => container.querySelectorAll("div.rounded-full.border-2").length;
const actionButtons = () => container.querySelectorAll("button[title]").length;

describe("BlockRenderer", () => {
  // 버그 1 — 참고 표는 읽는 것이지 완료하는 것이 아니다.
  it("renders the money guide as reference, with no checkbox or action buttons", async () => {
    const block = blockByTitle(9, "관계별 축의금 참고 범위");
    expect(block.type).toBe("reference");

    await renderBlock(block);

    expect(checkboxes()).toBe(0);
    expect(actionButtons()).toBe(0);
    expect(container.textContent).toContain("읽고 참고하는 표예요");
    // 내용 자체는 그대로 읽힌다.
    expect(container.textContent).toContain("절친/오래된 친구: 15~20만원");
  });

  // 버그 1 — 성별 혼수 분담표도 마찬가지.
  it("renders the gendered dowry split as reference, not a to-do list", async () => {
    const block = blockByTitle(8, "전통적 분담 기준");
    expect(block.type).toBe("reference");

    await renderBlock(block);

    expect(checkboxes()).toBe(0);
    expect(actionButtons()).toBe(0);
    expect(container.textContent).toContain("신랑측");
  });

  // 과잉 수정 방지 — 진짜 체크리스트는 계속 체크할 수 있어야 한다.
  it("keeps real checklists actionable", async () => {
    const block = blockByTitle(9, "체크리스트");
    expect(block.type).toBe("checklist");

    await renderBlock(block);

    expect(checkboxes()).toBeGreaterThan(0);
    expect(actionButtons()).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("읽고 참고하는 표예요");
  });

  // 버그 3 — 마크다운 표가 진짜 <table>로 나온다.
  it("renders the cost table as a real table", async () => {
    // 이 표는 `####` 제목 없이 섹션 본문에 바로 있어서 제목으로 못 찾는다.
    const part25 = ETIQUETTE_PARTS.find((p) => p.number === 25)!;
    const block = parseContent(part25.content)
      .flatMap((section) => section.blocks)
      .find((b) => b.items.some((item) => item.type === "table-row"));
    expect(block, "표 블록을 찾지 못했다").toBeTruthy();

    await renderBlock(block!);

    const table = container.querySelector("table");
    expect(table, "표가 <table>로 렌더되지 않았다").not.toBeNull();
    expect(table!.querySelectorAll("thead th").length).toBeGreaterThan(0);
    expect(table!.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    // 파이프 문자가 본문에 남지 않는다.
    expect(container.textContent).not.toContain("|---");
    expect(container.textContent).not.toContain("| 항목 |");
  });

  // 코퍼스에서 편집 표기를 걷어냈는지 확인한다. 2026-08-19 문구 정리로 P13의
  // `(X)/(O)`가 사라졌다 — 사용자가 복사해 쓰는 대사에 교정 기호가 섞이면 안 된다.
  it("no longer ships editorial (X)/(O) markers in dialogue", async () => {
    const leaked = ETIQUETTE_PARTS.flatMap((part) =>
      parseContent(part.content)
        .flatMap((section) => section.blocks)
        .flatMap((block) => block.items)
        .filter((item) => item.type === "dialogue-text" && /\((X|O)\)/.test(item.text))
        .map((item) => item.text),
    );
    expect(leaked).toEqual([]);
  });

  // 렌더러의 (X)/(O) 처리 능력 자체는 유지한다 — 코퍼스가 다시 그 표기를 쓰더라도
  // 사용자가 교정 기호를 그대로 읽는 일은 없어야 한다.
  it("converts editorial (X)/(O) markers into avoid/prefer styling", async () => {
    const dialogue: ParsedBlock = {
      type: "dialogue",
      title: "테스트 대사",
      items: [
        { type: "dialogue-speaker", text: "혼주에게 인사" },
        {
          type: "dialogue-text",
          text: "와주셔서 감사합니다 (X) → 이건 혼주가 하는 말\n귀한 자리에 초대해 주셔서 감사합니다. (O)",
        },
      ],
    };

    await renderBlock(dialogue);

    expect(container.textContent).toContain("피할 표현");
    expect(container.textContent).toContain("권하는 표현");
    expect(container.textContent).not.toContain("(X)");
    expect(container.textContent).not.toContain("(O)");
    expect(container.querySelectorAll(".line-through").length).toBeGreaterThan(0);
  });

  // 버그 4 — '- ✅' 앞머리 체크 글자가 렌더된 체크 표시와 겹치지 않는다.
  it("does not double up check glyphs", async () => {
    const timeline = ETIQUETTE_PARTS.find((p) => p.number === 21)!;
    const blocks = parseContent(timeline.content).flatMap((section) => section.blocks);
    const withChecks = blocks.find((b) => b.items.some((item) => item.type === "list-item"));
    expect(withChecks).toBeTruthy();

    await renderBlock(withChecks!);
    expect(container.textContent).not.toMatch(/[✅☑✔]/);
  });
});
