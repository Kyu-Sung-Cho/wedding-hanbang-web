import { describe, expect, it } from "vitest";


import {
  CONTENT_PATH,
  contentBlock,
  everyLandingComponent,
  landingComponentFiles,
  rendered,
  renderedSections,
  source,
  stripComments,
} from "./landingSource";

/**
 * 주석 제거기 자체를 검사한다.
 *
 * 랜딩 가드 대부분이 "이 문자열이 소스에 있나"로 묻는다. 그러면 **주석에 적힌 글자가
 * 화면 대신 대답한다.** 2026-08-27 적대적 검증에서 변형 215개 중 8개가 정확히 이
 * 갈래로 빠져나갔다 — 아래 `사례` 들이 그때 실제로 통과했던 우회다.
 *
 * 제거기가 조용히 약해지면 그 위에 선 가드 수십 개가 한꺼번에 빈 통과가 된다.
 * 그래서 여기서는 **우회를 직접 넣어 보고** 지워지는지 본다.
 *
 * 2026-08-29 정본 시안(`NotebookBest.html`)으로 랜딩을 다시 지으면서 그때 우회에
 * 쓰였던 섹션(`PrivateLaneSection`)과 카피 키(`scenes`)가 없어졌다. **사고 기록은
 * 남기고 예시 이름만 살아 있는 섹션·키로 옮겼다** — 없어진 이름을 사례로 두면 나중에
 * 누가 grep 해서 "아직 있네" 로 잘못 읽는다. 우회 갈래 자체는 그대로다.
 */
describe("stripComments", () => {
  it("줄 끝 주석을 지운다", () => {
    // 실제로 빠져나간 변형: 화면에서 지운 문장을 줄 끝 주석으로만 남겼다.
    const src = `body: "…보여드려요.", // 웨딩한방은 둘이 어디서 갈리는지부터 봅니다.`;
    expect(stripComments(src)).not.toContain("갈리는지부터 봅니다");
    expect(stripComments(src)).toContain("보여드려요.");
  });

  it("줄 처음 주석을 지운다", () => {
    expect(stripComments("  // 여기는 설명\nreal();")).not.toContain("여기는 설명");
  });

  it("블록 주석 안의 마크업을 지운다", () => {
    // 실제로 빠져나간 변형: 주석에 헤드라인 예시를 넣어 대조를 통과시켰다.
    // (원래 사례는 `{scenes.title}` 이었고, scenes 는 2026-08-29 재구성에서 없어졌다.)
    const src = `/* <h2>{boundaries.title}</h2> */\n<h2>여기는 다른 문장</h2>`;
    const out = stripComments(src);
    expect(out).not.toContain("boundaries.title");
    expect(out).toContain("여기는 다른 문장");
  });

  it("JSX 주석으로 꺼 놓은 컴포넌트를 지운다", () => {
    // 실제로 빠져나간 변형: 섹션을 꺼도 순서 검사 3개가 통과했다.
    // (원래 사례는 `<PrivateLaneSection />` 이었다. 그 섹션이 지던 개인정보·저장 고지는
    //  없어진 게 아니라 `amoraNote.note` 와 `availableNow.cards[0].note` 로 옮겨갔고,
    //  섹션을 꺼도 통과하던 이 구멍은 새 섹션에도 똑같이 열린다.)
    const src = `<main>\n  <A />\n  {/* <BoundariesSection /> */}\n  <B />\n</main>`;
    expect(stripComments(src)).not.toContain("BoundariesSection");
  });

  it("문자열 안의 // 는 건드리지 않는다", () => {
    // 옛 구현이 줄 처음만 본 이유다. 여기를 잘못 고치면 링크가 통째로 사라진다.
    for (const src of [
      `href: "https://hanbang.ai/landing"`,
      `const u = 'http://localhost:3000/'`,
      "const t = `https://hanbang.ai/${slug}`",
    ]) {
      expect(stripComments(src), src).toBe(src);
    }
  });

  it("문자열 안의 /* 도 건드리지 않는다", () => {
    const src = `const note = "형식은 /* 이렇게 */ 씁니다"`;
    expect(stripComments(src)).toBe(src);
  });

  it("주석 안의 따옴표가 뒤를 삼키지 않는다", () => {
    // 주석에 홑따옴표가 하나 있으면(예: 사용자's) 그 뒤 전부를 문자열로 오인할 수 있다.
    const src = `// 사람'이 쓴 말\nkeep("살아 있어야 한다");`;
    const out = stripComments(src);
    expect(out).toContain("살아 있어야 한다");
    expect(out).not.toContain("사람");
  });

  it("정규식 리터럴 안의 // 는 아직 못 넘긴다 — 알려진 한계다", () => {
    // 이 스캐너는 정규식 리터럴을 모른다. 나눗셈과 정규식 시작을 구분하려면
    // 앞 토큰을 봐야 해서 간단하지 않다.
    //
    // 고치지 않기로 했다면 **한계를 검사로 고정한다.** 이 단언이 어느 날 실패하면
    // 누군가 스캐너를 고친 것이고, 그때 landingSource.ts 의 경고 문구도 지워야 한다.
    const SLASH = String.fromCharCode(47);
    // `const re = /x//y/; const kept = 1;` — 정규식 안에 `//` 가 있고, **같은 줄**에
    // 코드가 이어진다. 스캐너는 `//` 부터 줄 끝까지 자르므로 뒤가 통째로 사라진다.
    const src = `const re = ${SLASH}x${SLASH}${SLASH}y${SLASH}; const kept = 1;`;
    const out = stripComments(src);
    expect(out, "정규식을 넘기게 됐다면 landingSource.ts 의 한계 경고를 지워라")
      .not.toContain("kept");

    // 이 한계가 실제 랜딩 소스에서 터지지 않는지는 아래
    // "실제 랜딩 소스" 묶음이 **원문을 훑어서** 확인한다. 예전엔 여기서
    // "실제 소스는 그런 정규식을 안 쓴다" 고 문장으로만 적어 뒀는데,
    // 아무도 재지 않는 문장은 시간이 지나면 그냥 틀린 문장이 된다.
  });

  it("이스케이프된 따옴표를 문자열의 끝으로 읽지 않는다", () => {
    const src = `const a = "그가 \\"안녕\\" 이라 했다"; // 지워질 주석\nkeep();`;
    const out = stripComments(src);
    expect(out).toContain("안녕");
    expect(out).not.toContain("지워질 주석");
    expect(out).toContain("keep()");
  });
});

