import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const releaseTargets = JSON.parse(
  readFileSync(new URL("./release-targets.json", import.meta.url), "utf8")
);
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const expectedRef = process.env.SUPABASE_EXPECTED_PROJECT_REF;
const appUrl = process.env.AMORA_SMOKE_BASE_URL?.replace(/\/$/, "");

if (!supabaseUrl || !serviceKey || !anonKey || !expectedRef || !appUrl) {
  throw new Error(
    "SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, " +
      "SUPABASE_EXPECTED_PROJECT_REF, and AMORA_SMOKE_BASE_URL are required."
  );
}
const parsedSupabase = new URL(supabaseUrl);
if (
  parsedSupabase.protocol !== "https:" ||
  parsedSupabase.hostname !== `${expectedRef}.supabase.co`
) {
  throw new Error("Supabase URL does not match the expected preview ref.");
}
if (releaseTargets.productionSupabaseProjectRefs.includes(expectedRef)) {
  throw new Error("Amora provider smoke tests are forbidden on protected production.");
}
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
const email = `codex-amora-${runId}@example.invalid`;
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
  { method = "GET", headers = serviceHeaders, body, prefer, allowError = false } = {}
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: prefer ? { ...headers, Prefer: prefer } : headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(190_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok && !allowError) {
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

async function deleteWhere(table, filter) {
  await admin(`/rest/v1/${table}?${filter}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function cleanup() {
  const failures = [];
  if (coupleId) {
    try {
      const reservations = (
        await admin(
          `/rest/v1/amora_usage_reservations?couple_id=eq.${encodeURIComponent(coupleId)}` +
            "&select=request_key"
        )
      ).payload;
      const requestKeys = Array.isArray(reservations)
        ? [...new Set(reservations.map((row) => row.request_key).filter(Boolean))]
        : [];
      await deleteWhere(
        "amora_usage_reservations",
        `couple_id=eq.${encodeURIComponent(coupleId)}`
      );
      if (requestKeys.length > 0) {
        await deleteWhere(
          "amora_request_claims",
          `request_key=in.(${requestKeys.map(encodeURIComponent).join(",")})`
        );
      }
      await deleteWhere("chat_messages", `couple_id=eq.${encodeURIComponent(coupleId)}`);
      await deleteWhere("ai_interactions_log", `couple_id=eq.${encodeURIComponent(coupleId)}`);
      await deleteWhere("wedding_journeys", `couple_id=eq.${encodeURIComponent(coupleId)}`);
    } catch {
      failures.push("amora-data");
    }
  }
  if (userId) {
    try {
      await admin(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    } catch {
      failures.push("auth-user");
    }
  }
  if (coupleId) {
    try {
      await deleteWhere("couples", `id=eq.${encodeURIComponent(coupleId)}`);
    } catch {
      failures.push("couple");
    }
  }
  if (failures.length > 0) {
    throw new Error(`Amora smoke cleanup failed for ${[...new Set(failures)].join(", ")}.`);
  }
}

try {
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

  let profiles = (
    await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`)
  ).payload;
  if (!Array.isArray(profiles) || profiles.length !== 1) {
    await admin("/rest/v1/profiles", {
      method: "POST",
      prefer: "return=minimal",
      body: { id: userId, email, name: "Amora Provider Smoke" },
    });
    profiles = (
      await admin(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`)
    ).payload;
  }
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

  const auditRows = (
    await admin(
      `/rest/v1/ai_interactions_log?user_id=eq.${encodeURIComponent(userId)}` +
        "&select=model,success,metadata&order=created_at.asc"
    )
  ).payload;
  assert(Array.isArray(auditRows), "AI audit query failed.");
  for (const summary of summaries) {
    const row = auditRows.find(
      (candidate) => candidate?.metadata?.client_request_id === summary.clientRequestId
    );
    assert(row?.success === true, `${summary.expectedModel} audit was not successful.`);
    assert(row?.model === summary.expectedModel, `${summary.expectedModel} was not the audited model.`);
  }

  const messages = (
    await admin(
      `/rest/v1/chat_messages?couple_id=eq.${encodeURIComponent(coupleId)}` +
        "&select=sender_type,role,visibility,metadata"
    )
  ).payload;
  assert(Array.isArray(messages), "Chat message verification failed.");
  for (const turn of turns) {
    const assistantRows = messages.filter(
      (row) =>
        (row?.sender_type === "ai" || row?.role === "assistant") &&
        row?.metadata?.client_request_id === turn.clientRequestId
    );
    assert(assistantRows.length === 1, "Replay created a duplicate assistant message.");
    assert(assistantRows[0].visibility === turn.visibility, "Chat visibility was not preserved.");
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
