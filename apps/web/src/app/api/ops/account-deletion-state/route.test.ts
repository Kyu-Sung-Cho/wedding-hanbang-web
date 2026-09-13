// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const forbidden = vi.hoisted(() => ({ admin: vi.fn(), worker: vi.fn(), intake: vi.fn(), serverClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: forbidden.serverClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: forbidden.admin }));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({
  processAccountDeletionJob: forbidden.worker,
  requestAccountDeletion: forbidden.intake,
}));

import { GET } from "./route";
import { proxy } from "@/proxy";

const SECRET = "synthetic-cron-proof-secret";
const SHA = "a".repeat(40);
const NOW = "2026-09-13T08:40:00.000Z";
const fetchMock = vi.fn(() => { throw new Error("Unexpected network access"); });
const request = (authorization: string | null = `Bearer ${SECRET}`, headers: Record<string, string> = {}) =>
  new Request("https://hanbang.ai/api/ops/account-deletion-state", {
    headers: { ...(authorization === null ? {} : { authorization }), ...headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA);
  vi.stubEnv("ACCOUNT_DELETION_INTAKE_ENABLED", "false");
  vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", "false");
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  expect(fetchMock).not.toHaveBeenCalled();
  expect(forbidden.admin).not.toHaveBeenCalled();
  expect(forbidden.worker).not.toHaveBeenCalled();
  expect(forbidden.intake).not.toHaveBeenCalled();
  expect(forbidden.serverClient).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  expect(response.headers.get("vary")).toBe("Authorization");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("expires")).toBe("0");
  expect(response.headers.has("etag")).toBe(false);
}

describe("authenticated account-deletion runtime observation", () => {
  it("passes the real proxy and session middleware without Auth/DB work even during a production write fence", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "false");
    vi.stubEnv("WEDDING_CODE_RESEARCH_PREVIEW", "false");
    vi.stubEnv("PRODUCTION_WRITE_FENCE_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-avatar-fixture.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-public-placeholder");
    const incoming = new NextRequest(request());
    const middleware = await proxy(incoming);
    expect(middleware.headers.get("x-middleware-next")).toBe("1");
    expect(middleware.headers.has("set-cookie")).toBe(false);
    const result = await GET(incoming);
    expect(result.status).toBe(200);
    expectPrivate(result);
  });

  it.each([null, "", SECRET, `bearer ${SECRET}`, "Bearer incorrect", `Bearer ${SECRET}, Bearer other`])(
    "denies missing or different bearer credentials without exposing state: %s", async authorization => {
      const result = await GET(request(authorization));
      expect(result.status).toBe(401);
      expect(await result.json()).toEqual({ error: "Unauthorized" });
      expectPrivate(result);
    },
  );

  it.each([undefined, ""])("denies every request when CRON_SECRET is unavailable: %s", async value => {
    vi.stubEnv("CRON_SECRET", value);
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "Unauthorized" });
    expectPrivate(result);
  });

  it("does not accept a secret supplied only through URL or cookies", async () => {
    const result = await GET(new Request(`https://hanbang.ai/api/ops/account-deletion-state?token=${SECRET}`, {
      headers: { cookie: `CRON_SECRET=${SECRET}` },
    }));
    expect(result.status).toBe(401);
    expectPrivate(result);
  });

  it.each([
    { intake: "true", cron: "true", expected: [true, true] },
    { intake: "true", cron: "false", expected: [true, false] },
    { intake: "false", cron: "true", expected: [false, true] },
    { intake: undefined, cron: undefined, expected: [false, false] },
    { intake: "TRUE", cron: "1", expected: [false, false] },
    { intake: " true ", cron: "true\n", expected: [false, false] },
  ])("reports only the exact active flag semantics: $intake / $cron", async ({ intake, cron, expected }) => {
    vi.stubEnv("ACCOUNT_DELETION_INTAKE_ENABLED", intake);
    vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", cron);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unrelated-private-provider-value");
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ commit: SHA, observedAt: NOW, flags: {
      ACCOUNT_DELETION_INTAKE_ENABLED: expected[0], ACCOUNT_DELETION_CRON_ENABLED: expected[1],
    } });
    expectPrivate(result);
  });

  it.each([undefined, "", "abc1234", "z".repeat(40), "not-a-commit-private-value"])(
    "reports an unavailable deployment commit as null without inventing a pin: %s", async value => {
      vi.stubEnv("VERCEL_GIT_COMMIT_SHA", value);
      const result = await GET(request());
      expect(result.status).toBe(200);
      expect((await result.json()).commit).toBeNull();
    },
  );

  it("normalizes a complete hexadecimal commit without truncating it", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", SHA.toUpperCase());
    expect((await (await GET(request())).json()).commit).toBe(SHA);
  });

  it("observes runtime changes on every request and never honors client cache freshness", async () => {
    const before = await GET(request());
    expect((await before.json()).observedAt).toBe(NOW);
    vi.setSystemTime("2026-09-13T08:40:01.000Z");
    vi.stubEnv("ACCOUNT_DELETION_INTAKE_ENABLED", "true");
    const after = await GET(request(`Bearer ${SECRET}`, {
      "if-none-match": "previous-response", "if-modified-since": "Mon, 01 Jan 2040 00:00:00 GMT",
    }));
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ commit: SHA, observedAt: "2026-09-13T08:40:01.000Z", flags: {
      ACCOUNT_DELETION_INTAKE_ENABLED: true, ACCOUNT_DELETION_CRON_ENABLED: false,
    } });
    expectPrivate(after);
  });

  it("does not reuse a prior authorized observation after the runtime secret changes", async () => {
    expect((await GET(request())).status).toBe(200);
    vi.stubEnv("CRON_SECRET", "changed-synthetic-secret");
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "Unauthorized" });
    expectPrivate(result);
  });
});
