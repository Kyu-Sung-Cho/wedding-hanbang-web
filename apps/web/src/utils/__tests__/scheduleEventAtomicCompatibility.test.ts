import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

const ATOMIC_MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260716112000_amora_atomic_mutation_coverage.sql",
  ),
  "utf8",
);
const PLAN_CHANGE_MIGRATION = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260731123000_couple_plan_change_write_boundary.sql",
  ),
  "utf8",
);

const EVENT = {
  id: "evt-existing",
  date: "2027-05-01",
  title: "드레스 최종 확인",
  status: "planned",
  completionCriteria: "수선 결과를 확인하고 인수하기",
  assignee: {
    kind: "member",
    profileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
  },
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
} as const;

function context(): ToolExecutionContext {
  return {
    coupleId: "10000000-0000-4000-8000-000000000001",
    requestKey:
      "chat:20000000-0000-4000-8000-000000000001:30000000-0000-4000-8000-000000000001",
    requestAttemptCount: 1,
    providerCallIndex: 1,
    weddingContext: {
      weddingDate: "2027-06-01",
      budget: 30_000_000,
      venue: null,
      progress: {
        __events: [EVENT],
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  };
}

describe("schedule execution fields atomic compatibility", () => {
  it("preserves execution fields through an Amora schedule update CAS", () => {
    const operation = buildAmoraAtomicToolOperation(
      "update_schedule_event",
      {
        event_id: EVENT.id,
        date: "2027-05-02",
      },
      context(),
    );

    expect(operation.result.success).toBe(true);
    expect(operation.domainMutation).toMatchObject({
      kind: "journey_progress_key_cas",
      expected: [EVENT],
      value: [
        expect.objectContaining({
          id: EVENT.id,
          date: "2027-05-02",
          status: "planned",
          completionCriteria: EVENT.completionCriteria,
          assignee: EVENT.assignee,
        }),
      ],
    });
  });

  it("keeps the deployed atomic event validator forward-compatible with optional keys", () => {
    const loopStart = ATOMIC_MIGRATION.indexOf("FOR v_event IN");
    const loopEnd = ATOMIC_MIGRATION.indexOf(
      "    END LOOP;",
      loopStart,
    );
    expect(loopStart).toBeGreaterThan(-1);
    expect(loopEnd).toBeGreaterThan(loopStart);

    const eventValidationBlock = ATOMIC_MIGRATION.slice(loopStart, loopEnd);
    expect(eventValidationBlock).toContain(
      "char_length(btrim(COALESCE(v_event ->> 'title', '')))",
    );
    expect(eventValidationBlock).not.toMatch(/v_event\s*-\s*ARRAY/);
    expect(eventValidationBlock).not.toContain("jsonb_object_keys(v_event)");
  });

  it("keeps event-only execution edits outside the two-person high-impact field set", () => {
    const functionStart = PLAN_CHANGE_MIGRATION.indexOf(
      "CREATE OR REPLACE FUNCTION public.couple_plan_change_is_high_impact",
    );
    const functionEnd = PLAN_CHANGE_MIGRATION.indexOf(
      "ALTER FUNCTION public.couple_plan_change_is_high_impact",
      functionStart,
    );
    expect(functionStart).toBeGreaterThan(-1);
    expect(functionEnd).toBeGreaterThan(functionStart);

    const highImpactFunction = PLAN_CHANGE_MIGRATION.slice(
      functionStart,
      functionEnd,
    );
    expect(highImpactFunction).toContain(
      "'budget', 'payer', 'responsibility', 'assigned_to'",
    );
    expect(highImpactFunction).not.toContain("'status', 'completionCriteria'");
    expect(highImpactFunction).not.toContain("'assignee'");
  });
});
