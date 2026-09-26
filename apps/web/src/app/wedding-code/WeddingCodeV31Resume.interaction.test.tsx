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
import { V31_CORE_INDEXES, V31_CORE_RATING_IDS, getV31IndexForId } from "@/lib/weddingCode/v31Flow";
import { PAIR_SESSION_LOCAL_KEY, readPairSessionRecovery, savePairSessionLink } from "@/lib/weddingCode/pairSessionClient";

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
  return { draft, index: 0, flow: "full", screen: "questions", editing: false, needsPriorityReview: false, ...fields };
}
function coreCompleted(): V31Draft {
  const draft = createV31Draft();
  for (const id of V31_CORE_RATING_IDS) draft.answers[id] = 4;
  for (const taste of WEDDING_CODE_V31_TASTES) draft.tastes[taste.key] = { status: "no_preference" };
  draft.avoidances = { status: "no_preference" }; draft.spending = { status: "no_preference" };
  return draft;
}

describe("V31 same-browser resume", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/wedding-code");
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); document.body.replaceChildren(); window.localStorage.clear(); window.sessionStorage.clear(); });
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
  function seedPairSession() {
    const saved = { roomId: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64), mode: "member" as const, expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    expect(savePairSessionLink(saved)).toBe(true);
    return saved;
  }

  it("saves every click immediately, resumes the next page only after an explicit choice and goes back to the complete previous page", async () => {
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    let stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.answers.G1).toBe(5);
    await click(container.querySelector('[data-question="G3"] input[value="4"]'));
    await click(container.querySelector('[data-question="R4"] input[value="skipped"]'));
    await button("다음 질문");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await remount();
    // 질문 화면의 진행 표기와 같은 단위(페이지)로 알린다.
    expect(container.textContent).toContain("기본 질문 2 / 14 페이지부터 이어 할 수 있어요");
    expect(container.querySelector("[data-question]")).toBeNull();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("이어서 답하기");
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["B1", "B3", "D1"]);
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await click(container.querySelector('button[aria-label="이전 질문"]'));
    expect(container.querySelector<HTMLInputElement>('input[value="5"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-question="G3"] input[value="4"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-question="R4"] input[value="skipped"]')?.checked).toBe(true);
    stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.index).toBe(getV31IndexForId("G1"));
    expect(stored.status === "ready" && stored.snapshot.flow).toBe("core");
  });

  it("restores a saved middle-of-page canonical index without rewriting it or hiding earlier answers", async () => {
    const draft = createV31Draft(); draft.answers.G1 = 2;
    seed(snapshot(draft, { flow: "core", index: getV31IndexForId("G3") }));
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await render(); await button("이어서 답하기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["G1", "G3", "R4"]);
    expect(container.querySelector<HTMLInputElement>('[data-question="G1"] input[value="2"]')?.checked).toBe(true);
    await click(container.querySelector('[data-question="G3"] input[value="undecided"]'));
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.index).toBe(getV31IndexForId("G3"));
    expect(saved.status === "ready" && saved.snapshot.draft.answers).toEqual({ G1: 2, G3: "undecided" });
    await button("다음 질문");
    expect(container.querySelector('[data-question="G1"]')).not.toBeNull();
    await click(container.querySelector('[data-question="R4"] input[value="skipped"]'));
    await button("다음 질문");
    expect(container.querySelector('[data-question="B1"]')).not.toBeNull();
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
    expect(Object.keys(JSON.parse(window.localStorage.getItem(LOCAL_KEY)!)).sort()).toEqual([
      "schema", "version", "savedAt", "answerCode", "index", "flow", "screen", "editing", "needsPriorityReview",
    ].sort());
  });

  it("a completed core result resumes without requiring unanswered extras and keeps the optional ordinal on reload", async () => {
    const own = coreCompleted();
    seed(snapshot(own, { flow: "core", index: V31_CORE_INDEXES[V31_CORE_INDEXES.length - 1], screen: "result" }));
    await render(); await button("내 결과 다시 보기");
    expect(container.textContent).toContain("답을 남긴 질문은 23개예요");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    await button("원하면 더 알아보기 (선택)");
    await click(container.querySelector('[data-question="V1"] input[value="5"]'));
    expect(container.querySelector('[data-question="G2"]')).not.toBeNull();
    // 이전 한 문항 화면에서 저장한 선택 질문 2번도 같은 페이지 전체로 복원한다.
    const partial = readV31LocalProgress(window.localStorage);
    expect(partial.status).toBe("ready");
    if (partial.status !== "ready") throw new Error("답이 저장되지 않았어요.");
    expect(writeV31LocalProgress(window.localStorage, { ...partial.snapshot, index: getV31IndexForId("G2") }, window.localStorage.getItem(LOCAL_KEY)).status).toBe("saved");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await remount();
    expect(container.textContent).toContain("선택 질문 1 / 3 페이지부터 이어 할 수 있어요");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("이어서 답하기");
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["V1", "G2", "R3"]);
    expect(container.querySelector<HTMLInputElement>('[data-question="V1"] input[value="5"]')?.checked).toBe(true);
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("여기까지 보고 결과 보기");
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status).toBe("ready");
    if (saved.status !== "ready") return;
    expect(saved.snapshot.flow).toBe("extra");
    expect(saved.snapshot.draft.answers.V1).toBe(5);
    expect(saved.snapshot.draft.answers.G2).toBeUndefined();
    expect(saved.snapshot.draft.answers.B2).toBeUndefined();
    expect(saved.snapshot.draft.answers.D2).toBeUndefined();
    expect(saved.snapshot.draft.priorities).toBeUndefined();
    expect(saved.snapshot.screen).toBe("result");
  });

  it("schema 1 saved progress retains its original full order and is not rewritten by restoration", async () => {
    const draft = createV31Draft(); draft.answers.V1 = 4; draft.answers.G1 = 5;
    const raw = JSON.stringify({ schema: 1, version: draft.version, savedAt: Date.now(), answerCode: encodeV31(draft), index: 2, screen: "questions", editing: false, needsPriorityReview: false });
    window.localStorage.setItem(LOCAL_KEY, raw);
    await render();
    expect(container.textContent).toContain("이전 전체 질문 3 / 34부터 이어 할 수 있어요");
    await button("이어서 답하기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    expect(container.querySelector('[data-question="G2"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-question]")).toHaveLength(1);
    expect(container.textContent).toContain("이전 전체 질문 3 / 34");
    await click(container.querySelector('input[value="3"]')); await button("다음 질문");
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.flow).toBe("full");
    expect(saved.status === "ready" && saved.snapshot.draft.answers.G2).toBe(3);
    expect(JSON.parse(window.localStorage.getItem(LOCAL_KEY)!).schema).toBe(2);
    expect(container.querySelector('[data-question="G3"]')).not.toBeNull();
  });

  it("editing a saved answer outside the current flow changes only that answer and never forces all 34 questions", async () => {
    const own = coreCompleted(); own.answers.R3 = 5;
    seed(snapshot(own, { flow: "core", index: getV31IndexForId("spending"), screen: "result" }));
    await render(); await button("내 결과 다시 보기");
    const statement = WEDDING_CODE_V31_QUESTIONS.find(item => item.id === "R3")!.statement;
    await click(container.querySelector(`[aria-label="${statement} 답 수정"]`));
    expect(container.querySelector('[data-question="R3"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-question]")).toHaveLength(1);
    expect(container.textContent).not.toContain("이 주제는 계획에 없어요");
    await click(container.querySelector('input[value="not_applicable"]'));
    await remount(); await button("이어서 답하기");
    expect(container.querySelector('[data-question="R3"]')).not.toBeNull();
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status).toBe("ready");
    if (saved.status !== "ready") return;
    expect(saved.snapshot.draft.answers.R3).toBe("not_applicable");
    expect(saved.snapshot.draft.answers.R4).toBe(4);
    expect(saved.snapshot.draft.answers.V1).toBeUndefined();
    expect(saved.snapshot.draft.answers.B2).toBeUndefined();
    expect(saved.snapshot.draft.priorities).toBeUndefined();
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
    await click(container.querySelector('[data-question="G3"] input[value="4"]'));
    await click(container.querySelector('[data-question="R4"] input[value="4"]'));
    await button("다음 질문"); await click(container.querySelector('[data-question="B1"] input[value="4"]'));
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    await remount(); expect(container.textContent).toContain("자동 저장을 껐어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
  });

  it("switching saving off removes the persistent comparison address without ending the server connection or reviving it when saving is enabled", async () => {
    const pair = seedPairSession();
    const fetch = vi.spyOn(globalThis, "fetch");
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    expect(container.textContent).toContain("기기 저장을 꺼도 서버 함께 보기 연결은 남아요. 종료는 연결 결과에서 해주세요.");
    await button("자동 저장 끄기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(readPairSessionRecovery(pair.roomId)).toEqual(pair);
    expect(fetch).not.toHaveBeenCalled();
    await button("자동 저장 켜기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(readPairSessionRecovery(pair.roomId)).toEqual(pair);
  });

  it("reports a storage failure when the persistent comparison address could not be removed", async () => {
    seedPairSession();
    await render(); await button("내 웨딩코드 시작하기");
    await click(container.querySelector('input[value="5"]'));
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (this === window.localStorage && key === PAIR_SESSION_LOCAL_KEY) throw new DOMException("blocked", "SecurityError");
      remove.call(this, key);
    });
    await button("자동 저장 끄기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).not.toBeNull();
    expect(container.textContent).toContain("저장 설정을 바꾸지 못했어요");
    expect(container.textContent).not.toContain("자동 저장을 껐어요. 나가면 지금 답은 사라져요.");
  });

  it("deletion resets the current flow without resurrecting the removed answer", async () => {
    seedPairSession();
    const pair = window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY);
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    // 답 지우기는 확인 주소를 남긴다(처리방침과 같은 동작). 그 사실과 지우는 방법을 버튼 바로 옆에 적는다.
    const note = container.querySelector("[data-pair-address-note]");
    expect(note?.textContent).toContain("‘이 브라우저의 답 지우기’를 눌러도 함께 보기 확인 주소는 남아요");
    expect(note?.textContent).toContain("주소까지 지우려면 ‘자동 저장 끄기’를 눌러 주세요");
    expect([...note!.previousElementSibling!.querySelectorAll("button")].map(item => item.textContent?.trim())).toEqual(["자동 저장 끄기", "이 브라우저의 답 지우기"]);
    await button("이 브라우저의 답 지우기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBe(pair);
    expect(container.querySelector("[data-question]")).toBeNull();
    await remount(); expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
  });

  it("names the comparison address only while it is saved, and the removal it describes actually removes it", async () => {
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    expect(container.querySelector("[data-pair-address-note]")).toBeNull();
    await act(async () => { seedPairSession(); });
    expect(container.querySelector("[data-pair-address-note]")).not.toBeNull();
    await button("자동 저장 끄기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(container.querySelector("[data-pair-address-note]")).toBeNull();
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
    expect(stored.status === "ready" && stored.snapshot.draft.answers.G1).toBe(4);
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
    await render(); await button("내 웨딩코드 시작하기");
    for (const id of ["G1", "G3", "R4"]) await click(container.querySelector(`[data-question="${id}"] input[value="5"]`));
    await button("다음 질문");
    expect(container.querySelector("[data-question]")?.getAttribute("data-question")).toBe("B1");
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

  it("keeps the next button visible but disabled on an unanswered priority step and enables it after a choice", async () => {
    const draft = completed(); draft.priorities = undefined;
    seed(snapshot(draft, { index: 32 }));
    await render(); await button("이어서 답하기");
    const next = () => [...container.querySelectorAll<HTMLButtonElement>("[data-question-actions] button")].find(item => item.textContent?.trim() === "다음 질문");
    expect(next()?.disabled).toBe(true);
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "우선순위도 골라볼게요 (선택)")).toBe(false);
    await click(container.querySelector('[data-choice="V1"]'));
    expect(next()?.disabled).toBe(false);
    await click(next());
    expect(container.querySelector('[data-question="spending"]')).not.toBeNull();
  });

  it("resumes a place saved when the optional flow still asked the priority question as a one-question edit", async () => {
    const draft = coreCompleted();
    const raw = JSON.stringify({ schema: 2, version: draft.version, savedAt: Date.now(), answerCode: encodeV31(draft), flow: "extra", index: 32, screen: "questions", editing: false, needsPriorityReview: false });
    window.localStorage.setItem(LOCAL_KEY, raw);
    await render();
    expect(container.textContent).toContain("수정하던 질문부터 이어 할 수 있어요");
    await button("이어서 답하기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    await button("지금은 고르지 않을게요");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.priorities).toEqual({ status: "skipped" });
    expect(saved.status === "ready" && saved.snapshot.screen).toBe("result");
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
    await button("지금은 고르지 않을게요"); await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
  });
});
