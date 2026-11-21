import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET, runCareCron } from "../route";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/amora/momentLoop", () => ({
  buildDueMomentCells: vi.fn((input: { progress?: Record<string, unknown> | null }) => {
    if (input.progress?.__internalThrow === true) throw new TypeError("engine regression");
    if (input.progress?.__events && !Array.isArray(input.progress.__events)) return [];
    const cell = {
    momentType: "wedding_day",
    momentLabel: "본식",
    cellKind: "d1",
    momentDate: "2026-07-17",
    dedupeKey: "wedding_day:d1:2026-07-17",
    message: "내일 일정을 편안하게 확인해봐요.",
    memoryKeys: [],
    priority: 100,
    };
    // 10장 P2.6: the drain step recomputes the day's cells from the current
    // plan. A fake journey lists which job keys are still due.
    const dueKeys = input.progress?.__dueKeys;
    if (Array.isArray(dueKeys)) {
      return dueKeys.map((key) => ({ ...cell, dedupeKey: String(key) }));
    }
    return [cell];
  }),
}));

const CARE_UNSUBSCRIBE_TEST_SECRET = "care-unsubscribe-test-secret-0123456789abcdef";
const DEFAULT_JOB_COUPLE_ID = "10000000-0000-4000-8000-0000000000c1";
const DELIVERY_USER_ID = "00000000-0000-4000-8000-0000000000aa";

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
  /** The plan the drain step reads. Default: every claimed job's cell is still due. */
  currentJourney?: { wedding_date: string; progress: Record<string, unknown>; state_revision: number } | null;
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
  const prepareArgs: Array<Record<string, unknown>> = [];
  const sourceCancelledJobs: string[] = [];
  const journeyReads: string[] = [];
  const currentJourney = input.currentJourney === undefined
    ? {
      wedding_date: "2026-07-17",
      progress: { __dueKeys: (input.jobs ?? []).map((job) => job.dedupe_key) },
      state_revision: 7,
    }
    : input.currentJourney;

  const admin = {
    from(table: string) {
      if (table !== "wedding_journeys") throw new Error(`unexpected table ${table}`);
      let cursorCouple: string | null = null;
      let cursorJourney: string | null = null;
      let snapshotAt: string | null = null;
      let limit = 200;
      let singleCouple: string | null = null;
      const builder = {
        select() { return builder; },
        order() { return builder; },
        limit(value: number) { limit = value; return builder; },
        not() { return builder; },
        eq(column: string, value: string) {
          if (column !== "couple_id") throw new Error(`unexpected filter ${column}`);
          singleCouple = value;
          return builder;
        },
        async maybeSingle() {
          journeyReads.push(String(singleCouple));
          return { data: currentJourney, error: null };
        },
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
            data: {
              couple_id: DEFAULT_JOB_COUPLE_ID,
              ...source,
              lease_token: `job-token-${jobClaimIndex}`,
            },
            error: null,
          };
        }
        case "cancel_amora_care_job_source_changed":
          sourceCancelledJobs.push(String(args?.p_job_id));
          return { data: { state: "cancelled", reason: "source_changed" }, error: null };
        case "prepare_amora_care_job":
          prepareArgs.push(args ?? {});
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
              user_id: DELIVERY_USER_ID,
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

  return {
    admin,
    enqueued,
    completedJobs,
    deliveryFinishArgs,
    prepareArgs,
    sourceCancelledJobs,
    journeyReads,
  };
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
        // A retry after the shared message was posted resends the stored copy.
        chat_message_id: "chat-job-retry",
        content: "일정 확인",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      },
      {
        id: "job-retry",
        scan_day: "2026-07-16",
        dedupe_key: "retry",
        // A retry after the shared message was posted resends the stored copy.
        chat_message_id: "chat-job-retry",
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ subject: "저장된 제목" });
    expect(String(send.mock.calls[0]?.[0]?.html).startsWith("<p>저장된 본문</p>")).toBe(true);
    // Resend replays one idempotency key only for the identical request, so the
    // retry (stored copy plus the per-recipient unsubscribe footer and headers)
    // must be byte-identical to the first attempt.
    expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
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
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      emailWarnings: 1,
      frequencySkipped: 1,
      completedWithWarnings: 1,
    });
  });

  // 10장 P2 통과 기준: 일정이 자정 뒤에 취소되면 그날 09:00의 글이 가지 않는다.
  it("closes the day's job without posting when its event is gone from the current plan", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-cancelled-event",
        scan_day: "2026-07-16",
        dedupe_key: "dress_fitting:d1:2026-07-17:event-1",
        content: "내일 드레스 피팅이에요.",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      // 03:00 the couple cancelled the fitting: the cell is no longer due.
      currentJourney: { wedding_date: "2026-07-17", progress: { __dueKeys: [] }, state_revision: 8 },
    });
    const send = vi.fn();

    const result = await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
      now: new Date("2026-07-16T00:30:00.000Z"),
    });

    expect(fake.journeyReads).toEqual([DEFAULT_JOB_COUPLE_ID]);
    expect(fake.sourceCancelledJobs).toEqual(["job-cancelled-event"]);
    expect(fake.prepareArgs).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cancelled: 1, chatCompleted: 0, emails: 0 });
  });

  it("posts the message recomputed on the current plan together with that plan's revision", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-still-due",
        scan_day: "2026-07-16",
        dedupe_key: "wedding_day:d1:2026-07-17",
        content: "자정에 만든 글",
        email_subject: "자정에 만든 제목",
        email_html: "<p>자정에 만든 본문</p>",
        metadata: {},
      }],
      currentJourney: {
        wedding_date: "2026-07-17",
        progress: { __dueKeys: ["wedding_day:d1:2026-07-17"] },
        state_revision: 12,
      },
    });

    await runCareCron({
      admin: fake.admin as never,
      resend: null,
      now: new Date("2026-07-16T00:30:00.000Z"),
    });

    expect(fake.prepareArgs).toEqual([expect.objectContaining({
      p_job_id: "job-still-due",
      p_expected_journey_revision: 12,
      p_content: "내일 일정을 편안하게 확인해봐요.",
      p_email_subject: "본식, 내일이에요. 나가기 전에 함께 확인해요",
    })]);
    expect(String(fake.prepareArgs[0]?.p_email_html)).not.toContain("자정에 만든 본문");
  });

  it("does not recompute a job whose shared message is already posted", async () => {
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-posted",
        scan_day: "2026-07-16",
        dedupe_key: "posted",
        chat_message_id: "chat-job-posted",
        content: "[posted]",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      currentJourney: { wedding_date: "2026-07-17", progress: { __dueKeys: [] }, state_revision: 3 },
    });

    await runCareCron({ admin: fake.admin as never, resend: null, now: new Date("2026-07-16T00:30:00.000Z") });

    expect(fake.journeyReads).toEqual([]);
    expect(fake.sourceCancelledJobs).toEqual([]);
    expect(fake.prepareArgs).toEqual([{
      p_job_id: "job-posted",
      p_lease_token: "job-token-1",
      p_email_enabled: false,
    }]);
  });

  // 10장 P2.7: 메일에는 한 번 눌러 수신을 끊는 링크와 머리글을 넣는다.
  it("sends every care email with a one-tap unsubscribe link for that recipient", async () => {
    const { verifyCareUnsubscribeToken } = await import("@/lib/care/careUnsubscribe");
    const fake = buildFakeAdmin({
      jobs: [{
        id: "job-unsubscribe",
        scan_day: "2026-07-16",
        dedupe_key: "unsubscribe",
        chat_message_id: "chat-job-unsubscribe",
        content: "[posted]",
        email_subject: "저장된 제목",
        email_html: "<p>저장된 본문</p>",
        metadata: {},
      }],
      emailRetry: true,
    });
    const send = vi.fn().mockResolvedValue({ data: { id: "provider-1" }, error: null });

    await runCareCron({
      admin: fake.admin as never,
      resend: { emails: { send } } as never,
      unsubscribeSecret: CARE_UNSUBSCRIBE_TEST_SECRET,
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    const message = send.mock.calls[0]?.[0] as {
      html: string;
      headers: Record<string, string>;
    };
    const url = /^<(.+)>$/.exec(message.headers["List-Unsubscribe"] ?? "")?.[1] ?? "";
    expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(url).toMatch(/^https:\/\/[^/]+\/api\/amora\/care\/unsubscribe\?t=/);
    expect(message.html.startsWith("<p>저장된 본문</p>")).toBe(true);
    expect(message.html).toContain(url.replace(/&/g, "&amp;"));
    const token = decodeURIComponent(new URL(url).searchParams.get("t") ?? "");
    expect(verifyCareUnsubscribeToken(CARE_UNSUBSCRIBE_TEST_SECRET, token)).toBe(DELIVERY_USER_ID);
  });

  it("fails closed before reading user data when the unsubscribe secret is missing", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("AMORA_CARE_UNSUBSCRIBE_SECRET", "");
    const request = new NextRequest("http://localhost/api/cron/care-moments", {
      headers: { authorization: "Bearer test-cron-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(503);
    expect(createClient).not.toHaveBeenCalled();
  });
});
