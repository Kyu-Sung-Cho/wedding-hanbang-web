// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 랜딩이 계정 제품을 미래형·미제공으로 8곳에서 서술하는 동안, /login?mode=signup 은
// 승인 관문 없이 열려 있었고 가입 → 인증 → 중립 온보딩 → 아모라 채팅이 그대로
// 이어졌다. 라이브 본문 5,294자에 "회원가입"이 0회, 가입 링크가 0개였다.
// 계정 수요를 전부 /beta 대기열로 흘려보내면서, 실제로 열려 있는 경로는
// 광고하지 않는 구조였다.

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const SURFACES = [
  "src/components/landing/redesign/landingContent.ts",
  "src/components/landing/redesign/SharedPrivateSection.tsx",
  "src/components/landing/redesign/ContinuitySection.tsx",
  "src/components/landing/redesign/PreparationResult.tsx",
  "src/components/landing/redesign/LandingFooter.tsx",
  "src/components/landing/redesign/ClosingAction.tsx",
  "src/components/landing/redesign/AvailableNowSection.tsx",
  "src/components/landing/redesign/TransformationHero.tsx",
  "src/components/landing/redesign/LandingHeader.tsx",
  "src/components/landing/redesign/MobileLandingMenu.tsx",
  "src/app/landing/page.tsx",
];

describe("가입은 열려 있고, 랜딩이 그렇게 말한다", () => {
  it("계정을 아직 못 쓴다고 말하지 않는다", () => {
    for (const relative of SURFACES) {
      const content = source(relative);
      // 주석은 왜 바꿨는지 설명하느라 옛 문구를 인용할 수 있다. 화면에 나가는
      // 문자열만 본다 — 줄 단위로 주석을 걷어내고 검사한다.
      const rendered = content
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return !trimmed.startsWith("//")
            && !trimmed.startsWith("*")
            && !trimmed.startsWith("/*")
            && !trimmed.startsWith("{/*");
        })
        .join("\n");

      for (const lie of [
        "계정 베타가 아직 제공 전",
        "계정 베타가 제공되면",
        "계정 베타 기능이 제공되면",
        "계정 베타(미제공)",
      ]) {
        expect(rendered, `${relative} 가 "${lie}" 라고 말한다`).not.toContain(lie);
      }
    }
  });

  it("헤더와 모바일 메뉴에 회원가입으로 가는 길이 있다", () => {
    for (const relative of [
      "src/components/landing/redesign/LandingHeader.tsx",
      "src/components/landing/redesign/MobileLandingMenu.tsx",
    ]) {
      const content = source(relative);
      expect(content, `${relative} 에 가입 링크가 없다`)
        .toContain('href="/login?mode=signup"');
      expect(content, `${relative} 에 가입 라벨이 없다`).toContain("회원가입");
    }
  });

  it("마지막 행동 자리가 대기열이 아니라 가입으로 보낸다", () => {
    const closing = source("src/components/landing/redesign/ClosingAction.tsx");
    expect(closing).toContain('href="/login?mode=signup"');
    // /beta 는 승인 대기열이었다. 기다릴 이유가 없는 사람을 거기로 보내면 안 된다.
    expect(closing, "클로징이 아직 대기열로 보낸다").not.toContain('href="/beta"');
  });

  it("무료라고 단정하지 않는 비용 경계는 그대로 남는다", () => {
    const content = source("src/components/landing/redesign/landingContent.ts");
    expect(content).toContain("추가 이용 방법과 비용은 아직 정해지지 않았으며");
    expect(content).not.toContain("웨딩한방은 무료");
    expect(content).not.toContain("평생 무료");
  });

  it("빌드 게이트가 강제로 끈 기능을 지금 되는 것처럼 말하지 않는다", () => {
    // check-amora-production-env.mjs 가 프로덕션에서 "false" 를 강제하는 것들이다.
    // 선톡·선제 케어·기억 보조·오늘 하나는 오늘 사용자가 재현할 수 없다.
    const content = source("src/components/landing/redesign/landingContent.ts");
    for (const notYet of ["먼저 말을 걸어", "먼저 연락", "기억해 두었다가", "오늘 하나"]) {
      expect(content, `랜딩이 꺼진 기능("${notYet}")을 광고한다`).not.toContain(notYet);
    }
  });
});
