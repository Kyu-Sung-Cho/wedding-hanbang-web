// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  CURRENT_WEDDING_CODE_SCENE_CONFIG,
  weddingCodeSceneCountLabel,
} from "@/lib/weddingCode/scene/config";
import { landingContent } from "@/components/landing/redesign/landingContent";
import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
} from "./landingSource";

/**
 * "지금 가입 없이 되는 것"(`availableNow`) 섹션의 계약.
 *
 * 이 섹션은 랜딩에서 유일하게 **오늘 쓸 수 있는 것**을 약속한다. 그래서 여기 실린
 * 경로가 로그인 뒤로 숨거나 사라지면 그 즉시 거짓말이 된다. 소스 텍스트로 막을 수
 * 있는 것만 여기서 막고, "실제로 로그인 없이 200이 나오는가"는 브라우저 QA
 * (`scripts/landing-a11y-qa.mjs`와 같은 계열)로 확인한다 — 정적 검사로는 증명할 수
 * 없는 성질이다.
 *
 * 전수 조사(2026-08-06)에서 아모라 도구 36개 중 상당수가 기능 플래그·게이트로
 * 막혀 있었고, 검증기가 97건 중 31건의 가용성 주장을 정정했다. 코드에 있다는 것과
 * 오늘 쓸 수 있다는 것은 다르다.
 *
 * ## 2026-08-29 개편 — 이 파일이 붙잡던 자리가 통째로 움직였다
 *
 * 랜딩이 정본 시안(`docs/landing/NotebookBest.html`)으로 다시 지어지면서:
 *
 * - `availableNow` 가 **최상위 export 가 아니라** `landingContent.availableNow` 안으로
 *   들어갔고, 항목은 `cards` 배열이 됐다. 옛 경계(`export const availableNow` →
 *   `export const footerLinks`)는 둘 다 없어졌고, `indexOf` 가 -1 을 주는 바람에
 *   `slice(-1, -1)` = 빈 문자열이 되어 **모든 단언이 빈 통과할 뻔했다.** 이제 경계를
 *   못 찾으면 던지는 `contentBlock` 을 쓴다.
 * - 카드의 `cta: {}` 와 `id` 가 없어지고 `no`·`href` 로 바뀌었다.
 * - 본문이 `{availableNow.length}가지는` 으로 세던 자리가 없어졌다. 지금 화면은
 *   개수를 **아예 말하지 않는다** — 그래서 지킬 것이 "두 수가 같은가" 에서
 *   "화면이 개수를 손으로 적지 않는가" 로 좁아졌다(아래 마지막 테스트).
 * - 도우미를 자기 복사본으로 갖고 있었다. 랜딩 테스트 6개가 각자 `withoutComments`
 *   를 복사했고 **여섯 벌이 전부 같은 버그**였다(줄 끝 `//` 를 못 지움). 이제
 *   `./landingSource` 의 것만 쓴다.
 */

const content = rendered(CONTENT_PATH);
const section = rendered("src/components/landing/redesign/AvailableNowSection.tsx");
const tracker = rendered("src/components/landing/redesign/TrackedLandingLink.tsx");

/**
 * `availableNow` 블록만 잘라 본다 — 같은 파일의 다른 목록도 `note:` 를 쓴다.
 *
 * 끝 경계는 바로 다음 키인 `confirm` 이다. **경계를 못 찾으면 `contentBlock` 이
 * 던진다.** 옛 구현은 `slice` 에 -1 을 넘겨 조용히 빈 블록을 만들었고, 그러면
 * `matchAll` 이 0건을 주면서도 검사는 "통과" 한다 — 2026-08-27 에 실제로 그렇게
 * 무의미해졌다(그때는 반대로 파일 끝까지 넓어져 푸터의 `mailto:` 가 이 섹션의
 * 링크로 세어졌다).
 */
const availableNowBlock = contentBlock("availableNow", "community");

/** 카드 배열의 시작·끝. 카드와 그 바깥(이끄는 문장·꼬리 문장)을 갈라 본다. */
const CARDS_OPEN = "cards: [";
const CARDS_CLOSE = "footLead:";
const cardsStart = availableNowBlock.indexOf(CARDS_OPEN);
const cardsEnd = availableNowBlock.indexOf(CARDS_CLOSE, cardsStart);

