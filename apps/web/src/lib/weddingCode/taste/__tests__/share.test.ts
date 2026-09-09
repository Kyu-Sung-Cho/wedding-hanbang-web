import { describe, expect, it } from "vitest";
import { createEmptyWeddingTasteDraft } from "../validation";
import { buildWeddingTasteShareUrl, decodeWeddingTasteDraft, decodeWeddingTasteShareHash, encodeWeddingTasteDraft } from "../share";
import type { WeddingTasteDraftV1 } from "../types";

const draft = (): WeddingTasteDraftV1 => ({ ...createEmptyWeddingTasteDraft(), mood: { status: "answered", values: ["natural"] } });
describe("고정 선택만 공유하는 취향 링크", () => {
  it("먼저·나중에 답한 사람의 순서를 지키며 원문을 쿼리에 넣지 않는다", () => {
    const second = draft(); second.mood = { status: "answered", values: ["classic"] };
    const url = new URL(buildWeddingTasteShareUrl({ origin: "https://hanbang.ai", first: draft(), second }));
    expect(url.pathname).toBe("/wedding-code/taste"); expect(url.search).toBe("");
    expect(decodeWeddingTasteShareHash(url.hash)).toEqual({ first: draft(), second });
  });
  it("응답이 없거나 두번째만 있거나 중복·잘못된 버전·긴 링크이면 거절한다", () => {
    const token = encodeWeddingTasteDraft(draft());
    for (const hash of [
      "#v=wedding-taste-v1&b=" + token,
      "#v=wedding-taste-v2&a=" + token,
      "#v=wedding-taste-v1&a=" + token + "&a=" + token,
      "#v=wedding-taste-v1&v=wedding-taste-v1&a=" + token,
      "#v=wedding-taste-v1&a=" + token + "&privateNote=secret",
      "#v=wedding-taste-v1&a=" + "A".repeat(9000),
    ]) expect(decodeWeddingTasteShareHash(hash), hash.slice(0, 70)).toBeNull();
    expect(() => buildWeddingTasteShareUrl({ origin: "https://hanbang.ai", first: createEmptyWeddingTasteDraft() })).toThrow();
  });
  it("명시한 미정은 공유하지만 자유문 필드나 중복 JSON 키를 숨긴 토큰은 거절한다", () => {
    const explicit = createEmptyWeddingTasteDraft(); explicit.mood = { status: "undecided" };
    expect(decodeWeddingTasteDraft(encodeWeddingTasteDraft(explicit))).toEqual(explicit);
    function encodeRaw(json: string) { return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
    expect(decodeWeddingTasteDraft(encodeRaw(JSON.stringify({ ...draft(), privateNote: "secret" })))).toBeNull();
    const json = JSON.stringify(draft());
    expect(decodeWeddingTasteDraft(encodeRaw(json.replace('"version":', '"version":"wedding-taste-v2","version":')))).toBeNull();
    expect(decodeWeddingTasteDraft(encodeWeddingTasteDraft(draft()) + "=")).toBeNull();
  });
});
