import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";

// 승인 인원은 두 층에서 판정된다. 앱은 확인을 몇 명한테 받을지 정하고, DB는 실행
// 시점에 같은 판정을 다시 한다. 두 층이 어긋나면 한쪽이 조용히 무력해진다 —
// 실제로 2026-07-30 판 SQL은 `add_schedule_event`를 무조건 single로 두고 있었고,
// TS는 그때도 성격에 따라 couple이었다. 그 어긋남은 8월 초에야 고쳐졌다.
//
// 그래서 이 파일은 두 가지를 한다.
//   1. 새 마이그레이션을 진짜 Postgres(PGlite)에 실행해 문법과 postcheck를 확인한다.
//   2. 변경 가능한 모든 도구에 대해 TS와 SQL의 판정이 같은지 대조한다.

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260805120000_amora_log_wedding_event_couple_approval.sql",
);

/** SQL 정책 함수가 실제로 받는 모양에 가까운 입력. 없으면 빈 객체. */
const REPRESENTATIVE_INPUT: Readonly<Record<string, Record<string, unknown>>> = {
  add_schedule_event: { date: "2027-03-12", schedule_scope: "shared_commitment" },
  log_wedding_event: { moment_type: "venue_tour", date: "2027-03-12" },
  update_category_budget: { category: "venue", budget: 1_000_000 },
  add_custom_category: { label: "예단", budget: 1_000_000 },
};

describe("log_wedding_event couple approval migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    // 마이그레이션 안의 postcheck 블록이 여기서 함께 실행된다. 판정이 어긋나면
    // 이 줄에서 예외가 나며 테스트가 실패한다.
    await db.exec(await readFile(migrationPath, "utf8"));
  });

  afterEach(async () => {
    await db.close();
  });

  async function policyOf(tool: string, input: Record<string, unknown>): Promise<string> {
    const result = await db.query<{ policy: string }>(
      "SELECT public.amora_shared_action_policy($1, $2::jsonb) AS policy",
      [tool, JSON.stringify(input)],
    );
    return result.rows[0].policy;
  }

  it("requires both members to put a wedding moment on the shared calendar", async () => {
    // 미래든 과거든 같다. 이 도구의 입력에는 성격을 밝힐 자리가 없고
    // (moment_type·date·title·memo뿐), 모르면 더 조심하는 쪽으로 간다.
    expect(await policyOf("log_wedding_event", {
      moment_type: "venue_tour",
      date: "2027-03-12",
    })).toBe("couple");
    expect(await policyOf("log_wedding_event", {
      moment_type: "sanggyeonrye",
      date: "2020-03-12",
    })).toBe("couple");
  });

  it("keeps the single-member path for a fact whose scope is stated", async () => {
    expect(await policyOf("add_schedule_event", {
      date: "2020-03-12",
      schedule_scope: "confirmed_fact",
    })).toBe("single");
  });

  it("leaves every unrelated tool exactly where it was", async () => {
    expect(await policyOf("toggle_checklist_item", {})).toBe("single");
    expect(await policyOf("add_amora_action", {})).toBe("single");
    expect(await policyOf("update_task_status", {})).toBe("single");
    expect(await policyOf("update_budget", {})).toBe("couple");
    expect(await policyOf("cancel_schedule_event", {})).toBe("couple");
    expect(await policyOf("delete_schedule_event", {})).toBe("blocked");
    expect(await policyOf("create_booking", {})).toBe("blocked");
  });

  it("agrees with the TypeScript policy for every mutating tool", async () => {
    // 이 대조가 이 파일의 핵심이다. 한쪽만 고치면 여기서 걸린다.
    for (const tool of MUTATING_TOOL_NAMES) {
      const input = REPRESENTATIVE_INPUT[tool] ?? {};
      expect(await policyOf(tool, input)).toBe(getAmoraActionApprovalPolicy(tool, input));
    }
  });

  it("blocks a tool name it has never heard of instead of guessing", async () => {
    expect(await policyOf("some_future_tool", {})).toBe("blocked");
    expect(getAmoraActionApprovalPolicy("some_future_tool", {})).toBe("blocked");
  });

  it("refuses a non-object input rather than reading a scope out of it", async () => {
    const result = await db.query<{ policy: string }>(
      "SELECT public.amora_shared_action_policy($1, $2::jsonb) AS policy",
      ["add_schedule_event", JSON.stringify("confirmed_fact")],
    );
    expect(result.rows[0].policy).toBe("blocked");
  });
});
