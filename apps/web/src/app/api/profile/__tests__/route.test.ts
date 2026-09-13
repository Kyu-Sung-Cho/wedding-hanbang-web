import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { GET, PATCH } from "../route";
const roleRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/profileWeddingRole", () => ({ readOptionalProfileWeddingRoles: roleRead }));

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/trustedMutation", () => ({
  isTrustedMutationRequest: vi.fn(() => true),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "profile:update:user-1"),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

type QueryResult = {
  data?: unknown;
  error?: unknown;
};

type TableHandler = {
  maybeSingleResult?: QueryResult;
  singleResult?: QueryResult;
  updateResult?: QueryResult;
  insertResult?: QueryResult;
  onUpdate?: (payload: unknown) => void;
  onInsert?: (payload: unknown) => void;
  onSelect?: (columns: string) => void;
  onEq?: (column: string, value: unknown) => void;
};

type RpcResult = {
  data?: unknown;
  error?: unknown;
};

class FakeQuery {
  private operation: "read" | "update" | "insert" = "read";
  private restored = false;

  constructor(
    private readonly handler: TableHandler,
    private readonly restoreHandler?: (handler: TableHandler) => void
  ) {}

  select(columns = "*") {
    this.handler.onSelect?.(columns);
    return this;
  }

  eq(column: string, value: unknown) {
    this.handler.onEq?.(column, value);
    return this;
  }
  neq() { return this; }
  in() { return this; }

  update(payload: unknown) {
    this.operation = "update";
    this.handler.onUpdate?.(payload);
    return this;
  }

  insert(payload: unknown) {
    this.operation = "insert";
    this.handler.onInsert?.(payload);
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    if (
      !this.handler.maybeSingleResult &&
      !this.handler.singleResult &&
      (this.handler.onUpdate || this.handler.onInsert) &&
      !this.restored
    ) {
      this.restored = true;
      this.restoreHandler?.(this.handler);
      return Promise.resolve({ data: null, error: null });
    }

    return Promise.resolve(
      this.handler.maybeSingleResult ??
      this.handler.singleResult ??
      { data: null, error: null }
    );
  }

  single(): Promise<QueryResult> {
    return Promise.resolve(this.handler.singleResult ?? { data: null, error: null });
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const result = this.operation === "update"
      ? this.handler.updateResult
      : this.operation === "insert"
        ? this.handler.insertResult
        : { data: null, error: null };
    return Promise.resolve(result ?? { data: null, error: null }).then(onfulfilled, onrejected);
  }
}

function mockAuthClient(user: {
  id: string;
  email_confirmed_at?: string | null;
} | null = {
  id: "user-1",
  email_confirmed_at: "2026-07-16T00:00:00.000Z",
}) {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockAdminClient(
  tableHandlers: Record<string, TableHandler[]>,
  rpcResult: RpcResult = { data: null, error: null }
) {
  const admin = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler, (restoredHandler) => {
        tableHandlers[table]?.unshift(restoredHandler);
      });
    }),
    rpc: vi.fn().mockResolvedValue(rpcResult),
  };
  vi.mocked(createClient).mockReturnValue(
    admin as unknown as ReturnType<typeof createClient>
  );
  return admin;
}

function createProfilePatchRequest(
  name: string,
  body: Record<string, unknown> = {}
) {
  return new Request("http://localhost/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...body }),
  });
}

