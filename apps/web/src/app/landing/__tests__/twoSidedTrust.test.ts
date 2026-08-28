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
 *   TrustEvidenceSection   → NotForVendorsSection(#trust) 곁블록 + 푸터 고지 한 줄
 *   CommunityBridgeSection → availableNow 여섯째 카드(/wedding)
 *   ClosingAction #start-conditions → 내비에서 그 앵커가 없어졌다(아래 주석)
 *
 * 공시 가격은 한국소비자원 참가격이라 **공개 자료**다. 첫 화면에서 ⑥번 섹션의
 * 곁블록으로 내려간 것이 이번 판의 결정이고, 이 파일은 그 결정 뒤에도 출처·기준
 * 시점·한계가 페이지에서 사라지지 않았는지를 본다.
 *
 * ## 2026-08-28 구멍 메우기 — 적대적 검증이 이 파일을 그냥 지나갔다
 *
 * 변형 215개를 심어 보니 이 파일에서만 아래 갈래가 전부 초록이었다. 무엇이
 * 빠져나갔고 무엇으로 막았는지 적어 둔다.
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
 */

const REDESIGN = "src/components/landing/redesign";

/** 전부 주석을 벗긴 뒤 본다. 화면에 나가는 것만이 계약이다. */
const landing = rendered("src/app/landing/page.tsx");
const header = rendered(`${REDESIGN}/LandingHeader.tsx`);
const mobileMenu = rendered(`${REDESIGN}/MobileLandingMenu.tsx`);
const hero = rendered(`${REDESIGN}/TransformationHero.tsx`);
const content = rendered(CONTENT_PATH);
const notForVendors = rendered(`${REDESIGN}/NotForVendorsSection.tsx`);
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
 * `{notForVendors.aiNotice}` 든 `title={notForVendors.title}` 든 참조 표기는
 * 똑같이 `{키}` 를 품으므로 그것으로 찾는다.
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

/**
 * 있으면 안 되는 문장들.
 *
 * 계약 문장을 그대로 두고 **뒤에 뒤집는 문장을 붙이는** 변형이 이 파일을 전부
 * 통과했다(2026-08-27). "있어야 할 것"만 세면 덧붙임을 절대 못 잡는다.
 *
 * 정확 문자열이 아니라 패턴으로 적는다 — 어형 하나만 바꿔도 열거는 빠져나간다.
 * 각 패턴은 **현재 카피에서 오탐이 0인 것을 확인하고** 넣었다. 계약 문장 자체가
 * 같은 낱말을 쓰는 자리(예: "소개비를 받고 순서를 바꾸는 일도 없어요")는 서술형
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

  // 비용 경계. "이용 방법과 비용은 아직 정해지지 않았다" 가 정본이다.
  [
    /(?:서비스|웨딩한방|모든\s*기능|전\s*기능|전부|평생|계속)[^.\n]{0,8}(?:무료|공짜)/u,
    "서비스가 통째로 무료라고 말한다 — 비용은 아직 정해지지 않았다",
  ],
  [/무료(?:입니다|예요|에요|로\s*제공)/u, "무료라고 단정한다"],

  // 없는 사회적 증거. 랜딩은 이용자 수를 말할 근거가 없다.
  [
    /\d[\d,]*\s*(?:만\s*)?(?:쌍|명|커플|가정|부부|가입자|이용자)/u,
    "이용자 수를 숫자로 말한다 — 근거가 없다",
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
];

/**
 * 근거 없는 업체 수.
 *
 * 옛 가드는 `\d[\d,]*\s*곳` 하나여서 "406**개**" 가 그대로 통과했다. 자리 단위
 * (곳·군데·개사)는 그 자체로 업체 수이므로 바로 막고, 흔한 단위(개·건·사)는 업체를
 * 가리키는 낱말이 앞뒤에 붙을 때만 막는다 — 견적 확인 카드의 "사진 촬영은 12개"는
 * 항목 수라 막으면 안 된다.
 */
const VENDOR_COUNT =
  /\d[\d,]*\s*(?:곳|군데|개사|개소)|(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)[^.\n]{0,14}\d[\d,]*\s*(?:개|건|사|팀)|\d[\d,]*\s*(?:개|건|사|팀)[^.\n]{0,14}(?:업체|업소|예식장|웨딩홀|스튜디오|매장|제휴사)/u;

describe("landing two-sided trust contract", () => {
  it("leads with the concrete couple loop, then makes its trust evidence verifiable", () => {
    // 첫 화면이 파는 것. 옛 판의 라벨("웨딩한방 · 둘이 함께 관리하는 결혼 준비 공간")이
    // 장면 문장으로 바뀌었다. 지키는 것은 같다 — 첫 문장이 도구 이름이 아니라
    // **두 사람 사이**를 말한다.
    // 파일 전체가 아니라 `hero` 블록에서 찾는다. 전체를 보던 동안 이 두 문장을
    // `footer.tagline` 으로 옮겨도 통과했다(2026-08-27 변형).
    const heroCopy = contentBlock("hero", "scenes");
    expect(heroCopy).toContain("둘의 기준이 다른 걸 몰라서예요.");
    expect(heroCopy).toContain("웨딩한방은 둘이 어디서 갈리는지부터 봅니다.");
    expectWired("hero.body");
    expectWired("hero.note");
    // H1 은 줄바꿈·색 강조 때문에 컴포넌트가 손으로 적는다(정본과 글자가 같은지는
    // `landingHeadlineParity.test.ts` 가 본다). 여기서는 **첫 화면에 후크가 남아
    // 있는지**만 본다 — h1 을 통째로 지워도 카피 문자열이 대신 대답하던 자리다.
    expect(hero, "첫 화면 H1 에서 후크가 사라졌다").toContain("둘의 기준이 다른 걸");
    expect(hero, "첫 화면 H1 에서 후크가 사라졌다").toContain("몰라서예요.");

    // 아모라를 소개하는 자리에는 AI 고지가 붙는다(AI 기본법 — 사람인 것처럼 소개하지
    // 않는다). 옛 라벨 "아모라 · 대화를 정리하는 AI"가 문장 둘로 바뀌었고, 한계까지
    // 같이 적는다(옛 "AI 답변과 한계를 함께 표시"). 자리는 둘이다 — 아모라가 처음
    // 나오는 ②번 섹션과, 신뢰를 정리하는 ⑥번 섹션.
    const noSideCopy = contentBlock("noSide", "oneRoom");
    const vendorsCopy = contentBlock("notForVendors", "availableNow");
    expect(noSideCopy).toContain("아모라 답변은 AI가 만든 내용이에요.");
    expect(noSideCopy).toContain("AI는 틀리거나 놓칠 수 있어요");
    expect(vendorsCopy).toContain("아모라 답변은 AI가 만든 내용이에요.");
    expect(vendorsCopy).toContain("AI는 틀리거나 놓칠 수 있어요");
    expect(vendorsCopy).toContain("계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를");
    // 카피에 있는 것만으로는 부족하다 — 그리는 `<p>` 를 지워도 통과하던 자리다.
    expectWired("noSide.note");
    expectWired("notForVendors.aiNotice");

    // 결정은 두 사람이 하고 아모라는 정리만 한다 — 옛 "결정은 둘이. 아모라는 정리."
    const confirmCopy = contentBlock("confirm", "notForVendors");
    expect(noSideCopy).toContain("한쪽 손을 들지 않아요.");
    expect(confirmCopy).toContain("정한 것만 남아요.");
    expect(confirmCopy).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(confirmCopy).toContain("확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요.");
    expectWired("noSide.body");
    expectWired("confirm.body");
    expectWired("confirm.body2");

    // 돈 받고 순서를 바꾸지 않는다 — 옛 "광고비 때문에 일반 추천 순서를 바꾸지 않아요".
    expect(vendorsCopy).toContain("업체에서 돈을 받지 않아요.");
    expect(vendorsCopy).toContain("소개비를 받고 순서를 바꾸는 일도 없어요.");
    expectWired("notForVendors.title");
    expectWired("notForVendors.body");

    // 샘플에는 샘플이라고 적는다 — 옛 "기능 예시 · 이 화면에서는 실제로 저장되지
    // 않아요". 지금은 카드 아래 작은 글씨와 확인 카드의 한 줄이 그 일을 한다.
    expect(confirmCopy).toContain(
      "이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
    );
    expectWired("confirm.note");
    expect(confirmSection).toContain("확인을 누르기 전까지 예산 화면은 그대로예요.");

    // 가격 근거는 푸터 한 곳에 모였다. 공시 가격이 본문에서 곁블록으로 내려갔으니
    // 출처·기준 시점·한계도 같이 내려온다. 하나라도 빠지면 출처 없는 수치가 된다.
    // 이 여섯 줄은 **푸터 고지 블록에서** 찾는다. 파일 전체를 보던 동안, 이 문장들을
    // 주석 처리하기만 해도 열두 단언이 전부 통과했다(2026-08-27 변형).
    const footerCopy = contentBlock("footer", "notDoing");
    expect(footerCopy).toContain("한국소비자원 참가격");
    expect(footerCopy).toContain("2025년 11월 공시 기준");
    expect(footerCopy).toContain("2026.08.08 화면 집계 확인");
    expect(footerCopy).toContain("취소·환불 규정 원문은 업체가 쓴 문장 그대로예요.");
    expect(footerCopy).toContain("공시된 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있고");
    expect(footerCopy).toContain("예약·결제·계약은 업체와 직접 진행합니다.");
    expectWired("footer.notice");

    // 옛 계약은 랜딩이 업체 수와 그 실측 시점을 상수로 들 것을 요구했다
    // (`const PUBLISHED_VENDOR_COUNT = 406` · `PUBLISHED_COUNTS_VERIFIED_AT = "2026.08.08"`).
    // 새 랜딩은 업체 수를 아예 말하지 않는다 — 공시 가격이 곁블록으로 내려가면서
    // 숫자가 빠졌다. 지키던 것은 숫자가 아니라 **수치에 근거와 시점이 붙어 있는가**
    // 였으므로 계약을 둘로 나눠 옮긴다. 하나는 위의 출처·기준 시점 단언이고,
    // 다른 하나는 업체 수를 다시 말하기 시작할 때를 대비한 아래 금지다.
    // (커뮤니티 첫 화면은 여전히 406을 2026-08-08 실측으로 들고 있다 —
    //  `CommunityLandingClient.tsx:613`. 랜딩이 다시 숫자를 쓰려면 그 근거를 같이 온다.)
    expect(renderedCopy, "근거 없는 업체 수가 랜딩에 돌아왔다").not.toMatch(VENDOR_COUNT);

    // 문의 창구는 푸터에 남는다 — 옛 "서비스·업체 정보 문의" 자리.
    // 경계는 **실제로 다음에 오는 블록**이어야 한다. 처음엔 `headerAuth` 로 적었는데
    // 그 뒤 `headerAuth` 가 파일 끝으로 옮겨가면서 이 슬라이스가 `headerNav` 까지
    // 삼켰고, 헤더 앵커(`#scenes`)를 푸터 링크로 세어 거짓 실패를 냈다.
    const footerLinksCopy = contentBlock("footerLinks", "headerNav");
    // 주소를 여기 적지 않는다. 옛 주소는 메일을 받지 않았는데 여덟 군데가 박아 둔 탓에
    // 약관·개인정보·AI 고지가 모두 죽은 주소를 안내한 적이 있고,
    // `contactAddressIsSingleSourced.test.ts` 가 **테스트 파일까지 훑어** 그걸 막는다.
    // 지켜야 하는 것은 "문의 링크가 상수에서 온다" 이지 특정 주소가 아니다.
    expect(footerLinksCopy).toContain("mailto:${CONTACT.email}");
    expect(footerLinksCopy).toContain("CONTACT.email");
    expect(footer).toContain("footerLinks.policy");

    // 사람 글과 AI 답변을 같은 근거처럼 보여주지 않는다. 옛 CommunityBridgeSection의
    // 문장("사람의 경험과 AI의 제안을 같은 근거처럼 보여주지 않아요.")이 커뮤니티
    // 카드 작은 글씨 한 줄로 합쳐졌다. 약속은 같다.
    const openListCopy = contentBlock("notDoing", "footerLinks");
    expect(openListCopy).toContain("AI가 단 답변은 사람 답변과 구분해서 보여줘요");

    // 반영 전에 무엇이 반영될지 먼저 보여준다 — 옛 "준비 기록에 반영할 변경을 먼저
    // 보여줘요"가 확인 카드의 라벨로 바뀌었다.
    expect(confirmCopy).toContain("아모라의 제안 · 아직 반영 전");
    expectWired("confirm.sample.proposeLabel");
    expectWired("confirm.sample.propose");
    expect(content).not.toContain("무엇을 저장하고 공유할지 먼저 보여줘요");
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
    // 정규식이 낡아 빈 목록을 보면 아래 for 문이 조용히 통과한다. 개수 자체를 못
    // 박지는 않는다 — 내비 항목 수는 바뀔 수 있고, 여기서 지키는 건 "긁어 오긴 했다"다.
    expect(anchors.size, "앵커를 거의 못 찾았다 — 정규식이 낡았다").toBeGreaterThanOrEqual(4);
    for (const anchor of anchors) {
      expect(ids.has(anchor), `#${anchor} 를 가리키는데 그런 자리가 본문에 없다`).toBe(true);
    }

    // 내비 순서는 본문 섹션 순서와 같아야 한다. 앵커를 가진 파일을 찾아 그 컴포넌트가
    // 랜딩에서 몇 번째로 **렌더되는지**로 잰다 — 순서를 손으로 적지 않는다.
    // 예전에는 `landing.indexOf("<Owner")` 로 쟀는데, 그러면 섹션을 JSX 주석으로 꺼도
    // 문자열이 남아 순서가 맞는 것으로 읽혔다. `renderedSections()` 는 주석을 벗긴
    // `<main>` 안에서 실제로 그려지는 것만 돌려준다.
    const navAnchors = [
      ...contentBlock("headerNav").matchAll(/href: "#([a-zA-Z-]+)"/gu),
    ].map((match) => match[1]);
    expect(navAnchors.length, "헤더 내비 앵커를 못 찾았다 — 정규식이 낡았다")
      .toBeGreaterThanOrEqual(3);

    const sections = renderedSections();
    expect(sections.length, "본문이 섹션을 거의 안 그린다").toBeGreaterThanOrEqual(6);

    let previous = -1;
    for (const anchor of navAnchors) {
      const owner = components.find(([, src]) => src.includes(`id="${anchor}"`));
      expect(owner?.[0], `#${anchor} 를 가진 섹션 파일이 없다`).toBeDefined();
      const component = owner![0].replace(/\.tsx$/u, "");
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
    // 첫 화면 CTA. 옛 판은 `/start-here`를 아모라 시작 버튼으로 썼는데, 이번 판의
    // 후크는 로그인 없이 만져지는 웨딩코드라 목적지가 `/wedding-code`다.
    const heroCopy = contentBlock("hero", "scenes");
    expect(heroCopy).toContain('primary: { label: "스무 장면 답해보기", href: "/wedding-code" }');
    expect(hero).toContain("href={hero.primary.href}");
    expect(hero).toContain("{hero.primary.label}");

    // 헤더 CTA는 같은 목적지·같은 라벨이어야 한다. 두 버튼이 다른 곳으로 가면 처음 온
    // 사람은 어느 것이 진짜인지 모른다.
    expect(header).toContain('href="/wedding-code"');
    expect(header).toContain("스무 장면 답해보기");

    // 두 번째 버튼은 페이지 안 앵커다. 그 앵커가 실재하는지는 위 대조가 본다.
    expect(heroCopy).toContain('secondary: { label: "지금 되는 것 보기", href: "#now" }');
    expect(hero).toContain("href={hero.secondary.href}");
    expect(hero).toContain("{hero.secondary.label}");

    // 로그인 진입점. 옛 헤더는 데스크톱에도 "로그인" 링크를 들고 있었고, 새 헤더는
    // 모바일 메뉴 안에만 둔다(`lg:hidden`). 헤더가 렌더하는 단위로 보면 링크는 살아
    // 있으므로 헤더+메뉴를 합쳐서 본다. **데스크톱 헤더에 가입·로그인 링크가 아예
    // 없는 것**은 이 파일이 아니라 `landingSignupIsOpen.test.ts`가 지는 계약이다.
    expect(`${header}\n${mobileMenu}`).toContain('href="/login"');
    expect(
      mobileMenu,
      "/login 링크의 보이는 글자가 '로그인'이 아니다",
    ).toMatch(/href="\/login"[\s\S]{0,600}>\s*로그인\s*<\/Link>/u);

    // 마무리 CTA — 첫 화면과 같은 행동을 부르고, 계정이 있는 사람만 로그인으로 보낸다.
    //
    // 2026-08-28 재조준: 마무리 버튼이 둘에서 셋이 됐다(가입이 열려 있는데 마무리가
    // 로그인만 내밀면 계정 없는 사람에게 길이 없었다). 옛 단언은 정확 문자열
    // `secondary: { label: "계정이 있다면 로그인", … }` 하나였고 카피가 바뀌자
    // 그대로 깨졌다. 라벨을 다시 박지 않고 **키마다 배선을 확인한다** — 셋 중 하나를
    // 지워도 잡히고, 라벨만 바꿔도 안 깨진다.
    const closingCopy = contentBlock("closing", "footer");
    expect(closingCopy).toContain('primary: { label: "스무 장면 답해보기", href: "/wedding-code" }');
    const closingKeys = [...closingCopy.matchAll(/^\s{4}(primary|secondary|tertiary):/gmu)].map(
      (match) => match[1],
    );
    expect(closingKeys.length, "마무리 CTA를 못 찾았다 — 정규식이 낡았다")
      .toBeGreaterThanOrEqual(2);
    for (const key of closingKeys) {
      expect(closing, `마무리에서 closing.${key} 버튼이 사라졌다`)
        .toContain(`href={closing.${key}.href}`);
      expect(closing, `마무리 closing.${key} 버튼의 글자가 사라졌다`)
        .toContain(`{closing.${key}.label}`);
    }

    // 로그인으로 보내는 마무리 링크는 **계정이 있는 사람에게만** 말을 건다.
    // 조건 없이 "로그인하고 시작하기"가 되면 가입이 열려 있는데도 계정 없는 사람이
    // 막힌 것으로 읽는다.
    const loginCta = closingCopy.match(/label: "([^"]*)", href: "\/login"/u);
    expect(loginCta?.[1], "마무리에 /login 으로 가는 CTA가 없다").toBeDefined();
    expect(loginCta![1], "로그인 CTA가 계정이 있는 사람용이라고 말하지 않는다")
      .toMatch(/계정이\s*(?:있다면|있으면|있는)/u);

    // 없어진 단언: `const amoraStartHref = "/start-here"`와 CTA 라벨 "아모라와
    // 시작하기". 로그인 없이 아모라를 시작할 수 없게 된 뒤(#245) 랜딩에서 아모라로
    // 곧장 보내는 버튼 자체가 사라졌다. 라벨이 목적지와 맞는지는 위 세 CTA가 진다.
  });

  it("keeps the disclosure source, paid-ranking promise, and limits visible", () => {
    const vendorsCopy = contentBlock("notForVendors", "availableNow");
    const footerCopy = contentBlock("footer", "notDoing");
    const openListCopy = contentBlock("notDoing", "footerLinks");

    // 출처. 옛 "자료 출처 · 한국소비자원 참가격"이 푸터 고지 한 줄과 곁블록으로 갈렸고,
    // 우리가 옮겨 적었을 뿐이라는 것까지 말한다.
    expect(footerCopy).toContain("가격 출처 · 한국소비자원 참가격");
    expect(vendorsCopy).toContain("한국소비자원이 공개한 자료라 누구나 볼 수 있는 것이고");
    expect(vendorsCopy).toContain("저희는 출처와 확인 시점을 붙여서 옮겨 놓았어요");
    // 곁블록이 실제로 렌더되고 원문으로 간다. 카피만 있고 길이 없으면 열람 약속이
    // 거짓이 된다.
    expect(notForVendors).toContain("{notForVendors.priceAside}");
    expect(notForVendors).toContain('href="/price"');
    // AI 정책 링크도 카피가 아니라 화면에 있어야 한다.
    expect(notForVendors).toContain("href={notForVendors.policyLink.href}");
    expect(notForVendors).toContain("{notForVendors.policyLink.label}");

    // 광고는 광고라고 표시하고 일반 추천과 섞지 않는다.
    expect(vendorsCopy).toContain("소개비를 받고 순서를 바꾸는 일도 없어요.");
    expect(openListCopy).toContain("광고·협찬 글에는 출처 표시가 붙고");

    // 한계. 공시가는 기본 조건 기준이고, 공시한 업체만 실려 지역 편차가 크다.
    // 지역 편차 문장을 빼면 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다.
    expect(footerCopy).toContain("공시된 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있고");
    expect(footerCopy).toContain("공시한 업체만 싣기 때문에");
    expect(footerCopy).toContain("지역별로 수가 크게 달라요");
    expect(openListCopy).toContain("표시 금액은 기본 조건 기준이라");
    expect(openListCopy).toContain("한국소비자원 참가격 자료 기준");

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
        + `|${amora}[^.\\n]{0,24}${gate}[^.\\n]{0,14}${negation}`,
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
    // 시작 조건을 적었다. 새 랜딩에서는 그 자리를 ⑦ "가입 안 해도 되는 것들" 목록과
    // 마무리 작은 글씨가 나눠 진다. 지키는 것은 같다 — **누르기 전에 조건을 안다.**
    const availableNowCopy = contentBlock("availableNow", "closing");
    const closingCopy = contentBlock("closing", "footer");
    const confirmCopy = contentBlock("confirm", "notForVendors");

    expect(availableNowCopy).toContain("가입하기 전에, 이만큼은 지금.");
    expect(availableNowCopy).toContain(
      "계정 없이 지금 열려 있어요. 로그인도 결제도 요구하지 않아요.",
    );
    // ⑦ 섹션은 카피를 `copy` 로 별칭 지어 쓴다. 별칭 이름을 박지 않고, 본문 값을
    // 실제로 그리는지만 본다 — 카피만 남고 `<p>` 가 사라지면 여기서 잡힌다.
    const availableNowSection = rendered(`${REDESIGN}/AvailableNowSection.tsx`);
    expect(availableNowSection, "⑦ 섹션이 카피 본문을 안 그린다").toMatch(/\{\s*\w+\.body\s*\}/u);
    expect(closingCopy).toContain("예산·할 일·일정을 계정에 남기는 건 계정 베타예요.");
    expectWired("closing.note");
    expect(
      rendered(`${REDESIGN}/AvailableNowSection.tsx`),
      "계정을 만들면 무엇이 열리는지가 사라졌다",
    ).toContain("계정을 만들면 예산·할 일·일정이 열려요.");

    // 2026-08-06 파운더 결정: 로그인 없는 아모라 이용에 한도를 걸 예정이라 랜딩은
    // 아모라를 로그인 필요로 안내한다. 그 안내 문장("아모라는 결혼식 날짜와 준비
    // 상황을 바탕으로 답해야 해서 로그인이 필요해요")은 2026-08-27 판에서 사라졌고,
    // 대신 **구조가 같은 약속을 진다** — 로그인 없이 되는 목록에 아모라가 없고,
    // 아모라가 준비 기록을 바꾸는 구간에는 "계정 베타" 이름표가 붙는다.
    //
    // 옛 코드는 `content.slice(indexOf(a), indexOf(b))` 뒤 `length > 0` 으로 지켰는데,
    // `indexOf` 가 -1 이면 `slice(-1)` 이 마지막 한 글자를 주므로 **경계가 사라져도
    // 영원히 참**이었다. 못 찾으면 던지는 `contentBlock` 으로 바꾼다.
    // (`availableNow` 는 `landingContent` 안의 카피 키와 목록 export 두 곳에 있어
    //  `contentBlock("availableNow")` 는 카피 키를 먼저 잡는다. 목록은 그 앞 블록인
    //  `notDoing` 부터 `footerLinks` 까지로 집는다 — notDoing 에는 href 가 없다.)
    const openList = contentBlock("notDoing", "footerLinks");
    const openHrefs = [...openList.matchAll(/href: "([^"]+)"/gu)].map((match) => match[1]);
    expect(openHrefs.length, "로그인 없이 되는 목록이 비었다").toBeGreaterThanOrEqual(5);
    for (const href of openHrefs) {
      expect(href, "로그인 없이 되는 목록이 아모라로 보낸다").not.toMatch(/amora|chat/iu);
      expect(href, "로그인 없이 되는 목록이 로그인 벽으로 보낸다").not.toMatch(/^\/login/u);
      expect(href, "로그인 없이 되는 목록에 빈 링크가 있다").toMatch(/^\/[a-z0-9-]/u);
    }
    // 카드가 카피를 실제로 그린다. 목록만 남고 렌더가 사라지면 "지금 되는 것"이
    // 화면에서 통째로 빈다.
    for (const wiring of [
      "availableNow.map",
      "{item.title}",
      "{item.body}",
      "{item.note}",
      "href={item.cta.href}",
      "{item.cta.label}",
    ]) {
      expect(availableNowSection, `"지금 되는 것" 카드가 ${wiring} 을 안 쓴다`)
        .toContain(wiring);
    }

    // 푸터의 "로그인 없이" 묶음은 그 목록과 같은 곳으로 간다. 링크를 전부 `#` 로
    // 바꿔도 통과하던 자리다 — 목적지를 실제로 대조한다.
    // 경계는 **실제로 다음에 오는 블록**이어야 한다. 처음엔 `headerAuth` 로 적었는데
    // 그 뒤 `headerAuth` 가 파일 끝으로 옮겨가면서 이 슬라이스가 `headerNav` 까지
    // 삼켰고, 헤더 앵커(`#scenes`)를 푸터 링크로 세어 거짓 실패를 냈다.
    const footerLinksCopy = contentBlock("footerLinks", "headerNav");
    const footerOpen = between(footerLinksCopy, "open: [", "]", "footerLinks.open");
    const footerOpenHrefs = [...footerOpen.matchAll(/href: "([^"]+)"/gu)].map((m) => m[1]);
    for (const href of openHrefs) {
      expect(footerOpenHrefs, `푸터의 "로그인 없이" 묶음에 ${href} 가 없다`).toContain(href);
    }
    for (const href of [...footerLinksCopy.matchAll(/href: "([^"]+)"/gu)].map((m) => m[1])) {
      expect(href, "푸터 링크가 아무 데도 가지 않는다").toMatch(/^(?:\/[a-z0-9-]|mailto:)/u);
    }
    // 그 링크들을 푸터가 실제로 그린다.
    for (const wiring of ["footerLinks.open", "footerLinks.beta", "footerLinks.policy", "href={item.href}", "{item.label}"]) {
      expect(footer, `푸터가 ${wiring} 을 안 쓴다`).toContain(wiring);
    }

    expect(confirmCopy).toContain("계정 베타에서는");
    expect(confirmCopy).toContain("계정 베타 기능이에요.");

    // "무료 한도"는 커플별 한도를 가리키는 말인데 그 스위치는 프로덕션에서 강제로
    // 꺼져 있다(check-amora-production-env.mjs:64 coupleQuotaDisabled).
    expect(content, "커플별 무료 한도는 프로덕션에서 꺼져 있다")
      .not.toContain("아모라 상담에는 무료 한도가 있어요");

    // 비용은 미정이라고 적는다.
    expect(confirmCopy).toContain("이용 방법과 비용은 아직 정해지지 않았");

    // 가입해도 결제되지 않는다는 약속. 두 자리에 다 있어야 한다 — 확인 카드에서
    // 계정 베타를 말하는 자리와, 마지막으로 누르기 직전의 마무리.
    expect(confirmCopy).toContain("계정을 만들어도 지금은 결제를 요청하지 않아요.");
    expect(closingCopy).toContain("계정을 만들어도 지금은 결제를 요청하지 않아요.");

    // "신청"은 /beta 승인 대기열을 가리키던 말이다. 그 대기열은 2026-08-23에
    // 사전등록으로 정정됐고(`app/beta/page.tsx` — "승인을 기다리지 않아도 됩니다"),
    // 사전등록 폼조차 없어졌다(`app/beta/__tests__/noPreregistrationIntake.test.ts`).
    // 랜딩에는 "신청"이라는 행동이 아예 없으므로, 이 문장은 존재하지 않는 행동으로
    // 안심시킨다.
    // 2026-08-28: 이 단언이 **원문**을 보느라 자기 설명 주석에 걸려 실패하고 있었다
    // (`landingContent.ts` 주석이 이 문구를 인용한다). 주석을 벗기고 본다.
    expect(content, "없어진 '신청'으로 결제 안 된다고 말한다")
      .not.toContain("신청만으로 결제되지 않아요");

    expect(content).not.toContain("웨딩한방은 무료");
    expect(content).not.toContain("평생 무료");
  });
});
