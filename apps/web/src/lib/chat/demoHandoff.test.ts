import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildStartHereSignupHref,
  buildStartHereAmoraPrefill,
  consumeDemoAmoraPrefill,
  createDemoAmoraHandoffId,
  DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY,
  DEMO_AMORA_PREFILL_STORAGE_KEY,
  forgetDemoAmoraPrefill,
  getStartHereHandoffIdFromRedirect,
  readDemoAmoraPrefill,
  rememberDemoAmoraPrefill,
} from "./demoHandoff";

const HANDOFF_ID = "0f75ca2a-94c1-4d9c-83e3-a45981c98673";
const OTHER_HANDOFF_ID = "ed7eb66a-f86d-45e9-a8bb-9db39c3a9c17";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("demo Amora handoff", () => {
  afterEach(() => vi.useRealTimers());

  it("builds a calm first question from the visitor's date and visible priorities", () => {
    const prefill = buildStartHereAmoraPrefill({
      weddingDate: "2027-05-01",
      preparationStyle: "small",
      focusLabels: ["상견례", "결혼식장", "사진 촬영"],
    });

    expect(prefill).toContain("결혼식 날짜는 2027-05-01");
    expect(prefill).toContain("결혼식은 작게 준비하려고 해요");
    expect(prefill).toContain("상견례·결혼식장·사진 촬영");
    expect(prefill).toContain("이번 주에 할 한 가지만");
    expect(prefill).toContain("저장하기 전에 보여주세요");
  });

  it("describes the broad-preparation choice without calling it normal", () => {
    const prefill = buildStartHereAmoraPrefill({
      weddingDate: "2027-05-01",
      preparationStyle: "standard",
      focusLabels: ["예산"],
    });

    expect(prefill).toContain("필요한 준비 항목은 넓게 살펴보고 싶어요");
    expect(prefill).not.toContain("일반적인 결혼 준비");
  });

  it("keeps a direct-demo envelope until chat consumes it once", () => {
    const storage = memoryStorage();
    rememberDemoAmoraPrefill(storage, "  먼저 할 일 하나를 골라줘  ");

    expect(storage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toContain(
      "먼저 할 일 하나를 골라줘",
    );
    expect(storage.getItem(DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY)).toBeNull();
    expect(readDemoAmoraPrefill(storage)).toBe("먼저 할 일 하나를 골라줘");
    expect(consumeDemoAmoraPrefill(storage)).toBe("먼저 할 일 하나를 골라줘");
    expect(readDemoAmoraPrefill(storage)).toBeNull();
  });

  it("binds a signup draft to the nonce carried inside the safe chat redirect", () => {
    const storage = memoryStorage();
    rememberDemoAmoraPrefill(storage, "가입 전에 고른 질문", HANDOFF_ID);

    const href = buildStartHereSignupHref(HANDOFF_ID);
    const loginUrl = new URL(href, "https://hanbang.ai");
    const redirect = loginUrl.searchParams.get("redirect");

    expect(loginUrl.pathname).toBe("/login");
    expect(loginUrl.searchParams.get("source")).toBe("start-here");
    expect(redirect).toBe(`/wedding/chat?startHereHandoff=${HANDOFF_ID}`);
    expect(getStartHereHandoffIdFromRedirect(redirect)).toBe(HANDOFF_ID);
    expect(readDemoAmoraPrefill(storage, HANDOFF_ID)).toBe("가입 전에 고른 질문");
  });

  it("purges a signup draft when the redirect nonce is absent or does not match", () => {
    const withoutMarker = memoryStorage();
    rememberDemoAmoraPrefill(withoutMarker, "다른 방문자의 질문", HANDOFF_ID);
    expect(readDemoAmoraPrefill(withoutMarker)).toBeNull();
    expect(withoutMarker.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();

    const mismatched = memoryStorage();
    rememberDemoAmoraPrefill(mismatched, "다른 방문자의 질문", HANDOFF_ID);
    expect(readDemoAmoraPrefill(mismatched, OTHER_HANDOFF_ID)).toBeNull();
    expect(mismatched.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
  });

  it("creates an unguessable UUID handoff when Web Crypto is available", () => {
    expect(createDemoAmoraHandoffId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("removes a browser-tab handoff after thirty minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T10:00:00+09:00"));
    const storage = memoryStorage();
    rememberDemoAmoraPrefill(storage, "이번 주에 할 일 하나");

    vi.setSystemTime(new Date("2026-08-02T10:31:00+09:00"));
    expect(readDemoAmoraPrefill(storage)).toBeNull();
    expect(storage.getItem(DEMO_AMORA_PREFILL_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(DEMO_AMORA_PREFILL_CREATED_AT_STORAGE_KEY)).toBeNull();
  });

  it("keeps the demo usable when browser storage is unavailable", () => {
    const blockedStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };

    expect(() => rememberDemoAmoraPrefill(blockedStorage, "질문")).not.toThrow();
    expect(readDemoAmoraPrefill(blockedStorage)).toBeNull();
    expect(() => forgetDemoAmoraPrefill(blockedStorage)).not.toThrow();
  });
});
