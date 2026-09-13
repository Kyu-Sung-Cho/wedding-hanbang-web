// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const forbidden = vi.hoisted(() => ({ admin: vi.fn(), worker: vi.fn(), intake: vi.fn(), serverClient: vi.fn() }));
const userSession = vi.hoisted(() => ({ getUser: vi.fn(), createClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: forbidden.serverClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: forbidden.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: userSession.createClient }));
vi.mock("@/lib/accountDeletion/communityStorageSaga", () => ({
  processAccountDeletionJob: forbidden.worker,
  requestAccountDeletion: forbidden.intake,
}));

import { GET } from "./route";
import { GET as deletionCron } from "@/app/api/cron/account-deletion/route";
import { DELETE as deletionIntake } from "@/app/api/auth/delete/route";
import { proxy } from "@/proxy";

const SECRET = "synthetic-cron-proof-secret";
const STATE_SECRET = "synthetic-readonly-state-secret";
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
  vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", undefined);
  userSession.getUser.mockResolvedValue({ data: { user: null }, error: null });
  userSession.createClient.mockResolvedValue({ auth: { getUser: userSession.getUser } });
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
  it.each([undefined, SECRET])("allows the separate state credential without changing the legacy cron credential: %s", async cron => {
    vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", STATE_SECRET);
    vi.stubEnv("CRON_SECRET", cron);
    const result = await GET(request(`Bearer ${STATE_SECRET}`));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ commit: SHA, observedAt: NOW, flags: {
      ACCOUNT_DELETION_INTAKE_ENABLED: false, ACCOUNT_DELETION_CRON_ENABLED: false,
    } });
    expectPrivate(result);
    expect(userSession.createClient).not.toHaveBeenCalled();
    expect(process.env.CRON_SECRET).toBe(cron);
    if (cron) expect((await GET(request())).status).toBe(200);
  });

  it.each([undefined, "", " ", "bad secret", "bad,secret", "bad\nsecret"])("rejects an absent or malformed state secret without legacy credentials: %s", async value => {
    vi.stubEnv("CRON_SECRET", undefined);
    vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", value);
    const result = await GET(request(`Bearer ${STATE_SECRET}`));
    expect(result.status).toBe(401);
    expectPrivate(result);
  });

  it.each([`bearer ${STATE_SECRET}`, `Bearer  ${STATE_SECRET}`, `Bearer ${STATE_SECRET}, Bearer other`, "Bearer wrong-state-secret"])(
    "rejects malformed or wrong state authorization: %s", async authorization => {
      vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", STATE_SECRET);
      const result = await GET(request(authorization));
      expect(result.status).toBe(401);
      expectPrivate(result);
    },
  );

  it("does not accept the state secret from URL or cookies, or reuse it after rotation", async () => {
    vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", STATE_SECRET);
    const cookieOnly = await GET(new Request(`https://hanbang.ai/api/ops/account-deletion-state?token=${STATE_SECRET}`, {
      headers: { cookie: `ACCOUNT_DELETION_STATE_SECRET=${STATE_SECRET}` },
    }));
    expect(cookieOnly.status).toBe(401);
    expectPrivate(cookieOnly);
    expect((await GET(request(`Bearer ${STATE_SECRET}`))).status).toBe(200);
    vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", "rotated-state-secret");
    expect((await GET(request(`Bearer ${STATE_SECRET}`))).status).toBe(401);
    expect((await GET(request())).status).toBe(200);
  });

  it("cannot use the state credential to authorize cron execution or user deletion", async () => {
    vi.stubEnv("ACCOUNT_DELETION_STATE_SECRET", STATE_SECRET);
    vi.stubEnv("ACCOUNT_DELETION_CRON_ENABLED", "true");
    vi.stubEnv("ACCOUNT_DELETION_INTAKE_ENABLED", "true");
    expect((await deletionCron(new Request("https://hanbang.ai/api/cron/account-deletion", {
      headers: { Authorization: `Bearer ${STATE_SECRET}` },
    }))).status).toBe(401);
    expect((await deletionIntake(new Request("https://hanbang.ai/api/auth/delete", {
      method: "DELETE", headers: { Authorization: `Bearer ${STATE_SECRET}`, Origin: "https://hanbang.ai" },
    }))).status).toBe(401);
    expect(userSession.getUser).toHaveBeenCalledTimes(1);
  });

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
