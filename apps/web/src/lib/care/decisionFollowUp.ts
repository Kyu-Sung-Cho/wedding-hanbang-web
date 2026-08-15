import { createHash } from "node:crypto";

const FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const MD5_RE = /^[0-9a-f]{32}$/u;
const UNSAFE_DISPLAY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

type ActorRole = "bride" | "groom";

export interface BuildConfirmedDecisionFollowUpCandidatesInput {
  coupleId: string;
  recipientUserId: string;
  actorRole: ActorRole;
  currentMemberUserIds: readonly string[];
  stateRevision: number;
  decisions: readonly unknown[];
  now?: Date;
}

const DESTINATIONS = {
  "/budget": { label: "예산 열기", href: "/budget" },
  "/schedule": { label: "일정 열기", href: "/schedule" },
  "/dashboard": { label: "준비 현황 열기", href: "/dashboard" },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !UNSAFE_DISPLAY_RE.test(value);
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function safeTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function hasExactCurrentRoster(
  metadata: Record<string, unknown>,
  currentMemberUserIds: readonly string[],
): boolean {
  if (!Array.isArray(metadata.acceptances)) return false;
  if (metadata.requiredCount !== currentMemberUserIds.length) return false;
  if (metadata.acceptances.length !== currentMemberUserIds.length) return false;

  const acceptedIds = new Set<string>();
  for (const acceptance of metadata.acceptances) {
    if (!isRecord(acceptance) || !UUID_RE.test(String(acceptance.userId))) return false;
    if (safeTimestamp(acceptance.acceptedAt) === null) return false;
    acceptedIds.add(String(acceptance.userId).toLowerCase());
  }
  const currentIds = new Set(currentMemberUserIds.map((id) => id.toLowerCase()));
  return acceptedIds.size === currentIds.size
    && [...acceptedIds].every((id) => currentIds.has(id));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildConfirmedDecisionFollowUpCandidates({
  coupleId,
  recipientUserId,
  actorRole,
  currentMemberUserIds,
  stateRevision,
  decisions,
  now = new Date(),
}: BuildConfirmedDecisionFollowUpCandidatesInput) {
  if (
    !UUID_RE.test(coupleId)
    || !UUID_RE.test(recipientUserId)
    || !isSafeRevision(stateRevision)
    || currentMemberUserIds.length < 1
    || currentMemberUserIds.length > 2
    || !currentMemberUserIds.includes(recipientUserId)
  ) return [];

  const candidates = [];
  for (const value of decisions) {
    if (!isRecord(value) || !isRecord(value.metadata)) continue;
    const metadata = value.metadata;
    const confirmedAt = safeTimestamp(value.user_confirmed_at);
    const decidedAt = safeTimestamp(value.decided_at);
    const expectedRevision = metadata.expectedRevision;
    const appliedRevision = metadata.appliedRevision;
    const surfaceHref = metadata.surfaceHref;
    if (
      !UUID_RE.test(String(value.id))
      || value.couple_id !== coupleId
      || value.visibility !== "shared"
      || !["decided", "scheduled"].includes(String(value.decision_type))
      || !["bride", "groom"].includes(String(value.source_actor_role))
      || (
        currentMemberUserIds.length === 1
        && value.source_actor_role !== actorRole
      )
      || value.superseded_at !== null
      || confirmedAt === null
      || decidedAt === null
      || confirmedAt > decidedAt
      || decidedAt > now.getTime()
      || now.getTime() - decidedAt < FOLLOW_UP_DELAY_MS
      || !isSafeText(value.title, 120)
      || metadata.origin !== "couple_plan_change_request"
      || !UUID_RE.test(String(value.source_ref_id))
      || metadata.requestId !== value.source_ref_id
      || !SHA256_RE.test(String(metadata.changeDigest))
      || !MD5_RE.test(String(metadata.rosterFingerprint))
      || metadata.legacyReceiptOnly === true
      || !isSafeRevision(expectedRevision)
      || !isSafeRevision(appliedRevision)
      || appliedRevision > stateRevision
      || appliedRevision !== expectedRevision + 1
      || typeof surfaceHref !== "string"
      || !(surfaceHref in DESTINATIONS)
      || !hasExactCurrentRoster(metadata, currentMemberUserIds)
    ) continue;

    const id = String(value.id).toLowerCase();
    const nextAction = DESTINATIONS[surfaceHref as keyof typeof DESTINATIONS];
    candidates.push({
      sourceKey: `decision:${id}`,
      sourceStateDigest: sha256(JSON.stringify({
        version: 1,
        decisionId: id,
        title: value.title,
        appliedRevision,
        surfaceHref,
      })),
      sourceRevision: stateRevision,
      kind: "decision_follow_up" as const,
      whyNow: "직접 확인한 결정이 반영된 뒤 하루가 지났어요. 지금도 이대로 진행할지 확인해 보세요.",
      confirmed: [`결정: ${value.title}`],
      unknown: [],
      nextAction: { ...nextAction },
      impact: "확인만 하며 예산·일정·체크리스트를 자동으로 바꾸지 않아요.",
      choices: [
        { action: "open_source" as const, label: nextAction.label },
        { action: "snooze" as const, label: "나중에" },
        { action: "dismiss" as const, label: "오늘 닫기" },
        { action: "mute_source" as const, label: "내용이 바뀔 때까지 숨기기" },
      ],
      priority: 80,
    });
  }
  return candidates;
}
