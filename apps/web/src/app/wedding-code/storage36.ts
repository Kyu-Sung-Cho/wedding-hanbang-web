import { validateSubmission, type Submission } from "@/lib/weddingCode36";
import { isRecord, isUuid } from "@/utils/requestValidation";

export type PairingStatus36 = "unpaired" | "waiting" | "paired" | "full";
export interface Result36 {
  id: string;
  accessToken: string;
  submission: Submission;
  pairingStatus: PairingStatus36;
  coupleToken: string | null;
  savedAt: string;
  expiresAt?: string;
  storage?: "local" | "session" | "memory";
  pairingError?: string;
}
export interface Pending36 {
  submissionId: string;
  accessToken: string;
  submission: Submission;
  inviteToken: string | null;
}
export interface Draft36 {
  answers: Record<string, number | null>;
  missingReasons: Record<string, string>;
  index: number;
  step: "intro" | "questions" | "review";
  compare: boolean;
  shareAlias: boolean;
  shareNotes: string[];
}

const PREFIX = "wc36:result:";
const LATEST = "wc36:latest";
const memory = new Map<string, string>();

function load(key: string): string | null {
  if (typeof window !== "undefined") {
    for (const kind of ["sessionStorage", "localStorage"] as const) {
      try {
        const value = window[kind].getItem(key);
        if (value !== null) return value;
      } catch { /* 사용할 수 있는 저장 경로를 계속 확인한다. */ }
    }
  }
  return memory.get(key) ?? null;
}

function save(key: string, value: string): "local" | "session" | "memory" {
  memory.set(key, value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
      try { window.sessionStorage.removeItem(key); } catch { /* 메모리 사본도 보존한다. */ }
      return "local";
    } catch { /* 개인 모드에서는 탭 세션으로 보관한다. */ }
    try { window.sessionStorage.setItem(key, value); return "session"; } catch { /* 현재 탭 메모리에 보관한다. */ }
  }
  return "memory";
}

function remove(key: string) {
  memory.delete(key);
  if (typeof window !== "undefined") {
    for (const kind of ["localStorage", "sessionStorage"] as const) {
      try { window[kind].removeItem(key); } catch { /* 다른 저장 경로도 정리한다. */ }
    }
  }
}

export function parseResult36(value: unknown): Result36 | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.accessToken) ||
      !["unpaired", "waiting", "paired", "full"].includes(String(value.pairingStatus)) ||
      typeof value.savedAt !== "string") return null;
  const status = value.pairingStatus as PairingStatus36;
  if ((status === "waiting" || status === "paired") ? !isUuid(value.coupleToken) : value.coupleToken !== null) return null;
  try {
    return { id: value.id, accessToken: value.accessToken, submission: validateSubmission(value.submission),
      pairingStatus: status, coupleToken: value.coupleToken as string | null, savedAt: value.savedAt,
      expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
      storage: value.storage === "session" || value.storage === "memory" ? value.storage : "local",
      pairingError: typeof value.pairingError === "string" ? value.pairingError : undefined };
  } catch { return null; }
}

export function readResult36(id?: string | null): Result36 | null {
  const selected = id ?? load(LATEST);
  if (!isUuid(selected)) return null;
  const key = PREFIX + selected;
  const values = [memory.get(key) ?? null];
  if (typeof window !== "undefined") {
    for (const kind of ["localStorage", "sessionStorage"] as const) {
      try { values.push(window[kind].getItem(key)); } catch { /* 사용할 수 있는 저장 경로를 계속 확인한다. */ }
    }
  }
  const candidates = values.flatMap((raw) => {
    try { const parsed = parseResult36(JSON.parse(raw ?? "null")); return parsed ? [parsed] : []; }
    catch { return []; }
  });
  return candidates.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0))[0] ?? null;
}

export function storeResult36(result: Result36): Result36 {
  const record = { ...result, savedAt: new Date().toISOString() };
  const storage = save(PREFIX + result.id, JSON.stringify(record));
  const stored = { ...record, storage };
  save(PREFIX + result.id, JSON.stringify(stored));
  save(LATEST, result.id);
  return stored;
}

function contextKey(context: string | null) { return context ?? "individual"; }

export function readPending36(context: string | null): Pending36 | null {
  try {
    const value: unknown = JSON.parse(load("wc36:pending:" + contextKey(context)) ?? "null");
    if (!isRecord(value) || !isUuid(value.submissionId) || !isUuid(value.accessToken) ||
        (value.inviteToken !== null && !isUuid(value.inviteToken)) || value.inviteToken !== context) return null;
    return { submissionId: value.submissionId, accessToken: value.accessToken,
      submission: validateSubmission(value.submission), inviteToken: value.inviteToken as string | null };
  } catch { return null; }
}

export function storePending36(pending: Pending36) {
  save("wc36:pending:" + contextKey(pending.inviteToken), JSON.stringify(pending));
}

export function clearPending36(context: string | null) { remove("wc36:pending:" + contextKey(context)); }
export function readDraft36(context: string | null): Draft36 | null {
  try {
    const value: unknown = JSON.parse(load("wc36:draft:" + contextKey(context)) ?? "null");
    if (!isRecord(value) || !isRecord(value.answers) || !isRecord(value.missingReasons) ||
        !Number.isInteger(value.index) || Number(value.index) < 0 || Number(value.index) > 35 ||
        !["intro", "questions", "review"].includes(String(value.step)) ||
        typeof value.compare !== "boolean" || typeof value.shareAlias !== "boolean" ||
        !Array.isArray(value.shareNotes) || value.shareNotes.some((x) => typeof x !== "string")) return null;
    if (Object.values(value.answers).some((x) => x !== null && (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 5))) return null;
    if (Object.values(value.missingReasons).some((x) => typeof x !== "string")) return null;
    return value as unknown as Draft36;
  } catch { return null; }
}
export function storeDraft36(context: string | null, draft: Draft36) { save("wc36:draft:" + contextKey(context), JSON.stringify(draft)); }
export function clearDraft36(context: string | null) { remove("wc36:draft:" + contextKey(context)); }

export function clearResult36(id: string) {
  remove(PREFIX + id);
  if (load(LATEST) === id) remove(LATEST);
}
