import fs from "node:fs";
import path from "node:path";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
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

function parseExpectedProjectRef(argv) {
  const index = argv.indexOf("--expected-project-ref");
  const value = index >= 0 ? argv[index + 1] : "";
  if (!/^[a-z0-9]{20}$/.test(value ?? "")) {
    throw new Error("--expected-project-ref is required and must be a Supabase ref.");
  }
  return value;
}

const expectedProjectRef = parseExpectedProjectRef(process.argv.slice(2));
const verifyKeyOnly = process.argv.includes("--verify-key-only");
const envPath = path.join(process.cwd(), "apps", "web", ".env.local");
const fileEnv = readEnvFile(envPath);
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  || fileEnv.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(supabaseUrl);
} catch {
  console.error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  process.exit(1);
}

const expectedHost = `${expectedProjectRef}.supabase.co`;
if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.hostname !== expectedHost) {
  console.error("Supabase URL does not match the explicitly expected project ref.");
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
const failures = [];

// Prove the key at the Auth public-settings boundary before treating an
// authorization error as evidence. PostgREST's OpenAPI root can legitimately
// require a secret key when every exposed table is locked, so it is not a
// reliable anon-key control request.
try {
  const controlResponse = await fetch(new URL("/auth/v1/settings", parsedBaseUrl), {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const controlBody = await controlResponse.json().catch(() => null);
  if (controlResponse.status !== 200
    || !controlBody
    || typeof controlBody !== "object"
    || Array.isArray(controlBody)
    || !("external" in controlBody)) {
    const safeCode = controlBody && typeof controlBody === "object"
      && typeof controlBody.code === "string"
      ? ` code=${controlBody.code}`
      : "";
    const safeReason = controlBody && typeof controlBody === "object"
      && typeof controlBody.message === "string"
      ? ` reason=${controlBody.message.replace(/\s+/g, " ").slice(0, 120)}`
      : "";
    throw new Error(
      `Supabase Auth control request did not return public settings `
      + `(HTTP ${controlResponse.status}${safeCode}${safeReason}).`
    );
  }
} catch (error) {
  console.error(
    "Supabase anon-key Auth control request failed:",
    error instanceof Error ? error.message : "unknown error"
  );
  process.exit(1);
}

if (verifyKeyOnly) {
  console.log("Supabase anon key is valid for the explicitly expected project.");
} else {
for (const table of probes) {
  const url = new URL(`/rest/v1/${table}?select=id&limit=1`, parsedBaseUrl);
  try {
    const res = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const rawBody = await res.text();
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = null;
    }
    const expectedMessage = `permission denied for table ${table}`;
    const passed = (res.status === 401 || res.status === 403)
      && body !== null
      && typeof body === "object"
      && !Array.isArray(body)
      && body.code === "42501"
      && body.message === expectedMessage;

    results.push({ table, status: res.status, errorCode: body?.code ?? "", passed });
    if (!passed) {
      failures.push(table);
    }
  } catch (error) {
    results.push({
      table,
      status: "network_error",
      errorCode: "",
      passed: false,
    });
    failures.push(table);
    console.error(
      `Anonymous probe request failed for ${table}:`,
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

console.table(results);

if (failures.length > 0) {
  console.error(
    `Anonymous probe failed closed for: ${failures.join(", ")}. `
    + "Expected an exact PostgREST table-permission denial after a valid-key control request."
  );
  process.exit(1);
}

console.log("Anonymous probe passed for the explicitly expected Supabase project.");
}