/**
 * 합성 문자열 말고 **실제 랜딩 소스**에 대고 확인한다.
 *
 * 내가 고른 반례만 돌리면 내 반례가 안 밟는 경로는 영영 안 밟힌다(2026-08-22 교훈:
 * 문장 지우는 정규식의 반례를 직접 고르니 전부 마침표로 끝났고, 정규식은 `?` `!` `,`
 * 를 넘어 정상 답변을 통째로 지웠다). 그래서 정본 카피를 대조군으로 한 번 통과시킨다.
 */
describe("실제 랜딩 소스", () => {
  const LANDING_SOURCES = () => [
    "src/app/landing/page.tsx",
    CONTENT_PATH,
    ...landingComponentFiles().map((f) => `src/components/landing/redesign/${f}`),
  ];

  it("주석에 적힌 고지 이름이 아니라 화면에 나가는 고지가 남는다", () => {
    // 정본 카피 `availableNow.cards[1].note` 바로 위에 이런 주석이 붙어 있다:
    //   // CLAUDE.md 가 요구하는 고지가 이 줄에 있다 — 점수·궁합 금지.
    //
    // 이게 바로 우리가 겁내는 모양이다. **고지의 이름이 고지 바로 위 주석에 적혀 있다.**
    // 궁합·점수 금지 고지는 원래 `scenes.note` 에 있었고 2026-08-29 재구성에서
    // `availableNow.cards[1].note` 로 옮겨왔다(CLAUDE.md: 궁합 점수·관계 예측 금지).
    // 누가 카피에서 그 고지를 지우고 주석만 남기면, 주석을 안 벗기는 가드는 전부
    // 초록불이 된다. 제거기가 진짜로 이 상황을 가르는지 원문으로 확인한다.
    const MARKER = "CLAUDE.md 가 요구하는 고지가 이 줄에 있다";
    const NOTICE = "점수도 궁합도 매기지 않아요";

    const raw = source(CONTENT_PATH);
    expect(
      raw,
      `landingContent.ts 에서 "${MARKER}" 주석이 없어졌다. ` +
        "이 검사는 '고지 이름이 적힌 주석' 을 대조군으로 쓴다 — " +
        "주석을 옮겼다면 살아 있는 다른 주석으로 이 상수를 갈아라.",
    ).toContain(MARKER);

    const clean = rendered(CONTENT_PATH);
    expect(clean, "주석이 안 벗겨졌다 — 주석이 고지 대신 대답하게 된다").not.toContain(MARKER);
    expect(
      clean,
      `궁합·점수 금지 고지("${NOTICE}")가 카피에서 사라졌거나 제거기가 카피까지 먹었다`,
    ).toContain(NOTICE);
  });

  it("카피를 먹지 않는다 — 대조군 문장 넷이 그대로 남는다", () => {
    // 제거기가 과하게 지우면 위 검사는 "주석이 사라졌다" 로 초록불을 준다.
    // 반대쪽도 재야 한다: 필수 고지 문장들이 주석 제거 뒤에도 원문 그대로 있는가.
    // 넷 다 없어진 섹션이 지던 고지가 옮겨간 자리다.
    const clean = rendered(CONTENT_PATH);
    const MUST_SURVIVE = [
      // AI 고지 (`noSide.note` · `notForVendors.aiNotice` → `boundaries.items[2]`)
      "AI가 만든 답변임을 표시해요",
      // 개인정보·저장 고지 (`privateLane.note` → `availableNow.cards[0].note`)
      "로그인 없이 넣은 견적은 저장하지 않아요",
      // 업체 편 아님 (`notForVendors` → `boundaries.items[0]`)
      "업체에 점수·등급·순위를 매기지 않아요",
      // 가격 출처·기준일 (→ `footer.notice`)
      "한국소비자원 참가격",
    ];
    for (const line of MUST_SURVIVE) {
      expect(clean, `"${line}" 가 주석 제거 뒤 사라졌다`).toContain(line);
    }
  });

  it("`//` 를 담은 정규식이 랜딩 소스에 없다 — 위 한계가 실전에서 안 터진다", () => {
    // landingSource.ts 가 문서로만 걸어 둔 약속을 여기서 실측한다:
    // "랜딩 소스에 `//` 를 담은 정규식을 쓰지 마라." `/https?:\/\//` 처럼 이스케이프한
    // 슬래시 둘이 그 모양이다. 하나라도 생기면 그 뒤 줄이 주석으로 잘려, 그 줄에 있던
    // 고지가 **검사에서 조용히 사라진다**.
    const ESCAPED_SLASH = `\\${String.fromCharCode(47)}`;
    for (const path of LANDING_SOURCES()) {
      expect(
        source(path).includes(`${ESCAPED_SLASH}${ESCAPED_SLASH}`),
        `${path} 에 이스케이프된 슬래시 둘이 생겼다. 정규식이라면 stripComments 가 ` +
          "그 뒤를 통째로 자른다 — landingSource.ts 의 한계 경고를 읽어라.",
      ).toBe(false);
    }
  });
});

