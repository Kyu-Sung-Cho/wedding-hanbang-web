// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Supabase service-role module boundary", () => {
  it("marks the credential-bearing admin client as server-only", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/supabase/admin.ts"),
      "utf8",
    );

    expect(source).toMatch(/^import ["']server-only["'];/);
    expect(source).toContain("process.env.SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toMatch(/NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  });
});
