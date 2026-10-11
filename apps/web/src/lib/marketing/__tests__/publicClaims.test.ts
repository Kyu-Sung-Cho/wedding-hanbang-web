import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { landingContent } from "@/components/landing/redesign/landingContent";

import {
  APP_ROOT,
  rendered,
  renderedSections,
  source,
} from "../../../app/landing/__tests__/landingSource";

/**
 * 랜딩 카피는 `landing/page.tsx` 한 장이 아니라 `redesign/` 아래 컴포넌트와
 * `landingContent.ts`에 흩어져 있다. 목록에 파일 이름을 손으로 적으면 새 섹션이
 * 생길 때마다 조용히 검사 밖으로 빠져나간다 — 실제로 개편 뒤 랜딩 카피 전체가
 * 금지어 검사에서 빠져 있었고, page.tsx는 import 목록만 남아 통과하고 있었다.
 * 디렉터리를 통째로 읽어 새 파일이 자동으로 걸리게 한다.
 */
const LANDING_REDESIGN_PATHS = readdirSync(
  resolve(APP_ROOT, "src/components/landing/redesign"),
)
  .filter((f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test."))
  .map((f) => `src/components/landing/redesign/${f}`);

const ACTIVE_PUBLIC_PATHS = [
  "src/app/layout.tsx",
  "src/app/landing/page.tsx",
  "src/app/landing/opengraph-image.tsx",
  "src/app/demo/page.tsx",
  "src/components/customer-landing/CustomerNav.tsx",
  // 2026-08-27 랜딩 개편에서 PreparationResult·SharedPrivateSection·
  // CommunityBridgeSection·TrustEvidenceSection이 삭제됐다. 이름을 남겨 두면
  // ENOENT로 파일 전체가 수집 단계에서 죽어 금지어 검사가 통째로 사라진다.
  // 랜딩 표면은 위 `LANDING_REDESIGN_PATHS`가 디렉터리를 통째로 읽어 덮는다 —
  // landingContent·ConfirmSection 같은 개별 파일을 여기 다시 적지 않는다.
  //
  // 2026-08-29 같은 사고가 한 번 더 났다. 파운더가 베타를 안 하기로 하면서
  // `src/app/beta/page.tsx` 와 `src/components/landing/ForBetaCouples.tsx` 가
  // 삭제됐는데(`/beta` 는 next.config.ts 에서 `/landing` 으로 308) 여기 이름이
  // 남아 있어 이 파일이 **테스트 0개로** 죽었다. 지워진 표면이라 목록에서 뺀다 —
  // 대신 아래 `missingActivePaths()` 가 다음번에는 읽을 수 있는 실패를 낸다.
  "src/components/landing/CompareToHumanPlanner.tsx",
  "src/components/landing/FiveRoles.tsx",
  "src/components/landing/Footer.tsx",
  // ServicePreview·Hero·CommunityFeed는 랜딩 개편에서 삭제됐다. 검사할 표면이 없다.
  "src/components/community/ServiceCTA.tsx",
  "src/app/(community)/community/quote-check/layout.tsx",
  // 시세 화면은 살아 있지만 components/app/market-prices/* 가 라우트로 재구성됐다.
  // 죽은 경로를 지우기만 하면 이 표면의 검사가 조용히 사라지므로 살아 있는 파일로 옮긴다.
  "src/app/(community)/market-prices/page.tsx",
  "src/app/wedding/market-prices/page.tsx",
].concat(LANDING_REDESIGN_PATHS);

/** 목록에 적힌 파일 중 사라진 것. 읽기 전에 먼저 센다(위 주석의 사고 두 번). */
function missingActivePaths(): string[] {
  return ACTIVE_PUBLIC_PATHS.filter((p) => !existsSync(resolve(APP_ROOT, p)));
}

/**
 * 금지어는 **원문**에서 찾는다.
 *
 * 주석에 적힌 금지어까지 걸리는 것은 오탐이 아니라 여유분이다 — 주석에 남은 옛 카피는
 * 다음 사람이 그대로 되살리는 재료가 된다. 반대로 "있어야 한다"는 단언은 주석을 벗긴
 * 뒤에 본다(아래). 그쪽을 원문에서 보면 **화면에서 지운 문장이 줄 끝 주석으로 남아
 * 있다는 이유로 통과**한다 — 2026-08-27 적대적 검증에서 실제로 그 갈래로 빠져나갔다.
 *
 * 최상위 상수가 아니라 함수다. 상수로 두면 목록의 파일 하나가 사라졌을 때 수집
 * 단계에서 던져 **이 파일의 모든 검사가 없어진다**(2026-08-29에 실제로 그랬다).
 */
function publishedRaw(): string {
  return ACTIVE_PUBLIC_PATHS.map(source).join("\n");
}

/** 주석을 벗긴 랜딩 카피 전부. "있어야 한다"·"있으면 안 된다"를 화면 기준으로 본다. */
const LANDING_RENDERED = LANDING_REDESIGN_PATHS.map(rendered)
  .concat(rendered("src/app/landing/page.tsx"))
  .join("\n");

/**
 * 카피 정본을 **값으로** 읽는다.
 *
 * 2026-08-27 적대적 검증의 교훈은 "문장이 어느 블록에 있는지 보지 않으면 아무 note로
 * 옮겨도 통과한다"였고, 그때는 `contentBlock()` 으로 블록을 잘라 막았다. 개편 뒤에는
 * 한 걸음 더 간다 — **키 경로로 직접 읽는다**(`landingContent.confirm.body`).
 * 블록 슬라이스보다 좁고(같은 블록 안에서 옮겨 붙이는 변형까지 잡는다), 주석·줄바꿈·
 * 문자열 이어붙이기 표기에 묶이지 않는다. 키 이름이 바뀌면 타입에서 먼저 죽는다.
 *
 * 값으로 읽는 것만으로는 **화면에 나가는지**를 못 본다. 그래서 아래 검사들은 늘
 * (1) 정본 값 · (2) 그 값을 그리는 컴포넌트 · (3) 그 컴포넌트가 page.tsx에 걸려 있는지
 * 셋을 함께 본다. 하나만 보면 카피에만 있고 화면엔 없는 고지를 통과시킨다.
 */
type LandingLink = { readonly label: string; readonly href: string };

const availableNowCards: ReadonlyArray<{
  readonly title: string;
  readonly body: string;
  readonly note: string;
  readonly href: string;
}> = landingContent.availableNow.cards;

const boundaryItems: ReadonlyArray<{
  readonly title: string;
  readonly note: string;
}> = landingContent.boundaries.items;

const footerColumns: ReadonlyArray<{
  readonly heading: string;
  readonly links: readonly LandingLink[];
}> = landingContent.footer.columns;

/**
 * 카드를 **무엇에 대한 카드인지**로 찾는다.
 *
 * `cards[1]` 처럼 자리로 찾으면 카드 순서를 바꾸는 순간 엉뚱한 카드에 대고 고지를
 * 확인하면서 초록불이 난다. 목적지(`href`)로 찾는 것도 처음엔 썼다가 물렀다 —
 * 2026-08-29 작업 중에 예절 카드의 링크가 `/wedding/manners` 에서 `/start-here` 로
 * 바뀌었다. 고지가 매인 것은 **주제**(예절은 정답이 아니라 관행이다)이지 URL이 아니다.
 */
function cardTitled(titleFragment: string): (typeof availableNowCards)[number] {
  const card = availableNowCards.find((c: (typeof availableNowCards)[number]) =>
    c.title.includes(titleFragment),
  );
  if (!card) {
    throw new Error(
      `availableNow 카드 중 제목에 "${titleFragment}" 가 들어간 것이 없습니다. ` +
        `그 도구가 랜딩에서 빠졌다면 그 카드가 지던 고지가 어디로 갔는지 먼저 찾고, ` +
        `그 자리를 검사하도록 옮기세요.`,
    );
  }
  return card;
}

/** 경계 항목도 자리가 아니라 **무엇을 안 한다는 말인지**로 찾는다. */
function boundaryItem(titleFragment: string): (typeof boundaryItems)[number] {
  const item = boundaryItems.find((i: (typeof boundaryItems)[number]) =>
    i.title.includes(titleFragment),
  );
  if (!item) {
    throw new Error(
      `boundaries.items 에 "${titleFragment}" 를 말하는 항목이 없습니다. ` +
        `이 고지를 지우려면 그것이 왜 더 이상 필요 없는지부터 적으세요.`,
    );
  }
  return item;
}

describe("public marketing claim boundary", () => {
  it("keeps every listed public surface readable so the forbidden-claim scan cannot vanish", () => {
    // 사라진 파일 하나가 이 파일 전체를 죽인 적이 두 번 있다(위 목록 주석).
    // 이제는 무엇이 사라졌는지 이름으로 말한다.
    expect(
      missingActivePaths(),
      "목록에 적힌 공개 표면이 사라졌습니다. 그 표면이 지던 단언을 살아 있는 파일로 " +
        "옮긴 뒤에 목록에서 빼세요 — 이름만 지우면 그 표면의 검사도 같이 사라집니다.",
    ).toEqual([]);
  });

  it("does not publish unshipped features, invented evidence, or unapproved benefit promises", () => {
    for (const forbiddenClaim of [
      "AI 드레스 가상 피팅",
      "웨딩 플래너 없이도 완벽",
      "24시간 365일",
      "200~500만원",
      "아모라웨딩홀 후기 67건",
      "10% 이상 답변을 고정",
      "검증된 준비 가이드",
      "Contract Diff 무료 Premium",
      "종료 후 6개월 무료",
      "아모라 풀 기능",
      "완전 무료",
      "스드메 추가금 평균",
      "가격 정보 어려움",
      "추가비용 경험률",
      "서울 평균 총 비용",
      "비수기 절약액",
      "비수기 결혼 시 평균 절약 금액",
      "성수기와 비수기의 가격 차이는 약 400~500만원",
      "2026년 1월 기준 중위 가격",
      "빠진 항목과 추가금 가능성",
      "금액보다 먼저 빠진 항목",
      "숨은 비용",
      "예상 추가금",
    ]) {
      expect(publishedRaw()).not.toContain(forbiddenClaim);
    }
  });

  it("labels the demo as a non-indexed preview instead of presenting fictional proof", () => {
    // 있어야 하는 것은 주석을 벗기고 본다. 고지 문장을 지우고 주석으로 옮기면
    // 원문 검사는 통과하지만 방문자는 아무 고지도 못 본다.
    const demo = rendered("src/app/demo/page.tsx");

    // 2026-08-31: 출시일에 "현재 개발·검증 중" 이라고 말하는 페이지를 /price·예절
    // 내비가 가리키고 있었다. 파운더가 8-29 에 없애기로 한 "아직 정식이 아니다" 틀과
    // 같은 것이라 걷어냈다(`no-beta-framing-on-screen` 의 금지 목록에는 이 표현이
    // 없어 가드가 못 잡았고, 오히려 이 단언이 그 문구를 고정하고 있었다).
    //
    // 남겨야 하는 것은 **틀이 아니라 사실**이다 — 가격은 아직 정해지지 않았다.
    expect(demo).not.toContain("개발·검증 중");
    expect(demo).toContain("이용 방법과 비용은 아직 정해지지 않았고");
    expect(demo).toContain("실사용 통계나 고객 후기가 아니라");
    expect(demo).toContain("robots: { index: false, follow: false }");
    expect(source("src/app/demo/page.tsx")).not.toContain("CustomerTestimonials");
    expect(source("src/app/demo/page.tsx")).not.toContain("CustomerStats");
  });

  it("mounts every section that carries a required disclosure", () => {
    // 고지가 카피에 있고 컴포넌트가 그리더라도, 그 컴포넌트가 page.tsx에 안 걸려
    // 있으면 방문자는 아무것도 못 본다. 아래 검사들이 기대는 바닥이라 먼저 본다.
    //
    // 2026-08-28 개편에서 섹션이 통째로 갈렸다가 **2026-08-29에 넷이 돌아왔다**
    // (파운더 지적: 운영 랜딩과 비슷해야 한다). 지금 고지가 사는 자리:
    //   noSide.note      아모라를 처음 소개하는 자리의 AI 고지
    //   scenes.note      점수·궁합·성격 판정 금지
    //   oneRoom.note     지어낸 커플 대화의 샘플 표식
    //   privateLane.note 대화가 처리·저장될 수 있다는 고지
    //   amoraNote.note   아모라 카드의 AI 고지 + 샘플 표식
    //   boundaries.items 업체 편이 아니라는 넷
    // 개편 기간에 이 넷이 `amoraNote.note` 와 availableNow 카드로 임시로 옮겨 가
    // 있었고, 그 문장들은 지금도 거기 남아 있다 — 중복이지 실수가 아니다.
    // 어느 자리든 문장을 지우려면 `landingDisclosuresAreOnScreen.test.ts` 의
    // DISCLOSURES 표를 먼저 보라.
    //   priceCompare (가격 출처·기준일)                  → 공시가 카드 · footer.notice
    const sections = renderedSections();

    for (const section of [
      "AmoraNoteSection",
      "ConfirmSection",
      "AvailableNowSection",
      "BoundariesSection",
    ]) {
      expect(
        sections,
        `${section} 이 랜딩에 걸려 있지 않다 — 그 안의 고지가 화면에 없다`,
      ).toContain(section);
    }
  });

  it("states that AI changes require confirmation and never claims to act on its own", () => {
    // 랜딩이 page.tsx 한 장에서 섹션 컴포넌트로 나뉘면서 이 계약의 문장과 링크가
    // landingContent·ConfirmSection·LandingFooter로 흩어졌다.
    // page.tsx만 읽으면 구조를 바꿨다는 이유로 계약이 통과해 버린다.
    //
    // ⚠️ 2026-08-27 적대적 검증: 네 파일을 이어 붙여 `toContain` 하던 옛 형태는
    // **문장이 어느 블록에 있는지 보지 않았다.** 히어로가 지던 제품 설명 문장을
    // `footer.tagline`으로 옮겨도, 확인 계약 문장을 아무 note에 옮겨 붙여도 통과했다.
    // 그래서 이제 정본을 **키 경로로** 읽는다(위 주석).
    //
    // 문장은 2026-08-28 개편에서 다듬어졌다("확인한 변경만" → "확인한 것만").
    // 지는 계약은 그대로다: 확인한 것만 반영되고, 확인 전에는 아무것도 안 바뀐다.
    expect(landingContent.confirm.lede, "저장 전 내용과 위치 안내가 confirm.lede 에 없다").toContain(
      "저장 전에 내용과 저장 위치를 보여줘요",
    );
    expect(landingContent.confirm.lede, "저장하지 않을 선택 안내가 사라졌다").toContain(
      "다르면 다시 말하거나 저장하지 않아도 돼요",
    );
    expect(landingContent.confirm.sample.contract).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");

    // 두 사람 승인은 2026-08-23에 폐지됐다. 남은 계약은 "한 사람이 확인하면 반영되고
    // 상대에게 알림이 간다"다 — 알림 쪽을 빼면 상대 몰래 바뀌는 제품이 된다.
    expect(landingContent.confirm.body2, "파트너 알림 문장이 confirm.body2 에 없다").toContain(
      "앱에서 변경 알림을 볼 수 있어요",
    );

    // 카피에만 있고 화면에서 빠진 상태를 통과시키지 않는다 — 정본 파일 하나가
    // 대신 답한다. 그 문장을 지는 섹션이 실제로 그 값을 그리는지 따로 본다.
    const confirmSection = rendered("src/components/landing/redesign/ConfirmSection.tsx");
    expect(confirmSection).toContain("{confirm.lede}");
    expect(confirmSection).toContain("{confirm.body2}");
    expect(confirmSection).toContain("{confirm.note}");

    // "확인 전까지는 반영되지 않는다"는 옛 `confirm` 카피 문장이 지던 고지다.
    // 개편에서 그 말은 ConfirmSection의 샘플 카드 안으로 옮겨졌고, 카피가 아니라
    // **컴포넌트가 직접** 들고 있다. 카피에서 못 찾는다고 지우면 계약이 약해진다.
    expect(confirmSection, "확인 전 미반영 고지가 확인 샘플 카드에 없다").toContain(
      "{confirm.sample.contract}",
    );
    // 샘플 제안이 "아직 반영 전"이라고 카드 안에서 말한다. 이 라벨이 없으면 샘플
    // 카드가 이미 일어난 일처럼 읽힌다.
    // 2026-09-03 시안으로 카드가 "제안 한 건" 에서 "이해한 것 세 줄" 로 바뀌면서
    // 라벨 이름이 `proposeLabel` → `state` 가 됐다. **지키는 것은 그대로다.**
    expect(landingContent.confirm.sample.state, "미반영 라벨이 샘플에서 사라졌다").toContain(
      "저장 전",
    );

    // 있어야 할 것만 보면 **뒤에 뒤집는 문장을 붙이는 변형**을 못 막는다. 확인 계약을
    // 그대로 둔 채 "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요"를 덧붙인 변형이
    // 2026-08-27 검증에서 전부 초록이었다. 제품 계약(아모라는 사용자 확인 없이 아무것도
    // 바꾸지 않는다)을 정면으로 뒤집는데도 그랬다. 그래서 있으면 안 되는 것도 본다.
    //
    // 주석을 벗긴 뒤 본다 — 왜 그 문장이 거짓인지 적어 둔 주석이 스스로 걸리면
    // 다음 사람이 이 가드를 지운다.
    for (const [pattern, why] of [
      [
        /확인[^.\n]{0,12}(없이|건너뛰|생략|않아도|안 해도|안해도|안 눌러도)/u,
        "확인 없이도 반영된다는 말",
      ],
      [
        /(자동으로|알아서)[^.\n]{0,16}(반영|적용|변경|저장)/u,
        "사용자 확인 없이 아모라가 스스로 바꾼다는 말",
      ],
      // 2026-08-23 파운더 결정으로 두 사람 승인이 폐지됐다. 되살려 적으면 거짓이다.
      [/각각 확인해야/u, "폐지된 두 사람 승인"],
      // 저장 고지를 "확인한 내용만 저장"으로 바꾸면 저장 범위를 좁게 오도한다.
      [/확인한 내용만 저장/u, "저장 범위를 좁게 말하는 문장"],
    ] as Array<[RegExp, string]>) {
      expect(LANDING_RENDERED, `확인 계약을 뒤집는 문장: ${why}`).not.toMatch(pattern);
    }
  });

  it("keeps the AI, sample, and storage disclosures on the screen that shows Amora talking", () => {
    // 옛 구조에서 이 고지는 `noSide.note`(AI 고지)와 `privateLane.note`(저장 고지)로
    // 나뉘어 있었다. 개편 뒤 아모라가 랜딩에서 **처음 말하는 자리**가 AmoraNoteSection
    // 하나뿐이라, 셋(AI 생성 · 샘플 · 저장 안 됨)이 그 카드 안 한 문단으로 합쳐졌다.
    // 카드만 캡처돼도 고지가 같이 잡히도록 카드 **안**에 있는 것이 중요하다.
    const note = landingContent.amoraNote.note;

    expect(landingContent.amoraNote.chat.amoraLabel, "AI 생성물 고지가 아모라 화자에 없다")
      .toContain("AI 생성");
    expect(landingContent.boundaries.items[2].note, "AI 오류 가능성 고지가 없다")
      .toContain("AI 답변에는 오류가 있을 수 있어요");
    expect(note, "예시 표시가 아모라 카드에 없다").toContain("예시 대화");
    // privateLane.note 가 지던 저장 고지의 랜딩 몫. 이 화면의 대화는 시연이라 저장되지
    // 않는다 — 비로그인 아모라 체험이 2026-08-27에 닫혔기 때문이다.
    expect(note, "저장 고지가 아모라 카드에 없다").toContain("저장할 수 없어요");

    const amoraSection = rendered("src/components/landing/redesign/AmoraNoteSection.tsx");
    expect(amoraSection, "아모라 카드가 자기 고지를 그리지 않는다").toContain("{amoraNote.note}");
    expect(amoraSection, "아모라 카드가 AI 생성 화자 표시를 그리지 않는다")
      .toContain("{amoraNote.chat.amoraLabel}");
  });

  it("keeps the score/compatibility, storage, and price-source notes on the tool cards", () => {
    // 옛 `scenes.note`(점수·궁합 금지)·`privateLane.note`(견적 저장 안 함)·
    // `priceCompare` 전용 섹션(출처·기준일)이 전부 `availableNow` 카드 셋으로 내려왔다.
    // 파운더가 공시 가격을 "부가 기능"이라 카드 한 장으로 내린 것이라(2026-08-29),
    // 전용 섹션을 다시 찾으면 안 된다 — 고지는 카드의 작은 글씨가 진다.

    // WeddingCode는 검증된 궁합 검사가 아니다(CLAUDE.md). 이 한 줄이 그 계약이다.
    // 랜딩에서 기능을 찾을 때 쓰는 제품명으로 찾고, 기존 고지 계약은 유지한다.
    const weddingCode = cardTitled("웨딩코드");
    expect(weddingCode.note, "점수·궁합 금지 고지가 웨딩코드 카드에 없다").toContain(
      "심리 진단이나 궁합 검사가 아니에요",
    );

    // 로그인 없이 넣은 견적을 저장하지 않는다는 개인정보 고지.
    const quoteCheck = cardTitled("업체에 무엇을 물어봐야 할까요?");
    expect(quoteCheck.note, "견적 미저장 고지가 견적 카드에 없다").toContain("저장하지 않아요");
    expect(quoteCheck.note, "적정성 판정 안 한다는 고지가 견적 카드에 없다").toContain(
      "가격의 적정 여부는 평가하지 않아요",
    );

    // 가격은 한국소비자원 참가격이다. 출처와 기준일을 안 적으면 우리가 잰 값처럼 읽힌다.
    const price = cardTitled("업체 가격과 취소·환불 조건");
    expect(price.body, "가격 출처가 공시가 카드에 없다").toContain("한국소비자원");
    expect(price.note, "공시 기준일이 공시가 카드에 없다").toContain("공시 기준");
    expect(price.note, "적정성 판정 안 한다는 고지가 공시가 카드에 없다").toContain(
      "가격의 적정 여부는 평가하지 않아요",
    );

    // 예절 가이드는 "정답"이 아니다 — 관행이라는 단서를 빼면 규범을 파는 화면이 된다.
    const manners = cardTitled("상견례·예단");
    expect(manners.note, "관행 단서가 예절 카드에 없다").toContain("관행은 지역과 가족마다 달라요");

    // 카피에만 있고 화면에서 빠지는 것을 막는다.
    const nowSection = rendered("src/components/landing/redesign/AvailableNowSection.tsx");
    expect(nowSection, "카드 본문이 화면에 안 나간다").toContain("{card.body}");
    expect(nowSection, "카드 고지가 화면에 안 나간다").toContain("{card.note}");
  });

  it("keeps the not-on-the-vendor-side evidence in the boundaries section", () => {
    // 업체 경계 항목과 광고 안내는 같은 섹션에서 각각 표시한다.
    // 업체 편이 아니라는 **증거**라서 없애면 안 된다: 점수를 안 매기고, 광고를 안 받고,
    // 계약을 해석하지 않고, 예약·결제를 중개하지 않는다.
    const noRanking = boundaryItem("점수·등급·순위");
    expect(noRanking.note, "공시 원문 제공 고지가 사라졌다").toContain(
      "공시 가격과 규정은 요약하지 않고 원문으로 제공해요",
    );
    expect(landingContent.boundaries.advertisingNote, "광고 상품 없음 고지가 사라졌다").toContain(
      "현재 광고 상품은 운영하지 않아요",
    );

    // 계약 해석·판단과 중개 금지 범위를 각각 확인한다.
    const noContractReading = boundaryItem("계약 조건을 해석하거나 어느 쪽이 유리한지 판단하지 않아요");
    expect(noContractReading.note, "중개하지 않는다는 고지가 사라졌다").toContain(
      "중개하지 않아요",
    );

    // 옛 `notForVendors.aiNotice` 의 몫. AI 기본법 고지가 여기 산다.
    const aiNotice = boundaryItem("아모라의 답변은 AI가 작성해요");
    expect(aiNotice.note, "AI 오류 가능성 고지가 경계 섹션에 없다").toContain(
      "AI 답변에는 오류가 있을 수 있어요",
    );

    // 법률·의료·금융 판단을 하지 않는다는 것도 같은 묶음이다.
    expect(boundaryItem("법률·의료·금융").note, "공식 창구 안내가 사라졌다").toContain(
      "관련 기관",
    );

    const boundariesSection = rendered("src/components/landing/redesign/BoundariesSection.tsx");
    expect(boundariesSection, "경계 항목 제목이 화면에 안 나간다").toContain("{item.title}");
    expect(boundariesSection, "경계 항목 고지가 화면에 안 나간다").toContain("{item.note}");
    expect(boundariesSection, "광고 상품 안내가 화면에 안 나간다").toContain("{boundaries.advertisingNote}");
  });

  it("keeps policy links real and the price source notice in the footer", () => {
    // 정책 링크는 **한 묶음 안에** 있어야 한다. 옛 검사는 파일 어디에 있든 통과해서,
    // 정책 링크를 "로그인 없이" 묶음으로 옮겨도 몰랐다. 개편에서 `footerLinks` 가
    // `footer.columns` 로 바뀌었으므로, 이용약관이 들어 있는 **그 열**을 찾아 본다.
    const policyColumn = footerColumns.find((column: (typeof footerColumns)[number]) =>
      column.links.some((link: LandingLink) => link.href === "/terms"),
    );
    expect(policyColumn, "이용약관이 들어 있는 푸터 열이 없다").toBeDefined();

    const policyLinks: readonly LandingLink[] = policyColumn?.links ?? [];
    for (const [label, href] of [
      ["이용약관", "/terms"],
      ["개인정보처리방침", "/privacy"],
      ["AI 서비스 정책", "/ai-policy"],
    ]) {
      expect(
        policyLinks.some((link: LandingLink) => link.label === label && link.href === href),
        `정책 링크 "${label}" → ${href} 가 정책 열에 없다`,
      ).toBe(true);
    }

    // 카피의 href가 진짜 목적지로 나가는지까지 본다. 푸터가 자기 목적지를 발명하면
    // (`href="#"`) 위 단언들은 그대로 통과하면서 링크는 아무 데도 가지 않는다 —
    // 2026-08-27 적대적 검증에서 실제로 통과한 변형이다.
    const landingFooter = rendered("src/components/landing/redesign/LandingFooter.tsx");
    expect(landingFooter, "푸터가 카피의 링크 묶음을 쓰지 않는다").toContain("footer.columns");
    expect(landingFooter, "푸터가 카피의 href를 쓰지 않는다").toContain("href={item.href}");
    expect(landingFooter, "푸터가 목적지를 손으로 적었다").not.toMatch(/href="/u);

    // 공시 가격이 본문에서 카드 한 장으로 내려왔으므로 출처·기준일·한계도 푸터가 진다.
    // 지역 편차 문장을 빼면 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다.
    const notice = landingContent.footer.notice;
    expect(notice, "가격 출처가 푸터에 없다").toContain("한국소비자원 참가격");
    expect(notice, "공시 기준일이 푸터에 없다").toContain("2025년 11월 공시 기준");
    expect(notice, "지역 편차 단서가 푸터에서 사라졌다").toContain("지역별 등록 업체 수가 달라요");
    expect(landingFooter, "푸터 고지가 화면에 안 나간다").toContain("{footer.notice}");
  });

  it("says pricing is undecided without dressing it up as a beta program", () => {
    // 2026-08-29 파운더 결정: **베타를 하지 않는다.** 옛 카피는 "계정 베타"라는 틀로
    // 이 고지를 지고 있었고, 그 시절 이 파일은 `/beta` 페이지와 `ForBetaCouples.tsx` 를
    // 검사 대상으로 요구했다(둘 다 삭제됨 — 위 목록 주석). 베타를 요구하는 단언은
    // 이제 거짓을 요구하므로 지웠다.
    //
    // 없어진 것은 틀이지 고지가 아니다 — "향후 이용 비용은 아직 정해지지 않았고,
    // 계정을 만들어도 지금은 결제를 요청하지 않아요"는 베타라서가 아니라 오늘 그래서
    // 참이다. 그래서 방향을 뒤집는다: 고지는 **있어야** 하고, 베타 틀은 **없어야** 한다.
    expect(landingContent.hero.note, "주요 행동 옆의 현재 무료·요금 미정 고지가 사라졌다").toContain(
      "현재 무료이며, 향후 요금은 아직 정해지지 않았어요.",
    );
    const heroSection = rendered("src/components/landing/redesign/TransformationHero.tsx");
    expect(heroSection, "주요 행동 옆 이용 안내가 화면에 안 나간다").toContain("{hero.note}");
    const faqSection = rendered("src/components/landing/redesign/LandingFaqSection.tsx");
    expect(faqSection, "FAQ의 현재 무료·요금 미정 고지가 사라졌다").toContain(
      "현재 무료로 이용할 수 있어요. 향후 요금은 아직 정해지지 않았어요.",
    );
    expect(faqSection, "FAQ 답변이 화면에 안 나간다").toContain("{item.answer}");
    expect(landingContent.closing.note, "가입 조건 고지가 마무리에서 사라졌다").toContain(
      "아모라와 예산·할 일·일정 관리에는 가입이 필요해요",
    );

    const RETIRED_BETA_FRAMES: Array<[RegExp, string]> = [
      [/계정 베타/u, "폐지된 계정 베타 틀"],
      [/사전\s*등록/u, "없어진 사전등록 폼"],
      [/베타 신청/u, "없어진 베타 신청 행동"],
      [/승인 대기/u, "없어진 승인 대기 상태"],
    ];
    for (const [pattern, why] of RETIRED_BETA_FRAMES) {
      expect(LANDING_RENDERED, `랜딩에 남으면 안 되는 말: ${why}`).not.toMatch(pattern);
    }

    // ⚠️ 2026-08-29: 위 금지는 `LANDING_RENDERED` 만 본다. 그건 `landing/redesign`
    // 디렉터리 + `landing/page.tsx` 라서 **랜딩 밖 공개 표면은 하나도 안 덮는다.**
    // 실측으로 확인했다 — `CustomerNav` 에
    // `{ href: "#cta", label: "베타 신청", scroll: true }` 를 심고 `src/lib/marketing` ·
    // `src/app/landing` · `src/components/customer-landing` 를 전부 돌렸더니
    // **베타 문구를 잡은 검사는 0개**였다(깨진 것은 앵커 폴백 검사 하나뿐).
    //
    // 파운더 결정은 랜딩이 아니라 화면 전체에 대한 것이다(CLAUDE.md 2026-08-29:
    // "화면·문서에서 … 쓰지 않는다"). 그래서 같은 금지를 공개 표면 목록 전체에 건다.
    // `rendered()` 는 주석을 걷어내므로 왜 없앴는지 적어 둔 기록은 걸리지 않는다 —
    // 실제로 `CustomerNav` 주석에 "베타 신청" 이 남아 있고 그건 지워야 할 문구가 아니다.
    //
    // 범위를 여기까지로 두는 이유: 랜딩 밖 제품 화면은 **같은 변경에서 이미 정리했고**
    // (웹 18곳·모바일 4곳), 그 자리를 지키는 것은 이 파일이 아니라
    // `scripts/tests/no-beta-framing-on-screen.test.mjs` 다 — 웹·모바일 소스를 전부
    // 훑되 주석은 걷어낸다. 여기서는 공개 마케팅 표면의 **네 가지 틀**만 본다.
    for (const path of ACTIVE_PUBLIC_PATHS) {
      const surface = rendered(path);
      for (const [pattern, why] of RETIRED_BETA_FRAMES) {
        expect(surface, `${path} 에 남으면 안 되는 말: ${why}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the privacy policy aligned with the shipped quote analysis scope", () => {
    const privacy = rendered("src/app/privacy/page.tsx");

    expect(privacy).toContain("새 입력은 분석 응답 생성 후 별도 DB에 저장하지 않으며");
    expect(privacy).toContain("공개 결과 링크도 만들지 않습니다");
    expect(privacy).toContain("선택한 분야·항목 상태·견적 금액은 해당 통계 이벤트에 넣지 않습니다");
    // 서버 공유는 별도 동의한 함께 보기와 연구 보태기로 제한한다.
    // 연구 저장소 켜짐·꺼짐의 실제 문장은 privacy의 렌더 검사에서 확인한다.
    expect(privacy).toContain("웨딩코드: 답은 기기 안에서 계산하며 세션 녹화를 하지 않습니다");
    expect(privacy).toContain("에 별도로 동의한 경우에만 해당 기능에 필요한 답을 서버에 저장합니다");
    expect(privacy).toContain("각자 보관·공유에 동의하면 초대 생성 후 7일까지 서로의 답과 결과를 볼 수 있습니다");
    expect(privacy).toContain("고른 답·웨딩코드·공유 링크 주소는 이 통계에 넣지 않습니다");
    expect(privacy).toContain("2026년 7월 30일");

    for (const unshippedOperation of [
      "업체(파트너) 예약 시",
      "㈜ 토스페이먼츠",
      "결제 처리",
      "청첩장 정보",
      "축의금 관리 데이터",
      "견적 점검 기록(분야",
      "가격 공시 후보 내부 검토 신호",
    ]) {
      expect(source("src/app/privacy/page.tsx")).not.toContain(unshippedOperation);
    }
  });
});
