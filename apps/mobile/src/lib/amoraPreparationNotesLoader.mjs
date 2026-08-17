/* global AbortController, clearTimeout, setTimeout */

import {
  AMORA_PREPARATION_NOTES_PAGE_LIMIT,
  validateAmoraPreparationNotesPageResponse,
} from "@hanbang/shared/amora-preparation-topic-message-ref";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const DEADLINE = Object.freeze({ kind: "deadline" });
const NOTES_CURSOR_RE = /^np1\.[A-Za-z0-9_-]{16,512}$/u;
const UNSAFE_QUERY_RE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export class AmoraPreparationNotesLoadError extends Error {
  constructor(code) {
    super(code);
    this.name = "AmoraPreparationNotesLoadError";
    this.code = code;
  }
}

function isAbortSignal(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.aborted === "boolean"
    && typeof value.addEventListener === "function"
    && typeof value.removeEventListener === "function";
}

function assertCurrent(isCurrent) {
  if (typeof isCurrent !== "function" || !isCurrent()) {
    throw new AmoraPreparationNotesLoadError("stale_context");
  }
}

async function readPayload(response) {
  if (!response?.ok || typeof response.json !== "function") {
    throw new AmoraPreparationNotesLoadError("read_failed");
  }
  try {
    return await response.json();
  } catch {
    throw new AmoraPreparationNotesLoadError("read_failed");
  }
}

function lanePromise(operation, deadlinePromise, isCurrent) {
  const operationPromise = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: "loaded", value }),
      (error) => ({ kind: "error", error }),
    );
  return Promise.race([operationPromise, deadlinePromise]).then((outcome) => {
    assertCurrent(isCurrent);
    if (outcome === DEADLINE) return { state: "unavailable", value: null };
    if (outcome.kind === "error") {
      if (outcome.error instanceof AmoraPreparationNotesLoadError
        && outcome.error.code === "stale_context") {
        throw outcome.error;
      }
      return { state: "unavailable", value: null };
    }
    return { state: "loaded", value: outcome.value };
  });
}

export function normalizeAmoraPreparationNotesQuery(value) {
  if (typeof value !== "string" || Array.from(value).length > 120) return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return UNSAFE_QUERY_RE.test(normalized) ? null : normalized;
}

function notesPagePath(query, cursor) {
  let path = `/api/amora/preparation-topic-message-refs?view=notes&limit=${AMORA_PREPARATION_NOTES_PAGE_LIMIT}`;
  if (query !== "") path += `&q=${encodeURIComponent(query)}`;
  if (cursor !== null) path += `&cursor=${encodeURIComponent(cursor)}`;
  return path;
}

export async function loadAmoraPreparationNotesMessagePage(options) {
  const {
    ownerId,
    coupleId,
    query: rawQuery,
    cursor = null,
    apiFetch,
    isCurrent,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options ?? {};
  const query = normalizeAmoraPreparationNotesQuery(rawQuery);
  if (
    typeof ownerId !== "string"
    || !UUID_RE.test(ownerId)
    || typeof coupleId !== "string"
    || !UUID_RE.test(coupleId)
    || query === null
    || (cursor !== null && (typeof cursor !== "string" || !NOTES_CURSOR_RE.test(cursor)))
    || typeof apiFetch !== "function"
    || typeof isCurrent !== "function"
    || (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_TIMEOUT_MS
  ) throw new AmoraPreparationNotesLoadError("invalid_request");

  assertCurrent(isCurrent);
  if (signal?.aborted) throw new AmoraPreparationNotesLoadError("cancelled");
  const controller = new AbortController();
  let cancelForCaller;
  let timeoutHandle;
  const deadline = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(DEADLINE);
    }, timeoutMs);
  });
  if (signal) {
    cancelForCaller = () => controller.abort();
    signal.addEventListener("abort", cancelForCaller, { once: true });
  }

  try {
    const operation = Promise.resolve().then(async () => {
      assertCurrent(isCurrent);
      const response = await apiFetch(notesPagePath(query, cursor), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      assertCurrent(isCurrent);
      const payload = await readPayload(response);
      assertCurrent(isCurrent);
      const validated = validateAmoraPreparationNotesPageResponse(
        payload,
        ownerId,
        coupleId,
      );
      if (!validated.ok) throw new AmoraPreparationNotesLoadError("read_failed");
      return validated.value;
    }).then(
      (value) => ({ kind: "loaded", value }),
      (error) => ({ kind: "error", error }),
    );
    const outcome = await Promise.race([operation, deadline]);
    assertCurrent(isCurrent);
    if (signal?.aborted) throw new AmoraPreparationNotesLoadError("cancelled");
    if (outcome === DEADLINE) throw new AmoraPreparationNotesLoadError("timeout");
    if (outcome.kind === "error") {
      if (outcome.error instanceof AmoraPreparationNotesLoadError) throw outcome.error;
      throw new AmoraPreparationNotesLoadError("read_failed");
    }
    return outcome.value;
  } finally {
    clearTimeout(timeoutHandle);
    if (signal && cancelForCaller) signal.removeEventListener("abort", cancelForCaller);
  }
}

