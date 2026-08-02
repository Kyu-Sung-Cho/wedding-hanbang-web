import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  ExternalGateCollectorCliError,
  runExternalGateCollectorCli,
} from "../collect-production-external-gate-evidence.mjs";
import {
  allowlistedOperationalStatus,
  operationalFailureLine,
  sanitizeOperationalDiagnostic,
  trustedOperationalErrorCode,
} from "../lib/operational-log-safety.mjs";

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

test("operational diagnostics redact secrets, URL queries, paths, and linkable identifiers", () => {
  const diagnostic = sanitizeOperationalDiagnostic([
    "authorization=Bearer must-never-print",
    "https://example.com/path?token=must-never-print#fragment",
    "person@example.com",
    "12345678-1234-4234-8234-123456789abc",
    "abcdefghijklmnopqrst",
    "C:\\private\\receipt.json",
    "a".repeat(64),
  ].join(" "));
  assert.doesNotMatch(
    diagnostic,
    /must-never|token=|fragment|person@example\.com|12345678|abcdefghijklmnopqrst|C:\\private|a{64}/u,
  );
  assert.match(diagnostic, /redacted/u);
});

test("operational codes require a trusted error type and statuses require an exact allowlist", () => {
  class TrustedFixtureError extends Error {
    constructor(code) {
      super("Bearer must-never-print");
      this.code = code;
    }
  }
  const trusted = new TrustedFixtureError("FIXTURE_BLOCKED");
  assert.equal(
    trustedOperationalErrorCode(trusted, TrustedFixtureError, "UNEXPECTED"),
    "FIXTURE_BLOCKED",
  );
  assert.equal(
    trustedOperationalErrorCode(
      new TrustedFixtureError("BAD\nBearer must-never-print"),
      TrustedFixtureError,
      "UNEXPECTED",
    ),
    "UNEXPECTED",
  );
  assert.equal(
    operationalFailureLine("FIXTURE", trusted, TrustedFixtureError, "UNEXPECTED"),
    "FIXTURE [FIXTURE_BLOCKED]\n",
  );
  assert.doesNotMatch(
    operationalFailureLine("FIXTURE", trusted, TrustedFixtureError, "UNEXPECTED"),
    /must-never|Bearer/u,
  );
  assert.equal(
    allowlistedOperationalStatus("verified", new Set(["verified"])),
    "verified",
  );
  assert.equal(
    allowlistedOperationalStatus("private-deployment-id", new Set(["verified"])),
    "unexpected_status",
  );
});

test("release and evidence CLI boundaries never print whole results or raw exception text", async () => {
  const scriptsRoot = join(repoRoot, "scripts");
  const wrappers = [
    "capture-post-push-platform-evidence.mjs",
    "capture-production-write-fence-evidence.mjs",
    "capture-storage-signed-upload-drain-evidence.mjs",
    "collect-production-external-gate-evidence.mjs",
    "finalize-production-write-fence.mjs",
    "supabase-production-release.mjs",
    "vendor-public-rls-probe.mjs",
  ];
  for (const file of wrappers) {
    const source = await readFile(join(scriptsRoot, file), "utf8");
    assert.doesNotMatch(source, /JSON\.stringify\(result/u, file);
    assert.doesNotMatch(source, /error\.stack|String\(error\)/u, file);
    assert.doesNotMatch(
      source,
      /(?:stdout|stderr)\.write\([\s\S]{0,180}error\.message|console\.error\([\s\S]{0,120}error\.message/u,
      file,
    );
    assert.doesNotMatch(source, /\$\{result\.(?:kind|projectRef|deploymentId|receiptPath)/u, file);
  }

  const fence = await readFile(join(scriptsRoot, "supabase-release-fence.mjs"), "utf8");
  assert.match(fence, /sanitizeReleaseFenceDiagnostic\(message\)/u);
  assert.doesNotMatch(fence, /error\.message|error\.stack|String\(error\)/u);
  assert.doesNotMatch(fence, /Supabase dry-run failed\\n\$\{output\}/u);
  assert.doesNotMatch(fence, /Remote pending set verified for \$\{linkedRef\}/u);
});
