// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31 } from "@/lib/weddingCode/v31";
import WeddingCodeV31Results from "./WeddingCodeV31Results";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function basicDraft(): V31Draft {
  const draft = createV31Draft();
  draft.answers = { G1: 5, G3: 4, R4: 4, B1: 5, B3: 2, D1: 4, T1: 4, T2: 4, T3: 4, F1: 4, F2: 5, F4: 4, H1: 4, H2: 4, H4: 4 };
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "answered", values: [taste.options[0].value] };
  draft.avoidances = { status: "no_preference" };
  draft.spending = { status: "no_preference" };
  return draft;
}

describe("두 사람 결과 탭", () => {
  let container: HTMLDivElement;
  let root: Root;
  let first: V31Draft;
  let draft: V31Draft;
  const onEdit = vi.fn();
  const onMore = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/wedding-code");
    first = basicDraft(); draft = basicDraft();
    draft.answers.B1 = 2; draft.answers.B3 = 5;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });

  async function render(props: Partial<Parameters<typeof WeddingCodeV31Results>[0]> = {}) {
    await act(async () => root.render(<WeddingCodeV31Results draft={draft} first={first} received={false} shareOrigin="https://hanbang.ai"
      onEdit={onEdit} onRestart={() => {}} onMore={onMore} optionalCount={9} {...props} />));
  }
  function tab(label: string) {
    const result = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === label);
    expect(result).toBeTruthy();
    return result!;
  }
  function panel() { return container.querySelector<HTMLElement>('[role="tabpanel"]')!; }
  async function click(element: HTMLElement | null | undefined) { expect(element).toBeTruthy(); await act(async () => element!.click()); }
  async function key(element: HTMLElement, value: string) { await act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }))); }
  function codes() { return [...container.querySelectorAll("[data-style-summary]")].map(item => item.getAttribute("data-style-summary")); }
  function editButtons() { return [...container.querySelectorAll("button")].filter(item => `${item.textContent} ${item.getAttribute("aria-label") ?? ""}`.includes("수정")); }

  it("다시 답하면 글자가 달라질 수 있다는 말은 함께 보기에서는 두 카드 위에 한 번, 한 사람 탭에서는 그 카드 안에 한 번 둔다", async () => {
    const change = "다시 답하면 글자가 달라질 수 있어요.";
    await render();
    expect(panel().textContent?.split(change).length).toBe(2);
    expect(panel().querySelector("[data-change-notice]")?.closest("[data-style-summary]")).toBeNull();
    for (const label of ["내 결과", "상대 결과"]) {
      await click(tab(label));
      expect(panel().textContent?.split(change).length, label).toBe(2);
      expect(panel().querySelector("[data-style-summary] [data-change-notice]"), label).not.toBeNull();
      expect(panel().textContent, label).not.toContain("스타일");
    }
  });

  it("함께 비교하다 내 전체 결과와 상대 전체 결과를 각각 열고 본인 답만 수정한다", async () => {
    await render();
    expect(codes()).toEqual(["KBBB", "RBBB"]);
    expect(panel().querySelector('[data-comparison="B1"]')).not.toBeNull();
    expect(panel().textContent).not.toContain("내가 그려본 결혼식");

    await click(tab("내 결과"));
    expect(codes()).toEqual(["RBBB"]);
    expect(panel().querySelector("[data-comparison]")).toBeNull();
    expect(panel().textContent).toContain("내가 그려본 결혼식");
    expect(panel().textContent).toContain("더 쓰고 싶은 곳은 지금 없어요.");
    expect(panel().textContent).toContain("문장별로 내가 고른 답 모두 보기");
    await click(panel().querySelector<HTMLButtonElement>('[data-statement-scale="B1"] button'));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith("B1");

    await click(tab("상대 결과"));
    expect(codes()).toEqual(["KBBB"]);
    expect(panel().textContent).toContain("상대의 결혼식 취향");
    expect(panel().textContent).toContain("상대의 문장별 답 모두 보기");
    expect(panel().textContent).toContain("상대의 답을 대신 수정할 수는 없어요.");
    expect(editButtons()).toHaveLength(0);
    expect(container.querySelector('[aria-label="선택 질문"]')).toBeNull();
    expect(panel().querySelector("textarea")).toBeNull();
    expect(onEdit).toHaveBeenCalledTimes(1);

    await click(tab("함께 보기"));
    expect(codes()).toEqual(["KBBB", "RBBB"]);
    expect(panel().querySelector('[data-comparison="B1"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });

  it("받은 링크는 본인을 추측하지 않고 두 개인 결과 모두 읽기 전용으로 보여준다", async () => {
    await render({ received: true });
    expect([...container.querySelectorAll('[role="tab"]')].map(item => item.textContent)).toEqual(["함께 보기", "먼저 답한 사람", "나중에 답한 사람"]);
    for (const [label, code] of [["먼저 답한 사람", "KBBB"], ["나중에 답한 사람", "RBBB"]]) {
      await click(tab(label));
      expect(codes()).toEqual([code]);
      expect(panel().textContent).toContain(`${label}의 결혼식 취향`);
      expect(panel().textContent).toContain("누가 본인인지는 확인하지 않으며");
      expect(editButtons()).toHaveLength(0);
      expect(container.querySelector('[aria-label="선택 질문"]')).toBeNull();
      expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    }
    expect(onEdit).not.toHaveBeenCalled();
    expect(onMore).not.toHaveBeenCalled();
  });

  it.each([false, true])("received=%s 탭은 방향키·Home·End로 이동하며 포커스와 패널 이름을 함께 바꾼다", async received => {
    await render({ received });
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    function selected(index: number) {
      expect(tabs.map(item => item.getAttribute("aria-selected"))).toEqual(tabs.map((_, position) => String(position === index)));
      expect(tabs.map(item => item.tabIndex)).toEqual(tabs.map((_, position) => position === index ? 0 : -1));
      expect(document.activeElement).toBe(tabs[index]);
      expect(panel().getAttribute("aria-labelledby")).toBe(tabs[index].id);
      for (const item of tabs) expect(item.getAttribute("aria-controls")).toBe(panel().id);
      expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
    }
    tabs[0].focus();
    await key(tabs[0], "ArrowRight"); selected(1);
    await key(tabs[1], "End"); selected(2);
    await key(tabs[2], "ArrowRight"); selected(0);
    await key(tabs[0], "ArrowLeft"); selected(2);
    await key(tabs[2], "Home"); selected(0);
    await key(tabs[0], "ArrowDown"); selected(0);
  });

  it("탭을 전환해도 직접 확인한 공유 동의와 두 사람 답의 순서를 유지한다", async () => {
    await render();
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await click(checkboxes[0]); await click(checkboxes[1]);
    const shared = () => container.querySelector<HTMLInputElement>('input[aria-label="답이 담긴 웨딩코드 공유 링크"]')?.value;
    const original = shared();
    expect(original).toBeTruthy();
    const params = new URLSearchParams(new URL(original!).hash.slice(1));
    expect(decodeV31(params.get("a"))).toEqual(first);
    expect(decodeV31(params.get("b"))).toEqual(draft);
    await click(tab("상대 결과"));
    await click(tab("내 결과"));
    expect(shared()).toBe(original);
    expect([...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(item => item.checked)).toBe(true);
  });

  it("본인이 확인된 읽기 전용 결과는 내·상대 구분을 유지하고 제공된 공유 영역만 사용한다", async () => {
    const onRestart = vi.fn();
    await render({ readOnly: true, onRestart, sharingContent: <section aria-label="연결한 두 사람의 공유 상태">두 사람만 볼 수 있는 공유 상태</section> });
    expect(tab("내 결과")).toBeTruthy();
    expect(tab("상대 결과")).toBeTruthy();
    expect(container.querySelector('[data-share-box="v31"]')).toBeNull();
    expect(container.querySelector('[aria-label="연결한 두 사람의 공유 상태"]')).not.toBeNull();
    expect(editButtons()).toHaveLength(0);
    expect(container.querySelector('[aria-label="선택 질문"]')).toBeNull();
    await click(tab("내 결과"));
    expect(codes()).toEqual(["RBBB"]);
    expect(panel().textContent).toContain("내가 공유한 답이에요. 이 화면에서는 답을 수정할 수 없어요.");
    expect(editButtons()).toHaveLength(0);
    await click(tab("상대 결과"));
    expect(codes()).toEqual(["KBBB"]);
    expect(editButtons()).toHaveLength(0);
    expect(onEdit).not.toHaveBeenCalled();
    await click([...container.querySelectorAll("button")].find(button => button.textContent === "내 웨딩코드로 돌아가기"));
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("처음부터 다시 답하기");
  });

  it("함께 보는 방법 버튼은 초대 해시와 내 결과를 유지하며 공유 영역으로 포커스와 화면만 이동한다", async () => {
    window.history.replaceState(null, "", "/wedding-code#room=invite-fixture&invite=keep-this-access");
    const originalHash = window.location.hash;
    const onRestart = vi.fn();
    await render({ first: null, onRestart, sharingContent: <section aria-label="함께 보기 안내">공유하기 전 확인하는 안내</section> });
    const sharing = container.querySelector('[aria-label="함께 보기 안내"]')!.parentElement!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(sharing, "scrollIntoView", { configurable: true, value: scrollIntoView });
    await click([...container.querySelectorAll("button")].find(button => button.textContent === "상대와 함께 보는 방법"));
    expect(document.activeElement).toBe(sharing);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(window.location.hash).toBe(originalHash);
    expect(codes()).toEqual(["RBBB"]);
    expect(onRestart).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("상대 결과 탭의 우선순위 안내 카드는 보는 사람을 ‘내가’로 부르지 않는다", async () => {
    // 상대가 장소 취향과 T2(T2·T3 둘 다 ‘그런 편’ 이상이라 조합 안내가 나온다)를 우선순위로 골랐다.
    first.priorities = { status: "answered", values: ["taste.venue", "T2"] };
    await render();
    await click(tab("상대 결과"));
    const text = panel().textContent ?? "";
    expect(panel().querySelector('[data-insight="priority-taste.venue"]')?.querySelector("h3")?.textContent).toBe("원하는 장소");
    expect(panel().querySelector('[data-insight="priority-delegate-update"]')).not.toBeNull();
    expect(text).toContain("이 설명에서 우선순위로 고른 것");
    expect(text).not.toContain("내가 원하는");
    expect(text).not.toContain("내가 우선순위");
  });

  it("혼자 본 결과는 탭 없이 전체 해석과 선택 메모를 그대로 보여준다", async () => {
    await render({ first: null });
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(codes()).toEqual(["RBBB"]);
    expect(container.textContent).toContain("내가 그려본 결혼식");
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(editButtons().length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-label="선택 질문"]')).not.toBeNull();
  });
});
