// @vitest-environment node

import { describe, expect, it } from "vitest";

import { headerNav, landingContent } from "@/components/landing/redesign/landingContent";

import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  rendered,
  renderedSections,
} from "./landingSource";

/**
 * 랜딩이 약속한 결과에 근거가 붙어 있는지 본다.
 *
 * ## 2026-08-29 재조준 — 정본 시안으로 다시 지은 랜딩
 *
 * 랜딩이 정본 시안(`docs/landing/NotebookBest.html`)으로 다시 지어지면서 섹션
 * 구성이 통째로 바뀌었다. **단언을 지운 게 아니라 같은 고지가 옮겨 간 자리로 옮겨
 * 달았다.** 어디로 갔는지:
 *
 *   ScenesSection(점수·궁합 금지)      → availableNow.cards[/wedding-code].note
 *   NoSideSection(AI 고지·편 안 듦)    → amoraNote.note · boundaries.items[2] · footer.notice
 *   OneRoomSection(이어짐)             → confirm.body2(파트너 알림) — 시간축 장면은 없어졌다
 *   PrivateLaneSection(저장·개인정보)  → amoraNote.note · availableNow.cards[0].note · 푸터 정책 링크
 *   NotForVendorsSection(업체 편 아님)  → boundaries.items[0] · [1]
 *   PriceCompareSection(공시 가격)      → availableNow.cards[/price] + footer.notice
 *   CommunityBridge/availableNow 여섯째 → CommunitySection(제품 계약의 둘째 축, 전용 섹션)
 *
 * export 도 바뀌었다. 최상위 `availableNow` 는 `landingContent.availableNow` 안으로
 * 들어갔고 `footerLinks` 는 `landingContent.footer.columns` 가 됐다. 값을 정확히
 * 짚어야 하는 자리(카드 하나의 note, 정책 묶음 하나)는 계속 **실제 값**을 읽는다.
 *
 * ## 2026-08-29 지운 것 — 지킬 대상이 정말 없어진 것만
 *
 * - **베타 묶음**(`footerLinks.beta`, "계정 베타"·"사전등록" 문구). 2026-08-29 파운더
 *   결정으로 베타를 안 한다. 그래서 "베타가 있어야 한다"는 단언을 지우고, 반대로
 *   **베타 틀이 화면에 없다**를 `CONTRACT_REVERSALS` 가 지키게 했다.
 *   같이 없애지 않은 것: "향후 이용 비용은 아직 정해지지 않았고, 계정을 만들어도
 *   지금은 결제를 요청하지 않아요" — 베타라서가 아니라 **오늘 참이라서** 남는다.
 *   그 고지는 아래 confirm/closing 단언이 계속 진다.
 * - **"함께 보는 자리 / 나만 보는 자리" 두 칸 카드**. 랜딩에서 개념 자체가 사라졌다
 *   (배우자 화면 노출 여부를 랜딩이 더 이상 말하지 않는다). 남은 계약 — 저장된다는
 *   고지와 개인정보처리방침으로 가는 길 — 은 각각 amoraNote.note 와 푸터 정책 묶음이
 *   지고, 아래에서 그 두 자리를 검사한다. 뒤집는 문장(배우자에게도 보여준다)은
 *   `CONTRACT_REVERSALS` 가 계속 막는다.
 * - **화요일 밤 / 수요일 아침 장면**. 시간축 카드가 없어졌다. "혼자 쓴 게 상대에게
 *   이어진다"는 약속은 confirm.body2(한 분이 확인하면 반영되고 상대에게 알림)가 진다.
 *
 * ## 2026-08-27 적대적 검증 — 이 파일로 빠져나간 변형들 (그대로 유효하다)
 *
 * 재조준 직후 변형 215개를 심었더니 62개가 그냥 통과했다. 이 파일이 놓친 것:
 *
 * 1. **주석이 코드 대신 대답했다.** 이 파일이 갖고 있던 `withoutComments` 복사본은
 *    줄 **처음**의 `//` 만 지웠다. 그래서 `body: "중립 문장", // 확인한 변경만 …`
 *    처럼 줄 끝 주석에 정본을 남기면 카피를 갈아엎어도 통과했고,
 *    `{/* {confirm.body} *␣/}` 로 렌더를 꺼도 렌더 검사가 주석에 대답했다.
 *    → 복사본을 지우고 `landingSource.stripComments` 를 쓴다. 그 스캐너는
 *      문자열·템플릿 리터럴을 알기 때문에 `"https://…"` 를 다치게 하지 않는다.
 * 2. **자리를 안 봤다.** 필수 문장을 파일 전체 `toContain` 으로 확인해서, 히어로의
 *    문장을 `footer.tagline` 으로 옮겨도 통과했다. → `contentBlock(...)` 으로
 *    **그 문장이 있어야 할 블록**에서 찾는다. 경계를 못 찾으면 던진다.
 * 3. **덧붙임을 못 막았다.** 계약 문장을 그대로 두고 뒤에 "급할 때는 확인을
 *    건너뛰고 바로 반영할 수도 있어요" 를 붙여도 33/33 초록이었다. 제품 계약
 *    (아모라는 사용자 확인 없이 아무것도 바꾸지 않는다)을 정면으로 뒤집는데.
 *    → 있어야 할 것뿐 아니라 **있으면 안 되는 것**(`CONTRACT_REVERSALS`)도 센다.
 * 4. **정규식이 좁았다.** `/기억(해|한|하)/` 라 "기억으로" 가 통과했다.
 *    → 랜딩 카피에 `기억` 이라는 낱말 자체를 금지한다(오늘 0건이다).
 * 5. **렌더가 아니라 내용만 봤다.** 카피에 문장이 남아 있으면 그것을 그리는 `<p>`
 *    를 지워도, 푸터 링크를 전부 `href="#"` 로 바꿔도 통과했다. → 카피에 있는가 +
 *    **그 값을 화면이 실제로 쓰는가** + **그 컴포넌트를 page.tsx 가 그리는가** 셋을
 *    함께 본다.
 * 6. **page.tsx 에서 섹션 셋을 지워도 통과했다.** 헤더 내비 4개 중 3개가 죽은
 *    앵커가 됐는데 아무도 울지 않았다. → 앵커가 **렌더되는** 섹션 id 를 가리키는지
 *    센다. 헤더가 정본(`headerNav`)을 버리고 자기 목록을 드는 것도 함께 막는다.
 *
 * ## 왜 소스 텍스트와 import 를 둘 다 쓰나
 *
 * - `contentBlock`/`rendered` (소스 텍스트): 블록에 **새로 덧붙은 문장**까지 본다.
 *   `landingContent.confirm.body` 만 읽으면 누가 `body3` 를 만들어 계약을 뒤집어도
 *   못 본다.
 * - `import` (실제 값): 배열 원소 하나의 자리를 정확히 짚는다. 예컨대 "웨딩코드
 *   카드의 note" 는 파일을 잘라서는 정확히 못 짚는다 — 잘못 자르면 이웃 카드가
 *   대신 대답한다.
 */

