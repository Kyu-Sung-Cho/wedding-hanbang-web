import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS, PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";

/**
 * 분야 키를 옮겨 적은 자리가 정본을 따라오는지 본다.
 *
 * 분야 목록의 정본은 `weddingPlanning.ts` 하나인데, 그 키를 **문자열로 다시 적어 둔
 * 자리가 저장소 곳곳에 있다.** 대부분 "모르는 키는 막는다"거나 "이 목록만 그린다"는
 * 성격이라, 분야가 늘었을 때 따라오지 않으면 그 분야만 조용히 사라진다. 화면은
 * 템플릿으로 그리니 분야는 보이는데 저장·집계·아모라에서만 빠지는 모양이 된다.
 *
 * **이 파일의 첫 판은 지킬 자리를 손으로 적었고, 그래서 실패했다.**
 * 만든 사람이 찾아낸 네 곳만 배열에 넣었더니 나머지가 영영 안 보였다. 2026-08-21에
 * 분야를 스물하나로 늘린 뒤 검사는 초록인데 실제로는 여섯 곳이 더 빠져 있었다 —
 * 아모라 도구 스키마 여섯 개(그래서 아모라가 새 분야를 지목할 수 없었다), 웹 예산
 * 화면(모바일만 고쳐져 웹과 어긋났다), 아모라 진행 단계, 대화 스토어.
 *
 * 그래서 목록을 손으로 적지 않는다. **저장소를 훑어 "분야 키를 여러 개 나열한 파일"을
 * 스스로 찾는다.** 실제로 세어 보면 갈림이 뚜렷하다 — 스물두 키 중 열다섯 이상을 담은
 * 파일은 전부 "빠짐없이 담으려는" 목록이고, 열한 개 이하는 전부 일부러 고른 부분
 * 목록이다(커뮤니티 분류, 업체 매핑, 알림 종류). 그 사이는 비어 있다.
 */
describe("분야 키를 옮겨 적은 곳", () => {
  const repoRoot = resolve(process.cwd(), "..", "..");
  const checklistKeys = CATEGORY_CHECKLISTS.map((category) => category.key);
  /** 예산 전용 칸(`reserve`)까지 포함한 전체. 파일마다 어느 쪽인지 다르다. */
  const allKeys = Object.keys(PLANNING_CATEGORY_LABELS);

  /**
   * 빠짐없이 담으려는 목록과 일부러 고른 부분 목록을 가르는 선.
   *
   * 이 값을 낮추면 부분 목록이 걸려 시끄러워지고, 다음 사람이 검사를 약화시킨다.
   * 올리면 진짜 누락을 놓친다. 2026-08-21 실측에서 열다섯~열아홉 사이에 파일이 하나도
   * 없어 그 빈 구간 한가운데를 골랐다.
   */
  const EXHAUSTIVE_THRESHOLD = 15;

  const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", ".turbo", "dist", "build", "coverage", ".vercel",
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
    }
    return out;
  }

  const files = walk(repoRoot).map((full) => {
    const text = readFileSync(full, "utf8");
    return {
      path: relative(repoRoot, full).split(sep).join("/"),
      quoted: allKeys.filter((key) => text.includes(`"${key}"`)),
    };
  });

  it("훑기가 실제로 파일을 찾아낸다", () => {
    // 훑기가 0건이면 아래 검사는 늘 통과한다. 먼저 정본 자신이 걸리는지 본다.
    const template = files.find((f) => f.path.endsWith("constants/weddingPlanning.ts"));
    expect(template?.quoted.length ?? 0).toBeGreaterThanOrEqual(EXHAUSTIVE_THRESHOLD);
  });

  it("빠짐없이 담으려는 목록에는 분야가 하나도 빠지지 않았다", () => {
    const exhaustive = files.filter((f) => f.quoted.length >= EXHAUSTIVE_THRESHOLD);
    expect(exhaustive.length).toBeGreaterThan(3);

    const gaps = exhaustive
      .map((f) => ({ path: f.path, missing: checklistKeys.filter((key) => !f.quoted.includes(key)) }))
      .filter((f) => f.missing.length > 0);

    expect(
      gaps.map((f) => `${f.path} — 빠진 분야: ${f.missing.join(", ")}`),
      "분야 키를 빠짐없이 담아야 할 목록에서 분야가 빠졌다",
    ).toEqual([]);
  });

  /**
   * 예절 편 지도는 빠져도 조용하다 — 매핑이 없으면 `null`을 돌려주고 카드를 안 그리도록
   * 일부러 그렇게 만들었다. 죽은 링크보다 낫다는 판단이었고 지금도 맞다. 다만 "안 그린다"와
   * "그릴 편이 없다"는 다르므로, 새 분야가 편 없이 들어오면 여기서 말한다.
   *
   * 이 파일은 키를 `키:` 꼴로 적어 위 훑기(`"키"`)에 안 걸린다. 그래서 따로 본다.
   */
  it("예절 편 지도가 모든 분야를 안다", () => {
    const source = readFileSync(
      resolve(repoRoot, "apps/web/src/lib/manners/categoryMap.ts"),
      "utf8",
    );
    const mapped = new Set(
      Array.from(source.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"/gm), (m) => m[1]),
    );
    const missing = checklistKeys.filter((key) => !mapped.has(key));
    expect(missing, `예절 편이 이어지지 않은 분야: ${missing.join(", ")}`).toEqual([]);
  });
});
