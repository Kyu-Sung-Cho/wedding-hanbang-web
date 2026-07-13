import { describe, expect, it } from "vitest";
import { publicCourtNickname } from "../publicIdentity";

describe("public court pseudonym", () => {
  it("is deterministic without exposing the public post id", () => {
    const postId = "c2be9df7-f4a8-4f24-842e-75fe1d1f9831";
    const first = publicCourtNickname(postId);

    expect(publicCourtNickname(postId)).toBe(first);
    expect(first).not.toContain(postId);
    expect(first).toMatch(/커플$/);
  });

  it("gives different sample posts distinct labels", () => {
    expect(publicCourtNickname("00000000-0000-4000-8000-000000000001"))
      .not.toBe(publicCourtNickname("00000000-0000-4000-8000-000000000002"));
  });
});
