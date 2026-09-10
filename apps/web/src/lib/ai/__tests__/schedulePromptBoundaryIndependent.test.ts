import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAmoraWeddingContext } from "../amoraWeddingContext";
import { buildAmoraSystemPrompt } from "../amoraPromptComposer";
import { classifyAmoraQuestionScope } from "../amoraQuestionScope";

afterEach(() => vi.useRealTimers());

function canonicalTime(time: unknown) {
  return resolveAmoraWeddingContext({
    canonicalJourney: { progress: { __events: [{ id: "independent-time", title: "CANONICAL_TIMED_EVENT", date: "2026-09-14", time }] } },
    clientContext: { progress: { __events: [{ id: "independent-time", title: "CLIENT_STALE_EVENT", date: "2026-09-14", time: "19:30" }] } },
    allowClientContext: false,
  });
}

function freezeToday() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T07:00:00Z"));
}

describe("schedule prompt boundaries independently retain only exact server times", () => {
  it.each([" 19:45", "19:45 ", "\t19:45", "19:45\n", "19:45\r", "19:45\r\n", "19:45\u2028", "19:45\u2029"])(
    "does not promote surrounding whitespace in %j to a current saved time", time => {
      freezeToday();
      const context = canonicalTime(time);
      expect(context.scheduleEvents[0]).not.toHaveProperty("time");
      const prompt = buildAmoraSystemPrompt({
        ...context, preferences: context.preferences ?? undefined,
        brideName: null, groomName: null, senderName: "검증", bookings: [], chatSummaries: [],
      }, { requestKind: "chat", persistenceMode: "durable", enabledToolNames: [] });
      const current = prompt.split("\n").find(line => line.includes('"independent-time"='));
      expect(current).toContain("시간 미정");
      expect(current).not.toContain("19:45");
      expect(prompt).not.toContain("CLIENT_STALE_EVENT");
    },
  );

  it.each([
    ["W0_wedding_core", "현재 결혼 준비 일정을 확인해줘", true],
    ["W1_wedding_adjacent", "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어", true],
    ["W2_high_risk_adjacent", "예식장 계약이 법적으로 무효인지 판정해줘", false],
    ["W3_social_care", "그냥 오늘 너무 힘들어", false],
    ["W4_out_of_scope", "주식 투자 예산을 3천만원으로 바꿔줘", false],
    ["W5_safety_override", "지금 죽고 싶어요", false],
  ] as const)("preserves the existing stored-context boundary for %s", (scope, userText, includesSchedule) => {
    freezeToday();
    const questionScope = classifyAmoraQuestionScope({ userText, requestKind: "chat" });
    expect(questionScope.scope).toBe(scope);
    const context = canonicalTime("19:45");
    const prompt = buildAmoraSystemPrompt({
      ...context, preferences: context.preferences ?? undefined,
      brideName: null, groomName: null, senderName: "검증", bookings: [],
      chatSummaries: ["STALE_HISTORY_EVENT_TIME 19:30"],
    }, { requestKind: "chat", persistenceMode: "durable", questionScope, enabledToolNames: [] });
    if (includesSchedule) {
      const current = prompt.split("\n").find(line => line.includes('"independent-time"='));
      expect(current).toContain("시간 19:45");
      expect(current).not.toContain("19:30");
      expect(prompt).toContain("현재 저장값");
    } else {
      expect(prompt).not.toContain("CANONICAL_TIMED_EVENT");
      expect(prompt).not.toContain("19:45");
      expect(prompt).not.toContain("STALE_HISTORY_EVENT_TIME");
    }
    expect(prompt).not.toContain("CLIENT_STALE_EVENT");
  });
});