/**
 * 블록 경계 가드.
 *
 * 옛 방식은 `text.slice(text.indexOf(a), text.indexOf(b))` 뒤에 `length > 0` 만
 * 확인했다. `indexOf` 가 -1 이면 `slice(-1)` 이 **마지막 한 글자**를 돌려주므로
 * 그 가드는 경계가 사라져도 영원히 참이다 — 변형으로 확인했다.
 */
describe("contentBlock", () => {
  it("경계를 못 찾으면 던진다", () => {
    expect(() => contentBlock("존재하지않는블록")).toThrow(/찾지 못했습니다/u);
    // ⚠️ 두 번째 인자는 **일부러 없는 경계**다. 2026-08-29에 블록 경계를 일괄로
    // 고치는 스크립트가 이 줄을 "낡은 경계" 로 보고 `"footer"` 로 바꿔 버렸고,
    // 그러자 던지지 않아 자기검증이 죽었다. 값을 고치지 마라 — 여기서 재는 것은
    // 경계를 못 찾았을 때 **조용히 넘어가지 않는가** 이다.
    expect(() => contentBlock("closing", "존재하지않는경계")).toThrow(/경계/u);
  });

  it("요구한 블록만 돌려준다", () => {
    const closing = contentBlock("closing", "footer");
    expect(closing).toContain("closing: {");
    expect(closing).not.toContain("footer: {");
    expect(closing.length).toBeGreaterThan(80);
  });

  it("최상위 export 도 잘라낸다", () => {
    // `contentBlock` 은 시작 패턴을 둘 안다: `  key: {`(landingContent 안의 키)와
    // `export const key = `(최상위 export). 뒤쪽 갈래에 사용자가 없으면 조용히 썩는다.
    //
    // 예전엔 `availableNow` 를 이 갈래의 사례로 썼다. 2026-08-29 정본 시안 재구성에서
    // availableNow 는 **최상위 export 에서 landingContent 안의 키로 내려왔고**,
    // 경계로 쓰던 `footerLinks` 는 없어졌다(푸터 링크가 `footer.columns` 안으로 들어감).
    // 그래서 지금 살아 있는 최상위 export 둘로 옮긴다 — 재는 것은 같다.
    const block = contentBlock("headerNav", "headerAuth");
    expect(block).toContain("export const headerNav");
    expect(block).not.toContain("export const headerAuth");
  });
});

