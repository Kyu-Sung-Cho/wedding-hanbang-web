import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { START_COPY } from "@hanbang/shared/invitation";
import { WEDDING_CODE_V31_QUESTIONS } from "@/constants/weddingCodeV31";
import { parseWeddingCodeEntryQuery } from "@/app/wedding-code/entry";

import {
  contentBlock,
  everyLandingComponent,
  rendered,
  stripComments,
} from "../../../app/landing/__tests__/landingSource";

/**
 * 공개 표면의 수는 **자기가 무엇을 세는지 말해야 하고, 도착 화면과 같아야 한다.**
 *
 * ## 무엇이 있었나
 *
 * 화면마다 다른 수가 비슷한 라벨을 달고 있었다.
 *
 *     랜딩   "표시된 업체 406곳"
 *     /price "가격을 공개한 업체 829곳"
 *
 * 2026-08-26 실측으로 **둘 다 맞다.** 서로 다른 것을 센다.
 *
 *     406  취소·환불 규정 원문이 공개된 업체 카드 (studio 190·dress 128·makeup 88·예식장 0)
 *     829  가격 공시가 실려 있는 업체 카드        (studio 296·dress 200·makeup 144·hall 189)
 *     831  규정 원문의 **행** 수 — 406곳의 것이지 829곳의 것이 아니다
 *
 * 406 은 829 의 완전한 부분집합이다(교집합 406/406). 문제는 숫자가 아니라 라벨이었다 —
 * "표시된 업체" 는 무엇의 업체인지 말하지 않고, 같은 화면 머리말이 "공개 **가격과**
 * 규정" 이라 읽는 사람은 406 을 가격 업체 수로 받는다. 그리고 `/price` 에서 829 를 본다.
 *
 * ## 이 검사가 막는 것
 *
 * **다음 사람이 406 을 829 로 "맞추는" 것.** 그러면 그 순간 831건이 거짓이 된다 —
 * 831 은 406곳의 규정 원문이지 829곳의 것이 아니다. 실제로 1차 조사자가 그렇게
 * 제안했고, 반증 단계가 "그대로 고치면 다른 화면이 거짓이 된다" 며 막았다.
 *
 * ## 숫자를 문자열로 찾지 않는다
 *
 * 처음엔 `text.includes("829")` 로 썼다가 **색상 코드 `text-[var(--hb-text-body)]` 에 걸렸다**
 * (한 파일에서 20건 중 15건이 색상이었다). 숫자는 앞뒤가 숫자가 아닐 때만 그 숫자다.
 *
 * ## 2026-08-28 — 장면 수도 여기서 잰다
 *
 * 적대적 검증에서 **히어로의 "스무 장면"을 "열여섯"으로 바꿔도 아무 테스트가 안 깨졌다.**
 * 라이브 문항 수와 대조하는 검사(`landingAvailableNow.test.ts`)가 `availableNow` 블록만
 * 봤기 때문이다. 히어로·마무리·헤더 버튼은 무방비였고, 그 셋이 첫 화면과 마지막 행동을
 * 지고 있다. 한 클릭 만에 숫자가 달라지는 것은 업체 수와 같은 종류의 거짓말이다.
 *
 * ## 주석은 벗기되, 줄 끝 주석까지 벗긴다
 *
 * 옛 `body()` 는 **줄 처음**의 `//` 만 지웠다. 그래서 필수 문장을 화면에서 빼고 줄 끝
 * 주석으로 남기면 "있다"고 통과했다. 공용 `stripComments` 는 문자열·템플릿 리터럴을
 * 알기 때문에 `"https://…"` 를 건드리지 않으면서 줄 끝 주석까지 지운다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WEB = join(REPO_ROOT, "apps", "web", "src");

/**
 * 라벨을 그리는 곳.
 *
 * 랜딩의 `TrustEvidenceSection.tsx` 가 여기 있었다. 2026-08-27 개편에서 삭제됐고,
 * 랜딩은 이제 업체 수를 한 번도 그리지 않는다 — 그 표면은 아래
 * "랜딩은 수 대신 출처를 남긴다" 가 이어서 지킨다.
 */
const RENDERERS = [
  join(WEB, "components", "community", "CommunityLandingClient.tsx"),
];

