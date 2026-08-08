// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWeb(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("community media publishing UI boundary", () => {
  it("uses an exact-true public flag for every web post-writing media affordance", () => {
    const writer = readWeb("src/app/(community)/community/post/write/page.tsx");
    const pollEditor = readWeb("src/components/community/PollEditor.tsx");
    const quickReview = readWeb(
      "src/app/(community)/community/quick-review/page.tsx",
    );
    const cohort = readWeb(
      "src/app/(community)/community/cohort/[id]/page.tsx",
    );

    expect(writer).toMatch(
      /isCommunityMediaPublishingUiEnabled\(\s*process\.env\.NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED/u,
    );
    expect(writer).toContain(
      "!isGuidedQuestionFlow && MEDIA_PUBLISHING_UI_ENABLED",
    );
    expect(writer).toContain(
      'MEDIA_PUBLISHING_UI_ENABLED && postMode === "slides"',
    );
    expect(writer).toContain(
      "MEDIA_PUBLISHING_UI_ENABLED && !isGuidedQuestionFlow && postMode === \"regular\"",
    );
    expect(writer).toContain(
      "mediaUploadsEnabled={MEDIA_PUBLISHING_UI_ENABLED}",
    );
    expect(pollEditor).toContain("if (!mediaUploadsEnabled) return;");
    expect(pollEditor).toContain("{mediaUploadsEnabled && (");
    expect(quickReview).toMatch(
      /isCommunityMediaPublishingUiEnabled\(\s*process\.env\.NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED/u,
    );
    expect(quickReview).toContain("{MEDIA_PUBLISHING_UI_ENABLED && (");
    expect(quickReview).toContain(
      "images: MEDIA_PUBLISHING_UI_ENABLED ? images : []",
    );
    expect(cohort).toMatch(
      /isCommunityMediaPublishingUiEnabled\(\s*process\.env\.NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED/u,
    );
    expect(cohort).toContain("if (!MEDIA_PUBLISHING_UI_ENABLED) return;");
    expect(cohort).toContain("{MEDIA_PUBLISHING_UI_ENABLED && (");
  });

  it("guards browser upload execution even if a hidden handler is invoked", () => {
    const writer = readWeb("src/app/(community)/community/post/write/page.tsx");
    const handlerStart = writer.indexOf("const handleInsertImage");
    const publicGuard = writer.indexOf(
      "if (!MEDIA_PUBLISHING_UI_ENABLED) return;",
      handlerStart,
    );
    const uploadCall = writer.indexOf("await uploadCommunityMedia(file)", handlerStart);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(publicGuard).toBeGreaterThan(handlerStart);
    expect(uploadCall).toBeGreaterThan(publicGuard);
  });

  it("keeps the PATCH server flag as the final authorization boundary", () => {
    const patchRoute = readWeb("src/app/api/community/posts/[id]/route.ts");
    const envExample = readWeb(".env.example");

    expect(patchRoute).toContain("isCommunityMediaPublishingEnabled()");
    expect(patchRoute).toContain("isCommunityMediaPatchAllowedWhileDisabled(");
    expect(patchRoute).toContain("COMMUNITY_MEDIA_DISABLED_CODE");
    expect(patchRoute).not.toContain(
      "NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED",
    );
    expect(envExample).toContain("COMMUNITY_MEDIA_PUBLISHING_ENABLED=false");
    expect(envExample).toContain(
      "NEXT_PUBLIC_COMMUNITY_MEDIA_PUBLISHING_ENABLED=false",
    );
  });
});
