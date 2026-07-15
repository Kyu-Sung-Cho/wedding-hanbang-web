import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClientFromRequest } from "@/lib/supabase/server";
import { getMutedActorIds, mutedActorFilterValue } from "@/lib/community/mutes";
import { getCommunityActorIdForUser } from "@/lib/community/actorIdentity";
import { GET } from "../route";

vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/community/mutes", () => ({
  getMutedActorIds: vi.fn(async () => []),
  mutedActorFilterValue: vi.fn(() => null),
}));
vi.mock("@/lib/community/actorIdentity", () => ({
  getCommunityActorIdForUser: vi.fn(async () => null),
}));

const USER_ID = "123e4567-e89b-42d3-a456-426614174000";
const MUTED_USER_ID = "223e4567-e89b-42d3-a456-426614174000";

function query(result: unknown) {
  const value = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue(result),
  };
  value.select.mockReturnValue(value);
  value.eq.mockReturnValue(value);
  value.in.mockReturnValue(value);
  value.not.mockReturnValue(value);
  value.order.mockReturnValue(value);
  return value;
}

describe("GET /api/community/posts/voted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMutedActorIds).mockResolvedValue([]);
    vi.mocked(mutedActorFilterValue).mockReturnValue(null);
    vi.mocked(getCommunityActorIdForUser).mockResolvedValue(null);
  });

  it("fails closed when authentication cannot be verified", async () => {
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "auth unavailable" },
        }),
      },
      from: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new NextRequest("http://localhost/api/community/posts/voted"));

    expect(response.status).toBe(503);
  });

  it("filters the vote count through readable, unmuted posts before pagination", async () => {
    const votes = query({ data: [], count: 0, error: null });
    vi.mocked(getMutedActorIds).mockResolvedValue([MUTED_USER_ID]);
    vi.mocked(mutedActorFilterValue).mockReturnValue(`(${MUTED_USER_ID})`);
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      from: vi.fn(() => votes),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new NextRequest("http://localhost/api/community/posts/voted"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ posts: [], total: 0, hasMore: false });
    expect(votes.select).toHaveBeenCalledWith(
      "post_id, created_at, community_posts!inner(author_public_id)",
      { count: "exact" },
    );
    expect(votes.not).toHaveBeenCalledWith(
      "community_posts.author_public_id",
      "in",
      `(${MUTED_USER_ID})`,
    );
    expect(votes.range).toHaveBeenCalledWith(0, 19);
  });

  it("does not present an unknown filtered count as zero", async () => {
    const votes = query({ data: [], count: null, error: null });
    vi.mocked(createClientFromRequest).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
      },
      from: vi.fn(() => votes),
    } as unknown as Awaited<ReturnType<typeof createClientFromRequest>>);

    const response = await GET(new NextRequest("http://localhost/api/community/posts/voted"));

    expect(response.status).toBe(503);
  });
});
