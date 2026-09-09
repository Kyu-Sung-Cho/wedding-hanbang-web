import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

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

function bindsName(binding, expected) {
  if (ts.isIdentifier(binding)) return binding.text === expected;
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
    return binding.elements.some(element => ts.isBindingElement(element) && bindsName(element.name, expected));
  }
  return false;
}

// 이 라우트는 고객 원문을 받지 않는 전용 로거로 보고한다. 이름만 같은 함수나
// 조건부 호출을 허용하지 않고, 실제 GET의 import → const → catch 직접 호출을 확인한다.
function reportsThroughRetentionLogger(apiFile, source, body) {
  if (apiFile !== "cron/ai-log-retention/route.ts") return false;
  const ast = ts.createSourceFile(apiFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ast.parseDiagnostics.length > 0) return false;
  const imported = ast.statements.some(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === "@/lib/compliance/retentionRunLog"
    && !statement.importClause?.isTypeOnly
    && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(element => !element.isTypeOnly
      && !element.propertyName && element.name.text === "createRetentionRunLog"));
  if (!imported) return false;
  const get = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === "GET");
  if (!get?.body) return false;
  if (get.parameters.some(parameter => bindsName(parameter.name, "createRetentionRunLog"))
    || get.body.statements.some(statement => ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some(declaration => bindsName(declaration.name, "createRetentionRunLog"))
      || (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === "createRetentionRunLog")) return false;
  const recorder = get.body.statements.some(statement => ts.isVariableStatement(statement)
    && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
    && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name)
      && declaration.name.text === "recordRun" && declaration.initializer && ts.isCallExpression(declaration.initializer)
      && ts.isIdentifier(declaration.initializer.expression)
      && declaration.initializer.expression.text === "createRetentionRunLog"
      && declaration.initializer.arguments.length === 1
      && declaration.initializer.arguments[0].getText(ast) === "enabled"));
  if (!recorder) return false;
  const clause = get.body.statements.filter(ts.isTryStatement).map(statement => statement.catchClause)
    .find(caught => caught && source.slice(caught.block.getStart(ast) + 1, caught.block.end - 1).trim() === body.trim());
  if (!clause || clause.variableDeclaration && bindsName(clause.variableDeclaration.name, "recordRun")) return false;
  if (clause.block.statements.some(statement => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(declaration => bindsName(declaration.name, "recordRun"))
    || (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === "recordRun")) return false;
  const isFailure = expression => ts.isStringLiteral(expression)
    ? ["failed", "partial"].includes(expression.text)
    : ts.isConditionalExpression(expression) && isFailure(expression.whenTrue) && isFailure(expression.whenFalse);
  return clause.block.statements.slice(0, 1).some(statement => {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return false;
    const call = statement.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== "recordRun" || call.arguments.length !== 1) return false;
    const event = call.arguments[0];
    if (!ts.isObjectLiteralExpression(event) || event.properties.some(ts.isSpreadAssignment)) return false;
    const statuses = event.properties.filter(property => property.name?.getText(ast) === "status");
    return statuses.length === 1 && ts.isPropertyAssignment(statuses[0]) && isFailure(statuses[0].initializer);
  });
}

test("5xx 를 돌려주는 catch 는 반드시 우리에게 보고한다", () => {
  const silent = [];
  for (const file of walk(API_ROOT)) {
    const source = readFileSync(file, "utf8");
    for (const body of catchBodies(source)) {
      const apiFile = relative(API_ROOT, file).replace(/\\/g, "/");
      if (!RETURNS_5XX.test(body) || REPORTS.test(body) || reportsThroughRetentionLogger(apiFile, source, body)) continue;
      silent.push(apiFile);
    }
  }
  assert.deepEqual(
    silent,
    [],
    `5xx 를 돌려주면서 아무 데도 보고하지 않는 catch 가 있다:\n  ${silent.join("\n  ")}`,
  );
});

