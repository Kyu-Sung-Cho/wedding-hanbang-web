import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { PATCH } from "../route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  rateLimitKey: vi.fn(() => "profile:update:user-1"),
}));

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
};

class FakeQuery {
  private operation: "read" | "update" | "insert" = "read";
  private restored = false;

  constructor(
    private readonly handler: TableHandler,
    private readonly restoreHandler?: (handler: TableHandler) => void
  ) {}

  select() { return this; }
  eq() { return this; }
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

function mockAuthClient() {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "user-1" } },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);
}

function mockAdminClient(tableHandlers: Record<string, TableHandler[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const handler = tableHandlers[table]?.shift() ?? {};
      return new FakeQuery(handler, (restoredHandler) => {
        tableHandlers[table]?.unshift(restoredHandler);
      });
    }),
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

describe("/api/profile PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthClient();
  });

  it("syncs community nickname when it still matches the previous profile name", async () => {
    let communityUpdate: unknown = null;
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "김지은" }, error: null } },
        {
          singleResult: {
            data: { id: "user-1", name: "이지은", email: "test@example.com" },
            error: null,
          },
        },
      ],
      community_profiles: [
        { maybeSingleResult: { data: { nickname: "김지은" }, error: null } },
        {
          onUpdate: (payload) => {
            communityUpdate = payload;
          },
          updateResult: { error: null },
        },
      ],
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(true);
    expect(body.profile).toMatchObject({ id: "user-1", name: "이지은" });
    expect(communityUpdate).toEqual({ nickname: "이지은" });
  });

  it("does not overwrite a custom community nickname", async () => {
    let communityUpdate: unknown = null;
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "김지은" }, error: null } },
        {
          singleResult: {
            data: { id: "user-1", name: "이지은", email: "test@example.com" },
            error: null,
          },
        },
      ],
      community_profiles: [
        { maybeSingleResult: { data: { nickname: "웨딩덕후" }, error: null } },
        {
          onUpdate: (payload) => {
            communityUpdate = payload;
          },
          updateResult: { error: null },
        },
      ],
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(false);
    expect(communityUpdate).toBeNull();
  });

  it("force-syncs community nickname for settings profile saves", async () => {
    let communityUpdate: unknown = null;
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "이미바뀐이름" }, error: null } },
        {
          singleResult: {
            data: { id: "user-1", name: "이지은", email: "test@example.com" },
            error: null,
          },
        },
      ],
      community_profiles: [
        { maybeSingleResult: { data: { nickname: "김지은" }, error: null } },
        {
          onUpdate: (payload) => {
            communityUpdate = payload;
          },
          updateResult: { error: null },
        },
      ],
    });

    const response = await PATCH(
      createProfilePatchRequest("이지은", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.communityProfileSynced).toBe(true);
    expect(communityUpdate).toEqual({ nickname: "이지은" });
  });

  it("rejects a forced community nickname sync when the nickname is already taken", async () => {
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "Old Name" }, error: null } },
      ],
      community_profiles: [
        { maybeSingleResult: { data: { nickname: "Old Name" }, error: null } },
        { maybeSingleResult: { data: { user_id: "other-user" }, error: null } },
      ],
    });

    const response = await PATCH(
      createProfilePatchRequest("Taken Name", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("이미 사용 중");
  });

  it("rejects a forced community nickname sync when the nickname is reserved", async () => {
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "Old Name" }, error: null } },
      ],
      community_profiles: [
        { maybeSingleResult: { data: { nickname: "Old Name" }, error: null } },
      ],
    });

    const response = await PATCH(
      createProfilePatchRequest("admin", { sync_community_nickname: true })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("공식 계정");
  });

  it("keeps profile update successful when community profile does not exist yet", async () => {
    mockAdminClient({
      profiles: [
        { maybeSingleResult: { data: { name: "김지은" }, error: null } },
        {
          singleResult: {
            data: { id: "user-1", name: "이지은", email: "test@example.com" },
            error: null,
          },
        },
      ],
      community_profiles: [
        { maybeSingleResult: { data: null, error: null } },
      ],
    });

    const response = await PATCH(createProfilePatchRequest("이지은"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.profile).toMatchObject({ id: "user-1", name: "이지은" });
    expect(body.communityProfileSynced).toBe(false);
  });
});
