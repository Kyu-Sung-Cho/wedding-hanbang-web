#!/usr/bin/env node
/**
 * 웨딩코드 4.0 문항 은행 검사 명령.
 *
 *   node scripts/wedding-code-v40-bank-lint.mjs [--file <은행.json>] [--allow-placeholder] [--json] [--verbose]
 *
 * 기본 파일은 docs/wedding-code/2026-09-29_v40_items.json. 규칙은 scripts/lib/wedding-code-v40-bank-lint.mjs 의 RULES 참고.
 * 종료 코드: 0 통과, 1 오류가 있음, 2 사용법이나 파일 읽기 실패.
 *
 * --allow-placeholder 는 placeholder 표시가 남은 은행이 문구 규칙(content)을 통과한 것으로 치게 한다.
 * 구조(structure)와 균형(balance) 규칙은 이 옵션과 상관없이 항상 오류다.
 */
import { readFileSync } from "node:fs";
import { formatReport, lintBank } from "./lib/wedding-code-v40-bank-lint.mjs";
import { DEFAULT_BANK_PATH } from "./lib/wedding-code-v40-ref.mjs";

function parseArgs(argv) {
  const args = { file: DEFAULT_BANK_PATH, allowPlaceholder: false, json: false, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--allow-placeholder") args.allowPlaceholder = true;
    else if (a === "--json") args.json = true;
    else if (a === "--verbose") args.verbose = true;
    else if (a === "--file") {
      args.file = argv[i + 1];
      i += 1;
    } else {
      console.error(`알 수 없는 인자: ${a}`);
      process.exit(2);
    }
  }
  if (!args.file) {
    console.error("--file 뒤에 경로가 필요하다.");
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
let data;
try {
  data = JSON.parse(readFileSync(args.file, "utf8"));
} catch (error) {
  console.error(`은행 파일을 읽지 못했다: ${args.file}\n${error.message}`);
  process.exit(2);
}
const result = lintBank(data, { allowPlaceholder: args.allowPlaceholder });
if (args.json) console.log(JSON.stringify(result, null, 2));
else console.log(formatReport(result, { verbose: args.verbose }));
process.exit(result.errors.length === 0 ? 0 : 1);
