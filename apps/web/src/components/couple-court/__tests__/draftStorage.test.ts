import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLegacyCourtDrafts,
  courtCaseDraftKey,
  courtStatementDraftKey,
  readScopedCourtDraft,
  writeScopedCourtDraft,
} from "../draftStorage";

describe("account-scoped couple court drafts", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("does not return another account's draft even if the wrong key is supplied", () => {
    const key = courtCaseDraftKey("user-a");
    writeScopedCourtDraft(window.sessionStorage, key, "user-a", { facts: "비공개 진술" });

    expect(readScopedCourtDraft(window.sessionStorage, key, "user-b")).toBeNull();
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it("separates statement drafts by user, case and revision mode", () => {
    expect(courtStatementDraftKey("user-a", "case-1", false)).not.toBe(
      courtStatementDraftKey("user-b", "case-1", false),
    );
    expect(courtStatementDraftKey("user-a", "case-1", false)).not.toBe(
      courtStatementDraftKey("user-a", "case-1", true),
    );
  });

  it("purges only legacy unscoped formats", () => {
    const scoped = courtCaseDraftKey("user-a");
    window.sessionStorage.setItem("hanbang:couple-court:draft:v1", "legacy");
    window.sessionStorage.setItem(
      "hanbang:couple-court:statement:11111111-1111-4111-8111-111111111111:initial",
      "legacy statement",
    );
    window.sessionStorage.setItem(scoped, "scoped");

    clearLegacyCourtDrafts(window.sessionStorage);

    expect(window.sessionStorage.getItem("hanbang:couple-court:draft:v1")).toBeNull();
    expect(window.sessionStorage.getItem(scoped)).toBe("scoped");
  });
});
