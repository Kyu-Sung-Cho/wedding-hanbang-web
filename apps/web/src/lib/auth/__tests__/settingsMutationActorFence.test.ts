import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
  "utf8",
);

describe("web settings account-switch fence", () => {
  it("binds profile and journey edits to the owner whose settings were loaded", () => {
    expect(settingsSource).toContain("const [loadedSettingsOwnerId, setLoadedSettingsOwnerId]");
    expect(settingsSource).toMatch(
      /updateProfile\(\{ care_notifications_enabled: false \}, expectedActorUserId\)/u,
    );
    expect(settingsSource.match(/updateJourney\([\s\S]{0,220}expectedActorUserId\)/gu)?.length)
      .toBeGreaterThanOrEqual(4);
    expect(settingsSource).toContain(
      "[HANBANG_EXPECTED_ACTOR_USER_ID_HEADER]: expectedActorUserId",
    );
  });

  it("closes owner-bound forms and destructive confirmations before adopting another owner", () => {
    expect(settingsSource).toContain("setShowDeleteModal(false)");
    expect(settingsSource).toContain("setShowResetWeddingModal(false)");
    expect(settingsSource).toContain("setDeleteConfirmText(\"\")");
    expect(settingsSource).toContain("setResetWeddingConfirmText(\"\")");
    expect(settingsSource).toContain("setEditingName(false)");
    expect(settingsSource).toContain("setEditingDate(false)");
    expect(settingsSource).toContain("setEditingBudget(false)");
    expect(settingsSource).toContain("setEditingVenue(false)");
    expect(settingsSource).toContain("setLoadedSettingsOwnerId(renderedSettingsOwnerId)");
  });

  it("captures reset/delete confirmation owners and verifies late destructive responses", () => {
    expect(settingsSource).toContain("setDeleteConfirmationOwnerId(loadedSettingsOwnerId)");
    expect(settingsSource).toContain("setResetConfirmationOwnerId(loadedSettingsOwnerId)");
    expect(settingsSource).toContain("await readCurrentWebActorId()")
    expect(settingsSource).toMatch(
      /currentActorId !== expectedActorUserId[\s\S]{0,220}return/u,
    );
  });

  it("purges a deleted local owner even after server auth disappears, but never a new owner", () => {
    expect(settingsSource).toMatch(
      /currentActorId === null\s*\|\| currentActorId === expectedActorUserId/u,
    );
    expect(settingsSource).toMatch(
      /if \(!await confirmExpectedDeletionOwner\(\)\) \{[\s\S]{0,100}closeDeleteConfirmation\(\)[\s\S]{0,80}return/u,
    );
    expect(settingsSource).toMatch(
      /window\.alert\([\s\S]{0,300}await confirmExpectedDeletionOwner\(\)[\s\S]{0,220}await signOut\(expectedActorUserId\)/u,
    );
  });
});
