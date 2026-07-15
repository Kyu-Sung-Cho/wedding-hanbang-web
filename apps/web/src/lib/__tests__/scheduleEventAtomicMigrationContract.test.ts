import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713103000_atomic_schedule_event_mutations.sql",
  ),
  "utf8",
);
const webSchedule = readFileSync(
  resolve(process.cwd(), "src/components/app/schedule/ScheduleContent.tsx"),
  "utf8",
);
const mobileSchedule = readFileSync(
  resolve(process.cwd(), "../mobile/app/schedule/index.tsx"),
  "utf8",
);

describe("atomic schedule event migration", () => {
  it("sends the stable event id on every update callsite", () => {
    expect(webSchedule.match(/operation: "update",\s+eventId:/g)).toHaveLength(3);
    expect(mobileSchedule).toMatch(
      /operation: "update",\s+eventId: existingEvent\.id,/,
    );
  });

  it("locks the couple journey and mutates one stable event id without replacing a stale array", () => {
    expect(migration.trimStart().startsWith("BEGIN;")).toBe(true);
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.mutate_journey_schedule_event");
    expect(migration).toMatch(
      /SELECT progress[\s\S]*?FROM public\.wedding_journeys[\s\S]*?WHERE couple_id = p_couple_id[\s\S]*?FOR UPDATE;/,
    );
    expect(migration).toContain("event_value ->> 'id' = p_event_id");
    expect(migration).toContain("v_current_event ->> 'updatedAt'");
    expect(migration).toContain("ERRCODE = '40001'");
    expect(migration).toMatch(/jsonb_array_elements\(v_events\) WITH ORDINALITY/);
    expect(migration).toContain("jsonb_set(v_progress, '{__events}', v_next_events, true)");
  });

  it("keeps the mutation service-only even though the API already checks couple ownership", () => {
    expect(migration).toContain("COALESCE(auth.role(), '') <> 'service_role'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.mutate_journey_schedule_event\(uuid, text, jsonb, text, text\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.mutate_journey_schedule_event\(uuid, text, jsonb, text, text\)[\s\S]*?TO service_role;/,
    );
  });

  it("aborts before writing when the existing event array is malformed", () => {
    expect(migration).toContain("journey schedule event payload is malformed");
    expect(migration).toMatch(
      /EXISTS \([\s\S]*?FROM jsonb_array_elements\(v_events\) AS event_value[\s\S]*?jsonb_typeof\(event_value\) IS DISTINCT FROM 'object'[\s\S]*?\)/,
    );
    expect(migration).toMatch(
      /count\(\*\) IS DISTINCT FROM count\(DISTINCT event_value ->> 'id'\)/,
    );
    expect(migration).toContain(
      "event_value ? 'memo' AND jsonb_typeof(event_value -> 'memo') IS DISTINCT FROM 'string'",
    );
  });

  it("preserves the optional mobile event time while rejecting malformed values", () => {
    expect(migration).toContain(
      "p_event ? 'time' AND (jsonb_typeof(p_event -> 'time') IS DISTINCT FROM 'string'",
    );
    expect(migration).toContain(
      "event_value ? 'time' AND (jsonb_typeof(event_value -> 'time') IS DISTINCT FROM 'string'",
    );
    expect(migration).toMatch(
      /'id', 'date', 'title', 'time', 'memo', 'categoryKey', 'sourceKey'/,
    );
  });
});
