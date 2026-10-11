import { describe, expect, it } from "vitest";

import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
} from "./landingSource";

/**
 * 고지 문장이 **카피 파일에만** 있고 화면에는 없는 상태를 막는다.
 *
 * ## 왜 생겼나
 *
 * 랜딩 가드 대부분이 "이 문장이 `landingContent.ts` 에 있나" 로 묻는다. 그러면
 * 그 문장을 그리는 `<p>` 를 지워도 통과한다 — 카피 파일이 대신 대답하기 때문이다.
 *
 * 2026-08-27 적대적 검증에서 이 갈래로 17개가 빠져나갔다. 실제로 통과한 것들:
 *
 *   - `NotForVendorsSection` 에서 AI 고지 `<p>` 삭제 → 초록
 *   - `ClosingAction` 에서 "로그인 없이 열려요 / 결제를 요청하지 않아요" 삭제 → 초록
 *   - `ScenesSection` 에서 "궁합 점수를 매기지 않아요" 삭제 → 초록 (CLAUDE.md 금지 대응)
 *   - `AvailableNowSection` 의 `availableNow.map` → `[].map` (카드 6장 소멸) → 초록
 *   - 그리는 `<p>` 를 `{false && <p>…</p>}` 로 감싸기 → 초록
 *   - 그리는 `<p>` 에 `hidden` 클래스 추가 → 초록
 *   - 다른 파일(장식 파일)에 아무도 부르지 않는 컴포넌트를 만들어 참조만 남기기 → 초록
 *
 * ## 2026-08-29 — 랜딩이 정본 시안으로 다시 지어졌다
 *
 * `ScenesSection` `NoSideSection` `OneRoomSection` `PrivateLaneSection`
 * `NotForVendorsSection` `PriceCompareSection` 이 통째로 없어졌다. **그 섹션들이 지고
 * 있던 고지는 없어지지 않았다 — 자리를 옮겼다.** 그래서 옛 경로를 지우는 대신 새 자리를
 * 가리키게 고쳤다. 어디서 어디로 갔는지는 아래 표에 `why` 로 한 줄씩 적어 둔다.
 *
 * 옮기면서 검사 방식도 두 가지 고쳤다:
 *
 *   1. **뜻으로 잰다.** 옛 검사는 "그 키가 카피에 있나" 만 물어서, 키는 그대로 두고
 *      값을 통째로 비워도 통과했다. 이제 그 고지가 실제로 지고 있는 **문장 조각**이
 *      그 블록 안에 있는지 함께 본다.
 *   2. **배열 안에 사는 고지가 생겼다.** 궁합 금지·저장 금지·공시 출처·업체 편 아님이
 *      이제 `availableNow.cards[]` 와 `boundaries.items[]` 안에 있다. 카드 한 장을
 *      지워도 `{card.note}` 는 그대로라 경로 검사로는 안 잡힌다. 그래서 배열 고지는
 *      **문장 조각이 카피 블록에 있는지 + 그 배열을 `.map` 으로 온전히 그리는지** 로 잰다.
 *
 * ## 무엇을 지키나
 *
 * **법·신뢰 때문에 화면에 있어야 하는 문장**만 본다. 그 문장이
 *
 *   (1) 카피의 **그 블록**에 뜻 그대로 있고
 *   (2) `page.tsx` 가 실제로 그리는 컴포넌트가 그 값을 JSX 로 내보내고
 *   (3) 그 자리가 꺼져 있지 않은가 — `hidden`·`{false &&`·JSX 주석
 *
 * 셋을 함께 본다. 하나만 보면 나머지 둘로 우회된다.
 *
 * ## 이 파일이 지키지 않는 것
 *
 * 실제 픽셀 가시성(대비·겹침·화면 밖)은 소스로 알 수 없다. 그건 화면을 띄워 잰다.
 */