/**
 * 406 을 상수로 들고 있는 곳.
 *
 * `app/landing/page.tsx` 가 여기 있었다. 개편으로 `PUBLISHED_VENDOR_COUNT` ·
 * `PUBLISHED_POLICY_COUNT` 상수가 통째로 사라졌다(수를 옮겨 적은 게 아니라 화면에서
 * 뺐다). 랜딩이 다시 수를 쓰게 되면 **이 배열과 RENDERERS 에 함께 넣어라** —
 * 그래야 라벨 규칙이 그 화면에도 걸린다.
 */
const HOLDERS = [
  join(WEB, "components", "community", "CommunityLandingClient.tsx"),
];

/**
 * 랜딩 카피 정본과 페이지. **수를 세지 않는 표면**이라 위 두 배열에 없다.
 *
 * 장식 SVG(`LandingBloom.tsx`)는 넣지 않는다. path 좌표에 `406` 이 그대로 들어 있어
 * (`M216.1 406 L220.1 403.1`) 색상 코드와 똑같은 함정을 만든다 — 이 파일 머리말이
 * 적어 둔 그 함정이 개편 뒤 SVG 로 형태만 바꿔 다시 나타났다.
 */
const LANDING_COPY = [
  join(WEB, "components", "landing", "redesign", "landingContent.ts"),
  join(WEB, "app", "landing", "page.tsx"),
];

const read = (p: string) => readFileSync(p, "utf8");
const short = (p: string) => p.split(/[\\/]/).slice(-1)[0];

/** 주석은 뺀다 — 이력을 적어 두는 것까지 막을 이유는 없다. 줄 끝 주석도 뺀다. */
const body = (t: string) => stripComments(t);

/** 앞뒤가 숫자가 아닐 때만 그 숫자다. 색상 코드에 안 걸린다. */
const hasNumber = (t: string, n: number) =>
  new RegExp(`(?<!\\d)${n}(?!\\d)`, "u").test(t);

/**
 * 랜딩이 화면에 내보내는 글자 전부(카피 정본 + 섹션 컴포넌트 + page.tsx).
 *
 * 파일 이름을 손으로 적지 않는다. 새 섹션이 생기면 그 자리에서 검사 대상이 된다 —
 * 손으로 적은 목록은 이 저장소에서 이미 두 번 새 파일을 놓쳤다.
 */
const LANDING_RENDERED = everyLandingComponent()
  .map(([, componentSource]) => componentSource)
  .concat(rendered("src/components/landing/redesign/landingContent.ts"))
  .concat(rendered("src/app/landing/page.tsx"))
  // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 첫 화면 글자는 앱과 같은
  // 정본 `START_COPY` 에서 온다. 랜딩 폴더에는 없으므로 함께 센다.
  .concat(Object.values(START_COPY).flat().join("\n"))
  .join("\n");

describe("측정기가 살아 있다", () => {
  it("숫자 검색이 색상 코드에 걸리지 않는다", () => {
    expect(hasNumber('text-[var(--hb-text-body)]', 829)).toBe(false);
    expect(hasNumber("업체 829곳", 829)).toBe(true);
    expect(hasNumber("const N = 406;", 406)).toBe(true);
  });

  it("주석 벗기기가 줄 끝 주석까지 잡는다", () => {
    // 옛 구현은 줄 **처음**의 `//` 만 지웠다. 그래서 화면에서 뺀 문장을 줄 끝
    // 주석으로 남기면 검사가 "있다"고 답했다.
    expect(body('const a = "";  // 업체 406곳')).not.toContain("406곳");
    // 문자열 안의 `//` 는 건드리지 않는다.
    expect(body('const u = "https://hanbang.ai";')).toContain("https://hanbang.ai");
  });

  it("파일을 실제로 읽는다", () => {
    for (const f of [...RENDERERS, ...HOLDERS, ...LANDING_COPY]) {
      expect(read(f).length, short(f)).toBeGreaterThan(500);
    }
    expect(LANDING_RENDERED.length, "랜딩 표면을 하나도 못 읽었다").toBeGreaterThan(5000);
  });
});

