import assert from "node:assert/strict";
import test from "node:test";

import {
  AmoraPreparationNotesLoadError,
  loadAmoraPreparationNotesMessagePage,
  loadAmoraPreparationNotesSources,
} from "../lib/amoraPreparationNotesLoader.mjs";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const COUPLE_ID = "20000000-0000-4000-8000-000000000002";
const CURSOR = "np1.eyJzbmFwc2hvdEF0IjoiMjAyNi0wOC0xOFQwODowMDowMC4wMDBaIn0";

function notesPage(overrides = {}) {
  return {
    version: 1,
    state: "ready",
    recipientUserId: OWNER_ID,
    coupleId: COUPLE_ID,
    snapshotAt: "2026-08-18T08:00:00.000Z",
    entries: [],
    nextCursor: null,
    partial: false,
    ...overrides,
  };
}

function response(body, ok = true) {
  return {
    ok,
    async json() { return body; },
  };
}

test("notes sources load independently under one exact owner/couple fence", async () => {
  const calls = [];
  const result = await loadAmoraPreparationNotesSources({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    apiFetch: async (path) => {
      calls.push(path);
      if (path === "/api/amora/preparation-topic-message-refs?view=notes&limit=24") {
        return response({ kind: "message-refs" });
      }
      if (path === "/api/amora/criterion") {
        return response({ kind: "owner-criterion" });
      }
      if (path === "/api/amora/couple-criterion") {
        return response({ kind: "couple-criterion" });
      }
      return response(null, false);
    },
    readOpenActions: async () => [{ id: "one-action" }],
    isCurrent: () => true,
    timeoutMs: 100,
  });

  assert.deepEqual(calls.sort(), [
    "/api/amora/couple-criterion",
    "/api/amora/criterion",
    "/api/amora/preparation-topic-message-refs?view=notes&limit=24",
  ]);
  assert.deepEqual(result, {
    messageReferenceCollection: { kind: "message-refs" },
    messageReferenceReadState: "loaded",
    ownerCriterionResponse: { kind: "owner-criterion" },
    ownerCriterionReadState: "loaded",
    coupleCriterionResponse: { kind: "couple-criterion" },
    coupleCriterionReadState: "loaded",
    openActions: [{ id: "one-action" }],
    actionReadState: "loaded",
  });
});

test("one notes page normalizes the question search and keeps the cursor opaque", async () => {
  const calls = [];
  const page = notesPage({ nextCursor: CURSOR });
  const loaded = await loadAmoraPreparationNotesMessagePage({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    query: "  예식장   계약  ",
    cursor: CURSOR,
    apiFetch: async (path) => {
      calls.push(path);
      return response(page);
    },
    isCurrent: () => true,
    timeoutMs: 100,
  });

  assert.deepEqual(loaded, page);
  assert.deepEqual(calls, [
    `/api/amora/preparation-topic-message-refs?view=notes&limit=24&q=${encodeURIComponent("예식장 계약")}&cursor=${encodeURIComponent(CURSOR)}`,
  ]);

  await assert.rejects(
    loadAmoraPreparationNotesMessagePage({
      ownerId: OWNER_ID,
      coupleId: COUPLE_ID,
      query: "",
      cursor: null,
      apiFetch: async () => response(notesPage({ recipientUserId: COUPLE_ID })),
      isCurrent: () => true,
      timeoutMs: 100,
    }),
    (error) => error instanceof AmoraPreparationNotesLoadError
      && error.code === "read_failed",
  );
});

test("one failed source is unavailable without discarding the other completed lanes", async () => {
  const result = await loadAmoraPreparationNotesSources({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    apiFetch: async (path) => {
      if (path === "/api/amora/criterion") throw new Error("offline");
      return response({ path });
    },
    readOpenActions: async () => [],
    isCurrent: () => true,
    timeoutMs: 100,
  });

  assert.equal(result.messageReferenceReadState, "loaded");
  assert.equal(result.ownerCriterionReadState, "unavailable");
  assert.equal(result.ownerCriterionResponse, null);
  assert.equal(result.coupleCriterionReadState, "loaded");
  assert.equal(result.actionReadState, "loaded");
});

test("an identity change after any source read rejects the whole snapshot", async () => {
  let current = true;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const loading = loadAmoraPreparationNotesSources({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    apiFetch: async () => {
      await pending;
      return response({});
    },
    readOpenActions: async () => {
      await pending;
      return [];
    },
    isCurrent: () => current,
    timeoutMs: 100,
  });
  current = false;
  release();

  await assert.rejects(loading, (error) => (
    error instanceof AmoraPreparationNotesLoadError
    && error.code === "stale_context"
  ));
});

test("the shared deadline returns unavailable lanes instead of waiting on hung readers", async () => {
  const never = new Promise(() => {});
  const result = await loadAmoraPreparationNotesSources({
    ownerId: OWNER_ID,
    coupleId: COUPLE_ID,
    apiFetch: async () => never,
    readOpenActions: async () => never,
    isCurrent: () => true,
    timeoutMs: 10,
  });

  assert.equal(result.messageReferenceReadState, "unavailable");
  assert.equal(result.ownerCriterionReadState, "unavailable");
  assert.equal(result.coupleCriterionReadState, "unavailable");
  assert.equal(result.actionReadState, "unavailable");
});