/** `landingContent` 안의 블록 순서. `contentBlock` 이 블록을 잘라낼 경계로 쓴다. */
const NEXT_BLOCK: Readonly<Record<string, string | undefined>> = {
  // ⚠️ 2026-08-29: 여기가 `amoraNote: "community"` 였다. 그 사이에 섹션 넷이
  // 복원되면서 `amoraNote` 조각이 563자 → 2,732자로 **다섯 배 넓어졌고**, 그 안의
  // 검사가 이웃 블록의 문장으로 대신 답해졌다("샘플"은 oneRoom.note 가, "AI는
  // 틀리거나 놓칠 수 있어요"는 noSide.note 가). 블록을 추가하면 이 표도 함께 옮겨라.
  //
  // 2026-09-03 시안으로 블록이 다시 갈렸다(scenes·oneRoom·privateLane 삭제,
  // blockedReasons·photoBand 신설). 순서는 `landingContent.ts` 의 실제 순서다.
  hero: "blockedReasons",
  blockedReasons: "amoraNote",
  amoraNote: "noSide",
  noSide: "confirm",
  confirm: "availableNow",
  availableNow: "community",
  community: "photoBand",
  photoBand: "faq",
  faq: "boundaries",
  boundaries: "closing",
  closing: "footer",
  // 마지막 블록. 경계를 주지 않으면 파일 끝까지 본다.
  footer: undefined,
};

/**
 * 그 블록의 카피만 잘라 온다.
 *
 * 블록 이름이나 경계가 사라지면 `contentBlock` 이 **던진다** — 조용히 넓어져서
 * 검사가 무의미해지는 것을 막는다(`landingSource.ts` 머리말).
 */
function copyOf(block: string): string {
  if (!(block in NEXT_BLOCK)) {
    throw new Error(
      `"${block}" 은 NEXT_BLOCK 에 없습니다. 랜딩 블록이 늘거나 이름이 바뀌었다면 `
        + `이 표부터 고치세요 — 경계가 틀리면 검사가 조용히 넓어집니다.`,
    );
  }
  return contentBlock(block, NEXT_BLOCK[block]);
}

/**
 * 화면에서 사라지면 안 되는 고지 — **키 하나에 값 하나**인 것들.
 *
 * `key` 는 `landingContent` 안의 경로다. 그리는 컴포넌트가 `{경로}` 를 JSX 로
 * 내보내야 한다. `owner` 는 그 일을 하는 컴포넌트 파일이다.
 * `phrases` 는 그 고지가 지고 있는 **뜻**이다 — 키만 남기고 값을 바꾸는 우회를 막는다.
 */
