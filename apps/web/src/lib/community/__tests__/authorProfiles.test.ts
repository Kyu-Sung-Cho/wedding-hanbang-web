import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import {
  CommunityAuthorProfileUnavailableError,
  getCommunityAuthorMap,
} from "@/lib/community/authorProfiles";

function clientReturning(result: unknown): SupabaseClient {
  const query = {
    select: vi.fn(),
    in: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);

  return {
    from: vi.fn(() => query),
  } as unknown as SupabaseClient;
}

describe("getCommunityAuthorMap", () => {
  it("fails closed when a post author has no community profile", async () => {
    const client = clientReturning({ data: [], error: null });

    await expect(getCommunityAuthorMap(client, ["author-1"]))
      .rejects.toBeInstanceOf(CommunityAuthorProfileUnavailableError);
  });

  it("fails closed when the community profile lookup fails", async () => {
    const client = clientReturning({
      data: [
        {
          user_id: "author-1",
          nickname: "작성자",
          avatar_url: null,
        },
      ],
      error: { message: "profile database unavailable" },
    });

    await expect(getCommunityAuthorMap(client, ["author-1"]))
      .rejects.toBeInstanceOf(CommunityAuthorProfileUnavailableError);
  });

  it("fails closed when a returned profile is incomplete instead of fabricating a nickname", async () => {
    const client = clientReturning({
      data: [
        {
          user_id: "author-1",
          nickname: null,
          avatar_url: null,
        },
      ],
      error: null,
    });

    await expect(getCommunityAuthorMap(client, ["author-1"]))
      .rejects.toBeInstanceOf(CommunityAuthorProfileUnavailableError);
  });
});
