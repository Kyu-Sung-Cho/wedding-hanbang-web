// @vitest-environment node

import { describe, expect, it } from "vitest";

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
// `/login?mode=signup` 은 승인 관문 없이 열려 있었고 가입 → 인증 → 중립 온보딩 →
// 아모라 채팅이 그대로 이어졌다. 라이브 본문 5,294자에 "회원가입"이 0회, 가입 링크가
// 0개였다. 계정 수요를 전부 `/beta` 대기열로 흘려보내면서, 실제로 열려 있는 경로는
// 광고하지 않는 구조였다.
//
// 2026-08-29 파운더 결정으로 방향이 한 번 더 굳었다: **베타를 하지 않는다.**
// (CLAUDE.md — "베타 우리 안할거야 알아둬") `/beta` 페이지·`lib/beta-count.ts`·
// `constants/beta.ts`·`ForBetaCouples.tsx` 는 삭제됐고 `/beta` 는 `/landing` 으로
// 308 한다. 그래서 이 파일의 단언 방향이 뒤집혔다 — 예전에는 "베타가 아직이라고
// 말하지 마라"였고, 지금은 **"베타라는 틀이 화면에 아예 없어야 한다"** 이다.
//
// **없어지는 것은 틀이지 고지가 아니다.** "이용 방법과 비용은 아직 정해지지 않았고,
// 계정을 만들어도 지금은 결제를 요청하지 않아요" 는 계속 참이므로 남는다 — 베타라서가
// 아니라 오늘 그렇기 때문이다. 그 고지를 지키는 단언은 아래에 그대로 있다.
//
// ## 2026-08-29 개편으로 옮겨 온 자리
//
// 정본 시안(`웨딩한방-랜딩시안/NotebookBest.html`)으로 랜딩을 다시 지으면서 섹션이
// 통째로 바뀌었다. 이 파일이 보던 자리도 따라 옮겼다:
//
//   헤더 가입 라벨   컴포넌트 하드코딩 "회원가입" → `landingContent.headerAuth.signUp`
//                    (라벨이 "시작하기" 로 바뀌었다 — 그래서 **글자가 아니라 뜻**을 잰다)
//   비용 고지        `/beta` 안내 문장       → `landingContent.confirm.note`
//                    + `landingContent.closing.note`
//   마지막 행동      `/beta` 대기열          → `closing.secondary` = `/login?mode=signup`
//
// 도우미는 `./landingSource` 를 쓴다. 자기 복사본을 만들지 마라 — 여섯 벌이 전부 같은
// 버그였던 적이 있다(줄 끝 주석·JSX 주석을 못 걷어 화면에서 지운 것이 "있다"로 통과).

/** 랜딩이 사용자에게 내보내는 표면 전부. 주석은 벗겼다 — 화면에 나가는 것만 본다. */
function landingSurfaces(): Array<[string, string]> {
  const page = "src/app/landing/page.tsx";
  return [
    // 컴포넌트 목록은 디렉터리에서 읽는다. 손으로 적어 두었더니 개편에서 파일이
    // 삭제되며 ENOENT 로 죽었고, 첫 단언이 살아 있는 파일을 한 장도 못 읽고 멈췄다.
    ...everyLandingComponent(),
    // `.ts` 라 `everyLandingComponent()`(=`.tsx` 만) 가 안 준다. 카피 정본이 빠지면
    // 이 파일의 검사 대부분이 빈 통과가 된다.
    [CONTENT_PATH, rendered(CONTENT_PATH)] as [string, string],
    [page, rendered(page)] as [string, string],
  ];
}

const HEADER_PATH = "src/components/landing/redesign/LandingHeader.tsx";
const MOBILE_MENU_PATH = "src/components/landing/redesign/MobileLandingMenu.tsx";
const CLOSING_PATH = "src/components/landing/redesign/ClosingAction.tsx";
const CONFIRM_PATH = "src/components/landing/redesign/ConfirmSection.tsx";

const SIGNUP_HREF = /href[:=]\s*"\/login\?mode=signup"/u;

