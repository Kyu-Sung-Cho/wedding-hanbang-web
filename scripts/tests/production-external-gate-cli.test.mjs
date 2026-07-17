import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ExternalGateCollectorCliError,
  runExternalGateCollectorCli,
} from "../collect-production-external-gate-evidence.mjs";

const repoRoot = resolve(import.meta.dirname, "../..");
const manifestRelativePath =
  "supabase/release-manifests/amora-engine-v2-20260716.json";

test("external gate collector help is side-effect free", async () => {
  assert.deepEqual(
    await runExternalGateCollectorCli({
      repoRoot: "Z:\\path-that-must-not-be-read",
      argv: ["--help"],
      environment: {},
    }),
    { help: true },
  );
});

test("collector rejects secret command-line arguments before filesystem or network", async () => {
  await assert.rejects(
    runExternalGateCollectorCli({
      repoRoot: "Z:\\path-that-must-not-be-read",
      argv: [
        "--mode=vercel",
        `--expected-commit=${"a".repeat(40)}`,
        "--deployment-id=dpl_1234567890abcdefghijklmn",
        "--raw-out=C:\\outside\\raw.json",
        "--receipt-out=C:\\outside\\receipt.json",
        "--vercel-token=must-never-be-accepted",
      ],
      environment: {},
    }),
    (error) => error instanceof ExternalGateCollectorCliError
      && error.code === "ARGUMENT_INVALID"
      && !error.message.includes("must-never-be-accepted"),
  );
});

test("collector requires credentials from environment without echoing values", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "hanbang-gate-cli-"));
  t.after(async () => rm(fixtureRoot, { recursive: true, force: true }));
  const manifestPath = join(fixtureRoot, manifestRelativePath);
  await mkdir(join(fixtureRoot, "supabase/release-manifests"), {
    recursive: true,
  });
  await writeFile(
    manifestPath,
    await readFile(join(repoRoot, manifestRelativePath)),
  );
  await assert.rejects(
    runExternalGateCollectorCli({
      repoRoot: fixtureRoot,
      argv: [
        "--mode=vercel",
        `--expected-commit=${"a".repeat(40)}`,
        "--deployment-id=dpl_1234567890abcdefghijklmn",
        `--raw-out=${join(fixtureRoot, "..", "raw.json")}`,
        `--receipt-out=${join(fixtureRoot, "..", "receipt.json")}`,
      ],
      environment: {},
    }),
    (error) => error instanceof ExternalGateCollectorCliError
      && error.code === "ENVIRONMENT_REQUIRED"
      && !/Bearer|token value|password value/i.test(error.message),
  );
});

test("collector source exposes no credential-bearing CLI flags", async () => {
  const source = await readFile(
    join(repoRoot, "scripts/collect-production-external-gate-evidence.mjs"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /--(?:vercel-token|supabase-access-token|database-url|password|anon-key)/i,
  );
  assert.doesNotMatch(source, /JSON\.stringify\(result/);
});
