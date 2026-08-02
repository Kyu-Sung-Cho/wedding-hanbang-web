#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import {
  auditCommunityMediaRows,
  auditExitCode,
  safeAuditFailureReport,
} from "./lib/community-media-audit.mjs";
import { verifySupabaseServiceDestinationFromEnv } from "./lib/supabase-service-destination.mjs";

const ROOT = process.cwd();
const ENV_PATHS = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, "apps", "web", ".env.local"),
];
const PAGE_SIZE = 500;

function printFailure(errorCode) {
  console.error(JSON.stringify(safeAuditFailureReport(errorCode)));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

async function fetchAll(supabase, table, select, filterBuilder) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select(select).range(from, from + PAGE_SIZE - 1);
    if (filterBuilder) query = filterBuilder(query);
    const { data, error } = await query;
    if (error) throw new Error("DATABASE_QUERY_FAILED");
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function main() {
  try {
    for (const envPath of ENV_PATHS) loadEnvFile(envPath);
  } catch {
    printFailure("CONFIGURATION_MISSING");
    return 1;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    printFailure("CONFIGURATION_MISSING");
    return 1;
  }

  try {
    verifySupabaseServiceDestinationFromEnv({ access: "read" });
  } catch {
    printFailure("DESTINATION_VERIFICATION_FAILED");
    return 1;
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const posts = await fetchAll(
      supabase,
      "community_posts",
      "id, author_id, content, images, slides",
    );
    const polls = await fetchAll(supabase, "community_polls", "id, post_id");
    const pollOptions = await fetchAll(
      supabase,
      "community_poll_options",
      "poll_id, image_url",
      (query) => query.not("image_url", "is", null),
    );

    const report = auditCommunityMediaRows({
      posts,
      polls,
      pollOptions,
      supabaseUrl,
    });
    console.log(JSON.stringify(report, null, 2));
    return auditExitCode(report);
  } catch {
    printFailure("DATABASE_QUERY_FAILED");
    return 1;
  }
}

process.exitCode = await main();
