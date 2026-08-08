import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { GET, PATCH } from "../route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "amora:memory:user"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const MEMORY_ID = "20000000-0000-4000-8000-000000000001";

function query(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function selectableQuery(
  initialData: unknown,
  onSelect: (selection: string) => unknown = () => initialData,
  onSelectError: (selection: string) => unknown = () => null,
) {
  const result = { data: initialData, error: null as unknown };
  const chain = {
    select: (selection: string) => {
      result.data = onSelect(selection);
      result.error = onSelectError(selection);
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

function mockRequestClient(memoryOverrides: Record<string, unknown> = {}) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from: vi.fn((table: string) => {
      if (table === "profiles") {
        return query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null });
      }
      if (table === "couples") {
        return query({ data: { bride_id: USER_ID, groom_id: null }, error: null });
      }
      return query({
        data: {
          id: MEMORY_ID,
          visibility: "bride_private",
          memory_key: "venue:preferred_area",
          category: "venue",
          title: "선호 지역",
          metadata: { extracted_by: "amora" },
          ...memoryOverrides,
        },
        error: null,
      });
    }),
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockGetClients(options: {
  profileError?: { code: string } | null;
  profileRowCount?: number;
  sharedEnabled?: boolean;
} = {}) {
  const groomId = "00000000-0000-4000-8000-000000000002";
  const sourceMessageId = "30000000-0000-4000-8000-000000000001";
  const projectedNode = {
    id: MEMORY_ID,
    couple_id: COUPLE_ID,
    visibility: "shared",
    memory_key: "venue:preferred_area",
    title: "선호 지역",
    chosen_value: { value: "강남" },
    reasoning: null,
    confidence: 0.9,
    source_message_id: sourceMessageId,
    source_actor_role: "bride",
    superseded_at: null,
    metadata: { memory_kind: "preference", explicit: true },
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    source_message: {
      id: sourceMessageId,
      couple_id: COUPLE_ID,
      visibility: "shared",
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      metadata: null,
    },
  };
  const projectedRows = options.profileRowCount === 501
    ? [projectedNode, ...Array.from({ length: 500 }, () => ({}))]
    : [projectedNode];
  const requestFrom = vi.fn((table: string) => {
    if (table === "profiles") {
      return query({ data: { couple_id: COUPLE_ID, role: "bride" }, error: null });
    }
    if (table === "couples") {
      return query({ data: { bride_id: USER_ID, groom_id: groomId }, error: null });
    }
    if (table === "amora_memory_settings") {
      return query({
        data: [{
          visibility: "shared",
          enabled: options.sharedEnabled ?? true,
          enabled_at: "2026-07-15T00:00:00.000Z",
          memory_reset_at: null,
          updated_at: "2026-07-15T00:00:00.000Z",
        }],
        error: null,
      });
    }
    if (table === "decision_nodes") {
      return selectableQuery([], (selection) =>
        selection.includes("source_message:chat_messages") ? projectedRows : [],
      (selection) =>
        selection.includes("source_message:chat_messages")
          ? options.profileError ?? null
          : null,
      );
    }
    if (table === "amora_couple_profiles") {
      return query({
        data: [{
          visibility: "shared",
          persona_summary: "LEGACY_PROFILE_MUST_NOT_LEAK",
          budget_posture: null,
          decision_style: null,
          taste_profile: null,
          communication_style: null,
          conflict_pattern: null,
          recommendation_rules: [],
          open_questions: [],
          confidence_score: 1,
          updated_at: "2026-07-15T00:00:00.000Z",
        }],
        error: null,
      });
    }
    return query({ data: [], error: null });
  });
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })),
    },
    from: requestFrom,
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === "amora_memory_consents") {
        return query({
          data: [
            { visibility: "shared", user_id: USER_ID },
            { visibility: "shared", user_id: groomId },
          ],
          error: null,
        });
      }
      if (table === "couples") {
        return query({ data: { bride_id: USER_ID, groom_id: groomId }, error: null });
      }
      return query({ data: [], error: null });
    }),
  } as unknown as ReturnType<typeof createAdminClient>);
  return requestFrom;
}

