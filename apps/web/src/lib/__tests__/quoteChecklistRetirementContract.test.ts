import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

const projectRoot = path.resolve(process.cwd());
const read = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

describe("quote checklist public retirement contract", () => {
  it("has no dormant capability switch and keeps the model schema closed", () => {
    const sharedConstants = read("../../packages/shared/src/constants/index.ts");
    expect(sharedConstants).not.toMatch(/PUBLIC_BETA_CAPABILITIES|quoteChecklist/);
    expect(WEDDING_TOOLS.map((tool) => tool.name)).not.toContain("analyze_quote");
  });

  it("renders only an unavailable surface at the former entry route", () => {
    const page = read("src/app/(community)/community/quote-check/page.tsx");
    expect(page).toContain("PublicBetaUnavailable");
    expect(page).toContain('feature="quoteChecklist"');
    expect(page).not.toContain("analyzeAmoraQuoteCheck");
    expect(page).not.toContain("/api/amora/quote-check");
  });

  it("retires the legacy public reader before bearer parameters or storage", () => {
    const publicApi = read("src/app/api/amora/quote-check/[id]/public/route.ts");
    const legacyPage = read("src/app/quote/[id]/page.tsx");
    expect(publicApi).toContain("quote_check_public_read_retired");
    expect(publicApi).toContain("status: 410");
    expect(publicApi).toContain("export async function GET");
    expect(publicApi).not.toMatch(/createAdminClient|supabase|params|amora_quote_checks|\.from\(/);
    expect(legacyPage).toContain("PublicBetaUnavailable");
    expect(legacyPage).toContain('feature="quoteChecklist"');
  });

  it("has no active marketing, navigation, lifecycle, or chat-card entry point", () => {
    const activeSurfaceFiles = [
      "src/app/demo/page.tsx",
      "src/app/layout.tsx",
      "src/app/sitemap.ts",
      "src/app/terms/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/(community)/community/about/page.tsx",
      "src/app/(community)/community/vendor/[name]/page.tsx",
      "src/components/app/WeeklyCard.tsx",
      "src/components/community/CommunityLandingClient.tsx",
      "src/components/customer-landing/CustomerComparison.tsx",
      "src/components/customer-landing/CustomerHero.tsx",
      "src/components/customer-landing/CustomerStats.tsx",
      "src/components/customer-landing/CustomerTestimonials.tsx",
      "src/components/landing/FiveRoles.tsx",
      "src/components/landing/Footer.tsx",
      "src/constants/beta.ts",
      "src/constants/moments.ts",
      "src/lib/amora/lifecycle.ts",
    ];

    for (const relativePath of activeSurfaceFiles) {
      const source = read(relativePath);
      expect(source, relativePath).not.toContain("/community/quote-check");
      expect(source, relativePath).not.toMatch(/견적\s*체크(?:리스트)?/);
    }
    expect(
      fs.existsSync(path.join(projectRoot, "src/components/app/chat/VendorToolCard.tsx")),
    ).toBe(false);
  });

  it("enforces retirement in the database while preserving read and revoke", () => {
    const migration = read("../../supabase/migrations/20260713109000_retire_quote_check_writes.sql");
    expect(migration).toContain("UPDATE public.amora_quote_checks");
    expect(migration).toContain("SET is_public = FALSE");
    expect(migration).toContain("BEFORE INSERT OR UPDATE");
    expect(migration).toContain("TG_OP = 'INSERT'");
    expect(migration).toContain("OLD.is_public = TRUE");
    expect(migration).toContain("NEW.is_public = FALSE");
    expect(migration).toContain("NEW.published_at IS NULL");
    expect(migration).not.toContain("DELETE ON");
  });
});
