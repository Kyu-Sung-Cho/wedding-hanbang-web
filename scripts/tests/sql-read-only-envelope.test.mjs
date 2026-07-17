import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReadOnlySqlEnvelope } from "../lib/sql-read-only-envelope.mjs";

test("accepts leading comments and transaction words inside a dollar-quoted DO body", () => {
  const result = analyzeReadOnlySqlEnvelope(`
    -- READ ONLY release assertion
    /* BEGIN and COMMIT here are documentation, not transaction controls. */
    BEGIN TRANSACTION READ ONLY;
    DO $check$
    BEGIN
      IF false THEN
        RAISE EXCEPTION 'ROLLBACK is text';
      END IF;
    END
    $check$;
    ROLLBACK;
  `);

  assert.deepEqual(result, { ok: true });
});

test("rejects PostgreSQL END as a top-level transaction escape", () => {
  const result = analyzeReadOnlySqlEnvelope(`
    BEGIN TRANSACTION READ ONLY;
    END;
    SELECT true;
    ROLLBACK;
  `);

  assert.deepEqual(result, { ok: false, reason: "transaction-escape" });
});

for (const [label, statement] of [
  ["BEGIN", "BEGIN;"],
  ["START TRANSACTION", "START TRANSACTION;"],
  ["COMMIT AND CHAIN", "COMMIT AND CHAIN;"],
  ["ROLLBACK AND CHAIN", "ROLLBACK AND CHAIN;"],
  ["ABORT", "ABORT WORK;"],
  ["PREPARE TRANSACTION", "PREPARE TRANSACTION 'release-check';"],
]) {
  test(`rejects top-level ${label} transaction control`, () => {
    const result = analyzeReadOnlySqlEnvelope(`
      BEGIN TRANSACTION READ ONLY;
      ${statement}
      SELECT true;
      ROLLBACK;
    `);

    assert.deepEqual(result, { ok: false, reason: "transaction-escape" });
  });
}

for (const [label, statement] of [
  [
    "non-leading SET TRANSACTION READ WRITE",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE, READ WRITE;",
  ],
  ["SET LOCAL transaction_read_only", "SET LOCAL transaction_read_only = off;"],
  ["SET SESSION default_transaction_read_only", "SET SESSION default_transaction_read_only TO off;"],
  ["RESET transaction_read_only", "RESET transaction_read_only;"],
  ["RESET ALL", "RESET ALL;"],
]) {
  test(`rejects ${label}`, () => {
    const result = analyzeReadOnlySqlEnvelope(`
      BEGIN TRANSACTION READ ONLY;
      ${statement}
      SELECT true;
      ROLLBACK;
    `);

    assert.deepEqual(result, { ok: false, reason: "transaction-escape" });
  });
}

test("accepts CASE END, masked transaction words, and ROLLBACK TO SAVEPOINT", () => {
  const result = analyzeReadOnlySqlEnvelope(`
    BEGIN TRANSACTION READ ONLY;
    SAVEPOINT release_check;
    SELECT CASE WHEN true THEN 'COMMIT; SET TRANSACTION READ WRITE' ELSE 'ABORT' END;
    SELECT "PREPARE TRANSACTION" FROM (VALUES (true)) AS evidence("PREPARE TRANSACTION");
    /* START TRANSACTION; */
    DO $$ BEGIN RAISE NOTICE 'ROLLBACK'; END $$;
    ROLLBACK TO SAVEPOINT release_check;
    ROLLBACK;
  `);

  assert.deepEqual(result, { ok: true });
});

for (const [label, sql] of [
  ["string literal", "BEGIN TRANSACTION READ ONLY; SELECT 'unterminated; ROLLBACK;"],
  ["quoted identifier", 'BEGIN TRANSACTION READ ONLY; SELECT "unterminated; ROLLBACK;'],
  ["block comment", "BEGIN TRANSACTION READ ONLY; /* unterminated ROLLBACK;"],
  ["dollar quote", "BEGIN TRANSACTION READ ONLY; DO $$ BEGIN END; ROLLBACK;"],
]) {
  test(`fails closed on unterminated ${label}`, () => {
    const result = analyzeReadOnlySqlEnvelope(sql);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid-sql-lexing");
  });
}
