import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const previewUrl = process.env.AMORA_PREVIEW_SUPABASE_URL;
const anonKey = process.env.AMORA_PREVIEW_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.AMORA_PREVIEW_SUPABASE_SERVICE_ROLE_KEY;
const expectedRef = process.env.AMORA_PREVIEW_PROJECT_REF;
const productionRef = "slrtobkksjmxgzatjyqb";
const productionConfirmation = `${productionRef}:DELETE_SYNTHETIC_AMORA_V2_FIXTURES`;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function expectSuccess(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.code ?? "unknown"} ${result.error.message}`);
  }
  return result.data;
}

function expectDenied(label, result) {
  invariant(Boolean(result.error), `${label}: operation unexpectedly succeeded`);
  invariant(
    ["42501", "PGRST202", "PGRST301"].includes(result.error.code)
      || /permission denied|not allowed|could not find the function/i.test(result.error.message),
    `${label}: unexpected error ${result.error.code ?? "unknown"} ${result.error.message}`,
  );
}

invariant(previewUrl && anonKey && serviceRoleKey && expectedRef, "Hosted test URL, ref, anon key, and service key are required.");
const parsedUrl = new URL(previewUrl);
invariant(parsedUrl.hostname === `${expectedRef}.supabase.co`, "Hosted test URL does not match AMORA_PREVIEW_PROJECT_REF.");
const isProduction = expectedRef === productionRef;
invariant(
  !isProduction || process.env.AMORA_PRODUCTION_SYNTHETIC_CONFIRM === productionConfirmation,
  `Production fixtures require AMORA_PRODUCTION_SYNTHETIC_CONFIRM=${productionConfirmation}.`,
);

const admin = createClient(previewUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymous = createClient(previewUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const createdUserIds = new Set();

async function createSyntheticUser(label) {
  const email = `amora-v2-${label}-${randomUUID()}@example.invalid`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const created = expectSuccess(
    `create ${label}`,
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Amora V2 ${label}` },
    }),
  );
  invariant(created.user, `create ${label}: no Auth user returned`);
  createdUserIds.add(created.user.id);

  const client = createClient(previewUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expectSuccess(`sign in ${label}`, await client.auth.signInWithPassword({ email, password }));
  const profile = expectSuccess(
    `verify ${label} profile`,
    await admin.from("profiles").select("id").eq("id", created.user.id).maybeSingle(),
  );
  invariant(profile?.id === created.user.id, `${label}: profile trigger did not run`);
  return { id: created.user.id, client };
}

async function createCouple(user, role = "bride") {
  const result = expectSuccess(
    "create couple",
    await user.client.rpc("create_couple_for_current_user", { p_role: role }),
  );
  invariant(result?.success === true && result?.couple_id && result?.invite_code, "create couple postcondition failed");
  return result;
}

async function insertMessage({ coupleId, senderId = null, senderType, role, content, visibility = "shared", metadata = {} }) {
  const message = expectSuccess(
    `insert ${role} message`,
    await admin.from("chat_messages").insert({
      couple_id: coupleId,
      sender_id: senderId,
      sender_type: senderType,
      role,
      content,
      visibility,
      metadata,
    }).select("id,created_at").single(),
  );
  invariant(message?.id, `insert ${role} message returned no id`);
  return message;
}

async function testPermissions({ bride, outsider, coupleId, userMessageId }) {
  expectDenied(
    "anonymous settings read",
    await anonymous.from("amora_memory_settings").select("couple_id").limit(1),
  );
  expectDenied(
    "member direct settings write",
    await bride.client.from("amora_memory_settings").insert({
      couple_id: coupleId,
      visibility: "shared",
      enabled: true,
    }),
  );
  expectDenied(
    "member direct service RPC",
    await bride.client.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:permission_probe",
      p_category: "venue",
      p_title: "권한 검사",
      p_value: "차단되어야 함",
      p_reasoning: null,
      p_confidence: 0.9,
      p_decision_type: "considering",
      p_source_message_id: userMessageId,
      p_metadata: {},
    }),
  );
  // The row is created later by the consent test. This first query verifies
  // that merely knowing a couple UUID never escalates into a write path.
  const outsiderRows = expectSuccess(
    "outsider pre-consent settings read",
    await outsider.client.from("amora_memory_settings").select("couple_id").eq("couple_id", coupleId),
  );
  invariant(Array.isArray(outsiderRows) && outsiderRows.length === 0, "outsider received a pre-consent settings row");
}

