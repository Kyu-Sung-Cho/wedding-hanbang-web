import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 공개 표면의 업체 수는 **자기가 무엇을 세는지 말해야 한다.**
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
 * 처음엔 `text.includes("829")` 로 썼다가 **색상 코드 `text-[#7a8290]` 에 걸렸다**
 * (한 파일에서 20건 중 15건이 색상이었다). 숫자는 앞뒤가 숫자가 아닐 때만 그 숫자다.
 */

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..", "..");
const WEB = join(REPO_ROOT, "apps", "web", "src");

/** 라벨을 그리는 곳. */
const RENDERERS = [
  join(WEB, "components", "landing", "redesign", "TrustEvidenceSection.tsx"),
  join(WEB, "components", "community", "CommunityLandingClient.tsx"),
];

/** 406 을 상수로 들고 있는 곳. `TrustEvidenceSection` 은 prop 으로 받는다. */
const HOLDERS = [
  join(WEB, "app", "landing", "page.tsx"),
  join(WEB, "components", "community", "CommunityLandingClient.tsx"),
];

const read = (p: string) => readFileSync(p, "utf8");
const short = (p: string) => p.split(/[\\/]/).slice(-1)[0];

/** 주석은 뺀다 — 이력을 적어 두는 것까지 막을 이유는 없다. */
const body = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

/** 앞뒤가 숫자가 아닐 때만 그 숫자다. 색상 코드에 안 걸린다. */
const hasNumber = (t: string, n: number) =>
  new RegExp(`(?<!\\d)${n}(?!\\d)`, "u").test(t);

describe("측정기가 살아 있다", () => {
  it("숫자 검색이 색상 코드에 걸리지 않는다", () => {
    expect(hasNumber('text-[#7a8290]', 829)).toBe(false);
    expect(hasNumber("업체 829곳", 829)).toBe(true);
    expect(hasNumber("const N = 406;", 406)).toBe(true);
  });

  it("파일을 실제로 읽는다", () => {
    for (const f of [...RENDERERS, ...HOLDERS]) {
      expect(read(f).length, short(f)).toBeGreaterThan(500);
    }
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