/** 랜딩 컴포넌트 한 개의 **주석 벗긴** 소스. */
const componentSource = (file: string) =>
  rendered(`src/components/landing/redesign/${file}`);

/**
 * 문자열 이어붙이기 이음매를 없앤 산문.
 *
 * 카피는 `"앞 문장 " + "뒷 문장"` 으로 줄을 나눠 적는다. 문장 단위로 묻는 검사에
 * 원문을 그대로 넣으면, 계약을 뒤집는 문장을 두 줄로 쪼개는 것만으로 빠져나간다.
 */
const prose = (text: string) =>
  text
    .replace(/"\s*\+\s*"/gu, "")
    .replace(/\\n/gu, " ")
    .replace(/\s+/gu, " ");

const contentProse = prose(rendered(CONTENT_PATH));

/**
 * 카피 블록. **경계 이름이 곧 정본 순서다** — 2026-08-29 구조에 맞춰 다시 짰다.
 * 경계를 못 찾으면 `contentBlock` 이 던진다(조용히 넓어지지 않는다).
 */
const block = {
  amoraNote: prose(contentBlock("amoraNote", "noSide")),
  community: prose(contentBlock("community", "photoBand")),
  availableNow: prose(contentBlock("availableNow", "community")),
  confirm: prose(contentBlock("confirm", "availableNow")),
  boundaries: prose(contentBlock("boundaries", "closing")),
  closing: prose(contentBlock("closing", "footer")),
  footer: prose(contentBlock("footer", "headerNav")),
  headerNav: contentBlock("headerNav", "headerAuth"),
} as const;

const sections = renderedSections();

/**
 * 배열 원소 하나를 정확히 짚어야 하는 자리만 실제 값을 읽는다.
 *
 * `as const` 튜플을 그대로 `.find` 하면 원소 타입이 유니온이라 `.some` 이 막힌다.
 * 읽기 전용 배열로 한 번 넓혀서 받는다 — 값은 그대로다.
 */
type CopyLink = { readonly label: string; readonly href: string };

const nowCards: ReadonlyArray<{
  readonly no: string;
  readonly title: string;
  readonly body: string;
  readonly note: string;
  readonly href: string;
}> = landingContent.availableNow.cards;

const footerColumns: ReadonlyArray<{
  readonly heading: string;
  readonly links: ReadonlyArray<CopyLink>;
}> = landingContent.footer.columns;

/** href 로 카드를 짚는다. 순번으로 짚으면 카드 하나만 끼워 넣어도 이웃이 대신 대답한다. */
const nowCard = (href: string) => nowCards.find((card) => card.href === href);

/**
 * 이 컴포넌트를 page.tsx 가 실제로 그리는가.
 *
 * 카피와 컴포넌트만 보면, page.tsx 에서 `<ConfirmSection />` 을 지워도 이 파일의
 * 단언이 전부 초록이었다(2026-08-27 실제 변형).
 */
const expectRenderedOnLanding = (file: string) => {
  const name = file.replace(/\.tsx$/u, "");
  expect(sections, `${name} 을 랜딩이 더 이상 그리지 않는다`).toContain(name);
};

/**
 * 카피 값이 화면에 **그대로 꽂혀 있는가**.
 *
 * `{confirm.body}` 를 지워도 카피 파일에 문장이 남아 있으면 통과했다. 주석을 벗긴
 * 소스에서 찾으므로 `{/* {confirm.body} *␣/}` 로는 통과하지 못한다.
 */
const expectRendersCopy = (file: string, expression: string) => {
  const source = componentSource(file);
  expect(source, `${file} 가 ${expression} 를 화면에 그리지 않는다`).toContain(
    `{${expression}}`,
  );
};

/** 컴포넌트가 정본 카피에서 값을 받아오는가(자기 문장을 지어내지 않는가). */
const expectReadsCanonicalCopy = (file: string, key: string) => {
  const source = componentSource(file);
  expect(source, `${file} 가 landingContent 를 읽지 않는다`).toContain(
    './landingContent"',
  );
  expect(source, `${file} 가 정본 ${key} 대신 자기 문장을 들고 있다`).toMatch(
    new RegExp(String.raw`const \{\s*${key}(?::\s*\w+)?\s*\}\s*=\s*landingContent`, "u"),
  );
};

/**
 * 랜딩 어디에도 있으면 안 되는 것.
 *
 * "있어야 할 문장"만 세면 덧붙임을 못 막는다. 계약 문장을 그대로 두고 뒤에 뒤집는
 * 문장을 붙이는 변형이 2026-08-27에 전부 통과했다.
 */