test("retention 위임은 정확한 import·factory·무조건 실패 보고만 허용한다", () => {
  const apiFile = "cron/ai-log-retention/route.ts";
  const source = readFileSync(join(API_ROOT, apiFile), "utf8").replace(/\r\n?/g, "\n");
  const recognizes = (candidate, file = apiFile) => catchBodies(candidate)
    .some(body => RETURNS_5XX.test(body) && reportsThroughRetentionLogger(file, candidate, body));
  assert.equal(recognizes(source), true);
  assert.equal(recognizes(source.replace(/\n/g, "\r\n")), true);
  for (const candidate of [
    source.replace('"@/lib/compliance/retentionRunLog"', '"@/lib/unrelated"'),
    source.replace("const recordRun = createRetentionRunLog(enabled)", "const recordRun = unrelated(enabled)"),
    source.replace('status: redacted === null ? "failed" : "partial"', 'status: "completed"'),
    source.replace('status: redacted === null ? "failed" : "partial"', 'status: redacted === null ? "failed" : "completed"'),
    source.replace("} catch {\n    recordRun({", "} catch {\n    if (false) recordRun({"),
    source.replace("} catch {\n    recordRun({", "} catch {\n    const recordRun = () => {};\n    recordRun({"),
    source.replace("const recordRun = createRetentionRunLog(enabled)", "const createRetentionRunLog = () => () => {};\n  const recordRun = createRetentionRunLog(enabled)"),
    source.replace("const recordRun = createRetentionRunLog(enabled)", "function createRetentionRunLog() { return () => {}; }\n  const recordRun = createRetentionRunLog(enabled)"),
    source.replace("const recordRun = createRetentionRunLog(enabled)", "const { createRetentionRunLog } = { createRetentionRunLog: () => () => {} };\n  const recordRun = createRetentionRunLog(enabled)"),
    source.replace("const recordRun = createRetentionRunLog(enabled)", "const [createRetentionRunLog] = [() => () => {}];\n  const recordRun = createRetentionRunLog(enabled)"),
    source.replace("redacted: redacted ?? undefined,\n    });", "redacted: redacted ?? undefined,\n    });\n    function recordRun() {}"),
  ]) {
    assert.notEqual(candidate, source, "음성 회귀가 실제 소스를 바꿔야 한다");
    assert.equal(recognizes(candidate), false);
  }
  assert.equal(recognizes(source, "unrelated/route.ts"), false);
});

function executeRetentionFailureReports(source, helperPath) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const reported = [];
  const module = { exports: {} };
  runInNewContext(compiled, {
    module, exports: module.exports, process: { env: {} }, console: { log: () => {} },
    require: name => {
      if (name === "node:crypto") return { randomUUID: () => "fixture-run-id" };
      if (name === "@/utils/log") return { log: { error: (...args) => reported.push(args) } };
      throw new Error(`Unexpected retention logger dependency: ${name}`);
    },
  }, { filename: helperPath, timeout: 1000 });
  const recordRun = module.exports.createRetentionRunLog(true);
  for (const status of ["failed", "partial"]) recordRun({ status, failedStep: "ai_interactions" });
  return reported;
}

test("실제 retention 로거는 위임된 failed·partial 모두 log.error로 보고한다", () => {
  const helperPath = join(API_ROOT, "..", "..", "lib", "compliance", "retentionRunLog.ts");
  const source = readFileSync(helperPath, "utf8");
  const reported = executeRetentionFailureReports(source, helperPath);
  assert.equal(reported.length, 2);
  for (const [scope, error] of reported) {
    assert.equal(scope, "api/cron/ai-log-retention");
    assert.equal(error.message, "Retention run failed at ai_interactions");
  }
  const noOp = source.replace("log.error(", "(() => {})(");
  assert.notEqual(noOp, source);
  assert.equal(executeRetentionFailureReports(noOp, helperPath).length, 0,
    "실제 오류 보고를 no-op으로 바꾸면 보고 없음으로 판정해야 한다");
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