async function testMemoryEngine({ bride, groom, coupleId, userMessage, aiMessage }) {
  const initiallyDisabled = expectSuccess(
    "enqueue while disabled",
    await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_to_message_id: aiMessage.id,
    }),
  );
  invariant(initiallyDisabled === "disabled", "memory queue was not default-off");

  expectSuccess("insert legacy inferred memory", await admin.from("decision_nodes").insert({
    couple_id: coupleId,
    category: "preference",
    decision_type: "considering",
    title: "무동의 시절 자동 추론",
    chosen_value: { value: "과거 값" },
    source: "chat",
    metadata: { extracted_by: "legacy", synthetic_release_gate: true },
    visibility: "shared",
  }));
  expectSuccess("insert legacy summary", await admin.from("chat_summaries").insert({
    couple_id: coupleId,
    user_id: bride.id,
    summary_type: "info",
    title: "과거 요약",
    content: "과거 요약",
    summary: "과거 요약",
    message_count: 1,
    to_message_id: aiMessage.id,
    visibility: "shared",
  }));
  expectSuccess("insert legacy profile", await admin.from("amora_couple_profiles").insert({
    couple_id: coupleId,
    visibility: "shared",
    persona_summary: "무동의 시절 자동 추론",
  }));

  const firstConsent = expectSuccess(
    "first shared consent",
    await admin.rpc("set_amora_memory_consent", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_user_id: bride.id,
      p_consented: true,
    }),
  );
  invariant(firstConsent?.enabled === false && firstConsent?.consented_count === 1 && firstConsent?.required_count === 2,
    "one partner unexpectedly enabled shared memory");

  const secondConsent = expectSuccess(
    "second shared consent",
    await admin.rpc("set_amora_memory_consent", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_user_id: groom.id,
      p_consented: true,
    }),
  );
  invariant(secondConsent?.enabled === true && secondConsent?.consented_count === 2,
    "two partner consent did not enable shared memory");
  const legacyCounts = await Promise.all([
    admin.from("decision_nodes").select("id", { count: "exact", head: true })
      .eq("couple_id", coupleId).contains("metadata", { extracted_by: "legacy" }),
    admin.from("chat_summaries").select("id", { count: "exact", head: true })
      .eq("couple_id", coupleId).eq("visibility", "shared"),
    admin.from("amora_couple_profiles").select("id", { count: "exact", head: true })
      .eq("couple_id", coupleId).eq("visibility", "shared"),
  ]);
  for (const [index, result] of legacyCounts.entries()) expectSuccess(`legacy cleanup check ${index + 1}`, result);
  invariant(legacyCounts.every((result) => result.count === 0), "first activation reused pre-consent inferred state");

  const setting = expectSuccess(
    "read activation boundary",
    await admin.from("amora_memory_settings")
      .select("enabled,memory_reset_at")
      .eq("couple_id", coupleId)
      .eq("visibility", "shared")
      .single(),
  );
  invariant(setting.enabled === true && typeof setting.memory_reset_at === "string", "prospective activation boundary is missing");
  invariant(Date.parse(setting.memory_reset_at) >= Date.parse(userMessage.created_at), "activation boundary predates synthetic conversation");

  const beforeBoundary = expectSuccess(
    "enqueue pre-consent turn",
    await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_to_message_id: aiMessage.id,
    }),
  );
  invariant(beforeBoundary === "before_boundary", "pre-consent assistant turn entered the memory queue");
  const oldSource = await admin.rpc("upsert_amora_memory_node", {
    p_couple_id: coupleId,
    p_visibility: "shared",
    p_memory_key: "venue:before_consent",
    p_category: "venue",
    p_title: "과거 선호",
    p_value: "강남",
    p_reasoning: null,
    p_confidence: 0.91,
    p_decision_type: "considering",
    p_source_message_id: userMessage.id,
    p_metadata: {},
  });
  invariant(oldSource.error?.message.includes("AMORA_MEMORY_SOURCE_INVALID"), "pre-consent user turn became a memory source");

  const activeUserMessage = await insertMessage({
    coupleId,
    senderId: bride.id,
    senderType: "bride",
    role: "user",
    content: "동의 후에도 예식장 지역은 강남을 먼저 보고 싶어.",
  });
  const activeAiMessage = await insertMessage({
    coupleId,
    senderType: "ai",
    role: "assistant",
    content: "동의 이후 대화부터 기억 후보로 정리할게.",
  });
  const activeSecondAiMessage = await insertMessage({
    coupleId,
    senderType: "ai",
    role: "assistant",
    content: "비교 기준도 함께 정리할게.",
  });

  const queued = expectSuccess(
    "enqueue enabled memory",
    await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_to_message_id: activeAiMessage.id,
    }),
  );
  const duplicate = expectSuccess(
    "dedupe enabled memory",
    await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_to_message_id: activeAiMessage.id,
    }),
  );
  invariant(queued === "queued" && duplicate === "duplicate", "memory queue idempotence failed");
  const secondQueued = expectSuccess(
    "enqueue second memory job",
    await admin.rpc("enqueue_amora_memory_job", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_to_message_id: activeSecondAiMessage.id,
    }),
  );
  invariant(secondQueued === "queued", "second memory job was not queued");
  const parallelClaims = await Promise.all([
    admin.rpc("claim_amora_memory_job", { p_lease_seconds: 300 }),
    admin.rpc("claim_amora_memory_job", { p_lease_seconds: 300 }),
  ]);
  const claimedJobs = parallelClaims.flatMap((result, index) => {
    const data = expectSuccess(`parallel memory claim ${index + 1}`, result);
    return Array.isArray(data) ? data : [];
  });
  invariant(claimedJobs.length === 1, "parallel workers claimed multiple jobs from one memory scope");
  const claimedJob = claimedJobs[0];
  invariant(claimedJob?.id && Number.isInteger(claimedJob.attempt_count), "claimed job lease token is invalid");
  const finishedClaim = expectSuccess(
    "finish parallel claim",
    await admin.rpc("finish_amora_memory_job", {
      p_job_id: claimedJob.id,
      p_success: true,
      p_error_code: null,
      p_attempt_count: claimedJob.attempt_count,
    }),
  );
  invariant(finishedClaim === true, "current memory lease could not finish its job");

  const firstNodeId = expectSuccess(
    "insert memory node",
    await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:preferred_area",
      p_category: "venue",
      p_title: "선호 지역",
      p_value: "강남",
      p_reasoning: "사용자가 직접 말함",
      p_confidence: 0.91,
      p_decision_type: "considering",
      p_source_message_id: activeUserMessage.id,
      p_metadata: { explicit: true },
    }),
  );
  const retriedNodeId = expectSuccess(
    "retry memory node",
    await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:preferred_area",
      p_category: "venue",
      p_title: "선호 지역",
      p_value: "강남",
      p_reasoning: "사용자가 다시 확인함",
      p_confidence: 0.95,
      p_decision_type: "considering",
      p_source_message_id: activeUserMessage.id,
      p_metadata: { explicit: true },
    }),
  );
  invariant(firstNodeId === retriedNodeId, "same semantic memory created a duplicate node");

  const changedNodeId = expectSuccess(
    "supersede memory node",
    await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:preferred_area",
      p_category: "venue",
      p_title: "선호 지역",
      p_value: "성수",
      p_reasoning: "사용자가 변경함",
      p_confidence: 0.96,
      p_decision_type: "considering",
      p_source_message_id: activeUserMessage.id,
      p_metadata: { explicit: true },
    }),
  );
  invariant(changedNodeId !== firstNodeId, "changed semantic memory did not supersede the old node");

  const correctedNodeId = expectSuccess(
    "user correction",
    await admin.rpc("update_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_id: changedNodeId,
      p_user_id: bride.id,
      p_title: "직접 고친 선호 지역",
      p_value: "한남",
    }),
  );
  const compilerAfterCorrection = expectSuccess(
    "compiler after correction",
    await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:preferred_area",
      p_category: "venue",
      p_title: "선호 지역",
      p_value: "잠실",
      p_reasoning: "대화에서 다시 추출함",
      p_confidence: 0.98,
      p_decision_type: "considering",
      p_source_message_id: activeUserMessage.id,
      p_metadata: { explicit: true },
    }),
  );
  invariant(compilerAfterCorrection === correctedNodeId, "automatic compiler overwrote a user correction");
  const corrected = expectSuccess(
    "verify user correction",
    await admin.from("decision_nodes").select("chosen_value,user_confirmed_at")
      .eq("id", correctedNodeId).single(),
  );
  invariant(corrected.chosen_value?.value === "한남" && corrected.user_confirmed_at,
    "user correction was not preserved");

  const deleted = expectSuccess(
    "delete memory node",
    await admin.rpc("delete_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_id: correctedNodeId,
      p_user_id: bride.id,
    }),
  );
  invariant(deleted === true, "memory deletion failed");
  const compilerAfterDeletion = expectSuccess(
    "compiler after deletion",
    await admin.rpc("upsert_amora_memory_node", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_memory_key: "venue:preferred_area",
      p_category: "venue",
      p_title: "선호 지역",
      p_value: "잠실",
      p_reasoning: "큐에 남아 있던 결과",
      p_confidence: 0.98,
      p_decision_type: "considering",
      p_source_message_id: activeUserMessage.id,
      p_metadata: { explicit: true },
    }),
  );
  invariant(compilerAfterDeletion === correctedNodeId, "deleted memory was recreated by an automatic write");
  const tombstone = expectSuccess(
    "verify memory tombstone",
    await admin.from("decision_nodes").select("superseded_at,metadata").eq("id", correctedNodeId).single(),
  );
  invariant(tombstone.superseded_at && tombstone.metadata?.user_deleted === true, "durable deletion tombstone is missing");

  const summaryInserted = expectSuccess(
    "insert summary",
    await admin.rpc("insert_amora_memory_summary", {
      p_couple_id: coupleId,
      p_user_id: bride.id,
      p_visibility: "shared",
      p_summary: "예식장 지역 선호를 확인했다.",
      p_message_count: 2,
      p_from_message_id: activeUserMessage.id,
      p_to_message_id: activeSecondAiMessage.id,
    }),
  );
  invariant(summaryInserted === true, "memory summary was not inserted");

  const invalidSource = await admin.rpc("upsert_amora_memory_node", {
    p_couple_id: coupleId,
    p_visibility: "shared",
    p_memory_key: "budget:invalid_source",
    p_category: "budget",
    p_title: "예산",
    p_value: "1000만원",
    p_reasoning: null,
    p_confidence: 0.91,
    p_decision_type: "decided",
    p_source_message_id: activeAiMessage.id,
    p_metadata: {},
  });
  invariant(invalidSource.error?.message.includes("AMORA_MEMORY_SOURCE_INVALID"), "AI message was accepted as a memory source");

  const cleared = expectSuccess(
    "clear memory scope",
    await admin.rpc("clear_amora_memory_scope", {
      p_couple_id: coupleId,
      p_visibility: "shared",
      p_user_id: bride.id,
    }),
  );
  invariant(cleared?.cleared === true && Number(cleared.deleted_memory_count) >= 2, "memory scope clear postcondition failed");
  const postClear = await Promise.all([
    admin.from("decision_nodes").select("id", { count: "exact", head: true }).eq("couple_id", coupleId).not("memory_key", "is", null),
    admin.from("chat_summaries").select("id", { count: "exact", head: true }).eq("couple_id", coupleId).eq("visibility", "shared"),
    admin.from("amora_memory_consents").select("user_id", { count: "exact", head: true }).eq("couple_id", coupleId).eq("visibility", "shared"),
    admin.from("amora_memory_settings").select("enabled,memory_reset_at").eq("couple_id", coupleId).eq("visibility", "shared").single(),
  ]);
  for (const [index, result] of postClear.entries()) expectSuccess(`post-clear check ${index + 1}`, result);
  invariant(postClear[0].count === 0 && postClear[1].count === 0 && postClear[2].count === 0,
    "memory scope clear left user-derived state behind");
  invariant(postClear[3].data.enabled === false && postClear[3].data.memory_reset_at, "memory scope was not disabled after clear");
}