describe("라벨이 무엇을 세는지 말한다", () => {
  it.each(RENDERERS.map((f) => [short(f), f]))(
    "%s 가 '표시된 업체' 처럼 밝히지 않는 라벨을 쓰지 않는다",
    (_name, file) => {
      expect(body(read(file))).not.toContain("표시된 업체");
    },
  );

  it.each(RENDERERS.map((f) => [short(f), f]))(
    "%s 의 업체 수 라벨이 '규정' 을 말한다",
    (_name, file) => {
      // 406 은 규정 모집단이다. 라벨이 그걸 말해야 /price 의 829 와 헷갈리지 않는다.
      expect(body(read(file))).toMatch(/규정[^\n]{0,14}업체/u);
    },
  );
});

describe("406 을 829 로 맞추지 않는다", () => {
  it.each(HOLDERS.map((f) => [short(f), f]))(
    "%s 는 여전히 406 을 쓴다",
    (_name, file) => {
      const text = body(read(file));
      expect(hasNumber(text, 406), "406 이 사라졌다").toBe(true);
      // 829 는 가격 모집단이다. 이 화면들은 규정 모집단을 말하므로 829 로 바꾸면
      // 바로 옆의 831건(=406곳의 규정 원문)이 거짓이 된다.
      expect(hasNumber(text, 829), "가격 모집단 수로 바뀌었다").toBe(false);
    },
  );

  it("831 은 406 과 같은 파일에 있다 — 짝이 갈리면 뜻이 바뀐다", () => {
    for (const file of HOLDERS) {
      const text = body(read(file));
      if (!hasNumber(text, 831)) continue;
      expect(hasNumber(text, 406), short(file)).toBe(true);
    }
  });
});

describe("랜딩은 수 대신 출처를 남긴다", () => {
  it.each(LANDING_COPY.map((f) => [short(f), f]))(
    "%s 는 업체 수를 라벨 없이 들이지 않는다",
    (_name, file) => {
      // 개편 전 랜딩은 "표시된 업체 406곳 · 위약금 원문 831건" 을 화면에 띄웠고,
      // 그래서 위 라벨 규칙의 검사 대상이었다. 지금은 세 수 중 어느 것도 쓰지 않는다.
      // 여기서 막는 것은 **수가 라벨 규칙을 건너뛰고 돌아오는 것**이다.
      // 되살리려면 RENDERERS·HOLDERS 에 이 파일을 넣고 "규정 … 업체" 라벨을 달아야
      // 하며, 그때 이 단언이 먼저 깨져서 그 사실을 알려 준다.
      const text = body(read(file));
      for (const n of [406, 829, 831]) {
        expect(hasNumber(text, n), `${n} 이 라벨 규칙 밖에서 들어왔다`).toBe(false);
      }
    },
  );

  it("새 섹션 컴포넌트로도 수가 돌아오지 못한다", () => {
    // 위 검사는 카피 정본과 page.tsx 만 본다. 수를 섹션 컴포넌트에 직접 적으면
    // 그 둘을 건드리지 않고 화면에 뜬다. 그래서 랜딩 표면 전체를 한 번 더 훑는다.
    //
    // 다만 **단위와 함께** 찾는다. 장식 SVG 의 path 좌표에 `406` 이 그대로 들어 있어
    // (`M216.1 406 L220.1 403.1`) 맨 숫자로 훑으면 색상 코드와 똑같은 함정에 걸린다.
    for (const n of [406, 829, 831]) {
      expect(
        LANDING_RENDERED,
        `${n} 이 라벨 규칙을 건너뛰고 랜딩 컴포넌트로 돌아왔다`,
      ).not.toMatch(new RegExp(`(?<!\\d)${n}\\s*(곳|개|건|명)`, "u"));
    }
  });

  it("수를 뺀 자리에 출처와 기준일이 남아 있다", () => {
    // 수만 지우고 근거까지 지우면 랜딩의 공시 가격 문장이 출처 없는 주장이 된다.
    // 개편은 수를 푸터 고지로 **대체**한 것이지 근거를 버린 게 아니다.
    // 값이 아니라 형태를 고정한다 — 재측정으로 날짜가 바뀌는 것은 막을 일이 아니다.
    //
    // ⚠️ 파일 전체에서 찾던 옛 형태는 **자리를 안 봤다.** 출처 문장을 히어로 note 로
    // 옮겨도(=푸터 고지가 사라져도) 통과했다. 이 고지는 푸터가 지는 몫이므로
    // `footer` 블록에서 찾는다 — 경계를 못 찾으면 `contentBlock` 이 던진다.
    // 2026-08-29: `footer` 다음 경계가 `notDoing` 이었는데 그 블록이 없어졌다
      // (`boundaries` 로 이름이 바뀌었고 순서도 footer 앞으로 갔다). 지금 `footer` 는
      // `landingContent` 의 마지막 블록이다. 2026-11-17 시작 화면 개편으로 그 뒤의 최상위
      // export(`headerNav`)도 없어져 경계 없이 파일 끝까지 자른다.
      const footerCopy = contentBlock("footer");
    expect(footerCopy).toContain("한국소비자원 참가격");
    expect(footerCopy, "공시 기준 시점이 없다").toMatch(/\d{4}년 \d{1,2}월 공시 기준/u);
    expect(footerCopy, "공시 가격이 기본 조건 기준이라는 한계가 없다")
      .toContain("공시 가격은 기본 조건 기준이라 실제 계약가와 다를 수 있어요");

    // 카피에 남아 있어도 그리지 않으면 방문자는 근거를 못 본다.
    expect(
      rendered("src/components/landing/redesign/LandingFooter.tsx"),
      "푸터가 출처 고지를 그리지 않는다",
    ).toContain("{footer.notice}");
  });
});

