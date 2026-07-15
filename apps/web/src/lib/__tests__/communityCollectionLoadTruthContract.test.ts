import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("saved community collection load truth", () => {
  it.each([
    "apps/web/src/app/(community)/community/my/bookmarks/page.tsx",
    "apps/web/src/app/(community)/community/my/upvoted/page.tsx",
  ])("%s separates load failure from a genuinely empty list", (path) => {
    const source = read(path);

    expect(source).toContain("loadError");
    expect(source).toContain('role="alert"');
    expect(source).toContain("다시 시도");
    expect(source).toContain("없어진 것은 아니에요");
    expect(source).toMatch(/if \(!res\.ok\) throw new Error/);
    expect(source).toContain("invalid_response");
    expect(source).toContain("Array.isArray");
    expect(source).toContain("authError");
  });
});
