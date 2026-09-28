import { createHash } from "node:crypto";
import { verifyDeletionSupportProof } from "./supportProof";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const STATES = ["prepared", "enqueue-unverified", "queued", "process-unverified", "pending", "retry", "manual_review", "scope_review_required"] as const;
export type SupportCaseState = typeof STATES[number];
export interface SupportCaseEvent { at: string; state: SupportCaseState; jobId: string | null }
interface SupportCaseHistory {
  totalEvents: number;
  archivedEvents: number;
  archivedSha256: string | null;
}
interface DeletionSupportCaseData {
  caseId: string;
  projectRef: string;
  subject: string;
  proofReference: string;
  proofIssuedAt: number;
  requestSha256: string;
  operator: string;
  reviewedAt: string;
  scope: "existing-account-deletion-saga";
  jobId: string | null;
  state: SupportCaseState;
  events: SupportCaseEvent[];
  /** 엔진 완료는 고객의 대화·파생 정보까지 모두 삭제됐다는 뜻이 아니다. */
  generalCustomerDataRemovalVerified: false;
}
export type DeletionSupportCase = DeletionSupportCaseData & (
  | { format: "hanbang-deletion-support-case-v1"; history?: never }
  | { format: "hanbang-deletion-support-case-v2"; history: SupportCaseHistory }
);
export interface SupportJob {
  id: string;
  userId: string | null;
  status: "inventorying" | "inventory_ready" | "deleting" | "auth_deleting" | "manual_review" | "completed";
  claimToken: string | null;
  storageVerifiedAt: string | null;
  authDeletedAt: string | null;
  completedAt: string | null;
}
export interface SupportCaseDependencies {
  /** 암호화·fsync·복호화 왕복을 마친 뒤에만 반환한다. */
  persist: (value: DeletionSupportCase) => Promise<void>;
  enqueue: (subject: string) => Promise<void>;
  findActiveJobs: (subject: string) => Promise<SupportJob[]>;
  readJob: (jobId: string) => Promise<SupportJob | null>;
  process: (jobId: string) => Promise<{ status: "pending" | "retry" | "manual_review" | "completed" }>;
  verifyAccountAbsence: (subject: string) => Promise<boolean>;
  now?: () => number;
}
export class DeletionSupportCaseError extends Error {
  constructor(readonly code: string) { super(code); this.name = "DeletionSupportCaseError"; }
}
/** 고유한 읽기 전용 운영 API의 실제 응답만 확인한다. 기존 cron 실행 URL은 조회하지 않는다. */
export function validateSupportRuntimeState(value: unknown, expectedCommit: string, now = Date.now()) {
  requireCase(value && typeof value === "object" && !Array.isArray(value), "SUPPORT_CASE_RUNTIME_STATE_INVALID");
  const state = value as Record<string, unknown>;
  requireCase(Object.keys(state).sort().join(",") === "commit,flags,observedAt"
    && /^[a-f0-9]{40}$/.test(expectedCommit) && state.commit === expectedCommit
    && typeof state.observedAt === "string" && Date.parse(state.observedAt) <= now
    && Date.parse(state.observedAt) > now - 30_000 && state.flags && typeof state.flags === "object" && !Array.isArray(state.flags),
  "SUPPORT_CASE_RUNTIME_STATE_INVALID");
  const flags = state.flags as Record<string, unknown>;
  requireCase(Object.keys(flags).sort().join(",") === "ACCOUNT_DELETION_CRON_ENABLED,ACCOUNT_DELETION_INTAKE_ENABLED"
    && flags.ACCOUNT_DELETION_INTAKE_ENABLED === false && flags.ACCOUNT_DELETION_CRON_ENABLED === false,
  "SUPPORT_CASE_AUTOMATIC_PROCESSING_NOT_DISABLED");
}
export function validateSupportExecutionObservation(value: unknown, expectedCommit: string, now = Date.now()) {
  requireCase(value && typeof value === "object" && !Array.isArray(value), "SUPPORT_CASE_RUNTIME_OBSERVATION_REQUIRED");
  const observed = value as Record<string, unknown>;
  requireCase(observed.format === "w12-production-flags-observation-v1"
    && observed.source === "vercel-production-environment-read" && observed.deploymentTarget === "production"
    && /^[a-f0-9]{40}$/.test(expectedCommit) && observed.productionCommit === expectedCommit
    && typeof observed.deploymentId === "string" && /^dpl_[A-Za-z0-9]+$/.test(observed.deploymentId)
    && typeof observed.observedAt === "string" && Date.parse(observed.observedAt) <= now
    && Date.parse(observed.observedAt) > now - 5 * 60_000 && Array.isArray(observed.flags) && observed.flags.length === 2,
  "SUPPORT_CASE_FRESH_MANUAL_PROCESSING_OBSERVATION_REQUIRED");
  const flags = observed.flags as Record<string, unknown>[];
  requireCase(flags.every(f => f && typeof f === "object")
    && ["ACCOUNT_DELETION_INTAKE_ENABLED", "ACCOUNT_DELETION_CRON_ENABLED"].every(name => {
      const matches = flags.filter(f => f.name === name);
      return matches.length === 1 && ((matches[0].present === false && matches[0].value === null)
        || (matches[0].present === true && typeof matches[0].value === "string" && matches[0].value !== "true"));
    }), "SUPPORT_CASE_AUTOMATIC_PROCESSING_NOT_DISABLED");
}
function requireCase(value: unknown, code: string): asserts value {
  if (!value) throw new DeletionSupportCaseError(code);
}
function validTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function checkJob(job: SupportJob | null, value: DeletionSupportCase): asserts job is SupportJob {
  requireCase(job && UUID.test(job.id) && (value.jobId === null || job.id === value.jobId), "SUPPORT_CASE_JOB_MISMATCH");
  requireCase(["inventorying", "inventory_ready", "deleting", "auth_deleting", "manual_review", "completed"].includes(job.status)
    && (job.claimToken === null || UUID.test(job.claimToken)), "SUPPORT_CASE_JOB_INVALID");
  if (job.status === "completed") {
    requireCase(value.jobId !== null && job.userId === null
      && [job.storageVerifiedAt, job.authDeletedAt, job.completedAt].every(validTime), "SUPPORT_CASE_COMPLETION_UNVERIFIED");
  } else requireCase(job.userId === value.subject && job.completedAt === null, "SUPPORT_CASE_OWNER_MISMATCH");
}