describe("renderedSections", () => {
  it("page.tsx 가 실제로 그리는 섹션만 센다", () => {
    const sections = renderedSections();

    // 개수를 못으로 박지 않는다. 예전엔 `>= 8` 이었는데 시안이 바뀌어 7이 되자
    // **랜딩이 멀쩡한데 검사가 빨간불**이 됐다. 숫자는 시안을 따라다닐 뿐 아무것도
    // 지키지 않는다. 지켜야 하는 것은 "page.tsx 를 순서대로, 중복 없이, <main> 안만
    // 읽는다" 는 도우미의 뜻이다.
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0], "히어로가 첫 섹션이 아니다").toBe("TransformationHero");
    expect(sections.at(-1), "마무리 행동이 마지막 섹션이 아니다").toBe("ClosingAction");
    expect(new Set(sections).size, "같은 섹션을 두 번 그린다").toBe(sections.length);
  });

  it("<main> 밖 컴포넌트는 섹션으로 세지 않는다", () => {
    // 경계가 깨지면 헤더·푸터·꽃 레이어까지 '섹션'으로 잡혀 순서 검사가 무의미해진다.
    // 셋 다 page.tsx 가 실제로 그리지만 <main> 밖에 있다 — 그래서 좋은 대조군이다.
    const sections = renderedSections();
    for (const outside of ["LandingHeader", "LandingFooter", "LandingBloomLayer"]) {
      expect(sections, `${outside} 는 <main> 밖인데 섹션으로 잡혔다`).not.toContain(outside);
      expect(
        source("src/app/landing/page.tsx"),
        `${outside} 가 page.tsx 에서 없어졌다 — 대조군을 갈아라`,
      ).toContain(`<${outside} />`);
    }
  });
});

describe("everyLandingComponent", () => {
  it("폴더를 읽어 목록을 만든다", () => {
    const files = everyLandingComponent().map(([f]) => f);
    expect(files.some((f) => f.includes(".test."))).toBe(false);

    // 손으로 적은 목록이 아니라는 증거 ① — page.tsx 가 그리는 섹션이 전부 들어 있다.
    for (const section of renderedSections()) {
      expect(files, `${section}.tsx 가 목록에 없다`).toContain(`${section}.tsx`);
    }

    // 증거 ② — page.tsx 에서 파생한 목록도 아니다. 폴더에는 <main> 이 그리지 않는
    // 파일(헤더·푸터·모바일 메뉴 같은 것)도 있어야 한다. 예전엔 `>= 10` 이라는
    // 숫자로 이걸 대신했는데, 숫자는 "폴더를 읽었나" 를 묻지 않는다.
    const drawn = new Set(renderedSections().map((s) => `${s}.tsx`));
    expect(
      files.filter((f) => !drawn.has(f)),
      "page.tsx 가 그리는 것만 들어 있다 — 폴더가 아니라 page.tsx 를 읽은 것 같다",
    ).not.toHaveLength(0);

    // 증거 ③ — 목록의 모든 항목이 실제로 열려 소스를 갖고 있다(빈 문자열이 아니다).
    for (const [file, src] of everyLandingComponent()) {
      expect(src.length, `${file} 이 빈 소스로 잡혔다`).toBeGreaterThan(0);
    }
  });
});
