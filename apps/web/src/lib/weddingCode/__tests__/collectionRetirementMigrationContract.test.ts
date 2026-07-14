import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsPath = resolve(process.cwd(), "../../supabase/migrations");
const tableCreatorMigration =
  "20260705160000_wedding_code_responses.sql";
const retirementMigration =
  "20260714104000_disable_wedding_code_collection.sql";
const tableCreatorPath = resolve(migrationsPath, tableCreatorMigration);
const migrationPath = resolve(migrationsPath, retirementMigration);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("WeddingCode collection retirement migration contract", () => {
  it("runs after the origin/main table creator", () => {
    const orderedMigrations = [tableCreatorMigration, retirementMigration];

    expect([...orderedMigrations].sort()).toEqual(orderedMigrations);
    expect(readFileSync(tableCreatorPath, "utf8")).toMatch(
      /CREATE TABLE(?: IF NOT EXISTS)? public\.wedding_code_responses/
    );
  });

  it("creates the still-pending response table fail-closed without a migration gap", () => {
    const creator = readFileSync(tableCreatorPath, "utf8");

    expect(creator).toMatch(
      /REVOKE ALL ON public\.wedding_code_responses\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(creator).not.toMatch(
      /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[\s\S]*wedding_code_responses/i
    );
    expect(creator).not.toMatch(/CREATE POLICY\s+wc_responses_service_only/i);
    expect(creator).toMatch(
      /ADD CONSTRAINT wedding_code_collection_retired\s+CHECK \(false\) NOT VALID;/
    );
  });

  it("is a safe no-op for table DDL when the response table is already absent", () => {
    const migration = readMigration();
    const guardedBlocks = [
      "lock_wedding_code_table_if_present",
      "revoke_table_acl_if_present",
      "revoke_column_acl",
      "drop_wedding_code_policies",
      "verify_wedding_code_policies_absent",
      "install_retirement_fence_if_present",
    ];

    for (const blockName of guardedBlocks) {
      const block = migration.match(
        new RegExp(`DO \\$${blockName}\\$[\\s\\S]*?\\$${blockName}\\$;`)
      )?.[0];

      expect(block, `${blockName} must be present`).toBeDefined();
      expect(block, `${blockName} must resolve the table safely`).toContain(
        "pg_catalog.to_regclass('public.wedding_code_responses')"
      );
    }

    const finalVerification = migration.match(
      /DO \$verify_collection_retirement\$[\s\S]*?\$verify_collection_retirement\$;/
    )?.[0];
    expect(finalVerification).toBeDefined();
    expect(finalVerification).toContain("IF v_table IS NULL THEN");
    expect(finalVerification).toContain("RETURN;");
    expect(finalVerification!.indexOf("v_insert_overload_count <> 0")).toBeLessThan(
      finalVerification!.indexOf("IF v_table IS NULL THEN")
    );
  });

  it("blocks every new insert and update without scanning or changing preserved rows", () => {
    const migration = readMigration();

    expect(migration).toContain("SET lock_timeout = '5s';");
    expect(migration).toContain("SET statement_timeout = '30s';");
    expect(migration).toMatch(
      /ALTER TABLE public\.wedding_code_responses\s+DROP CONSTRAINT IF EXISTS wedding_code_collection_retired,\s+ADD CONSTRAINT wedding_code_collection_retired\s+CHECK \(false\) NOT VALID;/
    );
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT wedding_code_collection_retired/);
    expect(migration).not.toMatch(
      /\b(?:UPDATE|DELETE FROM|TRUNCATE(?: TABLE)?)\s+public\.wedding_code_responses\b/i
    );
  });

  it("takes the table lock before revoking access and installing the fence", () => {
    const migration = readMigration();
    const timeout = migration.indexOf("SET statement_timeout = '30s';");
    const tableLock = migration.indexOf(
      "LOCK TABLE public.wedding_code_responses IN ACCESS EXCLUSIVE MODE;"
    );
    const tableRevoke = migration.indexOf(
      "REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER"
    );
    const writeFence = migration.indexOf(
      "ADD CONSTRAINT wedding_code_collection_retired"
    );

    expect(timeout).toBeGreaterThanOrEqual(0);
    expect(tableLock).toBeGreaterThan(timeout);
    expect(tableRevoke).toBeGreaterThan(tableLock);
    expect(writeFence).toBeGreaterThan(tableRevoke);
  });

  it("removes table access from every application role", () => {
    const migration = readMigration();

    expect(migration).toMatch(
      /REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.wedding_code_responses\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(migration).not.toMatch(
      /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|EXECUTE)[\s\S]*wedding_code/i
    );
  });

  it("retires every insert RPC overload while allowing the RPC to be already absent", () => {
    const migration = readMigration();
    const dropInsertOverloads = migration.match(
      /DO \$drop_insert_overloads\$[\s\S]*?\$drop_insert_overloads\$;/
    )?.[0];

    expect(dropInsertOverloads).toBeDefined();
    expect(dropInsertOverloads).toContain(
      "procedure_row.proname = 'insert_wedding_code_response'"
    );
    expect(dropInsertOverloads).toContain(
      "pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)"
    );
    expect(dropInsertOverloads).toContain("'%I.%I(%s)'");
    expect(dropInsertOverloads).toContain(
      "'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role'"
    );
    expect(dropInsertOverloads).toContain(
      "pg_catalog.format('DROP FUNCTION %s', v_signature)"
    );
    expect(
      dropInsertOverloads!.indexOf("REVOKE EXECUTE ON FUNCTION %s")
    ).toBeLessThan(dropInsertOverloads!.indexOf("DROP FUNCTION %s"));
    expect(dropInsertOverloads).not.toMatch(/\bCASCADE\b/);
    expect(migration).toMatch(
      /pg_catalog\.pg_proc[\s\S]*proname = 'insert_wedding_code_response'[\s\S]*INSERT_WEDDING_CODE_RESPONSE_STILL_PRESENT/
    );
    expect(migration).toContain("SELECT pg_catalog.count(*)");
    expect(migration).toContain("v_insert_overload_count <> 0");
    expect(migration).not.toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.insert_wedding_code_response\(/
    );
    expect(migration).not.toContain(
      "WEDDING_CODE_INSERT_RPC_SIGNATURE_MISSING"
    );
  });

  it("retires the pairing RPC idempotently and fails if any overload survives", () => {
    const migration = readMigration();
    const dropPairingOverloads = migration.match(
      /DO \$drop_pairing_overloads\$[\s\S]*?\$drop_pairing_overloads\$;/
    )?.[0];

    expect(migration).toMatch(
      /to_regprocedure\(\s*'public\.pair_wedding_code_response\(uuid,uuid\)'\s*\)[\s\S]*REVOKE EXECUTE ON FUNCTION public\.pair_wedding_code_response\(UUID, UUID\) FROM PUBLIC, anon, authenticated, service_role/
    );
    expect(dropPairingOverloads).toBeDefined();
    expect(dropPairingOverloads).toContain(
      "procedure_row.proname = 'pair_wedding_code_response'"
    );
    expect(dropPairingOverloads).toContain(
      "pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)"
    );
    expect(dropPairingOverloads).toContain("'%I.%I(%s)'");
    expect(dropPairingOverloads).toContain("ORDER BY qualified_signature");
    expect(
      dropPairingOverloads!.indexOf("REVOKE EXECUTE ON FUNCTION %s")
    ).toBeLessThan(dropPairingOverloads!.indexOf("DROP FUNCTION %s"));
    expect(dropPairingOverloads).not.toMatch(/\bCASCADE\b/);
    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.pair_wedding_code_response(UUID, UUID);"
    );
    expect(migration).toMatch(
      /pg_catalog\.pg_proc[\s\S]*proname = 'pair_wedding_code_response'[\s\S]*PAIR_WEDDING_CODE_RESPONSE_STILL_PRESENT/
    );
    expect(migration).toMatch(
      /COMMENT ON TABLE public\.wedding_code_responses[\s\S]*Historical rows are preserved; any deletion requires a separate approved retention\/purge migration\./
    );
  });

  it("removes column ACL drift and every stale RLS policy", () => {
    const migration = readMigration();

    expect(migration).toMatch(
      /pg_catalog\.pg_attribute[\s\S]*attribute_row\.attnum > 0[\s\S]*NOT attribute_row\.attisdropped/
    );
    expect(migration).toContain("pg_catalog.format('%I', attribute_row.attname)");
    expect(migration).toContain(
      "ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::TEXT[]"
    );
    expect(migration).toMatch(
      /REVOKE %s \(%s\) ON TABLE public\.wedding_code_responses FROM PUBLIC, anon, authenticated, service_role/
    );
    expect(migration).toMatch(
      /DROP POLICY IF EXISTS wc_responses_service_only\s+ON public\.wedding_code_responses;/
    );
    expect(migration).toMatch(
      /pg_catalog\.pg_policy[\s\S]*WEDDING_CODE_RESPONSE_POLICY_STILL_PRESENT/
    );
  });

  it("fails the migration when the final ACL or constraint contract drifts", () => {
    const migration = readMigration();

    expect(migration).toContain("pg_catalog.has_table_privilege");
    expect(migration).toContain("pg_catalog.has_column_privilege");
    expect(migration).toMatch(
      /constraint_row\.conname = 'wedding_code_collection_retired'[\s\S]*NOT constraint_row\.convalidated[\s\S]*pg_catalog\.pg_get_expr/
    );
    expect(migration).toContain("WEDDING_CODE_TABLE_ACL_STILL_OPEN");
    expect(migration).toContain("WEDDING_CODE_COLUMN_ACL_STILL_OPEN");
    expect(migration).toContain(
      "INSERT_WEDDING_CODE_RESPONSE_STILL_PRESENT"
    );
    expect(migration).not.toContain("pg_catalog.has_function_privilege");
    expect(migration).toContain("WEDDING_CODE_RETIREMENT_CONSTRAINT_MISMATCH");
  });
});
