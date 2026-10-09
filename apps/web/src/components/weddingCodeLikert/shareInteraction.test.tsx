import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { ITEMS } from "@/lib/weddingCode/likert/bank";
import { buildShareUrl, createDraft, createSnapshot, readShareFragment } from "@/lib/weddingCode/likert/io";
import { STORAGE_KEY, type Answer, type Answers } from "@/lib/weddingCode/likert/types";
import WeddingCodeLikertClient from "./WeddingCodeLikertClient";

let harness: Harness;
function all(answer: Answer): Answers {
  return Object.fromEntries(ITEMS.map(item => [item.id, { ...answer }]));
}
function pairUrl(first: Answers, second: Answers): string {
  const url = buildShareUrl(window.location.origin, createSnapshot(first), createSnapshot(second));
  if (!url) throw new Error("Fixture pair link missing");
  return url;
}
function storedOwnDraft(): string {
  const raw = JSON.stringify({ ...createDraft(), answers: all({ status: "rated", value: 3 }), cursor: 8, screen: "questions" });
  window.localStorage.setItem(STORAGE_KEY, raw);
  return raw;
}
async function frames() { await act(async () => { await vi.runOnlyPendingTimersAsync(); }); }
async function open(url: string) {
  window.history.replaceState(null, "", url);
  await harness.render(<WeddingCodeLikertClient />);
  await frames();
}
async function receive(url: string) {
  await act(async () => {
    const oldURL = window.location.href;
    window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }));
  });
  await frames();
}
const selectedScene = () => harness.container.querySelector<HTMLSelectElement>("#couple-scene")?.value;
const selectedTopic = () => harness.container.querySelector('#couple-topics button[aria-pressed="true"]')?.textContent;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T00:00:00.000Z"));
  window.localStorage.clear();
  window.history.replaceState(null, "", "/wedding-code");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(performance.now()), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(handle => window.clearTimeout(handle));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  harness = createHarness();
});
afterEach(async () => {
  await harness.unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("받은 두 사람 링크의 같은 탭 전환", () => {
  it("같은 생성 시각의 새 원답 링크는 이전 지출 선택을 가족 장면으로 초기화한다", async () => {
    const stored = storedOwnDraft();
    const first = all({ status: "not_applicable" });
    const second = all({ status: "not_applicable" });
    first["likert.money.venue.C.v1"] = { status: "rated", value: 5 };
    second["likert.money.venue.C.v1"] = { status: "rated", value: 1 };
    const oldUrl = pairUrl(first, second);
    const oldHash = new URL(oldUrl).hash;
    const oldPair = readShareFragment(oldHash);
    await open(oldUrl);
    expect(selectedTopic()).toContain("지출의 우선순위");
    expect(selectedScene()).toBe("likert.money.venue.v1");
    const select = harness.container.querySelector<HTMLSelectElement>("#couple-scene");
    if (!select) throw new Error("장면 선택 요소가 없어요");
    await act(async () => { select.value = "likert.money.photo.v1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    const newFirst = all({ status: "not_applicable" });
    const newSecond = all({ status: "not_applicable" });
    newFirst["likert.family.guests.O.v1"] = { status: "rated", value: 5 };
    newSecond["likert.family.guests.O.v1"] = { status: "rated", value: 1 };
    const newUrl = pairUrl(newFirst, newSecond);
    const newPair = readShareFragment(new URL(newUrl).hash);
    if (oldPair.kind !== "couple" || newPair.kind !== "couple") throw new Error("Fixture pair unreadable");
    expect(newPair.first.createdAt).toBe(oldPair.first.createdAt);
    expect(newPair.second.createdAt).toBe(oldPair.second.createdAt);
    await receive(newUrl);
    expect(selectedTopic()).toContain("가족과 협의할 기준");
    expect(selectedScene()).toBe("likert.family.guests.v1");
    expect(harness.container.querySelector('[aria-label="이 장면에서 함께 확인할 응답"]')?.textContent).toContain("5 · 매우 그렇다");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(readShareFragment(oldHash)).toEqual(oldPair);
    expect(harness.container.querySelector("[key]")).toBeNull();
    expect(harness.container.textContent).not.toContain(JSON.stringify([newPair.first, newPair.second]));
  });

  it("두 번째 사람의 원답만 바뀌어도 새 링크에서 확인할 주제를 다시 고른다", async () => {
    const stored = storedOwnDraft();
    const first = all({ status: "rated", value: 3 });
    const second = all({ status: "not_applicable" });
    second["likert.money.venue.C.v1"] = { status: "rated", value: 5 };
    const oldUrl = pairUrl(first, second);
    const oldHash = new URL(oldUrl).hash;
    const oldPair = readShareFragment(oldHash);
    await open(oldUrl);
    expect(selectedTopic()).toContain("지출의 우선순위");
    const newSecond = all({ status: "not_applicable" });
    newSecond["likert.family.guests.O.v1"] = { status: "rated", value: 5 };
    await receive(pairUrl(first, newSecond));
    expect(selectedTopic()).toContain("가족과 협의할 기준");
    expect(selectedScene()).toBe("likert.family.guests.v1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(readShareFragment(oldHash)).toEqual(oldPair);
  });

  it("동일한 두 원답의 재렌더와 재수신은 사용자가 고른 주제와 장면을 유지한다", async () => {
    const stored = storedOwnDraft();
    const first = all({ status: "not_applicable" });
    const second = all({ status: "not_applicable" });
    first["likert.money.venue.C.v1"] = { status: "rated", value: 5 };
    second["likert.money.venue.C.v1"] = { status: "rated", value: 1 };
    const url = pairUrl(first, second);
    const hash = new URL(url).hash;
    const original = readShareFragment(hash);
    await open(url);
    await click([...harness.container.querySelectorAll("button")].find(button => button.textContent?.includes("가족과 협의할 기준")));
    const select = harness.container.querySelector<HTMLSelectElement>("#couple-scene");
    if (!select) throw new Error("장면 선택 요소가 없어요");
    await act(async () => { select.value = "likert.family.photo.v1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await harness.render(<WeddingCodeLikertClient />);
    await frames();
    expect(selectedTopic()).toContain("가족과 협의할 기준");
    expect(selectedScene()).toBe("likert.family.photo.v1");
    await receive(`${url}&display=again`);
    expect(selectedTopic()).toContain("가족과 협의할 기준");
    expect(selectedScene()).toBe("likert.family.photo.v1");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(readShareFragment(hash)).toEqual(original);
  });
});
