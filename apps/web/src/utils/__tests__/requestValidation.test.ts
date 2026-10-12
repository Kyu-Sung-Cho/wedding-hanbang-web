import { describe, expect, it } from "vitest";
import {
  cleanOptionalKoreanMobile,
  readBoundedUtf8Text,
} from "../requestValidation";

function streamedRequest(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
  const init: RequestInit & { duplex: "half" } = { method: "POST", body, headers, duplex: "half" };
  return new Request("https://hanbang.ai/test", init);
}

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
    const request = streamedRequest(body);

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

  it("preserves UTF-8 characters split across individual byte chunks", async () => {
    const text = "안녕😀";
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });

    await expect(readBoundedUtf8Text(streamedRequest(body), bytes.byteLength)).resolves.toEqual({ ok: true, text });
    expect(body.locked).toBe(false);
  });

  it.each([undefined, "1", "not-a-number"])("counts actual streamed bytes when Content-Length is %s", async (contentLength) => {
    let pullCount = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) controller.enqueue(new Uint8Array(9));
        else throw new Error("TAIL_MUST_NOT_BE_READ");
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });

    await expect(readBoundedUtf8Text(streamedRequest(body, contentLength === undefined ? {} : { "Content-Length": contentLength }), 8)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(pullCount).toBe(1);
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });

  it("rejects an oversized declared body without reading or locking its stream", async () => {
    let read = false;
    const body = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("DECLARED_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    await expect(readBoundedUtf8Text(streamedRequest(body, { "Content-Length": "9" }), 8)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(read).toBe(false);
    expect(body.locked).toBe(false);
  });

  it("fails closed even when cancellation itself rejects", async () => {
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { pullCount += 1; controller.enqueue(new Uint8Array(9)); },
      cancel() { throw new Error("PRIVATE_CANCEL_DIAGNOSTIC"); },
    }, { highWaterMark: 0 });

    await expect(readBoundedUtf8Text(streamedRequest(body), 8)).resolves.toEqual({ ok: false, reason: "too_large" });
    expect(pullCount).toBe(1);
    expect(body.locked).toBe(false);
  });

  it.each(["invalid UTF-8", "stream error"])("returns a generic bounded failure for %s", async (failure) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        if (failure === "stream error") controller.error(new Error("PRIVATE_STREAM_DIAGNOSTIC"));
        else { controller.enqueue(new Uint8Array([0xc3, 0x28])); controller.close(); }
      },
    });

    await expect(readBoundedUtf8Text(streamedRequest(body), 8)).resolves.toEqual({ ok: false, reason: "read_error" });
    expect(body.locked).toBe(false);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte limit %s before reading the body", async (maxBytes) => {
    let read = false;
    const body = new ReadableStream<Uint8Array>({ pull() { read = true; throw new Error("INVALID_LIMIT_BODY_MUST_NOT_BE_READ"); } }, { highWaterMark: 0 });

    await expect(readBoundedUtf8Text(streamedRequest(body), maxBytes)).resolves.toEqual({ ok: false, reason: "read_error" });
    expect(read).toBe(false);
    expect(body.locked).toBe(false);
  });

  it.each([undefined, ""])("accepts an empty body at a zero-byte limit", async (body) => {
    const request = new Request("https://hanbang.ai/test", { method: "POST", body });

    await expect(readBoundedUtf8Text(request, 0)).resolves.toEqual({ ok: true, text: "" });
  });

  it("rejects a nonempty body at a zero-byte limit", async () => {
    const request = new Request("https://hanbang.ai/test", { method: "POST", body: "x" });

    await expect(readBoundedUtf8Text(request, 0)).resolves.toEqual({ ok: false, reason: "too_large" });
  });
});
