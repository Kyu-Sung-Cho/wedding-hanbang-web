// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

type DeleteAction = "CASCADE" | "RESTRICT" | "SET NULL";
type ContractSource = "baseline" | "0900" | "0920" | "1080";

type AuthFkSpec = {
  constraint: string;
  table: string;
  column: string;
  deleteAction: DeleteAction;
  nullable: boolean;
  source: ContractSource;
};

type AuthFkInventoryRow = {
  constraint_name: string;
  table_name: string;
  column_name: string;
  nullable: boolean;
  delete_action: string;
  update_action: string;
  match_type: string;
  validated: boolean;
  deferrable: boolean;
  initially_deferred: boolean;
};

const projectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), `../../${path}`), "utf8").replace(
    /\r\n/g,
    "\n",
  );

const migration = projectFile(
  "supabase/migrations/20260714164700_expand_account_deletion_integrity.sql",
);
const authFkMigration = projectFile(
  "supabase/migrations/20260716117000_account_deletion_auth_fk_contract.sql",
);
const memoryMigration = projectFile(
  "supabase/migrations/20260716090000_amora_memory_engine_v2.sql",
);
const mediationMigration = projectFile(
  "supabase/migrations/20260716092000_amora_mediation_confirmation.sql",
);
const uploadMigration = projectFile(
  "supabase/migrations/20260716108000_community_upload_service_fence.sql",
);
const storageSagaMigration = projectFile(
  "supabase/migrations/20260716113000_account_deletion_storage_saga.sql",
);
const releasePre = projectFile(
  "supabase/release-checks/amora-engine-v2-20260716-pre.sql",
);
const releasePost = projectFile(
  "supabase/release-checks/amora-engine-v2-20260716-post.sql",
);
const authFkInventorySql = projectFile("scripts/sql/auth-users-fk-inventory.sql");
const accountDeletionMigrations = `${migration}\n${authFkMigration}`;

function requiredBlock(sql: string, pattern: RegExp, label: string) {
  const block = sql.match(pattern)?.[0];
  if (!block) throw new Error(`missing ${label}`);
  return block;
}