const CONTRACT_REVERSALS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /확인[^.]{0,14}(없이|안\s*받고|건너뛰|생략)/u,
    "확인 없이 반영한다는 문장 — 제품 계약(사용자 확인 없이 아무것도 바꾸지 않는다) 정면 위반",
  ],
  [
    /(자동으로|알아서|묻지\s*않고|물어보지\s*않고)[^.]{0,10}(반영|적용|저장|바꿔|변경)/u,
    "사용자 확인 없는 자동 반영",
  ],
  [/승인\s*없이/u, "승인 없이 반영한다는 문장"],
  [
    /두\s*분이\s*각각\s*(확인|승인)/u,
    "2026-08-23에 폐지된 두 사람 승인 — 이제 거짓이다. 정본 시안이 이 문장을 갖고 있으니 시안에서 옮겨 적을 때 특히 조심한다",
  ],
  [
    /기억/u,
    "장기기억 약속 — 기억 엔진은 오늘 켤 수 없고(운영 env가 끈다), 이어지는 것은 대화 기록이지 모델의 기억이 아니다",
  ],
  [/한 대화에서/u, "한 번의 확인에 여러 변경을 묶는 옛 그림"],
  [/말에서 세 가지 초안을 찾고/u, "한꺼번에 반영하던 옛 카피"],
  [/무엇이 바뀌는지 먼저 봐요\./u, "걷어낸 중복 단계"],
  [/체험 대화|로그인 없는 체험|무료 체험/u, "되돌린 방향의 체험 잔재"],
  [
    /(가입|로그인|계정)[^.]{0,25}(없이|않아도|않고)[^.]{0,25}아모라/u,
    "비로그인 아모라 — #245로 닫혔다. 정본 시안의 첫 버튼('가입 없이 물어보기')이 이 갈래다",
  ],
  [
    /아모라(?![^.]{0,25}가입 후, 웨딩코드는 가입 없이)[^.]{0,25}(가입|로그인|계정)[^.]{0,25}(없이|않아도|않고)/u,
    "비로그인 아모라 — 어순만 바꾼 같은 약속",
  ],
  [
    /(절대|결코)[^.]{0,8}저장하지\s*않/u,
    "지킬 수 없는 저장 부인 — 대화는 서비스에서 처리·저장된다",
  ],
  [/암호화|완전히?\s*안전/u, "검증하지 않은 보안 단정"],
  [
    /배우자[^.]{0,10}(에게도|에도)[^.]{0,12}(보여|공유|표시|전달)/u,
    "나만 보는 자리를 뒤집는 문장 — 두 칸 카드는 없어졌지만 약속을 뒤집는 문장은 여전히 거짓이다",
  ],
  [/업계 종사자/u, "운영에서 거의 안 붙는 작성자 배지를 앞세운다"],
  [
    /커뮤니티는 아직 운영 공개 전이에요\.|운영 공개 전|공개할 때 구분할 출처/u,
    "커뮤니티가 닫혔다는 옛 문장 — 이미 열려 있고 로그인 없이 읽힌다",
  ],
  // 2026-08-29 파운더 결정: **베타를 안 한다.** 파운더 원문 "베타 우리 안할거야 알아둬".
  // 옛 랜딩은 "계정 베타"·"사전등록" 틀을 갖고 있었고 이 파일은 그 틀이 **있어야 한다**고
  // 단언했다. 방향이 뒤집혔으므로 단언을 지우는 대신 부호를 뒤집는다 — 되살아나면 운다.
  [
    /계정\s*베타|베타\s*(신청|참여|테스터|이용|기간)|사전\s*등록|사전등록|대기\s*명단|승인\s*대기/u,
    "2026-08-29에 없앤 베타 틀 — 계정은 그냥 만들 수 있는 것이고 기능은 그냥 있는 기능이다",
  ],
];

