// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiSource = readFileSync(
  resolve(process.cwd(), "src/app/api/community/cohort/[id]/messages/route.ts"),
  "utf8",
);
const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/(community)/community/cohort/[id]/page.tsx"),
  "utf8",
);

describe("cohort message security fence", () => {
  it("keeps the mutation behind origin, membership, image, and reply-room validation", () => {
    expect(apiSource).toContain("isTrustedMutationRequest(req)");
    expect(apiSource).toContain("ensureActiveMember(supabase, roomId, user.id)");
    expect(apiSource).toContain("validateCommunityMessageImageSources(content");
    expect(apiSource).toMatch(/\.eq\("id", replyTo\)[\s\S]*\.eq\("room_id", roomId\)/);
    expect(apiSource).toMatch(/createAdminClient\(\)[\s\S]*\.from\("cohort_messages"\)[\s\S]*\.insert/);
  });

  it("fails closed when rendering a legacy or forged image token", () => {
    expect(pageSource).toContain("validateCommunityMediaUrl(url");
    expect(pageSource).toContain("ownerIds: authorId");
    expect(pageSource).toContain('referrerPolicy="no-referrer"');
    expect(pageSource).not.toContain("src={url}");
  });
});