async function testCareConsent({ bride, groom, coupleId }) {
  const requestId = `amora-v2-care:${randomUUID()}`;
  const args = {
    p_couple_id: coupleId,
    p_content: "합성 케어 메시지",
    p_metadata: { client_request_id: requestId, synthetic_release_gate: true },
  };
  const noConsent = expectSuccess("care without consent", await admin.rpc("insert_amora_care_message", args));
  invariant(noConsent === null, "care message was sent without consent");

  expectSuccess("enable bride care", await admin.from("profiles").update({
    care_notifications_enabled: true,
    care_notifications_consented_at: new Date().toISOString(),
  }).eq("id", bride.id));
  const oneConsent = expectSuccess("care with one consent", await admin.rpc("insert_amora_care_message", args));
  invariant(oneConsent === null, "shared care message was sent with only one consent");

  expectSuccess("enable groom care", await admin.from("profiles").update({
    care_notifications_enabled: true,
    care_notifications_consented_at: new Date().toISOString(),
  }).eq("id", groom.id));
  const messageId = expectSuccess("care with unanimous consent", await admin.rpc("insert_amora_care_message", args));
  invariant(typeof messageId === "string", "unanimous care consent did not create a message");
  const duplicate = await admin.rpc("insert_amora_care_message", args);
  invariant(duplicate.error?.code === "23505", "care message dedupe index did not reject a duplicate");

  expectSuccess("disable bride care", await admin.from("profiles").update({
    care_notifications_enabled: false,
    care_notifications_consented_at: null,
  }).eq("id", bride.id));
  const afterOptOut = expectSuccess(
    "care after opt-out",
    await admin.rpc("insert_amora_care_message", {
      ...args,
      p_metadata: { ...args.p_metadata, client_request_id: `${requestId}:after-opt-out` },
    }),
  );
  invariant(afterOptOut === null, "care message was sent after opt-out");
}

