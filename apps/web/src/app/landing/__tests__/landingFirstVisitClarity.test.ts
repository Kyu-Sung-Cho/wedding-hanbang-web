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
 *
 * ## 2026-08-29 이사 — 랜딩이 정본 시안으로 다시 지어졌다
 *
 * 랜딩이 `웨딩한방-랜딩시안/NotebookBest.html` 로 다시 지어지면서 섹션 여섯
 * (`ScenesSection` `NoSideSection` `OneRoomSection` `PrivateLaneSection`
 * `NotForVendorsSection` `PriceCompareSection`)과 그 카피 블록이 통째로 없어졌다.
 * **없어진 것은 자리이지 고지가 아니다.** 위 일곱 교훈은 그대로 두고, 각 단언이 지키던
 * 계약을 새 자리로 옮겼다:
 *
 *   히어로가 제품을 한 문장으로 말한다     hero.body (문장이 바뀜, 자리는 그대로)
 *   입력→출력을 한 문장으로 말한다          scenes → availableNow.cards(02)
 *   점수·궁합 금지                          scenes.note → availableNow.cards(02).note
 *   아모라를 처음 소개하는 자리             NoSideSection → hero.tape + AmoraNoteSection
 *   샘플·저장 안 함 고지                    privateLane.note → amoraNote.note
 *   불안을 다음 섹션이 받는다(인접 규칙)    OneRoom→PrivateLane → AmoraNote→Confirm
 *
 * **"계정 베타" 를 요구하던 단언은 지웠다.** 2026-08-29 파운더 결정으로 베타를 하지
 * 않기 때문이다(CLAUDE.md). 지우기만 하면 그 자리가 조용히 되살아나므로 반대 방향으로
 * 바꿔 걸었다 — "베타" 라는 틀이 화면에 **없어야** 한다(`BETA_FRAMING`). 다만 그 문장이
 * 지고 있던 **고지는 사실이라 남았고**(이용 방법·비용 미정, 지금은 결제 없음) 그 고지를
 * 지키는 단언은 유지한다.
 */

const PAGE = "src/app/landing/page.tsx";
const HERO = "src/components/landing/redesign/TransformationHero.tsx";
const AMORA_NOTE = "src/components/landing/redesign/AmoraNoteSection.tsx";
const CONFIRM = "src/components/landing/redesign/ConfirmSection.tsx";

/**
 * `availableNow` 의 **카드 배열만** 잘라낸다.
 *
 * 예전에는 `landingContent` 안의 `availableNow: {` 와 최상위 `export const availableNow`
 * 두 이름이 같아서 블록이 `closing`·`footer` 까지 삼켰고, 카드에 있어야 할 문장을
 * `footer.tagline` 으로 옮겨도 통과했다. 최상위 export 는 2026-08-29 개편에서 없어졌지만
 * **좁히는 이유는 그대로다** — 같은 블록 안에 각주(`footLead`/`footTail`)가 생겼고,
 * 카드에서 사라진 고지가 각주로 내려가면 그 카드가 무엇을 주는지 다시 빈칸이 된다.
 *
 * 그래서 `cards: [` 부터 **대괄호가 닫히는 자리까지**만 준다. 처음에는 `slice(at)` 로
 * 블록 끝까지 줬는데, 그 판을 일부러 깨 보니 "점수도 궁합도 매기지 않아요" 를 카드에서
 * 빼 `footTail` 뒤에 붙이는 변형이 그대로 초록불이었다(2026-08-29 실측). 자리를 재는
 * 검사가 자리를 안 재고 있었다.
 *
 * 못 찾거나 괄호가 안 닫히면 **던진다.** 조용히 넓어지면 자리 검사가 무의미해지고,
 * 그게 이번에 메운 구멍의 정체다.
 */
