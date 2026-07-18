import { describe, expect, it } from "vitest";

import {
  finalizeReviewPage,
  parseReviewPageRequest,
} from "../reviewPagination";

describe("admin review pagination", () => {
  it("rejects malformed or unbounded cursors and limits", () => {
    expect(parseReviewPageRequest(new URLSearchParams("limit=0"))).toBeNull();
    expect(parseReviewPageRequest(new URLSearchParams("limit=1.5"))).toBeNull();
    expect(parseReviewPageRequest(new URLSearchParams("cursor=-1"))).toBeNull();
    expect(parseReviewPageRequest(new URLSearchParams("cursor=v1:01"))).toBeNull();
    expect(parseReviewPageRequest(new URLSearchParams("cursor=v2:100"))).toBeNull();
    expect(parseReviewPageRequest(new URLSearchParams("limit=999"))).toEqual({
      limit: 200,
      offset: 0,
    });
  });

  it("walks more than 200 deterministically ordered rows without a gap or duplicate", () => {
    const rows = Array.from({ length: 437 }, (_, index) => ({
      id: `row-${index.toString().padStart(3, "0")}`,
    }));
    const visited: string[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: "73" });
      if (cursor) params.set("cursor", cursor);
      const request = parseReviewPageRequest(params);
      expect(request).not.toBeNull();
      const fetched = rows.slice(request!.offset, request!.offset + request!.limit + 1);
      const page = finalizeReviewPage(fetched, request!);
      visited.push(...page.items.map(({ id }) => id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(visited).toEqual(rows.map(({ id }) => id));
    expect(new Set(visited).size).toBe(rows.length);
  });
});
