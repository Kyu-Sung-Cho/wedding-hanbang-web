import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { assertApprovedPreviewTarget } from "./lib/preview-smoke-guard.mjs";

const releaseTargets = JSON.parse(
  readFileSync(new URL("./release-targets.json", import.meta.url), "utf8")
);
const configuredSupabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const expectedProjectRef = process.env.SUPABASE_EXPECTED_PROJECT_REF;
const appUrl = process.env.AMORA_SMOKE_BASE_URL?.replace(/\/$/, "");

if (!configuredSupabaseUrl || !serviceKey || !anonKey || !expectedProjectRef || !appUrl) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, " +
      "SUPABASE_EXPECTED_PROJECT_REF, and AMORA_SMOKE_BASE_URL are required."
  );
}
const { supabaseUrl, projectRef: expectedRef } = assertApprovedPreviewTarget({
  supabaseUrl: configuredSupabaseUrl,
  expectedProjectRef,
  releaseTargets,
});
const parsedApp = new URL(appUrl);
if (!['http:', 'https:'].includes(parsedApp.protocol)) {
  throw new Error("AMORA_SMOKE_BASE_URL must be HTTP(S).");
}

const serviceHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};
const anonHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  "Content-Type": "application/json",
};
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `hanbang-smoke-${runId}-amora@example.invalid`;
const password = `${randomUUID()}Aa!9`;
let userId;
let coupleId;
let primaryError;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(
  base,
  path,
  { method = "GET", headers = serviceHeaders, body } = {},
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(190_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload && typeof payload.code === "string" ? ` (${payload.code})` : "";
    throw new Error(`Request failed at ${path}: HTTP ${response.status}${code}`);
  }
  return { response, payload };
}

async function admin(path, options) {
  return request(supabaseUrl, path, options);
}

async function rpc(name, body) {
  return (await admin(`/rest/v1/rpc/${name}`, { method: "POST", body })).payload;
}

function parseSse(text) {
  const events = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      events.push(JSON.parse(raw));
    } catch {
      throw new Error("Chat returned malformed SSE JSON.");
    }
  }
  return events;
}