const DISCLOSURES: ReadonlyArray<{
  key: string;
  owner: string;
  why: string;
  phrases: readonly string[];
}> = [
  {
    key: "hero.note",
    owner: "TransformationHero.tsx",
    why: "아모라 시작 버튼의 로그인·시작 설정, 현재 무료·향후 요금 미정과 웨딩코드의 가입 없는 진입을 안내한다",
    phrases: ["아모라는 로그인과 시작 설정 후 이용해요", "현재 무료이며, 향후 요금은 아직 정해지지 않았어요", "웨딩코드는 가입 없이 해 볼 수 있어요"],
  },
  {
    key: "amoraNote.note",
    owner: "AmoraNoteSection.tsx",
    why:
      "AI 기본법 고지 + 이 카드가 샘플이라는 표시 + 이 화면에서는 저장되지 않는다는 "
      + "개인정보 고지. 없어진 `noSide.note`(아모라를 처음 소개하는 자리의 AI 고지)와 "
      + "`privateLane.note`(대화 저장 고지)가 여기로 합쳐졌다",
    // 카드 **안**에 있어야 한다 — 바깥 작은 글씨로 빼면 카드만 캡처됐을 때 떨어져
    // 나간다(`AmoraNoteSection.tsx` 머리말).
    phrases: ["기능을 설명하는 예시 대화예요", "이 화면에서는 대화하거나 저장할 수 없어요"],
  },
  // ⚠️ 2026-08-29에 되살린 섹션들의 고지가 여기 넷 있었다. 섹션이 없어졌을 때 이
  // 표에서 함께 빠졌는데, 섹션만 돌아오고 표가 안 돌아오면 그 문장들은 아무 검사도
  // 안 받았다. 실제로 확인했다 — `scenes.note` 를 다른 문장으로 바꿔도 랜딩 테스트
  // 208개가 전부 초록이었다. 다른 검사들은 **키가 그려지는가**만 보고 문장은 안 본다.
  //
  // ## 2026-09-03 — 섹션 셋이 없어지고 고지는 **자리를 옮겼다**
  //
  // 시안에 `ScenesSection`·`OneRoomSection`·`PrivateLaneSection` 이 없다. 셋을 지우되
  // 고지는 하나도 버리지 않았다. 어디로 갔는지 아래에 이름으로 적는다 — 이 표가
  // 비면 그 문장들이 다시 무방비가 된다.
  //
  //   scenes.note      → availableNow 카드 03 의 note (ITEM_DISCLOSURES)
  //   oneRoom.note     → amoraNote.note 가 이미 같은 뜻을 진다(샘플 표식)
  //   privateLane.note → amoraNote.privacyNote (아래)
  {
    key: "noSide.note",
    owner: "NoSideSection.tsx",
    why:
      "아모라가 말하는 카드의 AI 기본법 고지 + 지어낸 커플 대화가 실제 이용 현황처럼 "
      + "읽히지 않게 하는 샘플 표식(없어진 `oneRoom.note` 의 몫)",
    phrases: [
      "기능을 설명하는 예시 대화예요",
      "실제 이용자의 대화가 아니에요",
    ],
  },
  {
    key: "amoraNote.privacyNote",
    owner: "AmoraNoteSection.tsx",
    why:
      "대화가 서비스에서 처리·저장될 수 있다는 개인정보 고지. 없어진 "
      + "`privateLane.note` 를 **글자 그대로** 이어받았다 — '나만 보는 자리' 를 파는 "
      + "카드 바로 아래라 저장 사실을 같은 자리에서 말한다",
    phrases: ["개인 상담도", "처리·저장돼요"],
  },
  {
    key: "confirm.note",
    owner: "ConfirmSection.tsx",
    why:
      "이용 방법·비용이 아직 정해지지 않았고 지금은 결제를 요청하지 않는다는 고지. "
      + "2026-08-29 파운더 결정으로 '계정 베타' 라는 **틀**은 화면에서 걷어냈지만, "
      + "이 고지는 베타라서가 아니라 오늘 참이라 남았다(CLAUDE.md)",
    phrases: ["현재 무료로 이용할 수 있어요", "향후 요금은 아직 정해지지 않았어요"],
  },
  {
    key: "closing.note",
    owner: "ClosingAction.tsx",
    why: "무엇이 로그인 없이 열리는지 · 계정을 만들어도 결제를 요청하지 않는다는 고지",
    phrases: ["무료 도구는 가입 없이 이용할 수 있어요", "아모라와 예산·할 일·일정 관리에는 가입이 필요해요"],
  },
  {
    key: "footer.notice",
    owner: "LandingFooter.tsx",
    why: "가격 출처·기준일·지역 편차·예약은 업체와 직접·AI 생성물이라는 고지",
    // 지역 편차 문장을 빼면 안 된다 — 공시한 업체만 싣기 때문에 지역별로 수가 크게
    // 다르고, 그걸 안 적으면 사용자가 "우리 지역엔 없네" 를 우리 잘못으로 읽는다.
    phrases: [
      "한국소비자원 참가격",
      "공시 기준",
      "지역별 등록 업체 수가 달라요",
      "예약·결제·계약은 업체와 직접",
    ],
  },
];

/**
 * 배열 안에 사는 고지.
 *
 * 카드·항목은 `.map` 으로 그려져서 **경로가 화면에 하나뿐이 아니다.** 카드 한 장을
 * 통째로 지워도 `{card.note}` 는 남으므로 경로 검사로는 안 잡힌다. 그래서 여기서는
 *
 *   - 그 문장이 **그 블록의 카피**에 있는가 (뜻)
 *   - `owner` 가 그 배열을 `.map` 으로 돌며 그 필드를 JSX 로 내보내는가 (자리)
 *
 * 둘을 함께 본다.
 */
