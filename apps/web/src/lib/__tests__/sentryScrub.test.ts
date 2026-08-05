import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sanitizeSentryBreadcrumb,
  sanitizeSentryEvent,
  sanitizeSentryTransaction,
  type ScrubbableBreadcrumb,
  type ScrubbableEvent,
  type ScrubbableTransaction,
} from "@hanbang/shared";

// P1-08: 모바일 Sentry에는 원문 scrubber가 있는데 웹에는 없다. 웹의 공용 로거는
// `extra: { msg, payload: err }`로 **임의 payload를 통째로** 외부 서비스에 보낸다.
// 호출자가 대화·개인정보·토큰을 담으면 그대로 나간다.
//
// 목표 아키텍처 §6 불변식 9: 로그·분석·오류·push·URL에 대화·첨부 원문을 넣지 않는다.
//
// 규칙을 복사하지 않고 `@hanbang/shared`로 올려 웹·모바일이 한 규칙을 쓰게 한다.
// 두 벌이면 한쪽만 고쳐진다(P0-1/P0-2에서 확인한 패턴).
//
// 합성 표식만 사용한다.

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const APP_ROOT = resolve(WEB_ROOT, "..");

const SYNTHETIC_SECRET = "SYNTHETIC-P108-PRIVATE-PAYLOAD";

function read(relative: string): string {
  return readFileSync(resolve(APP_ROOT, relative), "utf8");
}

describe("shared Sentry scrubber", () => {
  it("drops the arbitrary extra payload the web logger attaches", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      extra: { msg: "failed", payload: { note: SYNTHETIC_SECRET } },
      user: { id: "user-1", email: "a@b.com" },
      request: { url: "https://hanbang.ai/chat?q=secret" },
    });

    expect(JSON.stringify(event)).not.toContain(SYNTHETIC_SECRET);
    expect(event.extra).toBeUndefined();
    expect(event.user).toBeUndefined();
    expect(event.request).toBeUndefined();
  });

  it("redacts identifiers that show up inside free text", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      message: "문의: hong@example.com 010-1234-5678 https://hanbang.ai/x",
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("hong@example.com");
    expect(serialized).not.toContain("010-1234-5678");
    expect(serialized).not.toContain("hanbang.ai/x");
  });

  it("redacts exception values, not just the top-level message", () => {
    const event = sanitizeSentryEvent<ScrubbableEvent>({
      exception: { values: [{ value: `보안키 sk_${"a".repeat(20)} 유출` }] },
    });

    expect(JSON.stringify(event)).not.toContain("sk_aaaaaaaaaaaaaaaaaaaa");
  });

  it("strips breadcrumb data, which carries request bodies", () => {
    const crumb = sanitizeSentryBreadcrumb<ScrubbableBreadcrumb>({
      message: "요청 실패 hong@example.com",
      data: { body: SYNTHETIC_SECRET },
    });

    // data는 통째로 버린다 — 요청 본문과 상태가 실리는 자리다.
    expect(crumb.data).toBeUndefined();
    expect(JSON.stringify(crumb)).not.toContain(SYNTHETIC_SECRET);
    // message는 식별자 패턴만 마스킹한다. 임의 문장까지 지우지는 못하며,
    // 그래서 data·extra를 남기지 않는 쪽이 실제 방어선이다.
    expect(JSON.stringify(crumb)).not.toContain("hong@example.com");
  });

  it("strips span descriptions and data on transactions", () => {
    const event = sanitizeSentryTransaction<ScrubbableTransaction>({
      extra: { payload: SYNTHETIC_SECRET },
      spans: [{ description: `GET https://hanbang.ai/${SYNTHETIC_SECRET}`, data: { q: SYNTHETIC_SECRET } }],
    });

    expect(JSON.stringify(event)).not.toContain(SYNTHETIC_SECRET);
  });

  it("does not throw on the empty shapes a real SDK can hand it", () => {
    for (const shape of [{}, { breadcrumbs: [] }, { exception: {} }, { spans: [] }]) {
      expect(() => sanitizeSentryEvent(shape as ScrubbableTransaction)).not.toThrow();
      expect(() => sanitizeSentryTransaction(shape as ScrubbableTransaction)).not.toThrow();
    }
  });
});

// scrubber가 있어도 Sentry.init에 연결하지 않으면 아무것도 막지 못한다.
describe("every web Sentry entry point installs the scrubber", () => {
  it.each([
    ["server", "web/sentry.server.config.ts"],
    ["edge", "web/sentry.edge.config.ts"],
    ["client", "web/src/instrumentation-client.ts"],
  ])("%s config filters events before they leave", (_label, relative) => {
    const source = read(relative);
    expect(source).toMatch(/beforeSend/u);
    expect(source).toMatch(/sanitizeSentryEvent/u);
  });

  it("also filters breadcrumbs and transactions where the SDK supports it", () => {
    const server = read("web/sentry.server.config.ts");
    expect(server).toMatch(/beforeBreadcrumb/u);
    expect(server).toMatch(/sanitizeSentryBreadcrumb/u);
  });

  it("keeps mobile on the same shared rule instead of a private copy", () => {
    const mobile = read("mobile/src/lib/sentryPrivacy.ts");
    expect(mobile).toMatch(/@hanbang\/shared/u);
    // 로직이 두 벌로 갈라지면 한쪽만 고쳐진다.
    expect(mobile).not.toMatch(/function redactText/u);
  });
});
