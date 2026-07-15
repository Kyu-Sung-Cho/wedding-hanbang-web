import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("raw customer tracking retirement", () => {
  it("removes automatic browser collection and keeps the endpoint request-independent", () => {
    const layout = read("src/app/(app)/AppClientLayout.tsx");
    const route = read("src/app/api/events/route.ts");

    expect(layout).not.toContain("usePageViewTracker");
    expect(layout).not.toContain("/api/events");
    expect(existsSync(resolve(process.cwd(), "src/hooks/useEventTracker.ts"))).toBe(false);
    expect(route).toContain("customer_event_collection_retired");
    expect(route).not.toContain("createClientFromRequest");
    expect(route).not.toContain("req.json");
    expect(route).not.toContain('from("customer_events")');
  });

  it("revokes client/vendor access, blocks new rows, and enforces a 90-day cleanup", () => {
    const migration = read(
      "../../supabase/migrations/20260713112000_retire_raw_customer_tracking.sql",
    );

    for (const table of ["customer_events", "search_logs"]) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "GRANT SELECT, DELETE ON TABLE public.customer_events TO service_role",
    );
    expect(migration).toContain(
      "GRANT DELETE ON TABLE public.search_logs TO service_role",
    );
    expect(migration).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE");
    expect(migration).not.toContain("GRANT ALL PRIVILEGES");
    expect(migration).toContain("expected_privileges text[]");
    expect(migration).toContain("ARRAY['DELETE', 'SELECT']::text[]");
    expect(migration).toContain("ARRAY['DELETE']::text[]");
    expect(migration).toContain("actual_privileges IS DISTINCT FROM expected_privileges");
    expect(migration).toContain("'MAINTAIN'");
    expect(migration).toContain("privilege_row.is_grantable");
    expect(migration).toContain("grantor_role.rolname <> 'postgres'");
    expect(migration).toContain("privilege_row.grantee = 0");
    expect(migration).toContain("raw-tracking table ACL provenance mismatch");
    expect(migration).toContain("pg_catalog.aclexplode(attribute_row.attacl)");
    expect(migration).toContain("raw-tracking column ACL remains");
    expect(migration).toContain("block_retired_raw_customer_tracking_writes");
    expect(migration).toContain("BEFORE INSERT OR UPDATE");
    expect(migration).toContain("interval '90 days'");
    expect(migration).toContain("enforce-raw-customer-tracking-retention");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.enforce_raw_customer_tracking_retention()");
  });
});
