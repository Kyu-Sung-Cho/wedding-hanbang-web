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
 * 랜딩이 양쪽(처음 온 사람 · 업체)에게 하는 약속과 그 근거를 지킨다.
 *
 * ## 2026-08-27 재조준
 *
 * 랜딩 축이 공시 가격에서 "둘이 어디서 갈리는지"로 바뀌면서 이 파일이 읽던
 * `TrustEvidenceSection`·`CommunityBridgeSection`이 사라졌다. 두 섹션이 지던 근거
 * (출처·기준 시점·한계·광고 표시)는 사라진 게 아니라 자리를 옮겼다.
 *
 * ## 2026-08-28 구멍 메우기 — 적대적 검증이 이 파일을 그냥 지나갔다
 *
 * 변형 215개를 심어 보니 이 파일에서만 아래 갈래가 전부 초록이었다. 무엇이
 * 빠져나갔고 무엇으로 막았는지 적어 둔다. **아래 다섯은 지금도 이 파일의 뼈대다.**
 *
 * 1. **주석이 코드 대신 대답했다.** 이 파일이 갖고 있던 `withoutComments` 복사본이
 *    줄 **처음**의 `//` 만 지웠다. 게다가 `content` 는 그 함수를 통과하지도 않고
 *    **원문 그대로** 읽혔다 — 가격 출처·기준월·확인일을 주석 처리하면 12개 단언이
 *    전부 통과했고, 자기 주석에 걸려 넘어져 실패한 단언도 하나 있었다
 *    (`신청만으로 결제되지 않아요` 가 설명 주석에 인용돼 있었다).
 *    → 복사본을 지우고 `landingSource` 의 `rendered`/`contentBlock` 만 쓴다.
 * 2. **자리를 안 봤다.** 파일 전체 `toContain` 이라 히어로 문장을 `footer.tagline`
 *    으로 옮겨도 통과했다. → 있어야 할 블록에서 찾는다(`contentBlock`).
 * 3. **덧붙임을 못 막았다.** 계약 문장을 그대로 둔 채 뒤에 뒤집는 문장을 붙이면
 *    전부 초록이었다. 제일 위험했던 실례가 확인 계약 뒤의
 *    "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요" 다 — 제품 계약
 *    (아모라는 사용자 확인 없이 아무것도 바꾸지 않는다)을 정면으로 뒤집는다.
 *    → `FORBIDDEN` 배터리로 **있으면 안 되는 것**도 같이 본다.
 * 4. **정규식이 좁았다.** `\d[\d,]*\s*곳` 이라 "406개" 가 통과했고,
 *    `(없|안)` 이라 "가입하지 **않**아도 아모라와…" 가 통과했다(#245 를 지키는
 *    유일한 가드다). 금지어가 정확 문자열 7개뿐이라 "이미 1만 쌍이 함께 준비하고
 *    있어요" 도 통과했다. → 어형·표기·단위를 함께 받는 패턴으로 바꿨다.
 * 5. **렌더가 아니라 카피만 봤다.** AI 고지를 그리는 `<p>` 를 지워도 카피 문자열이
 *    대신 대답했고, 푸터 링크를 전부 `href="#"` 로 바꿔도 통과했다.
 *    → `expectWired()` 로 **그 값을 화면이 실제로 쓰는지**까지 본다.
 * 6. **죽은 가드.** `slice(indexOf(a), indexOf(b))` 뒤 `length > 0` 은 경계가
 *    사라져도 `slice(-1)` 이 한 글자를 주므로 영원히 참이었다.
 *    → 못 찾으면 던지는 `contentBlock()`/`between()` 으로 바꿨다.
 *
 * ## 2026-08-29 재조준 — 랜딩이 정본 시안으로 다시 지어졌다
 *
 * `docs/landing/NotebookBest.html` 로 되돌리면서(a95185b2e·10be0b8cc·3bed8a3a3)
 * 이 파일이 읽던 섹션 여섯과 카피 키 여섯이 통째로 없어졌다. **고지는 사라지지
 * 않았고 자리를 옮겼다.** 어디로 갔는지 적어 둔다 — 다음에 또 개편되면 여기서 찾아라.
 *
 *   AI 고지        `noSide.note`·`notForVendors.aiNotice` → `amoraNote.note` + `boundaries.items[2]`
 *                                                          + `footer.notice` 끝줄
 *   궁합·점수 금지 `scenes.note`         → `availableNow.cards[1].note`
 *   저장 안 함     `privateLane.note`    → `amoraNote.note` + `availableNow.cards[0].note`
 *   업체 편 아님   `notForVendors`       → `boundaries.items[0]`·`[1]`
 *   가격 출처·시점 `notForVendors.priceAside`·`footerLinks` 곁 → `availableNow.cards[2].note`
 *                                                              + `footer.notice`
 *   샘플 표시      `confirm.note` 곁     → `confirm.sampleNote` + `amoraNote.note`
 *   로그인 없이 목록 `availableNow`(최상위 export)·`footerLinks.open`
 *                                        → `availableNow.cards` + `footer.columns[0]`
 *
 * ### 지운 단언 하나 — 베타
 *
 * **2026-08-29 파운더 결정: 베타를 하지 않는다**("베타 우리 안할거야 알아둬").
 * `/beta` 페이지·`lib/beta-count.ts`·`constants/beta.ts`·`ForBetaCouples.tsx` 가
 * 삭제됐고 `/beta` 는 `/landing` 으로 308 한다. 그래서 아래 셋을 **지웠다**:
 *
 *   `closing.note` 의 "…계정 베타예요."      · `confirm` 의 "계정 베타에서는"
 *   `footerLinks.beta` 가 푸터에 그려지는지
 *
 * 지운 대신 **반대 방향 가드를 넣었다** — "베타" 라는 틀이 화면에 **다시 생기면**
 * 실패한다(`베타가 화면에 없다`). 없어진 것은 틀이지 고지가 아니다:
 * "향후 이용 비용은 아직 정해지지 않았고, 계정을 만들어도 지금은 결제를 요청하지
 * 않아요" 는 오늘도 참이라 **그 두 단언은 그대로 남겼다**(confirm·closing 두 자리).
 *
 * ### 표기가 아니라 뜻을 재도록 고친 것 둘
 *
 * - **업체 수.** 옛 단언은 "랜딩에 업체 수가 있으면 실패" 였다. 새 랜딩은 공시 카드에
 *   `829곳` 을 다시 쓴다. 지키던 것은 숫자의 유무가 아니라 **수치에 근거와 기준 시점이
 *   붙어 있는가** 였으므로(옛 주석이 그렇게 적어 뒀다), 숫자를 세지 말고 **근거가
 *   곁에 있는지**를 재도록 바꿨다(업체 수와 공시 기준 시점 검사).
 * - **H1.** 옛 컴포넌트는 H1 글자를 손으로 적었고 그래서 문자열로 물었다. 새
 *   컴포넌트는 `hero.title` 을 읽는다 — 문자열로 물으면 영원히 실패한다.
 *   `<h1>` 이 카피를 **읽는지**로 바꿨다.
 *
 * ### 이 파일이 오늘 잡고 있는 진짜 위반
 *
 * `headerNav` 의 `{ label: "공시 가격", href: "#price" }` 가 **아무 데도 가지 않는다.**
 * `id="price"` 를 갖고 있던 `PriceCompareSection` 이 10be0b8cc 에서 삭제됐는데 내비
 * 항목만 남았다. 고치는 것은 카피·컴포넌트 쪽 일이라(내비에서 빼든, 공시 카드에 id 를
 * 주든) 여기서는 **가드를 약하게 만들지 않고 그대로 울린다.**
 */

const REDESIGN = "src/components/landing/redesign";

