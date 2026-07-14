import { createAdminClient } from "@/lib/supabase/admin";
import { CourtApiError } from "@/app/api/couple-court/_shared";
import { extractCourtKnownEntities } from "@/lib/coupleCourt/privacy";

type AdminClient = ReturnType<typeof createAdminClient>;
type UnknownRow = Record<string, unknown>;

export interface CourtCaseCreateInput {
  creationRequestId: string;
  mode: string;
  category: string;
  tone: string;
  title: string;
}

export interface CourtStatementCreateInput {
  submissionRequestId: string;
  facts: string;
  feelings: string;
  expectations: string;
  attempts: string | null;
  desiredAgreement: string;
  safetyLevel: "normal" | "sensitive" | "high_risk";
  safetyCategories: string[];
}

export interface CourtCaseView {
  case: UnknownRow;
  participant: UnknownRow;
  participants: Array<Pick<UnknownRow, "id" | "role" | "participation_status" | "joined_at">>;
  statements: UnknownRow[];
  verdict: UnknownRow | null;
  missions: UnknownRow[];
  invite: UnknownRow | null;
  publicPost: UnknownRow | null;
  followup: UnknownRow | null;
}

export interface CourtVerdictClaim {
  verdictId: string | null;
  generationVersion: number | null;
  claimStatus: "execute" | "staged" | "in_progress" | "replay" | "unavailable";
  /** Required only when this caller owns the active generation lease. */
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  result: UnknownRow | null;
  missions: UnknownRow[];
  model: string | null;
  auditModel: string | null;
  auditUserId: string | null;
  auditCoupleId: string | null;
  auditPreflightSafetyLevel: "normal" | "sensitive" | null;
  providerAuditState: "pending" | "audited" | null;
  providerRequestKey: string | null;
  /** Immutable identity of a staged paid result; may predate this deployment. */
  inputHash: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  stagedAt: string | null;
  usage: CourtProviderUsage | null;
}

export interface CourtProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteInputTokens: number | null;
  cachedInputTokens: number | null;
}

export interface CourtProviderSettlementResult extends UnknownRow {
  verdict_id: string;
  provider_state: "result_staged" | "failed_invalid";
  provider_audit_state: "pending" | "audited";
  subject_deleted: boolean;
}

export interface CourtHighRiskProviderSettlementResult extends CourtProviderSettlementResult {
  provider_state: "failed_invalid";
  request_key: string;
  safety_level: "high_risk";
  safety_categories: string[];
}

export interface CourtProviderAuditFinalizationResult extends UnknownRow {
  verdict_id: string;
  provider_state: "result_staged" | "failed_invalid";
  provider_audit_state: "audited";
  subject_deleted: boolean;
}

export interface CourtVerdictHistoryItem {
  generationVersion: number;
  status: "ready" | "superseded";
  completedAt: string | null;
  supersededAt: string | null;
}

export interface CourtKeysetCursor {
  at: string;
  id: string;
}

export interface CourtKeysetPage<T> {
  items: T[];
  nextCursor: CourtKeysetCursor | null;
}

export interface CourtVerdictPollingStatus {
  status: "ready" | "judging" | "not_ready" | "safety_redirect";
  retryAfterSeconds?: number;
  recoveryAllowed?: boolean;
}

const CASE_FIELDS = [
  "id",
  "creator_user_id",
  "couple_id",
  "mode",
  "category",
  "tone",
  "workflow_status",
  "safety_level",
  "safety_review_status",
  "title",
  "lock_version",
  "created_at",
  "updated_at",
  "archived_at",
].join(",");

const PARTICIPANT_FIELDS = "id,case_id,user_id,role,participation_status,joined_at";
const STATEMENT_FIELDS = [
  "id",
  "case_id",
  "participant_id",
  "submission_request_id",
  "revision",
  "facts",
  "feelings",
  "expectations",
  "attempts",
  "desired_agreement",
  "submitted_safety_level",
  "submitted_at",
  "created_at",
].join(",");
const VERDICT_FIELDS = [
  "id",
  "case_id",
  "generation_status",
  "input_hash",
  "prompt_version",
  "schema_version",
  "result_json",
  "model",
  "created_at",
  "completed_at",
].join(",");
const MISSION_FIELDS = [
  "id",
  "verdict_id",
  "owner_role",
  "title",
  "description",
  "completion_check",
  "due_in_minutes",
  "fun_tag",
  "related_feature",
  "mission_status",
  "amora_action_id",
  "created_at",
].join(",");

function asRow(value: unknown): UnknownRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRow;
}

function firstRow(value: unknown): UnknownRow | null {
  if (Array.isArray(value)) return asRow(value[0]);
  return asRow(value);
}

function stringField(row: UnknownRow | null, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" ? value : null;
}

function integerField(row: UnknownRow | null, key: string): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function courtVerdictRecoveryState(row: UnknownRow | null): {
  retryAfterSeconds: number;
  recoveryAllowed: boolean;
} {
  const leaseExpiresAt = stringField(row, "lease_expires_at");
  if (!leaseExpiresAt) {
    return { retryAfterSeconds: 1, recoveryAllowed: true };
  }
  const remainingMs = Date.parse(leaseExpiresAt) - Date.now();
  if (!Number.isFinite(remainingMs)) {
    // A malformed lease must never authorize an automatic mutation.
    return { retryAfterSeconds: 5, recoveryAllowed: false };
  }
  if (remainingMs <= 0) {
    return { retryAfterSeconds: 1, recoveryAllowed: true };
  }
  return {
    retryAfterSeconds: Math.min(300, Math.max(1, Math.ceil(remainingMs / 1_000) + 1)),
    recoveryAllowed: false,
  };
}

function providerUsage(value: unknown): CourtProviderUsage | null {
  const row = asRow(value);
  if (!row) return null;
  const read = (key: string): number | null | undefined => {
    const item = row[key];
    if (item === null || item === undefined) return null;
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 0) return undefined;
    return item;
  };
  const inputTokens = read("input_tokens");
  const outputTokens = read("output_tokens");
  const cacheWriteInputTokens = read("cache_write_input_tokens");
  const cachedInputTokens = read("cached_input_tokens");
  if (
    inputTokens === undefined
    || outputTokens === undefined
    || cacheWriteInputTokens === undefined
    || cachedInputTokens === undefined
    || (inputTokens === null) !== (outputTokens === null)
    || (inputTokens === null && (cacheWriteInputTokens !== null || cachedInputTokens !== null))
    || (inputTokens !== null && (
      (cacheWriteInputTokens ?? 0) > inputTokens
      || (cachedInputTokens ?? 0) > inputTokens
    ))
  ) {
    return null;
  }
  return { inputTokens, outputTokens, cacheWriteInputTokens, cachedInputTokens };
}

function providerAuditState(value: unknown): "pending" | "audited" | null {
  return value === "pending" || value === "audited" ? value : null;
}