describe("랜딩의 문장 수는 도착 화면이 묻는 문항 수다", () => {
  const countPattern = /([0-9]+)\s*(?:개\s*)?문장/gu;

  it("첫 화면과 마무리가 실제 기본 검사와 같은 수를 말한다", () => {
    expect(parseWeddingCodeEntryQuery({}).kind).toBe("v31");
    // 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해): 첫 화면은 앱과 같은 정본
    // `START_COPY` 이고 카피 블록은 다섯으로 줄었다(마무리 섹션이 없어졌다). 첫 화면 정본도 함께 센다.
    // 2026-11-18: 첫 화면 아래 섹션 카피(soon → closing)가 account 와 boundaries 사이에 들어왔다.
    const blocks = [
      ["start", "account"],
      ["account", "soon"],
      ["soon", "today"],
      ["today", "steps"],
      ["steps", "promises"],
      ["promises", "wide"],
      ["wide", "closing"],
      ["closing", "boundaries"],
      ["boundaries", "notices"],
      ["notices", "footer"],
      ["footer", undefined],
    ] as const;
    const copy = [
      ...blocks.map(([from, to]) => [from, contentBlock(from, to)] as const),
      ["START_COPY", Object.values(START_COPY).flat().join("\n")] as const,
    ];
    const speaking = copy.flatMap(([name, text]) =>
      Array.from(text.matchAll(countPattern), (match) => ({ name, count: Number(match[1]) })),
    );

    // 통합판은 문장 뒤에 취향과 우선순위를 더 묻는다. 고정 문장 수를 전체 분량처럼 약속하지 않는다.
    for (const { name, count } of speaking) {
      expect(count, `${name} 블록의 문장 수가 실제 검사와 다르다`)
        .toBe(WEDDING_CODE_V31_QUESTIONS.length);
    }
    expect(copy.map(([, text]) => text).join(""), "웨딩코드로 가는 길이 사라졌다")
      .toMatch(/href:\s*"\/wedding-code"/u);
  });

  it("랜딩의 컴포넌트에도 잘못된 수나 예전 장면 수가 남아 있지 않다", () => {
    // 카피뿐 아니라 헤더 등에서 직접 그리는 문장 수까지 확인한다.
    const counts = Array.from(LANDING_RENDERED.matchAll(countPattern), (match) => Number(match[1]));
    for (const count of counts) expect(count).toBe(WEDDING_CODE_V31_QUESTIONS.length);
    expect(LANDING_RENDERED, "예전 선택형 검사의 장면 수가 랜딩에 남아 있다")
      .not.toMatch(/(?:[0-9]+|열두|열여섯|스무|스물네)\s*(?:개\s*)?장면/u);
  });
});
