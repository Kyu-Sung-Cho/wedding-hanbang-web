import {
  WEDDING_CODE_V05_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
} from "@/constants/weddingCodeV05";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { toWeddingCodeV05Answers } from "./answers";

const COMPATIBLE_FORM_VERSIONS = new Set<string>(WEDDING_CODE_V05_COMPATIBLE_VERSIONS);

export interface SubmissionAttemptIdentity {
  id: string;
  context: string;
}

export interface WeddingCodeSubmissionResult {
  id: string;
  paired: boolean;
  recovered: boolean;
  pairingStatus: "unpaired" | "waiting" | "paired" | "full";
  coupleToken: string | null;
  formVersion: string;
  scoringVersion: typeof WEDDING_CODE_V05_SCORING_VERSION;
  participantStage: string;
  quoteStatus: string;
  answers: Record<string, string>;
}

type SubmissionIdentityRef = { current: SubmissionAttemptIdentity | null };

export const WC_PENDING_SUBMISSION_ID_PREFIX = "wc_pending_submission_id_v05:";

function sessionStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * A submission id belongs to one invite/standalone attempt. Session recovery
 * prevents a reload after an ambiguous response from consuming another slot,
 * while context-specific keys keep distinct invitations independent.
 */
export function getOrCreateSubmissionId(
  ref: SubmissionIdentityRef,
  context: string,
  createId: () => string = () => crypto.randomUUID(),
  storage: Storage | null = sessionStorageOrNull()
): string {
  const normalizedContext = isUuid(context) ? context.toLowerCase() : context;
  if (ref.current?.context === normalizedContext && isUuid(ref.current.id)) {
    return ref.current.id;
  }

  const storageKey = `${WC_PENDING_SUBMISSION_ID_PREFIX}${normalizedContext}`;

  try {
    const stored = storage?.getItem(storageKey);
    if (isUuid(stored)) {
      ref.current = { id: stored, context: normalizedContext };
      return stored;
    }
  } catch {
    /* A memory-only id still protects retries until this tab is reloaded. */
  }

  const id = createId();
  ref.current = { id, context: normalizedContext };
  try {
    storage?.setItem(storageKey, id);
  } catch {
    /* Some in-app/private browsers block sessionStorage. */
  }
  return id;
}

export function clearSubmissionId(
  ref: SubmissionIdentityRef,
  storage: Storage | null = sessionStorageOrNull()
): void {
  const identity = ref.current;
  ref.current = null;
  if (!identity) return;
  try {
    storage?.removeItem(`${WC_PENDING_SUBMISSION_ID_PREFIX}${identity.context}`);
  } catch {
    /* The in-memory ref was still cleared after a confirmed success. */
  }
}

/** Strictly accepts the canonical snapshot returned by the atomic DB RPC. */
export function parseWeddingCodeSubmissionResult(
  raw: unknown
): WeddingCodeSubmissionResult | null {
  if (!isRecord(raw) || raw.success !== true || !isUuid(raw.id)) return null;

  const pairingStatus = raw.pairingStatus;
  if (
    pairingStatus !== "unpaired" &&
    pairingStatus !== "waiting" &&
    pairingStatus !== "paired" &&
    pairingStatus !== "full"
  ) {
    return null;
  }

  const paired = pairingStatus === "paired";
  const expectsToken = pairingStatus === "waiting" || paired;
  if (raw.paired !== paired) return null;
  if (typeof raw.recovered !== "boolean") return null;
  if (expectsToken ? !isUuid(raw.coupleToken) : raw.coupleToken !== null) return null;
  if (typeof raw.formVersion !== "string" || !COMPATIBLE_FORM_VERSIONS.has(raw.formVersion)) {
    return null;
  }
  if (raw.scoringVersion !== WEDDING_CODE_V05_SCORING_VERSION) return null;
  if (typeof raw.participantStage !== "string" || typeof raw.quoteStatus !== "string") {
    return null;
  }

  const answers = toWeddingCodeV05Answers(raw.answers);
  if (Object.keys(answers).length !== WEDDING_CODE_V05_QUESTIONS.length) return null;

  return {
    id: raw.id,
    paired,
    recovered: raw.recovered,
    pairingStatus,
    coupleToken: expectsToken ? (raw.coupleToken as string) : null,
    formVersion: raw.formVersion,
    scoringVersion: WEDDING_CODE_V05_SCORING_VERSION,
    participantStage: raw.participantStage,
    quoteStatus: raw.quoteStatus,
    answers: answers as Record<string, string>,
  };
}
