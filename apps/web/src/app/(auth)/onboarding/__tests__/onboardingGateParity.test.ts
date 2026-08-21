import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 웹과 앱이 온보딩 마지막 스텝에서 **같은 관문**을 세우는지 본다.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-08-21에 온보딩 5스텝의 단계 선택을 필수에서 선택으로 바꿨다. 그런데 웹만
 * 바꾸고 앱은 필수로 남겨뒀다. 타입도, 웹 테스트 6,600여 개도, 앱 테스트도 전부
 * 초록이었다 — 두 파일을 같이 보는 검사가 없었기 때문이다.
 *
 * 결과는 한 커플이 두 화면에서 서로 다른 관문을 만나는 것이다. 신부는 앱에서
 * 단계를 반드시 골라야 하고 신랑은 웹에서 그냥 넘어간다. 이런 어긋남은 화면을
 * 하나만 보고 있으면 절대 안 보인다.
 *
 * ## 왜 파일을 글자로 읽나
 *
 * 두 관문은 각자 화면 컴포넌트 안에 있어서 한쪽에서 import할 수 없다. 같은 저장소의
 * 다른 앱을 글자로 훑는 방식은 `constants/__tests__/categoryKeyMirrors.test.ts`가
 * 이미 쓰고 있다.
 *
 * ## 여기가 깨졌을 때
 *
 * 한쪽만 고친 것이다. 두 파일을 같이 고치거나, 정말 플랫폼별로 달라야 한다면
 * **왜 달라야 하는지**를 아래 목록 옆에 적고 예외로 옮겨라. 조용히 이 파일을
 * 지우지는 마라 — 지우면 다음 사람이 같은 자리에서 같은 걸 놓친다.
 */
describe("웹과 앱의 온보딩 관문", () => {
  const repoRoot = resolve(process.cwd(), "..", "..");

  const WEB = "apps/web/src/app/(auth)/onboarding/page.tsx";
  const MOBILE = "apps/mobile/app/onboarding/index.tsx";

  function read(relative: string): string {
    return readFileSync(resolve(repoRoot, relative), "utf8");
  }

  /**
   * `case 5:` 뒤에 오는 첫 `return ...;`을 꺼낸다. 주석은 건너뛴다 — 이 저장소는
   * 판단 근거를 case 안에 길게 적는 편이라 주석을 안 지우면 첫 return을 못 찾는다.
   */
  function stepFiveReturn(source: string): string {
    const start = source.indexOf("case 5:");
    expect(start, "`case 5:`를 못 찾았습니다 — 스텝 구조가 바뀐 것 같습니다").toBeGreaterThan(-1);

    const tail = source
      .slice(start + "case 5:".length, start + 2000)
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/^[ \t]*\/\/.*$/gmu, "");

    const match = /return\s+([^;]+);/u.exec(tail);
    expect(match, "`case 5:` 뒤에서 return을 못 찾았습니다").not.toBeNull();
    return match![1].replace(/\s+/gu, " ").trim();
  }

  it("측정기가 살아 있다", () => {
    // 두 파일을 못 읽으면 아래 단언이 **조용히** 통과할 수 있다. 그쪽을 먼저 막는다.
    expect(read(WEB).length).toBeGreaterThan(1000);
    expect(read(MOBILE).length).toBeGreaterThan(1000);
  });

  it("마지막 스텝에서 양쪽 모두 아무 조건 없이 넘어간다", () => {
    const web = stepFiveReturn(read(WEB));
    const mobile = stepFiveReturn(read(MOBILE));

    // 조건이 붙는 순간 한쪽만 붙을 위험이 생긴다. 그래서 "같다"가 아니라
    // "둘 다 무조건"으로 못 박는다 — 양쪽에 똑같이 잘못된 조건이 들어가는 것까지 막는다.
    expect(
      web,
      `웹의 마지막 스텝에 조건이 생겼습니다(${web}). 앱(${MOBILE})도 같이 봤나요?`,
    ).toBe("true");
    expect(
      mobile,
      `앱의 마지막 스텝에 조건이 생겼습니다(${mobile}). 웹(${WEB})도 같이 봤나요?`,
    ).toBe("true");
  });

  it("단계를 안 골랐을 때 두 화면 모두 고른 척하지 않는다", () => {
    // 관문을 열면 "고른 단계"라고 말하던 문구가 거짓이 된다. 웹은 안내문,
    // 앱은 건너뛰기 버튼의 접근성 힌트에 그 문구가 있었다.
    for (const [label, relative] of [["웹", WEB], ["앱", MOBILE]] as const) {
      const source = read(relative);
      if (!source.includes("고른 단계")) continue;

      // 그 문구를 쓰려면 반드시 "안 골랐을 때"의 갈래가 옆에 있어야 한다.
      expect(
        /preparationStage\s*===\s*null/u.test(source),
        `${label}이 "고른 단계"라고 말하는데, 단계를 안 골랐을 때의 갈래가 없습니다 (${relative})`,
      ).toBe(true);
    }
  });
});
