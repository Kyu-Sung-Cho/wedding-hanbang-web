import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClientFromRequest } from "@/lib/supabase/server";
import { POST } from "../route";

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(),
}));

describe("POST /api/community/comments public-beta boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a new comment or reply before authentication and database work", async () => {
    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "community_comment_writes_retired",
      error:
        "새 댓글과 답글 작성은 현재 제공하지 않습니다. 기존 댓글은 읽을 수 있고 작성자는 수정·삭제할 수 있습니다.",
    });
    expect(createClientFromRequest).not.toHaveBeenCalled();
  });
});