async function chat(accessToken, { prompt, clientRequestId, visibility }) {
  const response = await fetch(`${appUrl}/api/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      coupleId,
      clientRequestId,
      visibility,
      clientCapabilities: { toolCards: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let code = "";
    try {
      const payload = JSON.parse(text);
      if (typeof payload.code === "string") code = ` (${payload.code})`;
    } catch {
      // Response content is intentionally not printed.
    }
    throw new Error(`Amora chat failed: HTTP ${response.status}${code}`);
  }
  const events = parseSse(text);
  const done = [...events].reverse().find((event) => event?.type === "done");
  assert(done && typeof done.fullContent === "string" && done.fullContent.trim(), "No final chat content.");
  assert(!events.some((event) => event?.type === "error"), "Chat emitted an error event.");
  return { events, done };
}

async function cleanup() {
  const failures = [];
  let fixtureCleanupSucceeded = false;
  if (userId) {
    try {
      await rpc("cleanup_preview_smoke_fixture", {
        p_project_ref: expectedRef,
        p_user_ids: [userId],
      });
      fixtureCleanupSucceeded = true;
    } catch {
      failures.push("fixture-data");
    }
  }
  if (userId && fixtureCleanupSucceeded) {
    try {
      await admin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    } catch {
      failures.push("auth-user");
    }
  }
  if (failures.length > 0) {
    throw new Error(`Amora smoke cleanup failed for ${[...new Set(failures)].join(", ")}.`);
  }
}

try {
  const preflight = await rpc("assert_preview_smoke_ready", {
    p_project_ref: expectedRef,
  });
  assert(preflight?.ready === true, "Preview smoke database harness is not ready.");

  const health = await fetch(`${appUrl}/api/health/maintenance`, {
    signal: AbortSignal.timeout(10_000),
  });
  const healthBody = await health.json().catch(() => null);
  assert(health.ok, "Local app health endpoint is unavailable.");
  assert(
    healthBody?.supabaseProjectRef === expectedRef,
    "Local app is not bound to the expected preview Supabase project."
  );

  const created = await admin("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { name: "Amora Provider Smoke" },
    },
  });
  userId = created.payload?.id ?? created.payload?.user?.id;
  assert(typeof userId === "string", "Auth Admin did not create the smoke user.");

  const profiles = (
    await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`)
  ).payload;
  assert(Array.isArray(profiles) && profiles.length === 1, "Smoke profile is missing.");

  const couple = await rpc("create_amora_couple_safely", {
    p_user_id: userId,
    p_role: "bride",
    p_wedding_date: null,
    p_venue: "",
    p_total_budget: 30_000_000,
    p_progress: {},
  });
  coupleId = couple?.couple_id;
  assert(typeof coupleId === "string", "Smoke couple creation failed.");

  const signedIn = await request(
    supabaseUrl,
    "/auth/v1/token?grant_type=password",
    { method: "POST", headers: anonHeaders, body: { email, password } }
  );
  const accessToken = signedIn.payload?.access_token;
  assert(typeof accessToken === "string", "Password sign-in returned no access token.");

  const turns = [
    {
      expectedModel: "gpt-5.6-luna",
      clientRequestId: `smoke-luna-${runId}`,
      prompt: "결혼 준비를 처음 시작해요. 지금 가장 먼저 할 일 세 가지만 짧고 편안하게 알려줘.",
      visibility: "shared",
    },
    {
      expectedModel: "gpt-5.6-terra",
      clientRequestId: `smoke-terra-${runId}`,
      prompt: "예식장 계약 분쟁이 걱정돼요. 계약서에서 꼭 확인할 핵심 세 가지만 차분하게 알려줘.",
      visibility: "bride_private",
    },
  ];
  const summaries = [];
  for (const turn of turns) {
    const first = await chat(accessToken, turn);
    assert(
      first.events.some((event) => event?.type === "text_delta"),
      `${turn.expectedModel} did not stream text deltas.`
    );
    const replay = await chat(accessToken, turn);
    assert(replay.events.length === 1 && replay.events[0]?.type === "done", "Replay was not done-only.");
    assert(
      replay.done.fullContent === first.done.fullContent,
      "Idempotent replay content changed."
    );
    assert(
      replay.done.metadata?.idempotencyReplayed === true,
      "Idempotent replay metadata is missing."
    );
    summaries.push({
      expectedModel: turn.expectedModel,
      clientRequestId: turn.clientRequestId,
      contentLength: first.done.fullContent.length,
      streamed: true,
      replayed: true,
    });
  }

  for (const summary of summaries) {
    const evidence = await rpc("inspect_preview_amora_smoke_turn", {
      p_project_ref: expectedRef,
      p_user_id: userId,
      p_couple_id: coupleId,
      p_client_request_id: summary.clientRequestId,
    });
    const turn = turns.find(
      (candidate) => candidate.clientRequestId === summary.clientRequestId
    );
    assert(evidence?.audit_success === true, `${summary.expectedModel} audit was not successful.`);
    assert(evidence?.audit_model === summary.expectedModel, `${summary.expectedModel} was not audited.`);
    assert(evidence?.assistant_count === 1, "Replay created a duplicate assistant message.");
    assert(evidence?.visibility === turn?.visibility, "Chat visibility was not preserved.");
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      projectRef: expectedRef,
      turns: summaries.map(({ expectedModel, contentLength, streamed, replayed }) => ({
        model: expectedModel,
        contentLength,
        streamed,
        replayed,
      })),
    }) + "\n"
  );
} catch (error) {
  primaryError = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError;
    else process.stderr.write("Amora smoke cleanup also failed; preview requires inspection.\n");
  }
}

if (primaryError) throw primaryError;
