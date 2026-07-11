import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const protectedClientPages = [
  "src/app/(app)/vendors/favorites/page.tsx",
  "src/app/(community)/community/my/bookmarks/page.tsx",
  "src/app/(community)/community/my/posts/page.tsx",
  "src/app/(community)/community/my/upvoted/page.tsx",
];

describe("browser Supabase initialization boundary", () => {
  it.each(protectedClientPages)(
    "%s does not create a browser client during prerender",
    (relativePath) => {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8");

      expect(source).not.toContain('from "@supabase/ssr"');
      expect(source).toContain('from "@/lib/supabase/client"');
      expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*const supabase = createClient\(\)/);
    }
  );

  it("never exposes internal exception messages or stacks to consumers", () => {
    const source = readFileSync(join(process.cwd(), "src/app/global-error.tsx"), "utf8");

    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.stack");
    expect(source).toContain('href="/support"');
  });
});
