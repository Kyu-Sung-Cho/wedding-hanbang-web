import {
  WEDDING_CODE_V05_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
} from "@/constants/weddingCodeV05";

export interface WcResultBackup {
  answers: Record<string, string>;
  skipped: Record<string, boolean>;
  version?: string;
  scoringVersion?: string;
  responseId: string | null;
  paired: boolean;
  pairingStatus?: "unpaired" | "waiting" | "paired" | "full";
  coupleToken: string | null;
  pendingCoupleToken?: string | null;
  pairingUnavailable?: boolean;
  recoveredPriorSubmission?: boolean;
  savedAt: string;
  updatedAt?: string;
  storageFallback?: "session" | "memory";
}

export const WC_RESULT_STORAGE_KEY = "wc_result_v05";
const WC_RESULT_SESSION_STORAGE_KEY = "wc_result_v05_session";
const WC_RESULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

let volatileBackup: WcResultBackup | null = null;

function parseBackup(raw: string | null): WcResultBackup | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as WcResultBackup;
    if (
      !value ||
      typeof value !== "object" ||
      !value.answers ||
      typeof value.answers !== "object" ||
      Array.isArray(value.answers) ||
      typeof value.savedAt !== "string"
    ) {
      return null;
    }
    const savedAt = Date.parse(value.updatedAt ?? value.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > WC_RESULT_RETENTION_MS) {
      return null;
    }

    // Candidate.1~9 are an audited legacy family that used the same weight
    // map before scoringVersion was written to browser backups.
    if (
      !value.scoringVersion &&
      typeof value.version === "string" &&
      WEDDING_CODE_V05_COMPATIBLE_VERSIONS.includes(
        value.version as (typeof WEDDING_CODE_V05_COMPATIBLE_VERSIONS)[number]
      )
    ) {
      value.scoringVersion = WEDDING_CODE_V05_SCORING_VERSION;
    }
    return value;
  } catch {
    return null;
  }
}

function savedAtTime(backup: WcResultBackup): number {
  const timestamp = Date.parse(backup.updatedAt ?? backup.savedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function readWcResultBackup(): WcResultBackup | null {
  const candidates: WcResultBackup[] = [];
  if (volatileBackup) {
    const parsedVolatile = parseBackup(JSON.stringify(volatileBackup));
    if (parsedVolatile) candidates.push(parsedVolatile);
    else volatileBackup = null;
  }

  try {
    const rawSession = window.sessionStorage.getItem(WC_RESULT_SESSION_STORAGE_KEY);
    const sessionBackup = parseBackup(rawSession);
    if (sessionBackup) candidates.push(sessionBackup);
    else if (rawSession) window.sessionStorage.removeItem(WC_RESULT_SESSION_STORAGE_KEY);
  } catch {
    /* sessionStorage를 사용할 수 없는 환경에서는 다른 저장 경로를 확인한다. */
  }

  try {
    const rawLocal = window.localStorage.getItem(WC_RESULT_STORAGE_KEY);
    const localBackup = parseBackup(rawLocal);
    if (localBackup) candidates.push(localBackup);
    else if (rawLocal) window.localStorage.removeItem(WC_RESULT_STORAGE_KEY);
  } catch {
    /* localStorage를 사용할 수 없는 환경에서는 탭 세션/메모리 결과를 사용한다. */
  }

  const latest = candidates.sort((a, b) => savedAtTime(b) - savedAtTime(a))[0] ?? null;
  if (!latest) return null;

  // Retire any plaintext capability/response identifier left by an older
  // browser build. Rewriting the selected backup removes it from localStorage
  // as soon as the result page is opened.
  if (latest.responseId || latest.coupleToken || latest.pendingCoupleToken) {
    const sanitized: WcResultBackup = {
      ...latest,
      responseId: null,
      paired: false,
      pairingStatus: "unpaired",
      coupleToken: null,
      pendingCoupleToken: null,
      pairingUnavailable: undefined,
    };
    storeWcResultBackup(sanitized);
    return sanitized;
  }
  return latest;
}

export function storeWcResultBackup(backup: WcResultBackup): "local" | "session" | "memory" {
  const persistentBackup = {
    ...backup,
    updatedAt: new Date().toISOString(),
    storageFallback: undefined,
  };
  volatileBackup = persistentBackup;

  try {
    window.localStorage.setItem(WC_RESULT_STORAGE_KEY, JSON.stringify(persistentBackup));
    try {
      window.sessionStorage.removeItem(WC_RESULT_SESSION_STORAGE_KEY);
    } catch {
      /* 최신 savedAt 비교로 오래된 세션 백업보다 새 로컬 백업을 우선한다. */
    }
    return "local";
  } catch {
    /* localStorage 실패 시 같은 탭의 sessionStorage로 내려간다. */
  }

  const sessionBackup: WcResultBackup = { ...persistentBackup, storageFallback: "session" };
  volatileBackup = sessionBackup;
  try {
    window.sessionStorage.setItem(WC_RESULT_SESSION_STORAGE_KEY, JSON.stringify(sessionBackup));
    return "session";
  } catch {
    const memoryBackup: WcResultBackup = { ...persistentBackup, storageFallback: "memory" };
    volatileBackup = memoryBackup;
    return "memory";
  }
}

export function resetWcResultBackupMemoryForTests(): void {
  volatileBackup = null;
}
