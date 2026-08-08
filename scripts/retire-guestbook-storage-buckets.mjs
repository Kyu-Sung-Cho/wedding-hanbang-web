#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

import { verifySupabaseServiceDestinationFromEnv } from "./lib/supabase-service-destination.mjs";

const ROOT = process.cwd();
const ENV_PATHS = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, "apps", "web", ".env.local"),
];
const PRIVATE_CONFIRMATION_PREFIX = "RETIRED_GUESTBOOK_BUCKETS_PRIVATE";
const TARGETS = Object.freeze([
  Object.freeze({
    id: "guestbook-images",
    fileSizeLimit: null,
    allowedMimeTypes: null,
  }),
  Object.freeze({
    id: "guestbook-uploads",
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: Object.freeze([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]),
  }),
]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function readBucketField(bucket, camelName, snakeName) {
  if (Object.hasOwn(bucket, camelName)) return bucket[camelName];
  return bucket[snakeName];
}

function normalizedMimeTypes(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("RETIRED_GUESTBOOK_BUCKET_CONTRACT_INVALID");
  }
  return [...value].sort();
}

function sameNullableStringArray(left, right) {
  const normalizedLeft = normalizedMimeTypes(left);
  const normalizedRight = normalizedMimeTypes(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function validateBucket(bucket, expected) {
  if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
    throw new Error(`RETIRED_GUESTBOOK_BUCKET_MISSING:${expected.id}`);
  }
  if (bucket.id !== expected.id || bucket.name !== expected.id) {
    throw new Error(`RETIRED_GUESTBOOK_BUCKET_IDENTITY_DRIFT:${expected.id}`);
  }

  const fileSizeLimit = readBucketField(bucket, "fileSizeLimit", "file_size_limit") ?? null;
  const allowedMimeTypes = readBucketField(
    bucket,
    "allowedMimeTypes",
    "allowed_mime_types",
  ) ?? null;
  if (
    fileSizeLimit !== expected.fileSizeLimit
    || !sameNullableStringArray(allowedMimeTypes, expected.allowedMimeTypes)
  ) {
    throw new Error(`RETIRED_GUESTBOOK_BUCKET_CONFIGURATION_DRIFT:${expected.id}`);
  }
  if (typeof bucket.public !== "boolean") {
    throw new Error(`RETIRED_GUESTBOOK_BUCKET_VISIBILITY_INVALID:${expected.id}`);
  }
  return Object.freeze({
    id: expected.id,
    public: bucket.public,
    fileSizeLimit,
    allowedMimeTypes,
  });
}

async function readTargets(supabase) {
  const { data, error } = await supabase.storage.listBuckets();
  if (error || !Array.isArray(data)) {
    throw new Error("RETIRED_GUESTBOOK_BUCKET_INVENTORY_FAILED");
  }
  const byId = new Map(data.map((bucket) => [bucket.id, bucket]));
  return TARGETS.map((target) => validateBucket(byId.get(target.id), target));
}

async function updateVisibility(supabase, bucket, isPublic) {
  const { error } = await supabase.storage.updateBucket(bucket.id, {
    public: isPublic,
    fileSizeLimit: bucket.fileSizeLimit,
    allowedMimeTypes: bucket.allowedMimeTypes,
  });
  if (error) {
    throw new Error(`RETIRED_GUESTBOOK_BUCKET_UPDATE_FAILED:${bucket.id}`);
  }
}

function parseMode(argv) {
  const apply = argv.includes("--apply");
  const verify = argv.includes("--verify") || !apply;
  if (apply && argv.includes("--verify")) {
    throw new Error("RETIRED_GUESTBOOK_BUCKET_MODE_CONFLICT");
  }
  return verify ? "verify" : "apply";
}

for (const envPath of ENV_PATHS) loadEnvFile(envPath);

const mode = parseMode(process.argv.slice(2));
const destination = mode === "apply"
  ? verifySupabaseServiceDestinationFromEnv({ access: "operator-write" })
  : verifySupabaseServiceDestinationFromEnv({ access: "read" });
const confirmation = process.argv.find((value) => value.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const expectedConfirmation = `${PRIVATE_CONFIRMATION_PREFIX}:${destination.projectRef}`;

if (mode === "apply" && confirmation !== expectedConfirmation) {
  throw new Error(
    `RETIRED_GUESTBOOK_BUCKET_CONFIRMATION_REQUIRED:${expectedConfirmation}`,
  );
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const before = await readTargets(supabase);
const changed = [];
if (mode === "apply") {
  try {
    for (const bucket of before) {
      if (!bucket.public) continue;
      await updateVisibility(supabase, bucket, false);
      changed.push(bucket);
    }
  } catch (applyError) {
    const compensationFailures = [];
    for (const bucket of [...changed].reverse()) {
      try {
        await updateVisibility(supabase, bucket, true);
      } catch {
        compensationFailures.push(bucket.id);
      }
    }
    if (compensationFailures.length > 0) {
      throw new Error(
        `RETIRED_GUESTBOOK_BUCKET_PARTIAL_APPLY:${compensationFailures.join(",")}`,
        { cause: applyError },
      );
    }
    throw applyError;
  }
}

const after = await readTargets(supabase);
const nonPrivate = after.filter((bucket) => bucket.public).map((bucket) => bucket.id);
if (nonPrivate.length > 0) {
  throw new Error(`RETIRED_GUESTBOOK_BUCKET_VERIFY_FAILED:${nonPrivate.join(",")}`);
}

console.log(JSON.stringify({
  status: "RETIRED_GUESTBOOK_BUCKETS_PRIVATE",
  mode,
  projectRef: destination.projectRef,
  buckets: after.map((bucket) => ({ id: bucket.id, public: bucket.public })),
  nextRequiredEvidence:
    "20260804120000_retired_guestbook_storage_verify.sql",
}, null, 2));
