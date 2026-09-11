import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  runtimeEnabled: vi.fn(),
  memoryEnablement: vi.fn(),
  repair: vi.fn(),
  structuredResponse: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdmin,
}));

vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  getAmoraMemoryEnablement: mocks.memoryEnablement,
  isAuxiliaryMemoryRuntimeEnabled: mocks.runtimeEnabled,
}));

vi.mock("@/lib/ai/amoraMemoryRepair", () => ({
  repairMissingAmoraMemoryJobs: mocks.repair,
}));

vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIStructuredResponseWithAudit: mocks.structuredResponse,
}));

import { GET } from "./route";
import { resolveAmoraMemoryConversationPolicy } from "@/lib/ai/amoraMemoryConversationPolicy";
import type { SupabaseClient } from "@supabase/supabase-js";

function request(secret = "cron-secret") {
  return new NextRequest("http://localhost/api/cron/amora-memory", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

type MemoryVisibility = "shared" | "bride_private" | "groom_private";

type MemoryTestRow = {
  id: string;
  sender_id: string | null;
  sender_type: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  visibility: MemoryVisibility;
  created_at: string;
  segment_id?: string | null;
};

type MemoryTestJob = {
  id: string;
  couple_id: string;
  user_id: string;
  visibility: MemoryVisibility;
  to_message_id: string;
  attempt_count: number;
  continuation_count: number;
};

type QueryState = {
  table: string;
  selected: string | null;
  equals: Map<string, unknown>;
  update: Record<string, unknown> | null;
  policyOnly: boolean;
};

function createProcessJobHarness(input: {
  coupleId: string;
  brideId: string;
  groomId: string;
  rows: MemoryTestRow[];
}) {
  const jobs: MemoryTestJob[] = [];
  const commits: Array<Record<string, unknown>> = [];
  const finishes: Array<Record<string, unknown>> = [];
  const policyState = { failRead: false };

  const resolveQuery = (state: QueryState) => {
    // 합성 DB도 현행 INSERT trigger의 서버 segment를 기본 부여한다. 명시 null은 보존한다.
    for (const row of input.rows) if (row.segment_id === undefined) row.segment_id = "60000000-0000-4000-8000-000000000001";
    if (state.table === "amora_memory_settings") {
      return { data: { enabled: true, memory_reset_at: null }, error: null };
    }
    if (state.table === "couples") {
      return {
        data: { bride_id: input.brideId, groom_id: input.groomId },
        error: null,
      };
    }
    if (state.table === "chat_summaries") {
      return { data: null, error: null };
    }
    if (state.table === "chat_messages") {
      if (state.policyOnly || state.update || state.selected?.includes("segment_id,metadata")) {
        if (state.policyOnly && policyState.failRead) return { data: null, error: { code: "SYNTHETIC_POLICY_FAILURE" } };
        const found = input.rows.find(row => [...state.equals].every(([key, value]) => key === "couple_id" ? value === input.coupleId
          : key === "metadata" ? (value === null ? row.metadata === null : JSON.stringify(row.metadata) === value)
          : (row as unknown as Record<string, unknown>)[key] === value)
          && (!state.policyOnly || Boolean(row.metadata && "amora_memory_policy" in row.metadata)));
        if (found && state.update) Object.assign(found, structuredClone(state.update));
        return { data: found ? structuredClone(found) : null, error: null };
      }
      const exactId = state.equals.get("id");
      if (typeof exactId === "string") {
        const row = input.rows.find((candidate) => candidate.id === exactId);
        if (!row) return { data: null, error: null };
        return {
          data: state.selected === "created_at"
            ? { created_at: row.created_at }
            : { id: row.id, created_at: row.created_at },
          error: null,
        };
      }
      return { data: [...input.rows], error: null };
    }
    if (state.table === "amora_memory_jobs" && state.update) {
      return { data: null, error: null };
    }
    throw new Error(`unexpected table query: ${state.table}`);
  };

  const from = vi.fn((table: string) => {
    const state: QueryState = {
      table,
      selected: null,
      equals: new Map(),
      update: null,
      policyOnly: false,
    };
    const builder = {
      select(columns: string) {
        state.selected = columns;
        return builder;
      },
      abortSignal() { return builder; },
      update(value: Record<string, unknown>) {
        state.update = value;
        return builder;
      },
      eq(column: string, value: unknown) {
        state.equals.set(column, value);
        return builder;
      },
      is(column: string, value: null) { state.equals.set(column, value); return builder; },
      not(column: string) { if (column === "metadata->amora_memory_policy") state.policyOnly = true; return builder; },
      lte() { return builder; },
      gt() { return builder; },
      or() { return builder; },
      order() { return builder; },
      limit() { return builder; },
      maybeSingle: async () => resolveQuery(state),
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(resolveQuery(state)).then(onfulfilled, onrejected);
      },
    };
    return builder;
  });

  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === "claim_amora_memory_job") {
      const job = jobs.shift();
      return { data: job ? [job] : [], error: null };
    }
    if (name === "finish_amora_memory_job") {
      finishes.push(params);
      return { data: true, error: null };
    }
    if (name === "commit_amora_memory_job") {
      commits.push(params);
      return { data: true, error: null };
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  const admin = { from, rpc };

  return {
    jobs,
    commits,
    finishes,
    admin,
    policyState,
  };
}

describe("/api/cron/amora-memory enqueue repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    mocks.runtimeEnabled.mockReturnValue(true);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "claim_amora_memory_job") {
        return { data: [], error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    });
    mocks.createAdmin.mockReturnValue({ rpc: mocks.rpc });
    mocks.repair.mockResolvedValue({
      status: "repaired",
      scanned: 2,
      queued: 1,
      duplicate: 1,
      skipped: 0,
      failed: 0,
    });
  });

  it("repairs a bounded missing-job page before claiming the existing queue", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      enabled: true,
      repairScanned: 2,
      repairQueued: 1,
      repairDuplicate: 1,
      repairSkipped: 0,
      repairFailed: 0,
      repairUnavailable: false,
      claimed: 0,
    });
    expect(mocks.repair).toHaveBeenCalledWith(
      expect.anything(),
      20,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
    expect(mocks.repair.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("continues the pre-existing claim loop when repair is unavailable", async () => {
    mocks.repair.mockResolvedValueOnce({ status: "unavailable" });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      repairUnavailable: true,
      repairScanned: 0,
      repairQueued: 0,
      repairFailed: 0,
      claimed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
  });

  it("continues the pre-existing claim loop when a repair candidate is retained after failure", async () => {
    mocks.repair.mockResolvedValueOnce({
      status: "repaired",
      scanned: 1,
      queued: 0,
      duplicate: 0,
      skipped: 0,
      failed: 1,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      repairScanned: 1,
      repairFailed: 1,
      repairUnavailable: false,
      claimed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_amora_memory_job",
      { p_lease_seconds: 300 },
    );
  });

  it("does not scan or claim while the auxiliary-memory kill switch is off", async () => {
    mocks.runtimeEnabled.mockReturnValue(false);

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      claimed: 0,
    });
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an invalid cron secret before repair", async () => {
    const response = await GET(request("wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.repair).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("/api/cron/amora-memory source-pair recovery", () => {
  const coupleId = "10000000-0000-4000-8000-000000000001";
  const brideId = "20000000-0000-4000-8000-000000000001";
  const groomId = "20000000-0000-4000-8000-000000000002";
  const unresolvedUserId = "30000000-0000-4000-8000-000000000001";
  const priorTargetId = "30000000-0000-4000-8000-000000000002";
  const resolvingAssistantId = "30000000-0000-4000-8000-000000000003";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    mocks.runtimeEnabled.mockReturnValue(true);
    mocks.memoryEnablement.mockResolvedValue({
      shared: true,
      bride_private: false,
      groom_private: false,
    });
    mocks.repair.mockResolvedValue({
      status: "repaired",
      scanned: 0,
      queued: 0,
      duplicate: 0,
      skipped: 0,
      failed: 0,
    });
  });

  it.each(["first-denial", "during-provider", "lookup-failure"] as const)("checks durable segment denial before cursor/commit: %s", async mode => {
    const segmentId = "60000000-0000-4000-8000-000000000001";
    const deniedText = "결혼식 장식은 무광 종이를 좋아해. 이번 대화에서만 참고하고 장기 기억에 저장하지 마.";
    const rows: MemoryTestRow[] = [
      { id: unresolvedUserId, role: "user", sender_type: "bride", sender_id: brideId, visibility: "shared", segment_id: segmentId,
        content: mode === "first-denial" ? deniedText : "결혼식 장식은 무광 종이를 좋아해.", metadata: null, created_at: "2026-09-11T00:00:01.000Z" },
      { id: resolvingAssistantId, role: "assistant", sender_type: "ai", sender_id: null, visibility: "shared", segment_id: segmentId,
        content: "현재 대화에서 참고할게요.", metadata: { memory_eligible: true, question_scope: "W0_wedding_core", in_reply_to_user_message_id: unresolvedUserId }, created_at: "2026-09-11T00:00:02.000Z" },
    ];
    const harness = createProcessJobHarness({ coupleId, brideId, groomId, rows });
    harness.policyState.failRead = mode === "lookup-failure";
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({ id: "40000000-0000-4000-8000-000000000001", couple_id: coupleId, user_id: brideId,
      visibility: "shared", to_message_id: resolvingAssistantId, attempt_count: 1, continuation_count: 1 });
    mocks.structuredResponse.mockImplementation(async () => {
      const next = { ...rows[0], id: "30000000-0000-4000-8000-000000000099", content: deniedText, created_at: "2026-09-11T00:00:03.000Z" };
      rows.push(next);
      await resolveAmoraMemoryConversationPolicy({ admin: harness.admin as unknown as SupabaseClient,
        scope: { coupleId, actorId: brideId, actorRole: "bride", visibility: "shared", segmentId }, sources: [next] });
      return { data: { summary: "합성 오래된 추출", memories: [] } };
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    if (mode === "first-denial") {
      expect(mocks.structuredResponse).not.toHaveBeenCalled();
      expect(harness.commits).toHaveLength(1);
      expect(harness.commits[0]).toMatchObject({ p_memories: [], p_message_count: 2, p_to_message_id: resolvingAssistantId });
      expect(rows[0].metadata).toHaveProperty("amora_memory_policy.effect", "deny");
    } else {
      expect(mocks.structuredResponse).toHaveBeenCalledTimes(mode === "lookup-failure" ? 0 : 1);
      expect(harness.commits).toHaveLength(0);
      expect(harness.finishes.at(-1)).toMatchObject({ p_success: false });
    }
  });

  it.each([
    {
      label: "W0",
      sourceText: "결혼식 총예산은 3천만원으로 정할게",
      questionScope: "W0_wedding_core",
      memoryKey: "budget:total",
      category: "budget",
      title: "총예산",
      value: "3천만원",
    },
    {
      label: "W1",
      sourceText: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
      questionScope: "W1_wedding_adjacent",
      memoryKey: "finance:division_plan",
      category: "finance",
      title: "재정 분담 대화",
      value: "부부 재정 분담을 대화",
    },
  ])("defers without moving the cursor, then compiles the same $label source after its canonical assistant arrives", async ({
    sourceText,
    questionScope,
    memoryKey,
    category,
    title,
    value,
  }) => {
    const rows: MemoryTestRow[] = [
      {
        id: unresolvedUserId,
        sender_id: brideId,
        sender_type: "bride",
        role: "user",
        content: sourceText,
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-04T00:00:01.000Z",
      },
      {
        id: priorTargetId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "앞선 요청의 답변",
        metadata: {
          in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000000",
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-04T00:00:02.000Z",
      },
    ];
    const harness = createProcessJobHarness({
      coupleId,
      brideId,
      groomId,
      rows,
    });
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({
      id: "40000000-0000-4000-8000-000000000001",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: priorTargetId,
      attempt_count: 1,
      // A continuation can expose a short in-flight suffix below the normal
      // ten-row batching threshold.
      continuation_count: 1,
    });

    const deferredResponse = await GET(request());

    expect(deferredResponse.status).toBe(200);
    await expect(deferredResponse.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 0,
      deferred: 1,
      failed: 0,
    });
    expect(harness.commits).toEqual([]);
    expect(harness.finishes).toContainEqual(expect.objectContaining({
      p_job_id: "40000000-0000-4000-8000-000000000001",
      p_success: true,
    }));
    expect(mocks.structuredResponse).not.toHaveBeenCalled();

    rows.push({
      id: resolvingAssistantId,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "총예산 기준을 정리했어요.",
      metadata: {
        in_reply_to_user_message_id: unresolvedUserId,
        question_scope: questionScope,
        memory_eligible: true,
      },
      visibility: "shared",
      created_at: "2026-08-04T00:00:03.000Z",
    });
    harness.jobs.push({
      id: "40000000-0000-4000-8000-000000000002",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: resolvingAssistantId,
      attempt_count: 1,
      continuation_count: 1,
    });
    mocks.structuredResponse.mockResolvedValue({
      data: {
        summary: `- 신부 · ${title}: ${value}`,
        memories: [{
          sourceMessageId: unresolvedUserId,
          memoryKey,
          kind: "decision",
          category,
          title,
          value,
          reasoning: "사용자가 직접 준비 기준을 말함",
          confidence: 0.95,
          explicit: true,
          sourceActorRole: "bride",
        }],
      },
    });

    const compiledResponse = await GET(request());

    expect(compiledResponse.status).toBe(200);
    await expect(compiledResponse.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 1,
      deferred: 0,
      failed: 0,
    });
    expect(mocks.structuredResponse).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining(`[${unresolvedUserId}]`),
    }));
    expect(harness.commits).toContainEqual(expect.objectContaining({
      p_job_id: "40000000-0000-4000-8000-000000000002",
      p_from_message_id: null,
      p_to_message_id: resolvingAssistantId,
      p_memories: [expect.objectContaining({
        source_message_id: unresolvedUserId,
        memory_key: memoryKey,
      })],
    }));
  });

  it("does not expose a private source pair to a shared-memory job even if the data boundary returns it", async () => {
    const privateUserId = "50000000-0000-4000-8000-000000000001";
    const privateAssistantId = "50000000-0000-4000-8000-000000000002";
    const sharedTargetId = "50000000-0000-4000-8000-000000000003";
    const rows: MemoryTestRow[] = [
      {
        id: privateUserId,
        sender_id: brideId,
        sender_type: "bride",
        role: "user",
        content: "나만 보는 결혼식 총예산은 3천만원이야",
        metadata: { target: "ai" },
        visibility: "bride_private",
        created_at: "2026-08-04T00:01:01.000Z",
      },
      {
        id: privateAssistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "비공개 예산 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: privateUserId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "bride_private",
        created_at: "2026-08-04T00:01:02.000Z",
      },
      {
        id: sharedTargetId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "공유 대화의 앞선 답변",
        metadata: {
          in_reply_to_user_message_id: "50000000-0000-4000-8000-000000000000",
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-04T00:01:03.000Z",
      },
    ];
    const harness = createProcessJobHarness({
      coupleId,
      brideId,
      groomId,
      rows,
    });
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({
      id: "60000000-0000-4000-8000-000000000001",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: sharedTargetId,
      attempt_count: 1,
      continuation_count: 1,
    });
    mocks.structuredResponse.mockResolvedValue({
      data: { summary: null, memories: [] },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 1,
      failed: 0,
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(harness.commits).toContainEqual(expect.objectContaining({
      p_job_id: "60000000-0000-4000-8000-000000000001",
      p_to_message_id: sharedTargetId,
      p_memories: [],
    }));
  });

  it("compiles the trusted contiguous prefix without advancing across a later unresolved W0 source", async () => {
    const trustedPrefixUserId = "70000000-0000-4000-8000-000000000001";
    const unresolvedLaterUserId = "70000000-0000-4000-8000-000000000002";
    const trustedPrefixAssistantId = "70000000-0000-4000-8000-000000000003";
    const rows: MemoryTestRow[] = [
      {
        id: trustedPrefixUserId,
        sender_id: brideId,
        sender_type: "bride",
        role: "user",
        content: "예식장은 서울 안에서 알아볼게",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-04T00:02:01.000Z",
      },
      {
        id: unresolvedLaterUserId,
        sender_id: groomId,
        sender_type: "groom",
        role: "user",
        content: "결혼식 총예산은 4천만원으로 정할게",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-04T00:02:02.000Z",
      },
      {
        id: trustedPrefixAssistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "예식장 지역 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: trustedPrefixUserId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-04T00:02:03.000Z",
      },
    ];
    const harness = createProcessJobHarness({
      coupleId,
      brideId,
      groomId,
      rows,
    });
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({
      id: "80000000-0000-4000-8000-000000000001",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: trustedPrefixAssistantId,
      attempt_count: 1,
      continuation_count: 1,
    });
    mocks.structuredResponse.mockResolvedValue({
      data: {
        summary: "- 신부 · 예식장 지역: 서울",
        memories: [{
          sourceMessageId: trustedPrefixUserId,
          memoryKey: "venue:preferred_area",
          kind: "preference",
          category: "venue",
          title: "예식장 지역",
          value: "서울",
          reasoning: "사용자가 직접 지역 기준을 말함",
          confidence: 0.95,
          explicit: true,
          sourceActorRole: "bride",
        }],
      },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 1,
      deferred: 0,
      failed: 0,
    });
    expect(mocks.structuredResponse).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.stringContaining(`[${trustedPrefixUserId}]`),
    }));
    const providerInput = mocks.structuredResponse.mock.calls[0]?.[0]?.input;
    expect(providerInput).not.toContain(unresolvedLaterUserId);
    expect(harness.commits).toContainEqual(expect.objectContaining({
      p_job_id: "80000000-0000-4000-8000-000000000001",
      p_to_message_id: trustedPrefixUserId,
      p_memories: [expect.objectContaining({
        source_message_id: trustedPrefixUserId,
      })],
    }));
  });

  it("cursor-consumes a canonically answered but memory-ineligible row without turning it into a memory", async () => {
    const answeredUserId = "90000000-0000-4000-8000-000000000001";
    const ineligibleAssistantId = "90000000-0000-4000-8000-000000000002";
    const targetId = "90000000-0000-4000-8000-000000000003";
    const rows: MemoryTestRow[] = [
      {
        id: answeredUserId,
        sender_id: brideId,
        sender_type: "bride",
        role: "user",
        content: "결혼식 총예산은 아직 3천만원으로 생각 중이야",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-04T00:03:01.000Z",
      },
      {
        id: ineligibleAssistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "이 답변은 장기기억 대상으로 분류되지 않았어요.",
        metadata: {
          in_reply_to_user_message_id: answeredUserId,
          question_scope: "W3_social_care",
          memory_eligible: false,
        },
        visibility: "shared",
        created_at: "2026-08-04T00:03:02.000Z",
      },
      {
        id: targetId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "공유 대화의 다음 답변",
        metadata: {
          in_reply_to_user_message_id: "90000000-0000-4000-8000-000000000000",
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-04T00:03:03.000Z",
      },
    ];
    const harness = createProcessJobHarness({
      coupleId,
      brideId,
      groomId,
      rows,
    });
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({
      id: "a0000000-0000-4000-8000-000000000001",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: targetId,
      attempt_count: 1,
      continuation_count: 1,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 1,
      deferred: 0,
      failed: 0,
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(harness.commits).toContainEqual(expect.objectContaining({
      p_job_id: "a0000000-0000-4000-8000-000000000001",
      p_to_message_id: targetId,
      p_memories: [],
    }));
  });

  it("cursor-consumes former-member and partner-target rows without provider evidence or memory nodes", async () => {
    const formerMemberId = "b0000000-0000-4000-8000-000000000001";
    const formerMemberUserId = "b0000000-0000-4000-8000-000000000002";
    const formerMemberAssistantId = "b0000000-0000-4000-8000-000000000003";
    const partnerTargetUserId = "b0000000-0000-4000-8000-000000000004";
    const partnerTargetAssistantId = "b0000000-0000-4000-8000-000000000005";
    const targetId = "b0000000-0000-4000-8000-000000000006";
    const eligibleReplyMetadata = (sourceId: string) => ({
      in_reply_to_user_message_id: sourceId,
      question_scope: "W0_wedding_core",
      memory_eligible: true,
    });
    const rows: MemoryTestRow[] = [
      {
        id: formerMemberUserId,
        sender_id: formerMemberId,
        sender_type: "bride",
        role: "user",
        content: "예식장은 부산으로 확정할게",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-04T00:04:01.000Z",
      },
      {
        id: formerMemberAssistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "예식장 지역을 정리했어요.",
        metadata: eligibleReplyMetadata(formerMemberUserId),
        visibility: "shared",
        created_at: "2026-08-04T00:04:02.000Z",
      },
      {
        id: partnerTargetUserId,
        sender_id: groomId,
        sender_type: "groom",
        role: "user",
        content: "상대에게만 보낼 결혼식 총예산은 5천만원이야",
        metadata: { target: "partner", partner_recipient_id: brideId },
        visibility: "shared",
        created_at: "2026-08-04T00:04:03.000Z",
      },
      {
        id: partnerTargetAssistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "파트너 전용 행을 근거로 삼으면 안 돼요.",
        metadata: eligibleReplyMetadata(partnerTargetUserId),
        visibility: "shared",
        created_at: "2026-08-04T00:04:04.000Z",
      },
      {
        id: targetId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "공유 대화의 다음 답변",
        metadata: eligibleReplyMetadata(
          "b0000000-0000-4000-8000-000000000000",
        ),
        visibility: "shared",
        created_at: "2026-08-04T00:04:05.000Z",
      },
    ];
    const harness = createProcessJobHarness({
      coupleId,
      brideId,
      groomId,
      rows,
    });
    mocks.createAdmin.mockReturnValue(harness.admin);
    harness.jobs.push({
      id: "c0000000-0000-4000-8000-000000000001",
      couple_id: coupleId,
      user_id: brideId,
      visibility: "shared",
      to_message_id: targetId,
      attempt_count: 1,
      continuation_count: 1,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      claimed: 1,
      compiled: 1,
      deferred: 0,
      failed: 0,
    });
    expect(mocks.structuredResponse).not.toHaveBeenCalled();
    expect(harness.commits).toContainEqual(expect.objectContaining({
      p_job_id: "c0000000-0000-4000-8000-000000000001",
      p_to_message_id: targetId,
      p_memories: [],
    }));
  });
});
