import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (relative: string) => readFileSync(path.join(appRoot, relative), "utf8");

/**
 * 웨딩코드는 로그인 없이 해볼 수 있는 입구다(2026-09-15 파운더 결정: 어디서든 보이게).
 * 2026-09-20: 로그인 화면은 공개 테스트로, 라운지는 결과와 가이드를 다시 보는
 * 준비 스타일 허브로 이어 준다. 공개 테스트를 /wedding 아래 주소로 바꾸지 않는다.
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

  it("라운지 본문 카드는 준비 스타일 허브로 보내고 공개 테스트 경로를 잘못 합치지 않는다", () => {
    const lounge = read("(app)/lounge/LoungeHubSections.tsx");
    const start = lounge.indexOf("data-lounge-preparation-style");
    expect(start).toBeGreaterThan(-1);
    const card = lounge.slice(start, lounge.indexOf("</section>", start));
    expect(card).toContain('weddingLinkProps("/preparation-style")');
    expect(card).not.toContain('href="/wedding-code"');
    expect(lounge).not.toContain('weddingLinkProps("/wedding-code")');
  });
});
