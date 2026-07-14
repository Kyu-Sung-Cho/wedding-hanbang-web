import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  participantResult: { data: { id: "participant-1" }, error: null as unknown },
  caseResult: { data: null as unknown, error: null as unknown },
  verdictResult: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: mocks.from }),
}));

import { getCourtVerdictStatusForUser } from "@/lib/coupleCourt/repository";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

function chain(result: () => unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => result());
  query.limit = vi.fn(async () => result());
  return query;
}

describe("getCourtVerdictStatusForUser", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.participantResult.data = { id: "participant-1" };
    mocks.participantResult.error = null;
    mocks.caseResult.data = null;
    mocks.caseResult.error = null;
    mocks.verdictResult.data = [];
    mocks.verdictResult.error = null;
    mocks.from.mockImplementation((table: string) => {
      if (table === "court_participants") return chain(() => mocks.participantResult);
      if (table === "court_cases") return chain(() => mocks.caseResult);
      if (table === "court_verdicts") return chain(() => mocks.verdictResult);
      throw new Error(`unexpected table: ${table}`);
    });
  });

  it("uses only membership and case status when a verdict is ready", async () => {
    mocks.caseResult.data = { workflow_status: "verdict_ready", safety_level: "normal" };

    await expect(getCourtVerdictStatusForUser(CASE_ID, USER_ID)).resolves.toEqual({
      status: "ready",
    });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      "court_participants",
      "court_cases",
    ]);
  });

  it("returns the live lease delay without authorizing recovery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
    mocks.caseResult.data = { workflow_status: "judging", safety_level: "normal" };
    mocks.verdictResult.data = [{ lease_expires_at: "2026-07-14T00:00:09.100Z" }];

    await expect(getCourtVerdictStatusForUser(CASE_ID, USER_ID)).resolves.toEqual({
      status: "judging",
      retryAfterSeconds: 11,
      recoveryAllowed: false,
    });
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual([
      "court_participants",
      "court_cases",
      "court_verdicts",
    ]);
    vi.useRealTimers();
  });

  it("allows a fenced recovery only after the lease expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T00:00:10.000Z"));
    mocks.caseResult.data = { workflow_status: "judging", safety_level: "normal" };
    mocks.verdictResult.data = [{ lease_expires_at: "2026-07-14T00:00:09.000Z" }];

    await expect(getCourtVerdictStatusForUser(CASE_ID, USER_ID)).resolves.toEqual({
      status: "judging",
      retryAfterSeconds: 1,
      recoveryAllowed: true,
    });
    vi.useRealTimers();
  });

  it("stops at the safety redirect without reading any verdict row", async () => {
    mocks.caseResult.data = { workflow_status: "judging", safety_level: "high_risk" };

    await expect(getCourtVerdictStatusForUser(CASE_ID, USER_ID)).resolves.toEqual({
      status: "safety_redirect",
    });
    expect(mocks.from).not.toHaveBeenCalledWith("court_verdicts");
  });

  it("checks for an existing ready verdict before reopening an archived case", async () => {
    mocks.caseResult.data = { workflow_status: "archived", safety_level: "normal" };
    mocks.verdictResult.data = [{ id: "verdict-1" }];

    await expect(getCourtVerdictStatusForUser(CASE_ID, USER_ID)).resolves.toEqual({
      status: "ready",
    });
  });
});
