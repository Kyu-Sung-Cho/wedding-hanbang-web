// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V31_QUESTIONS, WEDDING_CODE_V31_TASTES, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { LOCAL_KEY, LOCAL_TTL_MS, readV31LocalProgress, writeV31LocalProgress, type V31LocalProgressSnapshot } from "@/lib/weddingCode/v31LocalProgress";
import WeddingCodeV31Client from "./WeddingCodeV31Client";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { V31_SAVE_PREFERENCE_KEY } from "./useV31LocalProgress";

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function completed(): V31Draft {
  const draft = createV31Draft();
  for (const question of WEDDING_CODE_V31_QUESTIONS) draft.answers[question.id] = 5;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "skipped" };
  draft.avoidances = { status: "no_preference" };
  draft.priorities = { status: "skipped" };
  draft.spending = { status: "no_preference" };
  return draft;
}
function snapshot(draft = createV31Draft(), fields: Partial<V31LocalProgressSnapshot> = {}): V31LocalProgressSnapshot {
  return { draft, index: 0, screen: "questions", editing: false, needsPriorityReview: false, ...fields };
}

describe("V31 same-browser resume", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); document.body.replaceChildren(); window.localStorage.clear(); });
  async function click(element: Element | null | undefined) {
    if (!(element instanceof HTMLElement)) throw new Error("클릭할 HTML 요소가 없어요.");
    await act(async () => element.click());
  }
  async function button(text: string) { await click([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === text)); }
  async function render(props: Partial<Parameters<typeof WeddingCodeV31Client>[0]> = {}) {
    await act(async () => root.render(<WeddingCodeV31Client shareOrigin="https://hanbang.ai" {...props} />));
  }
  async function remount(props: Partial<Parameters<typeof WeddingCodeV31Client>[0]> = {}) {
    await act(async () => root.unmount()); root = createRoot(container); await render(props);
  }
  function seed(value: V31LocalProgressSnapshot, now = Date.now()) {
    expect(writeV31LocalProgress(window.localStorage, value, null, now).status).toBe("saved");
  }

  it("saves a click immediately, keeps the exact next question and resumes only after an explicit choice", async () => {
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    let stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.answers.V1).toBe(5);
    await button("다음 질문");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await remount();
    expect(container.textContent).toContain("2번째 질문부터 이어 할 수 있어요");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("이어서 답하기");
    expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe("G1");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await click(container.querySelector('button[aria-label="이전 질문"]'));
    expect(container.querySelector<HTMLInputElement>('input[value="5"]')?.checked).toBe(true);
    stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.index).toBe(0);
  });

  it("restores only the user's saved result, with fresh sharing consent and no memo persistence", async () => {
    seed(snapshot(completed(), { screen: "result", index: 33 }));
    await render(); await button("내 결과 다시 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    await click(container.querySelector('input[type="checkbox"]'));
    expect(container.querySelector('input[aria-label="답이 담긴 웨딩코드 공유 링크"]')).not.toBeNull();
    await remount(); await button("내 결과 다시 보기");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
    expect(container.querySelector('input[aria-label="답이 담긴 웨딩코드 공유 링크"]')).toBeNull();
    expect(Object.keys(JSON.parse(window.localStorage.getItem(LOCAL_KEY)!))).toEqual([
      "schema", "version", "savedAt", "answerCode", "index", "screen", "editing", "needsPriorityReview",
    ]);
  });

  it("does not read or write a personal saved answer while hydrating a received couple link", async () => {
    const own = completed(); own.answers.V1 = 2;
    seed(snapshot(own, { screen: "result" }));
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const first = completed(); const second = completed(); second.answers.V1 = 1;
    window.history.replaceState(null, "", `#v=v3.1-preferences&a=${encodeV31(first)}&b=${encodeV31(second)}`);
    const get = vi.spyOn(Storage.prototype, "getItem"); const set = vi.spyOn(Storage.prototype, "setItem");
    await act(async () => root.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    expect(container.querySelector('[data-result="couple-v31"]')).not.toBeNull();
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    expect(get.mock.calls.filter(([key]) => key === LOCAL_KEY || key === V31_SAVE_PREFERENCE_KEY)).toEqual([]);
    expect(set.mock.calls.filter(([key]) => key === LOCAL_KEY)).toEqual([]);
    get.mockRestore(); set.mockRestore();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it("an invitation reuses the saved own answer only on request and never persists the partner", async () => {
    const own = createV31Draft(); own.answers.V1 = 2;
    seed(snapshot(own));
    const partner = completed(); partner.answers.V1 = 1;
    await render({ partnerDraft: partner });
    await button("이어서 답하기");
    expect(container.querySelector<HTMLInputElement>('input[value="2"]')?.checked).toBe(true);
    await click(container.querySelector('input[value="4"]'));
    const stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.answers).toEqual({ V1: 4 });
    expect(window.localStorage.getItem(LOCAL_KEY)).not.toContain(encodeV31(partner));
    await remount(); await button("이어서 답하기");
    expect(container.textContent).not.toContain("상대의 답이 담긴");
  });

  it("switching saving off clears only this draft, remembers off and allows unsaved continuation", async () => {
    window.localStorage.setItem("unrelated", "keep");
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    await button("자동 저장 끄기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
    expect(window.localStorage.getItem(V31_SAVE_PREFERENCE_KEY)).toBe("off");
    await button("다음 질문"); await click(container.querySelector('input[value="4"]'));
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    await remount(); expect(container.textContent).toContain("자동 저장을 껐어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
  });

  it("deletion resets the current flow without resurrecting the removed answer", async () => {
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    await button("이 브라우저의 답 지우기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(container.querySelector("[data-question]")).toBeNull();
    await remount(); expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
  });

  it("another tab's deletion pauses saving even when the current screen changes", async () => {
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    window.localStorage.removeItem(LOCAL_KEY);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_KEY, newValue: null })));
    await click(container.querySelector('input[value="2"]'));
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(container.textContent).toContain("자동 저장을 멈췄어요");
    await button("저장된 답 불러오기");
    await click(container.querySelector('input[value="4"]'));
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(container.textContent).toContain("자동 저장을 멈췄어요");
    await button("이 화면의 답으로 저장하기");
    const stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.answers.V1).toBe(4);
  });

  it("restored changes from another tab remain protected from later external deletion", async () => {
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    const updated = createV31Draft(); updated.answers.V1 = 2;
    writeV31LocalProgress(window.localStorage, snapshot(updated), window.localStorage.getItem(LOCAL_KEY));
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_KEY })));
    await button("저장된 답 불러오기");
    expect(container.querySelector<HTMLInputElement>('input[value="2"]')?.checked).toBe(true);
    window.localStorage.removeItem(LOCAL_KEY);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: LOCAL_KEY, newValue: null })));
    await click(container.querySelector('input[value="4"]'));
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(container.textContent).toContain("자동 저장을 멈췄어요");
  });

  it("storage denial never blocks answering or claims that an answer was saved", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked", "QuotaExceededError"); });
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]')); await button("다음 질문");
    expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe("G1");
    expect(container.textContent).toContain("이 브라우저에 저장할 수 없어요");
    expect(container.textContent).not.toContain("이 브라우저에 저장됐어요");
  });

  it("rechecks expiry when resume is clicked after leaving the intro open", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const draft = createV31Draft(); draft.answers.V1 = 5;
    seed(snapshot(draft), now - LOCAL_TTL_MS + 1_000);
    await render();
    expect(container.textContent).toContain("이 브라우저에 남겨 둔 답");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    clock.mockReturnValue(now + 1_001);
    await button("이어서 답하기");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(container.textContent).toContain("저장된 답의 이어하기 기간이 지났어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it.each(["off", "deleted"])("does not restore cached answers when %s is discovered at the resume click", async kind => {
    const draft = createV31Draft(); draft.answers.V1 = 5;
    seed(snapshot(draft)); await render();
    if (kind === "off") window.localStorage.setItem(V31_SAVE_PREFERENCE_KEY, "off");
    else window.localStorage.removeItem(LOCAL_KEY);
    await button("이어서 답하기");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
  });

  it("can restart in memory when access to browser storage is denied", async () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    await button("이 브라우저의 답 지우기");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(container.textContent).toContain("현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    await button("내 웨딩코드 시작하기");
    expect(container.querySelector<HTMLInputElement>('input[value="5"]')?.checked).toBe(false);
  });

  it("clears the in-memory resume cache when deleting the stored record fails", async () => {
    const draft = createV31Draft(); draft.answers.V1 = 5;
    seed(snapshot(draft)); await render(); await button("이어서 답하기");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await button("이 브라우저의 답 지우기");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(container.textContent).toContain("현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it("keeps the deletion failure notice across an invitation entry reset and still allows fresh answers", async () => {
    const own = createV31Draft(); own.answers.V1 = 2;
    seed(snapshot(own));
    window.history.replaceState(null, "", `#v=v3.1-preferences&a=${encodeV31(completed())}`);
    await act(async () => root.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    await button("이어서 답하기");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await button("이 브라우저의 답 지우기");
    expect(window.location.hash).toBe("");
    expect(container.textContent).toContain("현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요");
    // 새 Entry는 디스크에 실제 남은 답을 다시 읽는다. 삭제 성공으로 표시하지 않는다.
    expect(container.textContent).toContain("이 브라우저에 남겨 둔 답");
    expect(container.textContent).not.toContain("상대의 답이 담긴 링크를 받았어요");
    await act(async () => {
      root.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />);
      window.dispatchEvent(new Event("popstate"));
    });
    expect(container.textContent).not.toContain("상대의 답이 담긴 링크를 받았어요");
    await button("저장된 답 지우고 새로 시작");
    expect(container.querySelector<HTMLInputElement>('input[value="2"]')?.checked).toBe(false);
  });

  it("hides the unused next button on an unanswered priority step and restores it after a choice", async () => {
    const draft = completed(); draft.priorities = undefined;
    seed(snapshot(draft, { index: 32 }));
    await render(); await button("이어서 답하기");
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "다음 질문")).toBe(false);
    await button("우선순위도 골라볼게요 (선택)");
    await click(container.querySelector('[data-choice="V1"]'));
    const next = [...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "다음 질문");
    expect(next?.disabled).toBe(false);
    await click(next);
    expect(container.querySelector('[data-question="spending"]')).not.toBeNull();
  });

  it.each(["broken", "expired"])("does not restore %s local data", async kind => {
    if (kind === "broken") window.localStorage.setItem(LOCAL_KEY, '{"schema":1,"answerCode":"bad"}');
    else seed(snapshot(), Date.now() - LOCAL_TTL_MS - 1);
    await render(); expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    expect(readV31LocalProgress(window.localStorage).status).toBe("ready");
  });

  it("restoring an edit still requires priority review before showing the new result", async () => {
    const draft = completed(); draft.priorities = undefined;
    seed(snapshot(draft, { editing: true, needsPriorityReview: true }));
    await render(); await button("이어서 답하기"); await button("수정한 결과 보기");
    expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe("priorities");
    expect(container.querySelector('[data-result="solo-v31"]')).toBeNull();
    await remount(); await button("이어서 답하기");
    expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe("priorities");
    await button("지금은 넘어갈게요"); await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
  });
});
