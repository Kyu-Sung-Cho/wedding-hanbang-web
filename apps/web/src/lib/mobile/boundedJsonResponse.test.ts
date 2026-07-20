import { describe, expect, it } from "vitest";

import {
  MAX_MOBILE_BRIDGE_RESPONSE_BYTES,
  MOBILE_BRIDGE_RESPONSE_BYTES_HEADER,
  mobileBridgeJson,
} from "./boundedJsonResponse";

describe("mobileBridgeJson", () => {
  it("declares the exact UTF-8 bytes for React Native non-streaming fetch", async () => {
    const response = mobileBridgeJson(
      { message: "안녕" },
      { status: 201, headers: { Vary: "Authorization" } },
    );

    const body = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("vary")).toBe("Authorization");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(Number(response.headers.get(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER))).toBe(
      new TextEncoder().encode(body).byteLength,
    );
  });

  it("fails explicitly instead of emitting a body above the bridge cap", async () => {
    const response = mobileBridgeJson({ value: "x".repeat(MAX_MOBILE_BRIDGE_RESPONSE_BYTES) });

    expect(response.status).toBe(507);
    await expect(response.json()).resolves.toEqual({
      error: "응답이 너무 커서 안전하게 전송할 수 없습니다.",
    });
    expect(Number(response.headers.get(MOBILE_BRIDGE_RESPONSE_BYTES_HEADER))).toBeLessThan(
      MAX_MOBILE_BRIDGE_RESPONSE_BYTES,
    );
  });
});
