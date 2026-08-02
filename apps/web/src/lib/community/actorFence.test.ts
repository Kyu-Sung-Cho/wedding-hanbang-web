import { describe, expect, it, vi } from "vitest";

import {
  CommunityActorChangedError,
  EXPECTED_COMMUNITY_ACTOR_HEADER,
  expectedCommunityActorHeaders,
  requestMatchesExpectedCommunityActor,
  runWithExpectedCommunityActor,
} from "./actorFence";

describe("community actor write fence", () => {
  it("does not invoke a post mutation when A changes to B during verification", async () => {
    let current = { actorKey: "user:a", kind: "user", userId: "a" };
    let resolveUser!: (value: string | null) => void;
    const verifiedUser = new Promise<string | null>((resolve) => {
      resolveUser = resolve;
    });
    const operation = vi.fn(async () => "posted");

    const pending = runWithExpectedCommunityActor({
      expectedActorKey: "user:a",
      expectedUserId: "a",
      getCurrentActor: () => current,
      getVerifiedUserId: () => verifiedUser,
      operation,
    });
    current = { actorKey: "user:b", kind: "user", userId: "b" };
    resolveUser("b");

    await expect(pending).rejects.toBeInstanceOf(CommunityActorChangedError);
    expect(operation).not.toHaveBeenCalled();
  });

  it("sends a constraining actor header and rejects a mismatched server actor", () => {
    const headers = new Headers(expectedCommunityActorHeaders("a"));
    expect(headers.get(EXPECTED_COMMUNITY_ACTOR_HEADER)).toBe("a");
    expect(requestMatchesExpectedCommunityActor({ headers }, "a")).toBe(true);
    expect(requestMatchesExpectedCommunityActor({ headers }, "b")).toBe(false);
  });

  it("rejects account A's completed result when account B takes over in flight", async () => {
    let current = { actorKey: "user:a", kind: "user", userId: "a" };

    await expect(runWithExpectedCommunityActor({
      expectedActorKey: "user:a",
      expectedUserId: "a",
      getCurrentActor: () => current,
      getVerifiedUserId: async () => "a",
      operation: async () => {
        current = { actorKey: "user:b", kind: "user", userId: "b" };
        return "created-post-id";
      },
    })).rejects.toBeInstanceOf(CommunityActorChangedError);
  });
});
