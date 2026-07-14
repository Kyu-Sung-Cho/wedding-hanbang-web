import type {
  CourtCase,
  CourtCaseStatus,
  CourtInvite,
  CourtMode,
  CourtTone,
  CourtVerdict,
  CourtVerdictHistoryItem,
  CreateCaseInput,
  FactStatus,
  InviteAcceptResult,
  PublicCourtCase,
  PublicCourtComment,
  PublicReportReason,
  PublicSnapshotPreview,
  PublicVoteChoice,
  StatementInput,
  VerdictFact,
  VerdictMission,
} from "./types";
import { weddingPath } from "@/lib/weddingPaths";

type JsonRecord = Record<string, unknown>;

export class CourtApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CourtApiError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function numberValue(...values: unknown[]): number | undefined {
  const value = values.find((item) => typeof item === "number" && Number.isFinite(item));
  return typeof value === "number" ? value : undefined;
}

function booleanValue(fallback: boolean, ...values: unknown[]): boolean {
  const value = values.find((item) => typeof item === "boolean");
  return typeof value === "boolean" ? value : fallback;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unwrap(payload: unknown, keys: string[]): unknown {
  let current = payload;
  for (let depth = 0; depth < 2; depth += 1) {
    const currentRecord = record(current);
    const key = keys.find((candidate) => currentRecord[candidate] !== undefined);
    if (!key) return current;
    current = currentRecord[key];
  }
  return current;
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const body = record(payload);
    throw new CourtApiError(
      stringValue(body.error, body.message, record(body.safety).message) ?? "요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.",
      response.status,
      stringValue(body.code, body.status)?.toLowerCase(),
      numberValue(body.retry_after_seconds)
        ?? (() => {
          const seconds = Number(response.headers.get("retry-after"));
          return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
        })(),
    );
  }
  return payload;
}

function normalizeMode(value: unknown): CourtMode {
  return value === "couple" ? "couple" : "solo";
}

function normalizeTone(value: unknown): CourtTone {
  if (value === "practical" || value === "spicy") return value;
  return "gentle";
}

function normalizeStatus(value: unknown): CourtCaseStatus {
  const known: CourtCaseStatus[] = [
    "draft", "awaiting_applicant_statement", "awaiting_partner", "awaiting_partner_statement",
    "statements_complete", "judging", "verdict_ready", "mission_active", "resolved",
    "archived",
  ];
  return known.includes(value as CourtCaseStatus) ? value as CourtCaseStatus : "draft";
}

