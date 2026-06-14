import fs from "node:fs";
import path from "node:path";

function readEnvFile(filePath) {
  const env = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

const envPath = path.join(process.cwd(), "apps", "web", ".env.local");
const env = readEnvFile(envPath);
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const probes = [
  "profiles",
  "couples",
  "wedding_journeys",
  "account_deletions",
  "customer_survey_responses",
  "chat_feedback",
  "community_reports",
  "cohort_member_reports",
  "cohort_members",
  "cohort_messages",
];

const results = [];

for (const table of probes) {
  const url = `${supabaseUrl}/rest/v1/${table}?select=id&limit=1`;
  const res = await fetch(url, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: "count=exact",
    },
  });
  const text = await res.text();
  results.push({
    table,
    status: res.status,
    contentRange: res.headers.get("content-range") ?? "",
    rowVisible: /^\s*\[\s*\{/.test(text),
    bodyBytes: text.length,
  });
}

console.table(results);

const visible = results.filter((result) => result.rowVisible);
if (visible.length > 0) {
  console.error(
    `Anonymous access still exposes rows for: ${visible.map((r) => r.table).join(", ")}`
  );
  process.exit(1);
}

console.log("Anonymous probe passed: no sensitive rows were visible.");
