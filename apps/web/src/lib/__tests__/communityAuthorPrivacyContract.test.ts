import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public community author privacy", () => {
  it("never joins private onboarding roles into public author payloads", () => {
    const authors = read("src/lib/community/authorProfiles.ts");
    const types = read("src/types/community.types.ts");

    expect(authors).not.toContain("createAdminClient");
    expect(authors).not.toContain('.from("profiles")');
    expect(authors).not.toContain("roleMap");
    expect(types).not.toMatch(/interface CommunityProfile[\s\S]*?role\??:/);
  });

  it("does not load arbitrary public avatar URLs", () => {
    const avatar = read("src/components/community/Avatar.tsx");
    const cohortCard = read("src/components/community/CohortCard.tsx");
    const profileRoute = read("src/app/api/community/profile/route.ts");

    expect(avatar).not.toContain("next/image");
    expect(avatar).not.toContain("startsWith(\"http\")");
    expect(profileRoute).not.toContain("isImageUrl");
    expect(profileRoute).toContain("normalizeCommunityAvatar");
    expect(cohortCard).toContain("<Avatar");
    expect(cohortCard).not.toMatch(/<img|src=\{m\.profile\.avatar_url\}/);
    expect(avatar).toContain('nickname.trim() || "커뮤니티 사용자"');
  });

  it("fails closed when a public author nickname is absent", () => {
    const authors = read("src/lib/community/authorProfiles.ts");
    const store = read("src/stores/communityStore.ts");
    const mobilePayload = read("../mobile/src/lib/communityPublicPayload.ts");

    expect(authors).toContain("nickname.trim().length === 0");
    expect(authors).toContain("throw new CommunityAuthorProfileUnavailableError()");
    expect(store).toContain("author.nickname.trim().length > 0");
    expect(mobilePayload).toContain("actor.nickname.trim().length > 0");
  });
});