export function normalizeCase(value: unknown): CourtCase {
  const container = record(value);
  const item = record(container.case ?? value);
  const participant = record(container.participant);
  const publicPost = record(container.publicPost ?? container.public_post);
  const existingSnapshot = record(publicPost.sanitizedSnapshot ?? publicPost.sanitized_snapshot_json);
  const existingPublicPostId = stringValue(publicPost.id);
  const existingSnapshotHash = stringValue(publicPost.snapshotHash, publicPost.snapshot_hash);
  const existingSnapshotVersion = numberValue(publicPost.snapshotVersion, publicPost.snapshot_version);
  const existingSafeTitle = stringValue(existingSnapshot.safeTitle, existingSnapshot.safe_title);
  const existingOneLine = stringValue(existingSnapshot.oneLine, existingSnapshot.one_line);
  const existingResultLabel = stringValue(existingSnapshot.resultLabel, existingSnapshot.result_label);
  const participants = arrayValue(container.participants).map(record);
  const statements = arrayValue(container.statements).map(record);
  // The server returns only the viewer's latest statement and intentionally
  // strips participant/case UUIDs. Keep backwards compatibility with older
  // payloads while preferring the first (and only) statement in the safe view.
  const participantId = stringValue(participant.id);
  const ownStatementRow = (participantId
    ? statements.find((statement) => stringValue(statement.participant_id, statement.participantId) === participantId)
    : undefined) ?? statements[0];
  const status = normalizeStatus(item.workflow_status ?? item.workflowStatus ?? item.status);
  const mode = normalizeMode(item.mode);
  const safetyLevel = item.safetyLevel === "high_risk" || item.safety_level === "high_risk"
    ? "high_risk" as const
    : item.safetyLevel === "sensitive" || item.safety_level === "sensitive" ? "sensitive" as const : "normal" as const;
  const viewerRole = stringValue(participant.role, item.my_role, item.myRole) === "partner" ? "partner" : "applicant";
  const applicantParticipantIds = new Set(participants.filter((row) => row.role === "applicant").map((row) => stringValue(row.id)).filter(Boolean));
  const partnerParticipantIds = new Set(participants.filter((row) => row.role === "partner").map((row) => stringValue(row.id)).filter(Boolean));
  const applicantStatementFromRows = statements.some((statement) => applicantParticipantIds.has(stringValue(statement.participant_id, statement.participantId)) && Boolean(stringValue(statement.submitted_at, statement.submittedAt)));
  const partnerStatementFromRows = statements.some((statement) => partnerParticipantIds.has(stringValue(statement.participant_id, statement.participantId)) && Boolean(stringValue(statement.submitted_at, statement.submittedAt)));
  const applicantSubmitted = booleanValue(
    applicantStatementFromRows || !["draft", "awaiting_applicant_statement"].includes(status),
    item.applicantStatementSubmitted,
    item.applicant_statement_submitted,
  );
  const partnerSubmitted = booleanValue(
    partnerStatementFromRows || ["statements_complete", "judging", "verdict_ready", "mission_active", "resolved"].includes(status),
    item.partnerStatementSubmitted,
    item.partner_statement_submitted,
    item.respondentStatementSubmitted,
  );
  return {
    id: stringValue(item.id, item.caseId, item.case_id) ?? "",
    caseNumber: stringValue(item.caseNumber, item.case_number),
    title: stringValue(item.title) ?? "제목 없는 사건",
    category: stringValue(item.category) ?? "기타 결혼 준비 갈등",
    mode,
    tone: normalizeTone(item.judgeTone ?? item.judge_tone ?? item.tone),
    status,
    neutralSummary: stringValue(item.neutralSummary, item.neutral_summary, item.summary),
    createdAt: stringValue(item.createdAt, item.created_at),
    updatedAt: stringValue(item.updatedAt, item.updated_at),
    viewerRole,
    applicantStatementSubmitted: applicantSubmitted,
    partnerJoined: booleanValue(partnerSubmitted || status === "awaiting_partner_statement" || participants.some((row) => row.role === "partner" && (row.participation_status === "active" || row.status === "active")), item.partnerJoined, item.partner_joined),
    partnerStatementSubmitted: partnerSubmitted,
    canJudge: safetyLevel !== "high_risk" && booleanValue(status === "statements_complete", item.canJudge, item.can_judge),
    verdictReady: booleanValue(["verdict_ready", "mission_active", "resolved"].includes(status), item.verdictReady, item.verdict_ready),
    safetyLevel,
    inviteExpiresAt: stringValue(record(container.invite).expiresAt, record(container.invite).expires_at, item.inviteExpiresAt, item.invite_expires_at),
    inviteRejectedAt: stringValue(record(container.invite).rejectedAt, record(container.invite).rejected_at, item.inviteRejectedAt, item.invite_rejected_at),
    followupSubmitted: Boolean(stringValue(record(container.followup).createdAt, record(container.followup).created_at)),
    publicPostId: stringValue(publicPost.id),
    publicStatus: stringValue(publicPost.status),
    publicSnapshotVersion: numberValue(publicPost.snapshotVersion, publicPost.snapshot_version),
    publicPreview: existingPublicPostId && existingSnapshotHash && existingSnapshotVersion !== undefined && existingSafeTitle && existingOneLine && existingResultLabel
      ? {
          publicPostId: existingPublicPostId,
          snapshotHash: existingSnapshotHash,
          snapshotVersion: existingSnapshotVersion,
          snapshot: {
            safeTitle: existingSafeTitle,
            oneLine: existingOneLine,
            resultLabel: existingResultLabel,
            hashtags: arrayValue(existingSnapshot.hashtags).filter((tag): tag is string => typeof tag === "string"),
            provisional: booleanValue(false, existingSnapshot.provisional),
          },
        }
      : undefined,
    ownStatement: ownStatementRow
      ? {
          facts: stringValue(ownStatementRow.facts) ?? "",
          feelings: stringValue(ownStatementRow.feelings) ?? "",
          expectations: stringValue(ownStatementRow.expectations) ?? "",
          attempts: stringValue(ownStatementRow.attempts) ?? "",
          desiredAgreement: stringValue(ownStatementRow.desiredAgreement, ownStatementRow.desired_agreement) ?? "",
        }
      : undefined,
  };
}

