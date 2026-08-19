// @vitest-environment node

import { readdirSync, readFileSync, statSync } from "node:fs";
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
 */
const SRC = resolve(process.cwd(), "src");

/** 저장으로 이어지는 함수. `updateJourneyLocal`은 화면 상태만 바꾸므로 제외한다. */
const PERSISTS = /\b(updateJourney|patchJourneyProgress)\s*\(/;

/** `checklist: <무언가>` 형태로 값을 실어 보내는 자리. */
const CHECKLIST_ASSIGN = /checklist:\s*([A-Za-z_$][\w$]*)\b/g;

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
  const persistingFiles = walk(SRC).filter((file) => PERSISTS.test(readFileSync(file, "utf8")));

  it("저장 함수를 부르는 파일을 실제로 찾아낸다", () => {
    expect(persistingFiles.length).toBeGreaterThan(2);
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
        const line = source.slice(0, match.index).split("\n").length;
        const where = relative(process.cwd(), file).split("\\").join("/");
        leaks.push(`${where}:${line} — checklist: ${value}`);
      }
    }

    expect(leaks, "저장 전에 stripPlanningChecklistNotes를 거치지 않는 자리").toEqual([]);
  });
});
