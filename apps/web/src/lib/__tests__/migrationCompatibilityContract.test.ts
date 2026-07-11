import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const migrationsDir = resolve(repoRoot, "supabase/migrations");
const contractDir = resolve(repoRoot, "supabase/contract-migrations");

const amoraMigration = readFileSync(
  resolve(migrationsDir, "20260710050000_amora_request_claims.sql"),
  "utf8"
);
const uploadMigration = readFileSync(
  resolve(migrationsDir, "20260710080000_atomic_community_upload_quota.sql"),
  "utf8"
);
const legacyCommunityRpcMigration = readFileSync(
  resolve(migrationsDir, "20260613130000_harden_community_rpc_permissions.sql"),
  "utf8"
);
const legacyCommunityBaseMigration = readFileSync(
  resolve(migrationsDir, "20260325000000_community.sql"),
  "utf8"
);
const legacyCommunityStorageMigration = readFileSync(
  resolve(migrationsDir, "20260615093000_harden_community_media_storage.sql"),
  "utf8"
);
const disabledContract = readFileSync(
  resolve(contractDir, "20260710060000_release_surface_lockdown.sql.disabled"),
  "utf8"
);

const activePendingMigrationNames = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql") && name >= "20260710000000")
  .sort();
const activePendingSql = activePendingMigrationNames
  .map((name) => readFileSync(resolve(migrationsDir, name), "utf8"))
  .join("\n");
const contractSqlNames = readdirSync(contractDir).filter((name) =>
  name.includes(".sql")
);

describe("expand-only mobile migration contract", () => {
  it("keeps the published direct chat insert and linked-partner read paths", () => {
    expect(amoraMigration).toContain(
      'CREATE POLICY "chat_insert_couple" ON public.chat_messages'
    );
    expect(amoraMigration).toContain(
      "GRANT INSERT ON TABLE public.chat_messages TO authenticated;"
    );
    expect(amoraMigration).not.toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );

    expect(activePendingSql).not.toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );

    const functionStart = activePendingSql.lastIndexOf(
      "CREATE OR REPLACE FUNCTION public.can_read_profile"
    );
    const functionEnd = activePendingSql.indexOf(
      "REVOKE ALL ON FUNCTION public.can_read_profile",
      functionStart
    );
    const functionSql = activePendingSql.slice(functionStart, functionEnd);

    expect(functionStart).toBeGreaterThanOrEqual(0);
    expect(functionEnd).toBeGreaterThan(functionStart);
    expect(functionSql).toContain("JOIN public.profiles AS partner");
    expect(functionSql).toContain(
      "couple.bride_id = caller.id AND couple.groom_id = partner.id"
    );
    expect(functionSql).toContain(
      "couple.groom_id = caller.id AND couple.bride_id = partner.id"
    );
  });

  it("never classifies or rewrites historical one-slot couples automatically", () => {
    expect(amoraMigration).not.toContain(
      "WHERE (bride_id IS NULL) <> (groom_id IS NULL);"
    );
    expect(activePendingSql).not.toContain(
      "WHERE (bride_id IS NULL) <> (groom_id IS NULL);"
    );
    expect(activePendingSql).not.toMatch(
      /FOR v_couple IN\s+SELECT id FROM public\.couples[\s\S]*?invite_code/
    );
    expect(amoraMigration).toMatch(
      /individually\s+-- audited couple ids only after an export, classification, and change approval/
    );
  });

  it("keeps legacy community vote and bookmark contracts during expand", () => {
    expect(activePendingSql).not.toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.community_votes FROM anon, authenticated/
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.community_bookmarks FROM anon, authenticated/
    );
    expect(activePendingSql).not.toContain(
      'DROP POLICY IF EXISTS "cb_all" ON public.community_bookmarks;'
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE ALL ON FUNCTION public\.community_vote_post\([\s\S]{0,80}FROM anon, authenticated/
    );
    expect(activePendingSql).not.toMatch(
      /REVOKE[^;]*public\.community_vote_post\([^;]*FROM authenticated;/
    );

    expect(legacyCommunityRpcMigration).toContain(
      "AND (auth.uid() IS NULL OR auth.uid() <> p_user_id)"
    );
    expect(legacyCommunityRpcMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.community_vote_post\([\s\S]{0,80}TO authenticated/
    );
    expect(legacyCommunityBaseMigration).toContain(
      'CREATE POLICY "cb_all" ON community_bookmarks FOR ALL USING (user_id = auth.uid());'
    );
  });

  it("keeps direct authenticated community uploads while reserving new API uploads", () => {
    expect(legacyCommunityStorageMigration).toMatch(
      /CREATE POLICY "community-images own folder write"[\s\S]*?FOR INSERT TO authenticated[\s\S]*?bucket_id = 'community-images'[\s\S]*?auth\.uid\(\)::text/
    );
    expect(activePendingSql).not.toMatch(
      /DROP POLICY IF EXISTS "community-images (?:authenticated|own folder) (?:write|update)"/
    );

    const compatibilityBypass = uploadMigration.indexOf(
      "IF COALESCE(auth.role(), '') = 'authenticated' THEN"
    );
    const reservationLookup = uploadMigration.indexOf(
      "FROM public.community_upload_reservations",
      compatibilityBypass
    );

    expect(compatibilityBypass).toBeGreaterThanOrEqual(0);
    expect(reservationLookup).toBeGreaterThan(compatibilityBypass);
    expect(uploadMigration).toContain(
      "The new server route uses service_role and must"
    );
  });

  it("keeps destructive retirement outside automatic migrations and fails it closed", () => {
    expect(activePendingMigrationNames).not.toContain(
      "20260710060000_release_surface_lockdown.sql"
    );
    expect(disabledContract).toContain("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    expect(disabledContract).toContain("hanbang.contract_min_mobile_version");
    expect(disabledContract).toContain("zero-for-14-days");
    expect(disabledContract).toContain(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );
    expect(disabledContract).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_bookmarks FROM anon, authenticated;"
    );
    expect(disabledContract).toContain(
      'DROP POLICY IF EXISTS "community-images own folder write" ON storage.objects;'
    );

    expect(activePendingSql).not.toContain("FUTURE CONTRACT MIGRATION");
    expect(activePendingSql).not.toContain("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    expect(contractSqlNames.length).toBeGreaterThan(0);
    expect(contractSqlNames.every((name) => name.endsWith(".sql.disabled"))).toBe(true);

    const releaseGate = disabledContract.indexOf("MOBILE_CONTRACT_RELEASE_GATE_REQUIRED");
    const firstChatRetirement = disabledContract.indexOf(
      "REVOKE INSERT ON TABLE public.chat_messages FROM authenticated;"
    );
    const firstCommunityRetirement = disabledContract.indexOf(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_posts FROM anon, authenticated;"
    );
    expect(releaseGate).toBeGreaterThanOrEqual(0);
    expect(firstChatRetirement).toBeGreaterThan(releaseGate);
    expect(firstCommunityRetirement).toBeGreaterThan(releaseGate);
  });
});
