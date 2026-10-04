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
import { V31_CORE_INDEXES, V31_CORE_RATING_IDS, V31_EXTRA_INDEXES, getV31IndexForId } from "@/lib/weddingCode/v31Flow";
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
  /** 지우기 확인 창(문서 맨 끝에 그려지므로 container 밖이다)의 단추. */
  async function dialogButton(text: string) { await click([...document.querySelectorAll('[role="alertdialog"] button')].find(item => item.textContent?.trim() === text)); }
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
    // 질문 화면의 진행 표기와 같은 단위(페이지)로 알리되, 문장 안에서는 분수 표기 대신 풀어서 쓴다.
    expect(container.textContent).toContain("기본 질문 14페이지 중 2페이지부터 이어 할 수 있어요");
    expect(container.textContent).not.toMatch(/\d+ \/ \d+ 페이지부터/);
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
    // 이전 한 문항 화면에서 저장한 추가 질문 2번도 같은 페이지 전체로 복원한다.
    const partial = readV31LocalProgress(window.localStorage);
    expect(partial.status).toBe("ready");
    if (partial.status !== "ready") throw new Error("답이 저장되지 않았어요.");
    expect(writeV31LocalProgress(window.localStorage, { ...partial.snapshot, index: getV31IndexForId("G2") }, window.localStorage.getItem(LOCAL_KEY)).status).toBe("saved");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await remount();
    expect(container.textContent).toContain("추가 질문 3페이지 중 1페이지부터 이어 할 수 있어요");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("이어서 답하기");
    expect([...container.querySelectorAll("[data-question]")].map(item => item.getAttribute("data-question"))).toEqual(["V1", "G2", "R3"]);
    expect(container.querySelector<HTMLInputElement>('[data-question="V1"] input[value="5"]')?.checked).toBe(true);
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    await button("여기까지만 답하고 결과 보기");
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
    expect(container.textContent).toContain("예전 전체 질문 34개 중 3번째부터 이어 할 수 있어요");
    await button("이어서 답하기");
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
    expect(container.querySelector('[data-question="G2"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-question]")).toHaveLength(1);
    expect(container.textContent).toContain("예전 전체 질문 3 / 34");
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
    expect(container.textContent).not.toContain("이 주제는 해당하지 않아요");
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
    // 끄면 저장된 답이 지워지므로 확인 창을 한 번 거친다. 그대로 두면 아무것도 바뀌지 않는다.
    await button("자동 저장 끄기");
    expect(document.querySelector('[role="alertdialog"] h2')?.textContent).toBe("자동 저장을 끌까요?");
    expect(document.querySelector('[role="alertdialog"] p')?.textContent).toBe("꺼 두면 지금 저장된 답이 지워지고 이후에는 저장되지 않아요.");
    expect(window.localStorage.getItem(LOCAL_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(V31_SAVE_PREFERENCE_KEY)).toBeNull();
    await dialogButton("그대로 두기");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(window.localStorage.getItem(LOCAL_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(V31_SAVE_PREFERENCE_KEY)).toBeNull();
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("자동 저장 끄기");
    await button("자동 저장 끄기"); await dialogButton("끄고 지우기");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
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
    expect(container.textContent).toContain("자동 저장을 꺼도 서버에 있는 함께 보기 연결은 그대로 남아요. 끝내려면 끄기 전에 두 사람 결과 화면에서 ‘연결 끝내기’를 눌러 주세요. 이미 껐다면 따로 복사해 둔 ‘나만 보관할 확인 주소’로 열어 끝낼 수 있어요.");
    await button("자동 저장 끄기");
    // 확인 주소도 함께 지워지므로 확인 창이 그 사실과 서버 연결이 남는다는 것을 미리 말한다.
    expect(document.querySelector('[role="alertdialog"] p')?.textContent).toBe("꺼 두면 지금 저장된 답과 함께 보기 확인 주소가 지워지고 이후에는 저장되지 않아요. 서버의 함께 보기 연결은 그대로 남으니, 끝내려면 먼저 ‘연결 끝내기’를 눌러 주세요.");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).not.toBeNull();
    await dialogButton("끄고 지우기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).toBeNull();
    expect(window.localStorage.getItem(LOCAL_KEY)).toBeNull();
    expect(readPairSessionRecovery(pair.roomId)).toEqual(pair);
    // 끄기가 지우지 않는 탭 사본은 같은 이름(확인 주소)으로, 이 탭에 잠시 남는다고 적는다.
    expect(container.querySelector("[data-pair-tab-address-note]")?.textContent).toBe("함께 보기가 잘 연결됐는지 다시 볼 수 있도록, 확인 주소를 이 탭에 잠시 남겨 둬요.");
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
    await button("자동 저장 끄기"); await dialogButton("끄고 지우기");
    expect(window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY)).not.toBeNull();
    expect(container.textContent).toContain("저장 설정을 바꾸지 못했어요");
    expect(container.textContent).not.toContain("자동 저장을 껐어요. 나가면 지금 답은 사라져요.");
  });

  it("deletion resets the current flow without resurrecting the removed answer", async () => {
    seedPairSession();
    const pair = window.localStorage.getItem(PAIR_SESSION_LOCAL_KEY);
    await render(); await button("내 웨딩코드 시작하기"); await click(container.querySelector('input[value="5"]'));
    // 답 지우기는 확인 주소를 남긴다(처리방침과 같은 동작). 그 사실과 지우는 방법을 버튼 바로 옆에 적는다.
    // 처리방침과 같은 이름(확인 주소)으로 부르고, 끄기가 지우는 것은 이 브라우저에 저장된 사본이라고 범위를 좁힌다.
    const note = container.querySelector("[data-pair-address-note]");
    expect(note?.textContent).toBe("‘이 브라우저의 답 지우기’는 답만 지워요. 이 브라우저에 저장된 함께 보기 확인 주소까지 지우려면 ‘자동 저장 끄기’를 눌러 주세요.");
    expect(container.textContent).not.toContain("함께 보기 요청의 처리 여부를 확인할 주소");
    expect([...note!.previousElementSibling!.querySelectorAll("button")].map(item => item.textContent?.trim())).toEqual(["자동 저장 끄기", "이 브라우저의 답 지우기"]);
    await button("이 브라우저의 답 지우기"); await dialogButton("지우고 다시 답하기");
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
    await button("자동 저장 끄기"); await dialogButton("끄고 지우기");
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

  it("저장 시각이 하루를 넘는 미래라 읽지 못하면 폰 날짜와 시간을 확인하라고 알리고, 다른 이유로 못 읽을 때는 말하지 않는다", async () => {
    const status = () => container.querySelector('aside[aria-label="이 브라우저의 답 저장"] [role="status"]')?.textContent?.trim();
    const draft = createV31Draft(); draft.answers.V1 = 5;
    seed(snapshot(draft), Date.now() + 2 * 86_400_000);
    await render();
    expect(status()).toBe("저장된 답을 읽을 수 없어요. 새로 답하면 다시 저장해요. 폰 날짜와 시간이 맞는지 확인해 보세요.");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    await act(async () => root.unmount()); root = createRoot(container);
    window.localStorage.setItem(LOCAL_KEY, "{깨진 값");
    await render();
    expect(status()).toBe("저장된 답을 읽을 수 없어요. 새로 답하면 다시 저장해요.");
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
    await button("이 브라우저의 답 지우기"); await dialogButton("지우고 다시 답하기");
    expect(container.querySelector("[data-question]")).toBeNull();
    // 저장소가 처음부터 막힌 브라우저에는 저장된 답이 없으므로 「지우지 못했어요」라고 말하지 않는다(저장 줄은 「저장할 수 없어요」).
    expect(container.querySelector("[data-screen-notice]")).toBeNull();
    expect(container.textContent).not.toContain("지우지 못했어요");
    expect(container.textContent).toContain("이 브라우저에 저장할 수 없어요");
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    await button("내 웨딩코드 시작하기");
    expect(container.querySelector<HTMLInputElement>('input[value="5"]')?.checked).toBe(false);
  });

  it("clears the in-memory resume cache when deleting the stored record fails", async () => {
    const draft = createV31Draft(); draft.answers.V1 = 5;
    seed(snapshot(draft)); await render(); await button("이어서 답하기");
    const raw = window.localStorage.getItem(LOCAL_KEY);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await button("이 브라우저의 답 지우기"); await dialogButton("지우고 다시 답하기");
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
    await button("이 브라우저의 답 지우기"); await dialogButton("지우고 다시 답하기");
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
    await button("저장된 답 지우고 새로 시작"); await dialogButton("지우고 새로 시작");
    expect(container.querySelector<HTMLInputElement>('input[value="2"]')?.checked).toBe(false);
  });

  it("on an unanswered priority step of the old full flow the fixed button skips to the next question, and moves on normally after a choice", async () => {
    const draft = completed(); draft.priorities = undefined;
    seed(snapshot(draft, { index: 32 }));
    await render(); await button("이어서 답하기");
    const action = () => container.querySelector<HTMLButtonElement>("[data-question-actions] button");
    // 이전 전체 흐름은 우선순위 뒤에 더 쓰고 싶은 곳을 묻는다. 비어 있으면 고정 버튼이 넘어가기를 맡는다.
    expect(action()?.textContent?.trim()).toBe("고르지 않고 다음 질문");
    expect(action()?.disabled).toBe(false);
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "우선순위도 골라볼게요 (선택)")).toBe(false);
    await click(container.querySelector('[data-choice="V1"]'));
    expect(action()?.textContent?.trim()).toBe("다음 질문");
    await click(action());
    expect(container.querySelector('[data-question="spending"]')).not.toBeNull();
    let stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.priorities).toEqual({ status: "answered", values: ["V1"] });
    await click(container.querySelector('button[aria-label="이전 질문"]'));
    await click(container.querySelector('[data-choice="V1"]'));
    await click(action());
    expect(container.querySelector('[data-question="spending"]')).not.toBeNull();
    stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.draft.priorities).toEqual({ status: "skipped" });
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
    await button("고르지 않고 결과 보기");
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
    // 앞의 답이 바뀌어 우선순위를 다시 보는 수정 화면에서도 넘어가기가 남는다(고정 버튼이 맡는다).
    await button("고르지 않고 다음 질문"); await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.priorities).toEqual({ status: "skipped" });
  });

  it("a saved result from the old core flow, which never asked the priority question, can still choose priorities from the result", async () => {
    const own = coreCompleted();
    seed(snapshot(own, { flow: "core", index: V31_CORE_INDEXES[V31_CORE_INDEXES.length - 1], screen: "result" }));
    await render(); await button("내 결과 다시 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    // 예전 기본 흐름은 우선순위를 묻지 않았고, 추가 질문은 이제 우선순위를 묻지 않는다. 결과에서 고를 길이 있어야 한다.
    const entry = container.querySelector("[data-priority-entry]");
    expect(entry).not.toBeNull();
    await click([...entry!.querySelectorAll("button")].find(item => item.textContent?.trim() === "꼭 지키고 싶은 것 고르기"));
    expect(container.querySelector('[data-question="priorities"]')).not.toBeNull();
    expect(container.querySelector('[data-question="priorities"] [data-choice="G1"]')).not.toBeNull();
    await click(container.querySelector('[data-choice="G1"]'));
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect(container.querySelector("[data-priority-entry]")).toBeNull();
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "꼭 지키고 싶은 것 수정")).toBe(true);
    const saved = readV31LocalProgress(window.localStorage);
    expect(saved.status === "ready" && saved.snapshot.draft.priorities).toEqual({ status: "answered", values: ["G1"] });
    // 같은 길로 들어가 고르지 않고 나와도 결과로 돌아오고, 그다음부터는 ‘꼭 지키고 싶은 것 수정’이 그 일을 한다.
    await act(async () => root.unmount()); window.localStorage.clear(); root = createRoot(container);
    seed(snapshot(own, { flow: "core", index: V31_CORE_INDEXES[V31_CORE_INDEXES.length - 1], screen: "result" }));
    await render(); await button("내 결과 다시 보기");
    await click([...container.querySelectorAll("button")].find(item => item.textContent?.trim() === "꼭 지키고 싶은 것 고르기"));
    await button("고르지 않고 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    expect([...container.querySelectorAll("button")].some(item => item.textContent?.trim() === "꼭 지키고 싶은 것 수정")).toBe(true);
  });

  it("after skipping an empty priority step, choosing a taste later offers the priority question from the result", async () => {
    const own = createV31Draft();
    for (const id of V31_CORE_RATING_IDS) own.answers[id] = 2;
    for (const taste of WEDDING_CODE_V31_TASTES) own.tastes[taste.key] = { status: "undecided" };
    own.avoidances = { status: "undecided" }; own.spending = { status: "no_preference" };
    seed(snapshot(own, { flow: "core", index: V31_CORE_INDEXES[V31_CORE_INDEXES.length - 1], screen: "result" }));
    await render(); await button("내 결과 다시 보기");
    // 고를 보기가 없으면 버튼을 두지 않는다.
    expect(container.querySelector("[data-priority-entry]")).toBeNull();
    await click(container.querySelector('[aria-label="장소 취향 수정"]'));
    await click(container.querySelector('[data-choice="indoor"]'));
    await button("수정한 결과 보기");
    expect(container.querySelector('[data-result="solo-v31"]')).not.toBeNull();
    const entry = container.querySelector("[data-priority-entry]");
    expect(entry).not.toBeNull();
    await click([...entry!.querySelectorAll("button")].find(item => item.textContent?.trim() === "꼭 지키고 싶은 것 고르기"));
    expect([...container.querySelectorAll('[data-question="priorities"] [data-choice]')].map(item => item.getAttribute("data-choice"))).toEqual(["taste.venue"]);
  });

  /**
   * 시작 버튼은 답 없이 위치만 저장한다(자동 저장이 시작할 때부터 켜진다). 그 기록을 「남겨 둔 답」이라 부르면 거짓이다.
   * 아래 테스트는 저장 시점은 그대로 두고, 이어 하기 카드·큰 버튼·저장 줄이 답이 있을 때만 이어 하기를 말하는지 본다.
   */
  const RESUME_TITLE = "이 브라우저에 남겨 둔 답이 있어요";
  const NO_ANSWER_LINE = "답하면 이 브라우저에 자동으로 저장돼요. 다른 사람과 같이 쓰는 컴퓨터나 휴대폰이라면 아래 ‘자동 저장 설정’에서 꺼 주세요.";
  const SAVED_LINE = "이 브라우저에 저장됐어요. 나중에 이어 할 수 있어요.";
  const card = () => container.querySelector('[aria-label="저장된 내 답 이어하기"]');
  const buttonLabels = () => [...container.querySelectorAll("button")].map(item => item.textContent?.trim());
  const storageLine = () => container.querySelector('aside[aria-label="이 브라우저의 답 저장"] [role="status"]')?.textContent;

  it("시작만 누르고 나간 사람에게는 남겨 둔 답이 없으니 이어 하기 카드와 지우기 버튼을 띄우지 않는다", async () => {
    await render(); await button("내 웨딩코드 시작하기");
    const stored = readV31LocalProgress(window.localStorage);
    expect(stored.status).toBe("ready");
    if (stored.status !== "ready") return;
    // 저장 시점은 그대로다. 시작 버튼은 위치만 저장하고 그 기록에는 답이 한 칸도 없다.
    expect(stored.snapshot.draft.answers).toEqual({});
    expect(stored.snapshot.draft.tastes).toEqual({});
    expect([stored.snapshot.draft.avoidances, stored.snapshot.draft.priorities, stored.snapshot.draft.spending]).toEqual([undefined, undefined, undefined]);
    await remount();
    expect(card()).toBeNull();
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    expect(buttonLabels()).toContain("내 웨딩코드 시작하기");
    expect(buttonLabels()).not.toContain("저장된 답 지우고 새로 시작");
    expect(buttonLabels()).not.toContain("이어서 답하기");
    // 이 줄은 모든 화면에 붙으니 소개에서만 맞는 말로 바꾸지 않고, 답이 없을 때의 기본 줄을 그대로 쓴다.
    expect(storageLine()).toBe(NO_ANSWER_LINE);
    expect(storageLine()).not.toBe(SAVED_LINE);
  });

  it.each([
    ["기본 흐름 처음 자리", { flow: "core", index: V31_CORE_INDEXES[0] }],
    ["기본 흐름 중간 자리", { flow: "core", index: V31_CORE_INDEXES[7] }],
    ["선택 흐름", { flow: "extra", index: V31_EXTRA_INDEXES[0] }],
    ["수정 화면", { flow: "core", index: V31_CORE_INDEXES[3], editing: true }],
    ["이전 전체 흐름", { flow: "full", index: 5 }],
  ] as const)("위치만 있는 저장 기록(%s)이 이미 쌓여 있어도 카드를 띄우지 않고 시작 버튼을 그대로 둔다", async (_name, position) => {
    seed(snapshot(createV31Draft(), position));
    const raw = window.localStorage.getItem(LOCAL_KEY);
    await render();
    expect(card()).toBeNull();
    expect(container.textContent).not.toContain("이 브라우저에 남겨 둔 답");
    expect(buttonLabels()).toContain("내 웨딩코드 시작하기");
    expect(buttonLabels()).not.toContain("저장된 답 지우고 새로 시작");
    expect(storageLine()).toBe(NO_ANSWER_LINE);
    // 보여 주지 않을 뿐 읽기만으로 기록을 바꾸지 않는다.
    expect(window.localStorage.getItem(LOCAL_KEY)).toBe(raw);
  });

  it("받은 링크로 열어도 위치만 있는 기록에는 카드가 없고 ‘나도 답해보기’가 그대로다", async () => {
    seed(snapshot(createV31Draft(), { flow: "core", index: V31_CORE_INDEXES[2] }));
    await render({ partnerDraft: completed() });
    expect(card()).toBeNull();
    expect(buttonLabels()).toContain("나도 답해보기");
    expect(buttonLabels()).not.toContain("저장된 답 지우고 새로 시작");
  });

  it.each([
    ["별점 3", (draft: V31Draft) => { draft.answers.G1 = 3; }],
    ["아직 모르겠어요", (draft: V31Draft) => { draft.answers.G1 = "undecided"; }],
    ["지금 답하지 않을게요", (draft: V31Draft) => { draft.answers.G1 = "skipped"; }],
    ["해당하지 않아요", (draft: V31Draft) => { draft.answers.G1 = "not_applicable"; }],
    ["고른 취향", (draft: V31Draft) => { draft.tastes.venue = { status: "answered", values: ["indoor"] }; }],
    ["따로 피하고 싶은 것 없음", (draft: V31Draft) => { draft.avoidances = { status: "no_preference" }; }],
    ["우선순위 고르지 않음", (draft: V31Draft) => { draft.priorities = { status: "skipped" }; }],
    ["더 쓰고 싶은 곳", (draft: V31Draft) => { draft.spending = { status: "answered", values: ["venue"] }; }],
    ["추가 질문 한 문장", (draft: V31Draft) => { draft.answers.V1 = 5; }],
  ])("답이 하나만 있어도(%s) 남겨 둔 답이 있다고 알리고 이어 하기와 새로 시작을 둘 다 내놓는다", async (_name, fill) => {
    const draft = createV31Draft(); fill(draft);
    seed(snapshot(draft, { flow: "core", index: V31_CORE_INDEXES[0] }));
    await render();
    expect(card()?.querySelector("h2")?.textContent).toBe(RESUME_TITLE);
    expect(buttonLabels()).toContain("이어서 답하기");
    expect(buttonLabels()).toContain("저장된 답 지우고 새로 시작");
    expect(buttonLabels()).not.toContain("내 웨딩코드 시작하기");
  });

  it("위치만 있는 기록 위에서 시작해도 지우기 실패를 알리지 않고 그 자리에 새 위치를 저장한다", async () => {
    seed(snapshot(createV31Draft(), { flow: "core", index: V31_CORE_INDEXES[7] }));
    await render();
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await button("내 웨딩코드 시작하기");
    // 지울 답이 없으니 지우려 하지 않고, 그래서 지우지 못했다는 안내도 없다.
    expect(remove).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("지우지 못했어요");
    expect(container.querySelector("[data-question]")).not.toBeNull();
    const stored = readV31LocalProgress(window.localStorage);
    expect(stored.status === "ready" && stored.snapshot.index).toBe(V31_CORE_INDEXES[0]);
    expect(stored.status === "ready" && stored.snapshot.draft.answers).toEqual({});
  });

  it("답이 있는 기록 위에서 새로 시작하다 지우기가 실패하면 기존대로 알린다", async () => {
    const draft = createV31Draft(); draft.answers.G1 = 4;
    seed(snapshot(draft, { flow: "core", index: V31_CORE_INDEXES[0] }));
    await render();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
    await button("저장된 답 지우고 새로 시작"); await dialogButton("지우고 새로 시작");
    expect(container.textContent).toContain("현재 화면은 새로 시작했지만, 브라우저에 저장된 답을 지우지 못했어요");
  });

  it("저장 줄은 첫 답 전에는 기본 줄이고, 답을 하나 고르면 저장됐다고 말한다", async () => {
    await render();
    expect(storageLine()).toBe(NO_ANSWER_LINE);
    await button("내 웨딩코드 시작하기");
    // 시작하면 위치가 저장되지만 답은 아직 없으니 나중에 이어 할 수 있다고 말하지 않는다.
    expect(window.localStorage.getItem(LOCAL_KEY)).not.toBeNull();
    expect(storageLine()).toBe(NO_ANSWER_LINE);
    await click(container.querySelector('input[value="5"]'));
    expect(storageLine()).toBe(SAVED_LINE);
  });

  it("끝낸 결과가 저장돼 있으면 카드와 ‘내 결과 다시 보기’가 그대로 뜬다", async () => {
    seed(snapshot(completed(), { screen: "result", index: 33 }));
    await render();
    expect(card()?.querySelector("h2")?.textContent).toBe(RESUME_TITLE);
    expect(card()?.textContent).toContain("전에 답한 내 결과를 다시 볼 수 있어요.");
    expect(buttonLabels()).toContain("내 결과 다시 보기");
    expect(buttonLabels()).toContain("저장된 답 지우고 새로 시작");
  });
});
