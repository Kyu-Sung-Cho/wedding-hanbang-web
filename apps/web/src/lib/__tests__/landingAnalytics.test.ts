import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Capture = {
  event: string;
  properties: Record<string, unknown>;
  timestamp?: Date;
  uuid?: string;
  $set_once?: Record<string, unknown>;
};

const sink = vi.hoisted(() => ({
  beforeSend: undefined as ((capture: Capture) => Capture | null) | undefined,
  sent: [] as Capture[],
  raw: [] as Capture[],
  options: [] as Array<{ timestamp?: Date } | undefined>,
}));

vi.mock("posthog-js", () => ({
  default: {
    init: (_key: string, options: { before_send: (capture: Capture) => Capture | null }) => {
      sink.beforeSend = options.before_send;
    },
    capture: (event: string, properties: Record<string, unknown>, options?: { timestamp?: Date }) => {
      sink.options.push(options);
      // SDK가 지연 초기화 시 붙이는 도착 화면과 최초 방문 원문도 함께 재현한다.
      const raw: Capture = {
        event,
        uuid: "synthetic-event",
        timestamp: options?.timestamp ?? new Date(),
        $set_once: { $initial_current_url: window.location.href, unsafe_note: "synthetic-private" },
        properties: {
          token: "test-public-key",
          distinct_id: "synthetic-browser",
          $session_id: "synthetic-session",
          $window_id: "synthetic-window",
          $process_person_profile: false,
          $current_url: window.location.href,
          $pathname: window.location.pathname,
          $referrer: window.location.pathname === "/wedding-code"
            ? "https://hanbang.ai/wedding-code#a=synthetic-answer"
            : `${window.location.origin}/landing`,
          $set_once: { $initial_current_url: window.location.href },
          $unexpected_private: "synthetic-private",
          ...properties,
        },
      };
      sink.raw.push(raw);
      const safe = sink.beforeSend?.(raw);
      if (safe) sink.sent.push(safe);
    },
  },
}));

describe("landing measurements across delayed analytics initialization", () => {
  let idle: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-public-key");
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => { idle = callback; });
    vi.setSystemTime(new Date("2026-09-21T03:00:00Z"));
    window.history.replaceState({}, "", "/landing?utm_source=synthetic-campaign");
    sink.beforeSend = undefined;
    sink.sent.length = 0;
    sink.raw.length = 0;
    sink.options.length = 0;
    idle = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  async function settle() {
    idle?.();
    // 동적 모듈은 모의 SDK만 불러오며 외부 요청은 하지 않는다.
    await vi.waitFor(() => expect(sink.beforeSend).toBeTypeOf("function"));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  it("keeps the landing visit and fast click in observation order without carrying the destination answer", async () => {
    const analytics = await import("../analytics");
    analytics.capturePageview({ $current_url: window.location.href });
    vi.setSystemTime(new Date("2026-09-21T03:00:01Z"));
    analytics.captureEvent("landing_cta_click", { source: "landing_hero_secondary" });
    window.history.replaceState({}, "", "/wedding-code?v=old&a=synthetic-answer#b=synthetic-partner");
    vi.setSystemTime(new Date("2026-09-21T03:00:05Z"));
    await settle();

    expect(sink.sent.map(({ event }) => event)).toEqual(["$pageview", "landing_cta_click"]);
    expect(sink.options.map((options) => options?.timestamp?.toISOString())).toEqual([
      "2026-09-21T03:00:00.000Z", "2026-09-21T03:00:01.000Z",
    ]);
    for (const capture of sink.sent) {
      expect(capture.properties.$current_url).toBe(`${window.location.origin}/landing`);
      expect(capture.properties.$pathname).toBe("/landing");
      expect(capture.properties.$session_id).toBe("synthetic-session");
      expect(capture.properties.distinct_id).toBe("synthetic-browser");
      expect(capture.properties.$process_person_profile).toBe(false);
      expect(Object.keys(capture).sort()).toEqual(["event", "properties", "timestamp", "uuid"]);
      const serialized = JSON.stringify(capture);
      for (const secret of ["synthetic-answer", "synthetic-partner", "synthetic-private", "utm_source", "$set_once", "wedding-code"]) {
        expect(serialized).not.toContain(secret);
      }
    }
    expect(sink.sent[1].properties.source).toBe("landing_hero_secondary");
    // SDK 호출이 끝난 표식으로 같은 이벤트를 재전송할 수 없다.
    expect(sink.beforeSend?.(sink.raw[1])).toBeNull();
  });

  it("does not turn WeddingCode pageviews or forged landing clicks into an exception", async () => {
    const analytics = await import("../analytics");
    window.history.replaceState({}, "", "/wedding-code#a=synthetic-answer");
    analytics.captureEvent("landing_cta_click", { source: "landing_hero_secondary", $current_url: `${window.location.origin}/landing` });
    analytics.capturePageview({ $current_url: `${window.location.origin}/wedding-code#a=synthetic-answer` });
    analytics.captureEvent("$pageleave", {});
    analytics.captureWeddingCodeEvent("wedding_code_started", { version: "v1.2-code" });
    await settle();
    expect(sink.sent).toEqual([]);
  });

  it("drops non-allowlisted sources and extra caller content", async () => {
    const analytics = await import("../analytics");
    analytics.captureEvent("landing_cta_click", { source: "synthetic-private" });
    analytics.captureEvent("landing_cta_click", {
      source: "landing_hero_secondary", answers: "synthetic-answer", $unsafe: "synthetic-private",
    });
    await settle();
    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0].properties.source).toBe("landing_hero_secondary");
    expect(JSON.stringify(sink.sent)).not.toContain("synthetic-answer");
    expect(JSON.stringify(sink.sent)).not.toContain("synthetic-private");
  });

  it("preserves ordinary pageviews without assigning them to the landing", async () => {
    const analytics = await import("../analytics");
    window.history.replaceState({}, "", "/login?mode=signup");
    analytics.capturePageview({ $current_url: window.location.href });
    await settle();
    expect(sink.sent).toHaveLength(1);
    expect(sink.sent[0].properties.$current_url).toBe(`${window.location.origin}/login?mode=signup`);
    expect(sink.sent[0].properties.$pathname).toBe("/login");
  });
});
