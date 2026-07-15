import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "../../supabase/migrations/20260713112500_close_profiles_direct_select.sql",
);
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".expo", ".next"].includes(entry.name)) return [];
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("profile ACL boundary", () => {
  it("removes direct profile table access and exposes only narrow DTO RPCs", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("DROP POLICY IF EXISTS profiles_select_related");
    expect(migration).toContain("DROP POLICY IF EXISTS profiles_update_own");
    expect(migration).toContain(
      "REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.can_read_profile(uuid) FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.get_my_profile_safe()",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_my_profile_safe() TO authenticated, service_role",
    );
    expect(migration).toContain("has_any_column_privilege('authenticated'");
    expect(migration).toContain(
      "'authenticated', 'public.can_read_profile(uuid)', 'EXECUTE'",
    );
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.profiles\s+FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO service_role;",
    );
    expect(migration).not.toMatch(
      /GRANT\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+TABLE\s+public\.profiles\s+TO\s+service_role/i,
    );
    expect(migration).toContain("DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN");
    expect(migration).toContain("privilege_row.is_grantable");
    expect(migration).toContain("grantor_role.rolname <> 'postgres'");
    expect(migration).toContain("privilege_row.grantee = 0");

    const safeRpc = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.get_my_profile_safe()"),
      migration.indexOf(
        "REVOKE ALL ON FUNCTION public.get_my_profile_safe()",
      ),
    );
    const safeReturnColumns = safeRpc.slice(
      safeRpc.indexOf("RETURNS TABLE"),
      safeRpc.indexOf("LANGUAGE sql"),
    );
    for (const sensitiveColumn of [
      "email",
      "phone",
      "phone_care_consented_at",
      "consents",
      "is_admin",
      "push_token",
      "account_deleting_at",
      "amora_membership_resetting_at",
      "private_chat_deleting_at",
    ]) {
      expect(safeReturnColumns, sensitiveColumn).not.toMatch(
        new RegExp(`\\b${sensitiveColumn}\\b`),
      );
    }

    const partnerRpc = migration.slice(
      migration.indexOf(
        "CREATE OR REPLACE FUNCTION public.get_my_partner_public()",
      ),
      migration.indexOf(
        "REVOKE ALL ON FUNCTION public.get_my_partner_public()",
      ),
    );
    expect(partnerRpc).toMatch(
      /RETURNS TABLE \(\s*id uuid,\s*name text,\s*role text\s*\)/,
    );
    expect(partnerRpc).toContain("partner.couple_id = couple.id");
    expect(partnerRpc).toContain("partner.amora_membership_resetting_at IS NULL");
    for (const sensitiveColumn of [
      "email",
      "phone",
      "phone_care_consented_at",
      "consents",
      "is_admin",
      "push_token",
      "account_deleting_at",
      "amora_membership_resetting_at",
      "private_chat_deleting_at",
    ]) {
      const partnerReturnColumns = partnerRpc.slice(
        partnerRpc.indexOf("RETURNS TABLE"),
        partnerRpc.indexOf("LANGUAGE sql"),
      );
      expect(partnerReturnColumns, sensitiveColumn).not.toMatch(
        new RegExp(`\\b${sensitiveColumn}\\b`),
      );
    }
  });

  it("keeps browser and mobile bundles away from the raw profiles table", () => {
    const webRoot = resolve(process.cwd(), "src");
    const webClientFiles = sourceFiles(webRoot).filter((path) => {
      const normalized = relative(webRoot, path).replaceAll("\\", "/");
      return !normalized.startsWith("app/api/")
        && !normalized.includes("/__tests__/")
        && readFileSync(path, "utf8").includes('"use client"');
    });
    const mobileRoot = resolve(process.cwd(), "../mobile");
    const mobileFiles = sourceFiles(mobileRoot).filter(
      (path) => !path.replaceAll("\\", "/").includes("/__tests__/"),
    );

    for (const path of [...webClientFiles, ...mobileFiles]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toMatch(
        /\.from\(["']profiles["']\)[\s\S]{0,160}?\.(?:select|insert|update|upsert|delete)\(/,
      );
      expect(source, path).not.toContain("/rest/v1/profiles");
      expect(source, path).not.toContain("can_read_profile");
    }
  });

  it("returns explicit safe profile DTOs from public account APIs", () => {
    const authMe = readFileSync(
      resolve(process.cwd(), "src/app/api/auth/me/route.ts"),
      "utf8",
    );
    const profileRoute = readFileSync(
      resolve(process.cwd(), "src/app/api/profile/route.ts"),
      "utf8",
    );

    expect(authMe).toContain("readMySafeProfile");
    expect(authMe).not.toMatch(
      /\.from\(["']profiles["']\)[\s\S]{0,160}?\.select\(/,
    );
    expect(profileRoute).toContain("toSafeProfileDto");
    expect(profileRoute).toContain("profile: safeProfile");
    expect(profileRoute).not.toContain(".select()");
  });

  it("keeps sensitive database columns out of client profile state", () => {
    const types = readFileSync(
      resolve(process.cwd(), "src/types/database.types.ts"),
      "utf8",
    );
    const profileType = types.slice(
      types.indexOf("export interface Profile"),
      types.indexOf("export interface Couple"),
    );
    const settings = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
      "utf8",
    );

    expect(profileType).toContain("has_phone: boolean");
    for (const sensitiveKey of [
      "email",
      "phone?:",
      "phone_care_consented_at",
      "is_admin",
      "consents",
      "push_token",
    ]) {
      expect(profileType, sensitiveKey).not.toContain(sensitiveKey);
    }
    expect(settings).toContain("user?.email");
    expect(settings).toContain("profile?.has_phone");
    expect(settings).not.toContain("profile?.email");
    expect(settings).not.toContain("profile?.phone");
  });

  it("fails closed when the purpose-built chat view state cannot be read", () => {
    const chatStore = readFileSync(
      resolve(process.cwd(), "src/stores/chatStore.ts"),
      "utf8",
    );
    const mobileChat = readFileSync(
      resolve(process.cwd(), "../mobile/app/(tabs)/chat.tsx"),
      "utf8",
    );

    expect(chatStore).toContain("chatViewResult.error || !chatViewResult.data");
    expect(chatStore).toContain("throw chatViewResult.error");
    expect(mobileChat).toContain("chatViewError || !chatView");
    expect(mobileChat).toContain("throw chatViewError");
  });
});