async function testMediation({ bride, groom, outsider, coupleId, aiMessageId }) {
  const proposalMessage = expectSuccess(
    "load mediation proposal binding",
    await admin.from("chat_messages")
      .select("metadata")
      .eq("id", aiMessageId)
      .eq("couple_id", coupleId)
      .single(),
  );
  const proposalVersion = proposalMessage?.metadata?.mediation?.proposalVersion;
  const rosterFingerprint = proposalMessage?.metadata?.mediation?.rosterFingerprint;
  invariant(
    typeof proposalVersion === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(proposalVersion),
    "mediation proposal did not receive a valid server version",
  );
  invariant(
    typeof rosterFingerprint === "string" && /^[a-f0-9]{32}$/.test(rosterFingerprint),
    "mediation proposal did not receive a valid server roster fingerprint",
  );
  const proposalBinding = {
    p_expected_proposal_version: proposalVersion,
    p_expected_roster_fingerprint: rosterFingerprint,
  };

  const first = expectSuccess(
    "first mediation acceptance",
    await admin.rpc("accept_amora_mediation", {
      p_couple_id: coupleId,
      p_message_id: aiMessageId,
      p_user_id: bride.id,
      p_title: "예산 합의",
      p_resolution: "총액 상한을 함께 정한다",
      ...proposalBinding,
    }),
  );
  invariant(first?.accepted_count === 1 && first?.required_count === 2 && first?.completed === false,
    "one mediation acceptance incorrectly completed a couple decision");
  const second = expectSuccess(
    "second mediation acceptance",
    await admin.rpc("accept_amora_mediation", {
      p_couple_id: coupleId,
      p_message_id: aiMessageId,
      p_user_id: groom.id,
      p_title: "예산 합의",
      p_resolution: "총액 상한을 함께 정한다",
      ...proposalBinding,
    }),
  );
  invariant(second?.accepted_count === 2 && second?.required_count === 2 && second?.completed === true && second?.decision_node_id,
    "two mediation acceptances did not complete one durable decision");
  const retry = expectSuccess(
    "mediation retry",
    await admin.rpc("accept_amora_mediation", {
      p_couple_id: coupleId,
      p_message_id: aiMessageId,
      p_user_id: groom.id,
      p_title: "예산 합의",
      p_resolution: "총액 상한을 함께 정한다",
      ...proposalBinding,
    }),
  );
  invariant(retry.decision_node_id === second.decision_node_id, "mediation retry created a second decision");
  const counted = await admin.from("decision_nodes").select("id", { count: "exact", head: true })
    .eq("couple_id", coupleId).eq("category", "conflict_resolution").eq("source_ref_id", aiMessageId);
  expectSuccess("verify mediation decision count", counted);
  invariant(counted.count === 1, "mediation created more than one decision");

  const denied = await admin.rpc("accept_amora_mediation", {
    p_couple_id: coupleId,
    p_message_id: aiMessageId,
    p_user_id: outsider.id,
    p_title: "권한 없음",
    p_resolution: "기록되면 안 됨",
    ...proposalBinding,
  });
  invariant(denied.error?.message.includes("AMORA_MEDIATION_SCOPE_INVALID"), "outsider mediation acceptance was not rejected");
}

