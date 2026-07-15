import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("Amora route derived-memory privacy contract", () => {
  it("does not inject unverified legacy summaries or profiles", () => {
    expect(routeSource).not.toContain('.from("chat_summaries")');
    expect(routeSource).not.toContain("loadAmoraProfiles(");
  });

  it("loads decisions only when partner exclusion provenance is explicit", () => {
    expect(routeSource).toContain("VERIFIED_PARTNER_EXCLUDED_PROVENANCE");
    expect(routeSource.match(/\.contains\("metadata", VERIFIED_PARTNER_EXCLUDED_PROVENANCE\)/g))
      .toHaveLength(2);
  });
});
