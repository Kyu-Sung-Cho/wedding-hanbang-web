import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const commentItem = readFileSync(
  resolve(root, "apps/web/src/components/community/CommentItem.tsx"),
  "utf8",
);
const commentsRoute = readFileSync(
  resolve(root, "apps/web/src/app/api/community/comments/route.ts"),
  "utf8",
);

describe("historical community comment trust boundary", () => {
  it("does not reinterpret a legacy account or marker as a current official AI answer", () => {
    expect(commentItem).not.toContain("NEXT_PUBLIC_AMORA_USER_ID");
    expect(commentItem).not.toContain("AMORA_USER_ID");
    expect(commentItem).not.toContain("[amora_cta]");
    expect(commentItem).not.toContain("renderAmoraContent");
    expect(commentItem).not.toContain("isAmoraAI");
    expect(commentItem).not.toContain("Sparkles");
    expect(commentItem).toContain("기존 댓글 본문은 출처를 새로 해석하지 않고 중립적으로 표시");
    expect(commentsRoute).toContain("content: sanitizeText(row.content)");
  });

  it("targets the exact comment report route and requires an explicit success payload", () => {
    expect(commentItem).toContain(
      "fetch(`/api/community/comments/${comment.id}/report`",
    );
    expect(commentItem).toContain("payload?.success !== true");
    expect(commentItem).toContain('role="dialog"');
    expect(commentItem).toContain('aria-modal="true"');
    expect(commentItem).toContain('role="alert"');
  });
});
