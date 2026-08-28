// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
} from "./landingSource";

/**
 * 처음 온 사람이 첫 화면에서 읽어야 하는 것 — 그리고 그게 **있어야 할 자리에** 있는지.
 *
 * ## 2026-08-28 재조준 — 적대적 검증에서 이 파일로 빠져나간 변형들
 *
 * 1. **주석이 코드 대신 대답했다.** 이 파일은 자기 `copyOnly` 를 갖고 있었고
 *    `/^[ \t]*\/\/.*$/` 라 **줄 처음**의 `//` 만 지웠다. 그래서 화면에서 지운 문장을
 *    `body: "…",  // 웨딩한방은 둘이 어디서 갈리는지부터 봅니다.` 처럼 줄 끝 주석으로만
 *    남겨도 "있다"고 통과했다. 사본을 지우고 `landingSource.ts` 의 스캐너를 쓴다.
 *
 * 2. **자리를 안 봤다.** 필수 문장 여섯을 landingContent **파일 전체** `toContain` 으로
 *    확인해서, 히어로의 제품 설명 문장을 `footer.tagline` 으로 옮겨도 초록불이었다.
 *    지금은 전부 `contentBlock(...)` 으로 그 문장이 있어야 할 블록 안에서만 찾는다.
 *
 * 3. **섹션을 꺼도 순서 검사가 통과했다.** `page.tsx` 원문에서 `indexOf("<X />")` 로
 *    셌기 때문에 `{/* <PrivateLaneSection /> *␣/}` 로 주석 처리한 섹션이 렌더된 것으로
 *    잡혔다. 지금은 `renderedSections()` — 주석을 벗긴 `<main>` 만 센다.
 *
 * 4. **primary/secondary 를 통째로 맞바꿔도 통과했다.** 히어로 블록에
 *    `href: "/wedding-code"` 가 **있기만** 하면 됐기 때문이다. 지금은 첫 버튼의 href 를
 *    이름으로 짚어 읽고, 화면에서도 primary 가 secondary 보다 먼저 그려지는지 본다.
 *
 * 5. **덧붙임을 못 막았다.** 확인 계약 문장을 그대로 둔 채 뒤에
 *    "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요" 를 붙이면 전부 통과했다 —
 *    제품 계약(아모라는 사용자 확인 없이 아무것도 바꾸지 않는다)을 정면으로 뒤집는데도.
 *    있어야 할 것뿐 아니라 **있으면 안 되는 것**도 같이 본다(`CONTRACT_REVERSALS`).
 *
 * 6. **개수 금지가 리터럴 하나였다.** "지금 볼 세 가지가 나와요" 만 막아서
 *    "지금 볼 3가지가 나와요" 는 그냥 통과했다.
 *
 * 7. **카피만 보고 렌더를 안 봤다.** 정본에 문장이 남아 있으면 그걸 그리는 `<p>` 를
 *    지워도 통과했다. 이제 블록의 키가 실제로 화면에 그려지는지도 본다.
 */

const PAGE = "src/app/landing/page.tsx";
const HERO = "src/components/landing/redesign/TransformationHero.tsx";
const SCENES = "src/components/landing/redesign/ScenesSection.tsx";
const NO_SIDE = "src/components/landing/redesign/NoSideSection.tsx";
const CONFIRM = "src/components/landing/redesign/ConfirmSection.tsx";

/**
 * `export const availableNow` 배열만 잘라낸다.
 *
 * `contentBlock("availableNow", …)` 은 landingContent 안의 `availableNow: {` 키를 먼저
 * 집는다(두 이름이 같다). 그러면 블록이 `closing`·`footer` 까지 삼켜서, 카드에 있어야 할
 * 문장을 `footer.tagline` 으로 옮겨도 통과한다. 그래서 export 시작점까지 한 번 더 좁힌다.
 *
 * 못 찾으면 **던진다.** 조용히 넓어지면 자리 검사가 무의미해지고, 그게 이번에 메운
 * 구멍의 정체다.
 */
function availableNowCards(): string {
  const wide = contentBlock("availableNow", "footerLinks");
  const marker = "export const availableNow = ";
  const at = wide.indexOf(marker);
  if (at < 0) {
    throw new Error(
      "landingContent.ts 에서 `export const availableNow` 를 찾지 못했습니다. "
      + "이름이 바뀌었다면 이 검사도 같이 옮겨야 합니다.",
    );
  }
  return wide.slice(at);
}

