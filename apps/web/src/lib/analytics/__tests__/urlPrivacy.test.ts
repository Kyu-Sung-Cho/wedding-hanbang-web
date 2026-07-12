import { describe, expect, it } from "vitest";
import {
  redactSensitiveAnalyticsCapture,
  redactSensitiveNetworkCapture,
  redactSensitiveUrl,
} from "../urlPrivacy";

describe("analytics URL privacy", () => {
  it("redacts capability and auth values while preserving attribution", () => {
    const result = redactSensitiveUrl(
      "https://hanbang.ai/wedding-code?ct=secret&code=oauth&token=session&utm_source=kakao"
    );

    expect(result).not.toContain("secret");
    expect(result).not.toContain("oauth");
    expect(result).not.toContain("session");
    expect(result).toContain("ct=%5BREDACTED%5D");
    expect(result).toContain("utm_source=kakao");
  });

  it("redacts hash-based auth values and relative invite URLs", () => {
    expect(redactSensitiveUrl("/wedding-code?ct=secret#result")).toBe(
      "/wedding-code?ct=%5BREDACTED%5D#result"
    );
    expect(redactSensitiveUrl("#/auth?access_token=secret&next=%2Fhome")).toBe(
      "#/auth?access_token=%5BREDACTED%5D&next=%2Fhome"
    );
    expect(redactSensitiveUrl("https://hanbang.ai/beta/verify#token=capability")).toBe(
      "https://hanbang.ai/beta/verify#token=%5BREDACTED%5D"
    );
  });

  it("scrubs pageleave and nested replay properties without mutating the input", () => {
    const capture = {
      event: "$snapshot",
      properties: {
        $current_url: "https://hanbang.ai/wedding-code?ct=secret",
        $snapshot_data: {
          data: { href: "https://hanbang.ai/wedding-code?ct=secret" },
        },
        couple_token: "223e4567-e89b-42d3-a456-426614174000",
      },
    };

    const result = redactSensitiveAnalyticsCapture(capture);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("223e4567");
    expect(capture.properties.$current_url).toContain("secret");
  });

  it("leaves ordinary text and safe URLs unchanged", () => {
    expect(redactSensitiveUrl("결혼 준비 코드를 함께 확인해요")).toBe(
      "결혼 준비 코드를 함께 확인해요"
    );
    expect(redactSensitiveUrl("https://hanbang.ai/?utm_campaign=wc_v05")).toBe(
      "https://hanbang.ai/?utm_campaign=wc_v05"
    );
  });

  it("does not reinterpret ordinary analytics copy containing punctuation as a URL", () => {
    const capture = {
      properties: {
        prompt: "어디예요? 다음 단계도 알려주세요.",
        label: "A&B 중 어느 쪽인가요?",
      },
    };

    expect(redactSensitiveAnalyticsCapture(capture)).toEqual(capture);
  });

  it("drops WeddingCode replay bodies and redacts the captured request URL", () => {
    const result = redactSensitiveNetworkCapture({
      name: "https://hanbang.ai/api/wedding-code/couple-report?ct=secret",
      requestBody: JSON.stringify({ couple_token: "secret" }),
      responseBody: JSON.stringify({ coupleToken: "secret" }),
      requestHeaders: { authorization: "Bearer secret" },
      responseHeaders: { "set-cookie": "secret" },
    });

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.name).toContain("ct=%5BREDACTED%5D");
    expect(result.requestBody).toBeNull();
    expect(result.responseBody).toBeNull();
  });
});
