// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production compute and database region affinity", () => {
  it("keeps Vercel server functions in the Supabase production region", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"),
    ) as { regions?: unknown };

    // The linked production database is ap-south-1 (Mumbai). Vercel documents
    // bom1 as the matching compute region; static assets remain global CDN.
    expect(config.regions).toEqual(["bom1"]);
  });
});
