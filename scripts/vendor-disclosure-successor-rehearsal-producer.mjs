#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  produceSuccessorRehearsalReceipts,
  runForwardFixRehearsalWorker,
  runLocalIsolatedRehearsalWorker,
  SuccessorRehearsalProducerError,
} from "./lib/vendor-disclosure-successor-rehearsal-producer.mjs";
import {
  inspectSuccessorFinalizerGitCandidate,
} from "./vendor-disclosure-successor-finalizer-evidence.mjs";

const ARGUMENTS = Object.freeze([
  "--expected-commit",
  "--post-expand-backup-receipt",
  "--postcheck-receipt",
  "--probe-receipt",
  "--receipt-root",
  "--remote-ref",
]);
const MAX_STDIN_BYTES = 1024 * 1024;

function blocked(code, message = code) {
  throw new SuccessorRehearsalProducerError(code, message);
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const internal = argv.length === 1
    ? argv[0].match(/^--internal-worker=(isolated|forward-fix)$/)?.[1]
    : null;
  if (internal) return { help: false, internal };
  const values = {};
  for (const argument of argv) {
    const separator = argument.indexOf("=");
    const name = separator > 2 ? argument.slice(0, separator) : "";
    const value = separator > 2 ? argument.slice(separator + 1) : "";
    if (!ARGUMENTS.includes(name) || !value || Object.hasOwn(values, name)) {
      blocked("ARGUMENT_INVALID");
    }
    values[name] = value;
  }
  if (Object.keys(values).length !== ARGUMENTS.length
      || ARGUMENTS.some((name) => !Object.hasOwn(values, name))) {
    blocked("ARGUMENT_INVALID");
  }
  return { help: false, internal: null, values };
}

async function readStdinJson() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_STDIN_BYTES) blocked("REHEARSAL_WORKER_INPUT_INVALID");
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    blocked("REHEARSAL_WORKER_INPUT_INVALID");
  }
  return value;
}

async function internalWorker(mode, repoRoot) {
  const input = await readStdinJson();
  if (mode === "isolated") {
    return runLocalIsolatedRehearsalWorker({ repoRoot, input });
  }
  return runForwardFixRehearsalWorker({ input });
}

export async function runSuccessorRehearsalProducerCli({
  repoRoot: requestedRepoRoot,
  argv = [],
  produce = produceSuccessorRehearsalReceipts,
  inspectGitCandidate = inspectSuccessorFinalizerGitCandidate,
} = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };
  const repoRoot = resolve(requestedRepoRoot ?? resolve(import.meta.dirname, ".."));
  if (parsed.internal) {
    return { help: false, internal: parsed.internal, result: await internalWorker(parsed.internal, repoRoot) };
  }
  const values = parsed.values;
  return {
    help: false,
    internal: null,
    result: await produce({
      repoRoot,
      receiptRoot: values["--receipt-root"],
      expectedCommit: values["--expected-commit"],
      remoteRef: values["--remote-ref"],
      probeReceiptPath: values["--probe-receipt"],
      postcheckReceiptPath: values["--postcheck-receipt"],
      postExpandBackupReceiptPath: values["--post-expand-backup-receipt"],
      inspectGitCandidate,
    }),
  };
}

function usage() {
  return [
    "Produce exact successor hosted-staging and finalizer rehearsal input receipts.",
    "This runs an isolated PGlite/loopback-browser rehearsal for 300 seconds.",
    "It performs no remote command, Production mutation, or migration rollback.",
    "All input and output receipts must be absolute private paths outside Git.",
  ].join("\n");
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    const result = await runSuccessorRehearsalProducerCli({
      repoRoot: resolve(import.meta.dirname, ".."),
      argv: process.argv.slice(2),
    });
    if (result.help) {
      process.stdout.write(`${usage()}\n`);
    } else if (result.internal) {
      process.stdout.write(`${JSON.stringify(result.result)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result.result)}\n`);
    }
  } catch (error) {
    const code = error instanceof SuccessorRehearsalProducerError
      ? error.code
      : "REHEARSAL_PRODUCER_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}