describe("landing product outcome evidence", () => {
  it("shows how one confirmed change reaches the preparation records", () => {
    expectRenderedOnLanding("ConfirmSection.tsx");
    expectReadsCanonicalCopy("ConfirmSection.tsx", "confirm");

    // 이 섹션의 존재 이유. **confirm 블록 안에서** 찾는다 — 파일 전체 `toContain` 이던
    // 시절에는 이 문장을 footer.tagline 으로 옮겨도 통과했다.
    //
    // 2026-08-29: 시안 문장이 "…, 눌러서 확인한 것만 준비 기록에 반영해요." 로 바뀌었다.
    // 옛 단언은 "확인한 **변경**만" 이었다. 낱말이 아니라 계약("확인한 것만 반영")을
    // 재도록 두 조각으로 나눠 묻는다.
    expect(block.confirm).toContain("저장 전에 바뀔 내용과 저장 위치를 직접 확인하면 예산·할 일·일정에 남길 수 있어요");
    expect(block.confirm).toContain("저장을 확인하기 전에는 기록이 바뀌지 않아요");

    // 목적지 셋. 옛 랜딩은 "우리 예산 / 우리 할 일 / 우리 일정" 카드 셋으로 보여줬고
    // 지금은 한 문장 안에서 셋을 함께 부른다. 어느 쪽이든 셋 다 이름이 불려야
    // 사용자가 확인 버튼이 무엇을 건드리는지 안다.
    expect(landingContent.confirm.tools.map((tool) => tool.title), "변경이 도착하는 곳 셋의 이름이 사라졌다")
      .toEqual(["예산", "할 일", "일정"]);

    // 2026-08-23 파운더 결정(두 사람 승인 폐지)의 **현재 사실**. 한 사람이 확인하면
    // 반영되고 상대에게 알림이 간다. 알림 문구는 CLAUDE.md 가 정한 그것이다.
    expect(block.confirm, "한 사람의 저장이 공동 기록에 반영된다는 설명이 사라졌다").toContain(
      "두 사람 중 한 명이 저장하면 공동 기록에 반영돼요",
    );
    expect(block.confirm, "파트너 알림이 사라졌다").toContain("파트너도 앱에서 변경 알림을 볼 수 있어요");

    // 2026-08-29 파운더 결정: 베타 틀은 없애되 **이 고지는 남긴다.** 베타라서가 아니라
    // 오늘 참이라서다 — 이용 방법과 비용이 아직 정해지지 않았고 결제를 요청하지 않는다.
    expect(block.confirm, "현재 무료라는 시점과 향후 요금 미정 고지가 사라졌다").toContain(
      "향후 이용 비용은 아직 정해지지 않았고, 계정을 만들어도 지금은 결제를 요청하지 않아요.",
    );

    // 반영될 것이 화면에 그대로 보인다. 2026-09-03 시안으로 카드가 "제안 한 건(금액)"
    // 에서 **"아모라가 이렇게 이해했어요" 세 줄**로 바뀌었다 — 값이 아니라 상태(확정·
    // 미정·다음)를 보여 준다. 지키는 것은 같다: 무엇이 반영될지가 눌리기 전에 보인다.
    expect(block.confirm).toContain("결혼식장 예산을 1,000만 원으로 설정");
    expect(block.confirm).toContain("저장 전");

    // "아직 반영 전"이라는 말과 [확인]·[나중에] 두 버튼이 함께 있어야, 확인 전에는
    // 아무 일도 일어나지 않는다는 약속이 글이 아니라 그림으로도 보인다. 옛
    // `PreparationResult`의 "제안마다 따로 확인"이 여기로 옮겨 왔다.
    // (2026-08-29: 시안이 쉼표를 가운뎃점으로 바꿨다. 표기가 아니라 뜻을 재도록
    //  "아모라의 제안"과 "아직 반영 전"을 따로 묻는다.)
    expect(block.confirm).toContain("저장할 내용을 확인해 주세요");
    expect(block.confirm).toContain("저장 전");
    // 2026-09-03 시안이 버튼을 둘에서 셋으로 바꿨다("맞아요"·"수정하기"·"지금은 저장 안 함").
    // 고를 수 있는 길이 늘어난 것이고, **아무것도 안 하는 길**이 여전히 있다는 것이 계약이다.
    expect(block.confirm).toContain('confirm: "확인하고 저장"');
    expect(block.confirm).toContain('later: "저장하지 않기"');
    // 옛 카피의 "확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요" 는
    // 컴포넌트가 직접 든 이 한 줄로 옮겨졌다. 카드 **안에** 있어야 그림과 붙는다.
    expectRendersCopy("ConfirmSection.tsx", "confirm.sample.contract");

    // 위 문장들이 **화면에 꽂혀 있는가**. 카피만 보던 시절에는 이 <p> 들을 지워도
    // 통과했다. 샘플 카드 조각까지 하나씩 센다 — [확인]·[나중에] 중 하나만 지우면
    // "확인 전에는 그대로"라는 그림이 무너진다.
    for (const expression of [
      "confirm.lede",
      "confirm.body2",
      "confirm.note",
      // 2026-09-03 시안으로 카드가 "제안 한 건(금액)" 에서 **"이해한 것 세 줄"** 로
      // 바뀌었다. 키 이름이 갈렸지 그리는 자리가 준 것이 아니다 — 아래 열이 새 이름이고,
      // `rows` 는 배열이라 `.map` 으로 확인한다(바로 아래).
      "confirm.sample.saidLabel",
      "confirm.sample.state",
      "confirm.sample.cardTitle",
      "confirm.sample.contract",
      "confirm.sample.confirm",
      "confirm.sample.later",
    ]) {
      expectRendersCopy("ConfirmSection.tsx", expression);
    }
    expect(componentSource("ConfirmSection.tsx"), "이해한 것 세 줄을 정본 배열에서 돌지 않는다")
      .toContain("confirm.sample.rows.map(");
    expect(landingContent.confirm.management.map((tool) => tool.href)).toEqual([
      "/wedding/budget", "/wedding/checklist", "/wedding/schedule", "/wedding/chat/board",
    ]);
    expect(componentSource("ConfirmSection.tsx"), "관리 도구 네 개를 정본 배열에서 돌지 않는다")
      .toContain("confirm.management.map(");

    // 이 카드는 **지어낸 금액**("우리 총예산은 3,000만 원으로 정했어" · "총예산 3,000만원")을
    // 보여 준다. 실제 이용 현황으로 읽히면 안 되고, 그래서 카피에 `sampleNote` 가 있다.
    // 고지는 **같은 카드 안**에 있어야 한다 — 바깥으로 빼면 카드만 캡처됐을 때 떨어져
    // 나간다(옛 OneRoomSection 이 같은 이유로 카드 안에 들고 있었다).
    //
    // ⚠️ **2026-08-29 현재 이 단언은 빨갛다. 테스트가 아니라 화면이 틀렸다.**
    // `confirm.sampleNote` 는 카피에 있는데 `ConfirmSection.tsx` 가 한 번도 그리지
    // 않는다(저장소 전체에서 참조 1건 = 카피 정의뿐). 그래서 지어낸 금액이 고지 없이
    // 화면에 있다. 고치는 곳은 컴포넌트다 — 카드 안 마지막 <p> 로 한 줄 내면 된다.
    // 이 단언을 지우면 그 순간 화면이 샘플을 실제처럼 보여 주게 된다.
    expect(block.confirm, "샘플 고지 문장이 카피에서 사라졌다").toContain(
      "금액은 예시이며, 이 화면에서는 저장할 수 없어요",
    );
    expectRendersCopy("ConfirmSection.tsx", "confirm.sampleNote");

    // 없어진 단언 ①: "드레스숍 3곳 예약 문의"·"10월 17일 오후 2시" 같은 기록 예시
    // 묶음(`preparationRecords`)은 2026-08-27에 통째로 사라졌다. 세 목적지를 세 카드로
    // 보여주던 섹션 자체가 없어졌고, 지금은 확인 카드 하나가 예산 예시 하나만 든다.
    // 없어진 단언 ②: 옛 도입 문구 "계정을 만들면 이어지는 정리 방식"도 같이 사라졌다.
    // 약속(하나씩 제안·확인)은 위 단언들이 계속 지킨다.
    //
    // 옛 그림("한 대화에서" 한꺼번에 반영)이 되살아나는 것은
    // `CONTRACT_REVERSALS` 가 랜딩 전체에서 막는다.
  });

  it("keeps the AI notice and the sample notice where Amora first speaks", () => {
    // 2026-08-27 변형: 아모라 소개 자리의 AI 고지를 지워도, 다른 섹션의 같은 문장이
    // 파일 전체 검사에 대신 대답해서 통과했다. 고지는 **아모라를 처음 소개하는
    // 자리**에 있어야 의미가 있다.
    //
    // 2026-08-29: 그 자리가 NoSideSection → AmoraNoteSection 으로 바뀌었다.
    // 랜딩에서 아모라가 처음 말하는 카드이고, 고지는 그 카드 안에 있다.
    expectRenderedOnLanding("AmoraNoteSection.tsx");
    expectReadsCanonicalCopy("AmoraNoteSection.tsx", "amoraNote");

    // AI 기본법 고지. 옛 문장은 "아모라 답변은 AI가 만든 내용이에요" 였고 그 말은
    // 지금 푸터 고지가 든다(아래 푸터 검사). 소개 자리는 시안 문구를 쓴다.
    expect(block.amoraNote, "아모라 소개 자리에서 AI 고지가 사라졌다").toContain(
      "아모라 · AI 생성",
    );
    expect(block.boundaries, "AI가 틀릴 수 있다는 말이 사라졌다").toContain(
      "AI 답변에는 오류가 있을 수 있어요",
    );
    // 틀릴 수 있다고만 하고 끝내면 사용자가 무엇을 해야 하는지 모른다. 옛 카피와 같이
    // **다시 확인할 대상**을 이름으로 부른다.
    expect(block.boundaries, "무엇을 다시 확인해야 하는지가 사라졌다").toContain(
      "계약 금액·취소 조건·중요 날짜는 원문과 업체 안내를 다시 확인해 주세요",
    );

    // 옛 `PrivateLaneSection.note` 의 저장 고지가 여기로 왔다. 이 카드의 대화는
    // 지어낸 것이고 **이 화면에서는 저장되지 않는다** — 그 둘을 카드 안에서 말한다.
    expect(block.amoraNote, "샘플 고지가 사라졌다 — 실제 이용 현황으로 읽힌다").toContain(
      "기능을 설명하는 예시 대화예요",
    );
    expect(block.amoraNote, "이 화면에서 저장되지 않는다는 고지가 사라졌다").toContain(
      "이 화면에서는 대화하거나 저장할 수 없어요",
    );

    expectRendersCopy("AmoraNoteSection.tsx", "amoraNote.note");
    // 2026-09-03: 노트 한 장이 대화 카드가 됐다 — 물음과 답의 키 이름이 바뀌었다.
    expectRendersCopy("AmoraNoteSection.tsx", "amoraNote.chat.me");
    expectRendersCopy("AmoraNoteSection.tsx", "amoraNote.chat.amora");
  });

  it("keeps the vendor-neutral boundaries and the AI label the product is required to show", () => {
    // 옛 NotForVendorsSection 의 계약("업체 편이 아니다")과 그 안의 AI 고지가
    // BoundariesSection 으로 옮겨 왔다. 옛 커뮤니티 카드의 두 약속(광고 표시 ·
    // AI 답변 구분)도 여기로 합쳐졌다.
    expectRenderedOnLanding("BoundariesSection.tsx");
    expectReadsCanonicalCopy("BoundariesSection.tsx", "boundaries");

    // 업체 편이 아니라는 **유일한 증거**는 안 하는 것들이다.
    // (`lib/ai/amoraVoice.ts` 의 중립 계약과 CLAUDE.md 의 점수·등급 금지.)
    expect(block.boundaries, "업체에 점수·등급을 안 매긴다는 계약이 사라졌다").toContain(
      "업체에 점수·등급·순위를 매기지 않아요",
    );
    expect(block.boundaries, "공시 문장을 요약하지 않는다는 계약이 사라졌다").toContain(
      "공시 가격과 규정은 요약하지 않고 원문으로 제공해요",
    );
    // 옛 커뮤니티 카드의 "광고·협찬 글에는 출처 표시가 붙고" 가 여기로 왔다.
    // 오늘 사실은 더 강하다 — 광고 상품 자체를 운영하지 않는다.
    expect(block.boundaries, "광고에 대한 입장이 사라졌다").toContain(
      "광고 상품은 운영하지 않아요",
    );
    // 2026-08-18 파운더 결정으로 계약 해석·판정을 전부 걷어냈다(contractShield 삭제).
    expect(block.boundaries, "계약 해석을 하지 않는다는 계약이 사라졌다").toContain(
      "계약 조건을 해석하거나 유불리를 판단하지 않아요",
    );
    expect(block.boundaries, "중개하지 않는다는 문장이 사라졌다").toContain(
      "업체 계약 신청·예약·결제를 중개하지 않아요",
    );
    // AI 고지 — 옛 커뮤니티 카드의 "AI가 단 답변은 사람 답변과 구분해서 보여줘요" 자리.
    expect(block.boundaries, "AI 표시 약속이 사라졌다").toContain(
      "아모라의 답변은 AI가 작성해요",
    );

    for (const expression of ["item.title", "item.note", "boundaries.title"]) {
      expectRendersCopy("BoundariesSection.tsx", expression);
    }
    const boundaries = componentSource("BoundariesSection.tsx");
    expect(boundaries, "경계 목록을 정본 배열에서 돌지 않는다").toContain("boundaries.items.map(");
    expect(boundaries, "AI 정책 링크가 정본 href 를 쓰지 않는다").toContain(
      "href={boundaries.policyLink.href}",
    );
    expect(landingContent.boundaries.policyLink.href, "AI 정책으로 가는 길이 바뀌었다").toBe(
      "/ai-policy",
    );
  });

  it("keeps the editorial story in the intended order", () => {
    // 현재 흐름: 공동 준비 결과 → 확인과 저장 → 아모라 대화 → 의견 차이 → 공개 도구.
    //
    // `landing.indexOf("<X />")` 로 묻던 시절에는 주석으로 꺼 놓은 섹션이 렌더된
    // 것으로 잡혔다. `renderedSections()` 는 주석을 벗기고 <main> 안만 센다.
    const order = [
      "TransformationHero",
      "AmoraNoteSection",
      "NoSideSection",
      "ConfirmSection",
      "AvailableNowSection",
      "PhotoBandSection",
      "LandingFaqSection",
      "BoundariesSection",
      "ClosingAction",
    ];

    let previous = -1;
    for (const tag of order) {
      const index = sections.indexOf(tag);
      expect(index, `${tag} 가 랜딩에서 사라졌다`).toBeGreaterThanOrEqual(0);
      expect(index, `${tag} 의 자리가 앞으로 당겨졌다`).toBeGreaterThan(previous);
      previous = index;
    }

    // 부분집합만 보면 사이에 아무거나 끼워 넣어도 통과한다. 열 개가 이 순서로
    // **전부**여야 한다 — 섹션을 늘리거나 줄이는 건 이 목록을 같이 고칠 일이다.
    expect(sections, "랜딩이 그리는 섹션 목록이 정본 순서와 다르다").toEqual(order);

    // 이름은 태그일 뿐이다. 같은 이름으로 다른 것을 가져오면 이 파일의 단언 전부가
    // 엉뚱한 파일을 검사하게 된다.
    const page = rendered("src/app/landing/page.tsx");
    for (const name of order) {
      expect(page, `${name} 을 랜딩 컴포넌트 폴더 밖에서 가져온다`).toContain(
        `import ${name} from "@/components/landing/redesign/${name}"`,
      );
    }

    // 공동 준비 기록 예시가 히어로에 있으므로, 확인 계약을 바로 뒤에 설명한다.
    expect(
      sections.indexOf("ConfirmSection"),
      "아모라 가치와 우선순위 뒤에 관리와 확인 계약이 이어지지 않는다",
    ).toBe(sections.indexOf("NoSideSection") + 1);
    // 부가 도구가 제품 계약의 축보다 앞서면 안 된다.
    //    2026-08-28에 실제로 공시 위약금 비교가 메인 자리를 차지했고 파운더가
    //    "메인 기능을 소개해야지" 로 바로잡았다.
    // 2026-09-03: 시안이 무료 도구를 커뮤니티 **앞**에 둔다. 막으려던 것은 부가 도구가
    // **제품의 중심**(아모라·확인)보다 앞서는 것이었고 — 2026-08-28에 실제로 그랬다 —
    // 그건 그대로 막는다. 커뮤니티와의 앞뒤는 그 사고와 무관하다.
    expect(
      sections.indexOf("AvailableNowSection"),
      "부가 도구가 제품 계약의 축(확인)보다 앞으로 갔다 — 2026-08-28에 실제로 그랬다",
    ).toBeGreaterThan(sections.indexOf("ConfirmSection"));
  });

  it("keeps every header anchor pointing at a section the page actually renders", () => {
    // 2026-08-27 변형: page.tsx 에서 섹션 셋을 지우면 헤더 내비가 눌러도 아무 일이
    // 없는 죽은 앵커가 되는데, 33개 단언이 전부 초록이었다.
    const header = componentSource("LandingHeader.tsx");

    // 헤더가 정본을 버리고 자기 목록을 들면 안 된다. 주석에 'headerNav' 만 남기는
    // 우회는 주석을 벗겼으므로 통하지 않는다.
    expect(header, "헤더가 정본 headerNav 를 읽지 않는다").toContain('from "./landingContent"');
    expect(header, "헤더가 headerNav 를 돌지 않는다").toContain("headerNav.map(");
    expect(header, "모바일 메뉴가 헤더와 다른 목록을 받는다").toContain("items={headerNav}");
    expect(
      header.match(/href="#[^"]*"/gu),
      "헤더가 정본 밖 앵커를 직접 들고 있다",
    ).toBeNull();

    // 정본 앵커를 소스에서 읽는다(주석에 적힌 앵커는 이미 벗겨졌다).
    const anchors = [...block.headerNav.matchAll(/href:\s*"#([A-Za-z0-9_-]+)"/gu)].map(
      (match) => match[1],
    );
    expect(anchors, "headerNav 에서 앵커를 하나도 읽지 못했다").toEqual(
      headerNav.filter((item) => item.href.startsWith("#")).map((item) => item.href.slice(1)),
    );
    // 하한은 **정본 시안의 헤더 항목 수**다. 넷이던 시절의 하한(4)을 그대로 두면
    // 세 항목짜리 지금 헤더에서 뜻 없이 빨개진다. 뜻은 "내비가 비지 않았다" 다.
    expect(anchors.length, "헤더 내비가 비었다").toBeGreaterThanOrEqual(3);

    // 앵커는 `notebook.Section` 이 id 를 실제로 요소에 다는 것에 기댄다. 그 한 줄이
    // 사라지면 섹션마다 id="…" 를 적어 놔도 내비가 한꺼번에 죽는다.
    expect(
      componentSource("notebook.tsx"),
      "Section 이 받은 id 를 요소에 달지 않는다 — 앵커가 전부 죽는다",
    ).toContain("id={id}");

    // ⚠️ **2026-08-29 현재 `#price` 에서 이 검사가 빨갛다. 테스트가 아니라 헤더가
    // 틀렸다.** 공시 가격은 파운더 결정으로 전용 섹션에서 `availableNow` 카드 한 장으로
    // 내려갔는데(커밋 10be0b8cc) 헤더 내비의 `{ label: "공시 가격", href: "#price" }`
    // 가 따라오지 않았다. `id="price"` 를 가진 요소가 저장소에 0개다 — 누르면 아무 일도
    // 일어나지 않는다. 고치는 곳은 `landingContent.headerNav` 다(앵커를 `#now` 로
    // 합치거나 라우트 `/price` 로 바꾼다). 이 루프를 느슨하게 만들면 죽은 내비가
    // 그대로 출시된다 — 이 검사가 존재하는 이유가 바로 그 사고다.
    const owners = everyLandingComponent().map(
      ([file, source]) => [file.replace(/\.tsx$/u, ""), source] as const,
    );

    let previousPosition = -1;
    for (const anchor of anchors) {
      // `id="now"` 를 직접 단 섹션과, notebook.Section 에 `id="confirm"` 으로 넘긴
      // 섹션 둘 다 잡아야 한다 — 뒤쪽은 `<Section id="confirm"` 꼴이다.
      const owning = owners
        .filter(([, source]) => source.includes(`id="${anchor}"`))
        .map(([name]) => name);
      expect(
        owning,
        `#${anchor} 를 가진 섹션이 랜딩에 없다 — 헤더에서 누르면 아무 일도 일어나지 않는다`,
      ).not.toEqual([]);

      const positions = owning
        .map((name) => sections.indexOf(name))
        .filter((index) => index >= 0);
      expect(
        positions,
        `#${anchor} 는 랜딩이 그리지 않는 섹션을 가리킨다 — 눌러도 아무 일이 없다`,
      ).not.toEqual([]);

      // 헤더 주석의 계약: "내비 항목은 본문 섹션 순서와 같아야 한다."
      const position = Math.min(...positions);
      expect(position, `#${anchor} 가 본문 순서보다 앞뒤가 뒤집혔다`).toBeGreaterThan(
        previousPosition,
      );
      previousPosition = position;
    }
  });

  it("does not promote the dormant community on the landing page", () => {
    expect(landingContent.community.visible).toBe(false);
    expect(sections).not.toContain("CommunitySection");
    const page = rendered("src/app/landing/page.tsx");
    expect(page).not.toContain("<CommunitySection");
    expect(footerColumns.flatMap((column) => column.links).map((link) => link.href))
      .not.toContain("/wedding");
    expect(headerNav.map((link) => link.href)).not.toContain("/wedding");
  });

  it("keeps what works without an account honest about its limits", () => {
    // 옛 ScenesSection · PriceCompareSection · PrivateLaneSection 이 지고 있던 고지
    // 셋이 전부 이 섹션의 카드 note 로 내려왔다. 카드 하나의 자리는 파일을 잘라서
    // 못 짚는다 — 잘못 자르면 이웃 카드가 대신 대답한다. 그래서 실제 배열에서
    // **href 로** 카드를 찾아 그 카드 안에서만 묻는다.
    expectRenderedOnLanding("AvailableNowSection.tsx");
    expectReadsCanonicalCopy("AvailableNowSection.tsx", "availableNow");

    // ① 웨딩코드 — CLAUDE.md 가 요구하는 고지다. 점수·궁합·관계 예측 금지.
    //    옛 `scenes.note` 가 이 자리로 왔다. 지우면 화면이 금지된 약속을 하게 된다.
    const weddingCode = nowCard("/wedding-code");
    expect(weddingCode, "웨딩코드 카드(/wedding-code)가 사라졌다").toBeDefined();
    expect(weddingCode?.note, "점수·궁합 금지 고지가 웨딩코드 카드에서 사라졌다").toContain(
      "심리 진단이나 궁합 검사가 아니에요",
    );
    expect(weddingCode?.note, "공유 링크에 답이 담긴다는 경고가 사라졌다").toContain(
      "함께 보기에 동의하면 답 전체가 담긴 링크를 직접 전달해요",
    );
    expect(weddingCode?.note).toContain("답은 서버에 저장하지 않으며 전달한 링크는 회수할 수 없어요");

    // ② 견적 점검 — 옛 `privateLane.note` 의 저장 고지가 여기로도 왔다.
    //    로그인 없이 넣은 견적을 저장하지 않는다는 것은 오늘 참이고, 값의 적정성을
    //    판정하지 않는다는 것은 CLAUDE.md 의 금지다.
    const quoteCheck = nowCard("/wedding/community/quote-check");
    expect(quoteCheck, "견적 점검 카드가 사라졌다").toBeDefined();
    expect(quoteCheck?.note, "비로그인 견적을 저장하지 않는다는 고지가 사라졌다").toContain(
      "가입 없이 선택한 내용은 저장하지 않아요",
    );
    expect(quoteCheck?.note, "적정성을 판정하지 않는다는 계약이 사라졌다").toContain(
      "가격의 적정 여부는 평가하지 않아요",
    );

    // ③ 공시 가격 — 옛 PriceCompareSection 이 통째로 진 자리다. 파운더가 "부가 기능"
    //    으로 내렸으므로 전용 섹션이 아니라 카드 한 장이지만, **출처·기준일·판정 금지**
    //    는 카드 안에 남아야 한다(요약본만 보고 계약하면 안 된다).
    const price = nowCard("/price");
    expect(price, "공시 가격 카드(/price)가 사라졌다").toBeDefined();
    expect(price?.body, "공시 자료의 출처가 카드에서 사라졌다").toContain("한국소비자원");
    expect(price?.body, "원문을 볼 수 있다는 약속이 사라졌다").toContain("원문을 확인할 수 있어요");
    expect(price?.note, "공시 기준 시점이 카드에서 사라졌다").toMatch(/2025년 11월/u);
    expect(price?.note, "판정·요약 금지가 카드에서 사라졌다").toContain(
      "가격과 규정은 요약하지 않고 원문으로 제공하며, 가격의 적정 여부는 평가하지 않아요",
    );

    // 카드의 조각이 다 화면에 꽂혀 있어야 한다. note 를 그리는 <span> 을 지우면
    // 위 고지 전부가 카피 파일에만 남는다.
    for (const expression of ["card.title", "card.body", "card.note", "card.no"]) {
      expectRendersCopy("AvailableNowSection.tsx", expression);
    }
    const section = componentSource("AvailableNowSection.tsx");
    expect(section, "카드 목록을 정본 배열에서 돌지 않는다").toContain("availableNow.cards.map(");
    expect(section, "카드 링크가 정본 href 를 쓰지 않는다").toContain("href={card.href}");

    // 개수는 손으로 적지 않는다 — 카드 수와 어긋난 진술이 1초 만에 반증된 적이 있다.
    //
    // 2026-08-29: 옛 검사는 `{availableNow.length}` 라는 **표기**를 찾았고, 카피 블록
    // 전체에서 숫자+단위를 금지했다. 지금 카드 note 에도 참인 숫자가 있다
    // ("9~12개 확인 항목"). 그래서 뜻을 재도록 **제목과 눈썹 문구** 에서만 손으로 적은
    // 개수를 막는다 — 카드를 하나 지웠을 때 거짓이 되는 자리다.
    //
    // 업체 수(406·829·831)는 여기서 예로 들지 않는다. 랜딩은 그 셋을 쓰지 않기로 했고
    // (`countLabelsSayWhatTheyCount.test.ts`), 주석에 적어 두면 다음 사람이 되돌린다.
    const heading = `${landingContent.availableNow.eyebrow} ${landingContent.availableNow.title}`;
    expect(heading, "카드 개수를 제목에 손으로 박았다 — 카드가 늘거나 줄면 거짓이 된다").not.toMatch(
      /\d+\s*(가지|개|곳)|[한두세네다섯여섯일곱여덟아홉열]\s*가지/u,
    );

    // 카드 아래 한 줄이 "로그인 없이 열린다"고 말하는 대상은 **오늘 정말 그런 것**
    // 뿐이어야 한다. 시안은 여기에 "아모라 대화도 로그인 없이" 를 적었는데 그 경로는
    // 2026-08-27에 닫혔다. (문장 자체는 `CONTRACT_REVERSALS` 가 막는다.)
    expect(landingContent.availableNow.cards.map((card) => card.href)).toEqual([
      "/wedding/community/quote-check", "/wedding-code", "/price", "/wedding/manners",
    ]);
  });

  it("keeps the price source and its limits in the footer notice", () => {
    // 2026-08-27 변형: 푸터 고지에서만 출처를 지워도, 다른 카드의 "한국소비자원"이
    // 대신 대답해서 통과했다. 출처·기준일·지역 편차는 **고지문 안에** 있어야 한다.
    const footer = componentSource("LandingFooter.tsx");

    expect(block.footer, "가격 출처가 푸터 고지에서 사라졌다").toContain("한국소비자원 참가격");
    expect(block.footer, "공시 기준 시점이 사라졌다").toMatch(/2025년 11월/u);
    expect(block.footer, "표시 금액의 한계 설명이 사라졌다").toContain(
      "실제 계약가와 다를 수 있어요",
    );
    // 지역 편차를 안 적으면 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다.
    expect(block.footer, "지역 편차 문장이 사라졌다").toContain("지역별 등록 업체 수가 달라요");
    expect(block.footer, "예약·결제·계약의 주체가 사라졌다").toContain(
      "예약·결제·계약은 업체와 직접 진행해 주세요",
    );

    expectRendersCopy("LandingFooter.tsx", "footer.notice");
    expectRendersCopy("LandingFooter.tsx", "footer.tagline");
    expect(footer, "저작권 표시가 화면에서 사라졌다").toContain("{footer.copyright}");
  });

  it("keeps the privacy policy reachable from the landing page", () => {
    // 옛 SharedPrivateSection·PrivateLaneSection 은 섹션 안에 `/privacy` 링크를 들고
    // 있었다. 그 두 섹션은 없어졌고 링크는 푸터의 정책 묶음으로 내려갔다. 자리는
    // 바뀌어도 페이지에서 사라지면 안 된다 — 저장된다는 고지 옆에는 원문으로 가는
    // 길이 있어야 한다.
    //
    // **정책 묶음 안에서** 찾는다. 파일 전체로 물으면 "로그인 없이" 묶음에 옮겨 놔도
    // 통과한다. 묶음은 제목이 아니라 **구성**으로 짚는다 — 제목은 카피라 바뀐다.
    const policy = footerColumns.find((column) =>
      column.links.some((link) => link.href === "/privacy"),
    );
    expect(policy, "푸터 어디에도 개인정보처리방침이 없다").toBeDefined();
    expect(
      policy?.links.map((link) => link.href),
      "개인정보처리방침이 이용약관·AI 정책과 다른 묶음에 떨어져 있다",
    ).toEqual(expect.arrayContaining(["/terms", "/privacy", "/ai-policy"]));
    expect(
      policy?.links.find((link) => link.href === "/privacy")?.label,
      "개인정보처리방침의 이름이 바뀌었다",
    ).toBe("개인정보처리방침");

    const footer = componentSource("LandingFooter.tsx");
    expect(footer, "푸터가 정본 열 묶음을 렌더하지 않는다").toContain("footer.columns.map(");
    expect(footer, "푸터 링크가 href 를 정본에서 받지 않는다").toContain("href={item.href}");
    expect(footer, "푸터가 링크 라벨을 그리지 않는다").toContain("{item.label}");

    // 링크가 아무 데도 가지 않으면 있으나 마나다 — 전부 `href="#"` 로 바꿔도 통과했다.
    expect(footerColumns.length, "푸터 열이 비었다").toBeGreaterThanOrEqual(3);
    for (const column of footerColumns) {
      expect(column.links.length, `푸터 묶음 "${column.heading}" 이 비었다`).toBeGreaterThan(0);
      for (const link of column.links) {
        expect(link.href, `푸터 링크 "${link.label}" 가 아무 데도 가지 않는다`).toMatch(
          /^(\/[^\s#]*|mailto:[^\s]+)$/u,
        );
      }
    }

    // 없어진 단언: `footerLinks.beta` 묶음. 2026-08-29 파운더 결정으로 베타를 안 하고
    // `/beta` 페이지도 지웠다 — 지킬 대상이 없다. 되살아나면 `CONTRACT_REVERSALS` 가 운다.
    // 없어진 단언: "저장한 아모라 답변은 저장함에서 다시 볼 수 있어요"는 저장함이
    // 랜딩 카피에서 사라지면서 지킬 대상이 없어졌다(저장소 전체에서 이 문장 0건).
  });

  it("never lets a reversing sentence sit next to the contract it breaks", () => {
    // 3번 구멍. 계약 문장을 그대로 두고 뒤에 뒤집는 문장을 붙이는 변형이 전부
    // 통과했었다. 가장 위험했던 실례: 확인 계약 뒤의
    // "급할 때는 확인을 건너뛰고 바로 반영할 수도 있어요".
    //
    // 카피 한 곳만 보면 컴포넌트에 하드코딩한 문장으로 빠져나가므로, 카피와 랜딩
    // 컴포넌트 **전부**를 같은 자로 잰다. 컴포넌트 목록은 폴더를 읽어서 만든다 —
    // 손으로 적은 목록은 새로 생긴 파일을 놓친다.
    const surfaces: Array<[string, string]> = [
      [CONTENT_PATH, contentProse],
      ...everyLandingComponent().map(
        ([file, source]) => [file, prose(source)] as [string, string],
      ),
      ["app/landing/page.tsx", prose(rendered("src/app/landing/page.tsx"))],
    ];

    expect(surfaces.length, "훑을 랜딩 표면이 너무 적다 — 폴더를 못 읽었다").toBeGreaterThan(10);

    for (const [name, text] of surfaces) {
      for (const [pattern, why] of CONTRACT_REVERSALS) {
        expect(text, `${name}: ${why}`).not.toMatch(pattern);
      }
    }
  });
});