function availableNowCards(): string {
  const block = contentBlock("availableNow", "confirm");
  const marker = "cards: [";
  const at = block.indexOf(marker);
  if (at < 0) {
    throw new Error(
      "landingContent.ts 의 availableNow 에서 `cards: [` 를 찾지 못했습니다. "
      + "이름이 바뀌었다면 이 검사도 같이 옮겨야 합니다.",
    );
  }

  // 대괄호 깊이로 배열 끝을 찾는다. 카드 안에 중첩 배열이 생겨도 견딘다.
  let depth = 0;
  for (let i = at + marker.length - 1; i < block.length; i += 1) {
    if (block[i] === "[") depth += 1;
    else if (block[i] === "]") {
      depth -= 1;
      if (depth === 0) return block.slice(at, i + 1);
    }
  }
  throw new Error(
    "landingContent.ts 의 availableNow.cards 배열이 닫히지 않았습니다 — "
    + "닫는 자리를 못 찾으면 카드 밖으로 옮긴 문장이 카드 안에 있는 것처럼 통과합니다.",
  );
}

/**
 * 랜딩이 **스스로 "로그인 없이 열린다" 고 말한** 경로들.
 *
 * 히어로 첫 버튼이 어디로 가야 하는지를 리터럴로 못 박으면(예전엔 `/wedding-code`)
 * 파운더가 첫 행동을 바꿀 때마다 이 검사가 계약이 아니라 방해가 된다. 지키려는 것은
 * **"첫 행동이 계정을 요구하기 전에 무엇으로 이어지는지"** 지 특정 URL 이 아니다.
 * 그래서 목록을 손으로 적지 않고 `availableNow` 카드에서 뽑는다 — 그 카드들이 곧 화면이
 * "가입 안 해도 되는 것들" 이라고 광고하는 목록이다.
 */
function loginFreeHrefs(): readonly string[] {
  return [...availableNowCards().matchAll(/href:\s*"([^"]+)"/gu)].map((match) => match[1]);
}

/**
 * `primary: { label: "…", href: "…" }` 한 덩어리에서 href 를 이름으로 짚어 읽는다.
 *
 * 블록 전체를 `toContain("href: \"/price\"")` 로 물으면 **어느 버튼의** href 인지
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
 * **아직 아무도 안 그리는** 정본 키. 아래 역방향 검사에서만 예외로 둔다.
 *
 * `confirm.sampleNote` 는 2026-08-29 개편에서 그리는 자리를 잃었다 — 정본에는 있는데
 * `ConfirmSection` 이 렌더하지 않는다(`apps/web/src` 전체에서 참조 0건, 실측). 이 파일은
 * 카피 정본도 컴포넌트도 고치지 않기로 하고 들어왔으므로 **여기서 고치지 않고 드러내
 * 둔다.** 그 고지가 화면에 실제로 있는지는 `landingOutcomeEvidence.test.ts` 와
 * `twoSidedTrust.test.ts` 가 문자열로 본다.
 *
 * 목록이 썩지 않게 두 방향으로 잠근다: 누가 그리기 시작하면 "이제 목록에서 빼라" 고 울고,
 * 키가 정본에서 통째로 사라지면(=고지 삭제) 아래 마지막 반복문이 운다.
 */
const NOT_RENDERED_YET: ReadonlyArray<readonly [string, string]> = [
  // 2026-08-29: `confirm.sampleNote` 가 여기 있었다. 이 검사가 "카피에만 있고 화면엔
  // 없다" 고 알려 줘서 `ConfirmSection` 이 그리도록 고쳤다. 목록이 비었다는 것은
  // **모든 정본 키가 화면에 닿는다**는 뜻이다.
];

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

/**
 * 화면에서 **없어져야 하는** 틀.
 *
 * 2026-08-29 파운더 결정: 베타를 하지 않는다(CLAUDE.md). 계정은 그냥 만드는 것이고
 * 기능은 그냥 있는 기능이다. 이 파일은 예전에 `"계정 베타에서는 …"` 을 **요구**했으므로,
 * 그 단언을 지우기만 하면 문구가 조용히 되살아나도 아무도 안 운다. 방향을 뒤집어 건다.
 *
 * 없어지는 것은 틀이지 고지가 아니다 — "이용 방법과 비용은 아직 정해지지 않았고,
 * 계정을 만들어도 지금은 결제를 요청하지 않아요" 는 계속 참이라 아래에서 따로 지킨다.
 */
const BETA_FRAMING: ReadonlyArray<readonly [RegExp, string]> = [
  [/베타/u, "베타라는 틀을 쓴다"],
  [/사전\s*등록/u, "사전등록이라는 틀을 쓴다"],
  [/승인\s*대기/u, "승인 대기라는 틀을 쓴다"],
];