export function validateDeletionSupportCase(value: unknown, projectRef: string): asserts value is DeletionSupportCase {
  requireCase(value && typeof value === "object" && !Array.isArray(value), "SUPPORT_CASE_INVALID");
  const c = value as DeletionSupportCase;
  requireCase(["hanbang-deletion-support-case-v1", "hanbang-deletion-support-case-v2"].includes(c.format) && c.projectRef === projectRef
    && /^[a-z0-9]{20}$/.test(c.projectRef) && UUID.test(c.caseId) && UUID.test(c.subject)
    && UUID.test(c.proofReference) && Number.isSafeInteger(c.proofIssuedAt) && c.proofIssuedAt > 0
    && SHA.test(c.requestSha256) && typeof c.operator === "string" && /^[A-Za-z0-9._@+-]{1,120}$/.test(c.operator)
    && validTime(c.reviewedAt) && c.scope === "existing-account-deletion-saga"
    && c.generalCustomerDataRemovalVerified === false && STATES.includes(c.state)
    && (c.jobId === null || UUID.test(c.jobId)) && Array.isArray(c.events) && c.events.length > 0 && c.events.length <= 100,
  "SUPPORT_CASE_INVALID");
  if (c.format === "hanbang-deletion-support-case-v1") {
    requireCase(c.history === undefined, "SUPPORT_CASE_HISTORY_INVALID");
  } else {
    const h = c.history;
    requireCase(h && typeof h === "object" && !Array.isArray(h)
      && Object.keys(h).sort().join(",") === "archivedEvents,archivedSha256,totalEvents"
      && Number.isSafeInteger(h.totalEvents) && h.totalEvents > 0
      && Number.isSafeInteger(h.archivedEvents) && h.archivedEvents >= 0
      && h.totalEvents === c.events.length + h.archivedEvents
      && c.events.length === Math.min(h.totalEvents, 100)
      && (h.archivedEvents === 0 ? h.archivedSha256 === null
        : typeof h.archivedSha256 === "string" && SHA.test(h.archivedSha256)),
    "SUPPORT_CASE_HISTORY_INVALID");
  }
  requireCase(c.events.every(e => e && typeof e === "object" && !Array.isArray(e)
      && Object.keys(e).sort().join(",") === "at,jobId,state"
      && validTime(e.at) && STATES.includes(e.state) && (e.jobId === null || UUID.test(e.jobId)))
    && c.events[0].state === "prepared" && c.events[0].jobId === null
    && c.events.at(-1)?.state === c.state && c.events.at(-1)?.jobId === c.jobId
    && (c.jobId !== null || ["prepared", "enqueue-unverified"].includes(c.state))
    && c.events.every(e => e.jobId === null || e.jobId === c.jobId), "SUPPORT_CASE_HISTORY_INVALID");
}

