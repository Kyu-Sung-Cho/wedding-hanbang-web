// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkRateLimitPersistent: vi.fn<() => Promise<Response | null>>(),
  createAdminClient: vi.fn(),
  createClientFromRequest: vi.fn(),
  getCommunityPublicIdForUser: vi.fn(),
  hasAdminStepUp: vi.fn(),
  requestMatchesExpectedCommunityActor: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: mocks.createClientFromRequest,
}));
vi.mock("@/lib/auth/adminStepUp", () => ({
  hasAdminStepUp: mocks.hasAdminStepUp,
}));
vi.mock("@/lib/community/actorFence", () => ({
  requestMatchesExpectedCommunityActor: mocks.requestMatchesExpectedCommunityActor,
}));
vi.mock("@/lib/community/publicIdentity", () => ({
  getCommunityPublicIdForUser: mocks.getCommunityPublicIdForUser,
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (scope: string) => `${scope}:test`,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import {
  DELETE as deletePost,
  GET as getPost,
  PATCH as patchPost,
} from "./route";
import {
  DELETE as deleteComment,
  PATCH as patchComment,
} from "../../comments/[id]/route";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const OWNER_ID = "00000000-0000-4000-8000-000000000002";
const TARGET_ID = "10000000-0000-4000-8000-000000000001";

type QueryResult = { data: unknown; error: unknown };

function queryChain(result: QueryResult) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "neq", "in", "is", "order"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  return chain;
}

function mutationRequest(
  method: "PATCH" | "DELETE",
  body: Record<string, unknown> | undefined,
  withStepUp: boolean,
) {
  const headers = new Headers({
    Origin: "https://hanbang.ai",
    "Sec-Fetch-Site": "same-origin",
  });
  if (body) headers.set("Content-Type", "application/json");
  if (withStepUp) headers.set("Cookie", "admin-step-up=valid");
  return new Request(`https://hanbang.ai/api/community/content/${TARGET_ID}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("community content admin step-up boundary", () => {
  let targetAuthorId = OWNER_ID;
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    targetAuthorId = OWNER_ID;
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.requestMatchesExpectedCommunityActor.mockReturnValue(true);
    mocks.getCommunityPublicIdForUser.mockResolvedValue("admin-public-id");
    mocks.hasAdminStepUp.mockImplementation(
      (cookie: string | null, userId: string) =>
        userId === ADMIN_ID && cookie?.includes("admin-step-up=valid") === true,
    );

    const requestClient = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: ADMIN_ID } } })),
      },
      from: vi.fn((table: string) => {
        if (table !== "community_posts") {
          throw new Error(`unexpected request table: ${table}`);
        }
        return queryChain({
          data: {
            id: TARGET_ID,
            author_id: "owner-public-id",
            visibility: "public",
            under_review: true,
          },
          error: null,
        });
      }),
    };

    rpc = vi.fn((name: string) => {
      if (name === "community_update_post_for_actor") {
        return queryChain({ data: { id: TARGET_ID, title: "moderated" }, error: null });
      }
      if (name === "community_update_comment_for_actor") {
        return queryChain({ data: { id: TARGET_ID, content: "moderated" }, error: null });
      }
      if (
        name === "community_delete_post_for_actor"
        || name === "community_delete_comment_for_actor"
      ) {
        return Promise.resolve({ data: true, error: null });
      }
      throw new Error(`unexpected RPC: ${name}`);
    });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "profiles") {
          return queryChain({ data: { is_admin: true }, error: null });
        }
        if (table === "community_posts") {
          return queryChain({
            data: { author_id: targetAuthorId, slides: null, images: [] },
            error: null,
          });
        }
        if (table === "community_comments") {
          return queryChain({
            data: { author_id: targetAuthorId, is_deleted: false },
            error: null,
          });
        }
        throw new Error(`unexpected admin table: ${table}`);
      }),
      rpc,
    };

    mocks.createClientFromRequest.mockResolvedValue(requestClient);
    mocks.createAdminClient.mockReturnValue(adminClient);
  });

  const mutationCases = [
    {
      label: "post PATCH",
      invoke: (request: Request) => patchPost(request as never, {
        params: Promise.resolve({ id: TARGET_ID }),
      }),
      method: "PATCH" as const,
      body: { title: "moderated" },
      rpcName: "community_update_post_for_actor",
    },
    {
      label: "post DELETE",
      invoke: (request: Request) => deletePost(request as never, {
        params: Promise.resolve({ id: TARGET_ID }),
      }),
      method: "DELETE" as const,
      body: undefined,
      rpcName: "community_delete_post_for_actor",
    },
    {
      label: "comment PATCH",
      invoke: (request: Request) => patchComment(request as never, {
        params: Promise.resolve({ id: TARGET_ID }),
      }),
      method: "PATCH" as const,
      body: { content: "moderated" },
      rpcName: "community_update_comment_for_actor",
    },
    {
      label: "comment DELETE",
      invoke: (request: Request) => deleteComment(request as never, {
        params: Promise.resolve({ id: TARGET_ID }),
      }),
      method: "DELETE" as const,
      body: undefined,
      rpcName: "community_delete_comment_for_actor",
    },
  ];

  for (const mutation of mutationCases) {
    it(`rejects ${mutation.label} of another user's content without step-up`, async () => {
      const response = await mutation.invoke(
        mutationRequest(mutation.method, mutation.body, false),
      );

      expect(response.status).toBe(403);
      expect(mocks.hasAdminStepUp).toHaveBeenCalledWith(null, ADMIN_ID);
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`allows ${mutation.label} of another user's content with valid step-up`, async () => {
      const response = await mutation.invoke(
        mutationRequest(mutation.method, mutation.body, true),
      );

      expect(response.status).toBe(200);
      expect(mocks.hasAdminStepUp).toHaveBeenCalledWith(
        expect.stringContaining("admin-step-up=valid"),
        ADMIN_ID,
      );
      expect(rpc).toHaveBeenCalledWith(
        mutation.rpcName,
        expect.objectContaining({
          p_actor_id: ADMIN_ID,
          p_allow_admin_override: true,
        }),
      );
    });

    it(`keeps owner ${mutation.label} available without admin step-up`, async () => {
      targetAuthorId = ADMIN_ID;
      const response = await mutation.invoke(
        mutationRequest(mutation.method, mutation.body, false),
      );

      expect(response.status).toBe(200);
      expect(mocks.hasAdminStepUp).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith(
        mutation.rpcName,
        expect.objectContaining({
          p_actor_id: ADMIN_ID,
          p_allow_admin_override: false,
        }),
      );
    });
  }

  it("does not let an admin without step-up read another user's hidden post", async () => {
    const response = await getPost(
      new Request(`https://hanbang.ai/api/community/posts/${TARGET_ID}`) as never,
      { params: Promise.resolve({ id: TARGET_ID }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.hasAdminStepUp).toHaveBeenCalledWith(null, ADMIN_ID);
  });
});