export async function loadAmoraPreparationNotesSources(options) {
  const {
    ownerId,
    coupleId,
    apiFetch,
    readOpenActions,
    isCurrent,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options ?? {};
  if (
    typeof ownerId !== "string"
    || !UUID_RE.test(ownerId)
    || typeof coupleId !== "string"
    || !UUID_RE.test(coupleId)
    || typeof apiFetch !== "function"
    || typeof readOpenActions !== "function"
    || typeof isCurrent !== "function"
    || (signal !== undefined && !isAbortSignal(signal))
    || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > MAX_TIMEOUT_MS
  ) throw new AmoraPreparationNotesLoadError("invalid_request");

  assertCurrent(isCurrent);
  if (signal?.aborted) throw new AmoraPreparationNotesLoadError("cancelled");

  const controller = new AbortController();
  let cancelForCaller;
  let deadlinePromiseCleanup = () => {};
  const deadlinePromise = new Promise((resolve) => {
    const timeoutHandle = setTimeout(() => {
      controller.abort();
      resolve(DEADLINE);
    }, timeoutMs);
    deadlinePromiseCleanup = () => clearTimeout(timeoutHandle);
  });
  if (signal) {
    cancelForCaller = () => controller.abort();
    signal.addEventListener("abort", cancelForCaller, { once: true });
  }

  const apiLane = (path) => lanePromise(async () => {
    assertCurrent(isCurrent);
    const response = await apiFetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    assertCurrent(isCurrent);
    const payload = await readPayload(response);
    assertCurrent(isCurrent);
    return payload;
  }, deadlinePromise, isCurrent);

  try {
    const [messageReferences, ownerCriterion, coupleCriterion, openActions] = await Promise.all([
      apiLane(`/api/amora/preparation-topic-message-refs?view=notes&limit=${AMORA_PREPARATION_NOTES_PAGE_LIMIT}`),
      apiLane("/api/amora/criterion"),
      apiLane("/api/amora/couple-criterion"),
      lanePromise(async () => {
        assertCurrent(isCurrent);
        const value = await readOpenActions({
          ownerId,
          coupleId,
          signal: controller.signal,
        });
        assertCurrent(isCurrent);
        if (!Array.isArray(value)) throw new AmoraPreparationNotesLoadError("read_failed");
        return value;
      }, deadlinePromise, isCurrent),
    ]);
    assertCurrent(isCurrent);
    if (signal?.aborted) throw new AmoraPreparationNotesLoadError("cancelled");
    return Object.freeze({
      messageReferenceCollection: messageReferences.value,
      messageReferenceReadState: messageReferences.state,
      ownerCriterionResponse: ownerCriterion.value,
      ownerCriterionReadState: ownerCriterion.state,
      coupleCriterionResponse: coupleCriterion.value,
      coupleCriterionReadState: coupleCriterion.state,
      openActions: openActions.value,
      actionReadState: openActions.state,
    });
  } finally {
    deadlinePromiseCleanup();
    if (signal && cancelForCaller) {
      signal.removeEventListener("abort", cancelForCaller);
    }
  }
}