function normalizeFact(value: unknown): VerdictFact | null {
  const item = record(value);
  const fact = stringValue(item.fact, item.text, item.label);
  if (!fact) return null;
  const rawStatus = item.status;
  const status: FactStatus = rawStatus === "agreed" || rawStatus === "applicant_claim"
    || rawStatus === "respondent_claim" || rawStatus === "disputed" ? rawStatus : "disputed";
  return { fact, status };
}

function normalizeMission(value: unknown): VerdictMission | null {
  const item = record(value);
  const title = stringValue(item.title);
  const description = stringValue(item.description, item.action);
  const viewerStatus = stringValue(
    item.viewerCompletionStatus,
    item.viewer_completion_status,
  );
  if (!title || !description) return null;
  return {
    id: stringValue(item.id, item.missionId, item.mission_id) ?? "",
    title,
    description,
    ownerRole: stringValue(item.ownerRole, item.owner_role, item.owner, item.target_role),
    dueAt: stringValue(item.dueAt, item.due_at),
    dueInMinutes: numberValue(item.dueInMinutes, item.due_in_minutes),
    completionCheck: stringValue(item.completionCheck, item.completion_check),
    saved: Boolean(stringValue(item.amoraActionId, item.amora_action_id))
      || booleanValue(false, item.saved, item.action_saved),
    viewerStatus: viewerStatus === "completed"
      ? "completed"
      : viewerStatus === "accepted" ? "accepted" : undefined,
  };
}