describe("/api/profile GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleRead.mockResolvedValue(new Map());
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    mockAuthClient();
  });

  it("rejects an unauthenticated profile read before using the service role", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new Request("http://localhost/api/profile"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns only the authenticated user's mobile profile fields", async () => {
    const filters: Array<[string, unknown]> = [];
    const selectedColumns: string[] = [];
    mockAdminClient({
      profiles: [{
        maybeSingleResult: {
          data: {
            id: "user-1",
            name: "김아모",
            role: "bride",
            couple_id: "couple-1",
            care_notifications_enabled: true,
            care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
            email: "must-not-leak@example.com",
            phone: "01012345678",
            is_admin: true,
          },
          error: null,
        },
        onSelect: (columns) => selectedColumns.push(columns),
        onEq: (column, value) => filters.push([column, value]),
      }],
    });

    const response = await GET(new Request("http://localhost/api/profile", {
      headers: { Authorization: "Bearer valid-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      profile: {
        id: "user-1",
        name: "김아모",
        role: "bride",
        couple_id: "couple-1",
        care_notifications_enabled: true,
        care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
      },
      careAvailability: {
        outboundEnabled: true,
        proactiveChatEnabled: false,
        emailVerified: true,
      },
    });
    expect(filters).toContainEqual(["id", "user-1"]);
    expect(selectedColumns).toEqual([
      "id, name, role, couple_id, care_notifications_enabled, care_notifications_consented_at",
    ]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("fails closed when the authenticated profile lookup fails", async () => {
    mockAdminClient({
      profiles: [{
        maybeSingleResult: {
          data: null,
          error: { message: "database unavailable" },
        },
      }],
    });

    const response = await GET(new Request("http://localhost/api/profile", {
      headers: { Authorization: "Bearer valid-token" },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("never returns a profile record whose id differs from the authenticated user", async () => {
    mockAdminClient({
      profiles: [{
        maybeSingleResult: {
          data: {
            id: "partner-user",
            name: "파트너",
            role: "groom",
            couple_id: "couple-1",
            care_notifications_enabled: true,
            care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
          },
          error: null,
        },
      }],
    });

    const response = await GET(new Request("http://localhost/api/profile"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.not.toHaveProperty("profile");
  });

  it("reports outbound and email verification availability without exposing an email", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    mockAuthClient({ id: "user-1", email_confirmed_at: null });
    mockAdminClient({
      profiles: [{
        maybeSingleResult: {
          data: {
            id: "user-1",
            name: "김아모",
            role: "bride",
            couple_id: null,
            care_notifications_enabled: false,
            care_notifications_consented_at: null,
          },
          error: null,
        },
      }],
    });

    const response = await GET(new Request("http://localhost/api/profile"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.careAvailability).toEqual({
      outboundEnabled: false,
      proactiveChatEnabled: false,
      emailVerified: false,
    });
    expect(JSON.stringify(body)).not.toContain("@");
  });
});

describe("/api/profile PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleRead.mockResolvedValue(new Map());
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "true");
    mockAuthClient();
  });

  it.each([true, false])("preserves optional explicit role while editing a name (lookup available: %s)", async available => {
    mockAdminClient({}, {data:{profile:{id:"user-1",name:"새 이름",role:"bride",avatar_url:"unchanged"},community_profile_synced:false},error:null});
    roleRead.mockResolvedValue(new Map(available ? [["user-1",{user_id:"user-1",confirmed_role:"groom",revision:"r1",couple_id:null}]] : []));
    const response = await PATCH(createProfilePatchRequest("새 이름"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profile).toMatchObject({id:"user-1",name:"새 이름",role:"bride"});
    expect(body.profile).not.toHaveProperty("avatar_url");
    if (available) expect(body.profile).toMatchObject({confirmed_role:"groom",confirmed_role_revision:"r1"});
    else expect(body.profile).not.toHaveProperty("confirmed_role");
  });

  it.each([false, true])("uses the private avatar snapshot when editing the name; lookup failed=%s", async failed => {
    const owner="11111111-1111-4111-8111-111111111111", revision="22222222-2222-4222-8222-222222222222";
    mockAuthClient({id:owner});
    const admin=mockAdminClient({});
    admin.rpc.mockImplementation(async (name:string)=> name==="read_profile_avatar_snapshot"
      ? {data:failed?null:[{user_id:owner,kind:"photo",emoji:null,object_path:`${owner}/${revision}.webp`,revision,updated_at:"2026-09-13T00:00:00Z"}],error:failed?{code:"offline"}:null}
      : {data:{profile:{id:owner,name:"New Name",avatar_url:"https://untrusted.invalid/stale.jpg"},community_profile_synced:false},error:null});
    const response=await PATCH(createProfilePatchRequest("New Name"));
    expect(response.status).toBe(200); const body=await response.json();
    expect(body.profile.name).toBe("New Name");
    if(failed) expect(body.profile).not.toHaveProperty("avatar_url");
    else expect(body.profile.avatar_url).toBe(`/api/profile/avatar/image?userId=${owner}&version=${revision}`);
    expect(JSON.stringify(body)).not.toContain("untrusted.invalid");
  });
  it("commits a mixed profile patch through one atomic database call", async () => {
    const profile = {
      id: "user-1",
      name: "New Name",
      phone: "01012345678",
      phone_care_consented_at: "2026-07-16T01:00:00.000Z",
      care_notifications_enabled: false,
      care_notifications_consented_at: null,
    };
    const admin = mockAdminClient({}, {
      data: {
        profile,
        community_profile_synced: true,
        cancelled_jobs: 2,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("New Name", {
      phone: "010-1234-5678",
      phone_care_consent: true,
      care_notifications_enabled: false,
      sync_community_nickname: true,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile,
      communityProfileSynced: true,
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: "user-1",
      p_name: "New Name",
      p_phone: "01012345678",
      p_phone_provided: true,
      p_phone_care_consent: true,
      p_care_notifications_enabled: false,
      p_community_nickname: "New Name",
      p_community_nickname_provided: false,
      p_force_community_nickname_sync: true,
    });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("updates an independent community nickname through the same atomic API", async () => {
    const profile = { id: "user-1", name: "Legal Name" };
    const admin = mockAdminClient({}, {
      data: {
        profile,
        community_profile_synced: true,
        community_nickname: "Community Nick",
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ community_nickname: "Community Nick" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile,
      communityProfileSynced: true,
      communityNickname: "Community Nick",
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      "patch_profile_atomic",
      expect.objectContaining({
        p_name: null,
        p_community_nickname: "Community Nick",
        p_community_nickname_provided: true,
        p_force_community_nickname_sync: false,
      }),
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("commits a name and explicit community nickname together", async () => {
    const profile = { id: "user-1", name: "Legal Name" };
    const admin = mockAdminClient({}, {
      data: {
        profile,
        community_profile_synced: true,
        community_nickname: "Public Alias",
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("Legal Name", {
      community_nickname: "Public Alias",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile,
      communityProfileSynced: true,
      communityNickname: "Public Alias",
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      "patch_profile_atomic",
      expect.objectContaining({
        p_name: "Legal Name",
        p_community_nickname: "Public Alias",
        p_community_nickname_provided: true,
        p_force_community_nickname_sync: false,
      }),
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects ambiguous explicit and automatic community nickname updates", async () => {
    const admin = mockAdminClient({});

    const response = await PATCH(createProfilePatchRequest("Legal Name", {
      community_nickname: "Public Alias",
      sync_community_nickname: true,
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("동시에 요청할 수 없습니다"),
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a new care opt-in while outbound delivery is disabled", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    const admin = mockAdminClient({});

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ care_notifications_enabled: true }),
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "CARE_OUTBOUND_UNAVAILABLE",
      careAvailability: {
        outboundEnabled: false,
        emailVerified: true,
      },
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("records an explicit consent timestamp when proactive care is enabled", async () => {
    const profile = {
      id: "user-1",
      care_notifications_enabled: true,
      care_notifications_consented_at: "2026-07-16T01:00:00.000Z",
    };
    const admin = mockAdminClient({}, {
      data: { profile, community_profile_synced: false, cancelled_jobs: 0 },
      error: null,
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ care_notifications_enabled: true }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ profile });
    expect(admin.rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: "user-1",
      p_name: null,
      p_phone: null,
      p_phone_provided: false,
      p_phone_care_consent: null,
      p_care_notifications_enabled: true,
      p_community_nickname: null,
      p_community_nickname_provided: false,
      p_force_community_nickname_sync: false,
    });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("clears the consent timestamp when proactive care is disabled", async () => {
    vi.stubEnv("AMORA_CARE_OUTBOUND_ENABLED", "false");
    const profile = {
      id: "user-1",
      care_notifications_enabled: false,
      care_notifications_consented_at: null,
    };
    const admin = mockAdminClient({}, {
      data: { profile, community_profile_synced: false, cancelled_jobs: 2 },
      error: null,
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ care_notifications_enabled: false }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile,
      careAvailability: {
        outboundEnabled: false,
        emailVerified: true,
      },
    });
    expect(admin.rpc).toHaveBeenCalledWith("patch_profile_atomic", {
      p_user_id: "user-1",
      p_name: null,
      p_phone: null,
      p_phone_provided: false,
      p_phone_care_consent: null,
      p_care_notifications_enabled: false,
      p_community_nickname: null,
      p_community_nickname_provided: false,
      p_force_community_nickname_sync: false,
    });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("lets the atomic RPC validate phone consent against the latest profile", async () => {
    const profile = {
      id: "user-1",
      phone: "01012345678",
      phone_care_consented_at: "2026-07-16T01:00:00.000Z",
    };
    const admin = mockAdminClient({}, {
      data: { profile, community_profile_synced: false, cancelled_jobs: 0 },
      error: null,
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_care_consent: true }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ profile });
    expect(admin.rpc).toHaveBeenCalledWith(
      "patch_profile_atomic",
      expect.objectContaining({
        p_phone: null,
        p_phone_provided: false,
        p_phone_care_consent: true,
      }),
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("returns a user-correctable error when the locked profile has no phone", async () => {
    const admin = mockAdminClient({}, {
      data: null,
      error: { message: "PROFILE_PATCH_PHONE_REQUIRED" },
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_care_consent: true }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("휴대폰 번호"),
    });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("fails closed when the atomic RPC returns another user's profile", async () => {
    const admin = mockAdminClient({}, {
      data: {
        profile: { id: "other-user", name: "Wrong User" },
        community_profile_synced: false,
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("Expected User"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.not.toHaveProperty("profile");
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not attempt secondary writes when the atomic profile patch fails", async () => {
    const admin = mockAdminClient({}, {
      data: null,
      error: { message: "database unavailable" },
    });

    const response = await PATCH(new Request("http://localhost/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "All Or Nothing",
        care_notifications_enabled: false,
        sync_community_nickname: true,
      }),
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith(
      "patch_profile_atomic",
      expect.objectContaining({
        p_user_id: "user-1",
        p_name: "All Or Nothing",
        p_care_notifications_enabled: false,
        p_force_community_nickname_sync: true,
      }),
    );
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("syncs community nickname when it still matches the previous profile name", async () => {
    const admin = mockAdminClient({}, {
      data: {
        profile: { id: "user-1", name: "이지은" },
        community_profile_synced: true,
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(true);
    expect(body.profile).toMatchObject({ id: "user-1", name: "이지은" });
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("does not overwrite a custom community nickname", async () => {
    const admin = mockAdminClient({}, {
      data: {
        profile: { id: "user-1", name: "이지은" },
        community_profile_synced: false,
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(false);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("force-syncs community nickname for settings profile saves", async () => {
    const admin = mockAdminClient({}, {
      data: {
        profile: { id: "user-1", name: "이지은" },
        community_profile_synced: true,
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(
      createProfilePatchRequest("이지은", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(true);
    expect(admin.rpc).toHaveBeenCalledWith(
      "patch_profile_atomic",
      expect.objectContaining({
        p_name: "이지은",
        p_community_nickname: "이지은",
        p_force_community_nickname_sync: true,
      }),
    );
  });

  it("rejects a forced community nickname sync when the nickname is already taken", async () => {
    const admin = mockAdminClient({}, {
      data: null,
      error: {
        code: "23505",
        message: "duplicate key value violates idx_community_profiles_nickname_key_unique",
        details: "Key (nickname_key)=(takenname) already exists.",
      },
    });

    const response = await PATCH(
      createProfilePatchRequest("Taken Name", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("이미 사용 중");
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects a forced community nickname sync when the nickname is reserved", async () => {
    const admin = mockAdminClient({});

    const response = await PATCH(
      createProfilePatchRequest("admin", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("공식 계정");
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("keeps profile update successful when community profile does not exist yet", async () => {
    const admin = mockAdminClient({}, {
      data: {
        profile: { id: "user-1", name: "이지은" },
        community_profile_synced: false,
        cancelled_jobs: 0,
      },
      error: null,
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({ id: "user-1", name: "이지은" });
    expect(body.communityProfileSynced).toBe(false);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.from).not.toHaveBeenCalled();
  });
});
