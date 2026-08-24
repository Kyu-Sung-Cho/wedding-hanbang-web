import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 처음 넣는 예산이 "두 가지 변경"으로 거절됐다.
 *
 *     예산 화면에서 "예식장 예산 2,000만원" 입력
 *     → "날짜·예산·식장 같은 공동 결정과 준비 현황 변경을 나누어 저장해 주세요."
 *     → 아무것도 저장되지 않음
 *
 * 한 가지만 했는데 나누라고 하니 빠져나갈 길이 없다.
 *
 * 예산 변경은 고영향이라 금액 외 필드가 하나라도 달라지면 거절하는데, 그
 * 카테고리에 항목이 아직 없으면 **항목을 만드는 것 자체**가 금액 외 변경으로
 * 잡혔다. 웹과 모바일 둘 다 아직 없는 카테고리에 금액을 넣을 때 항목을 함께
 * 만들어 보낸다.
 *
 * 2026-08-24 운영 실측: 저니 54개 중 33개가 고정 카테고리 항목이 하나도 없었다.
 * 웹·모바일 본문 그대로 400 을 재현했고, 이미 항목이 있는 카테고리는 200 이었다.
 *
 * 이 검사는 SQL 을 실행하지 않는다 — 조건이 파일에 살아 있는지만 본다.
 * 그래서 주석은 먼저 걷어낸다. 실제 동작은 스테이징에서 11가지 경우로 실측했고,
 * 그중 6가지는 **여전히 거절되어야 하는** 경우였다.
 */

const MIGRATION = "20260824160000_first_budget_entry_is_not_a_mixed_change.sql";

const sql = readFileSync(
  join(process.cwd(), "..", "..", "supabase", "migrations", MIGRATION),
  "utf8",
)
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("처음 넣는 예산이 거절되지 않는다", () => {
  it("규칙이 사는 함수 둘 다 고친다", () => {
    // 지출 델타 유무로 갈리는 두 경로다. 하나만 고치면 나머지가 남는다.
    expect(sql).toContain("FUNCTION public.couple_plan_change_exact_high_summary(");
    expect(sql).toContain(
      "FUNCTION public.couple_plan_change_exact_high_summary_before_manual_schedule(",
    );
  });

  it("예외는 새로 생기는 키에만 적용된다", () => {
    // 이미 있는 항목의 필드가 바뀌는 것은 예전 그대로 거절해야 한다.
    const occurrences = sql.split("v_old_residual IS NULL").length - 1;
    expect(occurrences).toBe(2);
  });

  it("허용하는 것은 최소 뼈대뿐이다", () => {
    const occurrences =
      sql.split("v_new_residual - ARRAY['category', 'status', 'label']::text[]").length - 1;
    expect(occurrences).toBe(2);
  });

  it("category 는 키와 같아야 한다", () => {
    expect(sql.split("v_new_residual ->> 'category' = v_key").length - 1).toBe(2);
  });

  it("status 는 정해진 값만 받는다 — 두 함수 모두", () => {
    // toContain 한 번이면 두 함수 중 하나에서 지워도 통과한다
    // (2026-08-24 적대적 검토가 재현). 나머지 조건과 같이 개수를 고정한다.
    expect(sql.split("'not_started', 'in_progress', 'completed'").length - 1).toBe(2);
  });

  it("label 은 문자열만 받는다 — 두 함수 모두", () => {
    expect(sql.split("jsonb_typeof(v_new_residual -> 'label') = 'string'").length - 1).toBe(2);
  });

  it("거절 자체를 없애지는 않았다", () => {
    // 조건만 좁힌 것이지, 혼합 변경 거절이 사라지면 안 된다.
    expect(sql).toContain("RAISE EXCEPTION 'COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA'");
  });

  it("원장에 등록돼 있다", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "..",
          "..",
          "supabase",
          "release-manifests",
          "vendor-disclosure-v2-20260718.json",
        ),
        "utf8",
      ),
    ) as { expandMigrations: { file: string }[] };
    expect(manifest.expandMigrations.some((entry) => entry.file === MIGRATION)).toBe(true);
  });
});