export function normalizeVerdict(payload: unknown): CourtVerdict {
  const root = record(payload);
  const container = record(root.verdict ?? root.data ?? payload);
  const raw = record(container.verdictJson ?? container.verdict_json ?? container.resultJson ?? container.result_json ?? container.result ?? container);
  const safety = record(raw.safety);
  const caseMeta = record(raw.caseMeta ?? raw.case_meta);
  const verdictBlock = record(raw.verdict);
  const conversation = record(raw.conversationScript ?? raw.conversation_script);
  const publicCard = record(raw.publicCard ?? raw.public_card);
  const responsibility = record(raw.responsibility ?? raw.responsibilityPoints ?? raw.responsibility_points);
  const applicantPoints = numberValue(responsibility.applicant, responsibility.applicantPoints, responsibility.applicant_points);
  const respondentPoints = numberValue(responsibility.respondent, responsibility.respondentPoints, responsibility.respondent_points);
  const sharedPoints = numberValue(responsibility.shared);
  const sharedFacts = arrayValue(raw.sharedFacts ?? raw.shared_facts).filter((item): item is string => typeof item === "string");
  const differentViews = arrayValue(raw.differentViews ?? raw.different_views).map(record);
  const missionRows = arrayValue(root.missions ?? container.missions ?? raw.missions);
  const limitationValues = arrayValue(raw.limitations).filter((item): item is string => typeof item === "string");
  const scripts = [stringValue(conversation.opening), stringValue(conversation.applicantLine, conversation.applicant_line), stringValue(conversation.respondentLine, conversation.respondent_line)].filter((item): item is string => Boolean(item));
  return {
    id: stringValue(container.id, raw.id),
    caseId: stringValue(container.caseId, container.case_id, raw.caseId, raw.case_id),
    provisional: booleanValue(false, caseMeta.provisional, raw.provisional, container.provisional),
    safetyLevel: safety.level === "high_risk" || raw.safetyLevel === "high_risk" || raw.safety_level === "high_risk"
      ? "high_risk"
      : safety.level === "sensitive" || raw.safetyLevel === "sensitive" || raw.safety_level === "sensitive" ? "sensitive" : "normal",
    confidence: raw.confidence === "low" || raw.confidence === "medium" || raw.confidence === "high"
      ? raw.confidence
      : undefined,
    verdictOneLine: stringValue(verdictBlock.headline, raw.verdictOneLine, raw.verdict_one_line, raw.oneLine, raw.one_line) ?? "판결 내용을 확인하지 못했어요.",
    summary: stringValue(raw.caseSummary, raw.case_summary, raw.summary, raw.courtSummary, raw.court_summary) ?? "요약 정보가 제공되지 않았어요.",
    facts: [
      ...sharedFacts.map((fact) => ({ fact, status: "agreed" as const })),
      ...differentViews.map((view) => ({ fact: `신청인: ${stringValue(view.applicant) ?? "확인되지 않음"} / 상대방: ${stringValue(view.respondent) ?? "진술 없음"}`, status: "disputed" as const })),
      ...arrayValue(raw.facts ?? raw.factStatus ?? raw.fact_status).map(normalizeFact).filter((item): item is VerdictFact => item !== null),
    ],
    applicantPerspective: stringValue(raw.applicantNeeds, raw.applicant_needs, raw.applicantPerspective, raw.applicant_perspective) ?? "신청인 관점이 제공되지 않았어요.",
    respondentPerspective: stringValue(raw.partnerNeeds, raw.partner_needs, raw.respondentPerspective, raw.respondent_perspective),
    coreIssues: [stringValue(raw.coreConflict, raw.core_conflict), ...arrayValue(raw.coreIssues ?? raw.core_issues).map((item) => typeof item === "string" ? item : stringValue(record(item).title, record(item).text))].filter((item): item is string => Boolean(item)),
    responsibility: applicantPoints !== undefined && respondentPoints !== undefined
      ? { applicant: applicantPoints, respondent: respondentPoints, shared: sharedPoints, explanation: stringValue(responsibility.explanation) }
      : undefined,
    judgeOneLiner: stringValue(verdictBlock.judgeOneLiner, verdictBlock.judge_one_liner, raw.judgeOneLiner, raw.judge_one_liner),
    recommendedConversation: stringValue(conversation.opening, raw.recommendedConversation, raw.recommended_conversation),
    repairScripts: scripts.length > 0 ? scripts : arrayValue(raw.repairScripts ?? raw.repair_scripts).map((item) => typeof item === "string" ? item : "").filter(Boolean),
    missions: missionRows.map(normalizeMission).filter((item): item is VerdictMission => item !== null),
    followupQuestion: stringValue(record(raw.checkIn ?? raw.check_in).question, raw.followupQuestion, raw.followup_question),
    limitations: limitationValues.length > 0 ? limitationValues.join(" ") : stringValue(raw.limitations),
    createdAt: stringValue(container.createdAt, container.created_at, raw.createdAt, raw.created_at),
    publicCard: stringValue(publicCard.safeTitle, publicCard.safe_title)
      && stringValue(publicCard.oneLine, publicCard.one_line)
      && stringValue(publicCard.resultLabel, publicCard.result_label)
      ? {
          safeTitle: stringValue(publicCard.safeTitle, publicCard.safe_title)!,
          oneLine: stringValue(publicCard.oneLine, publicCard.one_line)!,
          resultLabel: stringValue(publicCard.resultLabel, publicCard.result_label)!,
          hashtags: arrayValue(publicCard.hashtags).filter((item): item is string => typeof item === "string").slice(0, 6),
        }
      : undefined,
  };
}

