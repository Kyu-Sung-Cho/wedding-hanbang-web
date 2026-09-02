import { describe, expect, it } from "vitest";

import { couldBePostId, isMalformedPostIdError } from "@/lib/community/postIdErrors";

describe("couldBePostId", () => {
  it("실제 글 id 를 통과시킨다", () => {
    // 운영에 있는 id 들이다. 여기서 막히면 살아 있는 글이 404 가 된다.
    for (const id of [
      "8fbf4dbd-bb6c-42f5-b9b1-5d6b2dbc8fff",
      "26029c13-9d4a-4457-ba5e-52e16715f0ae",
      "00000000-0000-0000-0000-000000000000",
      "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    ]) {
      expect(couldBePostId(id), id).toBe(true);
    }
  });

  it("버전·variant 비트를 요구하지 않는다", () => {
    // uuid 생성 방식이 v4 에서 v7 로 바뀌어도 살아 있는 글이 사라지면 안 된다.
    expect(couldBePostId("018f3a2b-1c4d-7e8f-9a0b-1c2d3e4f5a6b")).toBe(true);
  });

  it("행과 비교될 수 없는 주소를 걸러낸다", () => {
    for (const value of [
      "1",
      "abc",
      "",
      "   ",
      "8fbf4dbd-bb6c-42f5-b9b1-5d6b2dbc8ff",
      "8fbf4dbdbb6c42f5b9b15d6b2dbc8fff",
      "8fbf4dbd-bb6c-42f5-b9b1-5d6b2dbc8fffz",
      "../../etc/passwd",
      "8fbf4dbd-bb6c-42f5-b9b1-5d6b2dbc8fff OR 1=1",
    ]) {
      expect(couldBePostId(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("문자열이 아닌 값에 던지지 않는다", () => {
    for (const value of [null, undefined, 1, {}, []]) {
      expect(couldBePostId(value)).toBe(false);
    }
  });
});

describe("isMalformedPostIdError", () => {
  it("22P02 만 '주소가 UUID 가 아님' 으로 읽는다", () => {
    expect(isMalformedPostIdError({ code: "22P02" })).toBe(true);
    expect(isMalformedPostIdError({ code: "PGRST116" })).toBe(false);
    expect(isMalformedPostIdError({ code: "57014" })).toBe(false);
  });

  it("code 가 없거나 오류가 아닌 값에 던지지 않는다", () => {
    for (const value of [null, undefined, "22P02", {}, new Error("22P02")]) {
      expect(isMalformedPostIdError(value)).toBe(false);
    }
  });
});