export function getDeletionSupportCaseEventCount(value: DeletionSupportCase): number {
  return value.format === "hanbang-deletion-support-case-v2" ? value.history.totalEvents : value.events.length;
}

function appendEventHistory(value: DeletionSupportCase, event: SupportCaseEvent) {
  const events = [...value.events, event];
  const previousHistory = value.format === "hanbang-deletion-support-case-v2" ? value.history : {
    totalEvents: value.events.length, archivedEvents: 0, archivedSha256: null,
  };
  const history = { ...previousHistory, totalEvents: previousHistory.totalEvents + 1 };
  if (events.length > 100) {
    // 첫 본인 확인 기록과 최근 99개만 메모리에 둔다. 빠진 원문은 지우지 않고
    // append-only 암호화 journal의 이전 파일에 보존하며 digest로 연결한다.
    const [archived] = events.splice(1, 1);
    history.archivedEvents += 1;
    history.archivedSha256 = createHash("sha256")
      .update(JSON.stringify([previousHistory.archivedSha256, archived])).digest("hex");
  }
  return { events, history };
}

/** 저장소도 같은 계약으로 전체 journal을 순서대로 검증한다. hash만으로 원문을 대체하지 않는다. */
export function validateDeletionSupportCaseTransition(previous: DeletionSupportCase | null, next: DeletionSupportCase): void {
  validateDeletionSupportCase(next, next.projectRef);
  if (previous === null) {
    requireCase(next.state === "prepared" && next.jobId === null && next.events.length === 1
      && getDeletionSupportCaseEventCount(next) === 1, "SUPPORT_CASE_HISTORY_INVALID");
    return;
  }
  validateDeletionSupportCase(previous, previous.projectRef);
  const immutable = ["caseId", "projectRef", "subject", "proofReference", "proofIssuedAt",
    "requestSha256", "operator", "reviewedAt", "scope", "generalCustomerDataRemovalVerified"] as const;
  requireCase(immutable.every(key => previous[key] === next[key])
    && (previous.jobId === null || previous.jobId === next.jobId)
    && Number.isSafeInteger(getDeletionSupportCaseEventCount(previous) + 1)
    && getDeletionSupportCaseEventCount(next) === getDeletionSupportCaseEventCount(previous) + 1,
  "SUPPORT_CASE_HISTORY_INVALID");
  const expected = appendEventHistory(previous, next.events[next.events.length - 1]);
  requireCase(JSON.stringify(next.events) === JSON.stringify(expected.events), "SUPPORT_CASE_HISTORY_INVALID");
  if (next.format === "hanbang-deletion-support-case-v2") {
    requireCase(next.history.totalEvents === expected.history.totalEvents
      && next.history.archivedEvents === expected.history.archivedEvents
      && next.history.archivedSha256 === expected.history.archivedSha256, "SUPPORT_CASE_HISTORY_INVALID");
  } else {
    requireCase(previous.format === "hanbang-deletion-support-case-v1"
      && expected.history.archivedEvents === 0, "SUPPORT_CASE_HISTORY_INVALID");
  }
}