export function normalizePublicCase(value: unknown): PublicCourtCase {
  const item = record(value);
  const snapshot = record(item.sanitizedSnapshot ?? item.sanitized_snapshot_json ?? item.snapshot ?? item);
  const votes = record(item.votes ?? snapshot.votes);
  const voteCounts = record(item.voteCounts ?? item.vote_counts ?? votes.counts);
  const total = numberValue(votes.total, item.voteCount, item.vote_count) ?? 0;
  return {
    id: stringValue(item.id, item.publicPostId, item.public_post_id) ?? "",
    title: stringValue(snapshot.safeTitle, snapshot.safe_title, snapshot.title, item.title) ?? "제목 없는 공개 사건",
    summary: stringValue(snapshot.oneLine, snapshot.one_line, snapshot.summary, item.summary) ?? "공개된 요약이 없어요.",
    category: stringValue(snapshot.category, item.category) ?? "기타 결혼 준비 갈등",
    mode: normalizeMode(snapshot.mode ?? item.mode),
    nickname: stringValue(snapshot.nickname, item.nickname),
    verdictOneLine: stringValue(snapshot.resultLabel, snapshot.result_label, snapshot.verdictOneLine, snapshot.verdict_one_line, item.verdictOneLine),
    createdAt: stringValue(item.publishedAt, item.published_at, item.createdAt, item.created_at),
    votes: {
      total,
      viewerChoice: stringValue(votes.viewerChoice, votes.viewer_choice) as PublicVoteChoice | undefined,
      counts: {
        applicant_more_at_fault: numberValue(voteCounts.applicant_more_at_fault) ?? 0,
        partner_more_at_fault: numberValue(voteCounts.partner_more_at_fault) ?? 0,
        both_need_change: numberValue(voteCounts.both_need_change) ?? 0,
        need_more_info: numberValue(voteCounts.need_more_info) ?? 0,
      },
    },
    commentsCount: numberValue(item.commentsCount, item.comments_count) ?? 0,
    commentsEnabled: booleanValue(false, item.commentsEnabled, item.comments_enabled),
    safetyLevel: snapshot.safetyLevel === "high_risk" || snapshot.safety_level === "high_risk" ? "high_risk" : snapshot.safetyLevel === "sensitive" || snapshot.safety_level === "sensitive" ? "sensitive" : "normal",
    // Public rendering intentionally accepts only the sanitized snapshot contract.
    // Private facts, perspectives, scripts, and missions are never projected here.
    facts: [],
    coreIssues: [],
    repairScripts: [],
    missions: [],
  };
}

export async function listCases(): Promise<CourtCase[]> {
  const payload = await requestJson("/api/couple-court/cases");
  const unwrapped = unwrap(payload, ["cases", "data"]);
  return arrayValue(unwrapped).map(normalizeCase).filter((item) => Boolean(item.id));
}

export async function getCase(caseId: string): Promise<CourtCase> {
  return normalizeCase(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}`));
}

export async function archiveCase(caseId: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}`, {
    method: "DELETE",
    body: JSON.stringify({ action: "archive" }),
  });
}

export async function deleteCase(caseId: string, confirmation: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}`, {
    method: "DELETE",
    body: JSON.stringify({ action: "delete", confirmation }),
  });
}

export async function createCase(input: CreateCaseInput): Promise<CourtCase> {
  const payload = await requestJson("/api/couple-court/cases", { method: "POST", body: JSON.stringify(input) });
  return normalizeCase(payload);
}

export async function submitStatement(caseId: string, input: StatementInput): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/statements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createInvite(caseId: string): Promise<CourtInvite> {
  const payload = record(unwrap(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/invite`, { method: "POST", body: "{}" }), ["invite", "data"]));
  const token = stringValue(payload.token);
  const rawInviteUrl = stringValue(payload.inviteUrl, payload.invite_url, payload.url)
    ?? (token && typeof window !== "undefined"
      ? `${window.location.origin}${weddingPath("/couple-court/invite")}#token=${encodeURIComponent(token)}`
      : undefined);
  let inviteUrl: string | undefined;
  if (rawInviteUrl && typeof window !== "undefined") {
    try {
      const parsed = new URL(rawInviteUrl, window.location.origin);
      if (parsed.origin !== window.location.origin) throw new Error("cross-origin");
      inviteUrl = parsed.toString();
    } catch {
      throw new CourtApiError("초대 주소의 출처를 안전하게 확인하지 못했어요.", 502);
    }
  }
  if (!inviteUrl) throw new CourtApiError("초대 링크를 만들었지만 주소를 확인하지 못했어요.", 502);
  return { inviteUrl, expiresAt: stringValue(payload.expiresAt, payload.expires_at) };
}

export async function cancelInvite(caseId: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/invite`, {
    method: "DELETE",
    body: "{}",
  });
}

export async function leaveCase(caseId: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/participation`, {
    method: "DELETE",
    body: "{}",
  });
}

export async function requestVerdict(caseId: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/judge`, { method: "POST", body: "{}" });
}

export async function getVerdict(caseId: string): Promise<CourtVerdict> {
  const payload = await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/verdict`);
  const root = record(payload);
  if (root.status === "judging" || root.status === "pending" || root.verdict === null) {
    throw new CourtApiError(
      "아모라가 두 사람의 입장과 화해 처방을 정리하고 있어요.",
      202,
      "verdict_pending",
      numberValue(root.retry_after_seconds),
    );
  }
  return normalizeVerdict(payload);
}

