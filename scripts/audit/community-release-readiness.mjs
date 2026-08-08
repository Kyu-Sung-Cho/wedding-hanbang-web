import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(scriptDir, "../..");

const REQUIRED_MIGRATIONS = [
  "20260730100000_retire_undisclosed_community_agents.sql",
  "20260731180000_community_release_trust_boundary.sql",
  "20260731181000_community_reply_notifications.sql",
  "20260731182000_cohort_moderation_audit_boundary.sql",
  "20260731183000_community_operational_health.sql",
];

const PRODUCTION_BLOCKERS = [
  "Hosted migration ledger, exact hashes, and read-only postconditions are not verified.",
  "A fresh encrypted backup and different-project restore rehearsal are not verified.",
  "Every legacy post and comment still needs manual provenance classification.",
  "Korean privacy, advertising, defamation, and dispute workflows need external legal review.",
  "A named moderation owner and the emergency-privacy/general-report SLA need live rehearsal.",
  "Four consecutive weeks of human-only answer-supply metrics have not been proven.",
];

function read(repoRoot, relativePath) {
  const absolute = resolve(repoRoot, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

function sha256(text) {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

function check(name, pass, detail) {
  return { name, pass: Boolean(pass), detail };
}

function includesAll(source, values) {
  return source !== null && values.every((value) => source.includes(value));
}

export function auditCommunityRelease(repoRoot = defaultRepoRoot) {
  const trustMigration = read(
    repoRoot,
    "supabase/migrations/20260731180000_community_release_trust_boundary.sql"
  );
  const replyMigration = read(
    repoRoot,
    "supabase/migrations/20260731181000_community_reply_notifications.sql"
  );
  const cohortMigration = read(
    repoRoot,
    "supabase/migrations/20260731182000_cohort_moderation_audit_boundary.sql"
  );
  const healthMigration = read(
    repoRoot,
    "supabase/migrations/20260731183000_community_operational_health.sql"
  );
  const retirementMigration = read(
    repoRoot,
    "supabase/migrations/20260730100000_retire_undisclosed_community_agents.sql"
  );
  const manifestText = read(
    repoRoot,
    "supabase/release-manifests/vendor-disclosure-v2-20260718.json"
  );

  let manifest = null;
  try {
    manifest = manifestText ? JSON.parse(manifestText) : null;
  } catch {
    manifest = null;
  }

  const manifestEntries = new Map(
    Array.isArray(manifest?.expandMigrations)
      ? manifest.expandMigrations.map((entry) => [entry.file, entry.sha256])
      : []
  );
  const migrationPinsMatch = REQUIRED_MIGRATIONS.every((file) => {
    const sql = read(repoRoot, `supabase/migrations/${file}`);
    return sql !== null && manifestEntries.get(file) === sha256(sql);
  });

  const detailPage = read(
    repoRoot,
    "apps/web/src/app/(community)/community/post/[id]/page.tsx"
  );
  const detailClient = read(
    repoRoot,
    "apps/web/src/app/(community)/community/post/[id]/PostDetailClient.tsx"
  );
  const detailLoader = read(
    repoRoot,
    "apps/web/src/lib/community/publicPostDetail.ts"
  );
  const detailLayout = read(
    repoRoot,
    "apps/web/src/app/(community)/community/post/[id]/layout.tsx"
  );
  const adminModeration = read(
    repoRoot,
    "apps/web/src/app/api/admin/posts/[id]/moderate/route.ts"
  );
  const adminReport = read(
    repoRoot,
    "apps/web/src/app/api/admin/reports/[id]/route.ts"
  );
  const piiHelper = read(
    repoRoot,
    "apps/web/src/lib/community/publicPersonalInfo.ts"
  );
  const postRoute = read(
    repoRoot,
    "apps/web/src/app/api/community/posts/route.ts"
  );
  const commentRoute = read(
    repoRoot,
    "apps/web/src/app/api/community/comments/route.ts"
  );
  const userMenu = read(
    repoRoot,
    "apps/web/src/components/community/UserMenu.tsx"
  );

  const checks = [
    check(
      "required migration files",
      REQUIRED_MIGRATIONS.every((file) =>
        existsSync(resolve(repoRoot, `supabase/migrations/${file}`))
      ),
      REQUIRED_MIGRATIONS.join(", ")
    ),
    check(
      "migration manifest exact SHA-256 pins",
      migrationPinsMatch,
      "Every community migration must be ordered and normalized-SHA pinned."
    ),
    check(
      "retirement migration matches baseline cohort schema",
      retirementMigration !== null &&
        !/UPDATE\s+public\.cohort_messages[\s\S]{0,180}updated_at\s*=/i.test(
          retirementMigration
        ),
      "The baseline cohort_messages table has no updated_at column."
    ),
    check(
      "immutable provenance and persona fence",
      includesAll(trustMigration, [
        "community_content_origin",
        "legacy_unverified",
        "community_reclassify_content_origin",
        "community_agent_personas",
      ]),
      "Posts and comments require DB-backed origin; persona accounts cannot publish."
    ),
    check(
      "report integrity and anti-brigading",
      includesAll(trustMigration, [
        "community_reports_exactly_one_target",
        "community_reports_reporter_post_unique",
        "community_reports_reporter_comment_unique",
        "DROP TRIGGER IF EXISTS trg_report_auto_review",
      ]),
      "Self/duplicate reports are rejected and report-count auto-hide is retired."
    ),
    check(
      "atomic audited moderation and appeals",
      includesAll(trustMigration, [
        "community_moderate_content",
        "community_review_report",
        "community_moderation_events",
        "community_moderation_notices",
        "community_moderation_appeals",
      ]) &&
        includesAll(adminModeration, [
          "community_moderate_content",
          "soft_delete",
        ]) &&
        !adminModeration?.includes('.delete()') &&
        adminReport?.includes("community_review_report"),
      "No public-content hard delete or unaudited report status update."
    ),
    check(
      "atomic reply and return notification",
      includesAll(replyMigration, [
        "community_create_comment_with_notifications",
        "community_comment_commands",
        "community_reply_notifications",
      ]) &&
        commentRoute?.includes('"idempotency-key"') &&
        existsSync(
          resolve(
            repoRoot,
            "apps/web/src/components/community/CommunityReplyNotifications.tsx"
          )
        ),
      "A retry cannot duplicate the answer, counters, or notifications."
    ),
    check(
      "server-rendered public detail",
      detailPage !== null &&
        !detailPage.includes('"use client"') &&
        detailPage.includes("getPublicCommunityPostDetail") &&
        detailPage.includes("PostDetailClient") &&
        detailClient !== null &&
        includesAll(detailLoader, [
          "createPublicClient",
          "PUBLIC_COMMUNITY_POST_QUERY_FILTERS",
          "content_origin",
        ]),
      "Raw HTML contains the public post instead of a hydration-time soft 404."
    ),
    check(
      "UGC indexing remains gated",
      includesAll(detailLayout, ["index: false", "follow: true"]),
      "Indexing stays off until legacy provenance and content quality are verified."
    ),
    check(
      "obvious text PII publication fence",
      includesAll(piiHelper, [
        "email",
        "phone",
        "resident_registration",
        "bank_account",
      ]) &&
        postRoute?.includes("COMMUNITY_PERSONAL_INFO_DETECTED") &&
        commentRoute?.includes("COMMUNITY_PERSONAL_INFO_DETECTED"),
      "Text detection supplements, but does not replace, image review and user confirmation."
    ),
    check(
      "cohort moderation is atomic and audited",
      includesAll(cohortMigration, [
        "community_review_cohort_member_report",
        "cohort_moderation_events",
      ]),
      "Membership restriction, count repair, report state, and audit event share one transaction."
    ),
    check(
      "human-only operational health contract",
      includesAll(healthMigration, [
        "community_operational_health",
        "first_human_reply_median_hours",
        "human_reply_within_24h_rate",
        "over_24h_without_human_reply_count",
      ]) &&
        existsSync(
          resolve(
            repoRoot,
            "apps/web/src/app/api/admin/community/health/route.ts"
          )
        ),
      "AI/operator content cannot inflate the human answer SLA."
    ),
    check(
      "member-visible moderation notice entry point",
      userMenu?.includes("/community/moderation") &&
        existsSync(
          resolve(
            repoRoot,
            "apps/web/src/app/(community)/community/moderation/page.tsx"
          )
        ),
      "Affected members can read the reason and appeal from the product."
    ),
  ];

  return {
    localContractReady: checks.every((item) => item.pass),
    productionGo: false,
    checks,
    blockers: PRODUCTION_BLOCKERS,
  };
}

function parseRepoRoot(argv) {
  const index = argv.indexOf("--repo-root");
  return index >= 0 && argv[index + 1]
    ? resolve(argv[index + 1])
    : defaultRepoRoot;
}

function printHuman(result) {
  for (const item of result.checks) {
    process.stdout.write(`${item.pass ? "PASS" : "FAIL"}  ${item.name}\n`);
    if (!item.pass) process.stdout.write(`      ${item.detail}\n`);
  }
  process.stdout.write(
    `\nLocal contract: ${result.localContractReady ? "READY" : "NOT READY"}\n`
  );
  process.stdout.write("Production decision: NO-GO until external evidence is verified.\n");
  for (const blocker of result.blockers) {
    process.stdout.write(`- ${blocker}\n`);
  }
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const result = auditCommunityRelease(parseRepoRoot(process.argv.slice(2)));
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printHuman(result);
  }

  process.exitCode =
    result.localContractReady && !process.argv.includes("--production") ? 0 : 1;
}
