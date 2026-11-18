// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { START_COPY } from "@hanbang/shared/invitation";
import { getAuthRedirectPath, getPostLoginRedirectPath } from "@/lib/auth/safeRedirect";

import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
} from "./landingSource";

// ## 이 파일이 지키는 것
//
// **계정으로 가는 길이 화면에 있고, 그 길에 대해 화면이 거짓말하지 않는다.**
//
// 원래 사고(2026-08 초): 랜딩이 계정 제품을 미래형·미제공으로 8곳에서 서술하는 동안,
// `/login?mode=signup` 은 승인 관문 없이 열려 있었다. 계정 수요를 전부 `/beta` 대기열로
// 흘려보내면서, 실제로 열려 있는 경로는 광고하지 않는 구조였다.
//
// 2026-08-29 파운더 결정: **베타를 하지 않는다.** (CLAUDE.md — "베타 우리 안할거야 알아둬")
// 그래서 단언 방향이 "베타라는 틀이 화면에 아예 없어야 한다" 이다. **없어지는 것은 틀이지
// 고지가 아니다** — "향후 요금은 아직 정해지지 않았다" 는 오늘 참이라 남는다.
//
// ## 2026-11-17 — 시작 화면
//
// 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 시작 화면 한 장이다.
// 머리줄 가입 링크·모바일 메뉴·마무리 섹션이 없어지고, 계정으로 가는 길은 둘이 됐다:
//
//   시작하기          `landingContent.start.primary` = `/wedding/chat`(로그인·시작 설정을 거쳐 돌아온다)
//   오른쪽 위 로그인   `landingContent.account.logIn` = `/login?redirect=%2Fwedding%2Fchat`
//   비용 고지         `landingContent.notices.pricing`(옛 `confirm.note`) · `notices.signup`(옛 `closing.note`)
//
// 첫 화면 글자는 앱과 같은 정본 `START_COPY` 에서 오므로 그 글자도 표면에 넣어 함께 잰다.

/** 랜딩이 사용자에게 내보내는 표면 전부. 주석은 벗겼다 — 화면에 나가는 것만 본다. */
function landingSurfaces(): Array<[string, string]> {
  const page = "src/app/landing/page.tsx";
  return [
    ...everyLandingComponent(),
    [CONTENT_PATH, rendered(CONTENT_PATH)] as [string, string],
    [page, rendered(page)] as [string, string],
    ["START_COPY", Object.values(START_COPY).flat().join("\n")] as [string, string],
  ];
}

const AMORA_HREF = /href[:=]\s*"\/wedding\/chat"/u;

