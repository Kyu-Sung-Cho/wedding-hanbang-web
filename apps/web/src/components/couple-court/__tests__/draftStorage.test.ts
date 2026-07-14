import { beforeEach, describe, expect, it } from "vitest";
import {
  clearCourtDraftsForOwner,
  clearLegacyCourtDrafts,
  courtCaseDraftKey,
  courtStatementDraftKey,
  publicCommentDraftKey,
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
    window.sessionStorage.setItem(
      "hanbang:couple-court:public-comment-draft:v1:post-1",
      "legacy public comment",
    );
    window.sessionStorage.setItem(scoped, "scoped");

    clearLegacyCourtDrafts(window.sessionStorage);

    expect(window.sessionStorage.getItem("hanbang:couple-court:draft:v1")).toBeNull();
    expect(window.sessionStorage.getItem(
      "hanbang:couple-court:public-comment-draft:v1:post-1",
    )).toBeNull();
    expect(window.sessionStorage.getItem(scoped)).toBe("scoped");
  });

  it("purges every private draft for the departing account without touching another account", () => {
    const ownerCase = courtCaseDraftKey("user-a");
    const ownerInitial = courtStatementDraftKey("user-a", "case-1", false);
    const ownerRevision = courtStatementDraftKey("user-a", "case-1", true);
    const ownerPublicComment = publicCommentDraftKey("user-a", "post-1");
    const otherCase = courtCaseDraftKey("user-b");
    const otherStatement = courtStatementDraftKey("user-b", "case-1", false);
    const otherPublicComment = publicCommentDraftKey("user-b", "post-1");
    for (const key of [
      ownerCase,
      ownerInitial,
      ownerRevision,
      ownerPublicComment,
      otherCase,
      otherStatement,
      otherPublicComment,
    ]) {
      window.sessionStorage.setItem(key, "private");
    }

    clearCourtDraftsForOwner(window.sessionStorage, "user-a");

    expect(window.sessionStorage.getItem(ownerCase)).toBeNull();
    expect(window.sessionStorage.getItem(ownerInitial)).toBeNull();
    expect(window.sessionStorage.getItem(ownerRevision)).toBeNull();
    expect(window.sessionStorage.getItem(ownerPublicComment)).toBeNull();
    expect(window.sessionStorage.getItem(otherCase)).toBe("private");
    expect(window.sessionStorage.getItem(otherStatement)).toBe("private");
    expect(window.sessionStorage.getItem(otherPublicComment)).toBe("private");
  });
});
