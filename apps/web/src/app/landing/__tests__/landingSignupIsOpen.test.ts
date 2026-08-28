// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
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

/**
 * 주석을 걷어낸 뒤의 내용. 화면에 나가는 것만 본다.
 *
 * ⚠️ 이 함수가 없던 동안 아래 두 테스트가 **원문**을 보고 있었다. 그래서
 * 가입 링크를 `{/* ... *\/}` 로 감싸 화면에서 지워도 세 단언이 모두 통과했다.
 * 가드가 지키려던 것("가입으로 가는 길이 화면에 있다")을 정확히 못 지켰다.
 */
function rendered(relativePath: string): string {
  return source(relativePath)
    // 블록 주석은 **여러 줄에 걸친다.** 줄 단위 필터로 지우면 여는 줄만
    // 사라지고 가운데 줄은 남는다 — 실제로 그 구멍 때문에, 가입 링크를
    // `{/* ... */}` 로 감싸 화면에서 지워도 이 파일의 단언이 전부 통과했다.
    // 뮤테이션으로 확인하기 전까지는 그것을 몰랐다.
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // 줄 주석. `https://` 같은 값 안의 슬래시를 먹지 않도록 줄머리만 본다.
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * 랜딩에 나가는 표면 전부.
 *
 * 파일 이름을 손으로 적어 두었더니 2026-08-27 개편에서 넷이 삭제되면서
 * (SharedPrivateSection·ContinuitySection·PreparationResult·ProblemMirrorSection)
 * `readFileSync`가 ENOENT로 죽었고, **첫 단언이 살아 있는 파일을 한 장도 못 읽고
 * 멈췄다.** 목록이 끊기면 가드가 아니라 구멍이 된다.
 *
 * 그래서 디렉터리를 통째로 읽는다 — 새 섹션이 생겨도 목록에 추가할 필요가 없다.
 * `landingAvailableNow.test.ts`의 금지어 검사가 같은 이유로 같은 방식을 쓴다.
 */
const REDESIGN_DIR = "src/components/landing/redesign";
/** 카피 정본. 링크와 라벨이 컴포넌트에서 이리로 옮겨 왔다(2026-08-27). */
const CONTENT_PATH = `${REDESIGN_DIR}/landingContent.ts`;
const SURFACES = [
  ...readdirSync(resolve(process.cwd(), REDESIGN_DIR))
    .filter((file) => (file.endsWith(".tsx") || file.endsWith(".ts")) && !file.includes(".test."))
    .map((file) => `${REDESIGN_DIR}/${file}`),
  "src/app/landing/page.tsx",
];

describe("가입은 열려 있고, 랜딩이 그렇게 말한다", () => {
  it("계정을 아직 못 쓴다고 말하지 않는다", () => {
    for (const relative of SURFACES) {
      // 주석은 왜 바꿨는지 설명하느라 옛 문구를 인용할 수 있다.
      const visible = rendered(relative);

      for (const lie of [
        "계정 베타가 아직 제공 전",
        "계정 베타가 제공되면",
        "계정 베타 기능이 제공되면",
        "계정 베타(미제공)",
      ]) {
        expect(visible, `${relative} 가 "${lie}" 라고 말한다`).not.toContain(lie);
      }
    }
  });

  it("헤더와 모바일 메뉴에 회원가입으로 가는 길이 있다", () => {
    // 2026-08-27 개편으로 헤더의 링크가 컴포넌트에서 카피(`landingContent.headerNav`)로
    // 옮겨 갔다. 컴포넌트 원문에서 JSX 리터럴만 찾으면 카피로 옮긴 링크를 못 보므로,
    // 그 표면이 실제로 렌더하는 카피를 함께 읽는다. 두 표기를 다 받는다 —
    // JSX 는 `href="…"`, 카피 배열은 `href: "…"`.
    const copy = rendered(CONTENT_PATH);
    const navCopy = copy.slice(copy.indexOf("export const headerNav"));
    expect(navCopy.length, "headerNav 를 잘라내지 못했다").toBeGreaterThan(0);

    for (const relative of [
      "src/components/landing/redesign/LandingHeader.tsx",
      "src/components/landing/redesign/MobileLandingMenu.tsx",
    ]) {
      // 주석 안의 링크는 화면이 아니다. 렌더되는 쪽만 본다.
      const visible = `${rendered(relative)}\n${navCopy}`;
      expect(visible, `${relative} 에 가입 링크가 없다`)
        .toMatch(/href[:=]\s*"\/login\?mode=signup"/u);
      expect(visible, `${relative} 에 가입 라벨이 없다`).toContain("회원가입");
    }
  });

  it("마지막 행동 자리가 대기열이 아니라 가입으로 보낸다", () => {
    // 여기도 행선지가 컴포넌트에서 카피로 옮겨 갔다. ClosingAction 은 이제
    // `closing.primary.href` / `closing.secondary.href` 를 렌더할 뿐이라, 컴포넌트
    // 원문에서 리터럴 href 를 찾으면 **행선지가 무엇이든 항상 실패한다.**
    // 행선지가 사는 곳을 보고, 화면이 그 값을 실제로 쓰는지도 같이 본다 —
    // 카피만 고치고 화면이 딴 데를 가리키면 계약이 통과해 버린다.
    const component = rendered("src/components/landing/redesign/ClosingAction.tsx");
    expect(component, "마무리가 카피의 행선지를 쓰지 않는다").toContain("closing.primary.href");
    expect(component, "마무리가 카피의 행선지를 쓰지 않는다").toContain("closing.secondary.href");

    const copy = rendered(CONTENT_PATH);
    const closing = copy.slice(copy.indexOf("  closing: {"), copy.indexOf("  footer: {"));
    expect(closing.length, "closing 카피를 잘라내지 못했다").toBeGreaterThan(0);
    expect(closing, "마무리에 가입으로 가는 길이 없다")
      .toMatch(/href:\s*"\/login\?mode=signup"/u);
    // /beta 는 승인 대기열이었다. 기다릴 이유가 없는 사람을 거기로 보내면 안 된다.
    expect(`${closing}\n${component}`, "클로징이 아직 대기열로 보낸다")
      .not.toMatch(/href[:=]\s*"\/beta"/u);
  });

  it("무료라고 단정하지 않는 비용 경계는 그대로 남는다", () => {
    const content = source(CONTENT_PATH);
    // 지켜야 하는 것은 **사실**이다: "이용 방법과 비용은 아직 정해지지 않았다"고
    // 화면이 말하는가(`docs/operations/LANDING_CONSUMER_EXPERIENCE_HANDOFF_2026-08-04.md:111`).
    // 2026-08-27 카피가 그 문장을 "추가 이용 방법과 비용은 아직 정해지지 않았으며"에서
    // "이용 방법과 비용은 아직 정해지지 않았고, 신청만으로 결제되지 않아요"로 바꿨다
    // (`docs/LANDING_COPY_2026-08-27.md:237`이 정본). 문장이 아니라 사실을 고정한다.
    expect(content).toContain("이용 방법과 비용은 아직 정해지지 않았");
    expect(content).not.toContain("웨딩한방은 무료");
    expect(content).not.toContain("평생 무료");
  });

  it("빌드 게이트가 강제로 끈 기능을 지금 되는 것처럼 말하지 않는다", () => {
    // check-amora-production-env.mjs 가 프로덕션에서 "false" 를 강제하는 것들이다.
    // 선톡·선제 케어·기억 보조·오늘 하나는 오늘 사용자가 재현할 수 없다.
    const content = source(CONTENT_PATH);
    for (const notYet of ["먼저 말을 걸어", "먼저 연락", "기억해 두었다가", "오늘 하나"]) {
      expect(content, `랜딩이 꺼진 기능("${notYet}")을 광고한다`).not.toContain(notYet);
    }
  });
});