describe("가입은 열려 있고, 랜딩이 그렇게 말한다", () => {
  it("베타라는 틀이 화면에 없다", () => {
    // 2026-08-29 파운더 결정(CLAUDE.md). 예전 이 자리는 "계정 베타가 아직 제공 전",
    // "계정 베타가 제공되면" 같은 **특정 거짓말 네 개**를 금지했는데, 그 넷은 전부
    // "베타" 를 품고 있어 아래 금지어에 포함된다. 특정 문장이 아니라 **틀 자체**를
    // 막는다 — 문장만 막으면 같은 뜻의 새 문장이 그대로 들어온다.
    for (const [name, visible] of landingSurfaces()) {
      for (const frame of ["베타", "사전등록", "사전 등록", "승인 대기", "대기열"]) {
        expect(visible, `${name} 가 화면에서 "${frame}" 이라는 틀을 쓴다`)
          .not.toContain(frame);
      }
      // `/beta` 는 삭제돼 `/landing` 으로 308 한다. 기다릴 이유가 없는 사람을
      // 리다이렉트 한 번 태워서 제자리로 돌려보내면 안 된다.
      expect(visible, `${name} 가 아직 /beta 로 보낸다`).not.toMatch(/href[:=]\s*"\/beta"/u);
    }
  });

  it("계정을 지금 못 쓴다고 말하지 않는다", () => {
    // 원래 사고의 본체. 계정은 **지금 열려 있다** — 미래형으로 서술하면 안 된다.
    // "베타" 를 지웠다고 이 계약까지 지우면 안 되므로 베타와 따로 세워 둔다.
    for (const [name, visible] of landingSurfaces()) {
      for (const lie of ["아직 제공 전", "제공되면", "출시 예정", "곧 제공", "준비 중이에요"]) {
        expect(visible, `${name} 가 계정을 미래형("${lie}")으로 말한다`).not.toContain(lie);
      }
    }
  });

  it("헤더와 모바일 메뉴에 가입으로 가는 길이 있다", () => {
    // 2026-08-27 개편으로 헤더의 링크가 컴포넌트에서 카피로 옮겨 갔고, 2026-08-29
    // 개편에서 라벨이 "회원가입" → "시작하기" 로 바뀌었다. 그래서 **글자를 세면 안 된다.**
    // 재는 것은 뜻이다: (1) 행선지가 가입이고 (2) 눌리는 라벨이 실제로 있다.
    const auth = contentBlock("headerAuth");
    const signUp = /signUp:\s*\{([^}]*)\}/u.exec(auth);
    expect(signUp, "headerAuth.signUp 이 사라졌다 — 헤더의 가입 경로가 통째로 없다")
      .not.toBeNull();
    const signUpEntry = signUp?.[1] ?? "";
    expect(signUpEntry, "headerAuth.signUp 이 가입으로 보내지 않는다").toMatch(SIGNUP_HREF);
    expect(signUpEntry, "headerAuth.signUp 에 라벨이 없다").toMatch(/label:\s*"[^"\s][^"]*"/u);

    // 카피만 고치고 화면이 딴 데를 가리키면 계약이 통과해 버린다. 헤더가 그 값을
    // 실제로 렌더하는지 같이 본다.
    const header = rendered(HEADER_PATH);
    expect(header, "헤더가 카피의 가입 행선지를 쓰지 않는다").toContain("headerAuth.signUp.href");
    expect(header, "헤더가 카피의 가입 라벨을 쓰지 않는다").toContain("headerAuth.signUp.label");

    // 좁은 화면에는 헤더 버튼이 숨고 메뉴만 남는다(`lg:` 분기). 여기서 가입이 빠지면
    // 모바일 방문자에게는 가입 경로가 0개가 된다. 모바일 메뉴는 `headerNav`(본문 앵커)
    // 만 받으므로 가입 링크를 스스로 들고 있어야 한다.
    const mobile = rendered(MOBILE_MENU_PATH);
    const mobileLink = /href="\/login\?mode=signup"[\s\S]*?>([^<>]*)<\/Link>/u.exec(mobile);
    expect(mobileLink, "모바일 메뉴에 가입 링크가 없다").not.toBeNull();
    // 라벨을 글자로 고정하지 않는다. 비어 있지만 않으면 된다 — 카피로 옮겨
    // `{...label}` 이 되어도 통과하고, 지워지면 잡힌다.
    const mobileLabel = (mobileLink?.[1] ?? "").trim();
    expect(mobileLabel.length, "모바일 가입 링크에 눌릴 라벨이 없다").toBeGreaterThan(0);
    expect(mobileLabel, "모바일 가입 라벨이 다시 대기열 말투다")
      .not.toMatch(/베타|신청|대기/u);
  });

  it("마지막 행동 자리가 대기열이 아니라 가입으로 보낸다", () => {
    // 행선지가 컴포넌트에서 카피로 옮겨 갔다. ClosingAction 은 이제
    // `closing.primary.href` / `closing.secondary.href` 를 렌더할 뿐이라, 컴포넌트
    // 원문에서 리터럴 href 를 찾으면 **행선지가 무엇이든 항상 실패한다.**
    // 행선지가 사는 곳을 보고, 화면이 그 값을 실제로 쓰는지도 같이 본다.
    const component = rendered(CLOSING_PATH);
    expect(component, "마무리가 카피의 행선지를 쓰지 않는다").toContain("closing.primary.href");
    expect(component, "마무리가 카피의 행선지를 쓰지 않는다").toContain("closing.secondary.href");

    // 경계를 못 찾으면 `contentBlock` 이 던진다. `slice(-1)` 로 조용히 한 글자만
    // 보다가 가드가 한 번도 안 울린 적이 있어서 그렇게 만들어 두었다.
    const closing = contentBlock("closing", "footer");
    expect(closing, "마무리에 가입으로 가는 길이 없다").toMatch(SIGNUP_HREF);
  });

  it("무료라고 단정하지 않는 비용 고지가 화면에 남아 있다", () => {
    // 지켜야 하는 것은 **사실**이다: "이용 방법과 비용은 아직 정해지지 않았다"고
    // 화면이 말하는가(`docs/operations/LANDING_CONSUMER_EXPERIENCE_HANDOFF_2026-08-04.md:111`).
    // 문장은 세 번 바뀌었다 —
    //   "추가 이용 방법과 비용은 아직 정해지지 않았으며" (2026-08-04)
    //   "이용 방법과 비용은 아직 정해지지 않았고, 신청만으로 결제되지 않아요" (2026-08-27)
    //   "…계정을 만들어도 지금은 결제를 요청하지 않아요" (2026-08-29, `/beta` 신청 폼이
    //    없어져 "신청"이라는 행동 자체가 사라졌다)
    // 문장이 아니라 사실을 고정한다. 이 고지는 베타와 함께 지워지는 것이 아니다 —
    // 오늘 참이기 때문에 남는다(CLAUDE.md 2026-08-29).
    const copy = rendered(CONTENT_PATH);
    expect(copy, "비용이 아직 정해지지 않았다는 고지가 사라졌다")
      .toContain("이용 방법과 비용은 아직 정해지지 않았");
    expect(copy, "지금 결제를 요청하지 않는다는 고지가 사라졌다")
      .toContain("지금은 결제를 요청하지 않아요");

    // 그 고지는 `confirm` 블록(계정을 만들면 무엇이 되는지 말하는 자리)에 있고,
    // ConfirmSection 이 실제로 그 값을 렌더해야 화면에 나간다. 카피에만 있고 아무도
    // 안 읽으면 사용자는 고지를 못 본다.
    expect(contentBlock("confirm", "boundaries"), "비용 고지가 confirm 블록을 떠났다")
      .toContain("이용 방법과 비용은 아직 정해지지 않았");
    expect(rendered(CONFIRM_PATH), "확인 섹션이 비용 고지를 렌더하지 않는다")
      .toContain("confirm.note");

    // 반대편 거짓말. 무료라고 단정하면 나중에 값을 정할 때 약속을 깬 것이 된다.
    for (const [name, visible] of landingSurfaces()) {
      for (const overclaim of ["웨딩한방은 무료", "평생 무료", "무료로 이용"]) {
        expect(visible, `${name} 가 "${overclaim}" 이라고 단정한다`).not.toContain(overclaim);
      }
    }
  });

  it("빌드 게이트가 강제로 끈 기능을 지금 되는 것처럼 말하지 않는다", () => {
    // check-amora-production-env.mjs 가 프로덕션에서 "false" 를 강제하는 것들이다.
    // 선톡·선제 케어·기억 보조·오늘 하나는 오늘 사용자가 재현할 수 없다
    // (CLAUDE.md: "오늘 사용자가 직접 재현할 수 있는 것만" 화면에 쓴다).
    //
    // 카피 정본만 보던 것을 표면 전부로 넓혔다. 개편 때 컴포넌트가 문장을 직접
    // 들고 있으면 카피만 봐서는 안 잡힌다.
    for (const [name, visible] of landingSurfaces()) {
      for (const notYet of ["먼저 말을 걸어", "먼저 연락", "기억해 두었다가", "오늘 하나"]) {
        expect(visible, `${name} 가 꺼진 기능("${notYet}")을 광고한다`).not.toContain(notYet);
      }
    }
  });
});
