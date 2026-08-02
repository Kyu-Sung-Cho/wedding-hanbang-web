import { describe, expect, it } from "vitest";
import {
  cleanOptionalKoreanMobile,
  readBoundedJsonValue,
  readBoundedUtf8Text,
  sanitizeJsonObject,
} from "../requestValidation";

describe("sanitizeJsonObject", () => {
  it("drops prototype-pollution keys at every nesting level", () => {
    const input = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"bad":true},"safe":{"prototype":"bad","ok":1}}',
    ) as unknown;

    const sanitized = sanitizeJsonObject(input);

    expect(sanitized).not.toBeNull();
    expect(Object.getPrototypeOf(sanitized)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(sanitized, "__proto__")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized, "constructor")).toBe(false);
    expect(sanitized?.safe).toEqual({ ok: 1 });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("cleanOptionalKoreanMobile (알림톡/문자 채널 번호 정규화)", () => {
  it("하이픈·공백 입력을 숫자만으로 정규화한다", () => {
    expect(cleanOptionalKoreanMobile("010-1234-5678")).toBe("01012345678");
    expect(cleanOptionalKoreanMobile("010 1234 5678")).toBe("01012345678");
    expect(cleanOptionalKoreanMobile("01012345678")).toBe("01012345678");
  });

  it("구형 번호(011 등, 7자리 국번)도 허용한다", () => {
    expect(cleanOptionalKoreanMobile("011-123-4567")).toBe("0111234567");
  });

  it("빈 입력은 삭제 의도(null)", () => {
    expect(cleanOptionalKoreanMobile("")).toBeNull();
    expect(cleanOptionalKoreanMobile(null)).toBeNull();
    expect(cleanOptionalKoreanMobile(undefined)).toBeNull();
    expect(cleanOptionalKoreanMobile("---")).toBeNull();
  });

  it("형식 오류는 undefined (일반전화·짧은 번호·문자열 아님)", () => {
    expect(cleanOptionalKoreanMobile("02-1234-5678")).toBeUndefined();
    expect(cleanOptionalKoreanMobile("010-123")).toBeUndefined();
    expect(cleanOptionalKoreanMobile("010123456789")).toBeUndefined();
    expect(cleanOptionalKoreanMobile(1012345678)).toBeUndefined();
  });
});

describe("readBoundedUtf8Text", () => {
  it("cancels a chunked body as soon as its byte limit is exceeded", async () => {
    let pullCount = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) controller.enqueue(new Uint8Array(4_096));
        else if (pullCount === 2) controller.enqueue(new Uint8Array([1]));
        else controller.enqueue(new Uint8Array(1_000_000));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const request = {
      body,
      headers: new Headers(),
    } as Request;

    await expect(readBoundedUtf8Text(request, 4_096)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(cancelled).toBe(true);
    expect(pullCount).toBe(2);
  });

  it("decodes a bounded multi-byte UTF-8 body without changing its bytes", async () => {
    const text = JSON.stringify({ message: "안녕하세요" });
    const request = new Request("https://hanbang.ai/test", {
      method: "POST",
      body: text,
    });

    await expect(readBoundedUtf8Text(request, 1_024)).resolves.toEqual({
      ok: true,
      text,
    });
  });
});

describe("readBoundedJsonValue", () => {
  it("rejects a content-length-less chunked JSON body before buffering a later chunk", async () => {
    let pullCount = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) controller.enqueue(new Uint8Array(2_048));
        else if (pullCount === 2) controller.enqueue(new Uint8Array([1]));
        else controller.enqueue(new Uint8Array(1_000_000));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const request = {
      body,
      headers: new Headers(),
    } as Request;

    await expect(readBoundedJsonValue(request, 2_048)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(cancelled).toBe(true);
    expect(pullCount).toBe(2);
  });

  it("distinguishes malformed bounded JSON from an oversized body", async () => {
    const request = new Request("https://hanbang.ai/test", {
      method: "POST",
      body: "{not-json",
    });

    await expect(readBoundedJsonValue(request, 1_024)).resolves.toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
