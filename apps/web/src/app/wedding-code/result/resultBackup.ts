import {
  WEDDING_CODE_V05_COMPATIBLE_VERSIONS,
  WEDDING_CODE_V05_QUESTIONS,
  WEDDING_CODE_V05_SCORING_VERSION,
  WEDDING_CODE_V05_VERSION,
} from "@/constants/weddingCodeV05";

export interface WcResultBackup {
  answers: Record<string, string>;
  skipped?: Record<string, boolean>;
  version?: string;
  scoringVersion?: string;
  responseId?: string | null;
  paired?: boolean;
  pairingStatus?: "unpaired" | "waiting" | "paired" | "full";
  coupleToken?: string | null;
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
const WC_RESULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

let volatileBackup: WcResultBackup | null = null;

export function isCurrentWcResultBackup(backup: WcResultBackup): boolean {
  return (
    backup.version === WEDDING_CODE_V05_VERSION &&
    backup.scoringVersion === WEDDING_CODE_V05_SCORING_VERSION
  );
}

export function isCompleteCurrentWcResultBackup(backup: WcResultBackup): boolean {
  if (!isCurrentWcResultBackup(backup)) return false;
  return WEDDING_CODE_V05_QUESTIONS.every((question) => {
    const answer = backup.answers[question.key];
    return question.options.some((option) => option.value === answer);
  });
}

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
      typeof value.savedAt !== "string" ||
      (value.updatedAt !== undefined && typeof value.updatedAt !== "string")
    ) {
      return null;
    }
    const now = Date.now();
    const savedAt = Date.parse(value.savedAt);
    const updatedAt = value.updatedAt === undefined ? undefined : Date.parse(value.updatedAt);
    if (
      !Number.isFinite(savedAt) ||
      (updatedAt !== undefined && !Number.isFinite(updatedAt)) ||
      savedAt > now + WC_RESULT_MAX_CLOCK_SKEW_MS ||
      (updatedAt !== undefined && updatedAt > now + WC_RESULT_MAX_CLOCK_SKEW_MS)
    ) {
      return null;
    }

    // A small device-clock drift should not lose a just-finished result, but a
    // future timestamp must never extend retention or outrank a valid backup.
    if (savedAt > now) value.savedAt = new Date(now).toISOString();
    if (updatedAt !== undefined && updatedAt > now) value.updatedAt = new Date(now).toISOString();

    const freshnessTime = updatedAt ?? savedAt;
    if (now - Math.min(freshnessTime, now) > WC_RESULT_RETENTION_MS) return null;

    // Only the exact current form may inherit a missing scoringVersion. Older
    // candidates used a different item/score contract and must be retaken.
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

function sanitizeBackup(
  backup: WcResultBackup,
  storageFallback: WcResultBackup["storageFallback"]
): WcResultBackup {
  return {
    answers: backup.answers,
    version: backup.version,
    scoringVersion: backup.scoringVersion,
    savedAt: backup.savedAt,
    updatedAt: backup.updatedAt,
    storageFallback,
  };
}

function rewriteSanitizedBackup(
  storage: Storage,
  key: string,
  raw: string,
  sanitized: WcResultBackup
): void {
  const next = JSON.stringify(sanitized);
  if (raw === next) return;
  try {
    storage.setItem(key, next);
  } catch {
    // 읽기는 가능하지만 덮어쓰기가 막힌 저장소라면, 구 capability를 평문으로
    // 남기지 않는 쪽을 우선한다. 현재 호출의 메모리 후보는 그대로 유지된다.
    try {
      storage.removeItem(key);
    } catch {
      /* 브라우저가 삭제까지 막은 경우에도 런타임에는 정제된 값만 반환한다. */
    }
  }
}

export function readWcResultBackup(): WcResultBackup | null {
  const candidates: WcResultBackup[] = [];
  if (volatileBackup) {
    const parsedVolatile = parseBackup(JSON.stringify(volatileBackup));
    if (parsedVolatile) {
      volatileBackup = sanitizeBackup(parsedVolatile, parsedVolatile.storageFallback);
      candidates.push(volatileBackup);
    }
    else volatileBackup = null;
  }

  try {
    const rawSession = window.sessionStorage.getItem(WC_RESULT_SESSION_STORAGE_KEY);
    const sessionBackup = parseBackup(rawSession);
    if (sessionBackup && rawSession) {
      const sanitizedSession = sanitizeBackup(sessionBackup, "session");
      candidates.push(sanitizedSession);
      rewriteSanitizedBackup(
        window.sessionStorage,
        WC_RESULT_SESSION_STORAGE_KEY,
        rawSession,
        sanitizedSession
      );
    }
    else if (rawSession) window.sessionStorage.removeItem(WC_RESULT_SESSION_STORAGE_KEY);
  } catch {
    /* sessionStorage를 사용할 수 없는 환경에서는 다른 저장 경로를 확인한다. */
  }

  try {
    const rawLocal = window.localStorage.getItem(WC_RESULT_STORAGE_KEY);
    const localBackup = parseBackup(rawLocal);
    if (localBackup && rawLocal) {
      const sanitizedLocal = sanitizeBackup(localBackup, undefined);
      candidates.push(sanitizedLocal);
      rewriteSanitizedBackup(window.localStorage, WC_RESULT_STORAGE_KEY, rawLocal, sanitizedLocal);
    }
    else if (rawLocal) window.localStorage.removeItem(WC_RESULT_STORAGE_KEY);
  } catch {
    /* localStorage를 사용할 수 없는 환경에서는 탭 세션/메모리 결과를 사용한다. */
  }

  const latest = candidates.sort((a, b) => savedAtTime(b) - savedAtTime(a))[0] ?? null;
  return latest;
}

export function storeWcResultBackup(backup: WcResultBackup): "local" | "session" | "memory" {
  const persistentBackup = sanitizeBackup(
    { ...backup, updatedAt: new Date().toISOString() },
    undefined
  );
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

export function clearWcResultBackup(): void {
  volatileBackup = null;
  try {
    window.localStorage.removeItem(WC_RESULT_STORAGE_KEY);
  } catch {
    /* 저장소 접근이 막힌 환경에서도 메모리 결과는 위에서 제거한다. */
  }
  try {
    window.sessionStorage.removeItem(WC_RESULT_SESSION_STORAGE_KEY);
  } catch {
    /* 세션 저장소가 없어도 삭제 동작은 완료된 것으로 본다. */
  }
}

export function resetWcResultBackupMemoryForTests(): void {
  volatileBackup = null;
}