describe("가입은 열려 있고, 랜딩이 그렇게 말한다", () => {
  it("베타라는 틀이 화면에 없다", () => {
    // 특정 문장이 아니라 **틀 자체**를 막는다 — 문장만 막으면 같은 뜻의 새 문장이 그대로 들어온다.
    for (const [name, visible] of landingSurfaces()) {
      for (const frame of ["베타", "사전등록", "사전 등록", "승인 대기", "대기열"]) {
        expect(visible, `${name} 가 화면에서 "${frame}" 이라는 틀을 쓴다`).not.toContain(frame);
      }
      // `/beta` 는 삭제돼 `/landing` 으로 308 한다.
      expect(visible, `${name} 가 아직 /beta 로 보낸다`).not.toMatch(/href[:=]\s*"\/beta"/u);
    }
  });

  it("계정을 지금 못 쓴다고 말하지 않는다", () => {
    for (const [name, visible] of landingSurfaces()) {
      for (const lie of ["아직 제공 전", "제공되면", "출시 예정", "곧 제공", "준비 중이에요"]) {
        expect(visible, `${name} 가 계정을 미래형("${lie}")으로 말한다`).not.toContain(lie);
      }
    }
  });

  it("시작하기와 로그인 알약이 아모라로 돌아오는 같은 길을 쓴다", () => {
    // 시작하기는 보호 경로로 바로 가고, 로그아웃이면 미들웨어가 로그인으로 보냈다가 돌려보낸다.
    // 로그인 알약은 로그인 화면으로 가되 끝나면 같은 자리(`/wedding/chat`)로 돌아온다.
    expect(contentBlock("start", "account"), "시작하기가 아모라로 보내지 않는다").toMatch(AMORA_HREF);
    const account = contentBlock("account", "boundaries");
    const logIn = /logIn:\s*\{([^}]*)\}/u.exec(account)?.[1] ?? "";
    expect(logIn, "로그인 자리가 사라졌다").toMatch(/label:\s*"로그인"/u);
    expect(logIn, "로그인 뒤 아모라로 돌아오지 않는다").toContain('href: "/login?redirect=%2Fwedding%2Fchat"');

    // 화면이 그 값을 실제로 쓴다.
    const actions = rendered("src/components/landing/redesign/LandingAccountActions.tsx");
    expect(actions, "로그인 알약이 정본 카피를 읽지 않는다").toContain('from "./landingContent"');
    expect(actions).toContain("href={logIn.href}");
    expect(actions).toContain("{logIn.label}");
    // 로그인했다고 **확인될 때만** 감춘다. 확인 전·실패에는 보여 계정 있는 사람이 들어갈 길을 남긴다.
    expect(actions).toMatch(/if \(status === "signed_in"\) return null;/u);
    expect(rendered("src/components/landing/redesign/LandingHeader.tsx"), "머리줄이 로그인 알약을 그리지 않는다")
      .toContain("<LandingAccountActions />");
    expect(rendered("src/components/landing/redesign/StartScreen.tsx"), "시작하기가 정본 행선지를 쓰지 않는다")
      .toContain("href={start.primary.href}");
  });

  it("로그인과 시작 설정을 거쳐도 아모라로 돌아올 목적지를 보존한다", () => {
    const origin = "https://hanbang.ai";
    const search = "?redirect=%2Fwedding%2Fchat";
    expect(getPostLoginRedirectPath(search, origin, true)).toBe("/wedding/chat");
    const onboarding = getPostLoginRedirectPath(search, origin, false);
    expect(onboarding).toBe("/wedding/onboarding?redirect=%2Fwedding%2Fchat");
    expect(getAuthRedirectPath(new URL(onboarding, origin).search, origin)).toBe("/wedding/chat");
    const middleware = rendered("src/lib/supabase/middleware.ts");
    expect(middleware).toContain('buildCustomerGateRedirect(request, "/login")');
    expect(middleware).toContain('buildCustomerGateRedirect(request, "/wedding/onboarding")');
    expect(middleware).toContain('url.searchParams.set("redirect", destination)');
  });

  it("현재 무료 이용과 향후 요금 미정을 함께 고지한다", () => {
    // 문장이 아니라 사실을 고정한다. 이 고지는 베타와 함께 지워지는 것이 아니다 —
    // 오늘 참이기 때문에 남는다(CLAUDE.md 2026-08-29).
    expect(contentBlock("notices", "footer"), "비용 고지가 notices 블록을 떠났다")
      .toContain("현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.");
    expect(rendered("src/components/landing/redesign/LandingFooter.tsx"), "바닥글이 비용 고지를 렌더하지 않는다")
      .toContain("{notices.pricing}");

    // 반대편 거짓말. 무료라고 단정하면 나중에 값을 정할 때 약속을 깬 것이 된다.
    for (const [name, visible] of landingSurfaces()) {
      for (const overclaim of ["웨딩한방은 항상 무료", "평생 무료", "무제한 무료", "영구 무료"]) {
        expect(visible, `${name} 가 "${overclaim}" 이라고 단정한다`).not.toContain(overclaim);
      }
    }
  });

  it("빌드 게이트가 강제로 끈 기능을 지금 되는 것처럼 말하지 않는다", () => {
    // check-amora-production-env.mjs 가 프로덕션에서 "false" 를 강제하는 것들이다.
    // 선톡·선제 케어·기억 보조·오늘 하나는 오늘 사용자가 재현할 수 없다.
    for (const [name, visible] of landingSurfaces()) {
      for (const notYet of ["먼저 말을 걸어", "먼저 연락", "기억해 두었다가", "오늘 하나"]) {
        expect(visible, `${name} 가 꺼진 기능("${notYet}")을 광고한다`).not.toContain(notYet);
      }
    }
  });

  /**
   * `/demo` 는 출시일에 "아직 개발 중"이라고 말하지 않는다. 가격이 미정이라는 **사실**은
   * 남긴다 — 없앨 것은 틀이지 사실이 아니다(2026-08-29 파운더 결정).
   *
   * 이 검사는 `communityCopyPromisesNoPeople.test.ts` 에 있었다. 2026-11-17 시작 화면 개편으로
   * 그 파일이 지키던 랜딩 커뮤니티 절이 없어져 파일을 지웠고, 랜딩 밖(/demo)을 지키는 이 검사만
   * 같은 "아직 정식이 아니다" 틀을 막는 이 파일로 옮겼다.
   */
  it("/demo 가 아직 개발 중이라고 말하지 않는다", () => {
    const demo = readFileSync(path.join(process.cwd(), "src/app/demo/page.tsx"), "utf8");
    for (const framing of ["개발·검증 중", "순차적으로 열립니다", "정식 안내에서"]) {
      expect(demo, `출시일에 "아직 정식이 아니다" 틀이 남아 있다: ${framing}`).not.toContain(framing);
    }
    expect(demo).toContain("이용 방법과 비용은 아직 정해지지 않았고");
  });
});
