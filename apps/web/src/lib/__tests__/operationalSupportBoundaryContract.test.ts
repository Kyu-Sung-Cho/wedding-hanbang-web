import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const supportSurfaces = [
  "apps/web/src/app/support/page.tsx",
  "apps/web/src/app/privacy/page.tsx",
  "apps/web/src/app/terms/page.tsx",
  "apps/web/src/app/ai-policy/page.tsx",
  "apps/web/src/lib/resend.ts",
  "apps/web/src/components/common/AiNoticeFooter.tsx",
  "apps/web/src/components/landing/Footer.tsx",
  "apps/web/src/app/(community)/layout.tsx",
  "apps/web/src/app/beta/verify/VerificationResultCard.tsx",
];

describe("operational support boundary", () => {
  it("does not expose an unverified mailbox as a working support action", () => {
    const source = supportSurfaces.map(read).join("\n");

    expect(source).not.toContain("support@hanbang.ai");
    expect(source).not.toContain("partner@hanbang.ai");
    expect(source).not.toContain("mailto:${CONTACT.email}");
    expect(source).not.toContain("아래 이메일로 알려주세요");
  });

  it("states that public support intake is closed until its workflow is verified", () => {
    const support = read("apps/web/src/app/support/page.tsx");
    const terms = read("apps/web/src/app/terms/page.tsx");

    expect(support).toContain("공개 문의 접수는 아직 열지 않았습니다");
    expect(support).toContain("어떤 연락처도");
    expect(support).toContain("공개하지 않습니다");
    expect(terms).toContain("현재 공개 문의 접수와 연락처 안내는 열지 않았습니다");
  });
});