/** 전부 주석을 벗긴 뒤 본다. 화면에 나가는 것만이 계약이다. */
const landing = rendered("src/app/landing/page.tsx");
const header = rendered(`${REDESIGN}/LandingHeader.tsx`);
const mobileMenu = rendered(`${REDESIGN}/MobileLandingMenu.tsx`);
const accountActions = rendered(`${REDESIGN}/LandingAccountActions.tsx`);
const hero = rendered(`${REDESIGN}/TransformationHero.tsx`);
const content = rendered(CONTENT_PATH);
const boundariesSection = rendered(`${REDESIGN}/BoundariesSection.tsx`);
const availableNowSection = rendered(`${REDESIGN}/AvailableNowSection.tsx`);
const confirmSection = rendered(`${REDESIGN}/ConfirmSection.tsx`);
const closing = rendered(`${REDESIGN}/ClosingAction.tsx`);
const footer = rendered(`${REDESIGN}/LandingFooter.tsx`);

/**
 * 랜딩이 실제로 렌더하는 소스 전부.
 *
 * 가드가 파일 몇 개만 손으로 적어 두면 그 밖에 남은 잔재를 놓친다 — 실제로
 * ContinuitySection·SharedPrivateSection에 남아 있던 체험 문구를 그렇게 놓쳤다.
 * 목록을 적지 말고 폴더를 읽는다(`everyLandingComponent`).
 */
const components = everyLandingComponent();
const renderedCopy = [landing, content, ...components.map(([, src]) => src)].join("\n");

/**
 * 카피 값이 **화면에 배선돼 있는가**.
 *
 * 카피 파일에 문장이 남아 있으면, 그것을 그리는 `<p>` 를 지워도 문자열 단언은
 * 통과한다. 2026-08-27 변형에서 AI 고지 `<p>` 를 지운 것이 그렇게 빠져나갔다.
 * `{amoraNote.note}` 든 `href={closing.primary.href}` 든 참조 표기는 똑같이
 * `{키}` 를 품으므로 그것으로 찾는다.
 */
function expectWired(reference: string): void {
  const needle = `{${reference}}`;
  const owner = components.find(([, src]) => src.includes(needle));
  expect(
    owner?.[0],
    `${reference} 를 화면이 쓰지 않는다 — 카피에만 남고 렌더는 사라졌다`,
  ).toBeDefined();
}

/**
 * 경계 둘 사이. **못 찾으면 실패한다.**
 *
 * `indexOf` 가 -1 이면 `slice` 가 조용히 뭔가를 돌려주고 `length > 0` 가드는
 * 영원히 참이 된다(이 파일이 실제로 그랬다).
 */
function between(text: string, from: string, to: string, label: string): string {
  const start = text.indexOf(from);
  expect(start, `${label}: "${from}" 가 없어졌다`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf(to, start + from.length);
  expect(end, `${label}: "${to}" 가 없어졌다 — 경계가 사라지면 검사가 무의미해진다`)
    .toBeGreaterThan(start);
  return text.slice(start, end);
}

/** 카피 블록에서 목적지만 뽑는다. 템플릿 리터럴(`mailto:${…}`)도 함께 받는다. */
function hrefsIn(block: string): string[] {
  return [...block.matchAll(/href: ["`]([^"`]+)["`]/gu)].map((match) => match[1]);
}

/**
 * 있으면 안 되는 문장들.
 *
 * 계약 문장을 그대로 두고 **뒤에 뒤집는 문장을 붙이는** 변형이 이 파일을 전부
 * 통과했다(2026-08-27). "있어야 할 것"만 세면 덧붙임을 절대 못 잡는다.
 *
 * 정확 문자열이 아니라 패턴으로 적는다 — 어형 하나만 바꿔도 열거는 빠져나간다.
 * 각 패턴은 **현재 카피에서 오탐이 0인 것을 확인하고** 넣었다. 계약 문장 자체가
 * 같은 낱말을 쓰는 자리(예: "업체에 점수·등급·순위를 매기지 않아요")는 서술형
 * 어미까지 붙여 긍정 진술만 걸리게 했다.
 */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  // 제품 계약: 아모라는 사용자 확인 없이 아무것도 바꾸지 않는다.
  [
    /(?:확인|승인)[^.\n]{0,10}(?:없이|건너뛰|생략|안\s?하고|하지\s?않고|안\s?해도|하지\s?않아도)[^.\n]{0,24}(?:반영|저장|적용|변경|바꿔|바꾸|고쳐|입력)/u,
    "확인 없이 반영한다고 말한다 — 제품 계약을 정면으로 뒤집는다",
  ],
  [
    /(?:반영|저장|적용)[^.\n]{0,16}(?:뒤|후|나중)[^.\n]{0,12}(?:확인|승인)/u,
    "먼저 반영하고 나중에 확인한다고 말한다",
  ],
  [
    /(?:자동으로|알아서|스스로)[^.\n]{0,16}(?:반영|저장|적용|바꿔|바꾸|변경|정리해|추가해|삭제)/u,
    "사용자 확인 없이 자동으로 바꾼다고 말한다",
  ],
  [
    /아모라(?:가|는|도)?[^.\n]{0,12}(?:대신|알아서)[^.\n]{0,12}(?:정해|결정|골라|선택|판단)/u,
    "아모라가 대신 결정한다고 말한다 — 한쪽 손을 들지 않는다는 계약과 어긋난다",
  ],

  // 업체에서 돈을 받지 않는다(업체 제휴 0건이라 지킬 수 있는 문장이다).
  [
    /(?:광고비|소개비|수수료|제휴비|입점비)[^.\n]{0,16}(?:받아요|받습니다|받고\s?있|받으면|받는\s?대신|받아서)/u,
    "업체 돈을 받는다고 말한다",
  ],
  [
    /(?:점수|등급|순위|별점|평점)(?:를|을)?\s*(?:매겨|매깁니다|매겨요|드려요|제공해)/u,
    "업체·상품에 점수·등급·순위를 매긴다고 말한다",
  ],
  [/(?:최저가|최저\s*가격)/u, "최저가를 말한다 — 우리는 가격 적정성을 판정하지 않는다"],
  [
    /(?:예약|계약)(?:을|를)?\s*(?:대신\s*)?(?:잡아|잡아드려|해\s?드려요|진행해\s?드려요)/u,
    "예약·계약을 대신 해준다고 말한다 — 거래층은 보류 중이다",
  ],
  [
    /계약서[^.\n]{0,12}(?:해석해|분석해|검토해)\s*(?:드려요|드립니다|줘요|드릴게요)/u,
    "계약서를 대신 해석해 준다고 말한다",
  ],
  [
    /(?:법률|의료|금융)[^.\n]{0,10}(?:판단|상담)(?:해|을|를)?\s*(?:드려요|드립니다|해\s?드려요)/u,
    "법률·의료·금융 판단을 한다고 말한다",
  ],

  // 비용 경계. "향후 이용 비용은 아직 정해지지 않았다" 가 정본이다.
  [
    /(?:서비스|웨딩한방|모든\s*기능|전\s*기능|전부|평생|계속)[^.\n]{0,8}(?:무료|공짜)/u,
    "서비스가 통째로 무료라고 말한다 — 비용은 아직 정해지지 않았다",
  ],
  [/((?:항상|평생|영구|무제한)[^.\n]{0,6}(?:무료|공짜)|(?:무료|공짜)[^.\n]{0,6}(?:항상|평생|영구|무제한))/u, "영구·무제한 무료라고 단정한다"],

  // 없는 사회적 증거. 랜딩은 이용자 수를 말할 근거가 없다.
  [
    /\d[\d,]*\s*(?:만\s*)?(?:쌍|커플|가정|부부|가입자|이용자)/u,
    "이용자 수를 숫자로 말한다 — 근거가 없다",
  ],
  [
    /(?:이용자|가입자|사용자|예비부부|커플)[^.\n]{0,12}\d[\d,]*\s*(?:만\s*)?명|\d[\d,]*\s*(?:만\s*)?명(?:의)?\s*(?:이용자|가입자|사용자|예비부부|커플)/u,
    "두 어순의 이용자 수를 명 단위로 말한다 — 근거가 없다",
  ],
  [
    /(?:이미|벌써|현재|지금까지)[^.\n]{0,12}(?:\d[\d,]*|수많은|많은|여러|수천|수만)[^.\n]{0,8}(?:쌍|명|커플|부부|사람|팀)/u,
    "이미 많은 사람이 쓰고 있다고 말한다",
  ],
  [/(?:평점|별점|만족도)/u, "평점·별점·만족도를 말한다"],
  [
    /\d[\d,]*\s*(?:%|퍼센트|만원|원|시간|분)[^.\n]{0,12}(?:절약|절감|아꼈|아껴|줄였|줄여|아낄)/u,
    "절약·절감 수치를 말한다",
  ],

  // 가격 출처는 한국소비자원 하나뿐이다(업체 제휴 0건).
  [
    /(?:제휴사|협력사|파트너사|자체\s*조사)[^.\n]{0,12}(?:가격|최저|기본가|요금|시세)/u,
    "한국소비자원 말고 다른 가격 출처가 있다고 말한다",
  ],

  // 장기기억은 오늘 켤 수 없다(운영 env가 강제로 끈다). 이어지는 것은 대화 기록이지
  // 모델의 기억이 아니다. 어형(`기억해/기억한/기억으로`)을 열거하면 하나만 바꿔도
  // 빠져나가므로 낱말 자체를 막는다 — 현재 랜딩에는 이 낱말이 0회다.
  [/기억/u, "랜딩이 기억을 약속한다 — 기억 엔진은 오늘 켤 수 없다"],

  // 2026-08-29 파운더 결정: 베타를 하지 않는다. 옛 가드는 "계정 베타" 문장이
  // **있는지** 물었다 — 이제 반대로 **다시 생기면** 실패한다.
  [
    /베타|사전\s*등록|사전등록|승인\s*(?:을\s*)?(?:기다|대기)/u,
    "베타·사전등록·승인 대기 틀이 화면에 돌아왔다 — 2026-08-29 파운더 결정으로 없앴다",
  ],
];

