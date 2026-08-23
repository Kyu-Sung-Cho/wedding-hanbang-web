import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAmoraActionApprovalPolicy,
  getAmoraPendingActionTtlMs,
  SINGLE_APPROVAL_PENDING_ACTION_TTL_MS,
} from "@hanbang/shared";
import { MUTATING_TOOL_NAMES } from "@/lib/ai/mutationTools";
import { BETA_DISABLED_TOOL_NAMES } from "@/lib/ai/tools";

type MutatingToolName = (typeof MUTATING_TOOL_NAMES)[number];

/**
 * 2026-08-23 파운더 결정으로 두 사람 승인이 없어졌다. 한 사람이 확인하면 바로
 * 반영되고 상대에게는 알림이 간다.
 *
 * 이 파일이 지키던 것 중 **없어진 것은 정족수뿐**이다. 나머지는 그대로 지킨다:
 * 막힌 도구는 막혀 있어야 하고, 새 도구가 조용히 권한을 물려받으면 안 된다.
 *
 * 예전에는 "상대가 모르는 사이에 공유 일정이 박히는 것"을 정족수가 막았다.
 * 이제는 알림이 막는다. 그 알림은 도구 목록이 아니라 DB 트리거가 내므로
 * (아래 마지막 describe 참고) 여기서 목록을 단언해봐야 제품을 재는 게 아니다.
 */
const EXPECTED_POLICY_BY_MUTATING_TOOL = {
  update_budget: "single",
  update_wedding_date: "single",
  update_task_status: "single",
  update_venue: "single",
  update_category_budget: "single",
  apply_budget_plan: "single",
  delete_category: "blocked",
  reset_category: "blocked",
  update_schedule_event: "single",
  cancel_schedule_event: "single",
  restore_schedule_event: "single",
  delete_schedule_event: "blocked",
  toggle_checklist_item: "single",
  update_amora_action: "blocked",
  cancel_booking: "blocked",
  add_custom_category: "single",
  add_schedule_event: "single",
  add_amora_action: "single",
  log_wedding_event: "single",
  create_booking: "blocked",
} as const satisfies Record<MutatingToolName, "single" | "couple" | "blocked">;

describe("Amora action approval policy", () => {
  it.each([
    "update_budget",
    "update_wedding_date",
    "update_venue",
    "apply_budget_plan",
  ])("한 사람 확인으로 %s 를 반영한다", (toolName) => {
    expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("single");
  });

  it("카테고리 예산은 금액이 있든 없든 한 사람 확인이다", () => {
    // 예전에는 금액이 있으면 두 사람이었다. 이제 갈리지 않는다.
    expect(
      getAmoraActionApprovalPolicy("update_category_budget", {
        category: "venue",
        budget: 0,
        spent: 1_000_000,
      }),
    ).toBe("single");
    expect(
      getAmoraActionApprovalPolicy("update_category_budget", {
        category: "venue",
        spent: 1_000_000,
      }),
    ).toBe("single");
  });

  it.each([
    "update_task_status",
    "add_custom_category",
    "toggle_checklist_item",
    "add_amora_action",
  ])("되돌릴 수 있는 작업 %s 도 그대로 한 사람 확인이다", (toolName) => {
    expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("single");
  });

  it("일정은 성격과 무관하게 한 사람 확인이다", () => {
    for (const scheduleScope of [
      undefined,
      "confirmed_fact",
      "shared_commitment",
      "external_commitment",
      "unknown_future_scope",
    ]) {
      expect(getAmoraActionApprovalPolicy("add_schedule_event", {
        ...(scheduleScope ? { schedule_scope: scheduleScope } : {}),
      })).toBe("single");
    }
    expect(getAmoraActionApprovalPolicy("update_schedule_event", {})).toBe("single");
  });

  it("막힌 도구와 모르는 도구는 그대로 막혀 있다", () => {
    // 승인을 한 사람으로 줄인 것과, 아모라가 아예 손대지 않기로 한 것을 푸는 것은
    // 다른 이야기다. 이 단언은 이번 변경으로 약해지지 않는다.
    for (const toolName of BETA_DISABLED_TOOL_NAMES) {
      expect(getAmoraActionApprovalPolicy(toolName, {})).toBe("blocked");
    }

    expect(getAmoraActionApprovalPolicy("unknown_future_mutation", {})).toBe("blocked");
    expect(getAmoraActionApprovalPolicy("search_vendors", {})).toBe("blocked");
    expect(getAmoraActionApprovalPolicy("update_amora_action", {})).toBe("blocked");
  });

  it("모든 변경 도구가 표에 있고 표와 실제가 같다", () => {
    expect(new Set(Object.keys(EXPECTED_POLICY_BY_MUTATING_TOOL))).toEqual(
      new Set(MUTATING_TOOL_NAMES),
    );

    for (const toolName of MUTATING_TOOL_NAMES) {
      const input = (
        toolName === "update_category_budget"
        || toolName === "add_custom_category"
      )
        ? { budget: 1 }
        : {};
      expect(getAmoraActionApprovalPolicy(toolName, input)).toBe(
        EXPECTED_POLICY_BY_MUTATING_TOOL[toolName],
      );
    }
  });

  it("어떤 도구도 'couple' 을 돌려주지 않는다", () => {
    // DB(`amora_shared_action_policy`)와 짝이다. 한쪽만 바뀌면 TTL 기대값이
    // 어긋나 사용자 카드가 만료로 죽는다.
    for (const toolName of MUTATING_TOOL_NAMES) {
      expect(getAmoraActionApprovalPolicy(toolName, { budget: 1 })).not.toBe("couple");
    }
  });

  it("발급 TTL이 DB가 허용하는 두 값 중 하나다", () => {
    // `amora_shared_action_context_pre_roster_binding` 는 `expires_at - issued_at`
    // 이 600000 또는 86400000 인지만 본다. 다른 값을 발급하면 사용자 카드가
    // `AMORA_SHARED_ACTION_EXPIRED` 로 죽는다.
    for (const toolName of MUTATING_TOOL_NAMES) {
      if (getAmoraActionApprovalPolicy(toolName, {}) === "blocked") continue;
      expect([600_000, 86_400_000]).toContain(getAmoraPendingActionTtlMs(toolName, {}));
    }
  });

  it("공유 계획 변경에는 넉넉한 창을, 즉시 누르는 것에는 짧은 창을 준다", () => {
    expect(SINGLE_APPROVAL_PENDING_ACTION_TTL_MS).toBe(600_000);
    // 금액을 한 번 더 생각하러 자리를 뜰 수 있는 변경들.
    for (const toolName of ["update_budget", "update_wedding_date", "update_venue"]) {
      expect(getAmoraPendingActionTtlMs(toolName, {})).toBe(86_400_000);
    }
    // 대화 안에서 바로 누르는 것들.
    for (const toolName of ["toggle_checklist_item", "update_task_status"]) {
      expect(getAmoraPendingActionTtlMs(toolName, {})).toBe(600_000);
    }
  });

});

