import { run } from "node:test";
import { tap } from "node:test/reporters";
import { once } from "node:events";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRepositoryTestSchedule, parseRepositoryTestMode } from "./run-repository-tests.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const COUNT_KEYS = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites", "topLevel"];
const fail = code => { throw new Error(code); };
function validSummary(value) {
  return value && typeof value.success === "boolean" && value.counts
    && COUNT_KEYS.every(key => Number.isSafeInteger(value.counts[key]) && value.counts[key] >= 0)
    && value.counts.tests > 0;
}

/** 실제 API event를 전부 소비한 뒤 누락된 파일·빈 요약·재귀 생략을 성공으로 처리하지 않는다. */
export function createRepositoryTestAudit(files) {
  if (!Array.isArray(files) || files.length === 0 || files.some(file => typeof file !== "string" || !isAbsolute(file))
      || new Set(files).size !== files.length) fail("REPOSITORY_TEST_SCHEDULE_INVALID");
  const expected = new Set(files), enqueued = [], dequeued = [], summaries = new Map();
  let rootSummary, rootSummaries = 0, error = false, failed = false, invalid = false;
  return Object.freeze({
    observe(type, data) {
      if (type === "error") { error = true; return; }
      if (type === "test:fail" && !data?.todo) failed = true;
      if ((type === "test:enqueue" || type === "test:dequeue") && data?.nesting === 0
          && typeof data.name === "string" && expected.has(resolve(data.name))) {
        (type === "test:enqueue" ? enqueued : dequeued).push(resolve(data.name));
      }
      if (type !== "test:summary") return;
      if (!validSummary(data)) { invalid = true; return; }
      if (data.file === undefined) { rootSummaries++; rootSummary = data; }
      else if (typeof data.file !== "string" || !expected.has(resolve(data.file)) || summaries.has(resolve(data.file))) invalid = true;
      else summaries.set(resolve(data.file), data);
    },
    complete() {
      if (invalid || error || rootSummaries !== 1 || !rootSummary || summaries.size !== files.length
          || enqueued.length !== files.length || dequeued.length !== files.length
          || enqueued.some((file, i) => file !== files[i]) || new Set(dequeued).size !== files.length)
        fail("REPOSITORY_TEST_RESULTS_INCOMPLETE");
      for (const key of COUNT_KEYS) if (rootSummary.counts[key] !== [...summaries.values()].reduce((sum, item) => sum + item.counts[key], 0))
        fail("REPOSITORY_TEST_RESULTS_INCONSISTENT");
      return Object.freeze({ files: files.length, concurrency: 2, counts: Object.freeze({ ...rootSummary.counts }),
        success: rootSummary.success && !failed && rootSummary.counts.failed === 0 && rootSummary.counts.cancelled === 0
          && [...summaries.values()].every(item => item.success) });
    },
  });
}

export async function runRepositoryTestWorker() {
  if (process.env.NODE_TEST_CONTEXT !== undefined || process.execArgv.length !== 0)
    fail("REPOSITORY_TEST_RECURSIVE_OR_OPTIONS_FORBIDDEN");
  if (resolve(process.cwd()) !== resolve(ROOT)) fail("REPOSITORY_TEST_ROOT_INVALID");
  const mode = parseRepositoryTestMode(process.argv.slice(2));
  const files = buildRepositoryTestSchedule({ repoRoot: ROOT, mode });
  const audit = createRepositoryTestAudit(files);
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try {
    const stream = run({ files, concurrency: 2, isolation: "process", argv: [], execArgv: [], signal: controller.signal, setup(events) {
      for (const type of ["test:enqueue", "test:dequeue", "test:fail", "test:summary", "error"])
        events.on(type, data => audit.observe(type, data));
    } });
    // 공식 TAP reporter가 완료될 때까지 소비한다. 별도 subset/phase/forceExit는 없다.
    for await (const chunk of stream.compose(tap)) if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
    const result = audit.complete();
    console.log(`# repository file integrity ${result.files}/${files.length}; concurrency=${result.concurrency}`);
    return result.success && !controller.signal.aborted ? 0 : 1;
  } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runRepositoryTestWorker(); }
  catch (error) {
    console.error(/^REPOSITORY_TEST_[A-Z_]+$/.test(error?.message ?? "") ? error.message : "REPOSITORY_TEST_WORKER_FAILED");
    process.exitCode = 1;
  }
}
