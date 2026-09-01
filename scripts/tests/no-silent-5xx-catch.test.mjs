import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * **사용자에게 5xx 를 돌려주는 자리는 우리에게도 알려야 한다.**
 *
 * 2026-09-02 실측 — API 라우트에서 5xx 를 돌려주는 `catch` 블록 143개 중
 * **119개가 아무 데도 보고하지 않았다.** 가입 실패도 그중 하나였다. 즉 낯선
 * 사람이 깨진 화면을 겪어도 팀이 알 방법이 없었다.
 *
 * `console.error` 는 Vercel 런타임 로그에만 남고 Sentry 로 가지 않는다
 * (`captureConsoleIntegration` 참조 0건). 통로는 `log.error` 하나뿐이고,
 * 그것이 `Sentry.captureException` 을 부른다(`utils/log.ts`).
 *
 * 이 검사는 그 연결이 다시 끊기는 것을 막는다. 같은 병을 이 저장소에서 세 번
 * 봤다 — 안전망 장부도, 프롬프트 절단도, 이 catch 들도 전부 "일어나도 아무도
 * 모르는" 상태였다.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const API_ROOT = join(HERE, "..", "..", "apps", "web", "src", "app", "api");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** 균형 잡힌 중괄호로 catch 블록 본문을 꺼낸다. 정규식만으로는 중첩을 못 센다. */
function catchBodies(source) {
  const bodies = [];
  const re = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    bodies.push(source.slice(re.lastIndex, i - 1));
    re.lastIndex = i;
  }
  return bodies;
}

const RETURNS_5XX = /status:\s*5\d\d/;
const REPORTS = /log\.error\s*\(|captureException\s*\(|Sentry\./;

test("5xx 를 돌려주는 catch 는 반드시 우리에게 보고한다", () => {
  const silent = [];
  for (const file of walk(API_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const body of catchBodies(source)) {
      if (!RETURNS_5XX.test(body) || REPORTS.test(body)) continue;
      silent.push(relative(API_ROOT, file).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(
    silent,
    [],
    `5xx 를 돌려주면서 아무 데도 보고하지 않는 catch 가 있다:\n  ${silent.join("\n  ")}`,
  );
});

test("검사 자체가 살아 있다 — 조용한 catch 를 실제로 찾아낸다", () => {
  // 이 검사가 통과하는 이유가 "찾는 방법이 고장 나서" 이면 안 된다.
  const sample = `
    export async function GET() {
      try { return ok(); } catch (err) {
        return NextResponse.json({ error: "x" }, { status: 500 });
      }
    }
  `;
  const bodies = catchBodies(sample);
  assert.equal(bodies.length, 1);
  assert.ok(RETURNS_5XX.test(bodies[0]), "5xx 를 못 알아본다");
  assert.ok(!REPORTS.test(bodies[0]), "보고 없음을 못 알아본다");

  const reported = sample.replace("return NextResponse", 'log.error("x", err);\n        return NextResponse');
  const reportedBody = catchBodies(reported)[0];
  assert.ok(REPORTS.test(reportedBody), "보고 있음을 못 알아본다");
});
