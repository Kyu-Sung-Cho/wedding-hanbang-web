import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const previewUrl = process.env.AMORA_PREVIEW_SUPABASE_URL;
const anonKey = process.env.AMORA_PREVIEW_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.AMORA_PREVIEW_SUPABASE_SERVICE_ROLE_KEY;
const expectedRef = process.env.AMORA_PREVIEW_PROJECT_REF;
const productionRef = "slrtobkksjmxgzatjyqb";
const productionConfirmation = `${productionRef}:DELETE_SYNTHETIC_FIXTURES`;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

invariant(previewUrl && anonKey && serviceRoleKey && expectedRef, "Preview URL, ref, anon key, and service key are required.");
const parsedUrl = new URL(previewUrl);
invariant(parsedUrl.hostname.startsWith(`${expectedRef}.`), "Preview URL does not match AMORA_PREVIEW_PROJECT_REF.");
const isProduction = expectedRef === productionRef;
invariant(
  !isProduction || process.env.AMORA_PRODUCTION_SYNTHETIC_CONFIRM === productionConfirmation,
  `Production synthetic fixtures require AMORA_PRODUCTION_SYNTHETIC_CONFIRM=${productionConfirmation}.`
);

const admin = createClient(previewUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdUserIds = new Set();
const cleanupRows = [];

function expectSuccess(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.code ?? "unknown"} ${result.error.message}`);
  }
  return result.data;
}

async function createSyntheticUser(label) {
  const idPart = randomUUID();
  const email = `amora-release-${label}-${idPart}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = expectSuccess(
    `create ${label} auth user`,
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Release ${label}` },
    })
  );
  invariant(created.user, `create ${label} returned no user`);
  createdUserIds.add(created.user.id);

  const client = createClient(previewUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expectSuccess(`sign in ${label}`, await client.auth.signInWithPassword({ email, password }));
  const profile = expectSuccess(
    `verify ${label} profile`,
    await admin.from("profiles").select("id").eq("id", created.user.id).maybeSingle()
  );
  invariant(profile?.id === created.user.id, `${label} signup trigger did not create a profile`);
  return { id: created.user.id, client };
}

async function createCouple(user, role = "bride") {
  const data = expectSuccess(
    "create couple RPC",
    await user.client.rpc("create_couple_for_current_user", { p_role: role })
  );
  invariant(data?.success === true && data?.couple_id && data?.invite_code, "create couple RPC postcondition failed");
  return data;
}

async function testAccountDeletionCascade() {
  const user = await createSyntheticUser("delete-solo");
  const couple = await createCouple(user);
  const summaryId = randomUUID();
  const eventId = randomUUID();
  const searchId = randomUUID();

  expectSuccess("insert synthetic chat summary", await admin.from("chat_summaries").insert({
    id: summaryId,
    couple_id: couple.couple_id,
    user_id: user.id,
    summary_type: "info",
    title: "Release test",
    content: "Synthetic release test summary",
    summary: "Synthetic release test summary",
    message_count: 1,
    importance: 1,
    visibility: "bride_private",
  }));
  expectSuccess("insert synthetic event", await admin.from("customer_events").insert({
    id: eventId,
    user_id: user.id,
    couple_id: couple.couple_id,
    event_type: "release_gate_synthetic",
    metadata: { synthetic: true },
  }));
  expectSuccess("insert synthetic search", await admin.from("search_logs").insert({
    id: searchId,
    user_id: user.id,
    query: "release-gate-synthetic",
    result_count: 0,
  }));
  cleanupRows.push(["customer_events", eventId], ["search_logs", searchId]);

  expectSuccess("delete synthetic Auth user", await admin.auth.admin.deleteUser(user.id));
  createdUserIds.delete(user.id);

  const [profile, deletedCouple, summary, event, search] = await Promise.all([
    admin.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    admin.from("couples").select("id").eq("id", couple.couple_id).maybeSingle(),
    admin.from("chat_summaries").select("id").eq("id", summaryId).maybeSingle(),
    admin.from("customer_events").select("user_id,couple_id").eq("id", eventId).single(),
    admin.from("search_logs").select("user_id").eq("id", searchId).single(),
  ]);
  for (const [label, result] of [["profile", profile], ["couple", deletedCouple], ["summary", summary]]) {
    expectSuccess(`verify deleted ${label}`, result);
    invariant(result.data === null, `${label} remained after Auth deletion`);
  }
  invariant(expectSuccess("verify anonymized event", event)?.user_id === null, "event user_id was not anonymized");
  invariant(event.data?.couple_id === null, "event couple_id was not anonymized");
  invariant(expectSuccess("verify anonymized search", search)?.user_id === null, "search user_id was not anonymized");
}

async function testAtomicReset() {
  const user = await createSyntheticUser("reset");
  const couple = await createCouple(user);
  expectSuccess("atomic reset", await user.client.rpc("reset_current_couple_membership"));
  expectSuccess("atomic reset retry", await user.client.rpc("reset_current_couple_membership"));

  const profile = expectSuccess(
    "verify reset profile",
    await admin.from("profiles")
      .select("couple_id,onboarding_completed,onboarding_step")
      .eq("id", user.id)
      .single()
  );
  invariant(profile.couple_id === null && profile.onboarding_completed === false && profile.onboarding_step === 1, "atomic reset profile state mismatch");
  const removed = expectSuccess(
    "verify reset couple cleanup",
    await admin.from("couples").select("id").eq("id", couple.couple_id).maybeSingle()
  );
  invariant(removed === null, "ownerless couple remained after atomic reset");

  const serviceReset = await admin.rpc("reset_current_couple_membership");
  invariant(Boolean(serviceReset.error), "service role unexpectedly executed authenticated reset RPC");
  expectSuccess("delete reset test user", await admin.auth.admin.deleteUser(user.id));
  createdUserIds.delete(user.id);
}

async function testPartnerRetentionAndConcurrency() {
  const bride = await createSyntheticUser("bride");
  const groom = await createSyntheticUser("groom");
  const couple = await createCouple(bride, "bride");
  const joined = expectSuccess(
    "join partner",
    await groom.client.rpc("join_couple", { p_invite_code: couple.invite_code, p_role: "groom" })
  );
  invariant(joined?.success === true && joined?.couple_id === couple.couple_id, "partner join failed");

  const clientRequestId = randomUUID();
  const requestKey = `chat:${bride.id}:${clientRequestId}`;
  const chatClaims = await Promise.all(Array.from({ length: 12 }, () => admin.rpc(
    "claim_amora_chat_request",
    {
      p_couple_id: couple.couple_id,
      p_request_key: requestKey,
      p_user_id: bride.id,
      p_visibility: "bride_private",
    }
  )));
  const chatActions = chatClaims.map((result) => expectSuccess("parallel chat claim", result)?.action);
  invariant(chatActions.filter((action) => action === "acquired").length === 1, `chat claim acquired count mismatch: ${chatActions.join(",")}`);
  invariant(chatActions.filter((action) => action === "in_progress").length === 11, `chat claim in-progress count mismatch: ${chatActions.join(",")}`);

  const operationKey = createHash("sha256").update(`operation:${randomUUID()}`).digest("hex");
  const inputDigest = createHash("sha256").update(`input:${randomUUID()}`).digest("hex");
  const toolClaims = await Promise.all(Array.from({ length: 12 }, () => admin.rpc(
    "claim_amora_tool_execution",
    {
      p_couple_id: couple.couple_id,
      p_request_key: requestKey,
      p_operation_key: operationKey,
      p_tool_name: "update_budget",
      p_input_digest: inputDigest,
    }
  )));
  const toolActions = toolClaims.map((result) => expectSuccess("parallel tool claim", result)?.action);
  invariant(toolActions.filter((action) => action === "acquired").length === 1, `tool claim acquired count mismatch: ${toolActions.join(",")}`);
  invariant(toolActions.filter((action) => action === "in_progress").length === 11, `tool claim in-progress count mismatch: ${toolActions.join(",")}`);

  const reservations = await Promise.all(Array.from({ length: 10 }, () => admin.rpc(
    "reserve_amora_turn",
    { p_couple_id: couple.couple_id, p_couple_cap: 3, p_global_cap: 1000000 }
  )));
  const reservationRows = reservations.flatMap((result) => expectSuccess("parallel cost reservation", result) ?? []);
  invariant(reservationRows.filter((row) => row.allowed === true).length === 3, "cost reservation exceeded or underused the couple cap");
  invariant(reservationRows.filter((row) => row.reason === "couple_quota").length === 7, "cost reservation rejection count mismatch");

  expectSuccess("delete bride", await admin.auth.admin.deleteUser(bride.id));
  createdUserIds.delete(bride.id);
  const retained = expectSuccess(
    "verify partner couple retained",
    await admin.from("couples").select("bride_id,groom_id").eq("id", couple.couple_id).single()
  );
  invariant(retained.bride_id === null && retained.groom_id === groom.id, "remaining partner membership was not retained");

  expectSuccess("delete groom", await admin.auth.admin.deleteUser(groom.id));
  createdUserIds.delete(groom.id);
  const removed = expectSuccess(
    "verify final partner cleanup",
    await admin.from("couples").select("id").eq("id", couple.couple_id).maybeSingle()
  );
  invariant(removed === null, "couple remained after the final partner deletion");
}

async function cleanup() {
  for (const [table, id] of cleanupRows) {
    await admin.from(table).delete().eq("id", id);
  }
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}

try {
  await testAccountDeletionCascade();
  await testAtomicReset();
  await testPartnerRetentionAndConcurrency();
  console.log(
    `${isProduction ? "Production" : "Preview"} hosted integration passed: Auth cascade, atomic reset, partner retention, and 3 parallel reservation/claim fences.`
  );
} finally {
  await cleanup();
}
