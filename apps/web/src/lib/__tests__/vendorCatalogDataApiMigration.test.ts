import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationPath = resolve(
  repoRoot,
  "supabase/migrations/20260713104000_close_public_vendor_catalog_data_api.sql",
);

const catalogTables = [
  "vendors",
  "vendor_products",
  "vendor_images",
  "vendor_timeslots",
  "product_timeslots",
  "vendor_reviews",
  "vendor_staff",
  "staff_timeslots",
  "community_vendor_tags",
] as const;

describe("closed public vendor catalog Data API migration", () => {
  it("revokes every catalog read from browser roles and gives service_role only reviewed DML", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of catalogTables) {
      expect(sql, table).toContain(
        `REVOKE SELECT ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      );
    }

    const columnAclReset = sql.match(
      /-- Clear every surviving browser-role column ACL before the table-level lockdown\.([\s\S]*?)-- Catalog rows remain available only to trusted server operations\./,
    );
    expect(columnAclReset?.[1]).toBeTruthy();
    for (const table of catalogTables) {
      expect(columnAclReset?.[1], table).toContain(`('public', '${table}')`);
    }
    expect(columnAclReset?.[1]).toContain(
      "REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(columnAclReset?.[1]).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(columnAclReset?.[1]).toContain("DROP POLICY %I ON %I.%I");
    expect(columnAclReset?.[1]).toContain("policy_row.roles && ARRAY[");
    expect(columnAclReset?.[1]).toContain("pg_catalog.pg_attribute");
    expect(sql).toContain("GRANT SELECT ON TABLE public.vendors TO service_role;");
    expect(sql).toContain("GRANT SELECT ON TABLE public.vendor_products TO service_role;");
    expect(sql).toContain("GRANT DELETE ON TABLE public.vendor_reviews TO service_role;");
    for (const table of [
      "vendor_images",
      "vendor_timeslots",
      "product_timeslots",
      "vendor_staff",
      "staff_timeslots",
      "community_vendor_tags",
    ]) {
      expect(sql, table).not.toMatch(
        new RegExp(`GRANT\\s+(?:SELECT|INSERT|UPDATE|DELETE)[^;]*public\\.${table}[^;]*TO\\s+service_role`, "i"),
      );
    }
    expect(sql).not.toMatch(/GRANT\s+ALL(?:\s+PRIVILEGES)?[\s\S]*?TO\s+service_role/i);
    expect(sql).toContain("'MAINTAIN'");
    expect(sql).toContain("privilege_row.is_grantable");
    expect(sql).toContain("grantor_role.rolname <> 'postgres'");
    expect(sql).toContain("privilege_row.grantee = 0");
    expect(sql).toContain("vendor service_role table ACL provenance mismatch");
  });

  it("also closes legacy favorite and photo-like writes without altering existing rows", () => {
    const sql = readFileSync(migrationPath, "utf8");

    const interactionLockdown = sql.match(
      /-- Legacy clients could still toggle these user-owned catalog interactions([\s\S]*?)-- Historical posts remain visible/,
    );
    expect(interactionLockdown?.[1]).toBeTruthy();

    for (const table of ["vendor_favorites", "vendor_photo_likes"] as const) {
      expect(interactionLockdown?.[1], table).toContain(
        `('public', '${table}')`,
      );
      expect(interactionLockdown?.[1], table).toContain(
        `REVOKE INSERT, UPDATE, DELETE ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`,
      );
      expect(interactionLockdown?.[1], table).toContain(
        `CREATE POLICY ${table}_select_own`,
      );
    }

    expect(interactionLockdown?.[1]).toContain(
      "REVOKE INSERT (%s), UPDATE (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated",
    );
    expect(interactionLockdown?.[1]).toContain(
      "policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')",
    );
    expect(interactionLockdown?.[1]).toContain(
      "FOR SELECT TO authenticated USING (user_id = auth.uid())",
    );
    expect(interactionLockdown?.[1]).toContain(
      "GRANT SELECT ON TABLE public.vendor_favorites TO service_role;",
    );
    expect(interactionLockdown?.[1]).toContain(
      "GRANT DELETE ON TABLE public.vendor_photo_likes TO service_role;",
    );

    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(sql).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("removes vendor ids from direct community-post reads and makes all vendor storage private", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain(
      "REVOKE SELECT ON TABLE public.community_posts FROM PUBLIC, anon, authenticated;",
    );
    const communityGrant = sql.match(
      /GRANT SELECT \(([\s\S]*?)\) ON TABLE public\.community_posts TO anon, authenticated;/,
    );
    expect(communityGrant?.[1]).toBeTruthy();
    expect(communityGrant?.[1]).not.toContain("vendor_tags");
    expect(sql).toContain("GRANT SELECT ON TABLE public.community_posts TO service_role;");

    expect(sql).toContain(
      "UPDATE storage.buckets\nSET public = false\nWHERE id IN ('vendor-images', 'vendor-licenses');",
    );
    expect(sql).toContain("FROM pg_catalog.pg_policies AS policy_row");
    expect(sql).toContain("policy_row.roles && ARRAY[");
    expect(sql).toContain("COALESCE(policy_row.qual, '') LIKE '%vendor-images%'");
    expect(sql).toContain("COALESCE(policy_row.with_check, '') LIKE '%vendor-licenses%'");
    expect(sql).toContain("DROP POLICY %I ON storage.objects");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  });
});
