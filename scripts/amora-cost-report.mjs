#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { classifyUsageRow } from "./amora-cost-report-logic.mjs";

const ROOT = process.cwd();
const ENV_PATHS = [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, "apps", "web", ".env.local"),
];
const PAGE_SIZE = 1000;
const DEFAULT_DAYS = 30;
const DEFAULT_KRW_PER_USD = 1350;

// OpenAI source checked 2026-07-14:
// https://developers.openai.com/api/docs/pricing
// Values are USD per token, converted from USD / MTok.
const MODEL_COSTS = {
  "gpt-5.6-terra": {
    in: 2.5 / 1_000_000, out: 15 / 1_000_000,
    cacheWrite: 3.125 / 1_000_000, cacheRead: 0.25 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 5 / 1_000_000, out: 22.5 / 1_000_000,
      cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000,
    },
  },
  "gpt-5.6-luna": {
    in: 1 / 1_000_000, out: 6 / 1_000_000,
    cacheWrite: 1.25 / 1_000_000, cacheRead: 0.1 / 1_000_000,
    longContext: {
      threshold: 272_000,
      in: 2 / 1_000_000, out: 9 / 1_000_000,
      cacheWrite: 2.5 / 1_000_000, cacheRead: 0.2 / 1_000_000,
    },
  },
  "claude-fable-5": { in: 10 / 1_000_000, out: 50 / 1_000_000, cacheWrite: 12.5 / 1_000_000, cacheRead: 1 / 1_000_000 },
  "claude-mythos-5": { in: 10 / 1_000_000, out: 50 / 1_000_000, cacheWrite: 12.5 / 1_000_000, cacheRead: 1 / 1_000_000 },
  "claude-opus-4-8": { in: 5 / 1_000_000, out: 25 / 1_000_000, cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000 },
  "claude-opus-4-7": { in: 5 / 1_000_000, out: 25 / 1_000_000, cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000 },
  "claude-opus-4-6": { in: 5 / 1_000_000, out: 25 / 1_000_000, cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000 },
  "claude-opus-4-5": { in: 5 / 1_000_000, out: 25 / 1_000_000, cacheWrite: 6.25 / 1_000_000, cacheRead: 0.5 / 1_000_000 },
  "claude-opus-4-1": { in: 15 / 1_000_000, out: 75 / 1_000_000, cacheWrite: 18.75 / 1_000_000, cacheRead: 1.5 / 1_000_000 },
  "claude-opus-4": { in: 15 / 1_000_000, out: 75 / 1_000_000, cacheWrite: 18.75 / 1_000_000, cacheRead: 1.5 / 1_000_000 },
  "claude-sonnet-4-6": { in: 3 / 1_000_000, out: 15 / 1_000_000, cacheWrite: 3.75 / 1_000_000, cacheRead: 0.3 / 1_000_000 },
  "claude-sonnet-4-5": { in: 3 / 1_000_000, out: 15 / 1_000_000, cacheWrite: 3.75 / 1_000_000, cacheRead: 0.3 / 1_000_000 },
  "claude-sonnet-4-20250514": { in: 3 / 1_000_000, out: 15 / 1_000_000, cacheWrite: 3.75 / 1_000_000, cacheRead: 0.3 / 1_000_000 },
  "claude-haiku-4-5-20251001": { in: 1 / 1_000_000, out: 5 / 1_000_000, cacheWrite: 1.25 / 1_000_000, cacheRead: 0.1 / 1_000_000 },
  "claude-haiku-4-5": { in: 1 / 1_000_000, out: 5 / 1_000_000, cacheWrite: 1.25 / 1_000_000, cacheRead: 0.1 / 1_000_000 },
  "claude-haiku-3-5": { in: 0.8 / 1_000_000, out: 4 / 1_000_000, cacheWrite: 1 / 1_000_000, cacheRead: 0.08 / 1_000_000 },
};

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function printHelp() {
  console.log(`Usage: pnpm amora:costs [options]

Options:
  --days=<n>          Include today and the previous n-1 KST days. Default: ${DEFAULT_DAYS}
  --from=<YYYY-MM-DD> KST start date, inclusive.
  --to=<YYYY-MM-DD>   KST end date, exclusive next-day boundary.
  --krw=<rate>        KRW per USD for display only. Default: ${DEFAULT_KRW_PER_USD}
  --json              Print JSON instead of text.

Examples:
  pnpm amora:costs
  pnpm amora:costs -- --days=7
  pnpm amora:costs -- --from=2026-06-01 --to=2026-07-01 --krw=1380`);
}

function parseArgs(argv) {
  const options = {
    days: DEFAULT_DAYS,
    from: null,
    to: null,
    krw: DEFAULT_KRW_PER_USD,
    json: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--days=")) options.days = Number(arg.slice("--days=".length));
    else if (arg.startsWith("--from=")) options.from = arg.slice("--from=".length);
    else if (arg.startsWith("--to=")) options.to = arg.slice("--to=".length);
    else if (arg.startsWith("--krw=")) options.krw = Number(arg.slice("--krw=".length));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.days) || options.days < 1) {
    throw new Error("--days must be a positive number");
  }
  if (!Number.isFinite(options.krw) || options.krw <= 0) {
    throw new Error("--krw must be a positive number");
  }
  return options;
}