const authFkReleasePre = requiredBlock(
  releasePre,
  /DO \$pre_auth_fk_1170\$[\s\S]*?\$pre_auth_fk_1170\$;/,
  "pre_auth_fk_1170 release block",
);
const authFkReleasePost = requiredBlock(
  releasePost,
  /DO \$post_auth_fk_1170\$[\s\S]*?\$post_auth_fk_1170\$;/,
  "post_auth_fk_1170 release block",
);
const authFkMigrationPostcondition = requiredBlock(
  authFkMigration,
  /DO \$postcondition\$[\s\S]*?\$postcondition\$;/,
  "1170 migration postcondition",
);
const prepareAuthFunction = requiredBlock(
  storageSagaMigration,
  /CREATE OR REPLACE FUNCTION public\.prepare_account_deletion_auth_delete\([\s\S]*?\$prepare_auth\$;/,
  "prepare_account_deletion_auth_delete function",
);

function textArray(block: string, variable: string) {
  const match = block.match(
    new RegExp(`${variable} text\\[\\] := ARRAY\\[([\\s\\S]*?)\\]::text\\[\\];`),
  );
  if (!match) throw new Error(`missing ${variable} contract array`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

const FINAL_AUTH_FKS = [
  { constraint: "ai_interactions_log_user_id_fkey", table: "ai_interactions_log", column: "user_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "amora_actions_created_by_fkey", table: "amora_actions", column: "created_by", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "amora_mediation_acceptances_user_id_fkey", table: "amora_mediation_acceptances", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "0920" },
  { constraint: "amora_memory_consents_user_id_fkey", table: "amora_memory_consents", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "0900" },
  { constraint: "amora_memory_jobs_user_id_fkey", table: "amora_memory_jobs", column: "user_id", deleteAction: "SET NULL", nullable: true, source: "0900" },
  { constraint: "amora_memory_settings_enabled_by_fkey", table: "amora_memory_settings", column: "enabled_by", deleteAction: "SET NULL", nullable: true, source: "0900" },
  { constraint: "amora_quote_checks_user_id_fkey", table: "amora_quote_checks", column: "user_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "chat_messages_sender_id_fkey", table: "chat_messages", column: "sender_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "chat_summaries_user_id_delete_cascade_fkey", table: "chat_summaries", column: "user_id", deleteAction: "CASCADE", nullable: true, source: "baseline" },
  { constraint: "cohort_contracts_user_id_fkey", table: "cohort_contracts", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "cohort_member_reports_reported_user_id_fkey", table: "cohort_member_reports", column: "reported_user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "cohort_member_reports_reporter_id_fkey", table: "cohort_member_reports", column: "reporter_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "cohort_members_user_id_fkey", table: "cohort_members", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "cohort_messages_author_id_fkey", table: "cohort_messages", column: "author_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "cohort_timeline_events_user_id_fkey", table: "cohort_timeline_events", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_achievements_user_id_fkey", table: "community_achievements", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_agent_personas_backing_user_id_fkey", table: "community_agent_personas", column: "backing_user_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "community_bookmarks_user_id_fkey", table: "community_bookmarks", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_comments_author_id_fkey", table: "community_comments", column: "author_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_poll_votes_user_id_fkey", table: "community_poll_votes", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_posts_author_id_fkey", table: "community_posts", column: "author_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_profiles_user_id_fkey", table: "community_profiles", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_reports_reporter_id_fkey", table: "community_reports", column: "reporter_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_streaks_user_id_fkey", table: "community_streaks", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_upload_sessions_user_id_fkey", table: "community_upload_sessions", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "1080" },
  { constraint: "community_votes_user_id_fkey", table: "community_votes", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "community_xp_log_user_id_fkey", table: "community_xp_log", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "couples_bride_id_fkey", table: "couples", column: "bride_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "couples_groom_id_fkey", table: "couples", column: "groom_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "customer_events_user_id_fkey", table: "customer_events", column: "user_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "fitting_requests_user_id_fkey", table: "fitting_requests", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "fitting_usage_user_id_fkey", table: "fitting_usage", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "guestbooks_owner_id_fkey", table: "guestbooks", column: "owner_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "messages_sender_id_fkey", table: "messages", column: "sender_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "profiles_id_fkey", table: "profiles", column: "id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "search_logs_user_id_fkey", table: "search_logs", column: "user_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "submission_verifications_user_id_fkey", table: "submission_verifications", column: "user_id", deleteAction: "CASCADE", nullable: true, source: "baseline" },
  { constraint: "user_fitting_photos_user_id_fkey", table: "user_fitting_photos", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "user_trust_scores_user_id_fkey", table: "user_trust_scores", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "vendor_bookings_receipt_verified_by_fkey", table: "vendor_bookings", column: "receipt_verified_by", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "vendor_favorites_user_id_fkey", table: "vendor_favorites", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "vendor_messages_customer_id_fkey", table: "vendor_messages", column: "customer_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "vendor_photo_likes_user_id_fkey", table: "vendor_photo_likes", column: "user_id", deleteAction: "CASCADE", nullable: false, source: "baseline" },
  { constraint: "vendor_reports_reporter_id_fkey", table: "vendor_reports", column: "reporter_id", deleteAction: "CASCADE", nullable: true, source: "baseline" },
  { constraint: "vendor_reviews_customer_id_fkey", table: "vendor_reviews", column: "customer_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "vendor_submissions_user_id_fkey", table: "vendor_submissions", column: "user_id", deleteAction: "CASCADE", nullable: true, source: "baseline" },
  { constraint: "vendor_views_viewer_id_fkey", table: "vendor_views", column: "viewer_id", deleteAction: "SET NULL", nullable: true, source: "baseline" },
  { constraint: "vendors_owner_id_fkey", table: "vendors", column: "owner_id", deleteAction: "RESTRICT", nullable: true, source: "baseline" },
] as const satisfies readonly AuthFkSpec[];

const BASELINE_AUTH_FKS = FINAL_AUTH_FKS.filter(
  (spec) => spec.source === "baseline",
);
const PENDING_AUTH_FKS = FINAL_AUTH_FKS.filter(
  (spec) => spec.source !== "baseline",
);

const SOLO_USER = "00000000-0000-4000-8000-000000000001";
const DEPARTING_PARTNER = "00000000-0000-4000-8000-000000000002";
const REMAINING_PARTNER = "00000000-0000-4000-8000-000000000003";
const SOLO_COUPLE = "10000000-0000-4000-8000-000000000001";
const PARTNERED_COUPLE = "10000000-0000-4000-8000-000000000002";

function identifier(value: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`unsafe fixture identifier: ${value}`);
  }
  return `"${value}"`;
}

function initialDeleteAction(spec: AuthFkSpec): DeleteAction {
  return spec.constraint === "vendors_owner_id_fkey"
    ? "SET NULL"
    : spec.deleteAction;
}

async function createContractTables(db: PGlite, specs: readonly AuthFkSpec[]) {
  const tables = [...new Set(specs.map((spec) => spec.table))];
  for (const table of tables) {
    await db.exec(
      `CREATE TABLE public.${identifier(table)} (id uuid PRIMARY KEY);`,
    );
  }

  for (const spec of specs) {
    if (spec.table === "profiles" && spec.column === "id") continue;
    await db.exec(`
      ALTER TABLE public.${identifier(spec.table)}
        ADD COLUMN ${identifier(spec.column)} uuid${spec.nullable ? "" : " NOT NULL"};
    `);
  }
}

async function addAuthConstraints(
  db: PGlite,
  specs: readonly AuthFkSpec[],
  phase: "initial" | "final",
) {
  for (const spec of specs) {
    const action = phase === "initial" ? initialDeleteAction(spec) : spec.deleteAction;
    await db.exec(`
      ALTER TABLE public.${identifier(spec.table)}
        ADD CONSTRAINT ${identifier(spec.constraint)}
        FOREIGN KEY (${identifier(spec.column)}) REFERENCES auth.users(id)
        ON DELETE ${action};
    `);
  }
}

async function installPendingAuthFks(db: PGlite) {
  await createContractTables(db, PENDING_AUTH_FKS);
  await addAuthConstraints(db, PENDING_AUTH_FKS, "final");
}

async function authFkInventory(db: PGlite) {
  const result = await db.query<AuthFkInventoryRow>(`
    SELECT
      constraint_record.conname::text AS constraint_name,
      relation_record.relname::text AS table_name,
      column_record.attname::text AS column_name,
      NOT column_record.attnotnull AS nullable,
      constraint_record.confdeltype::text AS delete_action,
      constraint_record.confupdtype::text AS update_action,
      constraint_record.confmatchtype::text AS match_type,
      constraint_record.convalidated AS validated,
      constraint_record.condeferrable AS deferrable,
      constraint_record.condeferred AS initially_deferred
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation_record
      ON relation_record.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    JOIN pg_catalog.pg_attribute AS column_record
      ON column_record.attrelid = constraint_record.conrelid
     AND constraint_record.conkey = ARRAY[column_record.attnum]::smallint[]
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'auth.users'::regclass
      AND namespace_record.nspname = 'public'
    ORDER BY constraint_record.conname
  `);
  return result.rows;
}

async function createBaselineDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
  `);
  await createContractTables(db, BASELINE_AUTH_FKS);
  await db.exec(`
    ALTER TABLE public.profiles
      ADD COLUMN couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL;
    ALTER TABLE public.chat_messages
      ADD COLUMN couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
      ADD COLUMN content text NOT NULL;
    ALTER TABLE public.chat_summaries ADD COLUMN summary text;
    ALTER TABLE public.customer_events
      ADD COLUMN couple_id uuid REFERENCES public.couples(id);
    CREATE TABLE public.customer_insights (
      id uuid PRIMARY KEY,
      couple_id uuid REFERENCES public.couples(id)
    );
    ALTER TABLE public.search_logs ADD COLUMN query text NOT NULL;
    CREATE TABLE public.wedding_journeys (
      id uuid PRIMARY KEY,
      couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE
    );

    CREATE TABLE public.account_deletion_jobs (
      id uuid PRIMARY KEY,
      user_id uuid,
      status text NOT NULL,
      claim_token uuid,
      quarantine_count integer NOT NULL DEFAULT 0,
      storage_verified_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE public.account_deletion_media_manifest (
      job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE CASCADE,
      source text NOT NULL,
      cleaned_at timestamptz
    );
  `);
  await addAuthConstraints(db, BASELINE_AUTH_FKS, "initial");
  await db.exec(`${prepareAuthFunction}\nALTER FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid) OWNER TO postgres;`);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES
      ('${SOLO_USER}'),
      ('${DEPARTING_PARTNER}'),
      ('${REMAINING_PARTNER}');
    INSERT INTO public.couples (id, bride_id, groom_id) VALUES
      ('${SOLO_COUPLE}', '${SOLO_USER}', NULL),
      ('${PARTNERED_COUPLE}', '${DEPARTING_PARTNER}', '${REMAINING_PARTNER}');
    INSERT INTO public.profiles (id, couple_id) VALUES
      ('${SOLO_USER}', '${SOLO_COUPLE}'),
      ('${DEPARTING_PARTNER}', '${PARTNERED_COUPLE}'),
      ('${REMAINING_PARTNER}', '${PARTNERED_COUPLE}');
    INSERT INTO public.chat_summaries (id, user_id, summary) VALUES
      ('20000000-0000-4000-8000-000000000001', '${SOLO_USER}', 'private'),
      ('20000000-0000-4000-8000-000000000002', '${DEPARTING_PARTNER}', 'private');
    INSERT INTO public.chat_messages (id, couple_id, sender_id, content) VALUES
      ('21000000-0000-4000-8000-000000000001', '${SOLO_COUPLE}', '${SOLO_USER}', 'solo history'),
      ('21000000-0000-4000-8000-000000000002', '${PARTNERED_COUPLE}', '${DEPARTING_PARTNER}', 'shared history');
    INSERT INTO public.customer_events (id, user_id, couple_id)
    VALUES ('30000000-0000-4000-8000-000000000001', '${SOLO_USER}', '${SOLO_COUPLE}');
    INSERT INTO public.customer_insights (id, couple_id)
    VALUES ('30000000-0000-4000-8000-000000000002', '${SOLO_COUPLE}');
    INSERT INTO public.search_logs (id, user_id, query)
    VALUES ('40000000-0000-4000-8000-000000000001', '${SOLO_USER}', 'dress');
    INSERT INTO public.wedding_journeys (id, couple_id)
    VALUES ('50000000-0000-4000-8000-000000000001', '${SOLO_COUPLE}');
  `);
  return db;
}

async function createDatabase() {
  const db = await createBaselineDatabase();
  await installPendingAuthFks(db);
  await db.exec(`BEGIN;\n${accountDeletionMigrations}\nCOMMIT;`);
  return db;
}

const actionCode = (action: DeleteAction) =>
  ({ CASCADE: "c", RESTRICT: "r", "SET NULL": "n" })[action];

describe("account deletion Auth FK integrity contract", () => {
  it("pins the observed 43-FK baseline and the exact five pending additions", async () => {
    expect(BASELINE_AUTH_FKS).toHaveLength(43);
    expect(PENDING_AUTH_FKS.map((spec) => `${spec.source}:${spec.constraint}`)).toEqual([
      "0920:amora_mediation_acceptances_user_id_fkey",
      "0900:amora_memory_consents_user_id_fkey",
      "0900:amora_memory_jobs_user_id_fkey",
      "0900:amora_memory_settings_enabled_by_fkey",
      "1080:community_upload_sessions_user_id_fkey",
    ]);
    expect(BASELINE_AUTH_FKS.map((spec) => spec.constraint)).toEqual(
      textArray(authFkReleasePre, "expected_names"),
    );
    expect(FINAL_AUTH_FKS.map((spec) => spec.constraint)).toEqual(
      textArray(authFkReleasePost, "expected_names"),
    );
    expect(FINAL_AUTH_FKS.map((spec) => spec.constraint)).toEqual(
      textArray(authFkMigrationPostcondition, "expected_names"),
    );

    const db = await createBaselineDatabase();
    try {
      await expect(db.exec(authFkReleasePre)).resolves.toBeDefined();
      expect(authFkInventorySql.match(/jsonb_agg\(/g)).toHaveLength(3);
      expect(authFkInventorySql).toMatch(
        /con\.confmatchtype::text AS confmatchtype/,
      );
      await expect(db.exec(authFkInventorySql)).resolves.toBeDefined();
      expect((await authFkInventory(db)).map((row) => row.constraint_name)).toEqual(
        BASELINE_AUTH_FKS.map((spec) => spec.constraint),
      );
      await installPendingAuthFks(db);
      await expect(db.exec(authFkReleasePre)).rejects.toThrow(
        /PRE_1170_AUTH_FK_CONTRACT_INVALID/,
      );
      expect((await authFkInventory(db)).map((row) => row.constraint_name)).toEqual(
        FINAL_AUTH_FKS.map((spec) => spec.constraint),
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("binds each pending FK to its 0900, 0920, or 1080 source migration", () => {
    const sources: Record<Exclude<ContractSource, "baseline">, string> = {
      "0900": memoryMigration,
      "0920": mediationMigration,
      "1080": uploadMigration,
    };

    for (const spec of PENDING_AUTH_FKS) {
      const source = sources[spec.source];
      const nullable = spec.nullable ? "" : "NOT\\s+NULL\\s+";
      expect(source).toMatch(
        new RegExp(
          `CREATE TABLE(?: IF NOT EXISTS)? public\\.${spec.table}\\s*\\([\\s\\S]*?\\b${spec.column}\\s+uuid\\s+${nullable}REFERENCES auth\\.users\\(id\\) ON DELETE ${spec.deleteAction}`,
          "i",
        ),
      );
    }
  });

  it("passes the exact final 48-FK action, nullability, MATCH, and validation contract", async () => {
    const db = await createDatabase();
    try {
      await expect(db.exec(authFkReleasePost)).resolves.toBeDefined();
      expect(await authFkInventory(db)).toEqual(
        FINAL_AUTH_FKS.map((spec) => ({
          constraint_name: spec.constraint,
          table_name: spec.table,
          column_name: spec.column,
          nullable: spec.nullable,
          delete_action: actionCode(spec.deleteAction),
          update_action: "a",
          match_type: "s",
          validated: true,
          deferrable: false,
          initially_deferred: false,
        })),
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects an extra public Auth FK", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        CREATE TABLE public.unreviewed_auth_reference (
          id uuid PRIMARY KEY,
          user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
        );
      `);
      await expect(db.exec(authFkReleasePost)).rejects.toThrow(
        /POST_1170_AUTH_FK_CONTRACT_INVALID/,
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a missing expected Auth FK", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.community_xp_log
          DROP CONSTRAINT community_xp_log_user_id_fkey;
      `);
      await expect(db.exec(authFkReleasePost)).rejects.toThrow(
        /POST_1170_AUTH_FK_CONTRACT_INVALID/,
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a wrong delete action even when name and columns are unchanged", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.amora_actions
          DROP CONSTRAINT amora_actions_created_by_fkey;
        ALTER TABLE public.amora_actions
          ADD CONSTRAINT amora_actions_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES auth.users(id)
          ON DELETE CASCADE;
      `);
      await expect(db.exec(authFkReleasePost)).rejects.toThrow(
        /POST_1170_AUTH_FK_CONTRACT_INVALID/,
      );
    } finally {
      await db.close();
    }
  }, 30_000);

  it("rejects a NOT NULL child that would make SET NULL fail at Auth deletion time", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        ALTER TABLE public.chat_messages
          ALTER COLUMN sender_id SET NOT NULL;
      `);
      await expect(db.exec(authFkReleasePost)).rejects.toThrow(
        /POST_1170_AUTH_FK_CONTRACT_INVALID/,
      );
      await db.exec(`BEGIN;\n${authFkMigration}\nCOMMIT;`);
      await expect(db.exec(authFkReleasePost)).resolves.toBeDefined();
      const column = await db.query<{ nullable: boolean }>(`
        SELECT NOT attnotnull AS nullable
        FROM pg_attribute
        WHERE attrelid = 'public.chat_messages'::regclass
          AND attname = 'sender_id'
          AND NOT attisdropped
      `);
      expect(column.rows).toEqual([{ nullable: true }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("requires both the vendor RESTRICT boundary and the exact DB review gate", async () => {
    const db = await createDatabase();
    try {
      await db.exec(authFkReleasePost);
      const vendorConstraint = (await authFkInventory(db)).find(
        (row) => row.constraint_name === "vendors_owner_id_fkey",
      );
      expect(vendorConstraint).toMatchObject({
        delete_action: "r",
        nullable: true,
      });

      await db.exec(`
        CREATE OR REPLACE FUNCTION public.prepare_account_deletion_auth_delete(
          p_job_id uuid,
          p_claim_token uuid
        )
        RETURNS boolean
        LANGUAGE sql
        AS $$ SELECT true $$;
      `);
      await expect(db.exec(authFkReleasePost)).rejects.toThrow(
        /POST_1170_AUTH_FK_CONTRACT_INVALID/,
      );
      await expect(
        db.exec(`BEGIN;\n${authFkMigration}\nCOMMIT;`),
      ).rejects.toThrow(/ACCOUNT_DELETE_VENDOR_REVIEW_GATE_INVALID/);
      await db.exec("ROLLBACK").catch(() => undefined);
    } finally {
      await db.exec("ROLLBACK").catch(() => undefined);
      await db.close();
    }
  }, 30_000);

  it("atomically removes personal derivatives and anonymizes tracking data", async () => {
    const db = await createDatabase();
    try {
      await db.query("DELETE FROM auth.users WHERE id = $1", [SOLO_USER]);

      const counts = await db.query<{
        profiles: number;
        summaries: number;
        couples: number;
        journeys: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM public.profiles WHERE id = '${SOLO_USER}') AS profiles,
          (SELECT count(*)::int FROM public.chat_summaries WHERE user_id = '${SOLO_USER}') AS summaries,
          (SELECT count(*)::int FROM public.couples WHERE id = '${SOLO_COUPLE}') AS couples,
          (SELECT count(*)::int FROM public.wedding_journeys WHERE couple_id = '${SOLO_COUPLE}') AS journeys
      `);
      const tracking = await db.query<{
        event_user: string | null;
        event_couple: string | null;
        insight_couple: string | null;
        search_user: string | null;
      }>(`
        SELECT
          (SELECT user_id FROM public.customer_events LIMIT 1) AS event_user,
          (SELECT couple_id FROM public.customer_events LIMIT 1) AS event_couple,
          (SELECT couple_id FROM public.customer_insights LIMIT 1) AS insight_couple,
          (SELECT user_id FROM public.search_logs LIMIT 1) AS search_user
      `);

      expect(counts.rows[0]).toEqual({ profiles: 0, summaries: 0, couples: 0, journeys: 0 });
      expect(tracking.rows[0]).toEqual({
        event_user: null,
        event_couple: null,
        insight_couple: null,
        search_user: null,
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("retains the couple and shared chat while anonymizing a departing partner", async () => {
    const db = await createDatabase();
    try {
      await db.query("DELETE FROM auth.users WHERE id = $1", [DEPARTING_PARTNER]);

      const couple = await db.query<{ bride_id: string | null; groom_id: string | null }>(
        "SELECT bride_id, groom_id FROM public.couples WHERE id = $1",
        [PARTNERED_COUPLE],
      );
      const remainingProfile = await db.query<{ couple_id: string | null }>(
        "SELECT couple_id FROM public.profiles WHERE id = $1",
        [REMAINING_PARTNER],
      );
      const retainedMessage = await db.query<{ sender_id: string | null }>(
        "SELECT sender_id FROM public.chat_messages WHERE couple_id = $1",
        [PARTNERED_COUPLE],
      );

      expect(couple.rows[0]).toEqual({ bride_id: null, groom_id: REMAINING_PARTNER });
      expect(remainingProfile.rows[0]?.couple_id).toBe(PARTNERED_COUPLE);
      expect(retainedMessage.rows).toEqual([{ sender_id: null }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it("blocks Auth deletion atomically while vendor ownership remains", async () => {
    const db = await createDatabase();
    try {
      await db.exec(`
        INSERT INTO public.vendors (id, owner_id)
        VALUES ('60000000-0000-4000-8000-000000000001', '${DEPARTING_PARTNER}');
      `);
      await expect(
        db.query("DELETE FROM auth.users WHERE id = $1", [DEPARTING_PARTNER]),
      ).rejects.toThrow();

      const state = await db.query<{ users: number; bride_id: string | null }>(`
        SELECT
          (SELECT count(*)::int FROM auth.users WHERE id = '${DEPARTING_PARTNER}') AS users,
          (SELECT bride_id FROM public.couples WHERE id = '${PARTNERED_COUPLE}') AS bride_id
      `);
      expect(state.rows[0]).toEqual({ users: 1, bride_id: DEPARTING_PARTNER });
    } finally {
      await db.close();
    }
  }, 30_000);

  it("is safe to re-run without changing the 48-FK contract", async () => {
    const db = await createDatabase();
    try {
      await expect(
        db.exec(`BEGIN;\n${accountDeletionMigrations}\nCOMMIT;`),
      ).resolves.toBeDefined();
      await expect(db.exec(authFkReleasePost)).resolves.toBeDefined();
      expect(await authFkInventory(db)).toHaveLength(48);
    } finally {
      await db.close();
    }
  }, 30_000);
});
