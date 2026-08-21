import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";

import { CHECKLIST_CATEGORY_KEYS } from "@/lib/ai/tools";

/**
 * 아모라에게 주는 분야 목록이 **DB가 실제로 받는 것과 같은지** 본다.
 *
 * 쓰기 도구는 `apply_amora_atomic_tool_execution`을 지나고, 그 본체는 분야 키
 * 화이트리스트를 SQL 안에 하드코딩해 두었다. 두 목록이 어긋나면 어느 쪽으로 어긋나느냐에
 * 따라 서로 다른 방식으로 사용자가 다친다.
 *
 * - **도구가 더 넓으면**: 모델이 그 분야를 지목하고 DB가 거절한다. 스트리밍되던 답이
 *   지워지고 "다시 이어갈 수 없어요"가 뜬다. 같은 말을 다시 해도 같은 자리에서 죽는다.
 * - **도구가 더 좁으면**: 모델이 그 분야를 아예 못 고른다. 조용히 넘어가거나 엉뚱한
 *   분야를 고른다. 지금 `greeting`·`registration`이 이 상태다 — 분야는 늘렸는데
 *   마이그레이션은 못 늘렸다(릴리스 매니페스트와 소유자 서명이 걸려 파운더가 여는 문이다).
 *
 * **이 검사의 목적은 지금의 어긋남을 눈에 보이게 붙잡아 두는 것이다.** DB가 새 분야를
 * 받게 되는 순간 이 검사가 실패한다. 그때 `tools.ts`의
 * `CATEGORIES_THE_DATABASE_CANNOT_ACCEPT`를 지우면 된다. 그 제약이 DB 수정 뒤에도
 * 조용히 남아 아모라만 못 쓰는 상태가 되는 것을 막는다.
 */
describe("아모라 도구 목록과 DB 화이트리스트", () => {
  const repoRoot = resolve(process.cwd(), "..", "..");
  const migrationDir = join(repoRoot, "supabase", "migrations");

  /**
   * 마이그레이션 원문에서 분야 화이트리스트를 뽑는다.
   *
   * 파일 이름을 박지 않는 이유: 이 함수는 이미 한 번 이름이 바뀌었고
   * (`20260730102000`이 `..._pre_shared_revision`으로 rename), 앞으로도 새 마이그레이션이
   * 본문을 교체할 수 있다. 어느 파일에 있든 **가장 나중 것**이 살아 있는 정의다.
   */
  function categoriesTheDatabaseAccepts(): { accepted: string[]; listCount: number } {
    const files = readdirSync(migrationDir)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();

    let latest: string[] | null = null;
    let listCount = 0;
    for (const name of files) {
      const sql = readFileSync(join(migrationDir, name), "utf8");
      // 한 파일 안에 목록이 **여럿** 있다(도구마다 하나씩). 마지막 것만 보면 하나만
      // 넓힌 마이그레이션도 통과한다 — 처음 이 함수는 그렇게 덮어쓰고 있었다.
      // 그래서 모아서 **교집합**을 쓴다. 한 자리라도 안 넓히면 곧바로 좁아진다.
      const lists: string[][] = [];
      for (const match of sql.matchAll(/NOT IN \(\s*((?:'[a-z_]+',?\s*)+)\)/g)) {
        const keys = Array.from(match[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
        // 분야 목록으로 보이는 것만 — 상태값 목록('completed' 등)과 가른다.
        if (keys.includes("meeting") && keys.includes("pyebaek")) {
          lists.push(keys.filter((key) => key !== "reserve"));
        }
      }
      if (lists.length > 0) {
        latest = lists.reduce((acc, list) => acc.filter((key) => list.includes(key)));
        listCount = lists.length;
      }
    }
    return { accepted: latest ?? [], listCount };
  }

  const { accepted, listCount } = categoriesTheDatabaseAccepts();

  it("마이그레이션에서 화이트리스트를 실제로 찾아낸다", () => {
    // 못 찾으면 아래 검사가 빈 배열끼리 비교해 늘 통과한다. 먼저 찾았는지 본다.
    expect(accepted.length).toBeGreaterThan(15);
    // 그리고 **여러 자리**를 봤는지 본다. 한 자리만 보면 나머지가 안 넓어져도 통과한다.
    expect(listCount).toBeGreaterThan(1);
  });

  it("도구가 DB보다 넓지 않다 — 넓으면 대화가 그 자리에서 죽는다", () => {
    const tooWide = CHECKLIST_CATEGORY_KEYS.filter((key) => !accepted.includes(key));
    expect(
      tooWide,
      "DB가 못 받는 분야를 모델에게 열어 주면 답이 지워지고 재시도도 막힌다",
    ).toEqual([]);
  });

  it("도구가 DB보다 좁은 만큼이 지금 아모라가 못 쓰는 분야다", () => {
    const templateKeys = CATEGORY_CHECKLISTS.map((category) => category.key);
    const blockedByDatabase = templateKeys.filter((key) => !accepted.includes(key));
    const blockedInTools = templateKeys.filter((key) => !CHECKLIST_CATEGORY_KEYS.includes(key));

    // 두 목록이 정확히 같아야 한다. DB가 새 분야를 받게 되면 왼쪽이 줄어들고 이 검사가
    // 실패한다 — 그때 `tools.ts`의 제약을 지우라는 뜻이다.
    expect(
      blockedInTools,
      "DB가 받게 됐는데 도구만 막고 있거나, 그 반대다",
    ).toEqual(blockedByDatabase);
  });
});
