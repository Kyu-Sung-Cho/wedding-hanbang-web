import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveIngestStateDirectory, writeJsonFile } from "../io.js";
import { loadManifest } from "../manifest.js";
import { scanSources } from "../scan.js";

test("CLI state directories stay under one ignored repository root", async (t) => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-state-root-"));
  t.after(async () => rm(repositoryRoot, { recursive: true, force: true }));

  const expectedRoot = path.join(repositoryRoot, "scripts", "ingest", ".state");
  assert.equal(
    resolveIngestStateDirectory(undefined, repositoryRoot),
    path.join(expectedRoot, "default"),
  );
  assert.equal(
    resolveIngestStateDirectory("pilot-2026q3", repositoryRoot),
    path.join(expectedRoot, "pilot-2026q3"),
  );
  assert.equal(
    resolveIngestStateDirectory(path.join(expectedRoot, "absolute-pilot"), repositoryRoot),
    path.join(expectedRoot, "absolute-pilot"),
  );
  assert.throws(
    () => resolveIngestStateDirectory("../outside", repositoryRoot),
    /ignored state root/u,
  );
  assert.throws(
    () => resolveIngestStateDirectory(repositoryRoot, repositoryRoot),
    /ignored state root/u,
  );
});

test("every later stage rejects a manifest recorded for a different state directory", async (t) => {
  const requestedState = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-state-requested-"));
  const recordedState = `${requestedState}-other`;
  t.after(async () => Promise.all([
    rm(requestedState, { recursive: true, force: true }),
    rm(recordedState, { recursive: true, force: true }),
  ]));
  await mkdir(recordedState, { recursive: true });
  await writeJsonFile(path.join(requestedState, "manifest.json"), {
    schema_version: 1,
    scanner_parser_version: "generated-test-parser",
    root_dir: path.join(requestedState, "raw"),
    state_dir: recordedState,
    scanned_at: new Date().toISOString(),
    units: [],
  });

  await assert.rejects(
    loadManifest(requestedState),
    /manifest state_dir does not match the requested state directory/u,
  );
});

test("rescan never reuses a manifest copied from another state directory", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "hanbang-ingest-state-rescan-root-"));
  const firstState = `${rootDir}-first-state`;
  const copiedState = `${rootDir}-copied-state`;
  t.after(async () => Promise.all([
    rm(rootDir, { recursive: true, force: true }),
    rm(firstState, { recursive: true, force: true }),
    rm(copiedState, { recursive: true, force: true }),
  ]));
  const regionDir = path.join(rootDir, "agency", "제주");
  await mkdir(regionDir, { recursive: true });
  await writeFile(path.join(regionDir, "sample-vendor.docx"), "generated fixture");
  await scanSources({ rootDir, stateDir: firstState, agencyDir: "agency", hallDir: "hall" });
  await mkdir(copiedState, { recursive: true });
  await writeFile(
    path.join(copiedState, "manifest.json"),
    await readFile(path.join(firstState, "manifest.json")),
  );

  await assert.rejects(
    scanSources({ rootDir, stateDir: copiedState, agencyDir: "agency", hallDir: "hall" }),
    /manifest state_dir does not match the requested state directory/u,
  );
});
