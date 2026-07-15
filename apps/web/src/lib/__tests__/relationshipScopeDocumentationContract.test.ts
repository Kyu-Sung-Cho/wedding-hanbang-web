import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readFromRepository(path: string): string {
  return readFileSync(resolve(process.cwd(), "../..", path), "utf8");
}

describe("relationship scope release boundary", () => {
  it("keeps broad public launch blocked until the two-role privacy model is migrated", () => {
    const service = readFromRepository("WEDDINGHANBANG_SERVICE_DOC.md");
    const status = readFromRepository("PROJECT_STATUS.md");
    const terms = readFromRepository("apps/web/src/app/terms/page.tsx");
    const privacy = readFromRepository("apps/web/src/app/privacy/page.tsx");
    const blocker = readFromRepository(
      "docs/RELATIONSHIP_SCOPE_BETA_LIMIT_2026-07-13.md",
    );

    expect(service).toContain("신부 1명·신랑 1명 역할 구조만 지원");
    expect(status).toContain("관계 구성 확대는 출시 차단 항목");
    expect(terms).toContain("PUBLIC_BETA_RELATIONSHIP_SCOPE.notice");
    expect(privacy).toContain("PUBLIC_BETA_RELATIONSHIP_SCOPE.notice");

    for (const boundary of [
      "couples.bride_id",
      "couples.groom_id",
      "join_couple",
      "bride_private",
      "groom_private",
      "NO-GO",
    ]) {
      expect(blocker, boundary).toContain(boundary);
    }
  });
});