function invalidProviderRpcResult(): never {
  repositoryError({
    code: "invalid_rpc_result",
    message: "court provider RPC returned an invalid contract",
  });
}

/**
 * Keep authenticated API responses on an explicit allowlist. The repository
 * uses the service-role client, so spreading database rows here would expose
 * tenant identifiers and internal concurrency/safety-review fields that the UI
 * neither needs nor should receive.
 */
function publicCourtCase(row: UnknownRow): UnknownRow {
  return {
    id: row.id,
    mode: row.mode,
    category: row.category,
    tone: row.tone,
    workflow_status: row.workflow_status,
    safety_level: row.safety_level,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
  };
}

function publicParticipant(row: UnknownRow): UnknownRow {
  return {
    role: row.role,
    participation_status: row.participation_status,
    joined_at: row.joined_at,
  };
}

function publicOwnStatement(row: UnknownRow): UnknownRow {
  return {
    // Returned only inside the authenticated viewer's own statement envelope.
    // It lets the client prove an exact lost-ACK replay without exposing the
    // other participant, case, or statement identifiers.
    submission_request_id: row.submission_request_id,
    revision: row.revision,
    facts: row.facts,
    feelings: row.feelings,
    expectations: row.expectations,
    attempts: row.attempts,
    desired_agreement: row.desired_agreement,
    submitted_safety_level: row.submitted_safety_level,
    submitted_at: row.submitted_at,
    created_at: row.created_at,
  };
}

function publicVerdict(row: UnknownRow): UnknownRow {
  return {
    id: row.id,
    generation_status: row.generation_status,
    result_json: row.result_json,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

function publicMission(row: UnknownRow): UnknownRow {
  return {
    id: row.id,
    owner_role: row.owner_role,
    title: row.title,
    description: row.description,
    completion_check: row.completion_check,
    due_in_minutes: row.due_in_minutes,
    fun_tag: row.fun_tag,
    related_feature: row.related_feature,
    mission_status: row.mission_status,
    viewer_completion_status: row.viewer_completion_status,
    saved: typeof row.amora_action_id === "string" && row.amora_action_id.length > 0,
    created_at: row.created_at,
  };
}

function repositoryError(error: unknown): never {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown }
    : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";

  if (code === "42P01" || code === "PGRST202" || code === "PGRST205") {
    throw new CourtApiError(
      503,
      "COUPLE_COURT_STORAGE_UNAVAILABLE",
      "커플재판소 저장소를 준비하고 있어요.",
    );
  }
  if (/court_(?:case_)?not_found|court_invite_invalid/.test(message)) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건이나 초대를 찾을 수 없어요.");
  }
  if (code === "54000" || /court verdict retry limit reached/i.test(message)) {
    throw new CourtApiError(
      429,
      "COURT_VERDICT_RETRY_LIMIT_REACHED",
      "판결 재시도 횟수를 초과했어요. 잠시 후 고객지원에 문의해 주세요.",
    );
  }
  if (/court_provider_(?:manual_reconciliation_required|result_unknown)/i.test(message)) {
    throw new CourtApiError(
      503,
      "COURT_PROVIDER_RESULT_UNKNOWN",
      "이전 판결 요청의 처리 결과를 운영팀이 확인하고 있어요. 비용 중복을 막기 위해 자동 재요청하지 않습니다.",
    );
  }
  if (/court_comment_submission_request_mismatch/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_COMMENT_REQUEST_CONFLICT",
      "같은 댓글 작성 요청으로 다른 내용을 보낼 수 없어요.",
    );
  }
  if (code === "55000") {
    throw new CourtApiError(
      409,
      "COURT_STATE_CONFLICT",
      "사건 상태가 바뀌었거나 이미 확정된 기록이에요. 새로고침한 뒤 다시 확인해 주세요.",
    );
  }
  if (/court_followup_too_early/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_FOLLOWUP_TOO_EARLY",
      "3일 후 체크인이 아직 열리지 않았어요.",
    );
  }
  if (/court_followup_already_recorded/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_FOLLOWUP_ALREADY_RECORDED",
      "이 판결의 체크인은 이미 저장했어요.",
    );
  }
  if (/court_partner_leave_locked/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_PARTNER_LEAVE_LOCKED",
      "진술을 제출한 뒤에는 이 사건에서 나갈 수 없어요.",
    );
  }
  if (/court verdict (?:claim is no longer valid|completion fence mismatch)/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_VERDICT_CLAIM_EXPIRED",
      "판결 요청 상태가 바뀌었어요. 새로고침 후 다시 확인해 주세요.",
    );
  }
  if (/court_delete_requires_joint_policy/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_DELETE_REQUIRES_JOINT_POLICY",
      "상대방 진술이 접수된 사건은 지금 영구 삭제할 수 없어요. 대신 보관해 주세요.",
    );
  }
  if (/shared court action confirmation is required/i.test(message)) {
    throw new CourtApiError(
      409,
      "SHARED_ACTION_CONFIRMATION_REQUIRED",
      "커플 공용 할일에 보이는 것을 먼저 확인해 주세요.",
    );
  }
  if (/court_invite_expired/.test(message)) {
    throw new CourtApiError(410, "COURT_INVITE_EXPIRED", "초대 링크가 만료됐어요.");
  }
  if (/court_invite_couple_mismatch/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_INVITE_COUPLE_MISMATCH",
      "현재 연결된 커플 계정과 이 초대의 커플 정보가 달라요. 초대를 보낸 상대와 계정 연결을 확인해 주세요.",
    );
  }
  if (/court applicant cannot reject their own invite/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_INVITE_SELF_ACTION_FORBIDDEN",
      "내가 만든 초대 링크는 직접 거절할 수 없어요.",
    );
  }
  if (/court invite cannot be accepted by this user/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_INVITE_ACCOUNT_MISMATCH",
      "이 계정으로는 초대를 수락할 수 없어요. 초대받은 당사자 계정인지 확인해 주세요.",
    );
  }
  if (/court invite (?:is unavailable|rejection changed concurrently)/i.test(message)) {
    throw new CourtApiError(
      409,
      "COURT_INVITE_UNAVAILABLE",
      "이 초대는 현재 사용할 수 없어요. 신청인에게 새 링크를 요청해 주세요.",
    );
  }
  if (/court_invite_(?:used|consumed|revoked|rejected)/.test(message)) {
    throw new CourtApiError(409, "COURT_INVITE_UNAVAILABLE", "이미 사용했거나 취소된 초대예요.");
  }
  if (/court_(?:access_denied|participant_required|role_forbidden)/.test(message) || code === "42501") {
    throw new CourtApiError(403, "COURT_ACCESS_DENIED", "이 사건에 접근할 수 없어요.");
  }
  if (/court_(?:invalid_state|statement_locked|version_conflict|claim_conflict)/.test(message) || code === "23505") {
    throw new CourtApiError(409, "COURT_STATE_CONFLICT", "사건 상태가 바뀌었어요. 새로고침 후 다시 시도해 주세요.");
  }
  if (code === "23514" || code === "22023") {
    throw new CourtApiError(400, "COURT_VALIDATION_FAILED", "입력 내용을 확인해 주세요.");
  }

  console.error("COUPLE_COURT_REPOSITORY_FAILED", code || "unknown");
  throw new CourtApiError(500, "COUPLE_COURT_STORAGE_FAILED", "사건 정보를 처리하지 못했어요.");
}

