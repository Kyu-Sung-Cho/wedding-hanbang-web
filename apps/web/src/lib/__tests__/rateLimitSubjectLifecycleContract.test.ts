import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const migration = readRepo(
  "supabase/migrations/20260711147000_rate_limit_subject_lifecycle.sql",
);
const rateLimit = readRepo("apps/web/src/utils/rateLimit.ts");
const accountDeletion = readRepo("apps/web/src/lib/accountDeletion.ts");

describe("rate-limit subject lifecycle contract", () => {
  it("adds a nullable profile lifecycle FK and a subject cleanup index", () => {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS subject_user_id uuid;/,
    );
    expect(migration).toMatch(
      /CONSTRAINT rate_limit_buckets_subject_user_id_fkey[\s\S]*?FOREIGN KEY \(subject_user_id\)[\s\S]*?REFERENCES public\.profiles\(id\)[\s\S]*?ON DELETE CASCADE;/,
    );
    expect(migration).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_subject_user_id[\s\S]*?WHERE subject_user_id IS NOT NULL;/,
    );
    expect(migration).not.toMatch(/subject_user_id uuid NOT NULL/);
  });

  it("reinstalls a deletion-aware immutable subject guard", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.guard_account_deletion_rate_limit_write()",
    );
    expect(migration).toMatch(
      /OLD\.subject_user_id IS NOT NULL[\s\S]*?NEW\.subject_user_id IS DISTINCT FROM OLD\.subject_user_id[\s\S]*?rate limit subject binding is immutable/,
    );
    expect(migration).toMatch(
      /WHERE id = NEW\.subject_user_id[\s\S]*?FOR UPDATE;[\s\S]*?NOT FOUND OR v_deleting_at IS NOT NULL/,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER guard_delete_rate_limit_buckets[\s\S]*?BEFORE INSERT OR UPDATE ON public\.rate_limit_buckets/,
    );
  });

  it("keeps a service-only four-argument writer and rolling wrapper", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.check_rate_limit\([\s\S]*?p_subject_user_id uuid[\s\S]*?\)\nRETURNS TABLE/,
    );
    expect(migration).toMatch(
      /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/,
    );
    expect(migration).toContain("p_key !~ '^rl:[0-9a-f]{64}$'");
    expect(migration).toMatch(
      /IF v_stored_subject_user_id IS NULL THEN[\s\S]*?SET subject_user_id = p_subject_user_id/,
    );
    expect(migration).toMatch(
      /v_stored_subject_user_id IS DISTINCT FROM p_subject_user_id[\s\S]*?rate limit subject mismatch/,
    );
    expect(migration).toMatch(
      /v_lock_subject_user_id := p_subject_user_id;[\s\S]*?SELECT bucket\.subject_user_id INTO v_lock_subject_user_id[\s\S]*?WHERE id = v_lock_subject_user_id[\s\S]*?FOR UPDATE;[\s\S]*?INSERT INTO public\.rate_limit_buckets/,
    );
    expect(migration).toMatch(
      /p_subject_user_id IS NULL[\s\S]*?v_stored_subject_user_id IS DISTINCT FROM v_lock_subject_user_id[\s\S]*?ERRCODE = '40001'/,
    );
    expect(migration).toMatch(
      /SELECT bucket\.subject_user_id INTO v_existing_subject_user_id[\s\S]*?FROM public\.check_rate_limit\([\s\S]*?v_existing_subject_user_id[\s\S]*?\) AS result;/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_rate_limit\(text, integer, integer, uuid\)[\s\S]*?FROM PUBLIC, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_rate_limit\(text, integer, integer, uuid\)[\s\S]*?TO service_role;/,
    );
  });

  it("forces service-role mutations through the ordered RPC", () => {
    expect(migration).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\.rate_limit_buckets[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /REVOKE INSERT \(key, count, reset_at, updated_at, subject_user_id\)[\s\S]*?REVOKE UPDATE \(key, count, reset_at, updated_at, subject_user_id\)/,
    );
    expect(migration).toContain(
      "GRANT SELECT, DELETE ON TABLE public.rate_limit_buckets TO service_role;",
    );
    expect(migration).toContain("has_any_column_privilege(");
    expect(migration).toContain("RATE_LIMIT_TABLE_ACL_CONTRACT_MISMATCH");
  });

  it("passes only an explicit optional subject to the canonical RPC", () => {
    expect(rateLimit).toMatch(
      /checkRateLimitPersistent\([\s\S]*?subjectUserId\?: string \| null/,
    );
    expect(rateLimit).toContain("p_subject_user_id: subjectUserId ?? null");
    expect(rateLimit).not.toContain("p_subject_user_id: key");
  });

  it("deletes subject-linked buckets without inspecting opaque keys", () => {
    expect(accountDeletion).toContain('.eq("subject_user_id", userId)');
    expect(accountDeletion).not.toContain('.like("key", `%:${userId}`)');
  });

  it("passes authenticated UUIDs while anonymous and email limiters stay unbound", () => {
    const authenticatedContracts: Array<[string, RegExp]> = [
      ["apps/web/src/app/api/chat/route.ts", /checkRateLimitPersistent\([\s\S]*?user\.id\);/],
      ["apps/web/src/app/api/chat/messages/route.ts", /checkRateLimitPersistent\([\s\S]*?user\.id\);/],
      ["apps/web/src/app/api/bookings/route.ts", /checkRateLimitPersistent\([\s\S]*?user\.id,[\s\S]*?\);/],
      ["apps/web/src/app/api/bookings/[id]/outcome/route.ts", /checkRateLimitPersistent\([\s\S]*?user\.id,[\s\S]*?\);/],
      ["apps/web/src/app/api/community/ai-comment/route.ts", /checkRateLimitPersistent\([\s\S]*?userId\);/],
      ["apps/web/src/app/api/community/ai-price-comment/route.ts", /checkRateLimitPersistent\([\s\S]*?loggingUserId\);/],
      ["apps/web/src/app/api/amora/quote-check/route.ts", /checkRateLimitPersistent\([\s\S]*?user\?\.id\);/],
    ];

    for (const [path, contract] of authenticatedContracts) {
      expect(readRepo(path), path).toMatch(contract);
    }

    for (const path of [
      "apps/web/src/app/api/auth/signup/route.ts",
      "apps/web/src/app/api/auth/forgot-password/route.ts",
      "apps/web/src/app/api/preregister/route.ts",
    ]) {
      const source = readRepo(path);
      expect(source, path).not.toMatch(
        /checkRateLimitPersistent\([^;]+,\s*(?:email|normalizeEmailForRateLimit)/,
      );
    }
  });
});
