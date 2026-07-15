import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function webFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function repoFile(path: string) {
  return readFileSync(resolve(process.cwd(), "../..", path), "utf8");
}

const genericRoute = webFile("src/app/api/journey/route.ts");
const authStore = webFile("src/stores/authStore.ts");
const actionCard = webFile("src/components/app/chat/ActionCard.tsx");
const schedule = webFile("src/components/app/schedule/ScheduleContent.tsx");
const settings = webFile("src/app/(app)/settings/page.tsx");
const mobileSchedule = repoFile("apps/mobile/app/schedule/index.tsx");
const amoraActionRoute = webFile("src/app/api/amora/actions/[id]/route.ts");
const amoraActionsRoute = webFile("src/app/api/amora/actions/route.ts");
const checklistMigration = repoFile(
  "supabase/migrations/20260713107000_atomic_checklist_item_mutations.sql",
);
const preferencesMigration = repoFile(
  "supabase/migrations/20260713108000_atomic_journey_preferences.sql",
);

describe("journey mutation ownership boundary", () => {
  it("keeps the generic route scalar-only and rejects broad progress snapshots", () => {
    expect(genericRoute).toContain("parseJourneyScalarPatch");
    expect(genericRoute).not.toContain("apply_journey_progress_patch");
    expect(genericRoute).not.toContain("sanitizeJsonObject");
    expect(authStore).toContain("Broad journey progress updates are disabled.");
    expect(authStore).not.toContain("body.progress_patch");
    expect(authStore).not.toContain("body.progress_remove_keys");
  });

  it("uses dedicated clients for checklist and preferences while AI cards stay read-only", () => {
    expect(schedule).toContain("mutateChecklistItem");
    expect(settings).toContain("patchJourneyPreferences(partial)");
    expect(mobileSchedule).toContain("mutateChecklistItem");
    expect(mobileSchedule).not.toContain("progress_patch");
    expect(actionCard).not.toContain("handleToggle");
    expect(actionCard).not.toMatch(/updateJourney\(\{[\s\S]{0,100}progress:/);
  });

  it("retires the duplicate Amora action routes without touching stored rows", () => {
    for (const route of [amoraActionRoute, amoraActionsRoute]) {
      expect(route).toContain("AMORA_ACTIONS_RETIRED_CODE");
      expect(route).toContain("status: 410");
      expect(route).not.toContain("createAdminClient");
      expect(route).not.toContain("createClientFromRequest");
      expect(route).not.toContain("actionRepository");
      expect(route).not.toMatch(/\.(?:insert|update|delete|from)\(/);
    }
  });

  it("serializes one checklist item with compare-and-set and preserves unrelated progress", () => {
    expect(checklistMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(checklistMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(checklistMigration).toContain("CREATE OR REPLACE FUNCTION public.mutate_journey_checklist_item");
    expect(checklistMigration).toMatch(
      /SELECT progress[\s\S]*?FROM public\.wedding_journeys[\s\S]*?FOR UPDATE;/,
    );
    expect(checklistMigration).toContain("v_current_done IS DISTINCT FROM p_expected_done");
    expect(checklistMigration).toContain("jsonb_set(v_progress, ARRAY[p_category_key], v_category, true)");
    expect(checklistMigration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(checklistMigration).toMatch(/FROM PUBLIC, anon, authenticated;/);
    expect(checklistMigration).toMatch(/TO service_role;/);
  });

  it("patches only validated preference fields under the same journey row lock", () => {
    expect(preferencesMigration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(preferencesMigration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(preferencesMigration).toContain("CREATE OR REPLACE FUNCTION public.patch_journey_preferences");
    expect(preferencesMigration).toContain("p_patch - ARRAY['weddingStyle', 'priorities', 'budgetTendency', 'guestCount']");
    expect(preferencesMigration).toMatch(
      /SELECT progress[\s\S]*?FROM public\.wedding_journeys[\s\S]*?FOR UPDATE;/,
    );
    expect(preferencesMigration).toContain("v_preferences := v_preferences || p_patch;");
    expect(preferencesMigration).toContain("jsonb_set(v_progress, '{__preferences}', v_preferences, true)");
    expect(preferencesMigration).toMatch(/FROM PUBLIC, anon, authenticated;/);
  });
});