async function participantForUser(
  admin: AdminClient,
  caseId: string,
  userId: string,
): Promise<UnknownRow> {
  const { data, error } = await admin
    .from("court_participants")
    .select(PARTICIPANT_FIELDS)
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .eq("participation_status", "active")
    .maybeSingle();
  if (error) repositoryError(error);
  const participant = asRow(data);
  if (!participant) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }
  return participant;
}

export async function listCourtCasesForUser(
  userId: string,
  limit: number,
  before: CourtKeysetCursor | null = null,
): Promise<CourtKeysetPage<UnknownRow>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_court_cases_for_user", {
    p_user_id: userId,
    p_before_updated_at: before?.at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: limit,
  });
  if (error) repositoryError(error);
  const rows = (data ?? []) as unknown as UnknownRow[];
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1) ?? null;
  const nextCursor = rows.length > limit
    ? { at: stringField(last, "updated_at"), id: stringField(last, "id") }
    : null;
  if (nextCursor && (!nextCursor.at || !nextCursor.id)) {
    repositoryError({ code: "invalid_court_case_page" });
  }
  return {
    items: pageRows.map((row) => ({
      ...publicCourtCase(row),
      status: stringField(row, "workflow_status"),
      my_role: stringField(row, "my_role"),
    })),
    nextCursor: nextCursor as CourtKeysetCursor | null,
  };
}

export async function createCourtCaseForUser(
  userId: string,
  input: CourtCaseCreateInput,
): Promise<CourtCaseView> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_court_case_with_applicant", {
    p_user_id: userId,
    p_creation_request_id: input.creationRequestId,
    p_mode: input.mode,
    p_category: input.category,
    p_tone: input.tone,
    p_title: input.title,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const caseId = stringField(row, "case_id") ?? stringField(row, "id");
  if (!caseId) repositoryError({ code: "invalid_rpc_result" });
  return getCourtCaseForUser(caseId, userId);
}

