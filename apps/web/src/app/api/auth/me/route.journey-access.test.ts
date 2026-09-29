// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-4111-8111-111111111111";
const COUPLE = "22222222-2222-4222-8222-222222222222";
const JOURNEY = { id: "journey", couple_id: COUPLE, total_budget: 35000000, venue: "비공개 예식장" };
type ReadResult = { data: Record<string, unknown> | null; error: { code: string; message: string } | null };
const mocks = vi.hoisted(() => ({
  coupleRead: vi.fn<() => Promise<ReadResult>>(),
  journeyRead: vi.fn<() => Promise<ReadResult>>(),
  journeyInsert: vi.fn<() => Promise<ReadResult>>(),
  privilegedJourneyRead: vi.fn<() => Promise<ReadResult>>(),
}));

function query(read: () => Promise<ReadResult>) {
  const builder = { select: () => builder, eq: () => builder, single: read, maybeSingle: read };
  return builder;
}
vi.mock("@/lib/auth/signupConsentAccess", () => ({ getWebSignupConsentAccess: () => "server_verified" }));
vi.mock("@/lib/demoSession", () => ({ hasSignedDemoSessionFromCookieHeader: () => false }));
vi.mock("@/lib/profileWeddingRole", () => ({ readOptionalProfileWeddingRoles: async () => new Map() }));
vi.mock("@/lib/profileAvatar", () => ({ readOptionalProfileAvatars: async () => new Map() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: OWNER } } }) },
  from: (table: string) => {
    if (table === "couples") return query(mocks.coupleRead);
    if (table === "wedding_journeys") return query(mocks.journeyRead);
    throw new Error(`Unexpected caller query: ${table}`);
  },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    if (table === "profiles") return query(async () => ({ data: { id: OWNER, name: "본인", couple_id: COUPLE }, error: null }));
    if (table === "wedding_journeys") return {
      ...query(mocks.privilegedJourneyRead),
      insert: () => query(mocks.journeyInsert),
    };
    throw new Error(`Unexpected privileged query: ${table}`);
  },
}) }));

import { GET } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.coupleRead.mockResolvedValue({ data: { id: COUPLE, bride_id: OWNER, groom_id: null }, error: null });
  mocks.journeyRead.mockResolvedValue({ data: JOURNEY, error: null });
  mocks.journeyInsert.mockResolvedValue({ data: JOURNEY, error: null });
  mocks.privilegedJourneyRead.mockResolvedValue({ data: JOURNEY, error: null });
});

describe("auth/me journey authorization survives bootstrap races", () => {
  it("returns an existing journey through the caller's authorization", async () => {
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(200);
    expect((await response.json()).journey).toEqual(JOURNEY);
    expect(mocks.journeyInsert).not.toHaveBeenCalled();
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it.each(["42501", "08006"])("does not turn a %s read failure into a privileged repair", async code => {
    mocks.journeyRead.mockResolvedValue({ data: null, error: { code, message: "private database failure" } });
    mocks.journeyInsert.mockResolvedValue({ data: null, error: { code: "23505", message: "already exists" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(JOURNEY.venue);
    expect(mocks.journeyInsert).not.toHaveBeenCalled();
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it("stops when the current roster is no longer visible even if a stale profile names it", async () => {
    mocks.coupleRead.mockResolvedValue({ data: null, error: null });
    mocks.journeyRead.mockResolvedValue({ data: null, error: null });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(JOURNEY.venue);
    expect(mocks.journeyInsert).not.toHaveBeenCalled();
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it.each(["insert succeeded", "another member won"])("rechecks caller visibility after %s", async scenario => {
    mocks.journeyRead.mockResolvedValueOnce({ data: null, error: null });
    if (scenario === "another member won") mocks.journeyInsert.mockResolvedValue({ data: null, error: { code: "23505", message: "already exists" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(200);
    expect((await response.json()).journey).toEqual(JOURNEY);
    expect(mocks.journeyRead).toHaveBeenCalledTimes(2);
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it.each(["insert succeeded", "another member won"])("never returns a privileged row after membership loss: %s", async scenario => {
    mocks.journeyRead.mockResolvedValue({ data: null, error: null });
    if (scenario === "another member won") mocks.journeyInsert.mockResolvedValue({ data: null, error: { code: "23505", message: "already exists" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain(JOURNEY.venue);
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it("fails closed when the post-insert caller read fails", async () => {
    mocks.journeyRead.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "08006", message: "private database failure" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database failure");
    expect(mocks.privilegedJourneyRead).not.toHaveBeenCalled();
  });

  it("reports a failed bootstrap without claiming a successful empty session", async () => {
    mocks.journeyRead.mockResolvedValue({ data: null, error: null });
    mocks.journeyInsert.mockResolvedValue({ data: null, error: { code: "08006", message: "private database failure" } });
    const response = await GET(new Request("https://hanbang.ai/api/auth/me"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database failure");
  });
});
