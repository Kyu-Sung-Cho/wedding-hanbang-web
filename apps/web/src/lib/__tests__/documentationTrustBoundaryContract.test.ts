import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const retiredStrategyDocuments = [
  "docs/AMORA_WEDDING_OS_PLAYBOOK.md",
  "docs/AMORA_LIFECYCLE_PARTNER_DESIGN.md",
  "docs/COMMUNITY_ENGINE_MASTERPLAN_2026-06-10.md",
  "docs/COMMUNITY_KEY_CONCEPT_2026-06-10.md",
  "docs/QUOTE_LEDGER_MASTERPLAN_2026-06-10.md",
  "docs/TRUST_MOAT_ROADMAP.md",
  "docs/VENDOR_AND_PAYMENT_STRATEGY.md",
  "docs/VENDOR_SUPPLY_PLAYBOOK.md",
  "docs/DEVELOPMENT_PLAN.md",
  "docs/BACKLOG.md",
  "docs/SESSION_SYNTHESIS_2026-06-11.md",
  "docs/SESSION_SYNTHESIS_2026-07-06.md",
];

describe("documentation trust boundary", () => {
  it.each(retiredStrategyDocuments)(
    "%s cannot be mistaken for a current product or launch plan",
    (path) => {
      const document = read(path);

      expect(document).toContain("폐기된 역사 문서");
      expect(document).toContain("현재 구현·로드맵·마케팅·세일즈 근거로 사용 금지");
      expect(document).toContain("WEDDINGHANBANG_SERVICE_DOC.md");
      expect(document).toContain("PROJECT_STATUS.md");
      expect(document).toContain("CONSUMER_NEEDS_PRODUCT_DESIGN_2026.md");
    },
  );
});
