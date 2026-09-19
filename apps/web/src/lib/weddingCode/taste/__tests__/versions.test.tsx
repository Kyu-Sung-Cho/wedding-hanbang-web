// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WEDDING_GUEST_COUNT_OPTIONS } from "@hanbang/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeddingTasteForm from "@/components/wedding-code/WeddingTasteForm";
import {
  buildWeddingTasteAmoraText, buildWeddingTasteShareUrl, compareWeddingTastes, createEmptyWeddingTasteDraft,
  decodeWeddingTasteDraft, decodeWeddingTasteShareHash, encodeWeddingTasteDraft, parseWeddingTasteDraft,
  summarizeWeddingTaste, type TasteNegotiability, type WeddingTasteDraft, type WeddingTasteVersion,
} from "..";

const versions = ["wedding-taste-v1", "wedding-taste-v2"] as const;
function draft(version: WeddingTasteVersion, answer: TasteNegotiability = "open_to_options"): WeddingTasteDraft {
  return { ...createEmptyWeddingTasteDraft(version), priorityDomains: { status: "answered", values: ["photo"] },
    details: { photo: { status: "answered", values: ["candid"] } }, negotiability: { photo: answer } };
}

describe("취향 문항판의 의미 보존", () => {
  it("새로 시작할 때만 v2를 기본으로 만든다", () => {
    expect(createEmptyWeddingTasteDraft().version).toBe("wedding-taste-v2");
    expect(createEmptyWeddingTasteDraft("wedding-taste-v1").version).toBe("wedding-taste-v1");
  });

  it.each(versions)("%s의 값과 원문판을 왕복 보존한다", version => {
    const first = draft(version); const second = draft(version, "prefer_keep");
    const token = encodeWeddingTasteDraft(first);
    expect(decodeWeddingTasteDraft(token)).toEqual(first);
    const url = new URL(buildWeddingTasteShareUrl({ origin: "https://hanbang.ai", first, second }));
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("v")).toBe(version);
    expect(decodeWeddingTasteShareHash(url.hash)).toEqual({ first, second });
  });

  it.each([
    ["prefer_keep", "가능하면 지키고 싶어요"],
    ["open_to_options", "다른 안도 함께 볼 수 있어요"],
  ] as const)("v1 %s의 요약·아모라 전달문을 새 후보 범위로 바꾸지 않는다", (answer, label) => {
    const first = draft("wedding-taste-v1", answer);
    expect(summarizeWeddingTaste(first).find(row => row.key === "negotiability:photo"))
      .toEqual({ key: "negotiability:photo", label: "사진 의견이 다르면", value: label, state: "answered" });
    expect(buildWeddingTasteAmoraText(first)).toBe([
      "방금 고른 결혼식 취향이에요. 제가 고른 거고, 둘이 같이 정한 건 아니에요.",
      "먼저 이야기하고 싶은 것: 사진.",
      "사진: 자연스러운 순간.",
      `사진 의견이 다르면: ${label}.`,
      "먼저 이야기하고 싶다고 고른 게 돈을 더 쓰겠다는 뜻은 아니에요. 다른 안도 볼 수 있다고 한 것도 양보하겠다는 말은 아니고요.",
      "안 고른 부분은 넘겨짚지 말고, 다음에 둘이 얘기해 볼 질문을 하나 추천해 주세요. 예산이나 일정은 아직 바꾸지 말아 주세요.",
    ].join("\n"));
  });

  it.each([
    ["prefer_keep", "지금 고른 취향 안에서 찾아보고 싶어요"],
    ["open_to_options", "다른 취향의 후보도 함께 비교하고 싶어요"],
  ] as const)("v2 %s는 첫 후보 범위로만 요약한다", (answer, label) => {
    const first = draft("wedding-taste-v2", answer);
    expect(summarizeWeddingTaste(first).find(row => row.key === "negotiability:photo"))
      .toEqual({ key: "negotiability:photo", label: "사진 의견이 다르면 먼저 볼 후보", value: label, state: "answered" });
    expect(buildWeddingTasteAmoraText(first)).toContain(`사진 의견이 다르면 먼저 볼 후보: ${label}.`);
    expect(buildWeddingTasteAmoraText(first)).toContain("다른 후보도 비교하고 싶다고 답했더라도, 그걸로 바꾸겠다는 약속은 아니에요");
    expect(buildWeddingTasteAmoraText(first)).not.toContain("가능하면 지키고 싶어요");
  });

  it.each(versions)("%s에서도 미정과 건너뛰기를 같은 선택으로 만들지 않는다", version => {
    const first = draft(version, "undecided"); const second = draft(version);
    delete second.negotiability.photo;
    expect(summarizeWeddingTaste(first).find(row => row.key === "negotiability:photo")?.state).toBe("undecided");
    expect(summarizeWeddingTaste(second).find(row => row.key === "negotiability:photo")?.state).toBe("skipped");
    expect(compareWeddingTastes(first, second).find(row => row.key === "negotiability:photo")?.status).toBe("needs_confirmation");
  });

  it.each(versions)("%s 링크의 다른 판 응답을 거절한다", version => {
    const other = version === "wedding-taste-v1" ? "wedding-taste-v2" : "wedding-taste-v1";
    const first = draft(version); const second = draft(other);
    expect(() => buildWeddingTasteShareUrl({ origin: "https://hanbang.ai", first, second })).toThrow();
    expect(() => compareWeddingTastes(first, second)).toThrow();
    expect(decodeWeddingTasteShareHash(`#v=${version}&a=${encodeWeddingTasteDraft(first)}&b=${encodeWeddingTasteDraft(second)}`)).toBeNull();
    expect(decodeWeddingTasteShareHash(`#v=${other}&a=${encodeWeddingTasteDraft(first)}`)).toBeNull();
  });

  it("알 수 없는 판을 현재 판으로 보정하지 않는다", () => {
    expect(parseWeddingTasteDraft({ ...draft("wedding-taste-v2"), version: "wedding-taste-v3" })).toBeNull();
    expect(decodeWeddingTasteShareHash(`#v=wedding-taste-v3&a=${encodeWeddingTasteDraft(draft("wedding-taste-v2"))}`)).toBeNull();
  });

  it.each(versions)("%s의 하객 수를 그 판의 라벨로 요약하고 하객 없음과 나눈다", version => {
    const first: WeddingTasteDraft = { ...createEmptyWeddingTasteDraft(version), priorityDomains: { status: "answered", values: ["guests"] },
      details: { guests: { status: "answered", values: ["under50"] } } };
    const expected = version === "wedding-taste-v1" ? "50명 미만" : "1~49명";
    expect(summarizeWeddingTaste(first).find(row => row.key === "detail:guests")?.value).toBe(expected);
    expect(buildWeddingTasteAmoraText(first)).toContain(`원하는 하객 규모: ${expected}.`);
    first.details.guests = { status: "answered", values: ["no_guests"] };
    expect(summarizeWeddingTaste(first).find(row => row.key === "detail:guests")?.value).toBe("둘만, 하객 없이");
    expect(WEDDING_GUEST_COUNT_OPTIONS.find(option => option.value === "under50")?.label).toBe("50명 미만");
  });
});

