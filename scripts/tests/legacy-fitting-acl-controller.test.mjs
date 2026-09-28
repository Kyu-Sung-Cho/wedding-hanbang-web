import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runProductionRelease } from "../lib/supabase-production-release-controller.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const commit = "a".repeat(40);
const project = "slrtobkksjmxgzatjyqb";

test("registered CLI rejects malformed fitting modes before credentials, source or receipt", () => {
  const directory = mkdtempSync(join(tmpdir(), "fitting-acl-controller-"));
  const receipt = join(directory, "must-not-exist.jsonl");
  const valid = ["--legacy-fitting-acl", "--inspect", `--expected-commit=${commit}`,
    `--project-ref=${project}`, `--receipt-out=${receipt}`,
    `--confirm-production=legacy-fitting-acl-20260928:${project}:inspect:${commit}`];
  const cases = [
    ["--legacy-fitting-acl"],
    [...valid, "--apply"],
    [...valid, "--legacy-fitting-acl"],
    [...valid, `--project-ref=${project}`],
    [...valid, "--rollback"],
    [...valid, "--sql-file=untrusted.sql"],
    [...valid, "--account-deletion-audit-nullability"],
    ["--account-deletion-audit-nullability", ...valid],
    [...valid, "--profile-avatar"],
    [...valid, "--amora-runtime-hotfix"],
    valid.filter(arg => !arg.startsWith("--confirm-production=")),
    valid.map(arg => arg.startsWith("--project-ref=") ? "--project-ref=wrongproject" : arg),
  ];
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:SUPABASE_|NODE_OPTIONS$|NODE_PATH$|GIT_)/.test(key)) delete environment[key];
  }
  try {
    for (const argv of cases) {
      const result = spawnSync(process.execPath, ["scripts/supabase-production-release.mjs", ...argv], {
        cwd: repoRoot, env: environment, encoding: "utf8", windowsHide: true, timeout: 20_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /SUPABASE_PRODUCTION_RELEASE_BLOCKED \[FITTING_ACL_(?:ARGUMENT_INVALID|ARGUMENT_DUPLICATE|CONFIRMATION_REQUIRED)\]/);
      assert.doesNotMatch(result.stderr, /CREDENTIAL|SOURCE_NOT_CLEAN|UNEXPECTED/);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(receipt), false);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fitting dispatch keeps the controller environment override guard", async () => {
  const original = process.env.SUPABASE_CLI_BINARY_OVERRIDE;
  process.env.SUPABASE_CLI_BINARY_OVERRIDE = "untrusted-executable";
  try {
    await assert.rejects(runProductionRelease({ repoRoot, argv: ["--legacy-fitting-acl"] }),
      { code: "EXECUTION_ENVIRONMENT_UNSAFE" });
  } finally {
    if (original === undefined) delete process.env.SUPABASE_CLI_BINARY_OVERRIDE;
    else process.env.SUPABASE_CLI_BINARY_OVERRIDE = original;
  }
});