/**
 * 근거 없는 업체 수.
 *
 * 옛 가드는 `\d[\d,]*\s*곳` 하나여서 "406**개**" 가 그대로 통과했다. 자리 단위
 * (곳·군데·개사)는 그 자체로 업체 수이므로 바로 잡고, 흔한 단위(개·건·사)는 업체를
 * 가리키는 낱말이 앞뒤에 붙을 때만 잡는다 — 견적 확인 카드의 "분야별 9~12개"는
 * 항목 수라 잡으면 안 된다.
 *
 * **2026-08-29: 잡은 뒤에 하는 일이 바뀌었다.** 옛 판은 랜딩이 업체 수를 아예 말하지
 * 않아서 "있으면 실패" 였는데, 새 공시 카드는 `829곳` 을 다시 쓴다. 옛 주석이
 * "지키던 것은 숫자가 아니라 수치에 근거와 시점이 붙어 있는가" 라고 적어 뒀으므로,
 * 숫자를 금지하는 대신 **곁에 출처·기준 시점이 있는지**를 잰다.
 */
const VENDOR_COUNT =
  /\d[\d,]*\s*(?:곳|군데|개사|개소)|(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)[^.\n]{0,14}\d[\d,]*\s*(?:개|건|사|팀)|\d[\d,]*\s*(?:개|건|사|팀)[^.\n]{0,14}(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)/gu;

describe("없는 이용자 수 사회적 증거 검사", () => {
  it.each([
    "이용자 1,000명이 사용해요",
    "1,000명의 이용자가 사용해요",
    "가입자 2만 명이 함께해요",
    "2만 명의 가입자가 함께해요",
    "사용자 500명이 준비하고 있어요",
    "500 명의 사용자가 준비하고 있어요",
    "예비부부 700명이 이용해요",
    "700명의 예비부부가 이용해요",
  ])("이용자 수 주장 두 어순을 모두 거부한다: %s", (claim) => {
    expect(FORBIDDEN.some(([pattern]) => pattern.test(claim)), claim).toBe(true);
  });

  it.each([
    "내년 가을쯤 결혼하고 싶어. 하객은 100명 정도야. 뭐부터 해야 해?",
    "하객 1,000명이 올 수 있는 식장을 찾고 싶어요",
    "하객 100명 기준으로 확인할 항목을 정리해 주세요",
  ])("개인이 말한 하객 수를 이용자 수 주장으로 오인하지 않는다: %s", (example) => {
    expect(FORBIDDEN.some(([pattern]) => pattern.test(example)), example).toBe(false);
  });
});