let host: HTMLDivElement; let root: Root;
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(item =>
    (item.querySelector("[data-choice-label]") ?? item).textContent?.trim() === label);
  expect(button, label).toBeDefined();
  act(() => button?.click());
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe("폼의 문항판 보존", () => {
  it.each(versions)("%s의 질문·하객 범위로 답하고 같은 판을 제출한다", version => {
    const done = vi.fn();
    act(() => root.render(<WeddingTasteForm version={version} onComplete={done} />));
    click("사진"); click("하객 규모"); click("다음"); click("다음");
    click("자연스러운 순간"); click("다음");
    const guestLabel = version === "wedding-taste-v1" ? "50명 미만" : "1~49명";
    click(guestLabel); click("다음"); click("다음");
    const question = version === "wedding-taste-v1" ? "둘의 생각이 다르면 어떻게 하고 싶나요?" : "의견이 다르면, 먼저 어떤 후보부터 볼까요?";
    expect(host.querySelector("h2")?.textContent).toBe(question);
    click(version === "wedding-taste-v1" ? "다른 안도 함께 볼 수 있어요" : "다른 취향의 후보도 함께 비교하고 싶어요");
    click("내 선택 보기");
    expect(done.mock.calls[0][0]).toMatchObject({ version, details: { guests: { status: "answered", values: ["under50"] } }, negotiability: { photo: "open_to_options" } });
    expect(done.mock.calls[0][0].negotiability).not.toHaveProperty("guests");
  });

  it("구판으로 고른 내용을 다시 열어도 새 질문으로 옮기지 않는다", () => {
    const done = vi.fn(); const previous = draft("wedding-taste-v1", "prefer_keep");
    act(() => root.render(<WeddingTasteForm initialDraft={previous} onComplete={done} />));
    click("다음"); click("다음"); click("다음"); click("다음");
    expect(host.querySelector("h2")?.textContent).toBe("둘의 생각이 다르면 어떻게 하고 싶나요?");
    click("내 선택 보기");
    expect(done).toHaveBeenCalledExactlyOnceWith(previous);
  });
});