/**
 * `primary: { label: "…", href: "…" }` 한 덩어리에서 href 를 이름으로 짚어 읽는다.
 *
 * 블록 전체를 `toContain("href: \"/wedding-code\"")` 로 물으면 **어느 버튼의** href 인지
 * 알 수 없다. 실제로 primary 와 secondary 를 맞바꾼 변형이 그렇게 빠져나갔다.
 * 못 찾으면 던진다 — 조용한 빈 문자열은 다시 같은 구멍이 된다.
 */
function linkHref(block: string, name: string): string {
  const start = block.indexOf(`${name}: {`);
  if (start < 0) {
    throw new Error(`"${name}: {" 를 찾지 못했습니다 — 링크 이름이 바뀌었다면 이 검사도 옮겨야 합니다.`);
  }
  const end = block.indexOf("}", start);
  if (end < 0) {
    throw new Error(`"${name}" 링크의 닫는 괄호를 찾지 못했습니다.`);
  }
  const href = block.slice(start, end).match(/href:\s*"([^"]*)"/u)?.[1];
  if (href === undefined) {
    throw new Error(`"${name}" 링크에 href 가 없습니다.`);
  }
  return href;
}

/** 블록의 최상위 키들(4칸 들여쓰기). 카피가 화면에 도달하는지 되짚을 때 쓴다. */
function keysOf(block: string): readonly string[] {
  return [...block.matchAll(/^ {4}([A-Za-z_$][\w$]*):/gmu)].map((match) => match[1]);
}

/**
 * 제품 계약을 **뒤집는** 문장들.
 *
 * 계약: 아모라는 사용자 확인 없이 예산·할 일·일정을 바꾸지 않는다
 * (`CLAUDE.md` — 2026-08-23 에 없어진 것은 두 번째 사람의 승인이지 확인 자체가 아니다).
 *
 * 계약 문장을 그대로 두고 뒤에 한 줄 덧붙이는 변형이 이 파일 전체를 통과했다. 있어야 할
 * 문장만 세면 이 갈래는 절대 못 잡는다 — 뒤집는 문장을 직접 금지한다.
 *
 * 창(`{0,8}`)이 좁은 이유: 현재 카피에 "견적 확인, … 커뮤니티는 로그인 없이 열려요" 처럼
 * 확인과 "없이" 가 멀리 떨어져 함께 있는 문장이 있다. 그건 계약을 뒤집지 않으므로 잡으면
 * 오탐이다.
 */
const CONTRACT_REVERSALS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /확인[^.\n]{0,8}?(?:건너뛰|생략|없이|안\s*하고|하지\s*않)/u,
    "확인을 건너뛴다고 말한다",
  ],
  [
    /(?:자동으?로?|알아서|미리)[^.\n]{0,8}(?:반영|저장|변경|수정|바꿔|바꿉|적용)/u,
    "사용자 확인 없이 아모라가 스스로 바꾼다고 말한다",
  ],
  [
    /승인\s*(?:없이|안\s*받)/u,
    "승인 없이 반영한다고 말한다",
  ],
  [
    /(?:묻지|물어보지)\s*않고[^.\n]{0,10}(?:반영|저장|변경|바꿔|적용)/u,
    "묻지 않고 바꾼다고 말한다",
  ],
];