export async function getVerdictHistory(caseId: string): Promise<CourtVerdictHistoryItem[]> {
  const payload = record(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/verdict-history`));
  return arrayValue(payload.history).flatMap((value) => {
    const item = record(value);
    const generationVersion = numberValue(item.generationVersion, item.generation_version);
    const status = stringValue(item.status);
    if (!generationVersion || (status !== "ready" && status !== "superseded")) return [];
    return [{
      generationVersion,
      status,
      completedAt: stringValue(item.completedAt, item.completed_at),
      supersededAt: stringValue(item.supersededAt, item.superseded_at),
    }];
  });
}

export async function saveMissionAction(caseId: string, missionId: string, confirmShared = false): Promise<void> {
  void caseId;
  await requestJson(`/api/couple-court/missions/${encodeURIComponent(missionId)}/save-action`, {
    method: "POST",
    body: confirmShared ? JSON.stringify({ confirm_shared: true }) : "{}",
  });
}

export async function updateMissionStatus(missionId: string, status: "accepted" | "completed"): Promise<void> {
  await requestJson(`/api/couple-court/missions/${encodeURIComponent(missionId)}/${status === "accepted" ? "accept" : "complete"}`, {
    method: "POST",
    body: "{}",
  });
}

export async function submitFollowup(caseId: string, input: {
  outcome: "resolved" | "improved" | "unchanged" | "needs_more_talk";
  remainingIssue: string;
  mostHelpfulMission?: string;
}): Promise<{ safetyLevel: "normal" | "sensitive" | "high_risk" }> {
  const payload = record(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/followups`, {
    method: "POST",
    body: JSON.stringify(input),
  }));
  const level = stringValue(record(payload.safety).level);
  return { safetyLevel: level === "high_risk" ? "high_risk" : level === "sensitive" ? "sensitive" : "normal" };
}

export async function createPublicPreview(caseId: string): Promise<PublicSnapshotPreview> {
  const payload = record(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/public-preview`, { method: "POST", body: "{}" }));
  const snapshot = record(payload.snapshot);
  const publicPost = record(payload.public_post ?? payload.publicPost);
  const publicPostId = stringValue(publicPost.id, payload.public_post_id, payload.publicPostId);
  const snapshotHash = stringValue(payload.snapshot_hash, payload.snapshotHash);
  const snapshotVersion = numberValue(payload.snapshot_version, payload.snapshotVersion);
  if (!publicPostId || !snapshotHash || snapshotVersion === undefined) {
    throw new CourtApiError("공개 미리보기의 동의 정보를 확인하지 못했어요.", 502);
  }
  return {
    publicPostId,
    snapshotHash,
    snapshotVersion,
    snapshot: {
      safeTitle: stringValue(snapshot.safeTitle, snapshot.safe_title) ?? "익명 사건",
      oneLine: stringValue(snapshot.oneLine, snapshot.one_line) ?? "공개용 요약이 없어요.",
      resultLabel: stringValue(snapshot.resultLabel, snapshot.result_label) ?? "한방 판결",
      hashtags: arrayValue(snapshot.hashtags).filter((item): item is string => typeof item === "string"),
      provisional: booleanValue(false, snapshot.provisional),
    },
  };
}

export async function setPublicConsent(caseId: string, preview: PublicSnapshotPreview, consented: boolean): Promise<string | undefined> {
  const payload = record(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/public-consent`, {
    method: "POST",
    body: JSON.stringify({ public_post_id: preview.publicPostId, snapshot_hash: preview.snapshotHash, consented }),
  }));
  return stringValue(record(payload.consent).status, payload.status);
}

