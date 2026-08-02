import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  auditCommunityMediaRows,
  auditExitCode,
  classifyCommunityAttachmentUrl,
  classifyCommunityMediaUrl,
  safeAuditFailureReport,
} from "../lib/community-media-audit.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AUDIT_SCRIPT = resolve(REPO_ROOT, "scripts", "audit-community-media-urls.mjs");
const SUPABASE_URL = "https://project.supabase.co";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const POLL_ID = "33333333-3333-4333-8333-333333333333";
const V2_OBJECT_ID = "44444444-4444-4444-8444-444444444444";
const SECRET_TITLE = "비공개 혼주 메모 - 절대 로그 금지";

function publicUrl(bucket, path) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

test("recognizes canonical v2 images without returning URL, UUID, owner, or object path", () => {
  const v2Url = publicUrl("community-images", `v2/${V2_OBJECT_ID}.webp`);
  const result = classifyCommunityMediaUrl(v2Url, {
    kind: "image",
    ownerId: OWNER_ID,
    supabaseUrl: SUPABASE_URL,
  });

  assert.deepEqual(result, { classification: "managed_v2" });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);

  assert.deepEqual(
    classifyCommunityAttachmentUrl(
      publicUrl("community-images", `${OWNER_ID}/1700000000000_old.jpg`),
      { ownerId: OWNER_ID, supabaseUrl: SUPABASE_URL },
    ),
    { classification: "legacy_owner_linked" },
  );
  assert.deepEqual(
    classifyCommunityMediaUrl(`${v2Url}?token=${OWNER_ID}`, {
      kind: "image",
      ownerId: OWNER_ID,
      supabaseUrl: SUPABASE_URL,
    }),
    { classification: "invalid", reason: "unsafe_url" },
  );
});

test("adversarial fixtures produce count-only output for v2, legacy, and invalid media", () => {
  const v2Url = publicUrl("community-images", `v2/${V2_OBJECT_ID}.webp`);
  const legacyImage = publicUrl(
    "community-images",
    `${OWNER_ID}/1700000000000_private-wedding.jpg`,
  );
  const legacyThumb = publicUrl(
    "community-images",
    `${OWNER_ID}/1700000000000_private-thumb.jpg`,
  );
  const legacyVideo = publicUrl(
    "community-videos",
    `${OWNER_ID}/1700000000000_private-video.mp4`,
  );
  const hostileUrl = `https://tracker.example.test/${OWNER_ID}/${encodeURIComponent(SECRET_TITLE)}`;
  const unsafeV2Url = `${v2Url}?private=${encodeURIComponent(SECRET_TITLE)}`;

  const report = auditCommunityMediaRows({
    checkedAt: "2026-08-03T00:00:00.000Z",
    supabaseUrl: SUPABASE_URL,
    posts: [{
      id: POST_ID,
      author_id: OWNER_ID,
      title: SECRET_TITLE,
      content: `<p>${SECRET_TITLE}</p><img src="${v2Url}"><img src="${legacyImage}">`,
      images: [v2Url, legacyImage, hostileUrl],
      slides: [
        { type: "image", url: v2Url, thumbnail_url: legacyThumb },
        { type: "video", url: legacyVideo },
        null,
        { type: "image", url: unsafeV2Url },
      ],
    }],
    polls: [{ id: POLL_ID, post_id: POST_ID }],
    pollOptions: [
      { poll_id: POLL_ID, image_url: v2Url },
      { poll_id: "55555555-5555-4555-8555-555555555555", image_url: hostileUrl },
    ],
  });

  assert.equal(report.status, "review_required");
  assert.equal(report.media_fields_checked, 12);
  assert.equal(report.findings_count, 8);
  assert.deepEqual(report.classification_counts, {
    managed_v2: 4,
    legacy_owner_linked: 4,
    invalid: 4,
  });
  assert.deepEqual(report.invalid_reason_counts, {
    wrong_origin: 1,
    invalid_slide: 1,
    unsafe_url: 1,
    missing_parent_post: 1,
  });
  assert.equal(auditExitCode(report), 2);

  const serialized = JSON.stringify(report);
  for (const secret of [
    OWNER_ID,
    POST_ID,
    POLL_ID,
    V2_OBJECT_ID,
    SECRET_TITLE,
    v2Url,
    legacyImage,
    legacyThumb,
    legacyVideo,
    hostileUrl,
    unsafeV2Url,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
});

test("clean v2-only fixtures return the non-sensitive success exit code", () => {
  const report = auditCommunityMediaRows({
    checkedAt: "2026-08-03T00:00:00.000Z",
    supabaseUrl: SUPABASE_URL,
    posts: [{
      id: POST_ID,
      author_id: OWNER_ID,
      content: "",
      images: [publicUrl("community-images", `v2/${V2_OBJECT_ID}.png`)],
      slides: [],
    }],
    polls: [],
    pollOptions: [],
  });

  assert.equal(report.status, "clean");
  assert.equal(report.findings_count, 0);
  assert.equal(auditExitCode(report), 0);
});

test("operational failures collapse arbitrary upstream text to an allowlisted code", () => {
  const upstreamSecret = `${SECRET_TITLE}:${OWNER_ID}:https://private.example.test/object`;
  const serialized = JSON.stringify(safeAuditFailureReport(upstreamSecret));
  assert.equal(serialized, '{"schema_version":2,"status":"error","error_code":"AUDIT_FAILED"}');
  assert.equal(serialized.includes(upstreamSecret), false);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);

  const report = auditCommunityMediaRows({
    checkedAt: upstreamSecret,
    supabaseUrl: SUPABASE_URL,
    posts: [],
    polls: [],
    pollOptions: [],
  });
  assert.equal(JSON.stringify(report).includes(upstreamSecret), false);
  assert.match(report.checked_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("CLI configuration errors write only a fixed error envelope", () => {
  const result = spawnSync(process.execPath, [AUDIT_SCRIPT], {
    cwd: dirname(AUDIT_SCRIPT),
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
    },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    schema_version: 2,
    status: "error",
    error_code: "CONFIGURATION_MISSING",
  });
});

test("CLI source selects no title and never serializes upstream exception messages", async () => {
  const source = await readFile(AUDIT_SCRIPT, "utf8");
  assert.doesNotMatch(source, /author_id,\s*title|error\.message|console\.(?:log|error)\([^\n]*(?:url|title|owner|path)/i);
  assert.match(source, /"id, author_id, content, images, slides"/);
  assert.match(source, /console\.log\(JSON\.stringify\(report, null, 2\)\)/);
});