const ITEM_DISCLOSURES: ReadonlyArray<{
  array: string;
  field: string;
  owner: string;
  phrase: string;
  why: string;
}> = [
  {
    array: "availableNow.cards",
    field: "note",
    owner: "AvailableNowSection.tsx",
    phrase: "심리 진단이나 궁합 검사가 아니에요",
    why:
      "CLAUDE.md 금지 대응 — WeddingCode 는 검증된 궁합 검사가 아니다. 없어진 "
      + "`scenes.note` 가 지고 있던 고지가 스무 장면 카드로 내려왔다. 지우면 화면이 "
      + "금지된 약속을 하게 된다",
  },
  {
    array: "availableNow.cards",
    field: "note",
    owner: "AvailableNowSection.tsx",
    phrase: "가입 없이 선택한 내용은 저장하지 않아요",
    why:
      "개인정보 고지 — 없어진 `privateLane.note` 의 저장 고지가 견적 카드로 옮겨졌다. "
      + "견적서에는 이름·금액이 들어 있어 저장 여부가 사용자에게 제일 먼저 궁금한 것이다. "
      + "동사가 '넣은 견적' 이 아니라 '선택한 내용' 인 이유: 목적지 화면에는 입력란이 "
      + "없고 `<select>` 체크리스트뿐이라, 넣는다고 쓰면 없는 기능을 약속한다 "
      + "(`publicCopyMatchesProduct.test.ts` 가 그 표현을 막는다). 화면 자신도 "
      + "\"선택한 내용은 저장하지 않습니다\" 라고 말한다 — 지킬 것은 문구가 아니라 고지다",
  },
  {
    array: "availableNow.cards",
    field: "note",
    owner: "AvailableNowSection.tsx",
    phrase: "2025년 11월 공시 기준",
    why:
      "공시 가격의 출처·시점. 없어진 `notForVendors.priceAside` 자리다. 공시 가격은 "
      + "공개 자료라 출처와 기준일을 안 붙이면 우리가 매긴 값처럼 읽힌다",
  },
  {
    array: "availableNow.cards",
    field: "note",
    owner: "AvailableNowSection.tsx",
    phrase: "가격의 적정 여부는 평가하지 않아요",
    why: "CLAUDE.md — 가격의 적정성·품질을 점수·등급·'최고' 로 판정하지 않는다",
  },
  {
    array: "boundaries.items",
    field: "title",
    owner: "BoundariesSection.tsx",
    phrase: "업체에 점수·등급·순위를 매기지 않아요",
    why:
      "없어진 `NotForVendorsSection` 의 핵심 — 우리가 업체 편이 아니라는 유일한 증거이자 "
      + "CLAUDE.md 의 점수·등급 금지",
  },
  {
    array: "boundaries.items",
    field: "note",
    owner: "BoundariesSection.tsx",
    phrase: "광고 상품은 운영하지 않아요",
    why: "같은 자리 — 돈 받고 순위를 팔지 않는다는 고지(옛 `notForVendors`)",
  },
  {
    array: "boundaries.items",
    field: "note",
    owner: "BoundariesSection.tsx",
    phrase: "중개하지 않아요",
    why:
      "거래층 보류 고지(CLAUDE.md — 업체 계약 신청·예약·결제를 중개하지 않는다). "
      + "전자상거래법 지위 판정 전까지 화면이 중개처럼 보이면 안 된다",
  },
  {
    array: "boundaries.items",
    field: "title",
    owner: "BoundariesSection.tsx",
    phrase: "아모라의 답변은 AI가 작성해요",
    why: "AI 기본법 고지 — 없어진 `notForVendors.aiNotice` 가 여기로 왔다",
  },
  {
    array: "boundaries.items",
    field: "note",
    owner: "BoundariesSection.tsx",
    phrase: "AI 답변에는 오류가 있을 수 있어요",
    why: "같은 자리 — AI 한계 고지. `/ai-policy` 가 같은 것을 공개하고 있어 어긋나면 안 된다",
  },
];

/**
 * 카피에 있는데 **아무 컴포넌트도 그리지 않는** 고지.
 *
 * ⚠️ 통과시키려고 만든 목록이 아니라 **남겨 둔 구멍의 이름표**다.
 *
 * `confirm.sampleNote` ("기능 예시예요. 이름·금액은 기능을 보여주기 위한 샘플이고
 * 실제 이용 현황이 아니에요")는 2026-08-29 개편에서 카피에만 남았다.
 * `ConfirmSection.tsx` 는 이 값을 그리지 않고, 대신 손으로 쓴
 * "확인을 누르기 전까지 예산 화면은 그대로예요." 한 줄만 있다. 그래서 총예산 3,000만원
 * 짜리 가짜 카드가 **샘플이라는 표시 없이** 화면에 서 있다.
 *
 * 고치려면 `ConfirmSection.tsx` 가 `{confirm.sampleNote}` 를 그려야 하고, 고친 뒤
 * 이 줄을 지워라. (이 세션에서는 컴포넌트가 담당 파일이 아니라 손대지 못했다.)
 */
