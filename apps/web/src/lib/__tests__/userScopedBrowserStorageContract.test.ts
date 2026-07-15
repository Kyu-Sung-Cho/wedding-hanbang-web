import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("user-scoped browser storage contract", () => {
  it("never restores a community draft from the old shared-browser key", () => {
    const page = read("src/app/(community)/community/post/write/page.tsx");
    const storage = read("src/lib/userScopedBrowserStorage.ts");

    expect(page).toContain("removeLegacyCommunityDraft(window.localStorage)");
    expect(page).toContain('visibility: asDraft ? "draft" : visibility');
    expect(page).not.toMatch(/localStorage\.(?:getItem|setItem)/);
    expect(storage).not.toContain("communityPostDraftStorageKey");
    expect(storage).toContain("storage.removeItem(LEGACY_COMMUNITY_DRAFT_KEY)");
  });

  it("scopes etiquette checks and notes to the authenticated owner", () => {
    const etiquette = read("src/components/app/etiquette/EtiquetteClient.tsx");

    expect(etiquette).toContain("etiquetteChecksStorageKey(user.id");
    expect(etiquette).toContain("etiquetteMemosStorageKey(user.id");
    expect(etiquette).not.toContain("`etiquette_checks_${part.number}`");
    expect(etiquette).not.toContain("`etiquette_memos_${part.number}`");
  });

  it("does not claim a memo was saved after browser storage rejects the write", () => {
    const etiquette = read("src/components/app/etiquette/EtiquetteClient.tsx");

    expect(etiquette).toContain("메모를 저장하지 못했습니다");
    expect(etiquette).toContain('tone: "error"');
  });
});
