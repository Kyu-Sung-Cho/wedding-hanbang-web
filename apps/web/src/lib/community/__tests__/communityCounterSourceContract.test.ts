// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const counterMutationRoutes = [
  "src/app/api/community/comments/route.ts",
  "src/app/api/community/comments/[id]/route.ts",
  "src/app/api/community/posts/route.ts",
  "src/app/api/community/posts/[id]/route.ts",
  "src/app/api/community/ai-comment/route.ts",
] as const;

describe("community counter source contracts", () => {
  it("keeps post and comment aggregate ownership in database triggers", () => {
    for (const path of counterMutationRoutes) {
      const source = readWorkspaceFile(path);

      expect(source).not.toMatch(
        /\.update\(\s*\{\s*(?:comment_count|post_count)\s*:/,
      );
      expect(source).not.toContain('rpc("community_increment_profile_count"');
      expect(source).not.toContain('rpc("community_decrement_profile_count"');
    }
  });

  it("derives late-created profile counters and retains lifecycle triggers", () => {
    const commentMigration = readWorkspaceFile(
      "../../supabase/migrations/20260802148000_reconcile_community_comment_counters.sql",
    );
    const postMigration = readWorkspaceFile(
      "../../supabase/migrations/20260802153000_reconcile_community_post_counters.sql",
    );

    expect(commentMigration).toContain(
      "BEFORE INSERT OR UPDATE OF comment_count ON public.community_profiles",
    );
    expect(commentMigration).toContain(
      "CREATE CONSTRAINT TRIGGER trg_community_comment_counter_sync",
    );
    expect(postMigration).toContain(
      "BEFORE INSERT OR UPDATE OF post_count ON public.community_profiles",
    );
    expect(postMigration).toContain(
      "CREATE CONSTRAINT TRIGGER trg_community_post_counter_sync",
    );
  });

  it("fails closed on profile initialization errors without destructive upserts", () => {
    const commentRoute = readWorkspaceFile(
      "src/app/api/community/comments/route.ts",
    );
    const postRoute = readWorkspaceFile(
      "src/app/api/community/posts/route.ts",
    );
    const aiCommentRoute = readWorkspaceFile(
      "src/app/api/community/ai-comment/route.ts",
    );
    const atomicCreationMigration = readWorkspaceFile(
      "../../supabase/migrations/20260803107000_atomic_community_content_creation.sql",
    );

    expect(commentRoute).toContain('.rpc("community_create_comment_atomic"');
    expect(postRoute).toContain(
      '.rpc("community_create_post_with_poll_atomic"',
    );
    for (const source of [commentRoute, postRoute]) {
      expect(source).not.toMatch(
        /\.from\("community_profiles"\)[\s\S]{0,200}?\.insert\(/,
      );
      expect(source).not.toMatch(
        /\.from\("community_profiles"\)[\s\S]{0,200}?\.upsert\(/,
      );
    }
    expect(atomicCreationMigration).toContain("ON CONFLICT DO NOTHING");
    expect(atomicCreationMigration).toContain(
      "community_profile_initialization_failed",
    );
    expect(atomicCreationMigration).toContain("IF NOT FOUND THEN");
    expect(atomicCreationMigration).toContain("community_create_actor_suspended");

    expect(aiCommentRoute).toContain("if (amoraProfileLookupError)");
    expect(aiCommentRoute).toContain("if (amoraProfileInsertError)");
    expect(aiCommentRoute).toContain(
      "amoraProfileRereadError || !racedAmoraProfile",
    );
    expect(aiCommentRoute).not.toMatch(
      /from\("community_profiles"\)\.upsert/,
    );
  });
});