/**
 * 카드 하나씩. `no: "01"` 로 시작하는 덩어리로 자른다.
 *
 * 카드마다 `id` 가 있던 때는 그걸로 셌다. 2026-08-29 개편이 `id` 를 없애고 테이프에
 * 찍히는 번호 `no` 를 넣었다 — 카드마다 정확히 하나 있으므로 세는 자리로 쓴다.
 */
const cardChunks = cardsStart >= 0 && cardsEnd > cardsStart
  ? availableNowBlock.slice(cardsStart, cardsEnd).split(/(?=no:\s*")/u).slice(1)
  : [];

/**
 * 섹션을 이끄는 문장과 꼬리 문장(= 카드 바깥 전부).
 *
 * 카드 본문에는 "9~12개"·"25편"·"831건" 처럼 **개수와 무관한 수**가 정상적으로 들어
 * 있어서, 둘을 한 덩어리로 세면 수량어 검사가 그것들에 걸려 넘어진다.
 */
const availableNowLead = cardsStart >= 0 && cardsEnd > cardsStart
  ? availableNowBlock.slice(0, cardsStart) + availableNowBlock.slice(cardsEnd)
  : availableNowBlock;

/** 한 카드 안에서 `note:` 부터 `href:` 사이의 문자열을 전부 이어 붙인다.
 *
 *  `note` 는 여러 줄로 `+` 이어 붙인 경우가 많다. `note:\s*"([^"]+)"` 로 한 조각만
 *  집으면 뒷조각에 있는 고지가 검사에서 사라진다 — 실제로 03 카드의 "판정하지
 *  않고" 가 둘째 조각에 있다. */
function noteOf(cardChunk: string): string {
  const from = cardChunk.indexOf("note:");
  if (from < 0) return "";
  const to = cardChunk.indexOf("href:", from);
  const region = cardChunk.slice(from, to > from ? to : undefined);
  return [...region.matchAll(/"([^"]*)"/gu)].map((m) => m[1]).join("");
}

/** 게이트로 막혀 있어 랜딩에 실으면 안 되는 영역(2026-08-06 조사). */
const GATED_SURFACES = [
  "/vendors",
  "/money",
  "/bookings",
  "/community/cohort",
  "/wedding-court",
];

describe("landing available-now section", () => {
  it("renders on the landing before the last call to action", () => {
    // 렌더되는 섹션만 순서대로 받는다. 주석을 안 벗기고 세면 `{/* <Foo /> */}` 처럼
    // 꺼 놓은 섹션이 렌더된 것으로 잡혀 순서 검사가 빈 통과한다(이 저장소에서
    // 실제로 세 단언이 그렇게 무의미해졌다).
    const sections = renderedSections();
    expect(sections, "AvailableNowSection 이 랜딩에서 렌더되지 않는다")
      .toContain("AvailableNowSection");
    expect(sections, "마무리 섹션을 찾지 못했다").toContain("ClosingAction");

    // 원래 이 단언은 `<PreparationResult />`(계정 베타 결과 미리보기)보다 **앞**일 것을
    // 요구했다. 그 컴포넌트는 2026-08-27 개편으로 삭제됐고, 2026-08-29 개편은 계정을
    // 설명하는 `<ConfirmSection />` 을 오히려 앞에 둔다(page.tsx 의 섹션 순서 주석이
    // 그 이유를 적어 뒀다 — 마무리는 "빈손으로 나가지 않게" 마지막 행동 직전에 둔다).
    //
    // 그래서 지키는 대상을 "계정 베타보다 앞"에서 **"마지막 행동을 부르기 전"**으로
    // 옮긴다. 의도는 같다: 처음 온 사람이 오늘 쓸 수 있는 것을 하나도 못 보고
    // 결정 앞에 서지 않게 한다. 이 목록이 마무리 뒤로 가라앉으면 실패한다.
    expect(
      sections.indexOf("AvailableNowSection"),
      "지금 되는 것이 마지막 행동보다 뒤에 오면 처음 온 사람이 빈손으로 결정한다",
    ).toBeLessThan(sections.indexOf("ClosingAction"));
  });

  it("lists only paths that were verified to open without login", () => {
    // 경계가 사라지면 `contentBlock` 이 던진다. 그래도 카드 배열 자체를 못 찾으면
    // 아래 단언들이 0건을 보고 통과할 수 있으니 여기서 먼저 막는다.
    expect(cardsStart, `availableNow 에서 "${CARDS_OPEN}" 을 찾지 못했다`)
      .toBeGreaterThanOrEqual(0);
    expect(cardsEnd, `availableNow 에서 카드 배열의 끝("${CARDS_CLOSE}")을 찾지 못했다`)
      .toBeGreaterThan(cardsStart);

    // 카드의 링크 + 꼬리 문장의 링크. 둘 다 "로그인 없이 열린다" 고 약속하는 자리다.
    const hrefs = [...availableNowBlock.matchAll(/href:\s*"([^"]+)"/gu)].map((m) => m[1]);
    expect(hrefs.length, "availableNow 항목이 없다").toBeGreaterThanOrEqual(4);

    for (const href of hrefs) {
      expect(href, "외부 링크는 이 섹션에 넣지 않는다").toMatch(/^\//u);
      for (const gated of GATED_SURFACES) {
        expect(href, `${href}는 게이트로 막힌 영역이다`).not.toContain(gated);
      }
    }

    // /community/quote-check는 307로 /wedding/... 으로 넘어간다. 리다이렉트를
    // 한 홉 태우면 첫 클릭이 느려지고 UTM도 흔들리므로 정식 경로를 쓴다.
    expect(hrefs, "리다이렉트되는 별칭 대신 정식 경로를 쓴다").not.toContain(
      "/community/quote-check",
    );
  });

  it("states an availability or storage fact on every card", () => {
    expect(cardChunks.length, "availableNow 카드를 세지 못했다").toBeGreaterThanOrEqual(4);

    for (const chunk of cardChunks) {
      const note = noteOf(chunk);
      expect(note.length, `note 가 없는 카드가 있다: ${chunk.slice(0, 40)}`)
        .toBeGreaterThan(0);
      expect(
        // "이용 전에 알아야 할 사실" 의 범위 — 넷 중 하나는 있어야 한다.
        //   ① 저장 여부           저장·기록·서버·기기
        //   ② 자료의 출처·기준일   출처·자료·공시·기준
        //   ③ 판정하지 않음       점수·등급·판정·정답·관행
        //   ④ 이용 한도           한도·무료
        // ③ 에 "정답·관행" 을 더한 것은 2026-08-29 개편 때다. 예절 가이드 카드가
        // "정답이 아니라 흔한 관행이에요 · 지역·집안마다 다릅니다" 로 같은 일을
        // 하는데 낱말이 목록에 없어 검사에 걸렸다. 지키는 것은 **낱말이 아니라
        // "이 카드가 무엇을 판정하지 않는지 먼저 말하는가"** 다.
        /저장|기록|서버|기기|출처|자료|공시|기준|점수|등급|판정|정답|관행|한도|무료/u
          .test(note),
        `이용 전에 알아야 할 사실이 없는 카드가 있다: "${note}"`,
      ).toBe(true);
    }
  });

  /**
   * 없어진 섹션들이 지고 있던 **필수 고지가 이 카드들로 옮겨 왔다.**
   *
   * 2026-08-29 개편으로 `scenes`·`privateLane`·`priceCompare` 섹션이 통째로 사라졌다.
   * 그 섹션들의 `note` 가 지고 있던 고지는 없어진 게 아니라 여기 카드 셋으로 내려왔다:
   *
   *   `scenes.note`      "점수도 궁합도 매기지 않아요"  → `/wedding-code` 카드
   *   `privateLane.note` "저장하지 않아요"              → 견적 점검 카드
   *   가격 출처·기준일                                   → `/price` 카드
   *
   * 위의 "이용 전에 알아야 할 사실" 검사는 낱말 목록이라 **이 셋을 지우고 다른
   * 낱말로 바꿔도 통과한다** — 실제로 "점수도 궁합도 매기지 않아요" 를 지워도 같은
   * 카드의 "답은 기기 안에서 계산해요" 가 대신 대답했다. 그래서 따로 못 박는다.
   * 특히 궁합·점수 금지는 CLAUDE.md 가 요구하는 고지다 — 지우면 화면이 금지된
   * 약속을 한다(WeddingCode 는 검증된 궁합 검사가 아니다).
   *
   * ## 자리가 아니라 **이 섹션이 말하는가**를 잰다
   *
   * 처음엔 카드별 `note` 에 못 박았다. 몇 분 뒤 "점수도 궁합도 매기지 않아요" 가
   * 카드 `note` 에서 섹션 꼬리 문장(`footTail`)으로 가 있는 것을 보고 이 검사가
   * 빨간불이 됐다 — 고지는 지워지지 않았는데도. (그건 같은 워크트리를 쓰는 다른
   * 세션이 자기 변형을 잠깐 남긴 것이었고 지금은 카드 `note` 로 돌아와 있다.)
   * 그래도 교훈은 남는다: 자리를 못 박으면 문장을 **옮기는** 사람이 벌을 받고,
   * 결국 검사를 지우게 된다. 카드 `note` 든 이끄는 문장이든 꼬리 문장이든
   * **이 섹션 안에서 말하기만 하면** 통과시킨다. 지우면 잡힌다.
   */
  it("carries the disclosures that moved in from the removed sections", () => {
    // ① 고지가 가리키는 도착지가 살아 있어야 한다. 카드가 없어지면 고지만 남아 뜬다.
    //
    //    **부분일치로 물으면 안 된다.** 처음엔 블록 전체에 `toContain("/wedding-code")`
    //    로 물었는데, 도착지를 `/wedding-codex` 로 바꾸는 변형이 그대로 통과했다 —
    //    바뀐 주소가 옛 주소를 부분문자열로 품기 때문이다. 카드마다 href 를 하나씩
    //    꺼내 **값으로** 대조한다.
    const cardHrefs = cardChunks.map(
      (chunk: string) => /href:\s*"([^"]+)"/u.exec(chunk)?.[1] ?? "",
    );
    for (const href of ["/wedding/community/quote-check", "/wedding-code", "/price"]) {
      expect(
        cardHrefs,
        `"${href}" 로 가는 카드가 없어졌다 — 옮겨 온 고지가 가리킬 곳이 없다`,
      ).toContain(href);
    }

    // ② 웨딩코드 — 점수·궁합으로 판정하지 않는다(CLAUDE.md 필수 고지).
    expect(availableNowBlock, "점수를 매기지 않는다는 고지가 없다").toMatch(/점수/u);
    expect(availableNowBlock, "궁합을 매기지 않는다는 고지가 없다").toMatch(/궁합/u);
    expect(availableNowBlock, "낱말만 있고 '매기지 않는다'고 말하지 않는다")
      .toMatch(/(점수|궁합)[^"]*(매기지|하지)\s*않/u);

    // ③ 견적 점검 — 로그인 없이 넣은 견적을 저장하지 않는다.
    expect(availableNowBlock, "넣은 견적을 저장하지 않는다는 고지가 없다")
      .toMatch(/저장하지\s*않/u);

    // ④ 공시 가격 — 어느 시점의 공시인지. 기준일이 없으면 "지금 값" 으로 읽힌다.
    //    푸터에도 같은 기준일이 있지만 이 블록은 `confirm` 앞에서 끊기므로
    //    푸터가 대신 대답하지 않는다.
    expect(availableNowBlock, "공시 기준일이 없다").toMatch(/\d{4}년[^·"]*공시\s*기준/u);
  });

  it("never counts these cards as an Amora start", () => {
    // 원래 이 단언은 `TrackedLandingLink` 자체를 금지했다. 이유는 **이름**이었다:
    // 그 컴포넌트가 `landing_amora_start_click` 을 쐈고, 이 카드들은 아모라를 열지
    // 않으므로 누르면 아모라 시작이 부풀려졌다.
    //
    // 2026-08-28 개편이 그 이벤트를 도착지 중립적인 `landing_cta_click` +
    // `source` 로 고쳤고, `landing_now_card` 라는 자리를 이 섹션에 내줬다. 그래서
    // **금지가 아니라 자리 이름을 지킨다** — 이 카드가 아모라·히어로·마무리의
    // 이름으로 세어지면 같은 왜곡이 다시 생긴다.
    expect(tracker, "옛 이름이 되살아나면 이 카드들이 아모라 시작으로 세어진다")
      .not.toContain("landing_amora_start_click");

    // 실제 카드 클릭의 source 경계는 TrackedLandingLink.test.tsx에서 검사한다.
    // 웨딩코드와 다른 카드의 분기를 실제로 눌러 확인하므로 JSX 표현식 모양에 기대지 않는다.

    // 원래 이 자리에는 `${secondaryLink}`(landingType.ts의 링크 레시피)를 쓰는지
    // 봤다. 2026-08-27 개편으로 공유 레시피가 `landingType.ts`에서 `notebook.tsx`로
    // 옮겨 갔고 — 지금 landingType.ts를 import하는 제품 파일은 0개다 — 링크는
    // 레시피 없이 인라인 클래스로 쓴다. 지키려던 것은 "이 섹션이 자기만의 문법을
    // 발명하지 않는다"이므로, 대상을 현재의 공유 프리미티브로 옮긴다.
    expect(section, "공유 프리미티브를 쓰지 않는다").toContain('from "./notebook"');
    // 폭(shell)·세로 리듬(band)·제목 크기(sectionTitle)·작은 글씨(noteText).
    // 이 넷이 랜딩 8개 섹션이 각자 다른 max-width 와 여백을 쓰던 것을 막는 자리다.
    for (const primitive of ["shell", "band", "sectionTitle", "noteText"]) {
      expect(section, `${primitive}을 쓰지 않고 자기 스타일을 만든다`).toContain(primitive);
    }
  });

  it("names the scene count the destination screen actually asks", () => {
    // 이 카드를 누르면 곧바로 웨딩코드 화면이 열린다. 여기 적힌 장면 수가 그 화면의
    // 문항 수와 다르면 한 클릭 만에 숫자가 달라진다 — 실제로 "열여섯"으로 적힌 채
    // 도착 화면은 "스무"였다.
    //
    // landingContent.ts는 클라이언트 컴포넌트가 import하므로 거기서 설정을 끌어오면
    // 문항 은행이 랜딩 번들에 실린다. 그래서 숫자는 손으로 적고, 대조는 여기서 한다.
    //
    // 2026-08-29 개편이 이 숫자를 **세 곳으로 흩었다**: 카드 본문("스무 장면에 각자
    // 답하면"), 마무리 문단, 푸터 링크 이름("웨딩코드 스무 장면"). 옛 검사는 카드
    // 안의 두 문장을 통째로 이름으로 집었고 그중 하나(CTA 라벨 "스무 장면 답해보기")는
    // 아예 없어졌다. 그래서 문장을 고정하는 대신 **랜딩 카피 전체에서 "N 장면" 을
    // 전부 찾아** 대조한다 — 표기가 아니라 뜻을 잰다.
    const live = weddingCodeSceneCountLabel(
      CURRENT_WEDDING_CODE_SCENE_CONFIG.questions.length,
    );

    expect(content, `라이브 설정은 ${live} 장면인데 랜딩이 그 수를 말하지 않는다`)
      .toContain(`${live} 장면`);

    // 다른 표기가 함께 남아 있으면 위 단언은 통과하면서 화면에는 두 숫자가 보인다.
    for (const other of ["열두", "열여섯", "스무", "스물네"].filter((n) => n !== live)) {
      expect(content, `옛 표기 "${other} 장면"이 남아 있다`)
        .not.toMatch(new RegExp(`${other}\\s*장면`, "u"));
    }
    // 아라비아 숫자로 적어도 같은 사고가 난다("20 장면").
    expect(content, "장면 수를 숫자로 적었다 — 라이브 설정과 어긋나도 아무도 안 잡는다")
      .not.toMatch(/\d+\s*장면/u);
  });

  it("keeps unverified claims out of every landing surface, not just this section", () => {
    // 이 검사는 `availableNow` 블록만 보고 있었다. 그래서 카드에서는 "후기"를
    // 피해 놓고 바로 옆 커뮤니티 섹션 본문에는 그대로 쓴 것이 통과해 **라이브까지
    // 나갔다**. 금지어의 이유는 카드가 아니라 랜딩 전체에 적용된다 — 랜딩에서
    // "후기"는 우리 제품에 대한 사회적 증거로 읽힌다.
    //
    // 파일 이름을 손으로 적지 않고 디렉터리를 통째로 읽는다. 새 섹션이 생길 때마다
    // 목록에 추가하는 걸 잊으면 같은 구멍이 다시 난다.
    //
    // ⚠️ `everyLandingComponent()` 는 `.tsx` 만 준다. 랜딩 카피는 전부 `.ts` 인
    // `landingContent.ts` 에 있으므로 **그 파일을 따로 더한다** — 안 더하면 이 검사가
    // 정작 카피를 한 글자도 안 본다.
    const copyOnly = [
      ...everyLandingComponent().map(([, source]: [string, string]) => source),
      content,
      rendered("src/app/landing/page.tsx"),
    ].join("\n");

    // 주석은 렌더되지 않으므로 카피가 아니다. `rendered`/`everyLandingComponent` 가
    // 이미 벗겨 준다. 벗기지 않으면 "왜 이 단어를 피했는지" 적은 설명이 스스로
    // 걸린다(이 저장소에서 네 번 반복됐다).
    const banned = ["후기", "만족도", "성공률", "1위", "최고", "보장", "절감"];
    for (const word of banned) {
      expect(copyOnly, `검증되지 않은 주장 "${word}"`).not.toContain(word);
    }

    // 2026-08-29 파운더 결정: **베타를 하지 않는다.** "계정 베타·사전등록·베타 신청·
    // 승인 대기" 라는 틀을 화면에서 쓰지 않는다. 옛 랜딩은 이 틀 위에 서 있었고
    // 지금은 걷어냈으므로, 되돌아오는 것을 여기서 막는다.
    //
    // 없어지는 것은 **틀이지 고지가 아니다.** "이용 방법과 비용은 아직 정해지지
    // 않았고, 계정을 만들어도 지금은 결제를 요청하지 않아요" 는 계속 참이라 화면에
    // 남아 있다(`landingContent.confirm.note`).
    for (const betaFrame of ["계정 베타", "사전등록", "베타 신청", "승인 대기"]) {
      expect(copyOnly, `베타 틀 "${betaFrame}" 이 화면에 돌아왔다`).not.toContain(betaFrame);
    }
  });

  /**
   * 카피가 "아래 넷"이라고 하는데 카드가 다섯 장이면 랜딩이 첫 화면부터 세는 법을
   * 틀린다(2026-08-20 실측). 위의 `>= 4` 검사는 개수가 늘어도 통과하므로 수량어를
   * 잡지 못한다. 개수와 문구를 한 곳에 묶는다.
   *
   * 이 묶는 방식이 두 번 바뀌었다.
   *
   * - 2026-08-27: 카드에 `id` 가 없어지고, 개수를 카피에 손으로 적는 대신 본문이
   *   `availableNow.length` 에서 셌다. 그래서 "카피의 수량어 == 카드 수" 대신
   *   "본문이 배열 길이로 센다" 를 지켰다.
   * - 2026-08-29: 그 문장 자체가 없어졌다. 지금 화면은 개수를 **한 번도 말하지
   *   않는다.** 그래서 지킬 것은 "두 수가 같은가" 가 아니라 **"화면이 개수를 손으로
   *   적지 않는가"** 다. 손으로 적는 순간 배열과 어긋날 수 있는 두 번째 수가 생긴다.
   *
   * 남은 손으로 적은 수가 하나 있다 — 카드 테이프의 번호 `no: "01"`. 이건 개수가
   * 아니라 자리 표시지만, 카드를 넣거나 지우면 그대로 어긋난다. 그래서 배열 순서와
   * 맞는지 함께 본다.
   */
  it("수량어가 실제 카드 수와 일치한다", () => {
    const count = cardChunks.length;
    expect(count, "availableNow 카드를 세지 못했다").toBeGreaterThanOrEqual(4);

    // ① 테이프 번호는 배열 순서를 따라간다. 카드를 지우면 "01·02·04" 가 된다.
    const numbers = cardChunks.map((chunk) => /no:\s*"([^"]+)"/u.exec(chunk)?.[1]);
    expect(numbers, "테이프 번호가 카드 순서와 어긋난다").toEqual(
      cardChunks.map((_, index: number) => String(index + 1).padStart(2, "0")),
    );

    // ② 섹션을 이끄는 문장·꼬리 문장에는 개수를 말하는 수가 없어야 한다. 카드 본문에는
    //    "9~12개"·"25편"·"831건"처럼 개수와 무관한 수가 정상적으로 들어 있으므로
    //    카드 바깥만 본다.
    expect(availableNowLead, "availableNow 를 이끄는 문장을 찾지 못했다")
      .toContain("eyebrow:");

    const wrongWords = ["하나", "둘", "셋", "넷", "다섯", "여섯", "일곱"].filter(
      (word) => new RegExp(`(?:^|[\\s"·])${word}(?:[\\s"·]|$)`, "u").test(availableNowLead),
    );
    expect(
      wrongWords,
      `카드는 ${count}장인데 카드 바깥 문장이 "${wrongWords.join(", ")}"라고 한다`,
    ).toEqual([]);
    expect(availableNowLead, "카드 바깥 문장이 개수를 숫자로 적어 두었다")
      .not.toMatch(/\d+\s*(가지|개|편|장)/u);

    // ③ 개수를 다시 말하게 된다면 반드시 배열에서 세야 한다. 리터럴로 갈아 끼우면
    //    화면이 두 개의 수를 말한다 — 그게 원래 사고였다. `{availableNow.length}가지`
    //    는 `}` 가 앞에 붙으므로 이 정규식에 걸리지 않는다.
    const handWritten = /(?:^|[^.}\w])(\d+)\s*(?:가지|개|장)/u.exec(section);
    expect(
      handWritten?.[0] ?? null,
      "본문이 개수를 손으로 적었다 — availableNow.length 에서 세야 한다",
    ).toBeNull();
  });
  it("조각을 이어 붙인 꼬리 문장에 조사가 앞말에서 떨어지지 않는다", () => {
    // 2026-08-29 라이브 실측: 화면에 이렇게 나가고 있었다.
    //
    //   "여기에 공시 가격·위약금 원문 과 커뮤니티 도 로그인 없이 열려 있어요."
    //
    // 한국어 조사 `과`·`도`가 앞말에서 떨어져 오탈자로 읽힌다. 원인은 조각 셋을 이어
    // 붙이는 자리에 공백이 두 번 들어간 것이다 — 링크 뒤 `{index === 0 ? " " : ""}`
    // 와 `footTail` 의 앞 공백.
    //
    // **어떤 검사도 이걸 못 잡았다.** 기존 검사는 조각(`footLead`·`footLinks`·
    // `footTail`)을 따로따로만 봤고, 조각은 하나하나 멀쩡했다. 그래서 여기서는
    // 컴포넌트가 조립하는 방식 그대로 이어 붙여서 **완성된 문장**을 본다.
    const { footLead, footLinks, footTail } = landingContent.availableNow;
    const assembled =
      footLead
      + footLinks.map((link, i) => (i > 0 ? "과 " : "") + link.label).join("")
      + footTail;

    // 조립기가 컴포넌트와 어긋나면 이 검사는 아무것도 안 지킨다. 그래서 컴포넌트가
    // 여전히 같은 방식으로 잇는지 먼저 본다 — 링크 뒤에 공백을 다시 넣으면 여기서 운다.
    const section = rendered("src/components/landing/redesign/AvailableNowSection.tsx");
    expect(section, "꼬리말이 정본 조각을 쓰지 않는다").toContain("availableNow.footLinks.map(");
    expect(
      /\{\s*index === 0 \?\s*" "/u.test(section),
      "링크 뒤에 공백을 다시 넣었다 — 다음 조각의 조사가 앞말에서 떨어진다",
    ).toBe(false);

    for (const particle of ["과", "와", "도", "은", "는", "이", "가"]) {
      expect(
        assembled,
        `조사 "${particle}" 가 앞말에서 떨어졌다: ${assembled}`,
      ).not.toContain(` ${particle} `);
    }
    // 문장이 실제로 조립됐는지도 본다 — 조각이 비면 위 루프는 공짜로 통과한다.
    expect(assembled.length, "꼬리 문장이 비었다").toBeGreaterThan(20);
    expect(assembled, "무료 표면을 다시 못 박는 문장이 사라졌다").toContain("로그인 없이 열려 있어요");
  });
});
