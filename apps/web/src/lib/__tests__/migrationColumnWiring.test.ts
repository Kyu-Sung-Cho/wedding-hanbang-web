import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// §18에서 이런 일이 있었다. 준비 상태(preparing/paused/called_off) 컬럼을 만들고,
// 공유 계약을 만들고, 프롬프트 게이트까지 만들고 "완료"라고 보고했다. 그런데
// `profiles.preparation_status`를 조회하는 코드가 저장소에 없어서 모든 사용자가
// 기본값이었다. 게이트 전체가 도달 불가능한 죽은 코드였고, 단위 테스트는 전부
// 초록불이었다 — 부품만 봤기 때문이다.
//
// 그래서 여기서는 부품이 아니라 **연결**을 본다. 마이그레이션이 만든 컬럼을
// 아무도(앱 코드도, SQL 함수·정책·트리거도) 쓰지 않으면 그 컬럼에 기댄 기능은
// 존재하지 않는다.
//
// ## 이 검사가 못 보는 것 (측정하면서 알게 된 것)
//
// - 이름 포함 여부만 본다. `select("*")`로 읽히거나 RPC 반환값에 실려 오는 것은
//   구분하지 못한다. 짧은 이름(`unit`, `options`, `context`)은 다른 식별자의 일부로
//   우연히 걸린다. 둘 다 **과소 보고** 방향이라, 여기 걸린 것은 진짜일 확률이 높고
//   여기 안 걸렸다고 안전한 것은 아니다.
// - 처음에 단어 경계(`\b`)로 찾다가 SQL 쪽을 전부 놓쳤다. PL/pgSQL이
//   `p_amora_claim_token`처럼 접두사를 붙여 쓰는데 `_` 앞에는 경계가 없다.
//   그때 76개를 "아무도 안 씀"으로 잘못 셌다.
//
// ## 왜 목록을 박아두나
//
// 지금 44개가 걸리는데 대부분 2026-04 설문·2026-02 이미지 검수처럼 삭제된 기능의
// 잔재다. 지우는 것은 별개 판단이라 여기서 하지 않는다. 이 테스트가 막는 것은
// **새로 생기는 것**이다.

const REPO_ROOT = resolve(process.cwd(), "../..");

/** 지금 아무도 쓰지 않는 컬럼. 늘어나면 실패한다. 줄어들면 이 목록에서 지운다. */
const KNOWN_UNUSED_COLUMNS = new Set([
  "ai_note",
  "auto_generated",
  "completion_time_seconds",
  "is_thumbnail",
  "q1_status",
  "q2_region",
  "q3_info_compare",
  "q4_cost_transparent",
  "q5_reservation_easy",
  "q6_price_gap",
  "q7_pain_points",
  "q7_other",
  "q8_planner_usage",
  "q8_1_planner_satisfaction",
  "q8_2_no_planner_reasons",
  "q8_2_other",
  "q9_commission_awareness",
  "q10_transparency_impact",
  "q11_main_channel",
  "q11_other",
  "q11_1_channel_satisfaction",
  "q12_dissatisfaction",
  "q12_other",
  "q13_feature_rank_1",
  "q13_feature_rank_2",
  "q13_feature_rank_3",
  "q14_ai_expectations",
  "q15_a_fair_price",
  "q15_b_max_price",
  "q16_payment_preference",
  "q17_interested_services",
  "q17_other",
  "q18_lacking_info",
  "q18_other",
  "q19_usage_intent",
  "q20_nps",
  "q21_feedback",
  "q22_gender",
  "q22_age",
  "q22_budget",
  "q23_contact",
  "reject_reason",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".expo") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|js|jsx)$/.test(entry)) out.push(path);
  }
  return out;
}

function readAll(): {
  addedColumns: Map<string, string>;
  appSource: string;
  migrationsWithoutDeclarations: string;
} {
  const migrationsDir = join(REPO_ROOT, "supabase/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const addedColumns = new Map<string, string>();
  const droppedColumns = new Set<string>();
  const sqlByFile = migrationFiles.map((file) =>
    readFileSync(join(migrationsDir, file), "utf8"),
  );

  sqlByFile.forEach((sql, index) => {
    for (const match of sql.matchAll(
      /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      if (!addedColumns.has(match[1])) addedColumns.set(match[1], migrationFiles[index]);
    }
    for (const match of sql.matchAll(
      /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      droppedColumns.add(match[1]);
    }
  });
  for (const dropped of droppedColumns) addedColumns.delete(dropped);

  // 선언만 지운 SQL. 여기 남아 있으면 함수·정책·트리거·인덱스가 그 컬럼을 쓴다.
  const migrationsWithoutDeclarations = sqlByFile
    .join("\n")
    .replace(/add\s+column\s+(?:if\s+not\s+exists\s+)?[a-z_][a-z0-9_]*/gi, " ");

  const appSource = ["apps/web/src", "apps/mobile/src", "apps/mobile/app", "packages/shared/src"]
    .flatMap((dir) => walk(join(REPO_ROOT, dir)))
    .filter((path) => !/__tests__|\.test\.|\.spec\./.test(path))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  return { addedColumns, appSource, migrationsWithoutDeclarations };
}

describe("마이그레이션이 만든 컬럼은 누군가 쓴다", () => {
  const { addedColumns, appSource, migrationsWithoutDeclarations } = readAll();

  const unused = [...addedColumns.keys()].filter(
    (column) =>
      !appSource.includes(column) && !migrationsWithoutDeclarations.includes(column),
  );

  it("아무도 쓰지 않는 컬럼이 새로 생기지 않는다", () => {
    const added = unused.filter((column) => !KNOWN_UNUSED_COLUMNS.has(column));

    // 실패하면 셋 중 하나다.
    //   1) 배선을 빠뜨렸다 — 컬럼을 읽거나 쓰는 코드를 넣어라. (§18이 이 경우였다)
    //   2) 이 기능은 아직 안 만든다 — 마이그레이션을 미루거나 목록에 근거와 함께 추가.
    //   3) `select("*")`로만 읽는다 — 컬럼 이름이 코드에 안 나타난다. 목록에 추가.
    expect(added, "배선 없는 새 컬럼").toEqual([]);
  });

  it("목록이 낡지 않는다 — 이미 쓰이게 된 컬럼은 지운다", () => {
    const stale = [...KNOWN_UNUSED_COLUMNS].filter(
      (column) => addedColumns.has(column) && !unused.includes(column),
    );

    // 목록이 실제보다 넓으면, 새로 생긴 죽은 컬럼을 여기가 덮어버린다.
    expect(stale, "이제 쓰이는데 목록에 남아 있는 컬럼").toEqual([]);
  });

  it("검사가 실제로 돌아간다", () => {
    // 스캐너가 조용히 0건을 내면 이 테스트는 영원히 통과한다. 오늘 세 번 그랬다.
    expect(addedColumns.size).toBeGreaterThan(200);
    expect(appSource.length).toBeGreaterThan(1_000_000);
    expect(migrationsWithoutDeclarations.length).toBeGreaterThan(1_000_000);
    // 실제로 쓰이는 컬럼이 대다수여야 한다. 전부 "안 쓰임"이면 스캐너가 깨진 것이다.
    expect(unused.length).toBeLessThan(addedColumns.size / 3);
  });
});