export async function getCourtCaseForUser(
  caseId: string,
  userId: string,
): Promise<CourtCaseView> {
  const admin = createAdminClient();
  const participant = await participantForUser(admin, caseId, userId);

  const { data: caseData, error: caseError } = await admin
    .from("court_cases")
    .select(CASE_FIELDS)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) repositoryError(caseError);
  const courtCase = asRow(caseData);
  if (!courtCase) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }

  const { data: participantData, error: participantsError } = await admin
    .from("court_participants")
    .select("id,role,participation_status,joined_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (participantsError) repositoryError(participantsError);
  const participants = (participantData ?? []) as UnknownRow[];

  const { data: submissionMetadata, error: submissionMetadataError } = await admin
    .from("court_statements")
    .select("participant_id,submitted_at,revision")
    .eq("case_id", caseId)
    .not("submitted_at", "is", null)
    .order("revision", { ascending: false });
  if (submissionMetadataError) repositoryError(submissionMetadataError);
  const submittedParticipantIds = new Set(
    ((submissionMetadata ?? []) as UnknownRow[])
      .map((row) => stringField(row, "participant_id"))
      .filter((value): value is string => Boolean(value)),
  );
  const roleByParticipantId = new Map(
    participants.map((row) => [stringField(row, "id"), stringField(row, "role")]),
  );
  const applicantSubmitted = [...submittedParticipantIds]
    .some((id) => roleByParticipantId.get(id) === "applicant");
  const partnerSubmitted = [...submittedParticipantIds]
    .some((id) => roleByParticipantId.get(id) === "partner");
  const partnerJoined = participants.some((row) => (
    stringField(row, "role") === "partner" && stringField(row, "participation_status") === "active"
  ));

  const participantId = stringField(participant, "id");
  const { data: ownStatementData, error: ownStatementError } = await admin
    .from("court_statements")
    .select(STATEMENT_FIELDS)
    .eq("case_id", caseId)
    .eq("participant_id", participantId)
    .order("revision", { ascending: false })
    .limit(1);
  if (ownStatementError) repositoryError(ownStatementError);
  const ownStatement = firstRow(ownStatementData);

  const statements = ownStatement ? [publicOwnStatement(ownStatement)] : [];
  const workflowStatus = stringField(courtCase, "workflow_status");
  const isHighRisk = stringField(courtCase, "safety_level") === "high_risk";

  let verdict: UnknownRow | null = null;
  let missions: UnknownRow[] = [];
  let followup: UnknownRow | null = null;
  // Once a case is escalated, old playful/percentage verdicts must disappear
  // from every ordinary API response, including a follow-up escalation that
  // occurs after a verdict was previously ready.
  if (!isHighRisk && workflowStatus && ["verdict_ready", "mission_active", "resolved", "archived"].includes(workflowStatus)) {
    const { data: verdictData, error: verdictError } = await admin
      .from("court_verdicts")
      .select(VERDICT_FIELDS)
      .eq("case_id", caseId)
      .eq("generation_status", "ready")
      .order("completed_at", { ascending: false })
      .limit(1);
    if (verdictError) repositoryError(verdictError);
    verdict = firstRow(verdictData);
    const verdictId = stringField(verdict, "id");
    if (verdictId) {
      const { data: missionData, error: missionError } = await admin
        .from("court_missions")
        .select(MISSION_FIELDS)
        .eq("verdict_id", verdictId)
        .order("created_at", { ascending: true });
      if (missionError) repositoryError(missionError);
      missions = (missionData ?? []) as unknown as UnknownRow[];
      const missionIds = missions
        .map((mission) => stringField(mission, "id"))
        .filter((id): id is string => Boolean(id));
      if (participantId && missionIds.length > 0) {
        const { data: completionData, error: completionError } = await admin
          .from("court_mission_completions")
          .select("mission_id,completion_status")
          .eq("participant_id", participantId)
          .in("mission_id", missionIds);
        if (completionError) repositoryError(completionError);
        const statusByMission = new Map(
          ((completionData ?? []) as unknown as UnknownRow[]).map((completion) => [
            stringField(completion, "mission_id"),
            stringField(completion, "completion_status"),
          ]),
        );
        missions = missions.map((mission) => ({
          ...mission,
          viewer_completion_status: statusByMission.get(stringField(mission, "id")) ?? null,
        }));
      }
      if (participantId) {
        const { data: followupData, error: followupError } = await admin
          .from("court_followups")
          .select("created_at,satisfaction")
          .eq("verdict_id", verdictId)
          .eq("participant_id", participantId)
          .limit(1);
        if (followupError) repositoryError(followupError);
        followup = firstRow(followupData);
      }
    }
  }

  let invite: UnknownRow | null = null;
  if (stringField(participant, "role") === "applicant") {
    const { data: inviteData, error: inviteError } = await admin
      .from("court_invites")
      .select("id,expires_at,consumed_at,revoked_at,rejected_at,created_at")
      .eq("case_id", caseId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    if (inviteError) repositoryError(inviteError);
    invite = firstRow(inviteData);
  }

  const { data: publicData, error: publicError } = await admin
    .from("court_public_posts")
    // This is the already-sanitized allowlist, returned only to an authorized
    // case participant so both people can review and consent to the exact same
    // hash/version. Private verdict or statement fields are never copied here.
    .select("id,status,sanitized_snapshot_json,snapshot_hash,snapshot_version,published_at,hidden_at")
    .eq("case_id", caseId)
    .order("snapshot_version", { ascending: false })
    .limit(1);
  if (publicError && !["42P01", "PGRST205"].includes(publicError.code ?? "")) {
    repositoryError(publicError);
  }
  const publicPost = firstRow(publicData);
  let viewerPublicConsented = false;
  const publicPostId = stringField(publicPost, "id");
  const publicSnapshotHash = stringField(publicPost, "snapshot_hash");
  if (participantId && publicPostId && publicSnapshotHash) {
    const { data: viewerConsentData, error: viewerConsentError } = await admin
      .from("court_public_consents")
      .select("id")
      .eq("public_post_id", publicPostId)
      .eq("participant_id", participantId)
      .eq("snapshot_hash", publicSnapshotHash)
      .is("revoked_at", null)
      .limit(1);
    if (viewerConsentError) repositoryError(viewerConsentError);
    viewerPublicConsented = firstRow(viewerConsentData) !== null;
  }

  const normalizedCase = {
    ...publicCourtCase(courtCase),
    status: workflowStatus,
    viewer_role: stringField(participant, "role"),
    applicant_statement_submitted: applicantSubmitted,
    partner_joined: partnerJoined,
    partner_statement_submitted: partnerSubmitted,
    can_judge: workflowStatus === "statements_complete"
      && stringField(courtCase, "safety_level") !== "high_risk",
    verdict_ready: verdict !== null,
  };

  const inviteExpiresAt = invite
    && invite.consumed_at == null
    && invite.revoked_at == null
    && invite.rejected_at == null
    && typeof invite.expires_at === "string"
    && Date.parse(invite.expires_at) > Date.now()
    ? invite.expires_at
    : null;

  return {
    case: normalizedCase,
    participant: publicParticipant(participant),
    participants: participants.map(publicParticipant) as CourtCaseView["participants"],
    statements,
    verdict: verdict ? publicVerdict(verdict) : null,
    missions: missions.map(publicMission),
    invite: invite
      ? {
          // Only an actually usable token may be described as active. Keep a
          // rejection timestamp separately so the applicant can issue a new
          // link without leaking who or why; consumed/expired links are inert.
          expires_at: inviteExpiresAt,
          rejected_at: invite.rejected_at,
          created_at: invite.created_at,
        }
      : null,
    publicPost: publicPost
      ? { ...publicPost, viewer_consented: viewerPublicConsented }
      : null,
    followup,
  };
}

/**
 * Server-only quota context. This deliberately stays separate from
 * getCourtCaseForUser so a case's tenant UUID can never be serialized by an API
 * route that returns the ordinary case view.
 */
export async function getCourtCaseQuotaContextForUser(
  caseId: string,
  userId: string,
): Promise<{ coupleId: string | null; safetyScopeId: string }> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);
  const { data, error } = await admin
    .from("court_cases")
    .select("couple_id,creator_user_id")
    .eq("id", caseId)
    .maybeSingle();
  if (error) repositoryError(error);
  if (!data) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }
  const coupleId = typeof data.couple_id === "string" ? data.couple_id : null;
  const creatorUserId = typeof data.creator_user_id === "string" ? data.creator_user_id : null;
  if (!creatorUserId) repositoryError({ code: "invalid_case_tenant" });
  return { coupleId, safetyScopeId: coupleId ?? creatorUserId };
}

/**
 * Provider-only statement read. Normal case responses always return the
 * viewer's own latest statement; the other participant's raw text never
 * crosses the API response boundary, even after both sides submit.
 */
export async function getCourtStatementsForJudgment(
  caseId: string,
  userId: string,
): Promise<{ participants: UnknownRow[]; statements: UnknownRow[] }> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);

  const { data: participantData, error: participantError } = await admin
    .from("court_participants")
    .select("id,role,participation_status")
    .eq("case_id", caseId)
    .eq("participation_status", "active")
    .order("created_at", { ascending: true });
  if (participantError) repositoryError(participantError);

  const { data: statementData, error: statementError } = await admin
    .from("court_statements")
    .select(STATEMENT_FIELDS)
    .eq("case_id", caseId)
    .not("submitted_at", "is", null)
    .order("revision", { ascending: false });
  if (statementError) repositoryError(statementError);

  const newestByParticipant = new Map<string, UnknownRow>();
  for (const row of (statementData ?? []) as unknown as UnknownRow[]) {
    const ownerId = stringField(row, "participant_id");
    if (ownerId && !newestByParticipant.has(ownerId)) newestByParticipant.set(ownerId, row);
  }
  return {
    participants: (participantData ?? []) as unknown as UnknownRow[],
    statements: [...newestByParticipant.values()],
  };
}

/**
 * Returns when a crashed/in-flight generation may be safely reclaimed. It
 * exposes only a bounded delay, never the lease token itself.
 */
export async function getCourtVerdictRecoveryDelaySeconds(
  caseId: string,
  userId: string,
): Promise<number> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);
  const { data, error } = await admin
    .from("court_verdicts")
    .select("lease_expires_at")
    .eq("case_id", caseId)
    .eq("generation_status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) repositoryError(error);
  return courtVerdictRecoveryState(firstRow(data)).retryAfterSeconds;
}

/**
 * Minimal polling projection. It deliberately avoids statements, verdict
 * payloads, missions, public posts and history until the result is ready.
 */