describe("landing first visit clarity", () => {
  it("states what the product does and connects the first action to Amora", () => {
    const heroBlock = contentBlock("hero", "scenes");
    const noSideBlock = contentBlock("noSide", "oneRoom");
    const confirmBlock = contentBlock("confirm", "notForVendors");
    const nowCards = availableNowCards();
    const hero = rendered(HERO);
    const noSide = rendered(NO_SIDE);
    const confirm = rendered(CONFIRM);
    const sections = renderedSections();

    // 무엇을 하는 제품인지 한 문장으로 말한다. 2026-08-27 개편 전에는 H1
    // "둘이 말하면, 결혼 준비가 정리돼요."가 그 자리였고, 지금은 히어로 본문이 잇는다.
    // **히어로 블록 안에서** 찾는다 — 파일 전체로 물으면 이 문장을 footer.tagline 으로
    // 옮겨도 통과한다(2026-08-28 변형으로 확인).
    //
    // 2026-08-28: 문장이 바뀌었다. 이전 "웨딩한방은 둘이 어디서 갈리는지부터 봅니다."
    // 는 이 계약의 이름("제품을 한 문장으로")을 달고 있으면서 실제로는 **기능 하나**
    // 를 말했다 — 처음 온 사람이 첫 화면에서 이걸 퀴즈로 읽었다. 지키는 계약은 같고
    // 문장이 그 계약을 이제 진짜로 지킨다.
    expect(heroBlock, "제품을 한 문장으로 말하는 문장이 히어로에 없다")
      .toContain("웨딩한방은 둘이 그 기준을 맞춰 가는 곳이고, 정한 것만 남겨요.");
    // 입력(각자 답한다)과 출력(어디서 갈렸는지 나란히)이 같은 문장 안에 있어야 한다.
    expect(heroBlock).toContain(
      "각자 답하면 어디서 갈렸는지 고른 문장 그대로 나란히 보여줘요.",
    );
    // 카피에 남아 있어도 그리는 자리가 없으면 화면은 빈다.
    expect(hero, "히어로가 hero.body 를 그리지 않는다 — 카피만 남고 화면은 빈다")
      .toContain("{hero.body}");

    // 산출물을 개수로만 말하지 않는다. 이전 문구("지금 볼 세 가지가 나와요")는
    // 그 셋이 무엇인지 랜딩 어디에도 없어서 입력은 분명한데 출력이 빈칸이었다.
    // 대체 문장은 "지금 되는 것" 카드에 있어야 한다 — 히어로로 올려 놓고 카드를 비우면
    // 그 카드가 무엇을 주는지 다시 빈칸이 된다.
    expect(nowCards, "날짜를 넣으면 무엇이 나오는지가 '지금 되는 것' 카드에서 사라졌다")
      .toContain("먼저 살펴볼 준비 세 가지와 각각 뭐부터 하면 되는지가 나와요");
    // 표기를 하나만 막으면 "세 가지"를 "3가지"로 바꿔 그대로 되살릴 수 있다 —
    // 2026-08-28 변형이 실제로 그렇게 통과했다.
    expect(
      rendered(CONTENT_PATH),
      "산출물을 개수로만 말하면 처음 온 사람은 뭘 받는지 모른다",
    ).not.toMatch(/(?:지금 볼|준비)\s*(?:세|셋|[0-9]+)\s*가지가 나와요/u);

    // 첫 행동은 아모라가 아니라 웨딩코드다 — 2026-08-27에 후크를 AI에서 "두 사람 사이"로
    // 옮겼고(비로그인 아모라 체험은 #245로 닫혔다), 그래서 히어로 본문에는 "아모라"가
    // 없다. 지킬 것은 첫 행동이 계정을 요구하기 전에 무엇으로 이어지는지다.
    //
    // 예전에는 히어로 블록에 `href: "/wedding-code"` 가 **있기만** 하면 통과해서
    // primary 와 secondary 를 통째로 맞바꿔도 초록불이었다. 이름으로 짚어 읽는다.
    expect(linkHref(heroBlock, "primary"), "히어로의 첫 버튼이 웨딩코드로 가지 않는다")
      .toBe("/wedding-code");
    expect(hero.indexOf("{hero.primary.label}"), "히어로가 primary 버튼을 그리지 않는다")
      .toBeGreaterThan(-1);
    expect(
      hero.indexOf("{hero.primary.label}"),
      "화면에서 secondary 가 primary 보다 먼저 온다 — 첫 행동이 바뀐다",
    ).toBeLessThan(hero.indexOf("{hero.secondary.label}"));

    // 아모라를 처음 소개하는 자리에 이름이 있고, 그 자리가 계정을 요구하는 섹션보다 먼저다.
    expect(noSideBlock, "아모라를 처음 소개하는 자리에 이름이 없다").toContain("아모라");
    expect(sections, "아모라를 처음 소개하는 섹션이 렌더되지 않는다").toContain("NoSideSection");
    expect(sections, "확인 계약 섹션이 렌더되지 않는다").toContain("ConfirmSection");
    expect(
      sections.indexOf("NoSideSection"),
      "계정 베타를 요구하는 섹션보다 아모라 소개가 먼저여야 한다",
    ).toBeLessThan(sections.indexOf("ConfirmSection"));

    // 계정을 만들면 무엇이 달라지는지 — 아모라가 제안하고, 사람이 확인해야 반영된다.
    // 옛 문장은 "계정을 만들면 아모라가 한 번에 한 가지 변경을 제안하고"였고,
    // 2026-08-27에 주어가 "계정 베타에서는"으로 바뀌었다(제안 주체는 확인 카드가 말한다).
    expect(confirmBlock)
      .toContain("계정 베타에서는 예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고");
    expect(confirmBlock, "제안하는 쪽이 아모라라는 것이 화면에서 사라졌다")
      .toContain("아모라의 제안, 아직 반영 전");
    // 정본에 남아 있어도 그리지 않으면 화면에는 없다.
    expect(confirm, "확인 섹션이 confirm.body 를 그리지 않는다").toContain("{confirm.body}");
    expect(confirm, "‘아직 반영 전’ 라벨을 그리는 자리가 없다")
      .toContain("{confirm.sample.proposeLabel}");

    // 히어로 안에서 약속(H1)이 설명(본문)보다 먼저 온다.
    // (2026-08-28 H1 문장 변경 — 순서 계약은 그대로)
    expect(hero.indexOf("결혼 준비,"), "히어로에서 H1 문장을 찾지 못함")
      .toBeGreaterThan(-1);
    expect(hero.indexOf("결혼 준비,")).toBeLessThan(hero.indexOf("{hero.body}"));

    // 정본에 없는 키를 렌더하면 화면이 조용히 빈다 — 지워진
    // `landingContent.hero.emotionalLine` 참조가 히어로에 남아 실제로 그랬다.
    //
    // 예전에는 `hero.<키>` 표기만 셌다. 그래서 `const { body, note } = hero` 로 풀어 쓰면
    // 죽은 키가 검사를 통째로 비켜 갔다. 구조분해도 같이 센다.
    const heroKeys = heroKeysUsedBy(hero);
    expect(heroKeys.size, "히어로가 정본 상수를 하나도 쓰지 않는다").toBeGreaterThan(0);
    for (const key of heroKeys) {
      expect(heroBlock, `landingContent.hero.${key}가 없는데 히어로가 그걸 렌더한다`)
        .toMatch(new RegExp(`^\\s*${key}:`, "mu"));
    }

    // 반대 방향 — 정본에 있는데 아무도 안 그리는 카피. 문장을 지우는 대신 그걸 그리는
    // `<p>` 만 지우면 "카피에 있다" 단언은 전부 통과한다(2026-08-28 변형).
    //
    // 히어로는 여기서 뺀다. H1 은 줄바꿈·색 강조 때문에 `hero.title` 을 쓰지 않고 손으로
    // 적으며, 그 드리프트는 `landingHeadlineParity.test.ts` 가 글자까지 대조한다.
    for (const [block, componentSource, alias, label] of [
      [noSideBlock, noSide, "noSide", "NoSideSection"],
      [confirmBlock, confirm, "confirm", "ConfirmSection"],
    ] as const) {
      for (const key of keysOf(block)) {
        // 낱말 경계를 붙인다. `confirm.body` 를 그냥 `toContain` 으로 물으면
        // `{confirm.body2}` 가 대신 대답해서, body 를 그리는 `<p>` 를 지워도 통과한다.
        expect(componentSource, `landingContent.${alias}.${key} 를 ${label} 이 그리지 않는다`)
          .toMatch(new RegExp(`\\b${alias}\\.${key}\\b`, "u"));
      }
    }
  });

  it("확인 계약을 뒤집는 문장이 어디에도 붙어 있지 않다", () => {
    // 계약 문장을 그대로 두고 뒤에 뒤집는 한 줄을 붙이는 변형이 이 파일 전체를 통과했다.
    // 카피 정본과 랜딩 컴포넌트 **전부**, 그리고 페이지 자신을 본다 — 정본을 안 건드리고
    // 컴포넌트나 page.tsx 에 손으로 적어 넣는 길이 따로 있다.
    const surfaces: ReadonlyArray<readonly [string, string]> = [
      [CONTENT_PATH, rendered(CONTENT_PATH)],
      [PAGE, rendered(PAGE)],
      ...everyLandingComponent(),
    ];
    expect(surfaces.length, "볼 파일을 하나도 못 찾았다").toBeGreaterThan(5);

    for (const [name, text] of surfaces) {
      for (const [pattern, why] of CONTRACT_REVERSALS) {
        expect(
          text,
          `${name}: ${why} — 제품 계약(아모라는 사용자 확인 없이 아무것도 바꾸지 않는다)을 뒤집는다`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("shows the scene a first visitor recognises before asking for an account", () => {
    const scenesBlock = contentBlock("scenes", "noSide");
    const scenes = rendered(SCENES);

    // 2026-08-27 개편 전에는 이 케이스가 ProblemMirrorSection → PreparationResult 순서를
    // 지켰다. "카톡에는 날짜, 메모장에는 예산, 머릿속에는 해야 할 일."로 흩어진 준비를
    // 비춘 **뒤에** 결과를 보여준다는 규칙이었다. 두 컴포넌트와 `problem`·`outcome` 정본이
    // 함께 지워졌고, 같은 일을 히어로(문제 문장) → ScenesSection(알아볼 장면) →
    // ConfirmSection(남는 것)이 나눠 맡는다. 그래서 지키는 대상을 그 세 문구에서
    // **섹션 순서**로 옮긴다.
    //
    // 목록은 `page.tsx` 원문이 아니라 `renderedSections()` 에서 온다. 원문에서 세면
    // 주석으로 꺼 놓은 섹션이 렌더된 것으로 잡혀 아래 단언 셋이 전부 빈 통과였다.
    const sections = renderedSections();

    // 이유가 적힌 규칙을 전체 목록 대조보다 **먼저** 세운다. 자리를 바꾸면 두 단언이
    // 다 깨지는데, 그때 먼저 보이는 문장이 "왜 안 되는지"를 말해야 한다.
    //
    // ④(나만 보는 자리)는 ③(두 사람 대화를 한 덩어리로 읽는다) 바로 뒤여야 한다.
    // ③ 직후에 "그럼 내가 쓴 게 다 가나"가 오는데, 그 걱정을 다음 섹션이 받지 않으면
    // ③이 불안으로 끝난다 — page.tsx 주석이 못 박은 규칙이다.
    expect(sections, "한 덩어리 섹션이 렌더되지 않는다").toContain("OneRoomSection");
    expect(sections, "나만 보는 자리 섹션이 렌더되지 않는다").toContain("PrivateLaneSection");
    expect(
      sections.indexOf("PrivateLaneSection"),
      "나만 보는 자리가 한 덩어리 섹션 바로 뒤가 아니다",
    ).toBe(sections.indexOf("OneRoomSection") + 1);

    // 알아볼 장면이 계정 요구보다 먼저다 — 옛 "문제를 비춘 뒤에 결과" 규칙이 서 있던 자리.
    expect(sections, "알아볼 장면 섹션이 렌더되지 않는다").toContain("ScenesSection");
    expect(sections, "확인 계약 섹션이 렌더되지 않는다").toContain("ConfirmSection");
    expect(
      sections.indexOf("ScenesSection"),
      "계정을 요구하기 전에 알아볼 장면을 보여줘야 한다",
    ).toBeLessThan(sections.indexOf("ConfirmSection"));

    // page.tsx 주석이 이 순서와 이유를 함께 들고 있다. 목록을 통째로 대조하므로
    // 끼워 넣기·빼기·자리 바꾸기가 전부 여기서 걸린다.
    expect(sections).toEqual([
      "TransformationHero",
      "ScenesSection",
      "NoSideSection",
      "OneRoomSection",
      "PrivateLaneSection",
      "ConfirmSection",
      "NotForVendorsSection",
      "AvailableNowSection",
      "ClosingAction",
    ]);

    // 그 장면이 실제로 화면에 있고, 컴포넌트가 문장을 다시 적지 않고 정본을 렌더한다.
    // 장면 예시는 `scenes` 블록의 것이다 — 다른 블록으로 옮기면 그 섹션이 빈다.
    //
    // **문장을 여기 옮겨 적지 않는다.** 예전에 그렇게 했다가, 랜딩이 라이브 문항과
    // 다른 지어낸 문장을 보여 주는데도 이 단언이 통과했다(오히려 라이브에 맞추자
    // 실패했다). 문항이 실제와 같은지는 `landingSampleMatchesLive.test.ts` 가 본다.
    // 여기서는 **자리가 비지 않았나**만 본다.
    expect(scenesBlock, "처음 온 사람이 자기 얘기로 읽을 장면이 없다")
      .toMatch(/scene:\s*"[^"]{16,}"/u);
    expect(scenesBlock, "장면에 딸린 질문이 없다").toMatch(/question:\s*"[^"]{8,}"/u);
    expect(scenesBlock, "고를 답이 없다").toMatch(/options:\s*\[/u);
    expect(scenes).toContain("{scenes.sample");
    expect(scenes).toContain("{scenes.body}");
  });
});

/**
 * 히어로가 참조하는 정본 키 전부.
 *
 * `hero.body` 같은 점 표기와 `const { body, note } = hero` 구조분해를 **둘 다** 센다.
 * 점 표기만 세던 예전 검사는 구조분해로 풀어 쓴 죽은 키를 통째로 놓쳤다(2026-08-28 변형).
 * `const { hero } = landingContent` 는 오른쪽이 `landingContent` 라 여기 걸리지 않는다.
 */
function heroKeysUsedBy(componentSource: string): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const match of componentSource.matchAll(/\bhero\.([A-Za-z0-9_$]+)/gu)) {
    keys.add(match[1]);
  }
  for (const match of componentSource.matchAll(
    /const\s*\{([^}]*)\}\s*=\s*(?:landingContent\.)?hero\b/gu,
  )) {
    for (const part of match[1].split(",")) {
      const name = part.split(":")[0]?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) keys.add(name);
    }
  }
  return keys;
}