/** 원본 문의와 본인 코드가 같은 사건에 들어 있어야 한다. 운영자는 실제 탈퇴 요청을 검토한다. */
export function prepareDeletionSupportCase(input: {
  caseId: string; projectRef: string; secret: string; proof: string;
  requestText: string; operator: string; confirmation: string; now?: number;
}): DeletionSupportCase {
  const now = input.now ?? Date.now();
  const identity = verifyDeletionSupportProof({ ...input, now });
  requireCase(UUID.test(input.caseId) && input.confirmation === `REVIEWED_ACCOUNT_DELETION_REQUEST:${input.caseId}:${identity.reference}`,
    "SUPPORT_CASE_REQUEST_REVIEW_REQUIRED");
  requireCase(typeof input.requestText === "string" && Buffer.byteLength(input.requestText) <= 64 * 1024
    && input.requestText.includes(input.proof) && input.requestText.replace(input.proof, "").trim().length >= 10,
    "SUPPORT_CASE_ORIGINAL_REQUEST_REQUIRED");
  const at = new Date(now).toISOString();
  const value: DeletionSupportCase = {
    format: "hanbang-deletion-support-case-v2", caseId: input.caseId, projectRef: identity.projectRef,
    subject: identity.subject, proofReference: identity.reference, proofIssuedAt: identity.issuedAt,
    requestSha256: createHash("sha256").update(input.requestText).digest("hex"), operator: input.operator,
    reviewedAt: at, scope: "existing-account-deletion-saga", jobId: null, state: "prepared",
    events: [{ at, state: "prepared", jobId: null }],
    history: { totalEvents: 1, archivedEvents: 0, archivedSha256: null }, generalCustomerDataRemovalVerified: false,
  };
  validateDeletionSupportCase(value, input.projectRef);
  return value;
}

export async function advanceDeletionSupportCase(value: DeletionSupportCase,
  mode: "enqueue" | "inspect" | "process", deps: SupportCaseDependencies): Promise<DeletionSupportCase> {
  validateDeletionSupportCase(value, value.projectRef);
  // 처리 전·후 두 번의 기록이 모두 가능해야 파괴 단계를 시작할 수 있다.
  requireCase(Number.isSafeInteger(getDeletionSupportCaseEventCount(value) + 2), "SUPPORT_CASE_HISTORY_LIMIT");
  let current = structuredClone(value);
  const save = async (state: SupportCaseState, jobId = current.jobId) => {
    const next: DeletionSupportCase = { ...current, format: "hanbang-deletion-support-case-v2", state, jobId,
      ...appendEventHistory(current, { at: new Date((deps.now ?? Date.now)()).toISOString(), state, jobId }) };
    validateDeletionSupportCaseTransition(current, next);
    await deps.persist(next);
    current = next;
  };
  const bind = async () => {
    const jobs = await deps.findActiveJobs(current.subject);
    requireCase(Array.isArray(jobs) && jobs.length === 1, "SUPPORT_CASE_ACTIVE_JOB_UNVERIFIED");
    checkJob(jobs[0], current);
    requireCase(jobs[0].status !== "completed", "SUPPORT_CASE_JOB_MISMATCH");
    await save(jobs[0].status === "manual_review" ? "manual_review" : "queued", jobs[0].id);
  };
  if (mode === "enqueue") {
    requireCase(current.state === "prepared" && current.jobId === null, "SUPPORT_CASE_INSPECT_FIRST");
    // 서버 응답이 유실되어도 사건은 남고, inspect가 같은 소유자의 활성 job만 회수한다.
    await save("enqueue-unverified");
    await deps.enqueue(current.subject);
    await bind();
    return current;
  }
  if (mode === "inspect" && current.jobId === null) {
    requireCase(current.state === "enqueue-unverified", "SUPPORT_CASE_NOT_ENQUEUED");
    await bind();
    return current;
  }
  requireCase(current.jobId !== null, "SUPPORT_CASE_JOB_REQUIRED");
  const job = await deps.readJob(current.jobId);
  checkJob(job, current);
  if (job.status === "completed") {
    requireCase(await deps.verifyAccountAbsence(current.subject), "SUPPORT_CASE_COMPLETION_UNVERIFIED");
    await save("scope_review_required");
    return current;
  }
  if (job.status === "manual_review") {
    await save("manual_review");
    return current;
  }
  requireCase(job.claimToken === null, "SUPPORT_CASE_WORKER_BUSY");
  if (mode === "inspect") {
    await save("pending");
    return current;
  }
  requireCase(mode === "process" && !["enqueue-unverified", "process-unverified", "manual_review", "scope_review_required"].includes(current.state),
    "SUPPORT_CASE_INSPECT_FIRST");
  await save("process-unverified");
  await deps.process(job.id);
  // worker 응답 문자열만으로 완료라 쓰지 않고 같은 job 원장을 다시 읽는다.
  const after = await deps.readJob(job.id);
  checkJob(after, current);
  if (after.status === "completed") {
    requireCase(await deps.verifyAccountAbsence(current.subject), "SUPPORT_CASE_COMPLETION_UNVERIFIED");
    await save("scope_review_required");
  } else await save(after.status === "manual_review" ? "manual_review" : "pending");
  return current;
}