export async function getCourtVerdictStatusForUser(
  caseId: string,
  userId: string,
): Promise<CourtVerdictPollingStatus> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);

  const { data: caseData, error: caseError } = await admin
    .from("court_cases")
    .select("workflow_status,safety_level")
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) repositoryError(caseError);
  const courtCase = asRow(caseData);
  if (!courtCase) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }
  if (stringField(courtCase, "safety_level") === "high_risk") {
    return { status: "safety_redirect" };
  }

  const workflowStatus = stringField(courtCase, "workflow_status");
  if (workflowStatus && ["verdict_ready", "mission_active", "resolved"].includes(workflowStatus)) {
    return { status: "ready" };
  }
  if (workflowStatus === "archived") {
    const { data: archivedVerdictData, error: archivedVerdictError } = await admin
      .from("court_verdicts")
      .select("id")
      .eq("case_id", caseId)
      .eq("generation_status", "ready")
      .limit(1);
    if (archivedVerdictError) repositoryError(archivedVerdictError);
    return { status: firstRow(archivedVerdictData) ? "ready" : "not_ready" };
  }
  if (workflowStatus !== "judging") {
    return { status: "not_ready" };
  }

  const { data: verdictData, error: verdictError } = await admin
    .from("court_verdicts")
    .select("lease_expires_at")
    .eq("case_id", caseId)
    .eq("generation_status", "in_progress")
    .order("started_at", { ascending: false })
    .limit(1);
  if (verdictError) repositoryError(verdictError);
  const recovery = courtVerdictRecoveryState(firstRow(verdictData));
  return {
    status: "judging",
    retryAfterSeconds: recovery.retryAfterSeconds,
    recoveryAllowed: recovery.recoveryAllowed,
  };
}

/** Metadata-only history. Previous model text is intentionally not exposed. */
export async function getCourtVerdictHistoryForUser(
  caseId: string,
  userId: string,
): Promise<CourtVerdictHistoryItem[]> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);
  const { data: caseData, error: caseError } = await admin
    .from("court_cases")
    .select("safety_level")
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) repositoryError(caseError);
  if (!caseData || caseData.safety_level === "high_risk") return [];

  const { data, error } = await admin
    .from("court_verdicts")
    .select("generation_version,generation_status,completed_at,superseded_at")
    .eq("case_id", caseId)
    .in("generation_status", ["ready", "superseded"])
    .order("generation_version", { ascending: false })
    .limit(20);
  if (error) repositoryError(error);
  return ((data ?? []) as UnknownRow[]).flatMap((row) => {
    const version = row.generation_version;
    const status = row.generation_status;
    if (
      typeof version !== "number"
      || !Number.isSafeInteger(version)
      || version < 1
      || (status !== "ready" && status !== "superseded")
    ) return [];
    return [{
      generationVersion: version,
      status,
      completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
      supersededAt: typeof row.superseded_at === "string" ? row.superseded_at : null,
    }];
  });
}

export async function submitCourtStatementForUser(
  caseId: string,
  userId: string,
  input: CourtStatementCreateInput,
): Promise<{ courtCase: CourtCaseView; safety: UnknownRow }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("submit_court_statement", {
    p_case_id: caseId,
    p_user_id: userId,
    p_submission_request_id: input.submissionRequestId,
    p_facts: input.facts,
    p_feelings: input.feelings,
    p_expectations: input.expectations,
    p_attempts: input.attempts,
    p_desired_agreement: input.desiredAgreement,
    p_safety_level: input.safetyLevel,
    p_safety_categories: input.safetyCategories.slice(0, 12),
  });
  if (error) repositoryError(error);
  return {
    courtCase: await getCourtCaseForUser(caseId, userId),
    safety: firstRow(data) ?? {},
  };
}

