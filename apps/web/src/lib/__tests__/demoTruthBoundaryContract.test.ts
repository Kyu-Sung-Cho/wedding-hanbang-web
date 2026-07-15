import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("demo truth boundary", () => {
  it("labels every authenticated demo screen before showing sample records", () => {
    const layout = read("src/app/(app)/AppClientLayout.tsx");

    expect(layout).toContain("{isDemo && (");
    expect(layout).toContain("샘플 데이터로 보는 데모");
    expect(layout).toContain("실제 기록이 아니며 저장되지 않아요");
  });

  it("keeps fabricated lounge activity inside the verified demo branch", () => {
    const lounge = read("src/app/(app)/lounge/page.tsx");

    expect(lounge).toContain("const demoSavedPosts = useMemo(() => buildDemoSavedPosts(), []);");
    expect(lounge).toContain(
      "const visibleSavedPosts = isDemo ? demoSavedPosts : userId ? savedPosts : [];",
    );
    expect(lounge).toContain("if (isDemo || !userId) return;");
    expect(lounge).toContain("posts={visibleSavedPosts}");
    expect(lounge).not.toContain("setSavedPosts(buildDemoSavedPosts())");
  });
});