function kstDateToUtcIso(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    throw new Error(`Expected YYYY-MM-DD date, got: ${dateString}`);
  }
  return new Date(`${dateString}T00:00:00+09:00`).toISOString();
}

function startOfKstDayUtc(daysAgo) {
  const now = new Date();
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const startUtcMs =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysAgo, 0, 0, 0) -
    9 * 60 * 60 * 1000;
  return new Date(startUtcMs).toISOString();
}

function getWindow(options) {
  if (options.from || options.to) {
    if (!options.from) throw new Error("--from is required when --to is provided");
    const fromIso = kstDateToUtcIso(options.from);
    const toIso = options.to ? kstDateToUtcIso(options.to) : new Date().toISOString();
    return { fromIso, toIso };
  }

  return {
    fromIso: startOfKstDayUtc(options.days - 1),
    toIso: new Date().toISOString(),
  };
}

function modelKey(model) {
  if (!model) return null;
  const keys = Object.keys(MODEL_COSTS).sort((a, b) => b.length - a.length);
  return keys.find((key) => model.startsWith(key)) ?? null;
}

function numberOrZero(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getCacheTokens(row) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    cacheCreationTokens: numberOrZero(metadata.cache_creation_input_tokens),
    cacheReadTokens: numberOrZero(metadata.cache_read_input_tokens),
  };
}

function calcCostUsd(row) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  if (metadata.usage_status === "unknown") return null;
  if (row.tokens_input == null || row.tokens_output == null) return null;
  const key = modelKey(row.model);
  if (!key) return null;
  const modelCost = MODEL_COSTS[key];
  const tokensInput = Number(row.tokens_input);
  const tokensOutput = Number(row.tokens_output);
  if (!Number.isFinite(tokensInput) || !Number.isFinite(tokensOutput)) return null;
  const rate = modelCost.longContext && tokensInput > modelCost.longContext.threshold
    ? modelCost.longContext
    : modelCost;
  const { cacheCreationTokens, cacheReadTokens } = getCacheTokens(row);
  if (String(row.model ?? "").startsWith("gpt-")) {
    const cachedTokens = Math.min(Math.max(cacheReadTokens, 0), tokensInput);
    const writtenTokens = Math.min(
      Math.max(cacheCreationTokens, 0),
      Math.max(tokensInput - cachedTokens, 0)
    );
    const uncachedTokens = Math.max(tokensInput - cachedTokens - writtenTokens, 0);
    return (
      uncachedTokens * rate.in +
      writtenTokens * rate.cacheWrite +
      cachedTokens * rate.cacheRead +
      tokensOutput * rate.out
    );
  }
  return (
    tokensInput * rate.in +
    tokensOutput * rate.out +
    cacheCreationTokens * rate.cacheWrite +
    cacheReadTokens * rate.cacheRead
  );
}