export async function markCourtCaseSafetyForUser(options: {
  caseId: string;
  userId: string;
  level: "normal" | "sensitive" | "high_risk";
  categories: string[];
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mark_court_case_safety", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
    p_level: options.level,
    p_categories: options.categories.slice(0, 12),
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

/** Atomically fences verdict generation before a high-risk redirect. */
export async function escalateCourtCaseSafetyFromAiPreflight(options: {
  caseId: string;
  userId: string;
  categories: string[];
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "escalate_court_case_safety_from_ai_preflight",
    {
      p_case_id: options.caseId,
      p_user_id: options.userId,
      p_categories: options.categories.slice(0, 12),
    },
  );
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function issueCourtInviteForUser(options: {
  caseId: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("issue_court_invite", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
    p_token_hash: options.tokenHash,
    p_expires_at: options.expiresAt,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function cancelCourtInviteForUser(options: {
  caseId: string;
  userId: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("cancel_court_invite", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function acceptCourtInviteForUser(
  userId: string,
  tokenHash: string,
): Promise<{ caseId: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("accept_court_invite", {
    p_token_hash: tokenHash,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const caseId = stringField(row, "case_id");
  if (!caseId) repositoryError({ code: "invalid_rpc_result" });
  return { caseId };
}

export async function rejectCourtInviteForUser(
  userId: string,
  tokenHash: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("reject_court_invite", {
    p_token_hash: tokenHash,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
}

export async function leaveCourtCaseForUser(
  caseId: string,
  userId: string,
): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("leave_court_case", {
    p_case_id: caseId,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function claimCourtVerdictForUser(options: {
  caseId: string;
  userId: string;
  inputHash: string;
  promptVersion: string;
  schemaVersion: string;
  model: string;
  leaseSeconds?: number;
  /** False permits durable recovery/replay but never starts a new provider lease. */
  allowNewClaim?: boolean;
}): Promise<CourtVerdictClaim> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_court_verdict", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
    p_input_hash: options.inputHash,
    p_prompt_version: options.promptVersion,
    p_schema_version: options.schemaVersion,
    p_model: options.model,
    p_lease_seconds: options.leaseSeconds ?? 120,
    p_allow_new_claim: options.allowNewClaim ?? true,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const verdictId = stringField(row, "verdict_id") ?? stringField(row, "id");
  const rawStatus = stringField(row, "claim_status");
  const claimStatus = rawStatus === "execute" || rawStatus === "staged"
    || rawStatus === "replay" || rawStatus === "in_progress" || rawStatus === "unavailable"
    ? rawStatus
    : null;
  const generationVersion = integerField(row, "generation_version");
  const leaseToken = stringField(row, "lease_token");
  const leaseExpiresAt = stringField(row, "lease_expires_at");
  const result = asRow(row?.result_json);
  const missions = Array.isArray(row?.missions_json)
    ? row.missions_json.map(asRow).filter((item): item is UnknownRow => item !== null)
    : [];
  const model = stringField(row, "model");
  const auditModel = stringField(row, "audit_model");
  const auditUserId = stringField(row, "audit_user_id");
  const auditCoupleId = stringField(row, "audit_couple_id");
  const rawAuditSafetyLevel = stringField(row, "audit_preflight_safety_level");
  const auditPreflightSafetyLevel = rawAuditSafetyLevel === "normal"
    || rawAuditSafetyLevel === "sensitive"
    ? rawAuditSafetyLevel
    : null;
  const rawProviderAuditState = stringField(row, "provider_audit_state");
  const providerAuditState = rawProviderAuditState === "pending"
    || rawProviderAuditState === "audited"
    ? rawProviderAuditState
    : null;
  const providerRequestKey = stringField(row, "request_key");
  const stagedInputHash = stringField(row, "input_hash");
  const stagedPromptVersion = stringField(row, "prompt_version");
  const stagedSchemaVersion = stringField(row, "schema_version");
  const stagedAt = stringField(row, "staged_at");
  const usage = providerUsage(row?.usage);
  const unavailableIdentityIsValid = claimStatus === "unavailable"
    && (
      (verdictId === null && generationVersion === null)
      || (verdictId !== null && generationVersion !== null && generationVersion >= 1)
    )
    && leaseToken === null
    && leaseExpiresAt === null
    && result === null
    && row?.result_json == null
    && missions.length === 0
    && row?.missions_json == null
    && model === null
    && auditModel === null
    && auditUserId === null
    && auditCoupleId === null
    && auditPreflightSafetyLevel === null
    && providerAuditState === null
    && providerRequestKey === null
    && stagedInputHash === null
    && stagedPromptVersion === null
    && stagedSchemaVersion === null
    && stagedAt === null
    && usage === null;
  const durableClaimIdentityIsValid = claimStatus !== null
    && claimStatus !== "unavailable"
    && verdictId !== null
    && generationVersion !== null
    && generationVersion >= 1;
  if (
    !claimStatus
    || (!unavailableIdentityIsValid && !durableClaimIdentityIsValid)
    || ((claimStatus === "execute" || claimStatus === "staged") && !leaseToken)
    || (claimStatus === "staged" && (
      !leaseExpiresAt
      || !result
      || missions.length !== (Array.isArray(row?.missions_json) ? row.missions_json.length : -1)
      || !model
      || !auditModel
      || !/^[A-Za-z0-9._:/-]{1,128}$/.test(auditModel)
      || !auditPreflightSafetyLevel
      || !providerAuditState
      || !providerRequestKey
      || !/^[a-f0-9]{64}$/.test(providerRequestKey)
      || !stagedInputHash
      || !/^[a-f0-9]{64}$/.test(stagedInputHash)
      || !stagedPromptVersion
      || !/^[A-Za-z0-9._-]{1,64}$/.test(stagedPromptVersion)
      || !stagedSchemaVersion
      || !/^[A-Za-z0-9._-]{1,64}$/.test(stagedSchemaVersion)
      || !stagedAt
      || !usage
    ))
  ) {
    repositoryError({ code: "invalid_rpc_result" });
  }
  return {
    verdictId,
    claimStatus,
    leaseToken,
    generationVersion,
    leaseExpiresAt,
    result,
    missions,
    model,
    auditModel,
    auditUserId,
    auditCoupleId,
    auditPreflightSafetyLevel,
    providerAuditState,
    providerRequestKey,
    inputHash: stagedInputHash,
    promptVersion: stagedPromptVersion,
    schemaVersion: stagedSchemaVersion,
    stagedAt,
    usage,
  };
}

export async function reserveCourtVerdictProviderCallForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  inputHash: string;
  requestKey: string;
  requestHash: string;
  auditPreflightSafetyLevel: "normal" | "sensitive";
  coupleDailyCap?: number;
  globalDailyCap?: number;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_court_verdict_provider_call", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_request_key: options.requestKey,
    p_request_hash: options.requestHash,
    p_audit_preflight_safety_level: options.auditPreflightSafetyLevel,
    p_couple_daily_cap: options.coupleDailyCap ?? 30,
    p_global_daily_cap: options.globalDailyCap ?? 60,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function markCourtVerdictProviderStartedForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  inputHash: string;
  requestKey: string;
  requestHash: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("mark_court_verdict_provider_started", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_request_key: options.requestKey,
    p_request_hash: options.requestHash,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function stageCourtVerdictProviderResultForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  inputHash: string;
  result: UnknownRow;
  missions: UnknownRow[];
  model: string;
  auditModel: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_write_input_tokens: number;
    cached_input_tokens: number;
  };
}): Promise<CourtProviderSettlementResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("stage_court_verdict_provider_result", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_result_json: options.result,
    p_missions_json: options.missions,
    p_model: options.model,
    p_audit_model: options.auditModel,
    p_input_tokens: options.usage?.input_tokens ?? null,
    p_output_tokens: options.usage?.output_tokens ?? null,
    p_cache_write_input_tokens: options.usage?.cache_write_input_tokens ?? null,
    p_cached_input_tokens: options.usage?.cached_input_tokens ?? null,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const auditState = providerAuditState(row?.provider_audit_state);
  if (
    !row
    || row.verdict_id !== options.verdictId
    || row.provider_state !== "result_staged"
    || !auditState
  ) invalidProviderRpcResult();
  return {
    ...row,
    verdict_id: options.verdictId,
    provider_state: "result_staged",
    provider_audit_state: auditState,
    // A successful staging row can exist only while its parent case graph is
    // locked and live. The forward deletion wrapper starts at settlement.
    subject_deleted: false,
  };
}

/**
 * Persists only the billable response's audit envelope when the validated
 * private payload could not be staged. The SQL fence terminalizes the verdict
 * and blocks another paid call until audit recovery and admin reconciliation.
 */
export async function settleCourtUnstagedProviderResult(options: {
  verdictId: string;
  leaseToken: string;
  inputHash: string;
  requestKey: string;
  auditModel: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_write_input_tokens: number;
    cached_input_tokens: number;
  };
}): Promise<CourtProviderSettlementResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("settle_court_unstaged_provider_result", {
    p_verdict_id: options.verdictId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_request_key: options.requestKey,
    p_audit_model: options.auditModel,
    p_input_tokens: options.usage?.input_tokens ?? null,
    p_output_tokens: options.usage?.output_tokens ?? null,
    p_cached_input_tokens: options.usage?.cached_input_tokens ?? null,
    p_cache_write_input_tokens: options.usage?.cache_write_input_tokens ?? null,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const auditState = providerAuditState(row?.provider_audit_state);
  const providerState = row?.provider_state;
  const errorCode = row?.provider_error_code;
  const subjectDeleted = row?.subject_deleted;
  if (
    !row
    || row.verdict_id !== options.verdictId
    || (providerState !== "result_staged" && providerState !== "failed_invalid")
    || !auditState
    || typeof subjectDeleted !== "boolean"
    || (providerState === "failed_invalid" && ![
      "provider_result_unstaged",
      "safety_high_risk",
      "safety_level_changed",
      "court_archived",
    ].includes(typeof errorCode === "string" ? errorCode : ""))
  ) invalidProviderRpcResult();
  return {
    ...row,
    verdict_id: options.verdictId,
    provider_state: providerState,
    provider_audit_state: auditState,
    subject_deleted: subjectDeleted,
  };
}

/**
 * Stores only the safe provider/audit envelope for a model-discovered
 * high-risk result. Private generated prose and missions never cross this RPC.
 */
export async function settleCourtHighRiskProviderResultForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  inputHash: string;
  requestKey: string;
  categories: string[];
  auditModel: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_write_input_tokens: number;
    cached_input_tokens: number;
  };
}): Promise<CourtHighRiskProviderSettlementResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("settle_court_high_risk_provider_result", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_request_key: options.requestKey,
    p_categories: options.categories,
    p_audit_model: options.auditModel,
    p_input_tokens: options.usage?.input_tokens ?? null,
    p_output_tokens: options.usage?.output_tokens ?? null,
    p_cached_input_tokens: options.usage?.cached_input_tokens ?? null,
    p_cache_write_input_tokens: options.usage?.cache_write_input_tokens ?? null,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const auditState = providerAuditState(row?.provider_audit_state);
  const categories = Array.isArray(row?.safety_categories)
    && row.safety_categories.every((category) => typeof category === "string")
    ? row.safety_categories as string[]
    : null;
  const subjectDeleted = row?.subject_deleted;
  if (
    !row
    || row.verdict_id !== options.verdictId
    || row.request_key !== options.requestKey
    || row.provider_state !== "failed_invalid"
    || !auditState
    || typeof subjectDeleted !== "boolean"
    || row.safety_level !== "high_risk"
    || !categories
    || !options.categories.every((category) => categories.includes(category))
  ) invalidProviderRpcResult();
  return {
    ...row,
    verdict_id: options.verdictId,
    request_key: options.requestKey,
    provider_state: "failed_invalid",
    provider_audit_state: auditState,
    safety_level: "high_risk",
    safety_categories: categories,
    subject_deleted: subjectDeleted,
  };
}

/**
 * Advances the provider audit fence only when the database can prove that an
 * exact, payload-free successful AI audit row already exists.
 */
export async function finalizeCourtProviderAudit(options: {
  verdictId: string;
  requestKey: string;
}): Promise<CourtProviderAuditFinalizationResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("finalize_court_provider_audit", {
    p_verdict_id: options.verdictId,
    p_request_key: options.requestKey,
  });
  if (error) repositoryError(error);
  const row = firstRow(data);
  const providerState = row?.provider_state;
  const subjectDeleted = row?.subject_deleted;
  if (
    !row
    || row.verdict_id !== options.verdictId
    || (providerState !== "result_staged" && providerState !== "failed_invalid")
    || row.provider_audit_state !== "audited"
    || typeof subjectDeleted !== "boolean"
  ) invalidProviderRpcResult();
  return {
    ...row,
    verdict_id: options.verdictId,
    provider_state: providerState,
    provider_audit_state: "audited",
    subject_deleted: subjectDeleted,
  };
}

export async function completeCourtVerdictForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  inputHash: string;
  result: UnknownRow;
  missions: UnknownRow[];
  model: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("complete_court_verdict", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_input_hash: options.inputHash,
    p_result_json: options.result,
    p_missions_json: options.missions,
    p_model: options.model,
  });
  if (error) repositoryError(error);
}

export async function failCourtVerdictForUser(options: {
  verdictId: string;
  userId: string;
  leaseToken: string;
  errorCode: string;
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fail_court_verdict", {
    p_verdict_id: options.verdictId,
    p_user_id: options.userId,
    p_lease_token: options.leaseToken,
    p_error_code: options.errorCode.replace(/[^a-z0-9_.-]/gi, "_").slice(0, 64),
  });
  if (error) repositoryError(error);
  if (typeof data !== "boolean") repositoryError({ code: "invalid_rpc_result" });
  return data;
}

export async function archiveCourtCaseForUser(caseId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("archive_court_case", {
    p_case_id: caseId,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
}

export async function deleteCourtCaseForUser(caseId: string, userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("delete_court_case", {
    p_case_id: caseId,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
}

export async function getCourtUserContext(userId: string): Promise<{ coupleId: string | null }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("couple_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) repositoryError(error);
  return { coupleId: typeof data?.couple_id === "string" ? data.couple_id : null };
}

/**
 * Supplies participant names and venue/vendor candidates to the publication
 * privacy gate. These server-only exact denylist values never leave the API.
 */
export async function getCourtParticipantNamesForPrivacy(
  caseId: string,
  userId: string,
): Promise<string[]> {
  const admin = createAdminClient();
  await participantForUser(admin, caseId, userId);
  const { data: participants, error: participantsError } = await admin
    .from("court_participants")
    .select("user_id")
    .eq("case_id", caseId)
    .eq("participation_status", "active");
  if (participantsError) repositoryError(participantsError);
  const userIds = ((participants ?? []) as UnknownRow[])
    .map((row) => stringField(row, "user_id"))
    .filter((value): value is string => Boolean(value));
  let profileNames: string[] = [];
  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("name")
      .in("id", userIds);
    if (profilesError) repositoryError(profilesError);
    profileNames = ((profiles ?? []) as UnknownRow[])
      .map((row) => stringField(row, "name")?.trim() ?? "")
      .filter((name) => name.length >= 2 && name.length <= 50);
  }

  const { data: statements, error: statementsError } = await admin
    .from("court_statements")
    .select("facts,feelings,expectations,attempts,desired_agreement")
    .eq("case_id", caseId);
  if (statementsError) repositoryError(statementsError);
  const statementEntities = ((statements ?? []) as UnknownRow[]).flatMap((row) => (
    ["facts", "feelings", "expectations", "attempts", "desired_agreement"]
      .flatMap((key) => {
        const value = stringField(row, key);
        return value ? extractCourtKnownEntities(value) : [];
      })
  ));
  return [...new Set([...profileNames, ...statementEntities])];
}

export async function getCourtMissionForUser(
  missionId: string,
  userId: string,
): Promise<{ mission: UnknownRow; case: UnknownRow; participant: UnknownRow }> {
  const admin = createAdminClient();
  const { data: missionData, error: missionError } = await admin
    .from("court_missions")
    .select(`${MISSION_FIELDS},court_verdicts!inner(case_id)`)
    .eq("id", missionId)
    .maybeSingle();
  if (missionError) repositoryError(missionError);
  const mission = asRow(missionData);
  const verdictRelation = asRow(mission?.court_verdicts);
  const caseId = stringField(verdictRelation, "case_id");
  if (!mission || !caseId) {
    throw new CourtApiError(404, "COURT_MISSION_NOT_FOUND", "화해 처방을 찾을 수 없어요.");
  }
  const participant = await participantForUser(admin, caseId, userId);
  const targetRole = stringField(mission, "owner_role");
  const role = stringField(participant, "role");
  if (targetRole && targetRole !== "both" && targetRole !== role) {
    throw new CourtApiError(403, "COURT_MISSION_NOT_ASSIGNED", "내게 배정된 화해 처방이 아니에요.");
  }
  const { data: caseData, error: caseError } = await admin
    .from("court_cases")
    .select(CASE_FIELDS)
    .eq("id", caseId)
    .maybeSingle();
  if (caseError) repositoryError(caseError);
  const courtCase = asRow(caseData);
  if (!courtCase) {
    throw new CourtApiError(404, "COURT_NOT_FOUND", "사건을 찾을 수 없어요.");
  }
  return { mission, case: courtCase, participant };
}

export async function setCourtMissionStatusForUser(options: {
  missionId: string;
  userId: string;
  status: "accepted" | "completed";
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_court_mission_status", {
    p_mission_id: options.missionId,
    p_user_id: options.userId,
    p_status: options.status,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? { status: options.status };
}

export async function createCourtFollowupForUser(options: {
  caseId: string;
  userId: string;
  satisfaction: number;
  remainingIssue: string;
  note: string | null;
  safetyLevel: "normal" | "sensitive" | "high_risk";
  safetyCategories: string[];
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_court_followup", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
    p_satisfaction: options.satisfaction,
    p_remaining_issue: options.remainingIssue,
    p_note: options.note,
    p_safety_level: options.safetyLevel,
    p_safety_categories: options.safetyCategories.slice(0, 12),
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function linkCourtMissionAction(options: {
  missionId: string;
  userId: string;
  actionId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("link_court_mission_action", {
    p_mission_id: options.missionId,
    p_user_id: options.userId,
    p_action_id: options.actionId,
  });
  if (error) repositoryError(error);
}

export async function createOrLinkCourtMissionActionForUser(options: {
  missionId: string;
  userId: string;
  confirmShared: boolean;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_or_link_court_mission_action", {
    p_mission_id: options.missionId,
    p_user_id: options.userId,
    p_confirm_shared: options.confirmShared,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function prepareCourtPublicSnapshotForUser(options: {
  caseId: string;
  userId: string;
  snapshot: UnknownRow;
  snapshotHash: string;
  snapshotVersion: number;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("prepare_court_public_snapshot", {
    p_case_id: options.caseId,
    p_user_id: options.userId,
    p_snapshot_json: options.snapshot,
    p_snapshot_hash: options.snapshotHash,
    p_snapshot_version: options.snapshotVersion,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function setCourtPublicConsentForUser(options: {
  publicPostId: string;
  userId: string;
  snapshotHash: string;
  consented: boolean;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("set_court_public_consent", {
    p_public_post_id: options.publicPostId,
    p_user_id: options.userId,
    p_snapshot_hash: options.snapshotHash,
    p_consented: options.consented,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function publishCourtPublicPostForUser(
  publicPostId: string,
  userId: string,
): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("publish_court_public_post", {
    p_public_post_id: publicPostId,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function withdrawCourtPublicPostForUser(
  publicPostId: string,
  userId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.rpc("withdraw_court_public_post", {
    p_public_post_id: publicPostId,
    p_user_id: userId,
  });
  if (error) repositoryError(error);
}

export async function listCourtPublicFeed(options: {
  limit: number;
  offset: number;
  category?: string | null;
  mode?: "solo" | "couple" | null;
  sort: "latest" | "popular";
}): Promise<{ posts: UnknownRow[]; total: number }> {
  const admin = createAdminClient();
  let query = admin
    .from("court_public_feed")
    .select(
      "id,sanitized_snapshot_json,snapshot_hash,snapshot_version,category,mode,tone,comments_enabled,vote_count,vote_counts,comment_count,published_at,updated_at",
      { count: "exact" },
    );
  if (options.category) query = query.eq("category", options.category);
  if (options.mode) query = query.eq("mode", options.mode);
  if (options.sort === "popular") {
    query = query.order("vote_count", { ascending: false });
  }
  query = query
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .range(options.offset, options.offset + options.limit - 1);
  const { data, error, count } = await query;
  if (error) repositoryError(error);
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    repositoryError({ code: "invalid_public_feed_count" });
  }
  return { posts: (data ?? []) as UnknownRow[], total: count };
}

export async function getCourtPublicPost(publicPostId: string): Promise<UnknownRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("court_public_feed")
    .select("id,sanitized_snapshot_json,snapshot_hash,snapshot_version,category,mode,tone,comments_enabled,vote_count,vote_counts,comment_count,published_at,updated_at")
    .eq("id", publicPostId)
    .maybeSingle();
  if (error) repositoryError(error);
  return asRow(data);
}

export async function castCourtPublicVoteForUser(options: {
  publicPostId: string;
  userId: string;
  choice: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("cast_court_public_vote", {
    p_public_post_id: options.publicPostId,
    p_user_id: options.userId,
    p_option: options.choice,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function listCourtPublicComments(
  publicPostId: string,
  limit: number,
  before: CourtKeysetCursor | null = null,
): Promise<CourtKeysetPage<UnknownRow>> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("list_court_public_comments", {
    p_public_post_id: publicPostId,
    p_before_visible_at: before?.at ?? null,
    p_before_id: before?.id ?? null,
    p_limit: limit,
  });
  if (error) repositoryError(error);
  const rows = (data ?? []) as unknown as UnknownRow[];
  const descendingRows = rows.slice(0, limit);
  const last = descendingRows.at(-1) ?? null;
  const nextCursor = rows.length > limit
    ? { at: stringField(last, "visible_at"), id: stringField(last, "id") }
    : null;
  if (nextCursor && (!nextCursor.at || !nextCursor.id)) {
    repositoryError({ code: "invalid_court_comment_page" });
  }
  return {
    items: descendingRows.reverse(),
    nextCursor: nextCursor as CourtKeysetCursor | null,
  };
}

export async function createCourtPublicCommentForUser(options: {
  publicPostId: string;
  userId: string;
  submissionRequestId: string;
  commentType: string;
  body: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("create_court_public_comment", {
    p_public_post_id: options.publicPostId,
    p_user_id: options.userId,
    p_submission_request_id: options.submissionRequestId,
    p_comment_type: options.commentType,
    p_body: options.body,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function replayCourtPublicCommentForUser(options: {
  publicPostId: string;
  userId: string;
  submissionRequestId: string;
  commentType: string;
  body: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("replay_court_public_comment", {
    p_public_post_id: options.publicPostId,
    p_user_id: options.userId,
    p_submission_request_id: options.submissionRequestId,
    p_comment_type: options.commentType,
    p_body: options.body,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}

export async function createCourtPublicReportForUser(options: {
  publicPostId: string;
  commentId: string | null;
  userId: string;
  targetType: "post" | "comment";
  reasonCode: string;
}): Promise<UnknownRow> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("report_court_public_content", {
    p_public_post_id: options.publicPostId,
    p_comment_id: options.commentId,
    p_user_id: options.userId,
    p_reason_code: options.reasonCode,
  });
  if (error) repositoryError(error);
  return firstRow(data) ?? {};
}
