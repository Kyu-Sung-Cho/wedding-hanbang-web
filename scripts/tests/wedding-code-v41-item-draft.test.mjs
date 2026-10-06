import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { lintBank } from "../lib/wedding-code-v40-bank-lint.mjs";

const root = join(import.meta.dirname, "..", "..");
const readJson = (relativePath) => JSON.parse(readFileSync(join(root, relativePath), "utf8"));
const original = readJson("docs/wedding-code/2026-09-29_v40_items.json");
const draft = readJson("docs/wedding-code/2026-10-04_v41_item_revisions.json");

const auditedIds = [
  "support.give.1",
  "support.fight.1",
  "scope.timing.1",
  "support.recover.1",
  "money.moment.1",
  "support.give.2",
  "money.check.2",
  "money.limit.3",
  "process.owner.3",
  "scope.circle.4",
];

function applyRevision(item, revision) {
  const next = { ...item };
  for (const field of ["caption", "stem", "ends"]) {
    if (revision[field] !== undefined) next[field] = revision[field];
  }
  for (const field of ["cards", "options", "entries"]) {
    if (revision[field] === undefined) continue;
    assert.ok(Array.isArray(item[field]), `${item.id}: ${field} 형식이 아님`);
    assert.equal(revision[field].length, item[field].length, `${item.id}: ${field} 개수 변경`);
    next[field] = item[field].map((old, index) => ({ ...old, text: revision[field][index] }));
  }
  return next;
}

test("v4.1 문안 후보는 v4.0과 분리되어 감사 대상 열 문항만 덮는다", () => {
  assert.equal(draft.version, "v4.1-depth-draft");
  assert.equal(draft.baseVersion, original.version);
  assert.equal(draft.status, "candidate-only-not-routed");
  assert.deepEqual(draft.revisions.map(({ id }) => id), auditedIds);
  const byId = new Map(draft.revisions.map((revision) => [revision.id, revision]));
  assert.equal(byId.size, auditedIds.length);
  const revised = original.items.map((item) => byId.has(item.id) ? applyRevision(item, byId.get(item.id)) : item);
  const result = lintBank({ ...original, items: revised });
  const affectedErrors = result.errors.filter((issue) => byId.has(issue.itemId));
  assert.deepEqual(affectedErrors, [], JSON.stringify(affectedErrors, null, 2));
  const affectedWarnings = result.warnings.filter((issue) => byId.has(issue.itemId));
  assert.deepEqual(affectedWarnings, [], JSON.stringify(affectedWarnings, null, 2));
  assert.equal(revised.length, original.items.length);
  for (const item of revised) {
    const old = original.items.find((candidate) => candidate.id === item.id);
    assert.ok(old);
    for (const field of ["id", "axis", "facet", "section", "screen", "fmt", "kind", "key"]) {
      assert.equal(item[field], old[field], `${item.id}: ${field} 변경`);
    }
    for (const field of ["cards", "options", "entries"]) {
      if (!old[field]) continue;
      assert.deepEqual(item[field].map(({ pole, strength }) => [pole, strength]), old[field].map(({ pole, strength }) => [pole, strength]), `${item.id}: 방향 변경`);
    }
  }
});
