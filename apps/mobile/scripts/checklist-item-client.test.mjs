import assert from "node:assert/strict";
import test from "node:test";
import {
  ChecklistItemConflictError,
  mutateChecklistItem,
} from "../src/lib/checklistItems.ts";

const mutation = {
  categoryKey: "venue",
  itemId: "venue_01",
  done: true,
  expectedDone: false,
};

const item = { id: "venue_01", label: "예식 스타일 결정", done: true };
const progress = {
  venue: { category: "venue", status: "in_progress", checklist: [item] },
};

test("mobile checklist uses the narrow atomic API and validates its result", async () => {
  const calls = [];
  const apiFetch = async (path, options) => {
    calls.push({ path, options });
    return new globalThis.Response(JSON.stringify({
      progress,
      categoryKey: "venue",
      itemId: "venue_01",
      item,
    }), { status: 200 });
  };

  const result = await mutateChecklistItem(mutation, apiFetch);
  assert.equal(calls[0].path, "/api/journey/checklist-items");
  assert.deepEqual(JSON.parse(calls[0].options.body), mutation);
  assert.deepEqual(result.progress, progress);
});

test("mobile checklist exposes validated conflict state", async () => {
  const apiFetch = async () => new globalThis.Response(JSON.stringify({
    error: "다른 기기에서 먼저 변경했습니다.",
    progress,
  }), { status: 409 });

  await assert.rejects(mutateChecklistItem(mutation, apiFetch), (error) => {
    assert.ok(error instanceof ChecklistItemConflictError);
    assert.deepEqual(error.progress, progress);
    return true;
  });
});

test("mobile checklist rejects an unconfirmed success", async () => {
  const apiFetch = async () => new globalThis.Response(JSON.stringify({
    progress: {
      venue: { category: "venue", status: "in_progress", checklist: [{ ...item, done: false }] },
    },
    categoryKey: "venue",
    itemId: "venue_01",
    item: { ...item, done: false },
  }), { status: 200 });

  await assert.rejects(mutateChecklistItem(mutation, apiFetch), /확인/);
});