const KNOWN_UNRENDERED: readonly string[] = [
    // 2026-08-29: `confirm.sampleNote` 가 여기 있었다. 같은 변경에서
    // `ConfirmSection` 이 카드 안에 그리도록 고쳤으므로 면제가 필요 없다.
    // 목록이 비었다 = 카피의 고지가 전부 화면에 닿는다.
  ];

/** 카피가 들고 있는 고지 계열 키 전부. 고아가 **새로** 생기는지 본다. */
const DISCLOSURE_COPY_KEYS: readonly string[] = [
  ...DISCLOSURES.map((d) => d.key),
  ...KNOWN_UNRENDERED,
];

/** `key` 의 마지막 조각. 컴포넌트는 구조분해해서 쓰는 경우가 많다. */
function leaf(key: string): string {
  return key.slice(key.lastIndexOf(".") + 1);
}

/** `key` 의 앞부분(블록 이름). */
function block(key: string): string {
  return key.slice(0, key.lastIndexOf("."));
}

/** 정규식에 넣기 전에 점을 이스케이프한다. `availableNow.cards` 같은 경로용. */
function escapePath(path: string): string {
  return path.replace(/\./gu, "\\.");
}

/** 그 컴포넌트가 이 값을 JSX 표현식으로 내보내는가. */
function rendersValue(source: string, key: string): boolean {
  const tail = leaf(key);
  const owner = block(key);
  // `{footer.notice}` · `{notice}` · `{copy.notice}` 를 모두 받는다.
  const patterns = [
    new RegExp(`\\{\\s*${escapePath(owner)}\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*[A-Za-z_$][\\w$]*\\.${tail}\\s*\\}`, "u"),
    new RegExp(`\\{\\s*${tail}\\s*\\}`, "u"),
  ];
  return patterns.some((p) => p.test(source));
}

