#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSuccessorRemoteBaselineReportMatchesContract,
  buildReadOnlyMigrationListArguments,
  buildSuccessorRemoteBaselineReport,
} from "./lib/supabase-successor-remote-baseline.mjs";
import { validateSuccessorReleaseContract } from "./lib/supabase-successor-release-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDirectory, "..");

function fail(message) {
  console.error(`SUPABASE_SUCCESSOR_BASELINE_BLOCKED: ${message}`);
  process.exitCode = 1;
}

function readBoundedText(path, label, maximumBytes) {
  const metadata = existsSync(path) ? lstatSync(path) : null;
  if (!metadata?.isFile()
      || metadata.isSymbolicLink()
      || metadata.size < 1
      || metadata.size > maximumBytes) {
    throw new Error(`${label} must be one bounded regular file`);
  }
  return readFileSync(path, "utf8");
}

function runMigrationList() {
  const wrapperPath = join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
  const metadata = existsSync(wrapperPath) ? lstatSync(wrapperPath) : null;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error("pinned Supabase CLI is not installed in this repository");
  }
  const result = spawnSync(
    process.execPath,
    buildReadOnlyMigrationListArguments({ wrapperPath, repoRoot }),
    {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 120_000,
      windowsHide: true,
    },
  );
  if (result.error) {
    throw new Error(`Supabase migration list could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error("Supabase migration list failed; no database write was attempted");
  }
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

try {
  if (process.argv.length !== 2) {
    throw new Error("this read-only command accepts no arguments");
  }
  const successorContract = validateSuccessorReleaseContract({ repoRoot });
  const linkedProjectRef = readBoundedText(
    join(repoRoot, "supabase", ".temp", "project-ref"),
    "linked Supabase project reference",
    256,
  ).trim();
  const report = buildSuccessorRemoteBaselineReport({
    manifest: successorContract.manifest,
    linkedProjectRef,
    migrationListOutput: runMigrationList(),
  });
  console.log(JSON.stringify(
    assertSuccessorRemoteBaselineReportMatchesContract({
      report,
      remoteBaseline: successorContract.remoteBaseline,
    }),
    null,
    2,
  ));
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown read-only baseline audit failure");
}
