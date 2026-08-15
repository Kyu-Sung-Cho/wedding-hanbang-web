import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAmoraCoreCriterionDeleteRequest,
  buildAmoraCoreCriterionSaveRequest,
  normalizeAmoraCoreCriterionText,
  parseAmoraCoreCriterionDeleteRequest,
  parseAmoraCoreCriterionSaveRequest,
  parseAmoraCoreCriterionResponse,
} from "../../../../packages/shared/src/contracts/amoraCoreCriterion.mjs";
import { loadOwnerAmoraCoreCriterion } from "../lib/amoraCoreCriterion.mjs";

test("a customer criterion keeps their exact meaning while rejecting hidden or oversized text", () => {
  assert.equal(
    normalizeAmoraCoreCriterionText("  하객보다  우리 둘이 편안한  예식  "),
    "하객보다 우리 둘이 편안한 예식",
  );
  assert.equal(
    normalizeAmoraCoreCriterionText("👰‍♀️ 사진보다 대화가 편한 하루"),
    "👰‍♀️ 사진보다 대화가 편한 하루",
  );
  assert.equal(normalizeAmoraCoreCriterionText("보이지 않는\u202e기준"), null);
  assert.equal(normalizeAmoraCoreCriterionText("가".repeat(121)), null);
});

test("a criterion receipt is trusted only when every persisted field matches the exact contract", () => {
  const valid = {
    version: 1,
    criterion: {
      id: "11111111-1111-4111-8111-111111111111",
      value: "우리 둘이 편안한 하루",
      updatedAt: "2026-08-14T04:00:00.000Z",
    },
  };

  assert.deepEqual(parseAmoraCoreCriterionResponse(valid), valid);
  assert.deepEqual(
    parseAmoraCoreCriterionResponse({ version: 1, criterion: null }),
    { version: 1, criterion: null },
  );
  assert.equal(
    parseAmoraCoreCriterionResponse({ ...valid, storageStatus: "stored" }),
    null,
  );
  assert.equal(
    parseAmoraCoreCriterionResponse({
      ...valid,
      criterion: { ...valid.criterion, value: "보이지 않는\u202e기준" },
    }),
    null,
  );
});

test("saving a criterion binds the normalized value to the exact prior receipt and request", () => {
  const built = buildAmoraCoreCriterionSaveRequest({
    expectedCriterionId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    value: "  우리 둘이  편안한 하루  ",
  });

  assert.deepEqual(built, {
    version: 1,
    expectedCriterionId: "11111111-1111-4111-8111-111111111111",
    requestId: "22222222-2222-4222-8222-222222222222",
    value: "우리 둘이 편안한 하루",
  });
  assert.deepEqual(parseAmoraCoreCriterionSaveRequest(built), built);
  assert.equal(
    parseAmoraCoreCriterionSaveRequest({ ...built, expectedCriterionId: undefined }),
    null,
  );
  assert.equal(
    parseAmoraCoreCriterionSaveRequest({ ...built, value: " 다시 정리할 문장 " }),
    null,
  );
});

test("deleting a criterion requires the exact receipt being removed", () => {
  const built = buildAmoraCoreCriterionDeleteRequest({
    expectedCriterionId: "11111111-1111-4111-8111-111111111111",
    requestId: "33333333-3333-4333-8333-333333333333",
  });

  assert.deepEqual(parseAmoraCoreCriterionDeleteRequest(built), {
    version: 1,
    expectedCriterionId: "11111111-1111-4111-8111-111111111111",
    requestId: "33333333-3333-4333-8333-333333333333",
  });
  assert.equal(
    parseAmoraCoreCriterionDeleteRequest({ ...built, expectedCriterionId: null }),
    null,
  );
});

test("home distinguishes a verified empty criterion from an unavailable read", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const calls = [];
  const empty = await loadOwnerAmoraCoreCriterion(
    ownerUserId,
    async (expectedUserId, path, options) => {
      calls.push({ expectedUserId, path, options });
      return {
        ok: true,
        async json() { return { version: 1, criterion: null }; },
      };
    },
  );

  assert.deepEqual(empty, { loaded: true, criterion: null });
  assert.deepEqual(calls, [{
    expectedUserId: ownerUserId,
    path: "/api/amora/criterion",
    options: { method: "GET", headers: { Accept: "application/json" } },
  }]);
  assert.deepEqual(
    await loadOwnerAmoraCoreCriterion(ownerUserId, async () => ({
      ok: false,
      async json() { return { code: "READ_UNAVAILABLE" }; },
    })),
    { loaded: false, criterion: null },
  );
});
