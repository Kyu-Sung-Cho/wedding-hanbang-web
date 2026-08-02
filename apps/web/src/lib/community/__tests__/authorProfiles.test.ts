import { describe, expect, it, vi } from "vitest";

import { getCommunityAuthorMap } from "../authorProfiles";

describe("public community author projection", () => {
  it("never exposes private relationship or wedding timing fields", async () => {
    const inQuery = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "10000000-0000-4000-8000-000000000001",
          nickname: "공개 닉네임",
          avatar_url: null,
          rank: "sprout",
          wedding_year: 2027,
          wedding_month: 5,
        },
      ],
      error: null,
    });
    const select = vi.fn(() => ({ in: inQuery }));
    const from = vi.fn(() => ({ select }));

    const map = await getCommunityAuthorMap(
      { from } as never,
      ["10000000-0000-4000-8000-000000000001"],
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("community_profiles");
    expect(select).toHaveBeenCalledWith(
      "user_id:community_public_id, nickname, avatar_url, rank",
    );
    expect(inQuery).toHaveBeenCalledWith(
      "community_public_id",
      ["10000000-0000-4000-8000-000000000001"],
    );
    expect(map["10000000-0000-4000-8000-000000000001"]).toMatchObject({
      nickname: "공개 닉네임",
      wedding_year: null,
      wedding_month: null,
      role: null,
    });
  });
});
