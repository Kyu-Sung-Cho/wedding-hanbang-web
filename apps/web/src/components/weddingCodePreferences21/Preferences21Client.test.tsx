import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click, createHarness, type Harness } from "@/components/wedding-code/v40/inputTestKit";
import { ITEMS21, VERSIONS, createEmptyAnswers } from "@/lib/weddingCode/preferences21/bank";
import { PREFERENCES21_AUTOSAVE_KEY, PREFERENCES21_STORAGE_KEY, readPreferences21Progress } from "@/lib/weddingCode/preferences21/storage";
import { createPreferences21ReturnFragment, createPreferences21ShareFragment, parsePreferences21ShareFragment } from "@/lib/weddingCode/preferences21/share";
import type { Answers, ItemId, Response } from "@/lib/weddingCode/preferences21/types";
import Preferences21Client from "./Preferences21Client";

let harness: Harness;
const original30Key = "hanbang:wedding-code:likert-alpha.1:draft";
const original30AutosaveKey = `${original30Key}:autosave`;
const now = Date.parse("2026-10-10T12:00:00.000Z");

function button(text: string, root: ParentNode = harness.container): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.trim() === text);
  if (!found) throw new Error(`버튼을 찾지 못했어요: ${text}`);
  return found;
}

function radio(value: Exclude<Response, null>): HTMLInputElement {
  const input = harness.container.querySelector<HTMLInputElement>(`[data-testid="p21-question"] input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`응답을 찾지 못했어요: ${value}`);
  return input;
}

function autosave(): HTMLInputElement {
  const input = harness.container.querySelector<HTMLInputElement>('[aria-label="내 답 저장 설정"] input[type="checkbox"]');
  if (!input) throw new Error("저장 설정이 없어요");
  return input;
}

function sharing(): HTMLElement {
  const section = harness.container.querySelector<HTMLElement>('section[aria-labelledby="p21-share-title"]');
  if (!section) throw new Error("공유 화면이 없어요");
  return section;
}

function previewConsent(): HTMLInputElement {
  const input = sharing().querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error("공개 동의가 없어요");
  return input;
}

function answerSet(value: Response): Answers {
  const answers = createEmptyAnswers();
  for (const item of ITEMS21) answers[item.id] = value;
  return answers;
}

function stored(answers: Answers, position = 0, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schemaVersion: 1, ...VERSIONS, answers, position, answerWrittenAt: now, ...overrides });
}

function seed(answers: Answers, position = 0): string {
  const raw = stored(answers, position);
  window.localStorage.setItem(PREFERENCES21_STORAGE_KEY, raw);
  window.localStorage.setItem(PREFERENCES21_AUTOSAVE_KEY, "on");
  return raw;
}

async function frames(): Promise<void> {
  await act(async () => { await vi.runOnlyPendingTimersAsync(); });
}

async function open(): Promise<void> {
  await harness.render(<Preferences21Client />);
  await frames();
}

async function begin(): Promise<void> { await click(button("21문항 시작하기")); }

async function choose(value: Exclude<Response, null>): Promise<void> { await click(radio(value)); }

async function finish(responses: readonly Exclude<Response, null>[] = ITEMS21.map(() => 5)): Promise<void> {
  for (let index = 0; index < 21; index++) {
    await choose(responses[index]);
    await click(button(index === 20 ? "내 답으로 결과 보기" : "다음 문항"));
  }
}

function detailFor(id: ItemId): HTMLDetailsElement {
  const number = Number(id.slice(1));
  const report = harness.container.querySelector('[data-testid="p21-report"]');
  const detail = [...(report?.querySelectorAll<HTMLDetailsElement>("details") ?? [])]
    .find((entry) => entry.querySelector("summary")?.textContent?.startsWith(`${number}. `));
  if (!detail) throw new Error(`원답 근거를 찾지 못했어요: ${id}`);
  return detail;
}

function fragmentOrThrow(fragment: string | null): string {
  if (!fragment) throw new Error("검증용 링크를 만들지 못했어요");
  return fragment;
}

function mismatchedDisplayVersion(fragment: string): string {
  const separator = fragment.indexOf("=");
  const token = fragment.slice(separator + 1).replaceAll("-", "+").replaceAll("_", "/");
  const decoded: unknown = JSON.parse(atob(token));
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) throw new Error("검증용 봉투가 잘못됐어요");
  const updated = btoa(JSON.stringify({ ...decoded, displayVersion: "preferences21-report-future" }))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `${fragment.slice(0, separator + 1)}${updated}`;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/wedding-code/preferences21");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((handle) => window.clearTimeout(handle));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  harness = createHarness();
});

afterEach(async () => {
  await harness.unmount();
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("21문항의 실제 화면 흐름", () => {
  it("저장 기본 꺼짐부터 정확한 21문항을 거쳐 원답·핵심 선호·B 주제 근거에 도착한다", async () => {
    await open();
    expect(autosave().checked).toBe(false);
    await begin();
    expect(button("다음 문항").disabled).toBe(true);
    expect(harness.container.querySelector('[aria-label="현재 문항 1 / 21"]')).not.toBeNull();
    const labels = [...harness.container.querySelectorAll<HTMLLabelElement>('[data-testid="p21-question"] fieldset label')];
    expect(labels.map((label) => label.textContent?.replace(/^\d/u, ""))).toEqual([
      "전혀 맞지 않아요", "별로 맞지 않아요", "반반이에요", "대체로 맞아요", "아주 잘 맞아요",
      "아직 모르겠어요", "나에게 해당하지 않아요", "지금 답하지 않을게요",
    ]);
    expect(harness.container.querySelectorAll('[data-testid="p21-question"] input[type="radio"]')).toHaveLength(8);
    expect(document.activeElement?.id).toBe("p21-question-heading");
    for (let index = 0; index < 21; index++) {
      expect(harness.container.querySelector(`[aria-label="현재 문항 ${index + 1} / 21"]`)).not.toBeNull();
      expect(harness.container.querySelector("#p21-question-heading")?.textContent).toBe(ITEMS21[index].statement);
      await choose(5);
      await click(button(index === 20 ? "내 답으로 결과 보기" : "다음 문항"));
    }
    const report = harness.container.querySelector('[data-testid="p21-report"]');
    expect(report?.textContent).toContain("선택한 문항 21/21 · 1–5 응답 21개");
    expect(report?.querySelector("section ul")?.textContent).toContain("식에 둘의 첫 만남 이야기를 넣고 싶다고 답했어요.");
    for (const id of ["Q05", "Q06"] satisfies ItemId[]) {
      const detail = detailFor(id);
      expect(detail.closest("section")?.querySelector("h3")?.textContent).toBe("둘이 후보를 찾고 고를 때");
      expect(detail.textContent).toContain("내 답 · 아주 잘 맞아요");
      expect(detail.textContent).toContain("파트너와 확인할 질문");
    }
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBeNull();
  });

  it("저장을 끈 같은 탭에서 잠시 멈춰도 현재 위치와 숫자·모름 답을 보존한다", async () => {
    await open(); await begin(); await choose(5); await click(button("다음 문항")); await choose("unknown");
    await click(button("잠시 멈추기"));
    expect(harness.container.textContent).toContain("지금 탭의 내 답 계속 보기 · 2/21");
    await click(button("지금 탭의 내 답 계속 보기 · 2/21"));
    expect(harness.container.querySelector('[aria-label="현재 문항 2 / 21"]')).not.toBeNull();
    expect(radio("unknown").checked).toBe(true);
    await click(button("이전 문항"));
    expect(radio(5).checked).toBe(true);
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBeNull();
  });

  it("저장 허용 후 화면을 다시 열면 마지막 위치와 본인 답을 명시적으로 이어본다", async () => {
    await open(); await click(autosave()); await begin(); await choose(4); await click(button("다음 문항")); await choose("skipped");
    expect(readPreferences21Progress().status).toBe("ready");
    await harness.unmount(); harness = createHarness(); await open();
    expect(harness.container.querySelector('[data-testid="p21-question"]')).toBeNull();
    await click(button("저장한 내 답 이어보기 · 2/21"));
    expect(harness.container.querySelector('[aria-label="현재 문항 2 / 21"]')).not.toBeNull();
    expect(radio("skipped").checked).toBe(true);
    await click(button("이전 문항")); expect(radio(4).checked).toBe(true);
  });

  it("혼합된 별도 응답의 개수와 수치 응답 개수를 결과에서 구분한다", async () => {
    await open(); await begin();
    await finish(["unknown", "not-applicable", "skipped", ...Array.from({ length: 18 }, () => 3 as const)]);
    const report = harness.container.querySelector('[data-testid="p21-report"]');
    expect(report?.textContent).toContain("선택한 문항 21/21 · 1–5 응답 18개");
    expect(report?.textContent).toContain("모름 1 · 해당 없음 1 · 답하지 않음 1 · 미응답 0");
    expect(detailFor("Q01").textContent).toContain("아직 모르겠어요");
    expect(detailFor("Q02").textContent).toContain("나에게 해당하지 않아요");
    expect(detailFor("Q03").textContent).toContain("지금 답하지 않을게요");
  });

  it.each([
    ["unknown", "모름 21", "어떤 정보를 먼저 확인하면 답하기 쉬울까?"],
    ["not-applicable", "해당 없음 21", "이번 준비에 해당하는 장면이 있다면"],
    ["skipped", "답하지 않음 21", "나중에 답하고 싶은 부분이 있을까"],
  ] as const)("모두 %s인 결과에도 상태를 존중하는 상황·질문·행동을 제공한다", async (response, count, prompt) => {
    await open(); await begin(); await finish(ITEMS21.map(() => response));
    const report = harness.container.querySelector('[data-testid="p21-report"]');
    expect(report?.textContent).toContain("1–5 응답 0개");
    expect(report?.textContent).toContain(count);
    expect(report?.textContent).toContain("파트너와 확인");
    expect(report?.textContent).toContain("해볼 일");
    expect(report?.textContent).toContain(prompt);
    expect(report?.textContent).toContain("남긴 상태만으로 더 편한 방식을 정하지 않아요");
    expect(report?.textContent).not.toContain("이 답에서 읽은 선호");
  });

  it("답 수정 후 결과와 새 공유가 갱신되고 이전 공개 동의·링크는 재사용되지 않는다", async () => {
    seed(answerSet(5), 20); await open(); await click(button("저장한 내 답 이어보기 · 21/21"));
    await click(previewConsent()); await click(button("요약 링크 만들기", sharing()));
    const originalLink = sharing().querySelector<HTMLTextAreaElement>("#p21-share-url")?.value;
    expect(new URL(originalLink ?? "").pathname).toBe("/wedding-code/preferences21");
    expect(parsePreferences21ShareFragment(new URL(originalLink ?? "").hash).status).toBe("ready");
    await click(button("이 문항 답 수정", detailFor("Q11")));
    expect(harness.container.querySelector('[aria-label="현재 문항 11 / 21"]')).not.toBeNull();
    await choose(1); await click(button("수정한 답으로 결과 보기"));
    expect(detailFor("Q11").textContent).toContain("내 답 · 전혀 맞지 않아요");
    expect(detailFor("Q12").textContent).toContain("내 답 · 아주 잘 맞아요");
    expect(previewConsent().checked).toBe(false);
    expect(button("요약 링크 만들기", sharing()).disabled).toBe(true);
    expect(sharing().querySelector("#p21-share-url")).toBeNull();
    await click(previewConsent()); await click(button("요약 링크 만들기", sharing()));
    const updatedLink = sharing().querySelector<HTMLTextAreaElement>("#p21-share-url")?.value;
    expect(updatedLink).not.toBe(originalLink);
    const updated = parsePreferences21ShareFragment(new URL(updatedLink ?? "").hash);
    expect(updated.status).toBe("ready");
    if (updated.status !== "ready" || updated.payload.kind !== "summary") throw new Error("갱신된 요약이 없어요");
    expect(updated.payload.summaryItemIds).not.toContain("Q11");
  });
});

describe("받은 링크와 기존 저장의 경계", () => {
  it("파트너 초대를 열어도 저장한 본인 답을 바꾸거나 상대 답을 자동 저장하지 않는다", async () => {
    const own = createEmptyAnswers(); own.Q01 = 1;
    const original = seed(own);
    const fragment = fragmentOrThrow(createPreferences21ShareFragment({ kind: "partner-invitation", answers: answerSet(5), consent: true }));
    window.history.replaceState(null, "", `/wedding-code/preferences21${fragment}`);
    await open();
    expect(harness.container.textContent).toContain("받은 답은 내 답으로 저장하지 않아요");
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBe(original);
    await click(button("저장한 내 답 이어보기 · 1/21"));
    expect(radio(1).checked).toBe(true);
    expect(radio(5).checked).toBe(false);
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBe(original);
  });

  it("같은 판의 반환 링크를 원답으로 비교하고 다른 표시판 링크는 비교 화면을 열지 않는다", async () => {
    const inviteFragment = fragmentOrThrow(createPreferences21ShareFragment({ kind: "partner-invitation", answers: answerSet(5), consent: true }));
    const invite = parsePreferences21ShareFragment(inviteFragment);
    if (invite.status !== "ready" || invite.payload.kind !== "partner-invitation") throw new Error("검증용 초대가 없어요");
    const returned = fragmentOrThrow(createPreferences21ReturnFragment(invite.payload, answerSet(1), { consent: true }));
    window.history.replaceState(null, "", `/wedding-code/preferences21${returned}`);
    await open();
    const comparison = harness.container.querySelector('[data-testid="p21-comparison"]');
    expect(comparison?.textContent).toContain("같은 1–5 답 0문항 · 다른 1–5 답 21문항");
    expect(comparison?.textContent).toContain("아주 잘 맞아요 / 전혀 맞지 않아요");
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBeNull();
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code/preferences21${mismatchedDisplayVersion(returned)}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(harness.container.querySelector('[data-testid="p21-comparison"]')).toBeNull();
    expect(harness.container.textContent).toContain("문항·해석·표시 판이 다른 링크");
  });

  it.each([
    ["잘못된 JSON", "{not-json"],
    ["만료", stored(answerSet(5), 20, { answerWrittenAt: now - 31 * 24 * 60 * 60 * 1000 })],
    ["다른 문항판", stored(answerSet(5), 20, { questionnaireVersion: "preferences-20261008-r2" })],
  ])("%s 저장은 새 답이나 저장 켜기로 덮지 않는다", async (_name, raw) => {
    window.localStorage.setItem(PREFERENCES21_STORAGE_KEY, raw);
    window.localStorage.setItem(PREFERENCES21_AUTOSAVE_KEY, "on");
    await open();
    expect(autosave().checked).toBe(false);
    expect(autosave().disabled).toBe(true);
    await begin(); await choose(4); await click(autosave());
    expect(radio(4).checked).toBe(true);
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBe(raw);
  });

  it("다른 탭의 새 저장 이벤트가 현재 답을 유지하고 이후 덮어쓰기를 막는다", async () => {
    seed(createEmptyAnswers()); await open(); await click(button("저장한 내 답 이어보기 · 0/21")); await choose(5);
    const other = stored(answerSet(2), 7);
    await act(async () => {
      window.localStorage.setItem(PREFERENCES21_STORAGE_KEY, other);
      window.dispatchEvent(new StorageEvent("storage", { key: PREFERENCES21_STORAGE_KEY, newValue: other }));
    });
    expect(radio(5).checked).toBe(true);
    expect(autosave().checked).toBe(false);
    expect(autosave().disabled).toBe(true);
    expect(harness.container.textContent).toContain("지금 탭의 답은 그대로 두고 자동 저장을 멈췄어요");
    await choose(1);
    expect(radio(1).checked).toBe(true);
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBe(other);
  });

  it("저장 이벤트를 놓쳐도 저장 직전 충돌을 발견해 다른 탭 원본을 보호한다", async () => {
    seed(createEmptyAnswers()); await open(); await click(button("저장한 내 답 이어보기 · 0/21")); await choose(5);
    const other = stored(answerSet(2), 8);
    window.localStorage.setItem(PREFERENCES21_STORAGE_KEY, other);
    await choose(1);
    expect(radio(1).checked).toBe(true);
    expect(autosave().checked).toBe(false);
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBe(other);
    expect(harness.container.textContent).toContain("다른 탭에서 저장된 답이 바뀌어 덮어쓰지 않았어요");
  });

  it("21문항 답 저장·삭제·공유가 기존 30문항 키와 저장 선택을 보존한다", async () => {
    window.localStorage.setItem(original30Key, "previous-30-answer-record");
    window.localStorage.setItem(original30AutosaveKey, "on");
    await open(); await click(autosave()); await begin(); await finish();
    await click(previewConsent()); await click(button("요약 링크 만들기", sharing()));
    await click(button("이 브라우저의 21문항 저장 지우기"));
    expect(window.localStorage.getItem(PREFERENCES21_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(original30Key)).toBe("previous-30-answer-record");
    expect(window.localStorage.getItem(original30AutosaveKey)).toBe("on");
    // 맨 주소는 64문항을 열므로 30문항 링크는 30문항 판을 직접 가리킨다
    expect(harness.container.querySelector('a[href="/wedding-code?v=likert-preferences-alpha.1"]')?.textContent).toContain("기존 30문항");
    expect(harness.container.querySelector('a[href="/wedding-code"]')).toBeNull();
  });
});
