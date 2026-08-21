import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

/**
 * 분야 키를 손으로 옮겨 적은 곳들이 템플릿을 따라오는지 본다.
 *
 * 분야 목록의 정본은 `weddingPlanning.ts` 하나다. 그런데 그 키를 **손으로 다시 적어 둔
 * 자리가 네 곳** 있고, 전부 "모르는 키는 막는다"는 성격이라 새 분야가 조용히 거부된다.
 * 화면은 템플릿으로 그리니 분야는 보이는데, 저장이나 예산 집계에서만 사라지는 모양이 된다.
 *
 * 2026-08-21에 가짜 분야를 템플릿에 심고 돌려 봤더니 **웹 테스트 144개가 전부 초록**이었다.
 * 아무도 안 막고 있었다. 그래서 이 파일을 만든다.
 *
 * 파일을 글자로 읽는 이유는 저 목록들이 웹과 모바일에 나뉘어 있어 한쪽에서 import할 수
 * 없기 때문이다. 같은 저장소의 다른 앱을 글자로 훑는 방식은 `ChecklistItemText.surfaces`
 * 테스트가 이미 쓰고 있다.
 */
describe("분야 키를 옮겨 적은 곳", () => {
  const repoRoot = resolve(process.cwd(), "..", "..");
  // `PLANNING_CATEGORY_LABELS`가 아니라 실제 체크리스트에서 뽑는다. 라벨 쪽에는 예산
  // 전용 칸(`reserve`)이 하나 더 있어서, 그것까지 분야로 치면 예절 편을 이으라고
  // 요구하게 된다 — 이 테스트를 처음 돌렸을 때 실제로 그렇게 걸렸다.
  const templateKeys = CATEGORY_CHECKLISTS.map((category) => category.key);

  /**
   * 각 자리가 무엇을 하는지 적어 둔다. 새 자리가 생겼는데 여기 없으면 이 테스트는 그것을
   * 모른 채 통과하므로, 목록을 옮겨 적을 일이 생기면 여기에도 한 줄 늘려야 한다.
   */
  const MIRRORS = [
    {
      // 원래 이 자리는 `apps/web/src/types/onboarding.types.ts`였다. 그 파일이 키를
      // 손으로 다시 적고 있었기 때문이다. 2026-08-21에 그 목록을 지우고 아래 공유
      // 상수 하나만 보게 만들었으므로, 검사 대상도 그쪽으로 옮긴다 — 미러를 맞추는
      // 것보다 미러를 없애는 쪽이 낫고, 이 테스트가 막으려던 사고(새 분야가 조용히
      // 거부되는 것)는 정본 하나만 지키면 끝난다.
      file: "packages/shared/src/constants/preparationProgress.ts",
      what: "온보딩이 저장을 허용하는 분야의 정본 — 빠지면 그 분야 진행이 저장되지 않는다",
      /** 예산 전용 칸을 더 갖고 있어도 된다. 템플릿 분야가 다 들어 있기만 하면 된다. */
      extraAllowed: [],
    },
    {
      file: "apps/mobile/src/lib/budgetRevision.mjs",
      what: "모바일이 예산 저장을 허용하는 분야",
      extraAllowed: ["reserve"],
    },
    {
      file: "apps/mobile/app/budget/index.tsx",
      what: "모바일 예산 화면이 그리는 분야",
      extraAllowed: ["reserve"],
    },
  ];

  it("템플릿에 분야가 있다", () => {
    expect(templateKeys.length).toBeGreaterThan(15);
  });

  it.each(MIRRORS)("$file 이 템플릿 분야를 모두 담는다", ({ file, what }) => {
    const source = readFileSync(resolve(repoRoot, file), "utf8");
    // 목록은 전부 `"key"` 꼴로 적혀 있다. 파일 전체에서 따옴표 안 낱말을 모아 비교한다 —
    // 목록의 문법(배열/Set/as const)이 자리마다 달라서 구조를 파싱하지 않는다.
    const quoted = new Set(
      Array.from(source.matchAll(/"([a-z][a-z0-9_]*)"/g), (m) => m[1]),
    );
    const missing = templateKeys.filter((key) => !quoted.has(key));
    expect(missing, `${what} — 빠진 분야: ${missing.join(", ")}`).toEqual([]);
  });

  /**
   * 예절 편 지도는 빠져도 조용하다 — 매핑이 없으면 `null`을 돌려주고 카드를 안 그리도록
   * 일부러 그렇게 만들었다. 죽은 링크보다 낫다는 판단이었고 그 판단은 지금도 맞다.
   * 다만 "안 그린다"와 "그릴 편이 없다"는 다르므로, 새 분야가 편 없이 들어오면 여기서 말한다.
   *
   * `guideLinkForCategory`를 직접 부르는 검사는 `lib/etiquette/__tests__/guideLink`에 있다.
   * 여기서는 지도 파일 자체에 키가 적혀 있는지만 본다.
   */
  it("예절 편 지도가 모든 분야를 안다", () => {
    const source = readFileSync(
      resolve(repoRoot, "apps/web/src/lib/manners/categoryMap.ts"),
      "utf8",
    );
    const mapped = new Set(
      Array.from(source.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"/gm), (m) => m[1]),
    );
    const missing = templateKeys.filter((key) => !mapped.has(key));
    expect(missing, `예절 편이 이어지지 않은 분야: ${missing.join(", ")}`).toEqual([]);
  });
});