/** 그 값을 내보내는 줄이 꺼져 있는가. */
function switchedOff(source: string, tail: string): string | null {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!new RegExp(`\\{[^}]*\\b${tail}\\s*\\}`, "u").test(lines[i])) continue;
    // 그 줄과 바로 앞 두 줄을 본다 — 여는 태그가 여러 줄로 쪼개져 있을 수 있다.
    const window = lines.slice(Math.max(0, i - 2), i + 1).join(" ");
    if (/\{\s*false\s*&&/u.test(window)) return "{false && …} 로 꺼져 있다";
    if (/className=\{?["'`][^"'`]*\bhidden\b/u.test(window)) return "hidden 클래스로 감춰져 있다";
  }
  return null;
}

/** 그 배열을 카피에서 꺼내 `.map` 으로 도는가. */
function mapsOverArray(source: string, array: string): boolean {
  const tail = array.slice(array.lastIndexOf(".") + 1);
  const patterns = [
    new RegExp(`${escapePath(array)}\\.map\\(`, "u"),
    new RegExp(`\\b${tail}\\.map\\(`, "u"),
  ];
  return patterns.some((p) => p.test(source));
}

const components = new Map(everyLandingComponent());

describe("고지 문장은 화면에 있다", () => {
  it("모든 고지가 카피에 뜻 그대로 있다", () => {
    // 옛 검사는 "그 키가 있나" 만 물었다. 키를 남기고 값을 비우면 통과한다.
    // 이제 그 고지가 지고 있는 문장 조각이 **그 블록 안에** 있는지 함께 본다.
    const missing: string[] = [];
    for (const { key, why, phrases } of DISCLOSURES) {
      const copy = copyOf(block(key));
      if (!copy.includes(`${leaf(key)}:`)) {
        missing.push(`${key} 키가 카피에서 사라졌다 — ${why}`);
        continue;
      }
      for (const phrase of phrases) {
        if (!copy.includes(phrase)) {
          missing.push(`${key} 에서 "${phrase}" 가 사라졌다 — ${why}`);
        }
      }
    }
    expect(missing, "카피에서 사라진 고지").toEqual([]);
  });

  it("배열 안에 사는 고지도 카피에 있다", () => {
    // 카드·항목 하나를 통째로 지워도 `{card.note}` 는 남는다. 그래서 뜻으로 잰다.
    const missing = ITEM_DISCLOSURES.filter(
      (d: (typeof ITEM_DISCLOSURES)[number]) => !copyOf(block(d.array)).includes(d.phrase),
    ).map(
      (d: (typeof ITEM_DISCLOSURES)[number]) =>
        `${d.array}[].${d.field} "${d.phrase}" 가 사라졌다 — ${d.why}`,
    );
    expect(missing, "카피에서 사라진 배열 고지").toEqual([]);
  });

  it("고지를 그리는 컴포넌트가 page.tsx 에 실제로 그려진다", () => {
    // 카피에 있고 컴포넌트도 그리는데, 그 컴포넌트를 페이지가 안 그리면 화면엔 없다.
    const drawn = new Set(renderedSections().map((s: string) => `${s}.tsx`));
    // 헤더·푸터는 <main> 밖이라 renderedSections 가 안 센다. 페이지 소스로 확인한다.
    const page = rendered("src/app/landing/page.tsx");
    const owners: Array<{ owner: string; what: string }> = [
      ...DISCLOSURES.map((d: (typeof DISCLOSURES)[number]) => ({
        owner: d.owner,
        what: d.key,
      })),
      ...ITEM_DISCLOSURES.map((d: (typeof ITEM_DISCLOSURES)[number]) => ({
        owner: d.owner,
        what: `${d.array}[].${d.field}`,
      })),
    ];
    const orphans = owners.filter(
      ({ owner }) => !drawn.has(owner) && !page.includes(`<${owner.replace(".tsx", "")}`),
    );
    expect(
      [...new Set(orphans.map((d) => `${d.owner} (${d.what})`))],
      "페이지가 그리지 않는 컴포넌트가 고지를 들고 있다",
    ).toEqual([]);
  });

  it("그 컴포넌트가 고지 값을 JSX 로 내보낸다", () => {
    const notRendered = DISCLOSURES.filter((d: (typeof DISCLOSURES)[number]) => {
      const source = components.get(d.owner);
      return !source || !rendersValue(source, d.key);
    });
    expect(
      notRendered.map(
        (d: (typeof DISCLOSURES)[number]) =>
          `${d.owner} 가 ${d.key} 를 그리지 않는다 — ${d.why}`,
      ),
      "카피에만 있고 화면에 없는 고지",
    ).toEqual([]);
  });

  it("배열 고지를 카피 배열에서 통째로 그린다", () => {
    // `availableNow.map` 을 `[].map` 으로 바꿔 카드 6장을 없애도 통과했었다(2026-08-27).
    // 지금은 고지가 카드 **안**에 살아서 우회 갈래가 더 늘었다. 그래서 넷을 함께 본다:
    //   (1) 그 배열을 돌고 (2) 그 필드를 내보내고 (3) 빈 배열이 아니고 (4) 자르지 않는다.
    const broken: string[] = [];
    for (const { array, field, owner, why } of ITEM_DISCLOSURES) {
      const source = components.get(owner);
      if (!source) {
        broken.push(`${owner} 파일이 없다 (${array}[].${field}) — ${why}`);
        continue;
      }
      if (!mapsOverArray(source, array)) {
        broken.push(`${owner} 가 ${array} 를 .map 으로 돌지 않는다 — ${why}`);
      }
      if (!new RegExp(`\\{\\s*[A-Za-z_$][\\w$]*\\.${field}\\s*\\}`, "u").test(source)) {
        broken.push(`${owner} 가 항목의 ${field} 를 그리지 않는다 — ${why}`);
      }
      if (/\[\s*\]\s*\.map\(/u.test(source)) {
        broken.push(`${owner} 가 빈 배열에서 그린다 — ${why}`);
      }
      // `.slice(0, 1)` 로 잘라내면 뒤쪽 카드가 진 고지가 화면에서 조용히 사라진다.
      if (new RegExp(`${escapePath(array)}\\s*\\.slice\\(`, "u").test(source)) {
        broken.push(`${owner} 가 ${array} 를 잘라서 그린다 — ${why}`);
      }
    }
    expect([...new Set(broken)], "배열 고지가 화면에 안 나간다").toEqual([]);
  });

  it("고지를 그리는 자리가 꺼져 있지 않다", () => {
    const off: string[] = [];
    for (const { key, owner, why } of DISCLOSURES) {
      const source = components.get(owner);
      if (!source) continue;
      const reason = switchedOff(source, leaf(key));
      if (reason) off.push(`${owner}: ${key} 가 ${reason} — ${why}`);
    }
    for (const { array, field, owner, why } of ITEM_DISCLOSURES) {
      const source = components.get(owner);
      if (!source) continue;
      const reason = switchedOff(source, field);
      if (reason) off.push(`${owner}: ${array}[].${field} 가 ${reason} — ${why}`);
    }
    expect([...new Set(off)], "꺼져 있는 고지").toEqual([]);
  });

  it("고지의 주인이 실제로 그 파일 하나뿐이다", () => {
    // 다른 파일에 참조만 남겨 두고 진짜 렌더를 지우는 우회가 있었다
    // (장식 파일에 아무도 부르지 않는 컴포넌트를 만들어 참조만 넣었다).
    // 주인 외의 파일이 같은 값을 그리면 어느 쪽이 화면인지 알 수 없으므로 막는다.
    const strays: string[] = [];
    for (const { key, owner } of DISCLOSURES) {
      for (const [file, source] of components) {
        if (file === owner) continue;
        // 다른 섹션이 우연히 같은 이름의 키를 쓸 수 있으므로 블록까지 붙은 표기만 본다.
        if (new RegExp(`\\{\\s*${escapePath(key)}\\s*\\}`, "u").test(source)) {
          strays.push(`${file} 도 ${key} 를 그린다 (주인은 ${owner})`);
        }
      }
    }
    for (const { array, owner } of ITEM_DISCLOSURES) {
      for (const [file, source] of components) {
        if (file === owner) continue;
        if (new RegExp(`${escapePath(array)}\\.map\\(`, "u").test(source)) {
          strays.push(`${file} 도 ${array} 를 그린다 (주인은 ${owner})`);
        }
      }
    }
    expect([...new Set(strays)], "고지를 두 곳에서 그린다").toEqual([]);
  });

  it("카피의 고지가 고아로 남지 않는다", () => {
    // 개편으로 섹션이 없어지면 그 섹션이 그리던 값만 카피에 남는다. 그러면 아무도
    // 안 읽는 문장을 우리가 "고지했다" 고 착각한다 — 2026-08-29 개편에서 실제로
    // `confirm.sampleNote` 가 그렇게 됐다(위 KNOWN_UNRENDERED 참고).
    const orphans = DISCLOSURE_COPY_KEYS.filter((key: string) => {
      for (const [, source] of components) {
        if (rendersValue(source, key)) return false;
      }
      return true;
    });
    const unexpected = orphans.filter((key: string) => !KNOWN_UNRENDERED.includes(key));
    expect(unexpected, "카피에만 있고 아무도 그리지 않는 고지").toEqual([]);
  });

  it("화면에 '베타' 라는 틀이 없다", () => {
    // 2026-08-29 파운더 결정: 베타를 하지 않는다. "계정 베타 · 사전등록 · 베타 신청 ·
    // 승인 대기" 를 화면에서 쓰지 않는다(CLAUDE.md). 이 단언만 **없는지**를 묻는다 —
    // 옛 카피를 옮겨 적다 되살아나는 것을 막는 자리다.
    //
    // 없어진 것은 틀이지 고지가 아니다: "향후 이용 비용은 아직 정해지지 않았고,
    // 계정을 만들어도 지금은 결제를 요청하지 않아요" 는 계속 참이라
    // `confirm.note`·`closing.note` 에서 그대로 지킨다(위 DISCLOSURES).
    //
    // 주석은 `rendered`/`everyLandingComponent` 가 벗겨 낸다 — 왜 걷어냈는지 적은
    // 주석까지 위반으로 세면 기록을 남길 수 없다.
    const banned = /베타|사전\s*등록|승인\s*대기/u;
    const hits: string[] = [];
    if (banned.test(rendered(CONTENT_PATH))) hits.push("landingContent.ts");
    for (const [file, source] of components) {
      if (banned.test(source)) hits.push(file);
    }
    expect(hits, "베타 틀이 화면 카피에 남아 있다").toEqual([]);
  });
});