describe("landing two-sided trust contract", () => {
  it("leads with the concrete couple loop, then makes its trust evidence verifiable", () => {
    // 첫 화면이 파는 것. 옛 판의 후크("둘의 기준이 다른 걸 몰라서예요")가 정본 시안의
    // 노트 후크로 바뀌었다. 지키는 것은 같다 — 첫 문장이 도구 이름(예산·일정·체크리스트)이
    // 아니라 **처음 온 사람이 겪는 장면**을 말한다.
    // (도구 낱말 비율 자체는 `landingHeroExperience.test.ts` 가 진다.)
    // 파일 전체가 아니라 `hero` 블록에서 찾는다. 전체를 보던 동안 이 문장들을
    // `footer.tagline` 으로 옮겨도 통과했다(2026-08-27 변형).
    //
    // 첫 화면은 무엇부터 할지 모르는 순간을 말하고, 질문을 둘의 결정으로 이어 준다.
    const heroCopy = contentBlock("hero", "amoraNote");
    expect(heroCopy).toMatch(/결혼 준비, 검색할수록[\s\S]*고민만 늘어난다면\./u);
    expect(heroCopy).toMatch(/AI 동반자 아모라와[^"\n]*지금 고민을 정리해요[^"\n]*직접 확인해 기록/u);
    expect(heroCopy).toMatch(/우리 예산으로 어떤 결혼식을 할지[^"\n]*예산·일정·할 일[^"\n]*파트너를 연결해 함께/u);
    expectWired("hero.body");
    expectWired("hero.note");
    // 2026-08-29: 옛 컴포넌트는 줄바꿈·색 강조 때문에 H1 글자를 손으로 적었고, 그래서
    // 여기서 문자열로 물었다. 새 컴포넌트는 `hero.title` 을 읽어 줄마다 쪼갠다 —
    // 문자열로 물으면 카피가 멀쩡해도 영원히 실패한다. **H1 이 카피를 읽는지**로 잰다.
    // (정본과 글자가 같은지는 `landingHeadlineParity.test.ts` 가 본다.)
    expect(hero, "첫 화면 H1 이 카피 정본을 읽지 않는다").toMatch(
      /<h1[\s\S]{0,600}hero\.title/u,
    );

    // 아모라를 소개하는 자리에는 AI 고지가 붙는다(AI 기본법 — 사람인 것처럼 소개하지
    // 않는다). 자리는 셋이다 — 아모라가 처음 말하는 노트 카드, 경계 섹션의 세 번째
    // 항목, 그리고 푸터 고지 끝줄. 한계("틀리거나 놓칠 수 있다")도 같이 적는다.
    const amoraNoteCopy = contentBlock("amoraNote", "noSide");
    const boundariesCopy = contentBlock("boundaries", "closing");
    const footerCopy = contentBlock("footer", "headerNav");
    expect(amoraNoteCopy).toContain("아모라 · AI 생성");
    expect(boundariesCopy).toContain("아모라의 답변은 AI가 작성해요");
    expect(boundariesCopy).toContain("AI 답변에는 오류가 있을 수 있어요");
    expect(boundariesCopy).toContain("계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를");
    // 카피에 있는 것만으로는 부족하다 — 그리는 `<p>` 를 지워도 통과하던 자리다.
    expectWired("amoraNote.note");
    expectWired("amoraNote.chat.amoraLabel");
    expectWired("footer.notice");
    // 경계 항목은 배열이라 키 하나를 짚을 수 없다. 목록 자체를 그리는지로 본다 —
    // `[].map` 으로 바꿔 카드를 통째로 없애던 우회가 실제로 있었다.
    for (const wiring of ["boundaries.items.map", "{item.title}", "{item.note}"]) {
      expect(boundariesSection, `경계 섹션이 ${wiring} 을 안 쓴다`).toContain(wiring);
    }

    // 결정은 두 사람이 하고 아모라는 정리만 한다 — 옛 `noSide` 의 "한쪽 손을 들지
    // 않아요."가 경계 섹션 제목으로 합쳐졌다.
    const confirmCopy = contentBlock("confirm", "availableNow");
    // 2026-09-03 시안이 같은 뜻을 두 줄로 풀어 썼다("결정은 둘이. 아모라는 정리." →
    // "결정은 둘이 합니다. / 아모라는 그 앞까지만 도와요.").
    expect(boundariesCopy).toContain("아모라는 준비를 돕고,");
    expect(boundariesCopy).toContain("결정은 두 사람이 해요.");
    expectWired("boundaries.title");
    expect(confirmCopy).toContain("저장 전에 바뀔 내용과 저장 위치를 직접 확인하면 예산·할 일·일정에 남길 수 있어요");
    expect(confirmCopy).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");
    // 옛 카피의 "확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요." 는
    // 확인 카드 안의 한 줄로 옮겨졌다. 컴포넌트가 손으로 적으므로 거기서 찾는다.
    expect(confirmSection, "확인 전에는 화면이 그대로라는 문장이 사라졌다")
      .toContain("{confirm.sample.contract}");
    expectWired("confirm.lede");
    expectWired("confirm.body2");
    expectWired("confirm.note");

    // 업체 편이 아니라는 증거. 옛 `notForVendors` 의 "업체에서 돈을 받지 않아요."·
    // "소개비를 받고 순서를 바꾸는 일도 없어요." 가 경계 항목 둘로 옮겨졌다.
    expect(boundariesCopy).toContain("업체에 점수·등급·순위를 매기지 않아요");
    expect(boundariesCopy).toContain("광고 상품은 운영하지 않아요.");
    expect(boundariesCopy).toContain("계약 조건을 대신 해석하거나 판단하지 않아요");
    expect(boundariesCopy).toContain("업체 계약 신청·예약·결제를 중개하지 않아요.");

    // 샘플에는 샘플이라고 적는다 — 옛 "기능 예시 · 이 화면에서는 실제로 저장되지
    // 않아요". 지금은 아모라 노트 카드가 **카드 안에서** 그 일을 하고(캡처돼도 떨어져
    // 나가지 않게), 확인 카드는 `confirm.sampleNote` 가 진다.
    //
    // ⚠️ `confirm.sampleNote` 는 오늘 **어느 컴포넌트도 그리지 않는다**(a95185b2e 에서
    // 카피만 들어왔다). 그래서 여기서는 옛 판과 같은 세기(카피에 있는가)로만 묻고,
    // 배선은 `landingDisclosuresAreOnScreen.test.ts` 가 지는 계약이다 — 그 목록에
    // 이 키를 넣어야 한다. 여기서 배선까지 물으면 이 파일이 남의 계약을 대신 지는 게
    // 되고, 옛 판이 지던 것보다 넓어진다.
    expect(amoraNoteCopy).toContain("기능을 설명하는 예시 대화예요");
    expect(amoraNoteCopy).toContain("이 화면에서는 대화하거나 저장할 수 없어요.");
    expect(confirmCopy).toContain(
      "금액은 예시이며",
    );
    expect(confirmCopy).toContain("이 화면에서는 저장할 수 없어요.");

    // 개인정보 — 로그인 없이 선택한 내용은 남기지 않는다(옛 `privateLane.note`).
    const availableNowCopy = contentBlock("availableNow", "community");
    expect(availableNowCopy).toContain("가입 없이 선택한 내용은 저장하지 않아요");

    // 궁합·점수 금지(CLAUDE.md: WeddingCode 는 검증된 궁합 검사가 아니다).
    // 옛 `scenes.note` 가 스무 장면 카드의 작은 글씨로 내려왔다.
    expect(availableNowCopy).toContain("심리 진단이나 궁합 검사가 아니에요");

    // 가격 근거는 푸터 고지 한 줄에 모였다. 하나라도 빠지면 출처 없는 수치가 된다.
    // 이 여섯 줄은 **푸터 고지 블록에서** 찾는다. 파일 전체를 보던 동안, 이 문장들을
    // 주석 처리하기만 해도 열두 단언이 전부 통과했다(2026-08-27 변형).
    expect(footerCopy).toContain("한국소비자원 참가격");
    expect(footerCopy).toContain("2025년 11월 공시 기준");
    expect(footerCopy).toContain("업체가 공개한 취소·환불 규정은 원문으로 제공해요.");
    expect(footerCopy).toContain("공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요.");
    expect(footerCopy).toContain("예약·결제·계약은 업체와 직접 진행해 주세요.");

    expect(availableNowCopy).toContain("가격의 적정 여부는 평가하지 않아요");

    // 문의 창구는 푸터에 남는다 — 옛 "서비스·업체 정보 문의" 자리.
    // 주소를 여기 적지 않는다. 옛 주소는 메일을 받지 않았는데 여덟 군데가 박아 둔 탓에
    // 약관·개인정보·AI 고지가 모두 죽은 주소를 안내한 적이 있고,
    // `contactAddressIsSingleSourced.test.ts` 가 **테스트 파일까지 훑어** 그걸 막는다.
    // 지켜야 하는 것은 "문의 링크가 상수에서 온다" 이지 특정 주소가 아니다.
    const policyColumn = between(footerCopy, 'heading: "정책·문의"', "notice:", "footer 정책·문의 열");
    expect(policyColumn).toContain("mailto:${CONTACT.email}");
    expect(policyColumn).toContain("CONTACT.email");
    expect(policyColumn).toContain('href: "/ai-policy"');

    // 커뮤니티는 읽는 것만 로그인 없이 열린다 — 글쓰기는 계정이 필요하다고 먼저 말한다.
    // (옛 `notDoing` 의 "AI가 단 답변은 사람 답변과 구분해서 보여줘요" 는 커뮤니티
    //  **안쪽** 화면의 계약이라 랜딩 카피에서 빠졌다. 랜딩은 이제 커뮤니티를 소개만 한다.)
    expect(landing, "커뮤니티 섹션이 랜딩에 다시 노출됐다")
      .not.toContain("<CommunitySection");
    expect(contentBlock("community", "photoBand"), "커뮤니티가 공개 랜딩의 현재 축으로 설정됐다")
      .toContain("visible: false");
    expect(renderedSections(), "커뮤니티가 실제 랜딩 섹션으로 렌더된다")
      .not.toContain("CommunitySection");

    // 반영 전에 무엇이 반영될지 먼저 보여준다 — 옛 "준비 기록에 반영할 변경을 먼저
    // 보여줘요"가 확인 카드의 라벨로 바뀌었다.
    // 2026-09-03: 카드가 "제안 한 건" 에서 "이해한 것 세 줄" 로 바뀌면서 라벨도 바뀌었다.
    // 지키는 것은 같다 — 눌리기 전에는 아무 일도 안 일어났다고 카드가 스스로 말한다.
    expect(confirmCopy).toContain("저장 전");
    expectWired("confirm.sample.state");
    expectWired("confirm.sample.contract");
    expect(content).not.toContain("무엇을 저장하고 공유할지 먼저 보여줘요");
  });

  it("never states a vendor count without its source and as-of date", () => {
    // 옛 계약은 랜딩이 업체 수와 그 실측 시점을 **상수로** 들 것을 요구했고
    // (`const PUBLISHED_VENDOR_COUNT = 406` · `PUBLISHED_COUNTS_VERIFIED_AT = "2026.08.08"`),
    // 그다음 판에서 숫자가 통째로 사라져 "업체 수가 있으면 실패" 가 됐다.
    //
    // ⚠️ 2026-08-29에 이 단언을 "수치 곁 ±160자에 근거가 있으면 통과" 로 **느슨하게
    // 바꿨다.** 이유로 "새 랜딩은 공시 카드에서 829곳을 다시 말한다" 고 적었는데,
    // **그 판단은 같은 날 되돌렸다** — 랜딩은 406·829·831 중 어느 것도 쓰지 않는다
    // (`countLabelsSayWhatTheyCount.test.ts`). 없는 전제로 가드만 약해진 것이다.
    //
    // 실제로 뚫린다: `availableNow.cards[2].note` 는 이미 "한국소비자원 참가격 ·
    // 2025년 11월 공시 기준" 을 들고 있어서, 거기에 "표시된 업체 1,200곳" 을 붙이면
    // 근거가 ±160자 안에 있으니 통과한다. 1,200 은 저쪽 목록(406·829·831)에도 없다.
    //
    // 그래서 평면 금지로 되돌린다. 수를 다시 쓰기로 하면 그 문자열을 명시적으로
    // 허용하고, 라벨 규칙(`countLabelsSayWhatTheyCount.test.ts`)에도 함께 등재하라.
    expect(
      renderedCopy,
      "근거 없는 업체 수가 랜딩에 돌아왔다 — 지금 랜딩은 업체 수를 말하지 않는다",
    ).not.toMatch(VENDOR_COUNT);
    // 오늘 랜딩이 실제로 드는 수치와 그 근거. 위 대조는 "수치가 있으면 근거도 있다" 라서
    // 수치를 통째로 지우면 조용히 통과한다 — 공시 카드가 기준 시점을 들고 있는지 못 박는다.
    expect(contentBlock("availableNow", "community")).toContain("2025년 11월 공시 기준");
  });

  it("keeps the editorial journey and navigation anchors in sync", () => {
    expect(landing.match(/id="main-content"/g)).toHaveLength(1);
    // 헤더·푸터를 통째로 꺼도 아래 대조는 본문만 보므로 눈치채지 못한다.
    // (주석을 벗긴 뒤라 `{/* <LandingFooter /> */}` 로 꺼도 여기서 잡힌다.)
    expect(landing, "헤더가 렌더되지 않는다").toContain("<LandingHeader />");
    expect(landing, "푸터가 렌더되지 않는다").toContain("<LandingFooter />");

    // 내비 정본은 `landingContent.headerNav`이고 데스크톱 헤더와 모바일 메뉴가 둘 다
    // 그것을 받는다. 한쪽이 자기 목록을 발명하면 두 메뉴가 갈린다.
    expect(header).toContain("headerNav.map");
    expect(header).toContain("<MobileLandingMenu items={headerNav} />");

    // 항목이 본문에 없는 앵커를 가리키면 눌러도 아무 일이 안 일어난다 — 실제로 있었다.
    // 목록을 손으로 적으면 새 섹션이 들어올 때 검사만 뒤처지므로, 렌더되는 소스에서
    // 앵커와 id를 각각 긁어 대조한다.
    const anchors = new Set(
      [...renderedCopy.matchAll(/href(?:=|:\s*)"#([a-zA-Z-]+)"/gu)].map((match) => match[1]),
    );
    const ids = new Set(
      [...renderedCopy.matchAll(/id="([a-zA-Z-]+)"/gu)].map((match) => match[1]),
    );
    // 정규식이 낡아 빈 목록을 보면 아래 대조가 조용히 통과한다. 개수 자체를 못
    // 박지는 않는다 — 내비 항목 수는 바뀔 수 있고, 여기서 지키는 건 "긁어 오긴 했다"다.
    expect(anchors.size, "앵커를 거의 못 찾았다 — 정규식이 낡았다").toBeGreaterThanOrEqual(4);
    const dead = [...anchors].filter((anchor) => !ids.has(anchor));
    expect(
      dead,
      "가리키는 자리가 본문에 없는 앵커 — 눌러도 아무 일이 안 일어난다. "
        + "섹션이 삭제되면 내비 항목도 같이 빼거나, 그 일을 이어받은 섹션에 id 를 줘야 한다.",
    ).toEqual([]);

    // 내비 순서는 본문 섹션 순서와 같아야 한다. 앵커를 가진 파일을 찾아 그 컴포넌트가
    // 랜딩에서 몇 번째로 **렌더되는지**로 잰다 — 순서를 손으로 적지 않는다.
    // 예전에는 `landing.indexOf("<Owner")` 로 쟀는데, 그러면 섹션을 JSX 주석으로 꺼도
    // 문자열이 남아 순서가 맞는 것으로 읽혔다. `renderedSections()` 는 주석을 벗긴
    // `<main>` 안에서 실제로 그려지는 것만 돌려준다.
    const navAnchors = [
      ...contentBlock("headerNav", "headerAuth").matchAll(/href: "#([a-zA-Z-]+)"/gu),
    ].map((match) => match[1]);
    expect(navAnchors.length, "헤더 내비 앵커를 못 찾았다 — 정규식이 낡았다")
      .toBeGreaterThanOrEqual(3);

    const sections = renderedSections();
    expect(sections.length, "본문이 섹션을 거의 안 그린다").toBeGreaterThanOrEqual(6);

    // 주인 없는 앵커는 위 `dead` 대조가 이미 이름을 대고 실패한다. 여기서 또 던지면
    // 같은 사고에 실패 두 개가 붙어 "순서가 틀렸다"는 거짓 신호가 섞인다 — 순서 계약은
    // **주인이 있는 앵커끼리** 잰다.
    let previous = -1;
    for (const anchor of navAnchors) {
      const owner = components.find(([, src]) => src.includes(`id="${anchor}"`));
      if (!owner) continue;
      const component = owner[0].replace(/\.tsx$/u, "");
      const index = sections.indexOf(component);
      expect(index, `${component} 가 랜딩에서 렌더되지 않는다`).toBeGreaterThanOrEqual(0);
      expect(index, `내비와 본문 순서가 어긋난다: #${anchor}`).toBeGreaterThan(previous);
      previous = index;
    }

    // 없어진 단언: 옛 신뢰 섹션이 마무리로 보내던 `href="#start-conditions"`와
    // `ClosingAction`의 `id="start-conditions"`. 새 마무리는 앵커 목적지가 아니라
    // 페이지 끝의 행동 자리라 id가 없고, 내비에도 그 항목이 없다. 위 대조가
    // "가리키는 앵커는 반드시 존재한다"를 그대로 지킨다.
  });

  it("keeps each call to action aligned with its destination", () => {
    // 첫 화면 CTA. 목적지 문자열을 두 번 박지 않는다 — 카피에서 읽어 마무리와 **맞대본다.**
    // 옛 판은 히어로와 헤더에 같은 라벨을 두 번 박아 뒀고, 라벨이 바뀌자 그대로 깨졌다.
    const heroCopy = contentBlock("hero", "amoraNote");
    const closingCopy = contentBlock("closing", "footer");
    const heroPrimary = heroCopy.match(/primary: \{ label: "([^"]*)", href: "([^"]*)" \}/u);
    expect(heroPrimary, "첫 화면 주 CTA를 못 찾았다 — 표기가 바뀌었다").not.toBeNull();
    expect(hero).toContain("href={hero.primary.href}");
    expect(hero).toContain("{hero.primary.label}");

    // 두 번째 버튼도 실재하는 목적지여야 한다. 옛 판은 페이지 안 앵커(`#now`)였고
    // 지금은 라우트다 — 앵커든 라우트든 **아무 데도 가지 않는 것**만 막는다.
    const heroSecondary = heroCopy.match(/secondary: \{ label: "([^"]*)", href: "([^"]*)" \}/u);
    expect(heroSecondary, "첫 화면 보조 CTA를 못 찾았다").not.toBeNull();
    for (const cta of [heroPrimary!, heroSecondary!]) {
      expect(cta[1], "첫 화면 CTA에 글자가 없다").not.toBe("");
      expect(cta[2], "첫 화면 CTA가 아무 데도 가지 않는다").toMatch(/^(?:\/[a-z0-9-]|#[a-z-])/u);
    }
    expect(hero).toContain("href={hero.secondary.href}");
    expect(hero).toContain("{hero.secondary.label}");

    // 첫 화면과 마무리는 **같은 행동**을 부른다. 다르면 페이지 전체가 무엇을 시키려는
    // 건지 흐려진다. 라벨을 다시 박지 말고 두 카피를 맞대본다.
    const closingPrimary = closingCopy.match(/primary: \{ label: "([^"]*)", href: "([^"]*)" \}/u);
    expect(closingPrimary, "마무리 주 CTA를 못 찾았다").not.toBeNull();
    expect(closingPrimary![2], "첫 화면과 마무리가 다른 곳으로 보낸다")
      .toBe(heroPrimary![2]);
    expect(closingPrimary![1], "첫 화면과 마무리가 같은 목적지를 다른 말로 부른다")
      .toBe(heroPrimary![1]);

    // 헤더 CTA. 2026-08-28 이전 헤더는 "스무 장면 답해보기" 를 **하드코딩**하고 있었다 —
    // 카피 정본을 읽지도 않아서 카피를 고쳐도 헤더만 옛말을 했다. 라벨을 다시 박는 대신
    // **헤더가 자기 문구를 발명하지 않는지**를 잰다. 2026-10-10에 계정 링크를
    // LandingAccountActions로 옮겼으므로 양쪽 렌더 연결과 그 컴포넌트의 정본 사용을 본다.
    expect(header).toContain('<LandingAccountActions variant="desktop" />');
    expect(mobileMenu).toContain('<LandingAccountActions variant="mobile" onNavigate={closeMenu} />');
    expect(accountActions).toContain('from "./landingContent"');
    for (const key of ["signUp", "logIn"]) {
      expect(accountActions, `계정 행동이 headerAuth.${key} 를 안 쓴다`)
        .toContain(`href={headerAuth.${key}.href}`);
    }
    expect(accountActions, "비로그인 시작 버튼이 정본 라벨을 쓰지 않는다")
      .toMatch(/status === "signed_out" \? headerAuth\.signUp\.label :/u);
    expect(accountActions, "상태별 시작 버튼의 글자가 사라졌다").toContain("{primaryLabel}");
    expect(accountActions, "로그인 버튼의 정본 글자가 사라졌다").toContain("{headerAuth.logIn.label}");
    expect(
      header.match(/href="(?!\/landing")[^"]*"/gu) ?? [],
      "헤더가 카피 정본을 안 읽고 목적지를 손으로 적었다",
    ).toEqual([]);
    expect(
      accountActions.match(/href="[^"]*"/gu) ?? [],
      "계정 행동이 카피 정본을 안 읽고 목적지를 손으로 적었다",
    ).toEqual([]);
    const authHrefs = hrefsIn(contentBlock("headerAuth"));
    expect(authHrefs.length, "헤더 행동 목적지를 못 찾았다").toBeGreaterThanOrEqual(2);
    for (const href of authHrefs) {
      expect(href, "헤더 행동이 아무 데도 가지 않는다").toMatch(/^\/[a-z0-9-]/u);
    }

    // 로그인 진입점은 공통 계정 행동에 있다. 비로그인 상태의 링크가 정본 목적지와
    // '로그인' 라벨을 실제 Link 자식으로 렌더하는지 확인한다.
    expect(contentBlock("headerAuth")).toContain('href: "/login?redirect=%2Fwedding%2Fchat"');
    const logIn = /logIn:\s*\{([^}]*)\}/u.exec(contentBlock("headerAuth"));
    expect(logIn, "headerAuth.logIn 이 사라졌다").not.toBeNull();
    expect(logIn?.[1] ?? "", "로그인 정본 라벨이 바뀌었다").toContain('label: "로그인"');
    expect(accountActions).toContain('const login = status === "signed_out" ? (');
    expect(
      accountActions,
      "/login 링크의 보이는 글자가 '로그인'이 아니다",
    ).toMatch(/href=\{headerAuth\.logIn\.href\}[\s\S]{0,600}>\s*\{headerAuth\.logIn\.label\}\s*<\/Link>/u);

    // 마무리 CTA — 계정이 있는 사람만 로그인으로 보낸다.
    //
    // 2026-08-28 재조준: 마무리 버튼이 둘에서 셋이 됐다(가입이 열려 있는데 마무리가
    // 로그인만 내밀면 계정 없는 사람에게 길이 없었다). 옛 단언은 정확 문자열
    // `secondary: { label: "계정이 있다면 로그인", … }` 하나였고 카피가 바뀌자
    // 그대로 깨졌다. 라벨을 다시 박지 않고 **키마다 배선을 확인한다** — 셋 중 하나를
    // 지워도 잡히고, 라벨만 바꿔도 안 깨진다.
    const closingKeys = [...closingCopy.matchAll(/^\s{4}(primary|secondary|tertiary):/gmu)].map(
      (match) => match[1],
    );
    expect(closingKeys, "마무리가 하나의 아모라 시작 행동을 제공하지 않는다")
      .toEqual(["primary"]);
    for (const key of closingKeys) {
      expect(closing, `마무리에서 closing.${key} 버튼이 사라졌다`)
        .toContain(`href={closing.${key}.href}`);
      expect(closing, `마무리 closing.${key} 버튼의 글자가 사라졌다`)
        .toContain(`{closing.${key}.label}`);
    }

    // 로그인으로 보내는 마무리 링크는 **계정이 있는 사람에게만** 말을 건다.
    // 조건 없이 "로그인하고 시작하기"가 되면 가입이 열려 있는데도 계정 없는 사람이
    // 막힌 것으로 읽는다.
    expect(closingCopy).toContain('primary: { label: "아모라와 준비 시작하기", href: "/wedding/chat" }');
    expect(closingCopy).toContain("아모라와 예산·할 일·일정 관리에는 가입이 필요해요");

    // 없어진 단언: `const amoraStartHref = "/start-here"`와 CTA 라벨 "아모라와
    // 시작하기". 로그인 없이 아모라를 시작할 수 없게 된 뒤(#245) 랜딩에서 아모라로
    // 곧장 보내는 버튼 자체가 사라졌다. 라벨이 목적지와 맞는지는 위 CTA들이 진다.
  });

  it("keeps the disclosure source, paid-ranking promise, and limits visible", () => {
    const availableNowCopy = contentBlock("availableNow", "community");
    const boundariesCopy = contentBlock("boundaries", "closing");
    const footerCopy = contentBlock("footer", "headerNav");

    // 출처. 옛 "자료 출처 · 한국소비자원 참가격"이 푸터 고지 한 줄과 공시 카드로 갈렸고,
    // 우리가 옮겨 적었을 뿐이라는 것까지 말한다.
    expect(footerCopy).toContain("가격 출처: 한국소비자원 참가격");
    expect(availableNowCopy).toContain("한국소비자원 참가격에 공시된 기본 가격과 취소 위약금 원문");

    // 공시 카드가 실제로 렌더되고 원문으로 간다. 카피만 있고 길이 없으면 열람 약속이
    // 거짓이 된다. 옛 판은 `NotForVendorsSection` 의 곁블록이 그 일을 했다.
    expect(availableNowCopy).toContain('href: "/price"');
    for (const wiring of [
      "availableNow.cards.map",
      "{card.title}",
      "{card.body}",
      "{card.note}",
      "href={card.href}",
    ]) {
      expect(availableNowSection, `"지금 되는 것" 카드가 ${wiring} 을 안 쓴다`)
        .toContain(wiring);
    }
    // AI 정책 링크도 카피가 아니라 화면에 있어야 한다. 옛 자리는 `notForVendors`였고
    // 지금은 경계 섹션이 진다.
    expect(boundariesSection).toContain("href={boundaries.policyLink.href}");
    expect(boundariesSection).toContain("{boundaries.policyLink.label}");
    expect(boundariesCopy).toContain('href: "/ai-policy"');

    // 광고는 광고와 섞지 않는다. 옛 "소개비를 받고 순서를 바꾸는 일도 없어요."·
    // "광고·협찬 글에는 출처 표시가 붙고" 가, 광고 상품이 아예 없다는 더 강한 문장으로
    // 합쳐졌다. 광고 상품을 시작하면 **표시 약속을 다시 적어야 한다.**
    expect(boundariesCopy).toContain("광고 상품은 운영하지 않아요.");
    expect(boundariesCopy).toContain("공시 가격과 규정은 요약하지 않고 원문으로 제공해요.");

    // 한계. 공시가는 기본 조건 기준이고, 공시한 업체만 실려 지역 편차가 크다.
    // 지역 편차 문장을 빼면 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다.
    expect(footerCopy).toContain("공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요");
    expect(footerCopy).toContain("가격을 공시한 업체만 제공하므로");
    expect(footerCopy).toContain("지역별 등록 업체 수가 달라요");
    expect(availableNowCopy).toContain("가격과 규정은 요약하지 않고 원문으로 제공하며, 가격의 적정 여부는 평가하지 않아요");

    // 출처는 한국소비자원 하나뿐이다 — 제휴사 가격표는 없다(업체 제휴 0건).
    expect(content).not.toContain("제휴사별 최저 기본가");

    // 원문 링크가 가리키는 공시 게시판. 이 상수가 주석 안에 있으면 죽은 코드다.
    const period = rendered("src/lib/price/period.ts");
    expect(period).toContain("boardTypeCode=0090000122");
  });

  it("does not invent social proof, savings, or pricing claims", () => {
    // 정확 문자열 열거는 표기 하나만 바꿔도 빠져나간다 — 실제로 푸터 태그라인을
    // "이미 1만 쌍이 함께 준비하고 있어요"로 바꾼 변형이 이 일곱 줄을 그냥 지나갔다.
    // 열거는 남겨 두고(읽는 사람에게 무엇이 금지인지 보여준다) 패턴을 위에 얹는다.
    for (const unsupportedClaim of [
      "누적 이용자",
      "만 명이 선택",
      "시간 절약",
      "비용 절감",
      "최저가 보장",
      "모든 기능 무료",
      "실제 이용 후기",
    ]) {
      expect(renderedCopy).not.toContain(unsupportedClaim);
    }
  });

  it("never says the opposite of what it promises", () => {
    // 있어야 할 문장만 세면 **덧붙임**을 절대 못 잡는다. 계약 문장을 그대로 두고
    // 뒤에 "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요"를 붙인 변형이
    // 이 파일의 모든 단언을 통과했다(2026-08-27).
    for (const [pattern, why] of FORBIDDEN) {
      const hit = renderedCopy.match(pattern);
      expect(hit?.[0], `${why} — 걸린 문장: ${hit?.[0] ?? ""}`).toBeUndefined();
    }
  });

  it("never promises Amora without a login", () => {
    // 주석은 벗기고 본다. 왜 이 약속을 하지 않는지 설명하려면 그 문구를 적어야
    // 하는데, 자기 설명에 걸려 넘어지는 가드는 가드가 아니다(이 저장소에서 세 번째다).
    // 가드가 6개 파일만 읽어서, 잔재가 실제로 남아 있던 ContinuitySection·
    // SharedPrivateSection을 놓쳤다. 랜딩이 렌더하는 컴포넌트 전부를 읽는다
    // (`renderedCopy`가 폴더를 읽어서 만든다).
    //
    // 한도 정책이 확정되기 전까지 "가입 없이 아모라를 쓸 수 있다"고 말하지 않는다.
    // 한도에 걸린 사용자가 예상 못 한 벽을 만나는 것이 이 페이지가 만들 수 있는
    // 가장 나쁜 첫인상이고, 비로그인 아모라 체험은 #245로 닫혔다.
    // (2026-08-27에 `lib/demoTrial.ts` 로 한 번 더 닫혔다 — 5주간 89턴뿐이었고
    //  익명 방문자가 실사용자와 같은 지갑을 태웠다. 정본 시안의 첫 버튼
    //  "가입 없이 물어보기" 가 카피에서 빠진 이유가 이것이다.)
    //
    // 정확 문자열 열거는 변형을 놓친다 — 실제로 "로그인 없이 여는 체험 대화"와
    // "로그인 없는 체험"이 그렇게 빠져나갔다. 패턴으로 막는다.
    //
    // 2026-08-28: 그 패턴도 좁았다. 부정어를 `(없|안)` 으로만 받아서
    // **"가입하지 않아도 아모라와…"** 가 그대로 통과했다 — #245 를 지키는 가드가
    // 이 파일에 하나뿐인데 그 하나가 어형 하나에 뚫렸다. 부정 어형을 넓히고,
    // 낱말 순서가 뒤집힌 표기("아모라를 계정 없이")도 같이 받는다.
    const negation = "(?:없|않|안(?!내)|말고|불필요)";
    const gate = "(?:로그인|가입|계정|회원)";
    const amora = "(?:아모라|체험|상담|대화)";
    const noLoginAmora = new RegExp(
      `${gate}[^.\\n]{0,14}${negation}[^.\\n]{0,24}${amora}`
        + `|${amora}(?![^.\\n]{0,24}가입 후, 웨딩코드는 가입 없이)[^.\\n]{0,24}${gate}[^.\\n]{0,14}${negation}`,
      "u",
    );
    const hit = renderedCopy.match(noLoginAmora);
    expect(hit?.[0], `랜딩이 로그인 없는 아모라·체험을 약속한다: ${hit?.[0] ?? ""}`)
      .toBeUndefined();
    // 숫자를 추측해 적지 않는다 — 한도 값이 아직 정해지지 않았다.
    // 단위 하나만 막으면 "무료 5턴"·"5회 무료"가 빠져나간다.
    expect(renderedCopy).not.toMatch(/무료\s*\d[\d,]*\s*(?:회|번|건|턴|개|일|개월|명|질문|메시지)/u);
    expect(renderedCopy).not.toMatch(/\d[\d,]*\s*(?:회|번|건|턴|개월)\s*(?:까지\s*)?무료/u);
  });

  it("states the current first-step conditions without claiming the whole service is free", () => {
    // 옛 카피는 "첫 준비 순서 / 아모라와 대화할 때 / 계정으로 계속 관리" 세 단계로
    // 시작 조건을 적었고, 그다음 판은 "가입 안 해도 되는 것들" 목록이 그 자리를 졌다.
    // 지키는 것은 세 판에서 같다 — **누르기 전에 조건을 안다.**
    const availableNowCopy = contentBlock("availableNow", "community");
    const closingCopy = contentBlock("closing", "footer");
    const confirmCopy = contentBlock("confirm", "availableNow");
    const footerCopy = contentBlock("footer", "headerNav");

    // 계정 없이 열리는 도구와 첫 행동을 함께 말한다.
    expect(availableNowCopy).toContain("가입 없이 먼저 써 보세요");
    expect(availableNowCopy).toContain('href: "/wedding/community/quote-check"');
    expect(availableNowCopy).toContain('href: "/wedding-code"');
    expectWired("availableNow.eyebrow");
    expectWired("availableNow.title");
    // 첫 화면에서도 조건을 먼저 말한다 — 여기까지 안 내려온 사람이 훨씬 많다.
    const heroCopy = contentBlock("hero", "amoraNote");
    expect(heroCopy).toContain("아모라는 로그인과 시작 설정 후 이용해요");
    expect(heroCopy).toContain("현재 무료이며, 향후 요금은 아직 정해지지 않았어요");
    expect(heroCopy).toContain("웨딩코드는 가입 없이 해 볼 수 있어요");
    expect(closingCopy).toContain("무료 도구는 가입 없이 이용할 수 있어요");

    // 계정을 만들면 무엇이 열리는지. 옛 판은 ⑦ 섹션이 한 줄로 적었고, 지금은 확인
    // 섹션의 눈썹("계정을 만들면")과 본문이 그 일을 한다.
    // 2026-09-03: 눈썹이 "계정을 만들면" → "대화로 끝나지 않게" 로 바뀌었다. 계정 이야기를
    // 꺼내는 자리는 그대로 이 섹션이고, 그 말은 고지 문장이 진다.
    expect(confirmCopy).toContain("현재 무료로 이용할 수 있어요");
    for (const destination of ['title: "예산"', 'title: "할 일"', 'title: "일정"']) {
      expect(confirmCopy).toContain(destination);
    }
    expect(closingCopy).toContain("아모라와 예산·할 일·일정 관리에는 가입이 필요해요.");
    expectWired("closing.note");

    // 2026-08-06 파운더 결정: 로그인 없는 아모라 이용에 한도를 걸 예정이라 랜딩은
    // 아모라를 로그인 필요로 안내한다. 그 안내 문장은 2026-08-27 판에서 사라졌고,
    // 대신 **구조가 같은 약속을 진다** — 로그인 없이 되는 목록에 아모라가 없다.
    //
    // 옛 코드는 `content.slice(indexOf(a), indexOf(b))` 뒤 `length > 0` 으로 지켰는데,
    // `indexOf` 가 -1 이면 `slice(-1)` 이 마지막 한 글자를 주므로 **경계가 사라져도
    // 영원히 참**이었다. 못 찾으면 던지는 `contentBlock`/`between` 으로 바꾼다.
    const openHrefs = hrefsIn(availableNowCopy);
    expect(openHrefs.length, "로그인 없이 되는 목록이 비었다").toBe(4);
    for (const href of openHrefs) {
      expect(href, "로그인 없이 되는 목록이 아모라로 보낸다").not.toMatch(/amora|chat/iu);
      expect(href, "로그인 없이 되는 목록이 로그인 벽으로 보낸다").not.toMatch(/^\/login/u);
      expect(href, "로그인 없이 되는 목록에 빈 링크가 있다").toMatch(/^\/[a-z0-9-]/u);
    }

    // 푸터의 "로그인 없이" 묶음은 그 목록과 같은 곳으로 간다. 링크를 전부 `#` 로
    // 바꿔도 통과하던 자리다 — 목적지를 실제로 대조한다.
    // 경계는 **실제로 다음에 오는 것**이어야 한다. 옛 판에서 경계를 잘못 적어 이
    // 슬라이스가 헤더 내비까지 삼켰고, 헤더 앵커(`#scenes`)를 푸터 링크로 세어 거짓
    // 실패를 냈다.
    const footerOpen = between(
      footerCopy,
      'heading: "가입 없이 이용"',
      'heading: "가입 후 이용"',
      "footer.columns 로그인 없이",
    );
    const footerOpenHrefs = hrefsIn(footerOpen);
    for (const href of openHrefs) {
      expect(footerOpenHrefs, `푸터의 "로그인 없이" 묶음에 ${href} 가 없다`).toContain(href);
    }
    for (const href of hrefsIn(footerCopy)) {
      expect(href, "푸터 링크가 아무 데도 가지 않는다").toMatch(/^(?:\/[a-z0-9-]|mailto:)/u);
    }
    // 계정이 필요한 것은 계정 만드는 곳으로 보낸다 — 그 열이 통째로 사라지면
    // 랜딩이 계정으로 가는 길을 푸터에서 잃는다.
    const footerAccount = between(
      footerCopy,
      'heading: "가입 후 이용"',
      'heading: "정책·문의"',
      "footer.columns 계정이 필요한 것",
    );
    expect(hrefsIn(footerAccount)).toEqual([
      "/wedding/chat", "/wedding/chat/board", "/wedding/budget", "/wedding/checklist", "/wedding/schedule",
    ]);
    // 그 링크들을 푸터가 실제로 그린다. 옛 판은 `footerLinks.open`·`.beta`·`.policy`
    // 세 키를 확인했는데, 지금은 열 자체가 카피 배열이라 **목록을 그리는지**로 본다.
    // (`.beta` 는 2026-08-29 파운더 결정으로 없앴다 — 아래 "베타" 가드가 되살아나는 것을 막는다.)
    for (const wiring of ["footer.columns.map", "{group.label}", "href={item.href}", "{item.label}"]) {
      expect(footer, `푸터가 ${wiring} 을 안 쓴다`).toContain(wiring);
    }

    // 비용은 미정이라고 적는다. **베타를 안 하기로 한 뒤에도 이 고지는 참이라 남는다**
    // (CLAUDE.md 2026-08-29: "없어지는 것은 틀이지 고지가 아니다").
    expect(confirmCopy).toContain("향후 요금은 아직 정해지지 않았어요");

    // 가입해도 결제되지 않는다는 약속. 두 자리에 다 있어야 한다 — 확인 섹션에서
    // 계정을 말하는 자리와, 마지막으로 누르기 직전의 마무리.
    expect(confirmCopy).toContain("현재 무료로 이용할 수 있어요.");
    expect(closingCopy).toContain("가입이 필요해요.");

    // "무료 한도"는 커플별 한도를 가리키는 말인데 그 스위치는 프로덕션에서 강제로
    // 꺼져 있다(check-amora-production-env.mjs:64 coupleQuotaDisabled).
    expect(content, "커플별 무료 한도는 프로덕션에서 꺼져 있다")
      .not.toContain("아모라 상담에는 무료 한도가 있어요");

    // "신청"은 /beta 승인 대기열을 가리키던 말이다. 그 대기열은 2026-08-23에
    // 사전등록으로 정정됐고, 사전등록 폼조차 없어졌으며, 2026-08-29에는 베타라는 틀
    // 자체가 없어졌다. 랜딩에는 "신청"이라는 행동이 아예 없으므로, 이 문장은 존재하지
    // 않는 행동으로 안심시킨다.
    // 2026-08-28: 이 단언이 **원문**을 보느라 자기 설명 주석에 걸려 실패하고 있었다
    // (`landingContent.ts` 주석이 이 문구를 인용한다). 주석을 벗기고 본다.
    expect(content, "없어진 '신청'으로 결제 안 된다고 말한다")
      .not.toContain("신청만으로 결제되지 않아요");

    expect(content).not.toContain("웨딩한방은 무료");
    expect(content).not.toContain("평생 무료");
  });
});
