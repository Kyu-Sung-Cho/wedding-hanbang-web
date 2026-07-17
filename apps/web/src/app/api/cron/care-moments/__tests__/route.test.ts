import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET, runCareCron } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/amora/momentLoop", () => ({
  buildDueMomentCells: vi.fn((input: { progress?: Record<string, unknown> | null }) => {
    if (input.progress?.__internalThrow === true) throw new TypeError("engine regression");
    if (input.progress?.__events && !Array.isArray(input.progress.__events)) return [];
    return [{
    momentType: "wedding_day",
    momentLabel: "본식",
    cellKind: "d1",
    momentDate: "2026-07-17",
    dedupeKey: "wedding_day:d1:2026-07-17",
    message: "내일 일정을 편안하게 확인해봐요.",
    memoryKeys: [],
    priority: 100,
    }];
  }),
}));

type FakeJourney = {
  id: string;
  couple_id: string;
  wedding_date: string;
  progress: Record<string, unknown>;
  created_at: string;
};

function fakeJourney(index: number): FakeJourney {
  return {
    id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    couple_id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    wedding_date: "2026-07-17",
    progress: {},
    created_at: "2026-07-16T00:00:00.000Z",
  };
}

function buildFakeAdmin(input: {
  journeys?: FakeJourney[];
  jobs?: Array<Record<string, unknown>>;
  emailRetry?: boolean;
  emailWarning?: boolean;
  frequencySkipped?: boolean;
  prepareState?: "ready" | "deferred";
  finishJobState?: "completed" | "completed_with_warning" | "failed";
  queueStats?: Partial<{
    failed: number;
    active_backlog: number;
    oldest_active_age_seconds: number;
    deferred: number;
    frequency_skipped: number;
  }>;
}) {
  const journeys = [...(input.journeys ?? [])].sort((a, b) => (
    a.couple_id.localeCompare(b.couple_id) || a.id.localeCompare(b.id)
  ));
  const enqueued = new Set<string>();
  const completedJobs = new Set<string>();
  let scanCursor: string | null = null;
  let scanJourneyCursor: string | null = null;
  let scanCompleted = journeys.length === 0;
  let jobClaimIndex = 0;
  let emailClaimIndex = 0;
  let deliveryFinishIndex = 0;
  const deliveryFinishArgs: Array<Record<string, unknown>> = [];

  const admin = {
    from(table: string) {
      if (table !== "wedding_journeys") throw new Error(`unexpected table ${table}`);
      let cursorCouple: string | null = null;
      let cursorJourney: string | null = null;
      let snapshotAt: string | null = null;
      let limit = 200;
      const builder = {
        select() { return builder; },
        order() { return builder; },
        limit(value: number) { limit = value; return builder; },
        not() { return builder; },
        or(filter: string) {
          snapshotAt = filter.match(/created_at\.lte\.([^,)]+)/)?.[1] ?? null;
          const ids = filter.match(/[0-9a-f]{8}-[0-9a-f-]{27}/gi) ?? [];
          cursorCouple = ids[0] ?? null;
          cursorJourney = ids[2] ?? null;
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          const rows = journeys.filter((journey) => (
            (!snapshotAt || journey.created_at <= snapshotAt)
            && (
              !cursorCouple
              || journey.couple_id > cursorCouple
              || (journey.couple_id === cursorCouple && Boolean(cursorJourney) && journey.id > cursorJourney!)
            )
          )).slice(0, limit);
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      switch (name) {
        case "claim_amora_care_scan":
          return scanCompleted
            ? {
              data: {
                claimed: false,
                state: "completed",
                last_couple_id: scanCursor,
                last_journey_id: scanJourneyCursor,
                snapshot_at: "2026-07-16T03:00:00.000Z",
              },
              error: null,
            }
            : {
              data: {
                claimed: true,
                state: "scanning",
                lease_token: "scan-token",
                last_couple_id: scanCursor,
                last_journey_id: scanJourneyCursor,
                snapshot_at: "2026-07-16T03:00:00.000Z",
              },
              error: null,
            };
        case "advance_amora_care_scan":
          scanCursor = typeof args?.p_last_couple_id === "string" ? args.p_last_couple_id : scanCursor;
          scanJourneyCursor = typeof args?.p_last_journey_id === "string"
            ? args.p_last_journey_id
            : scanJourneyCursor;
          scanCompleted = args?.p_completed === true;
          return { data: { state: scanCompleted ? "completed" : "scanning" }, error: null };
        case "enqueue_amora_care_job": {
          const key = `${args?.p_couple_id}:${args?.p_dedupe_key}`;
          const inserted = !enqueued.has(key);
          enqueued.add(key);
          return { data: { id: key, inserted, status: "pending" }, error: null };
        }
        case "claim_amora_care_job": {
          const source = input.jobs?.[jobClaimIndex];
          jobClaimIndex += 1;
          if (!source) return { data: null, error: null };
          return {
            data: { ...source, lease_token: `job-token-${jobClaimIndex}` },
            error: null,
          };
        }
        case "prepare_amora_care_job":
          return input.prepareState === "deferred"
            ? {
              data: {
                state: "deferred",
                reason: "outside_delivery_window",
                available_at: "2026-07-16T00:00:00.000Z",
              },
              error: null,
            }
            : { data: { state: "ready", chat_message_id: `chat-${args?.p_job_id}` }, error: null };
        case "claim_amora_care_email_delivery":
          if (input.frequencySkipped && emailClaimIndex === 0) {
            emailClaimIndex += 1;
            return {
              data: { state: "skipped", reason: "daily_frequency_limit" },
              error: null,
            };
          }
          if (input.emailWarning && emailClaimIndex === 0) {
            emailClaimIndex += 1;
            return { data: { state: "warning", reason: "invalid_email" }, error: null };
          }
          if (!input.emailRetry || emailClaimIndex % 2 === 1) {
            emailClaimIndex += 1;
            return { data: null, error: null };
          }
          emailClaimIndex += 1;
          return {
            data: {
              state: "ready",
              id: "delivery-1",
              user_id: "member-1",
              email: "member@example.com",
              name: "멤버",
              idempotency_key: "amora-care-stable-job-member-key",
            },
            error: null,
          };
        case "finish_amora_care_email_delivery":
          deliveryFinishArgs.push(args ?? {});
          deliveryFinishIndex += 1;
          return { data: { state: args?.p_success ? "completed" : "pending" }, error: null };
        case "finish_amora_care_job": {
          const id = String(args?.p_job_id);
          if (input.emailRetry && deliveryFinishIndex < 2) {
            return { data: { state: "pending" }, error: null };
          }
          completedJobs.add(id);
          return {
            data: {
              state: input.finishJobState
                ?? (input.emailWarning || input.frequencySkipped
                  ? "completed_with_warning"
                  : "completed"),
            },
            error: null,
          };
        }
        case "get_amora_care_queue_stats":
          return {
            data: {
              failed: 0,
              active_backlog: 0,
              oldest_active_age_seconds: 0,
              deferred: 0,
              frequency_skipped: 0,
              ...input.queueStats,
            },
            error: null,
          };
        default:
          throw new Error(`unexpected rpc ${name}`);
      }
    },
  };

  return { admin, enqueued, completedJobs, deliveryFinishArgs };
}

describe("/api/cron/care-moments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("quarantines durable jobs without reading user data or sending messages while the kill switch is off", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    const rpc = vi.fn().mockResolvedValue({
      data: { jobs: 2, deliveries: 3 },
      error: null,
    });
    vi.mocked(createClient).mockReturnValue({ rpc } as never);
    const request = new NextRequest("http://localhost/api/cron/care-moments", {
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      enabled: false,
      quarantinedJobs: 2,
      quarantinedDeliveries: 3,
    });
    expect(rpc).toHaveBeenCalledWith("quarantine_amora_care_queue", {
      p_reason: "outbound_disabled",
    });
  });

  it("fails closed when the kill switch cannot quarantine durable jobs", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    vi.mocked(createClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "DB_DOWN" } }),
    } as never);
    const request = new NextRequest("http://localhost/api/cron/care-moments", {
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: "care queue quarantine failed" });
  });

  it("fails before reading user data when outbound email is enabled without Resend", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "");
    const request = new NextRequest("http://localhost/api/cron/care-moments", {
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("eventually keyset-scans and enqueues all 501 journeys without duplicates", async () => {
    const fake = buildFakeAdmin({ journeys: Array.from({ length: 501 }, (_, index) => fakeJourney(index + 1)) });
    const now = new Date("2026-07-16T03:00:00.000Z");

    const first = await runCareCron({ admin: fake.admin as never, resend: null, now });
    const second = await runCareCron({ admin: fake.admin as never, resend: null, now });
    const third = await runCareCron({ admin: fake.admin as never, resend: null, now });

    expect(first.scanned).toBe(200);
    expect(first.scanCompleted).toBe(false);
    expect(second.scanned).toBe(200);
    expect(second.scanCompleted).toBe(false);
    expect(third.scanned).toBe(101);
    expect(third.scanCompleted).toBe(true);
    expect(fake.enqueued.size).toBe(501);
  });

  it("uses the journey id tie-breaker when duplicate couple rows cross a page boundary", async () => {
    const sharedCoupleId = "10000000-0000-4000-8000-000000000001";
    const journeys = Array.from({ length: 201 }, (_, index) => ({
      ...fakeJourney(index + 1),
      couple_id: sharedCoupleId,
    }));
    const fake = buildFakeAdmin({ journeys });
    const now = new Date("2026-07-16T03:00:00.000Z");

    const first = await runCareCron({ admin: fake.admin as never, resend: null, now });
    const second = await runCareCron({ admin: fake.admin as never, resend: null, now });

    expect(first.scanned).toBe(200);
    expect(second.scanned).toBe(1);
    expect(second.scanCompleted).toBe(true);
    expect(fake.enqueued.size).toBe(1);
  });

  it("pins every page to the durable scan snapshot", async () => {
    const before = fakeJourney(1);
    const after = { ...fakeJourney(2), created_at: "2026-07-16T03:00:01.000Z" };
    const fake = buildFakeAdmin({ journeys: [before, after] });

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: null,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(result.scanned).toBe(1);
    expect(result.scanCompleted).toBe(true);
    expect(fake.enqueued.size).toBe(1);
  });

  it("quarantines a malformed journey row and advances to later couples", async () => {
    const poisoned = { ...fakeJourney(1), progress: { __events: { poisoned: true } } };
    const healthy = fakeJourney(2);
    const fake = buildFakeAdmin({ journeys: [poisoned, healthy] });

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: null,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(result).toMatchObject({
      scanned: 2,
      invalidJourneys: 1,
      enqueued: 1,
      scanCompleted: true,
    });
    expect(fake.enqueued.size).toBe(1);
  });

  it("fails and retries the scan when the moment engine throws unexpectedly", async () => {
    const broken = { ...fakeJourney(1), progress: { __internalThrow: true } };
    const healthy = fakeJourney(2);
    const fake = buildFakeAdmin({ journeys: [broken, healthy] });

    await expect(runCareCron({
      admin: fake.admin as never,
      resend: null,
      now: new Date("2026-07-16T03:00:00.000Z"),
    })).rejects.toThrow("engine regression");
    expect(fake.enqueued.size).toBe(0);
  });

  it("drains 101 durable jobs over multiple bounded runs exactly once", async () => {
    const jobs = Array.from({ length: 101 }, (_, index) => ({
      id: `job-${index + 1}`,
      scan_day: "2026-07-16",
      dedupe_key: `care-${index + 1}`,
      content: "확인할 일정이 있어요.",
      metadata: {},
    }));
    const fake = buildFakeAdmin({ jobs });
    const now = new Date("2026-07-16T03:00:00.000Z");

    const first = await runCareCron({ admin: fake.admin as never, resend: null, now });
    const second = await runCareCron({ admin: fake.admin as never, resend: null, now });

    expect(first.claimed).toBe(100);
    expect(second.claimed).toBe(1);
    expect(fake.completedJobs.size).toBe(101);
  });

  it("reuses the same Resend idempotency key after an email result persistence retry", async () => {
    const jobs = [
      {
        id: "job-retry",
        scan_day: "2026-07-16",
        dedupe_key: "retry",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      },
      {
        id: "job-retry",
        scan_day: "2026-07-16",
        dedupe_key: "retry",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      },
    ];
    const fake = buildFakeAdmin({ jobs, emailRetry: true });
    const send = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { name: "application_error", message: "temporary" } })
      .mockResolvedValueOnce({ data: { id: "provider-1" }, error: null });
    const resend = { emails: { send } };

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: resend as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      subject: "저장된 제목",
      html: "<p>저장된 본문</p>",
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      subject: "저장된 제목",
      html: "<p>저장된 본문</p>",
    });
    expect(send.mock.calls[0]?.[1]).toEqual({ idempotencyKey: "amora-care-stable-job-member-key" });
    expect(send.mock.calls[1]?.[1]).toEqual({ idempotencyKey: "amora-care-stable-job-member-key" });
    expect(result.emailErrors).toBe(1);
    expect(result.emails).toBe(1);
    expect(fake.deliveryFinishArgs.map((args) => args.p_success)).toEqual([false, true]);
    expect(fake.completedJobs).toEqual(new Set(["job-retry"]));
  });

  it("keeps a delivery retryable when Resend returns no error but no provider receipt", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-ambiguous",
        scan_day: "2026-07-16",
        dedupe_key: "ambiguous",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      emailRetry: true,
    });
    const send = vi.fn().mockResolvedValue({ data: null, error: null });

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(result.emails).toBe(0);
    expect(result.emailErrors).toBe(1);
    expect(fake.deliveryFinishArgs[0]).toMatchObject({
      p_success: false,
      p_error: "provider_receipt_missing",
    });
    expect(fake.completedJobs).toEqual(new Set());
  });

  it("surfaces terminal email warnings instead of reporting a full success", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-warning",
        scan_day: "2026-07-16",
        dedupe_key: "warning",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      emailWarning: true,
    });

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send: vi.fn() } } as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(result).toMatchObject({
      emailWarnings: 1,
      completedWithWarnings: 1,
      completed: 1,
    });
  });

  it("never persists a provider error message that can echo recipient PII", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-provider-pii",
        scan_day: "2026-07-16",
        dedupe_key: "provider-pii",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      emailRetry: true,
    });
    const send = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "delivery failed for private@example.com" },
    });

    await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(fake.deliveryFinishArgs[0]?.p_error).toBe("provider_error");
    expect(JSON.stringify(fake.deliveryFinishArgs)).not.toContain("private@example.com");
  });

  it("treats a database delivery-window deferral as a no-send outcome", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-before-window",
        scan_day: "2026-07-16",
        dedupe_key: "before-window",
        content: "아침 전에는 보내면 안 돼요.",
        metadata: {},
      }],
      prepareState: "deferred",
      queueStats: { active_backlog: 1, deferred: 1 },
    });
    const send = vi.fn();

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      now: new Date("2026-07-15T15:05:00.000Z"),
    });

    expect(send).not.toHaveBeenCalled();
    expect(fake.completedJobs).toEqual(new Set());
    expect(result).toMatchObject({
      claimed: 1,
      chatCompleted: 0,
      emails: 0,
      activeBacklog: 1,
      deferred: 1,
    });
  });

  it("reports DB queue health and counts terminal claim housekeeping failures", async () => {
    const fake = buildFakeAdmin({
      queueStats: {
        failed: 2,
        active_backlog: 7,
        oldest_active_age_seconds: 321,
        deferred: 4,
        frequency_skipped: 3,
      },
    });

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send: vi.fn() } } as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(result).toMatchObject({
      failed: 2,
      activeBacklog: 7,
      oldestActiveAgeSeconds: 321,
      deferred: 4,
      frequencySkipped: 3,
    });
  });

  it("surfaces the per-user daily email cap as a frequency skip", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-daily-cap",
        scan_day: "2026-07-16",
        dedupe_key: "daily-cap",
        content: "오늘의 두 번째 케어",
        metadata: {},
      }],
      frequencySkipped: true,
      queueStats: { frequency_skipped: 1 },
    });
    const send = vi.fn();

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emailWarnings: 1,
      frequencySkipped: 1,
      completedWithWarnings: 1,
    });
  });
});
