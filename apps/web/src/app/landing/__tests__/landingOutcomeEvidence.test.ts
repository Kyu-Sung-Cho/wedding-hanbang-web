// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  availableNow,
  footerLinks,
  headerNav,
} from "@/components/landing/redesign/landingContent";

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
 * ## 2026-08-27 재조준
 *
 * 랜딩 축이 공시 가격에서 "둘이 어디서 갈리는지"로 바뀌면서 이 파일이 읽던 컴포넌트
 * 넷이 사라졌다. 단언을 지운 게 아니라 **같은 약속이 옮겨 간 자리**로 옮겨 달았다.
 *
 *   PreparationResult      → ConfirmSection(#confirm) · landingContent.confirm
 *   SharedPrivateSection   → PrivateLaneSection(#private) · landingContent.privateLane
 *   ContinuitySection      → OneRoomSection(#oneroom) — 화요일 밤 말이 수요일 아침에 있다
 *   CommunityBridgeSection → availableNow 여섯째 카드(/wedding)
 *
 * 지킬 대상이 정말 없어진 단언은 조용히 지우지 않고, 왜 없어졌는지 그 자리에 적었다.
 *
 * ## 2026-08-27 적대적 검증 — 이 파일로 빠져나간 변형들
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
 * - `import` (실제 값): 배열 원소 하나의 자리를 정확히 짚는다. 예컨대 "커뮤니티
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

const block = {
  noSide: prose(contentBlock("noSide", "oneRoom")),
  oneRoom: prose(contentBlock("oneRoom", "privateLane")),
  privateLane: prose(contentBlock("privateLane", "confirm")),
  confirm: prose(contentBlock("confirm", "notForVendors")),
  availableNow: prose(contentBlock("availableNow", "closing")),
  footer: prose(contentBlock("footer", "notDoing")),
  headerNav: contentBlock("headerNav"),
} as const;

const sections = renderedSections();

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
    "2026-08-23에 폐지된 두 사람 승인 — 이제 거짓이다",
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
    "비로그인 아모라 — #245로 닫혔다",
  ],
  [
    /아모라[^.]{0,25}(가입|로그인|계정)[^.]{0,25}(없이|않아도|않고)/u,
    "비로그인 아모라 — 어순만 바꾼 같은 약속",
  ],
  [
    /(절대|결코)[^.]{0,8}저장하지\s*않/u,
    "지킬 수 없는 저장 부인 — 대화는 서비스에서 처리·저장된다",
  ],
  [/암호화|완전히?\s*안전/u, "검증하지 않은 보안 단정"],
  [
    /배우자[^.]{0,10}(에게도|에도)[^.]{0,12}(보여|공유|표시|전달)/u,
    "나만 보는 자리를 뒤집는 문장",
  ],
  [/업계 종사자/u, "운영에서 거의 안 붙는 작성자 배지를 앞세운다"],
  [
    /커뮤니티는 아직 운영 공개 전이에요\.|운영 공개 전|공개할 때 구분할 출처/u,
    "커뮤니티가 닫혔다는 옛 문장 — 이미 열려 있고 로그인 없이 읽힌다",
  ],
];

describe("landing product outcome evidence", () => {
  it("shows how one confirmed change reaches the preparation records", () => {
    expectRenderedOnLanding("ConfirmSection.tsx");
    expectReadsCanonicalCopy("ConfirmSection.tsx", "confirm");

    // 이 섹션의 존재 이유인 두 문장. `publicClaims.test.ts`가 같은 문자열을 필수
    // 문구로 들고 있으므로 글자를 바꾸면 그쪽이 먼저 깨진다.
    //
    // **confirm 블록 안에서** 찾는다. 파일 전체 `toContain` 이던 시절에는 이 문장을
    // footer.tagline 으로 옮겨도 통과했다.
    expect(block.confirm).toContain("예산·할 일·일정 중 한 번에 한 가지 변경을 제안하고");
    expect(block.confirm).toContain("확인한 변경만 준비 기록에 반영해요");
    expect(block.confirm).toContain("확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요");

    // 목적지 셋. 옛 랜딩은 "우리 예산 / 우리 할 일 / 우리 일정" 카드 셋으로 보여줬고
    // 지금은 한 문장 안에서 셋을 함께 부른다. 어느 쪽이든 셋 다 이름이 불려야
    // 사용자가 확인 버튼이 무엇을 건드리는지 안다.
    expect(block.confirm, "변경이 도착하는 곳 셋의 이름이 사라졌다").toContain("예산·할 일·일정");

    // 반영될 값이 화면에 그대로 보인다. 옛 세 기록 중 예산 하나만 남았다
    // (`preparationRecords` 배열이 사라졌다 — 아래 마지막 주석 참고).
    expect(block.confirm).toContain("총예산 3,000만원");

    // "아직 반영 전"이라는 말과 [확인]·[나중에] 두 버튼이 함께 있어야, 확인 전에는
    // 아무 일도 일어나지 않는다는 약속이 글이 아니라 그림으로도 보인다. 옛
    // `PreparationResult`의 "제안마다 따로 확인"·"한 번의 확인에는 한 가지 변경만
    // 포함돼요"가 여기로 옮겨 왔다.
    expect(block.confirm).toContain("아모라의 제안, 아직 반영 전");
    expect(block.confirm).toContain('confirm: "확인"');
    expect(block.confirm).toContain('later: "나중에"');
    expect(componentSource("ConfirmSection.tsx")).toContain(
      "확인을 누르기 전까지 예산 화면은 그대로예요.",
    );

    // 위 문장들이 **화면에 꽂혀 있는가**. 카피만 보던 시절에는 이 <p> 들을 지워도
    // 통과했다. 샘플 카드의 여섯 조각까지 하나씩 센다 — [확인]·[나중에] 중 하나만
    // 지우면 "확인 전에는 그대로"라는 그림이 무너진다.
    for (const expression of [
      "confirm.body",
      "confirm.body2",
      "confirm.note",
      "confirm.sample.saidLabel",
      "confirm.sample.said",
      "confirm.sample.proposeLabel",
      "confirm.sample.propose",
      "confirm.sample.confirm",
      "confirm.sample.later",
    ]) {
      expectRendersCopy("ConfirmSection.tsx", expression);
    }

    // 없어진 단언 ①: "드레스숍 3곳 예약 문의"·"10월 17일 오후 2시"·"예산 변경 예시"
    // 같은 기록 예시 묶음(`preparationRecords`)은 2026-08-27에 통째로 사라졌다.
    // 세 목적지를 세 카드로 보여주던 섹션 자체가 없어졌고, 지금은 확인 카드 하나가
    // 예산 예시 하나만 든다. 지킬 대상이 없어서 뺐다.
    // 없어진 단언 ②: 옛 도입 문구 "계정을 만들면 이어지는 정리 방식"·"필요한 변경을
    // 하나씩 제안하고, 확인받아요."도 같은 섹션과 함께 사라졌다. 약속(하나씩 제안·
    // 확인)은 위 세 단언이 계속 지킨다.
    //
    // 옛 그림("한 대화에서" 한꺼번에 반영)이 되살아나는 것은 이제
    // `CONTRACT_REVERSALS` 가 랜딩 전체에서 막는다.
  });

  it("keeps shared records and private conversation visibly distinct", () => {
    expectRenderedOnLanding("PrivateLaneSection.tsx");
    expectReadsCanonicalCopy("PrivateLaneSection.tsx", "privateLane");

    // 옛 이름표는 "같이 보는 우리 준비 / 파트너에게 비공개인 상담"이었다. 제품 계약이
    // 아모라 쪽 "상담"을 "대화"로, 배우자를 가리키는 "파트너"를 "배우자"로 정하면서
    // 두 이름이 바뀌었다(CLAUDE.md — 이 제품에서 파트너는 배우자될 사람이다).
    // 지키는 것은 이름이 아니라 **두 자리가 눈에 보이게 갈라져 있다**는 것이다.
    expect(block.privateLane).toContain("함께 보는 대화와 나만 보는 대화가 따로 있어요");
    expect(componentSource("PrivateLaneSection.tsx")).toContain("함께 보는 자리");
    expect(componentSource("PrivateLaneSection.tsx")).toContain("나만 보는 자리");

    // 필수 문구. "안전하다"고 단정하지 않는다 — 저장은 되고, 연결된 배우자 화면에
    // 안 보일 뿐이다. 그 이상을 약속하면 개인정보 문장이 거짓이 된다.
    expect(block.privateLane).toContain("대화 내용은 서비스에서 처리·저장될 수 있어요");
    expect(block.privateLane).toContain("연결된 배우자 화면에는 표시하지 않아요");
    expect(componentSource("PrivateLaneSection.tsx")).toContain(
      "연결된 배우자 화면에는 표시하지 않아요",
    );
    expectRendersCopy("PrivateLaneSection.tsx", "privateLane.body");
    expectRendersCopy("PrivateLaneSection.tsx", "privateLane.note");

    // 개인정보 약속 옆에는 원문으로 가는 길이 있어야 한다. 옛 SharedPrivateSection은
    // 섹션 안에 `/privacy` 링크를 들고 있었는데, 새 랜딩에서는 그 링크가 푸터의 정책
    // 묶음으로 내려갔다. 자리는 바뀌어도 페이지에서 사라지면 안 된다.
    //
    // **정책 묶음 안에서** 찾는다. 파일 전체로 물으면 `open` 묶음에 옮겨 놔도 통과한다.
    expect(footerLinks.policy, "정책 묶음에서 개인정보처리방침이 빠졌다").toContainEqual({
      label: "개인정보처리방침",
      href: "/privacy",
    });
    const footer = componentSource("LandingFooter.tsx");
    expect(footer, "푸터가 정책 링크 묶음을 렌더하지 않는다").toContain("footerLinks.policy");
    expect(footer, "푸터 링크가 href 를 정본에서 받지 않는다").toContain("href={item.href}");
    expect(footer, "푸터가 링크 라벨을 그리지 않는다").toContain("{item.label}");

    // 링크가 아무 데도 가지 않으면 있으나 마나다 — 전부 `href="#"` 로 바꿔도 통과했다.
    for (const group of [footerLinks.open, footerLinks.beta, footerLinks.policy]) {
      expect(group.length, "푸터 묶음이 비었다").toBeGreaterThan(0);
      for (const item of group) {
        expect(item.href, `푸터 링크 "${item.label}" 가 아무 데도 가지 않는다`).toMatch(
          /^(\/[^\s#]*|mailto:[^\s]+)$/u,
        );
      }
    }

    // 2026-08-06: 로그인 없는 체험 언급을 내렸다(파운더 결정: 한도 예정). 비로그인
    // 아모라가 #245로 닫힌 뒤로도 그대로 유효하다. 남은 계약은 "계정에서 분리할 수
    // 있다"는 경계 자체이고, 그 경계는 위 두 자리 카드가 진다.
    // (문구 잔재 자체는 `CONTRACT_REVERSALS` 가 랜딩 전체에서 막는다.)
    expect(componentSource("PrivateLaneSection.tsx"), "되돌린 방향의 체험 잔재").not.toContain(
      "로그인 없는 체험",
    );

    // 없어진 단언: "저장한 아모라 답변은 저장함에서 다시 볼 수 있어요"는 저장함이
    // 랜딩 카피에서 사라지면서 지킬 대상이 없어졌다(저장소 전체에서 이 문장 0건).
  });

  it("keeps the editorial story in the intended order", () => {
    // 순서에 이유가 있다(page.tsx 머리 주석). 목록을 손으로 비교하지 않고 한 줄로
    // 훑어서, 섹션이 하나 빠지거나 앞뒤가 바뀌면 어느 것인지 이름으로 알려준다.
    //
    // `landing.indexOf("<X />")` 로 묻던 시절에는 주석으로 꺼 놓은 섹션이 렌더된
    // 것으로 잡혔다. `renderedSections()` 는 주석을 벗기고 <main> 안만 센다.
    const order = [
      "TransformationHero",
      "ScenesSection",
      "NoSideSection",
      "OneRoomSection",
      "PrivateLaneSection",
      "ConfirmSection",
      "NotForVendorsSection",
      "AvailableNowSection",
      "ClosingAction",
    ];

    let previous = -1;
    for (const tag of order) {
      const index = sections.indexOf(tag);
      expect(index, `${tag} 가 랜딩에서 사라졌다`).toBeGreaterThanOrEqual(0);
      expect(index, `${tag} 의 자리가 앞으로 당겨졌다`).toBeGreaterThan(previous);
      previous = index;
    }

    // 부분집합만 보면 사이에 아무거나 끼워 넣어도 통과한다. 아홉 개가 이 순서로
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

    // 그중 하나는 특히 못 박아 둔다. ③이 "두 사람 대화가 한 덩어리"라고 말한 직후에
    // 사람들은 "그럼 내가 쓴 게 다 가나"를 걱정한다. ④가 그 걱정을 바로 받지 않으면
    // ③이 불안으로 끝난다.
    expect(
      sections.indexOf("PrivateLaneSection"),
      "나만 보는 자리가 한 방 얘기보다 앞으로 갔다",
    ).toBeGreaterThan(sections.indexOf("OneRoomSection"));
  });

  it("keeps every header anchor pointing at a section the page actually renders", () => {
    // 2026-08-27 변형: page.tsx 에서 NoSideSection·ConfirmSection·AvailableNowSection 을
    // 지우면 헤더 내비 4개 중 3개가 눌러도 아무 일이 없는 죽은 앵커가 되는데,
    // 33개 단언이 전부 초록이었다.
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
    expect(anchors.length, "헤더 내비가 비었다").toBeGreaterThanOrEqual(4);

    // 앵커는 `notebook.Section` 이 id 를 실제로 요소에 다는 것에 기댄다. 그 한 줄이
    // 사라지면 섹션마다 id="…" 를 적어 놔도 내비 넷이 한꺼번에 죽는다.
    expect(
      componentSource("notebook.tsx"),
      "Section 이 받은 id 를 요소에 달지 않는다 — 앵커가 전부 죽는다",
    ).toContain("id={id}");

    const owners = everyLandingComponent().map(
      ([file, source]) => [file.replace(/\.tsx$/u, ""), source] as const,
    );

    let previousPosition = -1;
    for (const anchor of anchors) {
      const owning = owners
        .filter(([, source]) => source.includes(`id="${anchor}"`))
        .map(([name]) => name);
      expect(owning, `#${anchor} 를 가진 섹션이 랜딩에 없다`).not.toEqual([]);

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

  it("shows why the product remains useful after the first conversation", () => {
    // 이 계약은 원래 ContinuitySection의 "오늘 정한 한 가지가, 다음 준비의 기준으로."
    // 였다. 그 섹션은 2026-08-27에 사라졌고 **같은 약속을 OneRoomSection이 시간축
    // 장면으로 진다** — 화요일 밤에 남긴 말이 수요일 아침 상대 화면에 그대로 있다.
    // 근거는 `api/chat/route.ts:1889-1905`(couple_id로 읽고 sender_id 필터가 없다).
    expectRenderedOnLanding("OneRoomSection.tsx");
    expectReadsCanonicalCopy("OneRoomSection.tsx", "oneRoom");

    expect(block.oneRoom).toContain("같은 얘기를 두 번 하지 않아도 돼요.");
    expect(block.oneRoom).toContain("다음 날 아침 상대가 열었을 때 그 대화가 그대로 있어요.");
    expectRendersCopy("OneRoomSection.tsx", "oneRoom.body");
    expectRendersCopy("OneRoomSection.tsx", "oneRoom.note");

    const oneRoom = componentSource("OneRoomSection.tsx");
    expect(oneRoom).toContain("화요일 밤, 신부");
    expect(oneRoom).toContain("수요일 아침, 신랑");
    // 시간이 지난다는 게 이 장면의 전부다. 두 시각이 그 순서로 있어야 한다.
    expect(
      oneRoom.indexOf("수요일 아침, 신랑"),
      "다음 날 아침이 화요일 밤보다 먼저 온다",
    ).toBeGreaterThan(oneRoom.indexOf("화요일 밤, 신부"));
    // 샘플이라는 고지가 같은 카드 안에 있어야 한다 — 실제 이용 현황으로 읽히면 안 된다.
    expect(oneRoom, "샘플 고지가 사라졌다").toContain(
      "이름·금액은 기능을 보여주기 위한 샘플이고 실제 이용 현황이 아니에요.",
    );

    // 확인 전에는 반영되지 않는다는 약속은 자리만 옮겼지 사라지지 않았다.
    expect(block.confirm, "확인한 변경만 남는다는 약속이 사라졌다").toContain(
      "확인한 변경만 준비 기록에 반영해요",
    );
    expect(block.confirm, "같은 약속이 확인 섹션에서도 사라졌다").toContain(
      "확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요",
    );

    // 이어짐을 약속하되 **장기기억으로 약속하지 않는다.** 기억 엔진은 오늘 켤 수 없고
    // (운영 env가 강제로 끈다), 이어지는 것은 대화 기록이지 모델의 기억이 아니다.
    // 옛 `/기억(해|한|하)/` 는 "기억으로"가 그냥 통과했다 — 낱말 자체를 막는다.
    // (랜딩 전체 검사는 `CONTRACT_REVERSALS` 가 한 번 더 한다.)
    expect(block.oneRoom, "랜딩이 장기기억을 약속한다").not.toMatch(/기억/u);
  });

  it("keeps the AI notice where Amora is first introduced", () => {
    // 2026-08-27 변형: noSide.note 의 AI 고지를 지워도, 다른 섹션(notForVendors)의
    // 같은 문장이 파일 전체 검사에 대신 대답해서 통과했다. 고지는 **아모라를 처음
    // 소개하는 자리**에 있어야 의미가 있다.
    expectRenderedOnLanding("NoSideSection.tsx");
    expectReadsCanonicalCopy("NoSideSection.tsx", "noSide");

    expect(block.noSide, "아모라 소개 자리에서 AI 고지가 사라졌다").toContain(
      "아모라 답변은 AI가 만든 내용이에요",
    );
    expect(block.noSide, "AI가 틀릴 수 있다는 말이 사라졌다").toMatch(
      /AI는 틀리거나 놓칠 수 있어요/u,
    );
    expectRendersCopy("NoSideSection.tsx", "noSide.note");

    // 편을 들지 않는다는 계약(`lib/ai/amoraVoice.ts:21-22`)도 이 자리에 있다.
    expect(block.noSide).toContain("한쪽 손을 들지 않아요");
    expectRendersCopy("NoSideSection.tsx", "noSide.body");
    expectRendersCopy("NoSideSection.tsx", "noSide.body2");
  });

  it("keeps the price source and its limits in the footer notice", () => {
    // 2026-08-27 변형: 푸터 고지에서만 출처를 지워도, 다른 카드의 "한국소비자원"이
    // 대신 대답해서 통과했다. 출처·기준일·지역 편차는 **고지문 안에** 있어야 한다.
    const footer = componentSource("LandingFooter.tsx");

    expect(block.footer, "가격 출처가 푸터 고지에서 사라졌다").toContain("한국소비자원 참가격");
    expect(block.footer, "공시 기준 시점이 사라졌다").toMatch(/2025년 11월/u);
    expect(block.footer, "확인 시점이 사라졌다").toMatch(/화면 집계 확인/u);
    expect(block.footer, "표시 금액의 한계 설명이 사라졌다").toContain(
      "실제 계약가와 다를 수 있고",
    );
    // 지역 편차를 안 적으면 사용자가 "우리 지역엔 없네"를 우리 잘못으로 읽는다.
    expect(block.footer, "지역 편차 문장이 사라졌다").toContain("지역별로 수가 크게 달라요");
    expect(block.footer, "예약·결제·계약의 주체가 사라졌다").toContain(
      "예약·결제·계약은 업체와 직접 진행합니다",
    );
    expect(block.footer, "푸터의 AI 고지가 사라졌다").toContain("아모라 답변은 AI가 만든 내용이며");

    expectRendersCopy("LandingFooter.tsx", "footer.notice");
    expectRendersCopy("LandingFooter.tsx", "footer.tagline");
    expect(footer, "저작권 표시가 화면에서 사라졌다").toContain("{footer.copyright}");
  });

  it("describes the community as it actually is, and only promises what exists", () => {
    // 이 계약은 원래 "커뮤니티는 아직 운영 공개 전"을 강제했다. 커뮤니티는 이미 열려
    // 있고 로그인 없이 읽히므로(라이브 확인) 지키는 대상을 현재 사실로 옮겨 뒀었다.
    // 2026-08-27에 CommunityBridgeSection 자체가 사라지면서, 커뮤니티는 이제
    // "가입 안 해도 되는 것들"의 여섯째 카드로만 나온다. 계약은 그대로다.
    expectRenderedOnLanding("AvailableNowSection.tsx");

    // 카드 하나의 자리는 파일을 잘라서 못 짚는다 — 잘못 자르면 이웃 카드가 대신
    // 대답한다. 그래서 실제 배열에서 그 카드를 찾아 **그 카드 안에서만** 묻는다.
    const community = availableNow.find((card) => card.cta.href === "/wedding");
    expect(community, "커뮤니티 카드(/wedding)가 사라졌다").toBeDefined();
    expect(community?.cta.label).toBe("커뮤니티 둘러보기");
    expect(community?.body).toContain("예비부부들이 실제로 올린 질문과 답변을 읽을 수 있어요.");

    // 실재하는 것만 현재형으로 약속한다 — AdDisclosureBadge·AiCommentBox. 옛 세 문장
    // ("광고·협찬 · 별도 표시", "AI 답변 · AI 생성 표시", "사람의 경험과 AI의 제안을
    // 같은 근거처럼 보여주지 않아요.")이 카드 작은 글씨 한 줄로 합쳐졌다. 약속 둘
    // (광고 표시 · AI 답변 구분)은 **그 카드 안에** 살아 있어야 한다.
    expect(community?.note, "광고 표시 약속이 커뮤니티 카드에서 사라졌다").toContain(
      "광고·협찬 글에는 출처 표시가 붙고",
    );
    expect(community?.note, "AI 답변 구분 약속이 커뮤니티 카드에서 사라졌다").toContain(
      "AI가 단 답변은 사람 답변과 구분해서 보여줘요",
    );

    // 카드의 세 조각이 다 화면에 꽂혀 있어야 한다. note 를 그리는 <p> 를 지우면
    // 위 두 약속은 카피 파일에만 남는다.
    for (const expression of ["item.title", "item.body", "item.note", "item.cta.label"]) {
      expectRendersCopy("AvailableNowSection.tsx", expression);
    }
    const section = componentSource("AvailableNowSection.tsx");
    expect(section, "카드 목록을 정본 배열에서 돌지 않는다").toContain("availableNow.map(");
    expect(section, "카드 링크가 정본 href 를 쓰지 않는다").toContain("href={item.cta.href}");
    // 개수는 손으로 적지 않는다 — 카드 수와 어긋난 진술이 1초 만에 반증된 적이 있다.
    expect(section, "카드 개수를 손으로 적었다").toContain("{availableNow.length}");
    expect(block.availableNow, "개수를 카피에 손으로 박았다").not.toMatch(
      /\d+\s*(가지|개|곳)|[한두세네다섯여섯일곱여덟아홉열]\s*가지/u,
    );

    // 닫혔다고 말하지 않는다 / 없는 것을 있다고 하지 않는다("업계 종사자" 배지는
    // 운영 최근 글이 거의 전부 `legacy_unverified` 라 앞세우면 거짓이 된다).
    // 둘 다 `CONTRACT_REVERSALS` 가 랜딩 전체에서 막는다.

    // 없어진 단언: "지금 구분해서 보여주는 것 / 아직 구분하지 않는 것" 두 칸 목록은
    // 섹션과 함께 사라졌고, 뒤 칸의 내용("일반 회원 · 업계 종사자 구분")은 사실도
    // 아니게 됐다. 되살리면 안 되는 문장이라 위 negative가 대신 지킨다.
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
