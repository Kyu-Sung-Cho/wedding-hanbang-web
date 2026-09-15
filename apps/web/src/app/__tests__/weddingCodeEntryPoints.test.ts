import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (relative: string) => readFileSync(path.join(appRoot, relative), "utf8");

/**
 * 웨딩코드는 로그인 없이 해볼 수 있는 입구다(2026-09-15 파운더 결정: 어디서든 보이게).
 * 다만 로그인 후 제품 내비게이션에는 넣지 않는다(2026-08-27 결정, mvpDirection.test.ts) —
 * 그래서 입구는 로그인 화면과 라운지 본문 카드로 연다.
 */
describe("WeddingCode entry points", () => {
  it("로그인 화면에서 계정 없이 웨딩코드로 갈 수 있다", () => {
    const login = read("(auth)/login/page.tsx");
    const bottomLinks = login.slice(login.indexOf("{/* 하단 링크 */}"));
    expect(bottomLinks).toContain('href="/wedding-code"');
    // 데모 체험 플래그 안쪽에 두면 플래그가 꺼진 운영에서 입구가 사라진다.
    const demoBlock = login.slice(
      login.indexOf("isPublicDemoTrialEnabled() && ("),
      login.indexOf("{/* 하단 링크 */}"),
    );
    expect(demoBlock).not.toContain('href="/wedding-code"');
  });

  it("라운지 본문 카드는 /wedding 접두사 없이 웨딩코드로 보낸다", () => {
    const lounge = read("(app)/lounge/LoungeHubSections.tsx");
    const card = lounge.slice(lounge.indexOf("data-lounge-wedding-code"));
    expect(card).toContain('<Link href="/wedding-code"');
    expect(lounge).not.toContain('weddingLinkProps("/wedding-code")');
  });
});
