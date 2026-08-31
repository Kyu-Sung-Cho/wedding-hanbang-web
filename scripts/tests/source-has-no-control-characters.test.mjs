// 소스 파일에 **제어문자가 박히지 않았는가.**
//
// ## 무엇이 있었나
//
// 도구를 거쳐 파일에 정규식을 써 넣을 때 `\b` 가 **진짜 백스페이스 문자(U+0008)로**
// 박히는 사고가 이 저장소에서 **네 번** 났다(2026-08-20 두 번, 2026-08-22, 2026-08-23,
// 2026-08-29). 파이썬 문자열에서 `\b` 는 유효한 이스케이프라서, raw string 을 안 쓰면
// 조용히 변환된다. `\w`·`\s` 는 유효하지 않은 이스케이프라 그대로 남으므로 **같은 줄에서
// 어떤 것은 살고 어떤 것은 죽는다** — 그래서 눈으로는 더 안 보인다.
//
// 결과는 언제나 같다: 정규식이 **아무것도 매칭하지 않는 죽은 가드**가 되고, 초록불이
// 유지된다. 2026-08-29 에 발견된 마지막 건은 이미 커밋까지 돼 있었다 —
// `landingCtaIsMeasured.test.ts` 의 `/<Link\b…/` 가 `/<Link␈…/` 가 되어, 랜딩 퍼널
// 버튼을 계측 없이 `<Link>` 로 그려도 잡지 못하는 상태였다.
//
// ## 왜 검사로 만드나
//
// 터미널에서 `grep`·`sed` 출력만 보면 백스페이스는 **빈칸이나 아무것도 아닌 것처럼**
// 보인다. 타입 검사·린트·테스트는 전부 통과한다(주석 안이면 더더욱). 사람 눈으로
// 잡으라고 네 번 적어 뒀지만 네 번 다 놓쳤다. 기계가 볼 일이다.
//
// ## 무엇을 허용하나
//
// 탭(U+0009)·개행(U+000A)·복귀(U+000D)는 정상 공백이다. 나머지 C0 제어문자와
// U+007F 는 소스에 있을 이유가 없다. 문자열 리터럴에 정말 필요하면 `\u0008` 같은
// **이스케이프 표기**로 적으면 이 검사에 걸리지 않는다 — 그게 의도를 드러내는 방법이다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  "dist",
  "build",
  "coverage",
  ".playwright-mcp",
  ".expo",
  "ios",
  "android",
]);

const EXTENSIONS = [".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".sql", ".css"];

/** 탭·개행·복귀만 통과. 나머지 C0 과 DEL 은 금지. */
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

function describeChar(code) {
  const names = { 8: "BACKSPACE(\\b 가 문자로 박힘)", 12: "FORMFEED", 11: "VTAB", 7: "BEL", 0: "NUL", 127: "DEL" };
  return names[code] ?? `U+${code.toString(16).padStart(4, "0")}`;
}

test("소스에 제어문자가 박혀 있지 않다", () => {
  const files = walk(repoRoot, []);

  // 스캔 자체가 죽으면 이 검사는 조용히 통과한다. 분모를 먼저 못 박는다.
  assert.ok(
    files.length > 500,
    `소스 파일을 ${files.length}개만 찾았다 — 걷기가 깨졌는지 보라(스킵 목록·확장자)`,
  );

  const offenders = [];
  for (const file of files) {
    if (statSync(file).size > 4 * 1024 * 1024) continue;
    let source;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const match = FORBIDDEN.exec(source);
    if (!match) continue;
    const code = match[0].codePointAt(0);
    const line = source.slice(0, match.index).split("\n").length;
    offenders.push(`${relative(repoRoot, file)}:${line} — ${describeChar(code)}`);
  }

  assert.deepEqual(
    offenders,
    [],
    "제어문자가 소스에 박혔습니다. 대개 정규식 `\\b` 를 도구가 백스페이스로 바꾼 것이고, "
      + "그 정규식은 아무것도 매칭하지 않습니다(= 죽은 가드). 낱말 경계가 필요하면 "
      + "백슬래시-b 대신 문자 클래스(`[\\s>]` 등)를 쓰세요.\n"
      + offenders.join("\n"),
  );
});

test("검사기가 실제로 제어문자를 잡는다", () => {
  // 위 검사가 0건이라 "잡을 수 있는가"를 증명하지 못한다. 답을 아는 표본으로 잰다.
  const planted = `const re = /<Link${String.fromCharCode(8)}[\\s\\S]*?>/gu;`;
  assert.ok(FORBIDDEN.test(planted), "심어 둔 백스페이스를 못 잡았다 — 정규식이 낡았다");

  const clean = "const re = /<Link[\\s>][\\s\\S]*?>/gu;\n\t들여쓰기와 개행은 통과해야 한다\r\n";
  assert.ok(!FORBIDDEN.test(clean), "정상 공백(탭·개행·복귀)을 제어문자로 오인한다");
});
