// @vitest-environment node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 진행 현황을 저장하는 모든 경로가 항목 안내(`note`)를 떼고 보내는지 본다.
 *
 * DB는 체크리스트 항목을 `{id, label, done}` **정확히 그 세 키로만** 받는다
 * (`supabase/migrations/20260716112000_amora_atomic_mutation_coverage.sql`의
 * `AMORA_ATOMIC_CHECKLIST_ITEM_INVALID`). 템플릿이 들고 있는 `note`가 섞여 나가면
 * 저장이 거절된다 — 화면이 이상해지는 게 아니라 체크가 아예 안 눌린다.
 *
 * 2026-08-19에 note를 넣으면서 저장 경로를 두 곳으로 알고 고쳤는데 실제로는 다섯
 * 곳이었다. 세 곳은 이 파일이 아니라 아모라 원자 실행 테스트가 잡아 줬다. 그래서
 * 사람이 세는 대신 저장 함수를 부르는 파일을 전부 훑는다.
 *
 * 그런데 그 "전부"가 처음엔 `apps/web/src`뿐이어서 **모바일 저장 2곳을 그대로 놓쳤다**
 * (`apps/mobile/app/schedule/index.tsx`). 같은 템플릿을 공유하는 앱이 둘인데 한쪽만 훑은
 * 것이다. 이제 워크스페이스의 두 앱을 모두 본다. 모바일 화면은 `src`가 아니라 `app`
 * 아래에 있어서 디렉터리 이름도 같이 넓혔다 — 범위가 곧 이 테스트의 성능이다.
 */
const WORKSPACE = resolve(process.cwd(), "../..");
const ROOTS = [
  join(WORKSPACE, "apps", "web", "src"),
  join(WORKSPACE, "apps", "mobile", "app"),
  join(WORKSPACE, "apps", "mobile", "src"),
  join(WORKSPACE, "packages", "shared", "src"),
].filter((dir) => existsSync(dir));

/** 저장으로 이어지는 자리. 웹은 스토어 함수, 모바일은 `/api/journey` PATCH를 직접 부른다. */
const PERSISTS = /\b(updateJourney|patchJourneyProgress)\s*\(|["`]\/api\/journey["`]/;

/**
 * 저장 객체에 실리는 `checklist:` 값.
 *
 * 뒤에 `.`이 오면 `category.items`처럼 남의 것을 읽어 쓰는 표시용 계산이라 건너뛴다.
 * 우리가 만들어 실어 보내는 배열만 남긴다.
 */
const CHECKLIST_ASSIGN = /checklist:\s*([A-Za-z_$][\w$]*)(?![\w$.])/g

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === "__tests__" || entry === "node_modules" ? [] : walk(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe("체크리스트 저장 경로", () => {
  const persistingFiles = ROOTS.flatMap(walk)
    .filter((file) => PERSISTS.test(readFileSync(file, "utf8")));

  it("두 앱을 모두 훑는다", () => {
    // 웹만 훑던 시절에 모바일 유출을 놓쳤다. 두 앱이 다 잡히는지 먼저 확인한다.
    expect(ROOTS.some((dir) => dir.includes("mobile")), "모바일 경로가 목록에 없다").toBe(true);
    expect(persistingFiles.some((f) => f.includes("mobile")), "모바일에서 저장 파일을 못 찾았다").toBe(true);
    expect(persistingFiles.some((f) => f.includes(join("web", "src")))).toBe(true);
  });

  it("저장하는 파일은 항목 안내를 떼고 보낸다", () => {
    const leaks: string[] = [];

    for (const file of persistingFiles) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(CHECKLIST_ASSIGN)) {
        const value = match[1];
        // 떼고 보내는 호출이거나, 타입 선언·표시용 지역 변수는 통과.
        if (value === "stripPlanningChecklistNotes") continue;
        if (value === "ChecklistItem") continue;
        // 데모 모드 샘플. 메모리에만 있고 저장되지 않는다(authStore의 DEMO_JOURNEY).
        if (value === "buildDemoChecklist") continue;
        const line = source.slice(0, match.index).split("\n").length;
        const where = relative(process.cwd(), file).split("\\").join("/");
        leaks.push(`${where}:${line} — checklist: ${value}`);
      }
    }

    expect(leaks, "저장 전에 stripPlanningChecklistNotes를 거치지 않는 자리").toEqual([]);
  });
});