async function cleanup() {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId);
  }
}

try {
  const bride = await createSyntheticUser("bride");
  const groom = await createSyntheticUser("groom");
  const outsider = await createSyntheticUser("outsider");
  const couple = await createCouple(bride, "bride");
  const joined = expectSuccess(
    "join groom",
    await groom.client.rpc("join_couple", { p_invite_code: couple.invite_code, p_role: "groom" }),
  );
  invariant(joined?.success === true && joined?.couple_id === couple.couple_id, "groom join failed");

  const userMessage = await insertMessage({
    coupleId: couple.couple_id,
    senderId: bride.id,
    senderType: "bride",
    role: "user",
    content: "예식장 지역은 강남을 먼저 보고 싶어.",
  });
  const aiMessage = await insertMessage({
    coupleId: couple.couple_id,
    senderType: "ai",
    role: "assistant",
    content: "강남 예식장을 우선 비교해볼게.",
  });
  await testPermissions({ bride, outsider, coupleId: couple.couple_id, userMessageId: userMessage.id });
  await testMemoryEngine({ bride, groom, coupleId: couple.couple_id, userMessage, aiMessage });
  const memberSetting = expectSuccess(
    "member settings RLS",
    await bride.client.from("amora_memory_settings").select("enabled").eq("couple_id", couple.couple_id).single(),
  );
  invariant(memberSetting.enabled === false, "member could not read their own disabled memory setting");
  const outsiderSettings = expectSuccess(
    "outsider settings RLS",
    await outsider.client.from("amora_memory_settings").select("couple_id").eq("couple_id", couple.couple_id),
  );
  invariant(Array.isArray(outsiderSettings) && outsiderSettings.length === 0, "outsider could read another couple's memory setting");
  await testCareConsent({ bride, groom, coupleId: couple.couple_id });
  await testMediation({ bride, groom, outsider, coupleId: couple.couple_id, aiMessageId: aiMessage.id });

  console.log(
    `${isProduction ? "Production" : "Preview"} Amora V2 hosted integration passed: permissions, explicit memory consent, correction/tombstone/clear, care consent, and two-sided mediation.`,
  );
} finally {
  await cleanup();
}
