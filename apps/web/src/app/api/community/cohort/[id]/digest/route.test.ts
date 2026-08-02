// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClientFromRequest: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test-user`,
}));

import { GET } from "./route";

type DigestMessage = {
  id: string;
  content: string;
  author_id: string;
  thread_topic: string | null;
  created_at: string;
};

function memberQuery(active: boolean) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({
    data: active ? { id: "membership-1" } : null,
    error: null,
  }));
  return chain;
}

function messagesQuery(messages: DigestMessage[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => ({ data: messages, error: null }));
  return chain;
}

function clientFor(userId: string, messages: DigestMessage[]) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: userId } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "cohort_members") return memberQuery(true);
      if (table === "cohort_messages") return messagesQuery(messages);
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function request() {
  return new Request(
    "https://hanbang.ai/api/community/cohort/10000000-0000-4000-8000-000000000001/digest?period=week",
    { headers: { cookie: "sb-session=test" } },
  ) as Parameters<typeof GET>[0];
}

const context = {
  params: Promise.resolve({ id: "10000000-0000-4000-8000-000000000001" }),
};

describe("GET cohort digest account boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
  });

  it("returns private no-store responses and never reuses one account's digest for the next account", async () => {
    mocks.createClientFromRequest
      .mockResolvedValueOnce(clientFor("user-a", [{
        id: "message-a",
        content: "견적 가격이 궁금해요",
        author_id: "user-a",
        thread_topic: "price",
        created_at: new Date().toISOString(),
      }]))
      .mockResolvedValueOnce(clientFor("user-b", []));

    const first = await GET(request(), context);
    const second = await GET(request(), context);
    const firstBody = await first.json();
    const secondBody = await second.json();

    for (const response of [first, second]) {
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store, max-age=0, must-revalidate",
      );
      expect(response.headers.get("vary")).toBe("Cookie, Authorization");
    }
    expect(firstBody.messageCount).toBe(1);
    expect(secondBody.messageCount).toBe(0);
    expect(secondBody.empty).toBe(true);
    expect(mocks.createClientFromRequest).toHaveBeenCalledTimes(2);
  });

  it("also marks authentication failures private and uncacheable", async () => {
    mocks.createClientFromRequest.mockResolvedValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    });

    const response = await GET(request(), context);

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0, must-revalidate",
    );
    expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  });

  it("forces every known digest caller to bypass the browser HTTP cache", () => {
    const callers = [
      resolve(process.cwd(), "src/app/(app)/lounge/page.tsx"),
      resolve(process.cwd(), "src/app/(community)/community/cohort/[id]/page.tsx"),
    ];

    for (const caller of callers) {
      const source = readFileSync(caller, "utf8");
      const digestCall = source.indexOf("/digest?period=");
      expect(digestCall).toBeGreaterThanOrEqual(0);
      expect(source.slice(digestCall, digestCall + 320)).toContain('cache: "no-store"');
    }
  });
});
