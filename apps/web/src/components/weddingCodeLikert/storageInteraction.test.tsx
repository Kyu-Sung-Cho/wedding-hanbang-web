import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { createDraft, LIKERT_AUTOSAVE_KEY, parseDraft } from "@/lib/weddingCode/likert/io";
import { STORAGE_KEY } from "@/lib/weddingCode/likert/types";
import WeddingCodeLikertClient from "./WeddingCodeLikertClient";

let harness: Harness;
const legacyKey = "hanbang.wedding-code.v31.autosave";
const button = (text: string) => [...harness.container.querySelectorAll("button")]
  .find(element => element.textContent?.includes(text));
const autosave = () => harness.container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
async function frames() { await act(async () => { await vi.runOnlyPendingTimersAsync(); }); }
async function open() { await harness.render(<WeddingCodeLikertClient />); await frames(); }
async function beginAnswer() {
  await click(button("새로 답하기") ?? button("나의 준비 언어 찾기"));
  await click(button("매우 그렇다"));
  await frames();
}
async function toggle() { await click(autosave()); await frames(); }
function expectCurrentAnswer() {
  expect(button("매우 그렇다")?.getAttribute("aria-pressed")).toBe("true");
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/wedding-code");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(handle => window.clearTimeout(handle));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  harness = createHarness();
});
afterEach(async () => { await harness.unmount(); vi.restoreAllMocks(); vi.useRealTimers(); window.localStorage.clear(); });

describe("자동 저장 설정과 기존 원본 보호의 실제 화면 왕복", () => {
  it.each([
    ["만료", JSON.stringify({ ...createDraft(), updatedAt: "2020-01-01T00:00:00.000Z" })],
    ["잘못된 JSON", "{not-a-draft"],
    ["다른 표현판", JSON.stringify({ ...createDraft(), expressionVersion: "future-expression" })],
  ])("%s 원본은 새 응답과 저장 켜기로 덮지 않는다", async (_name, raw) => {
    window.localStorage.setItem(legacyKey, "off");
    window.localStorage.setItem(STORAGE_KEY, raw);
    await open();
    expect(autosave().checked).toBe(false);
    await beginAnswer();
    await toggle();
    expect(autosave().checked).toBe(true);
    expect(window.localStorage.getItem(LIKERT_AUTOSAVE_KEY)).toBe("on");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw);
    expect(harness.container.textContent).toContain("기존 기록은 덮어쓰지 않아요");
    expectCurrentAnswer();
    expect(window.localStorage.getItem(legacyKey)).toBe("off");
  });

  it("저장 끄기의 실제 삭제가 확인된 뒤 다시 켜면 현재 답을 저장한다", async () => {
    window.localStorage.setItem(legacyKey, "off");
    window.localStorage.setItem(STORAGE_KEY, "original-invalid-record");
    await open(); await beginAnswer(); await toggle();
    await toggle();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expectCurrentAnswer();
    await toggle();
    const stored = parseDraft(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored?.answers[ITEMS[0].id]).toEqual({ status: "rated", value: 5 });
    expect(window.localStorage.getItem(legacyKey)).toBe("off");
  });

  it("명시 삭제 실패는 원본과 현재 답을 보호하고, 성공한 재시도만 새 저장을 허용한다", async () => {
    const raw = "original-invalid-record";
    window.localStorage.setItem(legacyKey, "off"); window.localStorage.setItem(STORAGE_KEY, raw);
    await open(); await beginAnswer();
    const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("denied"); });
    await click(button("이 개편본의 저장과 현재 답 지우기")); await frames();
    await toggle();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw); expectCurrentAnswer();
    remove.mockRestore();
    await click(button("이 개편본의 저장과 현재 답 지우기")); await frames();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    await beginAnswer();
    expect(parseDraft(window.localStorage.getItem(STORAGE_KEY)!)?.answers[ITEMS[0].id]).toEqual({ status: "rated", value: 5 });
  });

  it("저장 끄기가 원본을 실제로 제거하지 못하면 다시 켜도 덮어쓰지 않는다", async () => {
    const raw = "undeleted-invalid-record";
    window.localStorage.setItem(legacyKey, "off"); window.localStorage.setItem(STORAGE_KEY, raw);
    await open(); await beginAnswer(); await toggle();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    await toggle();
    expect(autosave().checked).toBe(false);
    await toggle();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw); expectCurrentAnswer();
  });

  it("읽기 오류로 확인하지 못한 기존 원본도 설정 켜기만으로 교체하지 않는다", async () => {
    const raw = "unread-invalid-record";
    window.localStorage.setItem(STORAGE_KEY, raw);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    await open(); get.mockRestore();
    await beginAnswer(); await toggle();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(raw); expectCurrentAnswer();
  });

  it("정상 빈 저장소의 쓰기 오류는 설정 재시도로 복구하고 현재 답을 잃지 않는다", async () => {
    await open();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
    await beginAnswer();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull(); expectCurrentAnswer();
    set.mockRestore();
    await toggle(); await toggle();
    expect(parseDraft(window.localStorage.getItem(STORAGE_KEY)!)?.answers[ITEMS[0].id]).toEqual({ status: "rated", value: 5 });
  });
});