export async function requestPublicReview(caseId: string, publicPostId: string): Promise<string | undefined> {
  const payload = record(await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/publish`, {
    method: "POST",
    body: JSON.stringify({ public_post_id: publicPostId }),
  }));
  return stringValue(record(payload.public_post ?? payload.publicPost).status);
}

export async function withdrawPublicPost(caseId: string, publicPostId: string): Promise<void> {
  await requestJson(`/api/couple-court/cases/${encodeURIComponent(caseId)}/publish`, {
    method: "DELETE",
    body: JSON.stringify({ public_post_id: publicPostId }),
  });
}

export interface PublicCourtListOptions {
  category: string;
  mode: "all" | CourtMode;
  sort: "latest" | "popular";
  page: number;
  limit: number;
}

export interface PublicCourtListPage {
  posts: PublicCourtCase[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasMore: boolean;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : fallback;
}

export async function listPublicCases(options: PublicCourtListOptions): Promise<PublicCourtListPage> {
  const params = new URLSearchParams();
  if (options.category !== "all") params.set("category", options.category);
  if (options.mode !== "all") params.set("mode", options.mode);
  if (options.sort !== "latest") params.set("sort", options.sort);
  if (options.page > 1) params.set("page", String(options.page));
  params.set("limit", String(options.limit));

  const payload = record(await requestJson(`/api/couple-court/public?${params.toString()}`));
  const posts = arrayValue(unwrap(payload, ["posts", "cases", "data"]))
    .map(normalizePublicCase)
    .filter((item) => Boolean(item.id));
  const total = nonNegativeInteger(payload.total, posts.length);
  const limit = positiveInteger(payload.limit, options.limit);
  const page = positiveInteger(payload.page, options.page);
  return {
    posts,
    total,
    page,
    limit,
    totalPages: positiveInteger(payload.total_pages, Math.max(1, Math.ceil(total / limit))),
    hasMore: booleanValue(page * limit < total, payload.has_more),
  };
}

export async function getPublicCase(postId: string): Promise<PublicCourtCase> {
  return normalizePublicCase(unwrap(await requestJson(`/api/couple-court/public/${encodeURIComponent(postId)}`), ["post", "case", "data"]));
}

export async function listPublicComments(postId: string): Promise<PublicCourtComment[]> {
  const payload = record(await requestJson(`/api/couple-court/public/${encodeURIComponent(postId)}/comments`));
  return arrayValue(payload.comments).map((value) => {
    const item = record(value);
    const commentType = stringValue(item.commentType, item.comment_type);
    return {
      id: stringValue(item.id) ?? "",
      commentType: commentType === "experience" || commentType === "practical_advice" || commentType === "question" ? commentType : "empathy",
      body: stringValue(item.body) ?? "",
      createdAt: stringValue(item.createdAt, item.created_at),
    } satisfies PublicCourtComment;
  }).filter((comment) => Boolean(comment.id && comment.body));
}

export async function createPublicComment(postId: string, commentType: PublicCourtComment["commentType"], body: string): Promise<{ moderationStatus?: string }> {
  const payload = record(await requestJson(`/api/couple-court/public/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    body: JSON.stringify({ commentType, body }),
  }));
  const comment = record(payload.comment);
  return { moderationStatus: stringValue(comment.moderationStatus, comment.moderation_status, payload.moderationStatus, payload.moderation_status) };
}

export async function votePublicCase(postId: string, choice: PublicVoteChoice): Promise<void> {
  await requestJson(`/api/couple-court/public/${encodeURIComponent(postId)}/vote`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });
}

export async function reportPublicCase(postId: string, reason: PublicReportReason, commentId?: string): Promise<void> {
  await requestJson(`/api/couple-court/public/${encodeURIComponent(postId)}/reports`, {
    method: "POST",
    body: JSON.stringify({ reason, ...(commentId ? { commentId } : {}) }),
  });
}

export async function acceptInvite(token?: string): Promise<InviteAcceptResult> {
  const payload = record(unwrap(await requestJson("/api/couple-court/invites/accept", {
    method: "POST",
    body: JSON.stringify(token ? { token } : {}),
  }), ["result", "data"]));
  return {
    caseId: stringValue(payload.caseId, payload.case_id),
    requiresAuth: booleanValue(false, payload.requiresAuth, payload.requires_auth),
    actionUrl: stringValue(payload.actionUrl, payload.action_url, payload.loginUrl, payload.login_url),
    message: stringValue(payload.message),
  };
}

export async function prepareInviteAccountSwitch(token?: string): Promise<void> {
  await requestJson("/api/couple-court/invites/accept", {
    method: "POST",
    body: JSON.stringify({ ...(token ? { token } : {}), prepare_only: true }),
  });
}

export async function rejectInvite(token?: string): Promise<void> {
  await requestJson("/api/couple-court/invites/accept", {
    method: "POST",
    body: JSON.stringify({ ...(token ? { token } : {}), reject: true }),
  });
}
