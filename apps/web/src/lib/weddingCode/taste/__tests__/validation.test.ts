import { describe, expect, it } from "vitest";
import { createEmptyWeddingTasteDraft, parseWeddingTasteDraft } from "../validation";

describe("직접 고른 결혼식 취향 계약", () => {
  it("빈 응답에서 취향을 만들지 않고 알 수 없는 원문 필드를 거부한다", () => {
    const empty = createEmptyWeddingTasteDraft();
    expect(parseWeddingTasteDraft(empty)).toEqual(empty);
    expect(empty.mood).toEqual({ status: "skipped" });
    expect(parseWeddingTasteDraft({ ...empty, privateNote: "가족 이야기" })).toBeNull();
  });
  it("직접 고른 세부 취향이 없으면 협의 의사를 대신 만들지 않는다", () => {
    expect(parseWeddingTasteDraft({ ...createEmptyWeddingTasteDraft(), priorityDomains: { status: "answered", values: ["photo"] }, negotiability: { photo: "prefer_keep" } })).toBeNull();
  });
  it("값이 없는 배열 칸을 유효한 선택으로 받아들이지 않는다", () => {
    expect(parseWeddingTasteDraft({ ...createEmptyWeddingTasteDraft(), mood: { status: "answered", values: new Array(1) } })).toBeNull();
  });
  it.each([
    { mood: { status: "undecided", values: ["minimal"] } },
    { mood: { status: "answered", values: ["minimal", "minimal"] } },
    { mood: { status: "answered", values: ["fake-style"] } },
    { mood: { status: "answered", values: [] } },
    { mood: { status: "answered", values: ["minimal"], source: "partner" } },
    { priorityDomains: { status: "answered", values: ["photo", "meal", "venue"] } },
    { details: { photo: { status: "answered", values: ["candid"] } } },
    { version: "wedding-taste-v2" },
  ])("상태 충돌·미선택 주제·잘못된 버전을 거부한다: %j", (changed) => {
    expect(parseWeddingTasteDraft({ ...createEmptyWeddingTasteDraft(), ...changed })).toBeNull();
  });
});