/** 카피 정본 + `page.tsx` + 랜딩 컴포넌트 전부(주석 벗김). 손으로 적은 목록은 새 파일을 놓친다. */
function landingSurfaces(): ReadonlyArray<readonly [string, string]> {
  return [
    [CONTENT_PATH, rendered(CONTENT_PATH)],
    [PAGE, rendered(PAGE)],
    ...everyLandingComponent(),
  ];
}

describe("landing first visit clarity", () => {
  it("states what the product does and connects the first action to Amora", () => {
    const heroBlock = contentBlock("hero", "amoraNote");
    const amoraBlock = contentBlock("amoraNote", "scenes");
    const confirmBlock = contentBlock("confirm", "boundaries");
    const nowCards = availableNowCards();
    const hero = rendered(HERO);
    const amora = rendered(AMORA_NOTE);
    const confirm = rendered(CONFIRM);
    const sections = renderedSections();

    // 무엇을 하는 제품인지 한 문장으로 말한다. 2026-08-27 개편 전에는 H1
    // "둘이 말하면, 결혼 준비가 정리돼요."가 그 자리였고, 2026-08-29 정본 시안 개편
    // 뒤에는 히어로 본문이 "어디에 뭘 적어뒀는지도 헷갈릴 때가 있잖아요" 로 잇는다.
    // **히어로 블록 안에서** 찾는다 — 파일 전체로 물으면 이 문장을 footer.tagline 으로
    // 옮겨도 통과한다(2026-08-28 변형으로 확인).
    expect(heroBlock, "결혼 준비의 아픈 자리를 말하는 문장이 히어로에 없다")
      .toContain("어디에 뭘 적어뒀는지도 헷갈릴 때가 있잖아요.");
    // 아픔만 말하고 끝내지 않는다 — 우리가 무엇을 대신 해주는지가 같은 문장 안에 있어야
    // 한다. 앞 절만 남기면 "정리 안 되죠?" 라고 묻고 마는 화면이 된다.
    expect(heroBlock, "우리가 무엇을 해주는지가 히어로에서 사라졌다")
      .toContain("가격과 조건은 저희가 원문 그대로 펼쳐 둘 테니, 두 분은 정하는 것만 하세요.");
    // 카피에 남아 있어도 그리는 자리가 없으면 화면은 빈다.
    expect(hero, "히어로가 hero.body 를 그리지 않는다 — 카피만 남고 화면은 빈다")
      .toContain("{hero.body}");

    // 입력(각자 답한다)과 출력(고른 문장 그대로 나란히)이 같은 문장 안에 있어야 한다.
    // 2026-08-29 전에는 히어로 본문과 `scenes` 블록이 이걸 겸했고, 지금은 "지금 되는 것"
    // 02 카드가 진다. 카드에서 사라지면 그 카드가 무엇을 주는지 다시 빈칸이 된다.
    expect(nowCards, "스무 장면이 무엇을 주는지가 '지금 되는 것' 카드에서 사라졌다")
      .toContain("스무 장면에 각자 답하면 두 사람이 고른 문장을 그대로 나란히 놓아드려요.");
    // CLAUDE.md 필수 고지 — WeddingCode 는 검증된 궁합 검사가 아니다. 옛 `scenes.note` 가
    // 지고 있었고 그 섹션이 없어지면서 이 카드로 옮겨왔다. **같은 카드 안**이어야 한다:
    // 나란히 보여준다는 문장과 떨어지면 화면이 점수를 약속하는 것처럼 읽힌다.
    expect(nowCards, "점수·궁합을 매기지 않는다는 고지가 스무 장면 카드에서 사라졌다")
      .toContain("점수도 궁합도 매기지 않아요");
    // 견적 카드도 같은 규칙 — 넣으면 무엇이 나오는지 말한다.
    expect(nowCards, "견적을 넣으면 무엇이 나오는지가 '지금 되는 것' 카드에서 사라졌다")
      .toContain("업체에 그대로 물어볼 질문을 만들어드려요");
    // 산출물을 개수로만 말하지 않는다. 이전 문구("지금 볼 세 가지가 나와요")는
    // 그 셋이 무엇인지 랜딩 어디에도 없어서 입력은 분명한데 출력이 빈칸이었다.
    // 표기를 하나만 막으면 "세 가지"를 "3가지"로 바꿔 그대로 되살릴 수 있다 —
    // 2026-08-28 변형이 실제로 그렇게 통과했다. 표기가 아니라 뜻으로 막는다.
    expect(
      rendered(CONTENT_PATH),
      "산출물을 개수로만 말하면 처음 온 사람은 뭘 받는지 모른다",
    ).not.toMatch(/(?:세|셋|서너|[0-9]+)\s*가지가?\s*(?:나와요|나옵니다|보여드려요|보여드릴게요)/u);

    // 첫 행동은 계정을 요구하지 않는다. 2026-08-27에 후크를 AI에서 "두 사람 사이"로
    // 옮겼고(비로그인 아모라 체험은 #245로 닫혔다), 2026-08-29 정본 시안 개편에서 첫
    // 버튼이 `/wedding-code` 에서 `/price` 로 옮겨갔다. **URL 을 못 박지 않는다** —
    // 지킬 것은 첫 행동이 계정을 요구하기 전에 무엇으로 이어지는지다. 그래서 화면이
    // 스스로 "가입 안 해도 되는 것들" 이라고 광고한 목록(=`availableNow` 카드)에서
    // 답을 뽑는다.
    //
    // 예전에는 히어로 블록에 `href: "/wedding-code"` 가 **있기만** 하면 통과해서
    // primary 와 secondary 를 통째로 맞바꿔도 초록불이었다. 이름으로 짚어 읽는다.
    const openWithoutAccount = loginFreeHrefs();
    expect(openWithoutAccount.length, "로그인 없이 되는 것 목록을 못 읽었다").toBeGreaterThan(2);
    expect(
      openWithoutAccount,
      "히어로의 첫 버튼이 로그인 없이 열리는 곳으로 가지 않는다 — 처음 온 사람이 바로 막힌다",
    ).toContain(linkHref(heroBlock, "primary"));
    expect(
      openWithoutAccount,
      "히어로의 둘째 버튼도 계정을 요구한다 — 첫 화면의 행동 둘이 모두 막힌다",
    ).toContain(linkHref(heroBlock, "secondary"));
    expect(hero.indexOf("{hero.primary.label}"), "히어로가 primary 버튼을 그리지 않는다")
      .toBeGreaterThan(-1);
    expect(
      hero.indexOf("{hero.primary.label}"),
      "화면에서 secondary 가 primary 보다 먼저 온다 — 첫 행동이 바뀐다",
    ).toBeLessThan(hero.indexOf("{hero.secondary.label}"));

    // 아모라를 처음 소개하는 자리에 이름이 있다. 2026-08-29 전에는 `NoSideSection` 이
    // 그 자리였고, 지금은 히어로 맨 위 테이프 이름표가 진다("아모라 · 대화를 정리하는 AI").
    // 이름이 없으면 바로 아래 노트 카드가 **누가 쓴 답인지 모르는 글**이 된다.
    expect(heroBlock, "아모라를 처음 소개하는 자리에 이름이 없다").toContain("아모라");
    expect(hero, "히어로가 이름표를 그리지 않는다").toContain("{hero.tape}");
    expect(sections, "아모라를 보여주는 섹션이 렌더되지 않는다").toContain("AmoraNoteSection");
    expect(sections, "확인 계약 섹션이 렌더되지 않는다").toContain("ConfirmSection");
    // 계정을 요구하는 섹션(`confirm` — eyebrow 가 "계정을 만들면")보다 아모라가 먼저다.
    expect(
      sections.indexOf("AmoraNoteSection"),
      "계정을 요구하는 섹션보다 아모라 소개가 먼저여야 한다",
    ).toBeLessThan(sections.indexOf("ConfirmSection"));
    expect(confirmBlock, "계정을 요구하는 자리가 확인 섹션이 아니게 됐다")
      .toContain("계정을 만들면");

    // 샘플·저장 고지. 옛 `privateLane.note` 가 지고 있었고, 그 섹션이 없어지면서
    // **아모라가 처음 말하는 카드 안으로** 옮겨왔다. 바깥 작은 글씨로 빼면 카드만
    // 캡처됐을 때 그 사실이 떨어져 나간다 — 그래서 자리를 블록 안으로 못 박는다.
    expect(amoraBlock, "이 화면의 대화가 샘플이라는 고지가 사라졌다")
      .toContain("기능을 보여주기 위한 샘플이고");
    expect(amoraBlock, "이 화면에서 저장되지 않는다는 고지가 사라졌다")
      .toContain("이 화면에서는 실제로 저장되지 않아요");
    expect(amora, "아모라 카드가 고지를 그리지 않는다").toContain("{amoraNote.note}");

    // 계정을 만들면 무엇이 달라지는지 — 아모라가 제안하고, 사람이 확인해야 반영된다.
    // 옛 문장은 "계정을 만들면 아모라가 한 번에 한 가지 변경을 제안하고"였고,
    // 2026-08-27에 주어가 "계정 베타에서는"으로 바뀌었다가, 2026-08-29 파운더 결정으로
    // 베타라는 틀이 없어졌다(아래 `BETA_FRAMING` 이 되살아나는 것을 막는다).
    // 남은 것은 계약 자체다 — 한 번에 한 가지, 확인한 것만.
    expect(confirmBlock, "한 번에 한 가지만 제안한다는 계약이 사라졌다")
      .toContain("예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고");
    expect(confirmBlock, "확인한 것만 반영된다는 계약이 사라졌다")
      .toContain("눌러서 확인한 것만 준비 기록에 반영해요");
    expect(confirmBlock, "제안하는 쪽이 아모라라는 것이 화면에서 사라졌다")
      .toContain("아모라의 제안 · 아직 반영 전");
    // 베타는 없어졌지만 이 고지는 **사실이라 남는다**(CLAUDE.md 2026-08-29).
    // 틀을 걷어내면서 같이 지워지기 가장 쉬운 문장이라 따로 못 박는다.
    expect(confirmBlock, "비용·결제 고지가 베타 틀과 함께 지워졌다")
      .toContain("이용 방법과 비용은 아직 정해지지 않았고, ");
    expect(confirmBlock, "결제를 요청하지 않는다는 고지가 사라졌다")
      .toContain("계정을 만들어도 지금은 결제를 요청하지 않아요.");
    // 정본에 남아 있어도 그리지 않으면 화면에는 없다.
    expect(confirm, "확인 섹션이 confirm.body 를 그리지 않는다").toContain("{confirm.body}");
    expect(confirm, "‘아직 반영 전’ 라벨을 그리는 자리가 없다")
      .toContain("{confirm.sample.proposeLabel}");

    // 히어로 안에서 약속(H1)이 설명(본문)보다 먼저 온다. H1 문장 자체는 여기 옮겨 적지
    // 않는다 — `landingHeadlineParity.test.ts` 가 정본과 글자까지 대조한다. 여기서
    // 지키는 것은 **순서**다.
    expect(hero.indexOf("hero.title"), "히어로가 H1 을 정본에서 읽지 않는다")
      .toBeGreaterThan(-1);
    expect(hero.indexOf("hero.title")).toBeLessThan(hero.indexOf("{hero.body}"));

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
    // 히어로는 여기서 뺀다. H1 은 줄바꿈·색 강조 때문에 손으로 나눠 그리며, 그 드리프트는
    // `landingHeadlineParity.test.ts` 가 글자까지 대조한다.
    for (const [block, componentSource, alias, label] of [
      [amoraBlock, amora, "amoraNote", "AmoraNoteSection"],
      [confirmBlock, confirm, "confirm", "ConfirmSection"],
    ] as const) {
      for (const key of keysOf(block)) {
        // 낱말 경계를 붙인다. `confirm.body` 를 그냥 `toContain` 으로 물으면
        // `{confirm.body2}` 가 대신 대답해서, body 를 그리는 `<p>` 를 지워도 통과한다.
        const drawn = new RegExp(`\\b${alias}\\.${key}\\b`, "u").test(componentSource);
        const knownGap = NOT_RENDERED_YET.some(([a, k]) => a === alias && k === key);
        if (knownGap) {
          expect(
            drawn,
            `landingContent.${alias}.${key} 를 이제 ${label} 이 그린다 — NOT_RENDERED_YET 에서 빼라`,
          ).toBe(false);
          continue;
        }
        expect(drawn, `landingContent.${alias}.${key} 를 ${label} 이 그리지 않는다`).toBe(true);
      }
    }

    // 예외 목록이 썩지 않게: 거기 적힌 키는 정본에 **아직 있어야** 한다. 키가 통째로
    // 사라지면(=고지를 지운 것) 위 반복문은 아무 말도 안 하므로 여기서 운다.
    for (const [alias, key] of NOT_RENDERED_YET) {
      const block = alias === "confirm" ? confirmBlock : amoraBlock;
      expect(
        keysOf(block),
        `landingContent.${alias}.${key} 가 정본에서 사라졌다 — 고지를 지웠거나 이름이 바뀌었다`,
      ).toContain(key);
    }
  });

  it("확인 계약을 뒤집는 문장이 어디에도 붙어 있지 않다", () => {
    // 계약 문장을 그대로 두고 뒤에 뒤집는 한 줄을 붙이는 변형이 이 파일 전체를 통과했다.
    // 카피 정본과 랜딩 컴포넌트 **전부**, 그리고 페이지 자신을 본다 — 정본을 안 건드리고
    // 컴포넌트나 page.tsx 에 손으로 적어 넣는 길이 따로 있다.
    const surfaces = landingSurfaces();
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

  it("베타라는 틀이 화면에 없다", () => {
    // 2026-08-29 파운더 결정. 예전에 이 파일은 `"계정 베타에서는 …"` 을 **요구**했고,
    // 그 단언을 그냥 지우면 문구가 조용히 되살아나도 아무도 안 운다. 방향을 뒤집는다.
    // 주석은 `rendered` 가 벗기므로 "왜 뺐는지" 를 정본 주석에 적어 두는 길은 열려 있다.
    const surfaces = landingSurfaces();
    expect(surfaces.length, "볼 파일을 하나도 못 찾았다").toBeGreaterThan(5);

    for (const [name, text] of surfaces) {
      for (const [pattern, why] of BETA_FRAMING) {
        expect(
          text,
          `${name}: ${why} — 2026-08-29 파운더 결정으로 베타를 하지 않는다(CLAUDE.md)`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("shows the scene a first visitor recognises before asking for an account", () => {
    const amoraBlock = contentBlock("amoraNote", "scenes");
    const amora = rendered(AMORA_NOTE);

    // 2026-08-27 개편 전에는 이 케이스가 ProblemMirrorSection → PreparationResult 순서를
    // 지켰다. "카톡에는 날짜, 메모장에는 예산, 머릿속에는 해야 할 일."로 흩어진 준비를
    // 비춘 **뒤에** 결과를 보여준다는 규칙이었다. 그다음 판에서는 히어로(문제 문장) →
    // ScenesSection(알아볼 장면) → ConfirmSection(남는 것)이 그 일을 나눠 맡았고,
    // 2026-08-29 정본 시안 개편에서 다시 히어로(문제 문장) → AmoraNoteSection(대화 한
    // 토막) → ConfirmSection(남는 것)이 됐다. 그래서 지키는 대상은 그때부터 문구가 아니라
    // **섹션 순서**다.
    //
    // 목록은 `page.tsx` 원문이 아니라 `renderedSections()` 에서 온다. 원문에서 세면
    // 주석으로 꺼 놓은 섹션이 렌더된 것으로 잡혀 아래 단언들이 전부 빈 통과였다.
    const sections = renderedSections();

    // 이유가 적힌 규칙을 전체 목록 대조보다 **먼저** 세운다. 자리를 바꾸면 두 단언이
    // 다 깨지는데, 그때 먼저 보이는 문장이 "왜 안 되는지"를 말해야 한다.
    //
    // 인접 규칙. 예전에는 ④(나만 보는 자리)가 ③(두 사람 대화를 한 덩어리로 읽는다)
    // 바로 뒤여야 했다 — ③ 직후에 "그럼 내가 쓴 게 다 가나" 라는 걱정이 오는데 다음
    // 섹션이 그걸 받지 않으면 ③이 불안으로 끝나기 때문이다. 두 섹션은 2026-08-29에
    // 없어졌지만 **규칙은 그대로 살아 있다**: 아모라가 답하는 카드 직후에 오는 걱정은
    // "그럼 아모라가 내 계획을 마음대로 바꾸나" 이고, 그 걱정을 받는 것이 확인
    // 섹션("아모라가 바꾸지 않아요. 확인한 것만 남아요.")이다. 사이에 다른 섹션을 끼우면
    // 아모라 카드가 다시 불안으로 끝난다 — page.tsx 주석이 못 박은 순서다.
    expect(sections, "아모라 카드 섹션이 렌더되지 않는다").toContain("AmoraNoteSection");
    expect(sections, "확인 계약 섹션이 렌더되지 않는다").toContain("ConfirmSection");
    expect(
      sections.indexOf("ConfirmSection"),
      "확인 계약이 아모라 카드 바로 뒤가 아니다 — 아모라 카드가 불안으로 끝난다",
    ).toBe(sections.indexOf("AmoraNoteSection") + 1);

    // 알아볼 장면이 계정 요구보다 먼저다 — 옛 "문제를 비춘 뒤에 결과" 규칙이 서 있던
    // 자리다. 지금 그 장면은 아모라가 실제로 답하는 노트 카드다.
    expect(
      sections.indexOf("AmoraNoteSection"),
      "계정을 요구하기 전에 알아볼 장면을 보여줘야 한다",
    ).toBeLessThan(sections.indexOf("ConfirmSection"));

    // page.tsx 주석이 이 순서와 이유를 함께 들고 있다(제품 계약의 축 순서:
    // 아모라 → 확인 → 커뮤니티 → 부가 도구 → 하지 않는 것 → 마무리. 공시 가격·위약금은
    // 부가 기능이라 전용 섹션이 아니라 `availableNow` 카드 한 장이다).
    // 목록을 통째로 대조하므로 끼워 넣기·빼기·자리 바꾸기가 전부 여기서 걸린다.
    expect(sections).toEqual([
      "TransformationHero",
      "AmoraNoteSection",
      "ConfirmSection",
      // 2026-08-29 복원 — 운영 랜딩(`hanbang.ai/landing`)에 있던 넷을 시안 개편에서
      // 잃었다가 파운더 지적으로 되살렸다. 각 섹션의 눈썹이 방문자가 실제로 하는
      // 질문이고, 그래서 순서가 곧 **반론 처리 순서**다.
      "ScenesSection",
      "NoSideSection",
      "OneRoomSection",
      "PrivateLaneSection",
      "CommunitySection",
      "AvailableNowSection",
      "BoundariesSection",
      "ClosingAction",
    ]);

    // 그 장면이 실제로 화면에 있고, 컴포넌트가 문장을 다시 적지 않고 정본을 렌더한다.
    // 장면은 `amoraNote` 블록의 것이다 — 다른 블록으로 옮기면 그 카드가 빈다.
    //
    // **문장을 여기 옮겨 적지 않는다.** 예전에 그렇게 했다가, 랜딩이 라이브 문항과
    // 다른 지어낸 문장을 보여 주는데도 이 단언이 통과했다(오히려 라이브에 맞추자
    // 실패했다). 샘플이 실제와 같은지는 `landingSampleMatchesLive.test.ts` 가 본다.
    // 여기서는 **자리가 비지 않았나**만 본다: 물음이 있고, 답이 있고, 그 답이 막연한
    // 위로가 아니라 지금 할 일 목록으로 이어지는가.
    expect(amoraBlock, "처음 온 사람이 자기 얘기로 읽을 물음이 없다")
      .toMatch(/ask:\s*"[^"]{8,}"/u);
    expect(amoraBlock, "그 물음에 대한 답이 없다").toMatch(/answerMark:\s*"[^"]{8,}"/u);
    expect(amoraBlock, "답이 지금 할 일로 이어지지 않는다").toMatch(/checklist:\s*\[/u);
    expect(amora, "아모라 카드가 물음을 그리지 않는다").toContain("{amoraNote.ask}");
    expect(amora, "아모라 카드가 답을 그리지 않는다").toContain("{amoraNote.answerMark}");
    expect(amora, "아모라 카드가 할 일 목록을 그리지 않는다").toContain("amoraNote.checklist.map");
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
