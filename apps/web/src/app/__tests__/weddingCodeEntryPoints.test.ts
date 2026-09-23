import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const read = (relative: string) => readFileSync(path.join(appRoot, relative), "utf8");

/**
 * 웨딩코드는 로그인 없이 해볼 수 있는 입구다(2026-09-15 파운더 결정: 어디서든 보이게).
 * 로그인 화면은 공개 경로로, 라운지는 같은 문항·결과를 여는 로그인 경로로 이어 준다.
 * 공개 테스트의 주소와 라운지의 주소는 유지한다.
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

  it("라운지 본문 카드는 웨딩코드를 안내하고 공개 테스트 경로를 잘못 합치지 않는다", () => {
    const lounge = read("(app)/lounge/LoungeHubSections.tsx");
    const start = lounge.indexOf("data-lounge-preparation-style");
    expect(start).toBeGreaterThan(-1);
    const card = lounge.slice(start, lounge.indexOf("</section>", start));
    expect(card).toContain('weddingLinkProps("/preparation-style")');
    expect(card).toContain("웨딩코드 보기");
    expect(card).not.toContain("우리의 준비 스타일");
    expect(card).not.toContain('href="/wedding-code"');
    expect(lounge).not.toContain('weddingLinkProps("/wedding-code")');
  });
});
