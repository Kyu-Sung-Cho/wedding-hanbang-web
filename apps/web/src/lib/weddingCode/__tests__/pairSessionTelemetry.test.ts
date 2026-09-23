import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizeSentryBreadcrumb, sanitizeSentryEvent, sanitizeSentryTransaction,
  type ScrubbableEvent, type ScrubbableTransaction,
} from "@hanbang/shared";
import {
  analyticsCaptureTouchesSuppressedPath, isAnalyticsSuppressedPath, sanitizeWeddingCodeFunnelCapture, stripAnalyticsUrlFragments,
} from "@/lib/analyticsPrivacy";

const OWNER = "ab".repeat(32);
const INVITE = "cd".repeat(32);
const PARTICIPANT = "ef".repeat(32);
const ROOM = "01a089ab-cdef-4123-8123-111111111111";
const ANSWER = "31_-4-4-44-4-4--444-44-444-4_u.u.u.u.u.u_p_-_p";
const URL = `https://hanbang.ai/wedding-code/together#room=${ROOM}&access=${OWNER}&invitation=${INVITE}`;
const BODY = { action: "join", roomId: ROOM, inviteToken: INVITE, participantToken: PARTICIPANT, answerCode: ANSWER };
function expectNoPrivateValues(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of [OWNER, INVITE, PARTICIPANT, ROOM, ANSWER]) expect(serialized).not.toContain(secret);
}

describe("무로그인 비교의 분석·오류 수집 경계", () => {
  it("비교 화면과 해당 링크가 남은 지연 이벤트를 페이지뷰 수집에서 제외한다", () => {
    expect(isAnalyticsSuppressedPath("/wedding-code/together")).toBe(true);
    expect(analyticsCaptureTouchesSuppressedPath(null, "/wedding-code/together")).toBe(true);
    for (const key of ["$current_url", "$referrer"]) {
      expect(analyticsCaptureTouchesSuppressedPath({ properties: { [key]: URL } }, "/landing")).toBe(true);
    }
    expectNoPrivateValues(stripAnalyticsUrlFragments({ properties: { $current_url: URL, $set_once: { $initial_current_url: URL } } }));
  });
  it("허용된 일반 웨딩코드 흐름 이벤트에서도 비교 URL과 임의 payload는 남기지 않는다", () => {
    const capture = sanitizeWeddingCodeFunnelCapture({ event: "wedding_code_comparison_viewed", properties: {
      $current_url: URL, $referrer: URL, result_kind: "couple", ownerToken: OWNER, invitation: INVITE, request: BODY, answerCode: ANSWER,
    } }, Date.parse("2026-09-25T00:00:00Z"));
    expect(capture?.properties.result_kind).toBe("couple");
    expectNoPrivateValues(capture);
  });
  it("Sentry 요청·추가정보·breadcrumb 본문과 절대 URL을 제거한다", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      request: { url: URL, data: BODY }, extra: { payload: BODY, link: URL },
      message: `POST ${URL}`, exception: { values: [{ value: `fetch ${URL}` }] },
      breadcrumbs: [{ message: `POST ${URL}`, data: { request: BODY, snapshot: { ownAnswerCode: ANSWER } } }],
    });
    expect(event.request).toBeUndefined(); expect(event.extra).toBeUndefined();
    expectNoPrivateValues(event);
    expectNoPrivateValues(sanitizeSentryBreadcrumb({ message: "POST /api/wedding-code/session", data: BODY }));
    const transaction = sanitizeSentryTransaction<ScrubbableTransaction>({
      request: { url: URL, data: BODY }, spans: [{ description: `POST ${URL}`, data: { body: BODY } }],
    });
    expectNoPrivateValues(transaction);
  });
  it("SDK 초기화가 DOM 자동수집·녹화·브라우저 영속 저장을 켜지 않는다", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/analytics.ts"), "utf8");
    expect(source).toMatch(/autocapture:\s*false/);
    expect(source).toMatch(/disable_session_recording:\s*true/);
    expect(source).toMatch(/disable_persistence:\s*true/);
    expect(source).toMatch(/advanced_disable_flags:\s*true/);
  });
});