function kstDayKey(value) {
  const date = new Date(value);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeBucket(name) {
  return {
    name,
    rows: 0,
    successRows: 0,
    failedRows: 0,
    tokensInput: 0,
    tokensOutput: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    storedCostUsd: 0,
    currentPriceCostUsd: 0,
    unknownPriceRows: 0,
    unknownUsageRows: 0,
  };
}

function addRow(bucket, row, currentCost) {
  const { unknownPriceEligible, usageUnknown } = classifyUsageRow(row);
  const { cacheCreationTokens, cacheReadTokens } = getCacheTokens(row);
  bucket.rows += 1;
  if (row.success === false) bucket.failedRows += 1;
  else bucket.successRows += 1;
  bucket.tokensInput += numberOrZero(row.tokens_input);
  bucket.tokensOutput += numberOrZero(row.tokens_output);
  bucket.cacheCreationTokens += cacheCreationTokens;
  bucket.cacheReadTokens += cacheReadTokens;
  bucket.storedCostUsd += numberOrZero(row.cost_usd);
  if (usageUnknown) bucket.unknownUsageRows += 1;
  else if (unknownPriceEligible && currentCost == null) bucket.unknownPriceRows += 1;
  // Unknown usage is intentionally excluded from the known-cost lower bound.
  // Reconcile these attempts against the OpenAI project usage/cost export.
  if (!usageUnknown) {
    bucket.currentPriceCostUsd += currentCost ?? numberOrZero(row.cost_usd);
  }
}

function sortedEntries(map) {
  return [...map.values()].sort((a, b) => b.currentPriceCostUsd - a.currentPriceCostUsd);
}

function pseudonymousCoupleLabel(coupleId) {
  const reportKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!reportKey) return "(redacted)";
  const digest = createHmac("sha256", reportKey)
    .update(`amora-cost-report-v1:${coupleId}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `couple-${digest}`;
}

async function fetchAll(supabase, fromIso, toIso) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("ai_interactions_log")
      .select("id, created_at, couple_id, interaction_type, specialist_type, success, model, tokens_input, tokens_output, cost_usd, metadata")
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(`ai_interactions_log fetch failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function summarize(rows, options, window) {
  const total = makeBucket("total");
  const byDay = new Map();
  const byModel = new Map();
  const byType = new Map();
  const byCouple = new Map();

  for (const row of rows) {
    const currentCost = calcCostUsd(row);
    addRow(total, row, currentCost);

    const dayKey = kstDayKey(row.created_at);
    if (!byDay.has(dayKey)) byDay.set(dayKey, makeBucket(dayKey));
    addRow(byDay.get(dayKey), row, currentCost);

    const modelName = row.model || "(none)";
    if (!byModel.has(modelName)) byModel.set(modelName, makeBucket(modelName));
    addRow(byModel.get(modelName), row, currentCost);

    const typeName = row.interaction_type || "(none)";
    if (!byType.has(typeName)) byType.set(typeName, makeBucket(typeName));
    addRow(byType.get(typeName), row, currentCost);

    const coupleKey = row.couple_id
      ? pseudonymousCoupleLabel(row.couple_id)
      : "(none)";
    if (!byCouple.has(coupleKey)) byCouple.set(coupleKey, makeBucket(coupleKey));
    addRow(byCouple.get(coupleKey), row, currentCost);
  }

  return {
    generatedAt: new Date().toISOString(),
    window,
    display: {
      krwPerUsd: options.krw,
      currentPriceCostKrw: Math.round(total.currentPriceCostUsd * options.krw),
      storedCostKrw: Math.round(total.storedCostUsd * options.krw),
    },
    total,
    byDay: sortedEntries(byDay).sort((a, b) => a.name.localeCompare(b.name)),
    byModel: sortedEntries(byModel),
    byInteractionType: sortedEntries(byType),
    topCouples: sortedEntries(byCouple).slice(0, 10),
  };
}

function usd(value) {
  return `$${value.toFixed(6)}`;
}

function int(value) {
  return Math.round(value).toLocaleString("en-US");
}

function printBucketRows(title, rows, options) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));
  for (const row of rows) {
    const krw = Math.round(row.currentPriceCostUsd * options.krw).toLocaleString("ko-KR");
    console.log(
      `${row.name.padEnd(34)} rows=${String(row.rows).padStart(4)} ` +
      `cost=${usd(row.currentPriceCostUsd).padStart(11)} (~${krw} KRW) ` +
      `in=${int(row.tokensInput).padStart(9)} out=${int(row.tokensOutput).padStart(8)} ` +
      `cacheW=${int(row.cacheCreationTokens).padStart(8)} cacheR=${int(row.cacheReadTokens).padStart(8)} ` +
      `usage?=${String(row.unknownUsageRows).padStart(3)}`
    );
  }
}

function printText(report, options) {
  console.log("");
  console.log("Amora AI cost report");
  console.log("====================");
  console.log(`Window UTC: ${report.window.fromIso} -> ${report.window.toIso}`);
  console.log(`Rows: ${report.total.rows} (${report.total.successRows} success, ${report.total.failedRows} failed)`);
  console.log(`Tokens: input ${int(report.total.tokensInput)}, output ${int(report.total.tokensOutput)}`);
  console.log(`Cache tokens: write ${int(report.total.cacheCreationTokens)}, read ${int(report.total.cacheReadTokens)}`);
  console.log(`Known-usage cost lower bound:     ${usd(report.total.currentPriceCostUsd)} (~${report.display.currentPriceCostKrw.toLocaleString("ko-KR")} KRW @ ${options.krw}/USD)`);
  console.log(`Stored DB cost_usd sum:          ${usd(report.total.storedCostUsd)} (~${report.display.storedCostKrw.toLocaleString("ko-KR")} KRW)`);
  if (report.total.unknownPriceRows > 0) {
    console.log(`Rows without a known model price: ${report.total.unknownPriceRows} (stored cost used when available)`);
  }
  if (report.total.unknownUsageRows > 0) {
    console.log(`Unknown-usage provider attempts: ${report.total.unknownUsageRows} (not priced as zero; reconcile with provider billing)`);
  }

  printBucketRows("By day (KST)", report.byDay, options);
  printBucketRows("By model", report.byModel, options);
  printBucketRows("By interaction_type", report.byInteractionType, options);
  printBucketRows("Top couples (pseudonymous)", report.topCouples, options);
}

for (const envPath of ENV_PATHS) loadEnvFile(envPath);

const options = parseArgs(process.argv.slice(2));
const { fromIso, toIso } = getWindow(options);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Put them in .env.local or apps/web/.env.local.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = await fetchAll(supabase, fromIso, toIso);
const report = summarize(rows, options, { fromIso, toIso });

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printText(report, options);
}
