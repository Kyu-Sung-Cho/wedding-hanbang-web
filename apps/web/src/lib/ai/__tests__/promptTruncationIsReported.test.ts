import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessage(...args),
}));

import {
  buildAmoraSystemPrompt,
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
} from "@/lib/ai/amoraPromptComposer";

/**
 * 프롬프트가 상한에 닿으면 **사람이 알아야 한다.**
 *
 * 절단은 설계된 동작이라 막지 않는다. 문제는 조용했다는 것이다 — 잘린 사실이
 * 프롬프트 안 표식으로만 남고 아무 데도 보고되지 않았다.
 *
 * 2026-09-01 실측(상한 48,000자):
 *
 *     빈 커플 · 도구 0개         42,150자   87.8%
 *     빈 커플 · 전체 도구        47,795자   99.6%   남은 자리 205자
 *     데이터 든 커플 · 전체 도구  47,990자  100.0%   남은 자리  10자
 *
 * 여유가 없다. 커플이 결정을 몇 개 더 쌓으면 넘치고, 넘치면 꼬리부터 잘리는데
 * 꼬리에는 저장된 예산·일정·결정 히스토리가 있다. 안전·카드 계약은 필수 영역으로
 * 옮겨져 살아남지만 **아모라가 커플에 대해 아는 것**은 그 보호를 못 받는다.
 */
function ctx(extra: Record<string, unknown> = {}) {
  return {
    weddingDate: "2027-05-15",
    budget: 62_000_000,
    venue: "그랜드힐컨벤션",
    progress: {},
    preparationStatus: null,
    brideName: "신부",
    groomName: "신랑",
    bookings: [],
    scheduleEvents: [],
    chatSummaries: [],
    pastConflicts: [],
    pastDecisions: [],
    ...extra,
  } as never;
}

const build = (maxChars: number, extra: Record<string, unknown> = {}) =>
  buildAmoraSystemPrompt(ctx(extra), {
    enabledToolNames: [],
    requestKind: "chat",
    persistenceMode: "durable",
    maxChars,
  } as never);

describe("프롬프트가 잘리면 알린다", () => {
  beforeEach(() => {
    captureMessage.mockClear();
  });

  it("상한을 넘으면 Sentry 로 보낸다", () => {
    const prompt = build(20_000);
    // 실제로 잘렸는지 먼저 확인한다 — 안 잘렸으면 이 검사는 아무것도 안 지킨다.
    expect(prompt).toContain("길이 제한으로 생략됨");
    expect(captureMessage).toHaveBeenCalled();

    const [message, options] = captureMessage.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toContain("amora-prompt");
    expect((options as { level?: string }).level).toBe("warning");
    const tags = (options as { tags?: Record<string, string> }).tags ?? {};
    expect(tags.amora_prompt_truncated).toBeTruthy();
    expect(Number(tags.amora_prompt_overflow_chars)).toBeGreaterThan(0);
  });

  it("자리가 넉넉하면 보내지 않는다", () => {
    build(AMORA_SYSTEM_PROMPT_MAX_CHARS * 4);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("보내는 것에 프롬프트 내용이 들어가지 않는다", () => {
    // 스크러버는 `extra` 를 버리지만 `message` 의 한국어는 안 지운다.
    // 커플 이름·예식장 같은 값이 실리면 안 된다.
    build(20_000);
    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain("그랜드힐컨벤션");
    expect(sent).not.toContain("신부");
    expect(sent).not.toContain("2027-05-15");
  });

  it("Sentry 가 던져도 프롬프트는 만들어진다", () => {
    captureMessage.mockImplementationOnce(() => { throw new Error("sentry down"); });
    expect(() => build(20_000)).not.toThrow();
    expect(build(20_000).length).toBeGreaterThan(0);
  });
});
