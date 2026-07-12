import type { WeddingCodeV05Question } from "@/constants/weddingCodeV05";

export type WeddingCodeProgressStep = "intro" | "questions" | "result";

export interface WeddingCodeProgress {
  answers: Record<string, string>;
  qIndex: number;
  step: WeddingCodeProgressStep;
  expiresAt: number;
}

export function findFirstIncompleteWeddingCodeQuestionIndex(
  answers: Record<string, string>,
  questions: readonly WeddingCodeV05Question[],
): number | null {
  for (const [index, question] of questions.entries()) {
    const answer = answers[question.key];
    if (!question.options.some((option) => option.value === answer)) return index;
  }
  return null;
}

const volatileProgress = new Map<string, string>();

function browserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window[kind];
  } catch {
    return null;
  }
}

export function readWeddingCodeProgress(key: string): string | null {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      const value = browserStorage(kind)?.getItem(key);
      if (value) return value;
    } catch {
      // Continue to the next private, tab-scoped fallback.
    }
  }
  return volatileProgress.get(key) ?? null;
}

export function writeWeddingCodeProgress(
  key: string,
  value: string,
): "local" | "session" | "memory" {
  const local = browserStorage("localStorage");
  try {
    if (local) {
      local.setItem(key, value);
      volatileProgress.delete(key);
      try {
        browserStorage("sessionStorage")?.removeItem(key);
      } catch {
        // A successful persistent write is authoritative even if cleanup fails.
      }
      return "local";
    }
  } catch {
    // Fall through to session storage.
  }

  const session = browserStorage("sessionStorage");
  try {
    if (session) {
      session.setItem(key, value);
      volatileProgress.delete(key);
      return "session";
    }
  } catch {
    // Fall through to in-memory continuity for the current tab lifecycle.
  }

  volatileProgress.set(key, value);
  return "memory";
}

export function clearWeddingCodeProgress(key: string): void {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      browserStorage(kind)?.removeItem(key);
    } catch {
      // Clearing one unavailable storage must not crash or skip the others.
    }
  }
  volatileProgress.delete(key);
}

export function decodeWeddingCodeProgress(
  raw: string,
  questions: readonly WeddingCodeV05Question[],
  now = Date.now(),
): WeddingCodeProgress | null {
  let saved: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    saved = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    typeof saved.expiresAt !== "number"
    || !Number.isFinite(saved.expiresAt)
    || saved.expiresAt <= now
    || !saved.answers
    || typeof saved.answers !== "object"
    || Array.isArray(saved.answers)
  ) {
    return null;
  }

  const answers: Record<string, string> = {};
  for (const question of questions) {
    const value = (saved.answers as Record<string, unknown>)[question.key];
    if (
      typeof value === "string"
      && question.options.some((option) => option.value === value)
    ) {
      answers[question.key] = value;
    }
  }

  const requestedQIndex = typeof saved.qIndex === "number" && Number.isSafeInteger(saved.qIndex)
    ? Math.min(Math.max(saved.qIndex, 0), Math.max(questions.length - 1, 0))
    : 0;
  const firstIncompleteIndex = findFirstIncompleteWeddingCodeQuestionIndex(answers, questions);
  const qIndex = firstIncompleteIndex === null
    ? requestedQIndex
    : Math.min(requestedQIndex, firstIncompleteIndex);
  const requestedStep = saved.step;
  const step: WeddingCodeProgressStep = requestedStep === "questions"
    ? "questions"
    : requestedStep === "result" && firstIncompleteIndex === null
      ? "result"
      : "intro";

  return { answers, qIndex, step, expiresAt: saved.expiresAt };
}