describe("/api/amora/memory PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestClient();
  });

  it("rejects sensitive personal data before a manual memory edit reaches the database", async () => {
    const rpc = vi.fn(async () => ({ data: MEMORY_ID, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
    const request = new Request("http://localhost/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_memory",
        visibility: "bride_private",
        memoryId: MEMORY_ID,
        title: "연락처",
        value: "010.1234.5678",
      }),
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("민감정보");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects visually normal personal data containing Unicode format characters", async () => {
    const rpc = vi.fn(async () => ({ data: MEMORY_ID, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
    const request = new Request("http://localhost/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_memory",
        visibility: "bride_private",
        memoryId: MEMORY_ID,
        title: "연락처",
        value: "010\u200B-1234\u200B-5678",
      }),
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("민감정보");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("canonicalizes safe manual edits before sending them to the database", async () => {
    const rpc = vi.fn(async () => ({ data: MEMORY_ID, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
    const request = new Request("http://localhost/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_memory",
        visibility: "bride_private",
        memoryId: MEMORY_ID,
        title: "  Ａ\u200BＢ  ",
        value: "  서울\u2060 동쪽  ",
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_amora_memory_node", {
      p_couple_id: COUPLE_ID,
      p_visibility: "bride_private",
      p_memory_id: MEMORY_ID,
      p_user_id: USER_ID,
      p_title: "AB",
      p_value: "서울 동쪽",
    });
  });

  it("includes the existing semantic key and category in manual-edit DLP checks", async () => {
    mockRequestClient({
      memory_key: "family:baby_timing",
      category: "family",
      title: "현재 상태",
    });
    const rpc = vi.fn(async () => ({ data: MEMORY_ID, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
    const request = new Request("http://localhost/api/amora/memory", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_memory",
        visibility: "bride_private",
        memoryId: MEMORY_ID,
        title: "현재 상태",
        value: "12주차",
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("/api/amora/memory GET profile projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores legacy profile rows and preserves the projected snake_case response shape", async () => {
    const requestFrom = mockGetClients();

    const response = await GET(new Request("http://localhost/api/amora/memory"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestFrom).not.toHaveBeenCalledWith("amora_couple_profiles");
    expect(body.profiles).toEqual([{
      visibility: "shared",
      persona_summary: null,
      budget_posture: null,
      decision_style: null,
      taste_profile: "신부 명시 · venue:preferred_area = 강남",
      communication_style: null,
      conflict_pattern: null,
      recommendation_rules: [],
      open_questions: [],
      confidence_score: 0.9,
      updated_at: "2026-07-15T00:00:00.000Z",
    }]);
    expect(JSON.stringify(body)).not.toContain("LEGACY_PROFILE_MUST_NOT_LEAK");
    expect(body.memories).toEqual([]);
  });

  it("keeps the memory response available but fails profiles closed on a source-query error", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetClients({ profileError: { code: "PGRST200" } });

    const response = await GET(new Request("http://localhost/api/amora/memory"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profiles).toEqual([]);
    expect(body.memories).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-api] profile projection source query failed",
      "PGRST200",
    );
    warning.mockRestore();
  });

  it("fails projected profiles closed when the bounded query reaches 501 rows", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockGetClients({ profileRowCount: 501 });

    const response = await GET(new Request("http://localhost/api/amora/memory"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profiles).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      "[amora-memory-api] profile projection failed closed",
      "too_many_nodes",
    );
    warning.mockRestore();
  });

  it("does not expose stale projected or legacy profile data after consent is disabled", async () => {
    mockGetClients({ sharedEnabled: false });

    const response = await GET(new Request("http://localhost/api/amora/memory"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profiles).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("LEGACY_PROFILE_MUST_NOT_LEAK");
  });
});