describe("상대 알림은 도구 목록이 아니라 트리거가 낸다", () => {
  // 처음 이 파일을 고칠 때 나는 `SHARED_PLAN_TOOLS` 를 알림 관문처럼 단언했다.
  // 그런데 아무도 그 함수를 부르지 않았고, 실제 알림은 아래 트리거가 도구를
  // 가리지 않고 낸다. 목록 단언은 제품이 아니라 목록 자신을 재는 테스트였다.
  const migrations = join(process.cwd(), "..", "..", "supabase", "migrations");
  const approvalSql = readFileSync(
    join(migrations, "20260730102000_amora_shared_action_approval_and_notifications.sql"),
    "utf8",
  );

  it("완료 알림 트리거가 모든 적용에 붙어 있다", () => {
    expect(approvalSql).toContain("CREATE TRIGGER trg_notify_amora_shared_action_completion");
    expect(approvalSql).toContain("ON public.amora_tool_executions");
  });

  it("트리거가 도구 이름이나 승인 정책으로 거르지 않는다", () => {
    const body = approvalSql.slice(
      approvalSql.indexOf("FUNCTION public.notify_amora_shared_action_completion"),
      approvalSql.indexOf("CREATE TRIGGER trg_notify_amora_shared_action_completion"),
    );
    expect(body.length).toBeGreaterThan(0);
    // 이 두 가지로 거르기 시작하면 어떤 변경은 상대가 영영 모르게 된다.
    expect(body).not.toContain("amora_shared_action_policy");
    expect(body).not.toMatch(/NEW\.tool_name\s*(=|IN|<>)/);
  });

  it("알림은 행위자가 아니라 상대에게 간다", () => {
    const body = approvalSql.slice(
      approvalSql.indexOf("FUNCTION public.notify_amora_shared_action_completion"),
      approvalSql.indexOf("CREATE TRIGGER trg_notify_amora_shared_action_completion"),
    );
    expect(body).toContain("AMORA_SHARED_ACTION_NOTIFICATION_RECIPIENT_INVALID");
    expect(body).toContain("'change_applied'");
  });
});

describe("앱에서 직접 고쳐도 상대에게 알림이 간다", () => {
  const migrations = join(process.cwd(), "..", "..", "supabase", "migrations");
  const boundarySql = readFileSync(
    join(migrations, "20260731123000_couple_plan_change_write_boundary.sql"),
    "utf8",
  );

  it("1인 적용 경로가 상대에게 새 알림 행을 넣는다", () => {
    expect(boundarySql).toContain("IF v_request.required_count = 1 THEN");
    expect(boundarySql).toContain("함께 쓰는 계획이 변경됐어요");
  });

  it("고영향 판정이 꺼져 모든 변경이 1인 경로로 간다", () => {
    const sql = readFileSync(
      join(migrations, "20260823120000_couple_approval_becomes_notification.sql"),
      "utf8",
    );
    expect(sql).toContain("FUNCTION public.couple_plan_change_is_high_impact");
    expect(sql).toContain("SELECT false;");
  });

  it("DB의 TTL 검증이 정책에서 떨어져 두 값을 모두 받는다", () => {
    // 되돌아가면 이미 발급된 24시간 카드가 전부 만료로 죽는다.
    const sql = readFileSync(
      join(migrations, "20260823120000_couple_approval_becomes_notification.sql"),
      "utf8",
    );
    expect(sql).toContain("FUNCTION public.amora_shared_action_context_pre_roster_binding");
    expect(sql).toContain("NOT IN (600000, 86400000)");
    expect(sql).not.toContain("v_expires_at - v_issued_at <> v_expected_ttl_ms");
  });

  it("DB 정책도 'couple' 을 돌려주지 않는다", () => {
    const sql = readFileSync(
      join(migrations, "20260823120000_couple_approval_becomes_notification.sql"),
      "utf8",
    );
    const policy = sql.slice(sql.indexOf("FUNCTION public.amora_shared_action_policy"));
    // 주석에 옛 이름이 남아 있어도 되지만, **돌려주는 값**에 있으면 안 된다.
    expect(policy).not.toMatch(/THEN\s*'couple'/);
    // 막힌 것은 그대로 막혀 있어야 한다.
    expect(policy).toContain("'blocked'");
    expect(policy).toContain("create_booking");
    expect(policy).toContain("delete_schedule_event");
  });
});
