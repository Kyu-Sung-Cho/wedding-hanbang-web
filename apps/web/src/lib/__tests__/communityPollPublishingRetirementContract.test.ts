import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("community poll publishing public-beta boundary", () => {
  it("keeps new poll publishing closed while the write is not atomic", () => {
    const route = read("src/app/api/community/posts/route.ts");
    const rejectAt = route.indexOf('hasOwnProperty.call(body, "poll")');
    const postInsertAt = route.indexOf('.from("community_posts")', route.indexOf("export async function POST"));
    expect(rejectAt).toBeGreaterThan(0);
    expect(postInsertAt).toBeGreaterThan(rejectAt);
    expect(route).toContain('code: "community_poll_writes_retired"');
    expect(route).toContain("{ status: 410 }");

    const composer = read("src/app/(community)/community/post/write/page.tsx");
    expect(composer).not.toContain("PollEditor");
    expect(composer).not.toContain("pollPayload");
  });
});
